// Optimisation surface - multi-instance.
//
// The heatmap's measurements as a landscape: one metric over two discrete axes, with the metric
// as height as well as colour. It takes the same input the flat map does, so a consumer shows
// either, or both, from one set of results.
//
// It is turned, tipped and zoomed by hand, and all three gestures arrive through pointer events
// rather than through mouse and touch handlers written twice. A pointer is a pointer: one down
// and a drag turns the surface, two down and the distance between them zooms it, a wheel zooms
// it as well. Nothing here asks which kind of device it is on.
//
// No library under this. The projection and the ordering are in `surface-grid.ts` as arithmetic;
// this file owns the canvas, the gestures and the colours the host supplies.
import { formatPnl } from './formatters.js';
import { makeElement, makeIconButton, makePanelId, makePanelRoot } from './dom.js';
import { ControlTypes } from './control-types.js';
import { TradingHost, assertHost } from './trading-host.js';
import { valueAt, type HeatCell, type HeatDirection } from './heatmap-grid.js';
import {
    DEFAULT_VIEW, dragView, nearestVertex, surfaceLayout, zoomView,
    type SurfaceLayout, type SurfaceVertex, type SurfaceView,
} from './surface-grid.js';

/// What the surface is given. The heatmap's own input, so one set of results feeds both.
export interface SurfaceData {
    xLabel: string;
    yLabel: string;
    metricLabel: string;
    /// Which way is better. Required for the same reason the flat map requires it: without it a
    /// landscape of drawdowns would raise its worst corner into the peak.
    betterWhen: HeatDirection;
    cells: HeatCell[];
}

/// The panel needs nothing beyond the host port. A face is a cell rather than a run, so there is
/// nothing here for a click to open - a click turns the surface instead.
export interface SurfaceDeps {
    host: TradingHost;
}

// Opacity and width, not colour. Every hue is the host's `canvasPalette`; how solid and how thick
// a thing is drawn is this control's own business.
const FACE_ALPHA = 0.85;
const EDGE_ALPHA = 0.35;
const FLOOR_ALPHA = 0.5;
const EDGE_WIDTH = 1;
const LABEL_ALPHA = 0.8;
// How much one notch of a wheel zooms. A mouse reports a notch as about 100 units and a trackpad
// reports a stroke as a stream of small ones, so a step taken per EVENT rather than per unit makes
// the mouse jump the whole range in a few notches while the trackpad crawls. The delta is
// normalised to notches first, and clamped: a browser that reports a page-sized delta must not
// zoom a chart by a page.
const WHEEL_STEP = 1.12;
const WHEEL_UNITS_PER_NOTCH = 100;
const WHEEL_MAX_NOTCHES = 2;

/// Wheel delta as notches, whatever units the browser chose to report it in.
export function wheelNotches(deltaY: number, deltaMode: number): number {
    if (!Number.isFinite(deltaY) || deltaY === 0) return 0;

    // 0 = pixels, 1 = lines, 2 = pages. Firefox reports lines for a mouse and pixels for a
    // trackpad, and the same number means very different things between the two.
    const perNotch = deltaMode === 1 ? 3 : deltaMode === 2 ? 1 : WHEEL_UNITS_PER_NOTCH;
    const notches = deltaY / perNotch;
    return Math.max(-WHEEL_MAX_NOTCHES, Math.min(WHEEL_MAX_NOTCHES, notches));
}
/// How long a tick stroke is, and how far its label clears it. In CSS pixels.
const TICK_LENGTH = 5;
const TICK_GAP = 4;

/// How far an axis caption sits outside the edge it names, past its marks.
const CAPTION_OFFSET = 34;

/// How near a pointer has to come to a measured point before the panel answers for it. Generous,
/// because a vertex is a point and a pointer is a hand.
const HOVER_REACH = 22;

/// The ring drawn on the point being read.
const HOVER_RING = 5;

export class SurfaceWidget {
    static TYPE = ControlTypes.OptimizationSurface;

    rootEl: HTMLElement;
    canvasEl: HTMLCanvasElement | null;
    // `//` rather than `///` from here down — see the note in positions-widget.
    _host: TradingHost;
    _closeBtn: HTMLElement | null;
    _resetBtn: HTMLElement | null;
    _emptyEl: HTMLElement | null;
    _ctx: CanvasRenderingContext2D | null;
    _data: SurfaceData | null;
    _view: SurfaceView;
    _resizeObserver: ResizeObserver | null;
    // Every pointer currently down on the canvas, by id. One turns, two zoom.
    _pointers: Map<number, { x: number; y: number }>;
    _pinch: number;
    // The last layout, so a pointer can be answered without projecting the grid again.
    _layout: SurfaceLayout | null;
    _hover: SurfaceVertex | null;
    _hoverEl: HTMLElement | null;

