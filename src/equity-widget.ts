// Equity curve — multi-instance.
//
// A run's cumulative P&L at the size of a chart, drawn by @stocksharp/chart. It used to be a
// canvas of its own with a crosshair, a legend and a zoom written here; all three are the
// engine's, better than the versions this file had, and an equity curve over time is exactly
// what a time-series engine is for.
//
// What is left here is the part that is this package's: turning a run into a series, wording the
// readout through the host, and taking the engine's colours from `presentation.canvasPalette()`
// so a curve in a panel matches the sparkline in a table cell beside it.
//
// The sparkline is NOT this. A cell forty pixels tall gets `pnl-curve.ts` and a canvas, because
// a chart engine per table row is absurd - the two draw the same run at sizes that want
// different machinery.
import { formatPnl } from './formatters.js';
import { makeElement, makeIconButton, makePanelId, makePanelRoot } from './dom.js';
import { ControlTypes } from './control-types.js';
import { TradingHost, assertHost } from './trading-host.js';
import { type PnlPoint } from './pnl-curve.js';
import {
    AreaSeries, CrosshairMode, createChart,
    type AreaData, type CrosshairEvent, type IChartApi, type ISeriesApi, type Time,
} from './chart-engine.js';

/// What the panel needs beyond the host port. Nothing: there is nothing on a curve to act on.
export interface EquityDeps {
    host: TradingHost;
}

// How solid the area under the curve is drawn. Not a colour - the two colours are the host's -
// but how far they are faded, which is this chart's own business.
const FILL_TOP_ALPHA = 0.28;
const FILL_BOTTOM_ALPHA = 0.02;
const LINE_WIDTH = 2;

/// One sample as the engine takes it. Time is unix milliseconds on the way in and seconds on the
/// way through: the engine counts in seconds, and a host that hands over milliseconds - which is
/// what `Date.now()` and `presentation.timeText` both deal in - should not have to know that.
function toSeries(points: readonly PnlPoint[]): AreaData[] {
    const seen = new Set<number>();
    const out: AreaData[] = [];

    for (const point of [...points].sort((a, b) => a.time - b.time)) {
        if (!Number.isFinite(point.time) || !Number.isFinite(point.value)) continue;
        // The engine holds one value per moment. Two fills in the same second are two samples of
        // one instant, and the later one is where the run actually stood.
        const second = Math.floor(point.time / 1000);
        if (seen.has(second)) out[out.length - 1] = { time: second as Time, value: point.value };
        else out.push({ time: second as Time, value: point.value });
        seen.add(second);
    }
    return out;
}

export class EquityWidget {
    static TYPE = ControlTypes.Equity;

    rootEl: HTMLElement;
    // `//` rather than `///` from here down — see the note in positions-widget.
    _host: TradingHost;
    _closeBtn: HTMLElement | null;
    _resetBtn: HTMLElement | null;
    _lastEl: HTMLElement | null;
    _hoverEl: HTMLElement | null;
    _emptyEl: HTMLElement | null;
    _chartEl: HTMLElement | null;
    _chart: IChartApi | null;
    _series: ISeriesApi<AreaData> | null;
    _points: PnlPoint[];
    _resizeObserver: ResizeObserver | null;

    static create(hostEl: HTMLElement, state: Record<string, unknown>, deps: EquityDeps): EquityWidget {
        const host = assertHost(deps?.host, 'EquityWidget');
        const root = EquityWidget._buildRoot(host);
        root.id = makePanelId(EquityWidget.TYPE);
        hostEl.appendChild(root);
        return new EquityWidget(root, state || {}, deps);
    }

