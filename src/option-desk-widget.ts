// Option desk — multi-instance.
//
// One expiry of a chain, strike by strike: the call's side on the left, the put's mirrored on
// the right, and the strike between them. Every figure a trader compares across the strip -
// volume, open interest, volatility - carries a bar as well as a number, because a chain is
// read by shape first and by value second.
//
// Two scales, and the difference matters. Volume and open interest are scaled per side, since
// calls and puts trade in different sizes and comparing a call's volume against the busiest put
// says nothing. Volatility is scaled across BOTH sides at once - a skew is exactly the
// comparison between them, and two independent scales would flatten it.
//
// Greeks arrive one of two ways. A host that computes them sends them and the desk shows what
// it was given; a host that sends volatility instead has them computed here, from the same
// Black-Scholes the desktop uses. Neither is a fallback for the other going wrong - they are
// two shapes of host, and which one a row came from is not the desk's business.
import { formatPrice, formatQty } from './formatters.js';
import { makeElement, makeIconButton, makePanelId, makePanelRoot } from './dom.js';
import { ControlTypes } from './control-types.js';
import { makeGridMenu } from './grid-menu.js';
import { TradingHost, assertHost } from './trading-host.js';
import { OptionTypes, greeks as computeGreeks, type Greeks } from './black-scholes.js';
import { DataGrid, GridColumn } from '@stocksharp/grids/source/data-grid';

/// One contract's side of a strike.
export interface OptionSide {
    symbol?: string;
    bid?: number | null;
    ask?: number | null;
    last?: number | null;
    /// What the venue says it is worth, when it says.
    theoretical?: number | null;
    volume?: number | null;
    openInterest?: number | null;
    /// Implied volatility as a fraction, by the price it was solved from.
    ivBid?: number | null;
    ivAsk?: number | null;
    ivLast?: number | null;
    historicalVolatility?: number | null;
    /// Sent by a host that computes them. Left out, they are computed from `iv` below.
    greeks?: Greeks;
}

/// One strike, both sides of it.
export interface OptionStrike {
    strike: number;
    call: OptionSide;
    put: OptionSide;
}

/// What the chain is priced against. Without it the desk still shows quotes, and shows no
/// greeks: they are not a property of the option alone.
export interface OptionChainContext {
    /// The underlying's price.
    assetPrice?: number | null;
    /// Years to expiry.
    timeToExpiry?: number | null;
    riskFree?: number;
    dividend?: number;
}

export interface OptionDeskDeps {
    host: TradingHost;
}

interface DeskRow extends OptionStrike {
    /// Bar scales, resolved once per refresh over the whole chain rather than per row.
    maxCallVolume: number;
    maxPutVolume: number;
    maxCallOpenInterest: number;
    maxPutOpenInterest: number;
    maxVolatility: number;
    /// What the option is worth if exercised now. Zero for a strike out of the money.
    callIntrinsic: number;
    putIntrinsic: number;
}

export class OptionDeskWidget {
    static TYPE = ControlTypes.OptionDesk;

    rootEl: HTMLElement;
    el: HTMLElement | null;
    // `//` rather than `///` from here down — see the note in positions-widget.
    _host: TradingHost;
    _closeBtn: HTMLElement | null;
    _exportBtn: HTMLElement | null;
    _rows: DeskRow[];
    _context: OptionChainContext;
    _places: Record<keyof Greeks, number>;
    _grid: DataGrid<DeskRow> | null;

    static create(hostEl: HTMLElement, state: Record<string, unknown>, deps: OptionDeskDeps): OptionDeskWidget {
        const host = assertHost(deps?.host, 'OptionDeskWidget');
        const root = OptionDeskWidget._buildRoot(host);
        root.id = makePanelId(OptionDeskWidget.TYPE);
        hostEl.appendChild(root);
        return new OptionDeskWidget(root, state || {}, deps);
    }

