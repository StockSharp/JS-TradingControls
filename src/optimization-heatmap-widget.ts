// Optimisation heatmap - multi-instance.
//
// One metric over two parameters: an axis of discrete values across, another up, a cell per pair
// of them, coloured by what that pair measured. The panel does not know what an optimisation is -
// a heatmap of a metric over two parameters is the same object whatever produced it - so the
// pairs are handed in and the two axis names come with them.
//
// The map is a <canvas>, the one surface a class name cannot reach: its geometry comes out of
// `heatmap-grid.ts` as numbers and its colours out of the host's `canvasPalette()`, so nothing
// here is painted from a palette this package chose. The tooltip is DOM, because it is text.
//
// Two things are drawn rather than tabulated and are worth stating. A cell carries no printed
// number: at the size a forty by forty sweep leaves a cell, digits are unreadable, and reading
// colour at that size is the entire reason to draw the map. And a pair nobody ran is struck
// through rather than left blank, because an unrun pair and a pair that measured zero are
// different facts that a scale with zero at its neutral point would otherwise paint the same.
import { formatStatistic } from './statistics-widget.js';
import { makeElement, makeIconButton, makePanelId, makePanelRoot } from './dom.js';
import { ControlTypes } from './control-types.js';
import { TradingHost, assertHost } from './trading-host.js';
import { hitHeatmap, layoutHeatmap } from './heatmap-grid.js';
import type { HeatCell, HeatCellShape, HeatDirection, HeatLayout, HeatRect } from './heatmap-grid.js';

/// One map: the pairs, what they measured, and the three names a reader needs to know what is
/// on the screen. The labels arrive worded - they are the consumer's own vocabulary for its
/// parameters and its metric, the way a statistic reaches the statistics panel already named.
export interface HeatmapData {
    xLabel: string;
    yLabel: string;
    metricLabel: string;
    /// Which way is better. Required, and required for a reason: without it the same map of
    /// drawdowns would paint its worst corner in the winning colour.
    betterWhen: HeatDirection;
    cells: HeatCell[];
}

/// The panel needs nothing beyond the host port. There is nothing on a map to act on: a cell is
/// the mean of the runs at one pair rather than a run, so there is no run for a click to open.
export interface OptimizationHeatmapDeps {
    host: TradingHost;
}

// Opacity, not colour. Every hue below is the host's `canvasPalette`; how solid a thing is drawn
// is the map's own business, and keeping the two apart is what lets one palette serve a light
// theme and a dark one without the package knowing which it is in.
//
// The ground is drawn under every measured cell so that a cell sitting exactly on the anchor -
// which takes no tint at all - is still visibly a cell. That is also what lets the tint itself
// go all the way down to nothing without a floor: neutral reads as the ground, and a pair that
// was never run has no ground under it.
const GROUND_ALPHA = 0.1;
const GAP_ALPHA = 0.25;
const LABEL_ALPHA = 0.65;
const BEST_WIDTH = 2;
// Gap between the cursor and the tooltip, and between the tooltip and the edge it is clamped
// against.
const TOOLTIP_OFFSET = 12;
const TOOLTIP_MARGIN = 4;

export class OptimizationHeatmapWidget {
    static TYPE = ControlTypes.OptimizationHeatmap;

    rootEl: HTMLElement;
    canvasEl: HTMLCanvasElement | null;
    // `//` rather than `///` from here down - see the note in positions-widget.
    _host: TradingHost;
    _metricEl: HTMLElement | null;
    _emptyEl: HTMLElement | null;
    _tooltipEl: HTMLElement | null;
    _closeBtn: HTMLElement | null;
    _ctx: CanvasRenderingContext2D | null;
    _data: HeatmapData | null;
    // Rebuilt on every paint: where each cell landed and what it stands for. Hover reads it
    // rather than the data, so a cursor and a pixel agree about which pair is under it.
    _layout: HeatLayout | null;
    _size: { width: number; height: number } | null;
    _resizeObserver: ResizeObserver | null;