    static _buildRoot(host: TradingHost): HTMLElement {
        const title = host.t('Equity');
        return makePanelRoot('equity-panel', title, [
            makeElement('div', 'panel-header', {}, [
                makeElement('span', '', {}, [title]),
                makeElement('span', 'equity-last', {}, []),
                makeIconButton('bt-icon-btn equity-reset-btn', host.t('ResetView'), 'bi-arrow-clockwise', { type: 'button' }),
                makeIconButton('bt-icon-btn bt-icon-cancel panel-close-btn', host.t('ClosePanel'), 'bi-x', { type: 'button' }),
            ]),
            makeElement('div', 'panel-body', {}, [
                makeElement('div', 'equity-chart', { role: 'img', 'aria-label': host.t('PnLChart') }, [
                    // Over the curve rather than in the panel header, for the same reason the
                    // smile's is: a reading about a moment belongs beside that moment, and a host
                    // that lifts panel headers into a tab strip would put it in a tab title.
                    makeElement('div', 'equity-hover', {}, []),
                    makeElement('div', 'equity-empty', {}, [host.t('NoEquity')]),
                ]),
            ]),
        ]);
    }

    constructor(rootEl: HTMLElement, _state: Record<string, unknown>, deps: EquityDeps) {
        this._host = assertHost(deps?.host, 'EquityWidget');

        this.rootEl = rootEl;
        this._closeBtn = this.rootEl.querySelector('.panel-close-btn');
        this._resetBtn = this.rootEl.querySelector('.equity-reset-btn');
        this._lastEl = this.rootEl.querySelector('.equity-last');
        this._hoverEl = this.rootEl.querySelector('.equity-hover');
        this._emptyEl = this.rootEl.querySelector('.equity-empty');
        this._chartEl = this.rootEl.querySelector('.equity-chart');
        this._chart = null;
        this._series = null;
        this._points = [];
        this._resizeObserver = null;

        this._closeBtn?.addEventListener('click', (e) => { e.preventDefault(); this._host.close(); });
        this._resetBtn?.addEventListener('click', (e) => { e.preventDefault(); this.resetZoom(); });

        // The panel has no size until it is laid out, and a docked one is resized afterwards.
        // The engine sizes its canvases only through resize(), so it is told rather than left to
        // notice.
        if (this._chartEl !== null && typeof ResizeObserver !== 'undefined') {
            this._resizeObserver = new ResizeObserver(() => this._fit());
            this._resizeObserver.observe(this._chartEl);
        }

        this._render();
        this._host.register(this);
    }

    dispose(): void {
        try { this._resizeObserver?.disconnect(); } catch { /* already torn down */ }
        this._resizeObserver = null;
        try { this._chart?.remove(); } catch { /* already gone */ }
        this._chart = null;
        this._series = null;
        this._host.unregister(this);
        try { this.rootEl.remove(); } catch { /* already detached */ }
    }

    /// Show this run. The whole curve at once: it is a cumulative figure, so a set of points that
    /// no longer contains an earlier sample is a different run rather than a longer one.
    ///
    /// `time` is unix milliseconds.
    update(points: PnlPoint[]): void {
        this._points = points || [];
        this._render();
    }

    /// Show the whole run again, after a zoom.
    resetZoom(): void {
        try { this._chart?.timeScale().fitContent(); } catch { /* no chart yet */ }
    }

    /// The engine, for a host that wants to add to this chart - a benchmark line, a marker at a
    /// drawdown. Null until there is something to draw.
    chart(): IChartApi | null {
        return this._chart;
    }

