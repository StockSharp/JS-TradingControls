// Option smile — multi-instance.
//
// One expiry's implied volatility against strike, call side and put side as two curves on one
// scale, drawn by @stocksharp/chart.
//
// The engine is a time-series engine and this axis is a ladder of strikes, which looked at first
// like a reason to draw the chart by hand. It is not: the axis carries numbers, and what turns
// them into dates is `timeScale.formatter` - one function shared by the tick labels and the
// crosshair label. Given a formatter that words a number as a strike, the axis is a strike axis,
// and the crosshair, the legend readout, the zoom and the pan come with it rather than being
// written again here.
//
// `mode: 'ordinal'` on top of that, because a listed chain is evenly spaced by listing rather
// than by the gaps between its numbers: a venue that lists 67000, 67250 and then 68000 means
// three rungs, not a hole.
import { formatPrice } from './formatters.js';
import { makeElement, makeIconButton, makePanelId, makePanelRoot } from './dom.js';
import { ControlTypes } from './control-types.js';
import { TradingHost, assertHost } from './trading-host.js';
import type { OptionChainContext, OptionSide, OptionStrike } from './option-desk-widget.js';
import {
    CrosshairMode, LineSeries, createChart,
    type CrosshairEvent, type IChartApi, type ISeriesApi, type LineData, type Time,
} from './chart-engine.js';

/// What the panel needs beyond the host port. Nothing: a smile is read, not acted on.
export interface OptionSmileDeps {
    host: TradingHost;
}

const LINE_WIDTH = 2;

/// The volatility a side is drawn at: what it last traded at, or the middle of its quote when it
/// has not traded. Null when neither is known - a strike nobody has quoted is a gap in the curve,
/// and a line drawn through it invents a quote nobody made.
export function sideVolatility(side: OptionSide | undefined): number | null {
    if (side === undefined || side === null) return null;

    const last = side.ivLast;
    if (typeof last === 'number' && isFinite(last) && last > 0) return last;

    const bid = side.ivBid;
    const ask = side.ivAsk;
    const quoted = [bid, ask].filter((v): v is number => typeof v === 'number' && isFinite(v) && v > 0);
    if (quoted.length === 0) return null;
    return quoted.reduce((sum, v) => sum + v, 0) / quoted.length;
}

/// The chain in the order it is drawn: by strike, lowest first, whatever order it arrived in.
export function sortedChain(strikes: readonly OptionStrike[]): OptionStrike[] {
    return [...strikes]
        .filter(row => row !== null && row !== undefined && isFinite(row.strike))
        .sort((a, b) => a.strike - b.strike);
}

/// One side as a series, and the strikes it was drawn at.
///
/// The x value is the strike itself rather than an index: the axis words it back through the
/// formatter, so the number on the wire and the number on the label are the same one and no
/// lookup can put them out of step.
export function toSmileSeries(chain: readonly OptionStrike[], put: boolean): LineData[] {
    const out: LineData[] = [];
    for (const row of chain) {
        const volatility = sideVolatility(put ? row.put : row.call);
        // Whitespace rather than a point: the engine keeps the rung on the axis and leaves the
        // line broken across it, which is what a strike quoted on one side only looks like.
        if (volatility === null) out.push({ time: row.strike as Time } as LineData);
        else out.push({ time: row.strike as Time, value: volatility * 100 });
    }
    return out;
}

export class OptionSmileWidget {
    static TYPE = ControlTypes.OptionSmile;

    rootEl: HTMLElement;
    // `//` rather than `///` from here down — see the note in positions-widget.
    _host: TradingHost;
    _closeBtn: HTMLElement | null;
    _resetBtn: HTMLElement | null;
    _emptyEl: HTMLElement | null;
    _chartEl: HTMLElement | null;
    _spotEl: HTMLElement | null;
    _hoverEl: HTMLElement | null;
    _chart: IChartApi | null;
    _call: ISeriesApi<LineData> | null;
    _put: ISeriesApi<LineData> | null;
    _strikes: OptionStrike[];
    _context: OptionChainContext;
    _resizeObserver: ResizeObserver | null;

    static create(hostEl: HTMLElement, state: Record<string, unknown>, deps: OptionSmileDeps): OptionSmileWidget {
        const host = assertHost(deps?.host, 'OptionSmileWidget');
        const root = OptionSmileWidget._buildRoot(host);
        root.id = makePanelId(OptionSmileWidget.TYPE);
        hostEl.appendChild(root);
        return new OptionSmileWidget(root, state || {}, deps);
    }