    static _buildRoot(host: TradingHost): HTMLElement {
        const title = host.t('OptionDesk');
        return makePanelRoot('option-desk-panel', title, [
            makeElement('div', 'panel-header', {}, [
                makeElement('span', '', {}, [title]),
                makeIconButton('bt-icon-btn bt-icon-cancel panel-close-btn', host.t('ClosePanel'), 'bi-x', { type: 'button' }),
            ]),
            makeElement('div', 'panel-body panel-body-with-rail', {}, [
                makeElement('div', 'panel-body-content', {}, [
                    makeElement('table', 'terminal-table option-desk-table', { role: 'table', 'aria-label': host.t('OptionChain') }, [
                        makeElement('thead', '', {}, []),
                        makeElement('tbody', 'option-desk-body', {}, []),
                    ]),
                ]),
                makeElement('div', 'panel-rail', { role: 'toolbar', 'aria-label': host.t('OptionDeskActions') }, [
                    makeIconButton('bt-icon-btn panel-export-btn', host.t('ExportToExcel'), 'bi-file-earmark-spreadsheet', {}),
                ]),
            ]),
        ]);
    }

    constructor(rootEl: HTMLElement, _state: Record<string, unknown>, deps: OptionDeskDeps) {
        this._host = assertHost(deps?.host, 'OptionDeskWidget');

        this.rootEl = rootEl;
        this.el = this.rootEl.querySelector('.option-desk-body');
        this._closeBtn = this.rootEl.querySelector('.panel-close-btn');
        this._exportBtn = this.rootEl.querySelector('.panel-export-btn');
        this._rows = [];
        this._context = {};
        this._places = greekScales([], {});

        this._closeBtn?.addEventListener('click', (e) => { e.preventDefault(); this._host.close(); });
        this._exportBtn?.addEventListener('click', (e) => { e.preventDefault(); this._export(); });

        const head = this.rootEl.querySelector('.option-desk-table thead');
        this._grid = head && this.el
            ? new DataGrid<DeskRow>({
                head: head as HTMLElement,
                body: this.el,
                columns: this._columns(),
                // By strike, ascending. A chain has exactly one order and it is not negotiable:
                // the strip is read as a ladder, and re-sorting it by any column destroys that.
                defaultSort: { col: 'strike', dir: 'asc' },
                rowKey: (r) => String(r.strike),
                emptyText: this._host.t('NoOptions'),
                rowClass: (r) => this._rowClass(r),
                contextMenu: makeGridMenu(this._host),
                selection: 'multi',
            })
            : null;

        // The greeks and the far volatilities are there when wanted and out of the way when not:
        // a desk is read across, and thirty-six columns at once cannot be.
        this._grid?.setState({
            hidden: [
                'callRho', 'callTheta', 'callHv', 'callTheor',
                'putRho', 'putTheta', 'putHv', 'putTheor',
            ],
        });

        this._host.register(this);
    }

    dispose(): void {
        this._grid?.destroy();
        this._host.unregister(this);
        try { this.rootEl.remove(); } catch { /* already detached */ }
    }

    /// Show this chain, priced against this context.
    ///
    /// Both together, always: a chain and the underlying it is priced off are one observation,
    /// and refreshing them separately shows greeks computed from a price that has moved.
    update(strikes: OptionStrike[], context: OptionChainContext = {}): void {
        this._context = context ?? {};
        this._rows = scaleChain(strikes ?? [], this._context);
        this._places = greekScales(this._rows, this._context);
        this._grid?.setRows(this._rows);
    }

    /// The rows as the desk holds them, scales and intrinsic values resolved.
    rows(): readonly DeskRow[] {
        return this._rows;
    }

    _export(): void {
        this._grid?.download('option-chain', this._host.t('OptionDesk'));
    }