    static create(hostEl: HTMLElement, state: Record<string, unknown>, deps: SurfaceDeps): SurfaceWidget {
        const host = assertHost(deps?.host, 'SurfaceWidget');
        const root = SurfaceWidget._buildRoot(host);
        root.id = makePanelId(SurfaceWidget.TYPE);
        hostEl.appendChild(root);
        return new SurfaceWidget(root, state || {}, deps);
    }

    static _buildRoot(host: TradingHost): HTMLElement {
        const title = host.t('OptimizationSurface');
        return makePanelRoot('surface-panel', title, [
            makeElement('div', 'panel-header', {}, [
                makeElement('span', '', {}, [title]),
                makeElement('span', 'surface-metric', {}, []),
                makeIconButton('bt-icon-btn surface-reset-btn', host.t('ResetView'), 'bi-arrow-clockwise', { type: 'button' }),
                makeIconButton('bt-icon-btn bt-icon-cancel panel-close-btn', host.t('ClosePanel'), 'bi-x', { type: 'button' }),
            ]),
            makeElement('div', 'panel-body', {}, [
                makeElement('div', 'surface-chart', {}, [
                    makeElement('canvas', 'surface-canvas', { role: 'img', 'aria-label': host.t('OptimizationSurfaceChart') }, []),
                    // Over the canvas rather than in the panel header: a reading about the point
                    // under the pointer belongs beside that point. A host that lifts its panel
                    // headers into a tab strip would otherwise put the reading in a tab title.
                    makeElement('div', 'surface-readout', {}, []),
                    makeElement('div', 'surface-empty', { hidden: '' }, [host.t('NoOptimizationResults')]),
                ]),
            ]),
        ]);
    }

    constructor(rootEl: HTMLElement, _state: Record<string, unknown>, deps: SurfaceDeps) {
        this._host = assertHost(deps?.host, 'SurfaceWidget');

        this.rootEl = rootEl;
        this.canvasEl = this.rootEl.querySelector('.surface-canvas');
        this._emptyEl = this.rootEl.querySelector('.surface-empty');
        this._closeBtn = this.rootEl.querySelector('.panel-close-btn');
        this._resetBtn = this.rootEl.querySelector('.surface-reset-btn');
        this._ctx = this.canvasEl?.getContext('2d') ?? null;
        this._data = null;
        this._layout = null;
        this._hover = null;
        this._hoverEl = this.rootEl.querySelector('.surface-readout');
        this._view = DEFAULT_VIEW;
        this._resizeObserver = null;
        this._pointers = new Map();
        this._pinch = 0;

        this._closeBtn?.addEventListener('click', (e) => { e.preventDefault(); this._host.close(); });
        this._resetBtn?.addEventListener('click', (e) => {
            e.preventDefault();
            this._view = DEFAULT_VIEW;
            this._render();
        });

        this._bindGestures();

        // The canvas has no size until the panel is laid out, and a docked panel is resized by
        // the user afterwards; both are the same event as far as this is concerned.
        if (this.canvasEl !== null && typeof ResizeObserver !== 'undefined') {
            this._resizeObserver = new ResizeObserver(() => this._render());
            this._resizeObserver.observe(this.canvasEl);
        }

        this._host.register(this);
    }

    dispose(): void {
        this._resizeObserver?.disconnect();
        this._resizeObserver = null;
        this._host.unregister(this);
        try { this.rootEl.remove(); } catch { /* already detached */ }
    }

    /// Show these results. The whole set at once: a surface is one sweep, and half of one drawn
    /// over the other half would be a landscape of two different runs.
    update(data: SurfaceData): void {
        this._data = data;
        this._render();
    }

    /// The view the surface is currently seen from, so a host can persist it.
    view(): SurfaceView {
        return { ...this._view };
    }

    /// Put the surface back where it started.
    resetView(): void {
        this._view = DEFAULT_VIEW;
        this._render();
    }