    static _buildRoot(host: TradingHost): HTMLElement {
        const title = host.t('OptionSmile');
        return makePanelRoot('option-smile-panel', title, [
            makeElement('div', 'panel-header', {}, [
                makeElement('span', '', {}, [title]),
                makeIconButton('bt-icon-btn option-smile-reset-btn', host.t('ResetView'), 'bi-arrow-clockwise', { type: 'button' }),
                makeIconButton('bt-icon-btn bt-icon-cancel panel-close-btn', host.t('ClosePanel'), 'bi-x', { type: 'button' }),
            ]),
            makeElement('div', 'panel-body', {}, [
                makeElement('div', 'option-smile-legend', {}, [
                    makeElement('span', 'option-smile-axis', {}, [host.t('ImpliedVolatility')]),
                    makeElement('span', 'option-smile-key', {}, [
                        makeElement('span', 'option-smile-dot option-smile-dot-call', {}, []),
                        host.t('Call'),
                    ]),
                    makeElement('span', 'option-smile-key', {}, [
                        makeElement('span', 'option-smile-dot option-smile-dot-put', {}, []),
                        host.t('Put'),
                    ]),
                    makeElement('span', 'option-smile-spot', {}, []),
                ]),
                makeElement('div', 'option-smile-chart', { role: 'img', 'aria-label': host.t('OptionChain') }, [
                    // Over the chart, not in the panel header: a reading about the point under the
                    // pointer belongs beside that point, and a host that lifts panel headers into a
                    // tab strip would otherwise write it into a tab title.
                    makeElement('div', 'option-smile-hover', {}, []),
                    makeElement('div', 'option-smile-empty', {}, [host.t('NoOptions')]),
                ]),
            ]),
        ]);
    }

    constructor(rootEl: HTMLElement, _state: Record<string, unknown>, deps: OptionSmileDeps) {
        this._host = assertHost(deps?.host, 'OptionSmileWidget');

        this.rootEl = rootEl;
        this._closeBtn = this.rootEl.querySelector('.panel-close-btn');
        this._resetBtn = this.rootEl.querySelector('.option-smile-reset-btn');
        this._emptyEl = this.rootEl.querySelector('.option-smile-empty');
        this._chartEl = this.rootEl.querySelector('.option-smile-chart');
        this._spotEl = this.rootEl.querySelector('.option-smile-spot');
        this._hoverEl = this.rootEl.querySelector('.option-smile-hover');
        this._chart = null;
        this._call = null;
        this._put = null;
        this._strikes = [];
        this._context = {};
        this._resizeObserver = null;

        this._closeBtn?.addEventListener('click', (e) => { e.preventDefault(); this._host.close(); });
        this._resetBtn?.addEventListener('click', (e) => { e.preventDefault(); this.resetZoom(); });

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
        this._call = null;
        this._put = null;
        this._host.unregister(this);
        try { this.rootEl.remove(); } catch { /* already detached */ }
    }

    /// Show this chain, priced against this context.
    ///
    /// The desk's two arguments unchanged, and for the same reason it takes them together: they
    /// are one observation. A smile marked with a spot the curves never saw is two moments.
    update(strikes: OptionStrike[], context: OptionChainContext = {}): void {
        this._strikes = strikes || [];
        this._context = context || {};
        this._render();
    }

    /// Show the whole chain again, after a zoom.
    resetZoom(): void {
        try { this._chart?.timeScale().fitContent(); } catch { /* no chart yet */ }
    }

    /// The engine, for a host that wants to add to this chart - a second expiry, a marker.
    chart(): IChartApi | null {
        return this._chart;
    }

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
                // Evenly spaced by listing, and worded as strikes: the axis carries the strike
                // itself, so the label and the value can never drift apart.
                mode: 'ordinal',
                formatter: (value: Time) => formatPrice(Number(value)),
            },
        });

        this._call = this._chart.addSeries(LineSeries, { lineWidth: LINE_WIDTH, color: palette.up });
        this._put = this._chart.addSeries(LineSeries, { lineWidth: LINE_WIDTH, color: palette.down });
        this._chart.subscribeCrosshairMove((param) => this._renderHover(param));
        return true;
    }

    _render(): void {
        const chain = sortedChain(this._strikes);
        const quoted = chain.some(row =>
            sideVolatility(row.call) !== null || sideVolatility(row.put) !== null);

        if (this._emptyEl !== null) this._emptyEl.hidden = quoted;
        this._renderSpot();
        if (!quoted) return;
        if (!this._ensureChart() || this._call === null || this._put === null) return;

        this._call.setData(toSmileSeries(chain, false));
        this._put.setData(toSmileSeries(chain, true));
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

    // Where the money is. Not a line on the chart: an ordinal axis has a rung per listed strike
    // and the spot is between two of them, so it is stated rather than drawn at a place the
    // ladder does not have.
    _renderSpot(): void {
        const el = this._spotEl;
        if (el === null) return;

        const spot = this._context.assetPrice;
        if (typeof spot !== 'number' || !isFinite(spot)) {
            el.textContent = '';
            return;
        }
        el.textContent = `${this._host.t('Underlying')} ${formatPrice(spot)}`;
    }

    // What the pointer is over: the strike and both sides at it. Both, because a smile is read by
    // the distance between the two curves - a readout naming one of them answers half of it.
    _renderHover(param: CrosshairEvent): void {
        const el = this._hoverEl;
        if (el === null) return;

        if (param.time === null) {
            el.textContent = '';
            return;
        }

        const at = (series: ISeriesApi<LineData> | null): string => {
            const point = series === null ? undefined : param.seriesData.get(series);
            const value = (point as { value?: number } | undefined)?.value;
            return typeof value === 'number' && isFinite(value) ? `${value.toFixed(2)}%` : '--';
        };

        el.textContent = `${formatPrice(Number(param.time))}  ${at(this._call)} / ${at(this._put)}`;
    }
}