    // Which side of the money this strike is on. A chain is read from the money outwards, and
    // the line between the two halves is what a reader finds first.
    _rowClass(row: DeskRow): string {
        const asset = this._context.assetPrice;
        if (asset === null || asset === undefined) return 'option-row';
        return `option-row ${row.strike < asset ? 'option-itm-call' : 'option-itm-put'}`;
    }

    _columns(): GridColumn<DeskRow>[] {
        const label = (key: string) => this._host.t(key);

        const side = (which: 'call' | 'put'): GridColumn<DeskRow>[] => {
            const prefix = which;
            const at = (r: DeskRow): OptionSide => r[which];
            const g = (r: DeskRow): Greeks | null => sideGreeks(r, which, this._context);

            return [
                { key: `${prefix}Rho`, header: label('Rho'), exportable: true, value: (r) => g(r)?.rho ?? null, render: (r) => decimals(g(r)?.rho, this._places.rho) },
                { key: `${prefix}Theta`, header: label('Theta'), exportable: true, value: (r) => g(r)?.theta ?? null, render: (r) => decimals(g(r)?.theta, this._places.theta) },
                { key: `${prefix}Vega`, header: label('Vega'), exportable: true, value: (r) => g(r)?.vega ?? null, render: (r) => decimals(g(r)?.vega, this._places.vega) },
                { key: `${prefix}Gamma`, header: label('Gamma'), exportable: true, value: (r) => g(r)?.gamma ?? null, render: (r) => decimals(g(r)?.gamma, this._places.gamma) },
                { key: `${prefix}Delta`, header: label('Delta'), exportable: true, value: (r) => g(r)?.delta ?? null, render: (r) => decimals(g(r)?.delta, this._places.delta) },
                { key: `${prefix}Bid`, header: label('Bid'), exportable: true, cellClass: () => 'option-bid', value: (r) => at(r).bid ?? null, render: (r) => price(at(r).bid) },
                { key: `${prefix}Ask`, header: label('Ask'), exportable: true, cellClass: () => 'option-ask', value: (r) => at(r).ask ?? null, render: (r) => price(at(r).ask) },
                { key: `${prefix}Theor`, header: label('TheorPrice'), exportable: true, value: (r) => at(r).theoretical ?? null, render: (r) => price(at(r).theoretical) },
                {
                    key: `${prefix}Volume`, header: label('Volume'), exportable: true,
                    value: (r) => at(r).volume ?? 0,
                    render: (r) => this._bar(at(r).volume, which === 'call' ? r.maxCallVolume : r.maxPutVolume, which, formatQty(at(r).volume ?? 0)),
                    exportValue: (r) => at(r).volume ?? 0,
                },
                {
                    key: `${prefix}Oi`, header: label('OI'), exportable: true,
                    value: (r) => at(r).openInterest ?? 0,
                    render: (r) => this._bar(at(r).openInterest, which === 'call' ? r.maxCallOpenInterest : r.maxPutOpenInterest, which, formatQty(at(r).openInterest ?? 0)),
                    exportValue: (r) => at(r).openInterest ?? 0,
                },
                { key: `${prefix}Symbol`, header: which === 'call' ? label('Call') : label('Put'), exportable: true, value: (r) => at(r).symbol ?? '' },
                {
                    key: `${prefix}IvBid`, header: label('IVBid'), exportable: true,
                    value: (r) => at(r).ivBid ?? null,
                    render: (r) => this._bar(at(r).ivBid, r.maxVolatility, 'iv', percent(at(r).ivBid)),
                    exportValue: (r) => at(r).ivBid ?? '',
                },
                {
                    key: `${prefix}IvAsk`, header: label('IVAsk'), exportable: true,
                    value: (r) => at(r).ivAsk ?? null,
                    render: (r) => this._bar(at(r).ivAsk, r.maxVolatility, 'iv', percent(at(r).ivAsk)),
                    exportValue: (r) => at(r).ivAsk ?? '',
                },
                {
                    key: `${prefix}IvLast`, header: label('IVLast'), exportable: true,
                    value: (r) => at(r).ivLast ?? null,
                    render: (r) => this._bar(at(r).ivLast, r.maxVolatility, 'iv', percent(at(r).ivLast)),
                    exportValue: (r) => at(r).ivLast ?? '',
                },
                {
                    key: `${prefix}Hv`, header: label('HV'), exportable: true,
                    value: (r) => at(r).historicalVolatility ?? null,
                    render: (r) => this._bar(at(r).historicalVolatility, r.maxVolatility, 'iv', percent(at(r).historicalVolatility)),
                    exportValue: (r) => at(r).historicalVolatility ?? '',
                },
            ];
        };

        // Declared outward from the strike: volatilities and quotes against the middle, where
        // the two sides are compared, and the greeks out at the edges. The put side is that
        // same order reflected, which is what makes the chain a mirror rather than a repeat.
        const puts = side('put').slice().reverse();

        return [
            ...side('call'),
            {
                key: 'strike',
                header: label('Strike'),
                exportable: true,
                cellClass: () => 'option-strike',
                value: (r) => r.strike,
                render: (r) => price(r.strike),
            },
            {
                key: 'intrinsic',
                header: label('IntrinsicValue'),
                exportable: true,
                cellClass: () => 'option-intrinsic',
                // Whichever side is in the money at this strike; the other is worth nothing to
                // exercise, and showing both would be one number and one zero on every row.
                value: (r) => Math.max(r.callIntrinsic, r.putIntrinsic),
                render: (r) => price(Math.max(r.callIntrinsic, r.putIntrinsic)),
            },
            ...puts,
        ];
    }