    // One pointer turns, two zoom, a wheel zooms. Pointer events cover mouse, pen and touch, so
    // there is one implementation rather than one per input device.
    _bindGestures(): void {
        const canvas = this.canvasEl;
        if (canvas === null) return;

        canvas.addEventListener('pointerdown', (event: PointerEvent) => {
            // The canvas claims the gesture: without this a drag on a phone scrolls the page
            // under the panel instead of turning what the finger is on.
            event.preventDefault();
            try { canvas.setPointerCapture(event.pointerId); } catch { /* not captured, still works */ }
            this._pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
            this._pinch = this._pointerSpread();
        });

        canvas.addEventListener('pointermove', (event: PointerEvent) => {
            const previous = this._pointers.get(event.pointerId);
            if (previous === undefined) return;
            event.preventDefault();
            this._pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

            if (this._pointers.size >= 2) {
                // Two fingers: the distance between them is the zoom, and the turn is left to
                // one finger. Pinching and turning at once reads as neither.
                const spread = this._pointerSpread();
                if (this._pinch > 0 && spread > 0) this._view = zoomView(this._view, spread / this._pinch);
                this._pinch = spread;
            } else {
                this._view = dragView(this._view, event.clientX - previous.x, event.clientY - previous.y);
            }
            this._render();
        });

        const release = (event: PointerEvent) => {
            this._pointers.delete(event.pointerId);
            this._pinch = this._pointerSpread();
        };
        canvas.addEventListener('pointerup', release);
        canvas.addEventListener('pointercancel', release);
        canvas.addEventListener('pointerleave', release);

        // What the pointer is over, whenever it is not turning the surface. The nearest measured
        // vertex within reach, or nothing - a landscape has gaps, and naming the far side of one
        // because it happened to be closest in pixels would be a reading nobody asked for.
        canvas.addEventListener('pointermove', (event: PointerEvent) => {
            if (this._pointers.size > 0) return;
            const box = canvas.getBoundingClientRect();
            this._setHover(event.clientX - box.left, event.clientY - box.top);
        });

        canvas.addEventListener('pointerleave', () => this._setHover(null, null));

        canvas.addEventListener('wheel', (event: WheelEvent) => {
            // Claimed for the same reason as the drag: a wheel over a chart zooms the chart, and
            // the page scrolling instead is the thing that makes a 3D panel unusable in a page.
            event.preventDefault();
            const notches = wheelNotches(event.deltaY, event.deltaMode);
            if (notches === 0) return;
            this._view = zoomView(this._view, Math.pow(WHEEL_STEP, -notches));
            this._render();
        }, { passive: false });
    }


    // The vertex under the pointer, and a repaint when it changes. Compared by identity of the
    // grid pair rather than of the object: a re-layout builds new vertices for the same runs.
    _setHover(x: number | null, y: number | null): void {
        const found = x === null || y === null || this._layout === null
            ? null
            : nearestVertex(this._layout.vertices, x, y, HOVER_REACH);
        const before = this._hover;
        const same = before !== null && found !== null && before.x === found.x && before.y === found.y;
        if (same || (before === null && found === null)) return;

        this._hover = found;
        this._renderHover();
        this._render();
    }

    // Which pair it is and what it measured, in the panel's own strip over the canvas.
    _renderHover(): void {
        const el = this._hoverEl;
        if (el === null || this._data === null) return;

        const hover = this._hover;
        if (hover === null) {
            el.textContent = '';
            return;
        }
        el.textContent = `${this._data.xLabel} ${hover.x} · ${this._data.yLabel} ${hover.y}`
            + `  ${formatPnl(hover.value)}`;
    }

    // How far apart the two pointers are, or zero when there are not two.
    _pointerSpread(): number {
        const points = [...this._pointers.values()];
        if (points.length < 2) return 0;
        return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
    }

    _render(): void {
        const canvas = this.canvasEl;
        const ctx = this._ctx;
        if (canvas === null || ctx === null) return;

        // Measured from the box the stylesheet gives it, and the style is left alone. Writing
        // the measurement back as an inline width would pin the canvas at whatever size it
        // happened to have when it was first drawn - and an inline width beats the stylesheet's
        // 100%, so it could never grow again.
        const box = canvas.getBoundingClientRect();
        const width = Math.round(box.width);
        const height = Math.round(box.height);
        if (width <= 0 || height <= 0) return;

        // Device pixels for the backing store: on a 2x screen a canvas sized only in CSS pixels
        // draws every stroke at half the resolution of the text beside it.
        const ratio = typeof window === 'undefined' ? 1 : (window.devicePixelRatio || 1);
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);

        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        ctx.clearRect(0, 0, width, height);

        const metric = this.rootEl.querySelector('.surface-metric');
        if (metric !== null) metric.textContent = this._data?.metricLabel ?? '';

        const layout = this._data === null ? null : surfaceLayout({
            width, height, cells: this._data.cells, betterWhen: this._data.betterWhen, view: this._view,
        });
        this._layout = layout;

        if (this._emptyEl !== null) this._emptyEl.hidden = layout !== null;
        if (layout === null || this._data === null) {
            this._hover = null;
            this._renderHover();
            return;
        }