    static create(hostEl: HTMLElement, state: Record<string, unknown>, deps: OptimizationHeatmapDeps): OptimizationHeatmapWidget {
        // Assert before building: the markup below is localized through the host, so a missing
        // host has to fail here rather than render a panel captioned with raw English keys.
        const host = assertHost(deps?.host, 'OptimizationHeatmapWidget');
        const root = OptimizationHeatmapWidget._buildRoot(host);
        root.id = makePanelId(OptimizationHeatmapWidget.TYPE);
        hostEl.appendChild(root);
        return new OptimizationHeatmapWidget(root, state || {}, deps);
    }

    // The panel's markup. The metric's name sits in the header rather than on the canvas: it is
    // the caption the drawn legend is read against, and putting it in the chrome costs the map
    // no pixels and leaves the text selectable and sized by the stylesheet.
    static _buildRoot(host: TradingHost): HTMLElement {
        const title = host.t('OptimizationHeatmap');
        return makePanelRoot('optimization-heatmap-panel', title, [
            makeElement('div', 'panel-header', {}, [
                makeElement('span', '', {}, [title]),
                makeElement('span', 'heatmap-metric', {}, []),
                makeIconButton('bt-icon-btn bt-icon-cancel panel-close-btn', host.t('ClosePanel'), 'bi-x', { type: 'button' }),
            ]),
            makeElement('div', 'panel-body', {}, [
                makeElement('canvas', 'heatmap-canvas', { role: 'img', 'aria-label': host.t('OptimizationHeatmapChart') }, []),
                makeElement('div', 'heatmap-empty', { hidden: '' }, [host.t('NoOptimizationResults')]),
                makeElement('div', 'heatmap-tooltip', { role: 'tooltip', hidden: '' }, []),
            ]),
        ]);
    }

    constructor(rootEl: HTMLElement, _state: Record<string, unknown>, deps: OptimizationHeatmapDeps) {
        this._host = assertHost(deps?.host, 'OptimizationHeatmapWidget');

        this.rootEl = rootEl;
        this.canvasEl = this.rootEl.querySelector('.heatmap-canvas');
        this._metricEl = this.rootEl.querySelector('.heatmap-metric');
        this._emptyEl = this.rootEl.querySelector('.heatmap-empty');
        this._tooltipEl = this.rootEl.querySelector('.heatmap-tooltip');
        this._closeBtn = this.rootEl.querySelector('.panel-close-btn');
        this._ctx = this.canvasEl?.getContext('2d') ?? null;
        this._data = null;
        this._layout = null;
        this._size = null;
        this._resizeObserver = null;

        this._closeBtn?.addEventListener('click', (e) => { e.preventDefault(); this._host.close(); });
        this._bindHover();
        this._setEmpty(true);

        if (this.canvasEl && typeof ResizeObserver === 'function') {
            this._resizeObserver = new ResizeObserver(() => this._render());
            this._resizeObserver.observe(this.canvasEl);
        }

        this._host.register(this);
    }

    dispose(): void {
        try { this._resizeObserver?.disconnect(); } catch { /* already torn down */ }
        this._host.unregister(this);
        try { this.rootEl.remove(); } catch { /* already detached */ }
    }

    /// Show this map. The whole of it at once: a pair that has dropped out of the set has stopped
    /// existing, and leaving its cell behind would report a run that is no longer in the report.
    update(data: HeatmapData): void {
        this._data = data;
        if (this._metricEl !== null) this._metricEl.textContent = data.metricLabel;
        this._hideTooltip();
        this._render();
    }

    // The canvas in CSS pixels, and its backing store in device pixels. Without the second the
    // map is drawn at a third of the resolution the screen has, and a lattice of hairlines is
    // exactly the drawing that shows it.
    _sizeCanvas(): void {
        const canvas = this.canvasEl;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const ratio = typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1;
        const width = Math.max(1, Math.floor(rect.width));
        const height = Math.max(1, Math.floor(rect.height));
        if (canvas.width !== width * ratio || canvas.height !== height * ratio) {
            canvas.width = width * ratio;
            canvas.height = height * ratio;
            // Everything below draws in CSS pixels, which is also the space a mouse event
            // arrives in - so the hit test needs no conversion of its own.
            this._ctx?.setTransform(ratio, 0, 0, ratio, 0, 0);
        }
        this._size = { width, height };
    }