    // A figure with its share of the strip behind it. The bar is a width, not a drawing: it
    // scales with the cell, it prints, and it needs no canvas per row.
    _bar(value: number | null | undefined, max: number, kind: 'call' | 'put' | 'iv', text: string): string | Node {
        if (value === null || value === undefined || !isFinite(value) || value <= 0) return text;

        const cell = document.createElement('span');
        cell.className = 'option-bar-cell';

        const bar = document.createElement('span');
        bar.className = `option-bar option-bar-${kind}`;
        bar.style.width = `${Math.min(100, (value / (max || 1)) * 100).toFixed(1)}%`;
        cell.appendChild(bar);

        const label = document.createElement('span');
        label.className = 'option-bar-text';
        label.textContent = text;
        cell.appendChild(label);

        return cell;
    }
}

/// Resolve the bar scales and the intrinsic values over a whole chain.
///
/// One pass over every strike, not one per row: a bar means "this much of the busiest strike",
/// and a scale computed per row would make every row its own maximum.
export function scaleChain(strikes: readonly OptionStrike[], context: OptionChainContext): DeskRow[] {
    const asset = context.assetPrice ?? null;

    const maxOf = (pick: (s: OptionSide) => number | null | undefined, sides: (r: OptionStrike) => OptionSide[]): number =>
        Math.max(0, ...strikes.flatMap(r => sides(r).map(s => pick(s) ?? 0)).filter(v => isFinite(v)));

    const maxCallVolume = maxOf(s => s.volume, r => [r.call]);
    const maxPutVolume = maxOf(s => s.volume, r => [r.put]);
    const maxCallOpenInterest = maxOf(s => s.openInterest, r => [r.call]);
    const maxPutOpenInterest = maxOf(s => s.openInterest, r => [r.put]);

    // One scale across both sides: the comparison a skew IS, is the one between them.
    const maxVolatility = Math.max(
        maxOf(s => s.ivBid, r => [r.call, r.put]),
        maxOf(s => s.ivAsk, r => [r.call, r.put]),
        maxOf(s => s.ivLast, r => [r.call, r.put]),
        maxOf(s => s.historicalVolatility, r => [r.call, r.put]),
    );

    return strikes.map(row => ({
        ...row,
        maxCallVolume,
        maxPutVolume,
        maxCallOpenInterest,
        maxPutOpenInterest,
        maxVolatility,
        callIntrinsic: asset === null ? 0 : Math.max(0, asset - row.strike),
        putIntrinsic: asset === null ? 0 : Math.max(0, row.strike - asset),
    }));
}