        const palette = this._host.presentation.canvasPalette();
        this._drawFloor(ctx, layout, palette.grid);
        this._drawFaces(ctx, layout, palette);
        this._drawAxes(ctx, layout, palette);
        this._drawHover(ctx, palette);
    }

    // The three axes: the two the grid is swept over and the one it is measured against, each with
    // its own marks. A landscape with no numbers on it is a picture of a shape, not a reading.
    _drawAxes(
        ctx: CanvasRenderingContext2D,
        layout: SurfaceLayout,
        palette: { grid: string; font: string },
    ): void {
        if (this._data === null) return;

        ctx.font = palette.font;
        ctx.textBaseline = 'middle';
        ctx.strokeStyle = palette.grid;
        ctx.fillStyle = palette.grid;
        ctx.lineWidth = EDGE_WIDTH;

        for (const axis of layout.axes) {
            ctx.globalAlpha = LABEL_ALPHA;
            for (const tick of axis.ticks) {
                const [ax, ay] = tick.at;
                const [dx, dy] = tick.away;
                ctx.beginPath();
                ctx.moveTo(ax, ay);
                ctx.lineTo(ax + dx * TICK_LENGTH, ay + dy * TICK_LENGTH);
                ctx.stroke();

                // A label sits on the far side of its own tick, and leans the way the tick points:
                // marks down the left of the box read right-aligned, marks along the bottom centred.
                const tx = ax + dx * (TICK_LENGTH + TICK_GAP);
                const ty = ay + dy * (TICK_LENGTH + TICK_GAP);
                ctx.textAlign = Math.abs(dx) < 0.4 ? 'center' : (dx > 0 ? 'left' : 'right');
                ctx.fillText(this._tickLabel(axis.axis, tick.label, layout), tx, ty);
            }

            // The caption past the last mark, so it names the axis without sitting on a number.
            const midX = (axis.from[0] + axis.to[0]) / 2;
            const midY = (axis.from[1] + axis.to[1]) / 2;
            const away = axis.ticks.length > 0 ? axis.ticks[0].away : [0, 1];
            ctx.globalAlpha = 1;
            ctx.textAlign = 'center';
            ctx.fillText(
                this._axisCaption(axis.axis),
                midX + away[0] * CAPTION_OFFSET,
                midY + away[1] * CAPTION_OFFSET,
            );
        }
        ctx.globalAlpha = 1;
    }

    // The vertical axis is measured in the metric, so its 0..1 heights are worded as figures; the
    // other two carry the parameter values as they were swept.
    _tickLabel(axis: 'x' | 'y' | 'z', label: string, layout: SurfaceLayout): string {
        if (axis !== 'z' || this._data === null) return label;
        const height = Number(label);
        return formatPnl(valueAt(height * 2 - 1, layout.scale, this._data.betterWhen));
    }

    _axisCaption(axis: 'x' | 'y' | 'z'): string {
        if (this._data === null) return '';
        if (axis === 'x') return this._data.xLabel;
        if (axis === 'y') return this._data.yLabel;
        return this._data.metricLabel;
    }

    // A ring on the vertex under the pointer, so the figure in the strip has a place on the
    // landscape rather than being a number beside a picture.
    _drawHover(ctx: CanvasRenderingContext2D, palette: { up: string; grid: string }): void {
        const hover = this._hover;
        if (hover === null) return;

        ctx.beginPath();
        ctx.arc(hover.at[0], hover.at[1], HOVER_RING, 0, Math.PI * 2);
        ctx.strokeStyle = palette.up;
        ctx.lineWidth = 2;
        ctx.globalAlpha = 1;
        ctx.stroke();
    }

    // The frame the surface stands on, so a reader can tell which way the grid runs even when
    // the landscape hides its own edges.
    _drawFloor(ctx: CanvasRenderingContext2D, layout: SurfaceLayout, colour: string): void {
        ctx.globalAlpha = FLOOR_ALPHA;
        ctx.strokeStyle = colour;
        ctx.lineWidth = EDGE_WIDTH;
        for (const axis of layout.axes) {
            ctx.beginPath();
            ctx.moveTo(axis.from[0], axis.from[1]);
            ctx.lineTo(axis.to[0], axis.to[1]);
            ctx.stroke();
        }
        ctx.globalAlpha = 1;
    }

    // Far to near, each face filled by how good it is and outlined so the grid stays legible
    // where two faces are nearly the same colour.
    _drawFaces(
        ctx: CanvasRenderingContext2D,
        layout: SurfaceLayout,
        palette: { up: string; down: string; grid: string },
    ): void {
        for (const quad of layout.quads) {
            ctx.beginPath();
            ctx.moveTo(quad.points[0][0], quad.points[0][1]);
            for (const [x, y] of quad.points.slice(1)) ctx.lineTo(x, y);
            ctx.closePath();

            ctx.globalAlpha = FACE_ALPHA * Math.max(0.18, Math.abs(quad.tint));
            ctx.fillStyle = quad.tint >= 0 ? palette.up : palette.down;
            ctx.fill();

            ctx.globalAlpha = EDGE_ALPHA;
            ctx.strokeStyle = palette.grid;
            ctx.lineWidth = EDGE_WIDTH;
            ctx.stroke();
        }
        ctx.globalAlpha = 1;
    }

}