    _render(): void {
        const ctx = this._ctx;
        if (ctx === null) return;
        this._sizeCanvas();
        const size = this._size;
        if (size === null) return;

        ctx.clearRect(0, 0, size.width, size.height);
        this._layout = null;

        const data = this._data;
        if (data === null) { this._setEmpty(true); return; }

        const layout = layoutHeatmap({
            width: size.width,
            height: size.height,
            cells: data.cells,
            betterWhen: data.betterWhen,
            xLabel: data.xLabel,
            yLabel: data.yLabel,
        });
        this._setEmpty(layout === null);
        if (layout === null) return;
        this._layout = layout;

        const palette = this._host.presentation.canvasPalette();
        ctx.font = palette.font;
        ctx.lineWidth = 1;

        for (const shape of layout.cells) this._paintTint(ctx, shape.rect, shape.tint, palette.grid, palette.up, palette.down);

        // A pair nobody ran, struck through. One diagonal rather than a fill of any kind: no
        // amount of colour can say "not measured" on a map whose colours are all measurements.
        ctx.globalAlpha = GAP_ALPHA;
        ctx.strokeStyle = palette.grid;
        for (const gap of layout.gaps) {
            ctx.beginPath();
            ctx.moveTo(gap.rect.x, gap.rect.y + gap.rect.height);
            ctx.lineTo(gap.rect.x + gap.rect.width, gap.rect.y);
            ctx.stroke();
        }

        // Last, so it sits over its own fill. In the grid colour because that is the only
        // non-directional colour the palette carries, and an outline in either direction colour
        // would vanish on half the cells it might land on.
        const best = layout.cells.find(shape => shape.best);
        if (best !== undefined) {
            ctx.globalAlpha = 1;
            ctx.strokeStyle = palette.grid;
            ctx.lineWidth = BEST_WIDTH;
            OptimizationHeatmapWidget._outline(ctx, best.rect, BEST_WIDTH / 2);
            ctx.lineWidth = 1;
        }

        // The key, drawn out of the same two colours the map is: a legend in CSS would read the
        // page's own tokens, and a host whose canvas palette comes from anywhere else would then
        // explain its map in colours the map does not use.
        for (const step of layout.legend.steps)
            this._paintTint(ctx, step.rect, step.tint, palette.grid, palette.up, palette.down);

        ctx.globalAlpha = LABEL_ALPHA;
        ctx.fillStyle = palette.grid;

        ctx.textBaseline = 'top';
        ctx.textAlign = 'center';
        for (const tick of layout.xTicks) ctx.fillText(tick.text, tick.x, tick.y);
        ctx.fillText(layout.xTitle.text, layout.xTitle.x, layout.xTitle.y);
        ctx.fillText(formatStatistic(layout.legend.anchor.value), layout.legend.anchor.x, layout.legend.anchor.y);

        ctx.textAlign = 'left';
        ctx.fillText(layout.yTitle.text, layout.yTitle.x, layout.yTitle.y);
        ctx.fillText(formatStatistic(layout.legend.low.value), layout.legend.low.x, layout.legend.low.y);

        ctx.textAlign = 'right';
        ctx.fillText(formatStatistic(layout.legend.high.value), layout.legend.high.x, layout.legend.high.y);

        ctx.textBaseline = 'middle';
        for (const tick of layout.yTicks) ctx.fillText(tick.text, tick.x, tick.y);

        ctx.globalAlpha = 1;
    }

    // The ground, then as much of the direction colour as the cell earned. Two fills rather than
    // one blended colour: blending would need a background this control is not allowed to know.
    _paintTint(ctx: CanvasRenderingContext2D, rect: HeatRect, tint: number, ground: string, up: string, down: string): void {
        ctx.globalAlpha = GROUND_ALPHA;
        ctx.fillStyle = ground;
        ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
        if (tint === 0) return;

        ctx.globalAlpha = Math.abs(tint);
        ctx.fillStyle = tint > 0 ? up : down;
        ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    }