/// The greeks for one side: the host's if it sent them, otherwise computed from its volatility.
///
/// Null when neither is possible - no volatility, or nothing to price against. A blank is the
/// honest answer there; a zero would read as a measured delta of nothing.
export function sideGreeks(row: OptionStrike, which: 'call' | 'put', context: OptionChainContext): Greeks | null {
    const side = row[which];
    if (side.greeks !== undefined) return side.greeks;

    const deviation = side.ivLast ?? side.ivBid ?? side.ivAsk ?? side.historicalVolatility ?? null;
    const assetPrice = context.assetPrice ?? null;
    const timeToExpiry = context.timeToExpiry ?? null;

    if (deviation === null || assetPrice === null || timeToExpiry === null) return null;

    return computeGreeks(which === 'call' ? OptionTypes.Call : OptionTypes.Put, {
        assetPrice,
        strike: row.strike,
        timeToExpiry,
        riskFree: context.riskFree ?? 0,
        dividend: context.dividend ?? 0,
        deviation,
    });
}

/// Every greek this desk can show. Order is the order a chain is read in, outwards from delta.
const GREEK_KEYS = ['delta', 'gamma', 'vega', 'theta', 'rho'] as const;

/// Three significant digits for the smallest figure in a column, within bounds a column can hold.
const GREEK_DIGITS = 4;
const GREEK_MIN_PLACES = 2;
const GREEK_MAX_PLACES = 8;

/// How many decimal places a column of greeks needs.
///
/// One count cannot serve every greek: a delta is about one, while a gamma on an underlying at
/// 60000 is about 0.00003, and the four places that suit the first show every strike of the
/// second as 0.0000 - a column that is present, aligned, and says nothing. So the count comes
/// from the numbers, sized to the smallest of them.
///
/// One count for the whole column, not per cell: a column of figures is read down its decimal
/// point, and a ragged one is read a cell at a time.
export function greekPlaces(values: readonly (number | null | undefined)[]): number {
    const scale = Math.min(...values
        .filter((v): v is number => typeof v === 'number' && isFinite(v) && v !== 0)
        .map(Math.abs));

    // Nothing measurable: a zero column is a zero column at any width.
    if (!isFinite(scale)) return GREEK_MIN_PLACES;

    const places = GREEK_DIGITS - 1 - Math.floor(Math.log10(scale));
    return Math.min(GREEK_MAX_PLACES, Math.max(GREEK_MIN_PLACES, places));
}

/// The places for each greek, measured across both sides of the chain at once.
///
/// Across both sides deliberately: the desk mirrors, and a gamma written to eight places on the
/// left and five on the right stops being a mirror.
export function greekScales(rows: readonly OptionStrike[], context: OptionChainContext): Record<keyof Greeks, number> {
    const all = rows
        .flatMap(r => [sideGreeks(r, OptionTypes.Call, context), sideGreeks(r, OptionTypes.Put, context)])
        .filter((g): g is Greeks => g !== null);

    const places = {} as Record<keyof Greeks, number>;
    for (const key of GREEK_KEYS) places[key] = greekPlaces(all.map(g => g[key]));
    return places;
}

function decimals(value: number | null | undefined, places: number): string {
    if (value === null || value === undefined || !isFinite(value)) return '';
    return value.toFixed(places);
}

function price(value: number | null | undefined): string {
    if (value === null || value === undefined || !isFinite(value)) return '';
    return formatPrice(value);
}

/// A volatility, as the points a desk quotes it in rather than the fraction it is held as.
function percent(value: number | null | undefined): string {
    if (value === null || value === undefined || !isFinite(value)) return '';
    return `${(value * 100).toFixed(2)}%`;
}