    // Built on first use rather than in the constructor: the engine measures its container, and
    // a panel that has not been laid out yet has none.
    _ensureChart(): boolean {
        if (this._chart !== null) return true;
        if (this._chartEl === null) return false;

        const palette = this._host.presentation.canvasPalette();
        this._chart = createChart(this._chartEl, {
            layout: {
                background: { type: 'solid', color: 'transparent' },
                textColor: palette.grid,
                fontFamily: palette.font,
                fontSize: 11,
                attributionLogo: false,
            },
            grid: { vertLines: { color: palette.grid }, horzLines: { color: palette.grid } },
            crosshair: { mode: CrosshairMode.Normal },
            rightPriceScale: { borderColor: palette.grid },
            timeScale: {
                borderColor: palette.grid,
                timeVisible: true,
                secondsVisible: true,
                // The engine dates an axis in UTC unless told otherwise, and everything else on
                // the page - the readout beside this one included - reads in the browser's zone.
                // Two labels for one instant, three hours apart, is worse than either.
                timeZone: browserTimeZone(),
            },
        });

        this._series = this._chart.addSeries(AreaSeries, {
            lineWidth: LINE_WIDTH,
            lineColor: palette.up,
            topColor: withAlpha(palette.up, FILL_TOP_ALPHA),
            bottomColor: withAlpha(palette.up, FILL_BOTTOM_ALPHA),
        });

        // The readout. The engine says which point the pointer is over; wording it is the host's,
        // which is why this is here rather than in the engine's own crosshair label.
        this._chart.subscribeCrosshairMove((param) => this._renderHover(param));
        return true;
    }

    _render(): void {
        const series = toSeries(this._points);
        const empty = series.length < 2;

        if (this._emptyEl !== null) this._emptyEl.hidden = !empty;
        this._renderLast(empty ? null : series[series.length - 1].value);
        if (empty) return;
        if (!this._ensureChart() || this._series === null) return;

        // Coloured by where the run ended, the way the sparkline is: a run that peaked and gave
        // it all back is a loss, and the colour says so.
        const palette = this._host.presentation.canvasPalette();
        const last = series[series.length - 1].value;
        const colour = last >= 0 ? palette.up : palette.down;
        this._series.applyOptions({
            lineColor: colour,
            topColor: withAlpha(colour, FILL_TOP_ALPHA),
            bottomColor: withAlpha(colour, FILL_BOTTOM_ALPHA),
        });

        this._series.setData(series);
        this._fit();
    }

    _fit(): void {
        if (this._chart === null || this._chartEl === null) return;
        const rect = this._chartEl.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;
        try {
            this._chart.resize(rect.width, rect.height);
        } catch { /* the engine is between frames */ }
    }

    // Where the run stands, in the header.
    _renderLast(value: number | null): void {
        const el = this._lastEl;
        if (el === null) return;

        el.textContent = value === null ? '' : formatPnl(value);
        el.className = value === null
            ? 'equity-last'
            : `equity-last ${this._host.presentation.pnlClass(value)}`;
    }

    // What the pointer is over. The engine hands over the moment and the value at it; the moment
    // is worded by the host, because what a time reads as is the page's business and not this
    // package's.
    _renderHover(param: CrosshairEvent): void {
        const el = this._hoverEl;
        if (el === null) return;

        const point = this._series === null ? undefined : param.seriesData.get(this._series);
        const value = (point as { value?: number } | undefined)?.value;

        // Off the series entirely: the engine reports a crosshair with no time when the pointer
        // has left the plot, and a stale readout is worse than none.
        if (param.time === null || value === undefined || !Number.isFinite(value)) {
            el.textContent = '';
            el.className = 'equity-hover';
            return;
        }

        // Back to milliseconds for the host: the engine counts in seconds, and every other moment
        // this package hands over is a Date.
        const moment = new Date(Number(param.time) * 1000);
        el.textContent = `${this._host.presentation.timeText(moment)}  ${formatPnl(value)}`;
        el.className = `equity-hover ${this._host.presentation.pnlClass(value)}`;
    }
}

/// The zone a moment reads in: the browser's own, which is the zone
/// `presentation.timeText` words one in. UTC when the environment cannot say.
function browserTimeZone(): string {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
        return 'UTC';
    }
}

/// A colour at a given opacity.
///
/// The host answers with whatever CSS understands, so this cannot take it apart - it wraps it
/// instead, which `color-mix` accepts for every form a token can be written in.
function withAlpha(colour: string, alpha: number): string {
    return `color-mix(in srgb, ${colour} ${Math.round(alpha * 100)}%, transparent)`;
}