    static _outline(ctx: CanvasRenderingContext2D, rect: HeatRect, inset: number): void {
        const left = rect.x + inset;
        const top = rect.y + inset;
        const right = rect.x + rect.width - inset;
        const bottom = rect.y + rect.height - inset;
        ctx.beginPath();
        ctx.moveTo(left, top);
        ctx.lineTo(right, top);
        ctx.lineTo(right, bottom);
        ctx.lineTo(left, bottom);
        ctx.closePath();
        ctx.stroke();
    }

    _setEmpty(empty: boolean): void {
        if (this._emptyEl === null) return;
        if (empty) this._emptyEl.removeAttribute('hidden');
        else this._emptyEl.setAttribute('hidden', '');
    }

    _bindHover(): void {
        const canvas = this.canvasEl;
        if (!canvas) return;
        canvas.addEventListener('mousemove', (e: MouseEvent) => {
            const layout = this._layout;
            if (layout === null) { this._hideTooltip(); return; }
            const rect = canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            const hit = hitHeatmap(layout, x, y);
            // A pair nobody ran says nothing, so it says nothing: a tooltip reading "no data"
            // over a cell that is visibly struck through is the same statement twice.
            if (hit !== null) this._showTooltip(hit, x, y);
            else this._hideTooltip();
        });
        canvas.addEventListener('mouseleave', () => this._hideTooltip());
    }

    _showTooltip(shape: HeatCellShape, x: number, y: number): void {
        const tooltip = this._tooltipEl;
        const canvas = this.canvasEl;
        const data = this._data;
        if (!tooltip || !canvas || data === null) return;

        const lines: HTMLElement[] = [
            this._tooltipLine(data.xLabel, shape.bucket.x),
            this._tooltipLine(data.yLabel, shape.bucket.y),
            this._tooltipLine(data.metricLabel, formatStatistic(shape.bucket.value)),
        ];
        // How many runs the figure is the mean of, and only when it is a mean of more than one.
        // A count of 1 on every cell is a column of noise; a count of 5 on one of them is the
        // difference between a result and a coincidence.
        if (shape.bucket.count > 1)
            lines.push(this._tooltipLine(this._host.t('Runs'), String(shape.bucket.count)));
        if (shape.best)
            lines.push(makeElement('div', 'heatmap-tt-row heatmap-tt-best', {}, [this._host.t('Best')]));
        tooltip.replaceChildren(...lines);

        // Measured, then placed: the size is only known once it is showing, and it is clamped
        // inside the canvas so a cell near the right or bottom edge does not push its own
        // tooltip out of view.
        tooltip.removeAttribute('hidden');
        const canvasRect = canvas.getBoundingClientRect();
        const parentRect = tooltip.offsetParent?.getBoundingClientRect() ?? canvasRect;
        const originX = canvasRect.left - parentRect.left;
        const originY = canvasRect.top - parentRect.top;
        const maxX = originX + canvasRect.width - tooltip.offsetWidth - TOOLTIP_MARGIN;
        const maxY = originY + canvasRect.height - tooltip.offsetHeight - TOOLTIP_MARGIN;
        tooltip.style.left = `${Math.max(0, Math.min(originX + x + TOOLTIP_OFFSET, maxX))}px`;
        tooltip.style.top = `${Math.max(0, Math.min(originY + y + TOOLTIP_OFFSET, maxY))}px`;
    }

    _tooltipLine(label: string, value: string): HTMLElement {
        return makeElement('div', 'heatmap-tt-row', {}, [
            makeElement('span', 'heatmap-tt-label', {}, [label]),
            makeElement('span', 'heatmap-tt-value', {}, [value]),
        ]);
    }

    _hideTooltip(): void {
        this._tooltipEl?.setAttribute('hidden', '');
    }
}
