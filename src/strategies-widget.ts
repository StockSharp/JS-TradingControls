// Strategies dashboard — multi-instance.
//
// A row per strategy: what state it is in, what it is trading, what it has done, and the
// controls to start it, stop it and flatten it. This is the panel a browser client exists for -
// the strategies run on a server and the page is how someone reaches them.
//
// Three deliberate departures from the desktop version, each because copying it would carry a
// defect across. Its Settings button is wired to a disabled command in both shipped hosts, so a
// viewer sees a permanently dead control - that button is not here, and the rest are declared
// through deps, so a host that cannot do a thing does not show a button for it. Its P&L
// sparkline is filled green unconditionally, which paints a losing run in the winning colour;
// here the curve is coloured by where the run ended. And its P&L change is measured from the
// first non-zero P&L and never re-anchored, so a restarted strategy keeps measuring from before
// the restart; here the consumer states the number it means.
import { formatPnl, formatQty } from './formatters.js';
import { makeElement, makeIconButton, makePanelId, makePanelRoot } from './dom.js';
import { ControlTypes } from './control-types.js';
import { makeGridMenu } from './grid-menu.js';
import { TradingHost, assertHost } from './trading-host.js';
import { drawPnlCurve, pnlCurve, type PnlPoint } from './pnl-curve.js';
import { DataGrid, GridColumn } from '@stocksharp/grids/source/data-grid';

/// The states a strategy moves through, as the wire spells them.
export const StrategyStates = {
    Stopped: 'stopped',
    Starting: 'starting',
    Started: 'started',
    Stopping: 'stopping',
} as const;

export type StrategyState = typeof StrategyStates[keyof typeof StrategyStates];

/// One strategy, as the dashboard reads it.
export interface StrategyRow {
    id: string;
    name: string;
    state: StrategyState | string;
    /// Whether it is both formed and connected. Two conditions the desktop ANDs into one
    /// indicator, and the consumer does the same here: a half-online strategy is not online.
    online?: boolean;
    /// What it is allowed to do. The one editable cell.
    tradingMode?: string;
    portfolio?: string;
    security?: string;
    position?: number | null;
    ordersCount?: number | null;
    tradesCount?: number | null;
    /// Change against whatever the consumer anchors to.
    pnlChange?: number | null;
    realized?: number | null;
    unrealized?: number | null;
    /// The cumulative P&L curve, sampled at the points it changed.
    pnl?: PnlPoint[];
    /// The last thing that went wrong, if anything has.
    error?: string;
}

/// What a host can let someone do to a strategy. Every one optional and independently so: a
/// read-only dashboard passes none and shows no buttons, and a host that can start and stop but
/// not open shows exactly those two.
export interface StrategiesActions {
    start?(id: string): void;
    stop?(id: string): void;
    closePosition?(id: string): void;
    openStrategy?(id: string): void;
    riskRules?(id: string): void;
    setTradingMode?(id: string, mode: string): void;
}

export interface StrategiesDeps extends StrategiesActions {
    host: TradingHost;
    /// The trading modes a strategy can be put in, in the order they should be offered.
    ///
    /// Each is worded through `t()`, so these strings are also translation keys - and they are
    /// the host's own, not the package's: they name what this host can put a run in, so they are
    /// absent from `translation-keys.json` and the host answers for them itself.
    tradingModes?: readonly string[];
}

const SPARK_WIDTH = 140;
const SPARK_HEIGHT = 26;

export class StrategiesWidget {
    static TYPE = ControlTypes.Strategies;

    rootEl: HTMLElement;
    el: HTMLElement | null;
    // `//` rather than `///` from here down — see the note in positions-widget.
    _host: TradingHost;
    _deps: StrategiesDeps;
    _closeBtn: HTMLElement | null;
    _exportBtn: HTMLElement | null;
    _rows: StrategyRow[];
    _grid: DataGrid<StrategyRow> | null;

    static create(hostEl: HTMLElement, state: Record<string, unknown>, deps: StrategiesDeps): StrategiesWidget {
        const host = assertHost(deps?.host, 'StrategiesWidget');
        const root = StrategiesWidget._buildRoot(host);
        root.id = makePanelId(StrategiesWidget.TYPE);
        hostEl.appendChild(root);
        return new StrategiesWidget(root, state || {}, deps);
    }

    static _buildRoot(host: TradingHost): HTMLElement {
        const title = host.t('Strategies');
        return makePanelRoot('strategies-panel', title, [
            makeElement('div', 'panel-header', {}, [
                makeElement('span', '', {}, [title]),
                makeIconButton('bt-icon-btn bt-icon-cancel panel-close-btn', host.t('ClosePanel'), 'bi-x', { type: 'button' }),
            ]),
            makeElement('div', 'panel-body panel-body-with-rail', {}, [
                makeElement('div', 'panel-body-content', {}, [
                    makeElement('table', 'terminal-table strategies-table', { role: 'table', 'aria-label': host.t('StrategiesList') }, [
                        makeElement('thead', '', {}, []),
                        makeElement('tbody', 'strategies-body', {}, []),
                    ]),
                ]),
                makeElement('div', 'panel-rail', { role: 'toolbar', 'aria-label': host.t('StrategiesActions') }, [
                    makeIconButton('bt-icon-btn panel-export-btn', host.t('ExportToExcel'), 'bi-file-earmark-spreadsheet', {}),
                ]),
            ]),
        ]);
    }

    constructor(rootEl: HTMLElement, _state: Record<string, unknown>, deps: StrategiesDeps) {
        this._host = assertHost(deps?.host, 'StrategiesWidget');
        this._deps = deps;

        this.rootEl = rootEl;
        this.el = this.rootEl.querySelector('.strategies-body');
        this._closeBtn = this.rootEl.querySelector('.panel-close-btn');
        this._exportBtn = this.rootEl.querySelector('.panel-export-btn');
        this._rows = [];

        this._closeBtn?.addEventListener('click', (e) => { e.preventDefault(); this._host.close(); });
        this._exportBtn?.addEventListener('click', (e) => { e.preventDefault(); this._export(); });

        const head = this.rootEl.querySelector('.strategies-table thead');
        this._grid = head && this.el
            ? new DataGrid<StrategyRow>({
                head: head as HTMLElement,
                body: this.el,
                columns: this._columns(),
                // By name: a dashboard is a list someone reads down looking for one strategy,
                // and a list that reorders itself as P&L moves cannot be read that way.
                defaultSort: { col: 'name', dir: 'asc' },
                rowKey: (s) => String(s.id),
                emptyText: this._host.t('NoStrategies'),
                rowClass: (s) => `strategy-row strategy-${s.state}${s.error ? ' strategy-failed' : ''}`,
                contextMenu: makeGridMenu(this._host),
                selection: 'multi',
            })
            : null;

        this._host.register(this);
    }

    dispose(): void {
        this._grid?.destroy();
        this._host.unregister(this);
        try { this.rootEl.remove(); } catch { /* already detached */ }
    }

    /// Show these strategies. The whole set: one that is gone from it has been removed, and
    /// leaving its row behind would offer a Stop for something that no longer runs.
    update(rows: StrategyRow[]): void {
        this._rows = rows || [];
        this._grid?.setRows(this._rows);
    }

    _export(): void {
        this._grid?.download('strategies', this._host.t('Strategies'));
    }

    _columns(): GridColumn<StrategyRow>[] {
        const label = (key: string) => this._host.t(key);
        const presentation = this._host.presentation;

        return [
            {
                key: 'state',
                header: label('State'),
                exportable: true,
                value: (s) => s.state,
                render: (s) => this._stateCell(s),
                cellClass: (s) => `strategy-state strategy-state-${s.state}`,
                exportValue: (s) => s.state,
            },
            {
                key: 'actions',
                header: label('Actions'),
                headerHidden: true,
                exportable: false,
                cellClass: () => 'strategy-actions',
                render: (s) => this._actionCell(s),
            },
            {
                key: 'online',
                header: label('Online'),
                exportable: true,
                value: (s) => (s.online ? 1 : 0),
                render: (s) => (s.online ? '●' : '○'),
                cellClass: (s) => (s.online ? 'strategy-online is-on' : 'strategy-online'),
                exportValue: (s) => (s.online ? label('Yes') : label('No')),
            },
            {
                key: 'tradingMode',
                header: label('Trading'),
                exportable: true,
                value: (s) => s.tradingMode ?? '',
                render: (s) => this._tradingCell(s),
                exportValue: (s) => s.tradingMode ?? '',
            },
            { key: 'name', header: label('Name'), exportable: true, value: (s) => s.name },
            { key: 'portfolio', header: label('Portfolio'), exportable: true, value: (s) => s.portfolio ?? '' },
            { key: 'security', header: label('Sym'), exportable: true, value: (s) => s.security ?? '' },
            {
                key: 'position',
                header: label('Position'),
                exportable: true,
                value: (s) => s.position ?? 0,
                render: (s) => this._positionCell(s),
                cellClass: (s) => `strategy-position ${presentation.pnlClass(s.position ?? 0)}`,
                exportValue: (s) => s.position ?? 0,
            },
            { key: 'orders', header: label('OrderCount'), exportable: true, value: (s) => s.ordersCount ?? 0 },
            { key: 'trades', header: label('NumOfTrades'), exportable: true, value: (s) => s.tradesCount ?? 0 },
            {
                key: 'pnlChange',
                header: label('PnLChange'),
                exportable: true,
                value: (s) => s.pnlChange ?? 0,
                render: (s) => `${direction(s.pnlChange ?? 0)} ${formatPnl(s.pnlChange ?? 0)}`,
                cellClass: (s) => presentation.pnlClass(s.pnlChange ?? 0),
                exportValue: (s) => s.pnlChange ?? 0,
            },
            {
                key: 'pnlChart',
                header: label('PnLChart'),
                exportable: false,
                cellClass: () => 'strategy-spark',
                render: (s) => this._sparkline(s),
            },
            {
                key: 'realized',
                header: label('RealizedProfit'),
                exportable: true,
                value: (s) => s.realized ?? 0,
                render: (s) => formatPnl(s.realized ?? 0),
                cellClass: (s) => presentation.pnlClass(s.realized ?? 0),
                exportValue: (s) => s.realized ?? 0,
            },
            {
                key: 'unrealized',
                header: label('UnrealizedProfit'),
                exportable: true,
                value: (s) => s.unrealized ?? 0,
                render: (s) => formatPnl(s.unrealized ?? 0),
                cellClass: (s) => presentation.pnlClass(s.unrealized ?? 0),
                exportValue: (s) => s.unrealized ?? 0,
            },
            {
                key: 'error',
                header: label('Error'),
                exportable: true,
                cellClass: () => 'strategy-error',
                value: (s) => s.error ?? '',
            },
        ];
    }

    // A dot and the state's own word. The dot is what is read across a list of twenty; the word
    // is what tells Starting from Started, which a colour alone cannot.
    _stateCell(row: StrategyRow): string | Node {
        const cell = document.createDocumentFragment();

        const failed = row.error !== undefined && row.error !== null && String(row.error).length > 0;

        const dot = document.createElement('span');
        dot.className = 'strategy-dot';
        dot.textContent = '●';
        // The reason sits on the dot as well as on the word: the dot is what a reader looks at
        // first, and a tooltip only the word carries is one nobody finds.
        if (failed) dot.title = String(row.error);
        cell.appendChild(dot);

        const text = document.createElement('span');
        text.className = 'strategy-state-text';
        // A run that stopped because something went wrong says so, rather than reading exactly
        // like one the user stopped and differing only by the colour of the dot. The colour is
        // the same statement made a second time, for a board too narrow to show the error
        // column; the word is what a reader gets first.
        text.textContent = failed && row.state === StrategyStates.Stopped
            ? this._host.t('Error')
            : stateText(this._host, row.state);
        if (failed) text.title = String(row.error);
        cell.appendChild(text);

        return cell;
    }

    // Only the buttons this host can actually carry out, and only where the state allows them.
    // A strategy that is already running has nothing to start.
    _actionCell(row: StrategyRow): Node {
        const cell = document.createDocumentFragment();
        const deps = this._deps;

        const add = (
            action: ((id: string) => void) | undefined,
            when: boolean,
            title: string,
            icon: string,
            cls: string,
        ): void => {
            if (action === undefined) return;

            const button = makeIconButton(`bt-icon-btn ${cls}`, title, icon, { type: 'button' }) as HTMLButtonElement;
            if (!when) button.disabled = true;
            else button.addEventListener('click', () => action.call(deps, row.id));
            cell.appendChild(button);
        };

        add(deps.start, row.state === StrategyStates.Stopped, this._host.t('Start'), 'bi-play-fill', 'strategy-start-btn');
        add(deps.stop, row.state === StrategyStates.Started, this._host.t('Stop'), 'bi-stop-fill', 'strategy-stop-btn');
        add(deps.riskRules, true, this._host.t('RiskManagement'), 'bi-shield-exclamation', 'strategy-risk-btn');
        add(deps.openStrategy, true, this._host.t('OpenStrategy'), 'bi-box-arrow-up-right', 'strategy-open-btn');

        return cell;
    }

    // The position, and next to it the one gesture that acts on it. Flattening is only
    // meaningful while the strategy runs and only when it holds something.
    _positionCell(row: StrategyRow): string | Node {
        const position = row.position ?? 0;
        const text = formatQty(position);
        if (this._deps.closePosition === undefined) return text;

        const cell = document.createDocumentFragment();
        // The figure sits in a box of a fixed least width, so the button beside it stays put
        // when a minus sign appears or a digit is dropped. Without it the whole column shifts
        // every time a position crosses zero.
        const value = makeElement('span', 'strategy-position-value', {}, [text]);
        cell.appendChild(value);

        const button = makeIconButton('bt-icon-btn strategy-flatten-btn', this._host.t('ClosePosition'), 'bi-x-octagon', { type: 'button' }) as HTMLButtonElement;
        if (row.state !== StrategyStates.Started || position === 0) button.disabled = true;
        else button.addEventListener('click', () => this._deps.closePosition?.(row.id));
        cell.appendChild(button);

        return cell;
    }

    // The one editable cell, and only when the host can carry the change out.
    _tradingCell(row: StrategyRow): string | Node {
        const modes = this._deps.tradingModes ?? [];
        if (this._deps.setTradingMode === undefined || modes.length === 0) return row.tradingMode ?? '';

        const select = document.createElement('select');
        select.className = 'form-control form-control-sm strategy-mode';
        // Only on a stopped run, the way start is only on a stopped one and stop only on a
        // started one: the mode is what the run will be started with, not a lever to pull while
        // it is trading.
        select.disabled = row.state !== StrategyStates.Stopped;
        for (const mode of modes) {
            const option = document.createElement('option');
            option.value = mode;
            option.textContent = this._host.t(mode);
            if (mode === row.tradingMode) option.selected = true;
            select.appendChild(option);
        }
        if (!select.disabled)
            select.addEventListener('change', () => this._deps.setTradingMode?.(row.id, select.value));
        return select;
    }

    // The run's own curve, at the size a cell has. Coloured by where it ended, which is the
    // whole reason a glance at the column tells one strategy from another.
    _sparkline(row: StrategyRow): string | Node {
        const box = { width: SPARK_WIDTH, height: SPARK_HEIGHT, padX: 1, padY: 2 };
        const curve = pnlCurve(row.pnl ?? [], box);
        if (curve === null) return '';

        const canvas = document.createElement('canvas');
        canvas.className = 'strategy-spark-canvas';

        // Two sizes, and they are not the same one. The backing store is in device pixels, so
        // a curve on a 2x screen is drawn at 2x; the CSS box stays the size the column has.
        // Sized only in CSS pixels, as this was, every stroke lands on half the pixels it
        // should and the whole sparkline reads as a smudge.
        const ratio = typeof window === 'undefined' ? 1 : (window.devicePixelRatio || 1);
        canvas.width = Math.round(box.width * ratio);
        canvas.height = Math.round(box.height * ratio);
        canvas.style.width = `${box.width}px`;
        canvas.style.height = `${box.height}px`;

        const ctx = canvas.getContext('2d');
        if (ctx !== null) {
            const palette = this._host.presentation.canvasPalette();
            const scaled = { width: canvas.width, height: canvas.height, padX: box.padX * ratio, padY: box.padY * ratio };
            drawPnlCurve(ctx, pnlCurve(row.pnl ?? [], scaled) ?? curve, scaled, {
                up: palette.up,
                down: palette.down,
                baseline: palette.grid,
                lineWidth: 1.5 * ratio,
                fillOpacity: 0.35,
            });
        }

        return canvas;
    }
}

/// What a state is called here.
///
/// Each key is a literal at the point it is asked for, rather than one value picked and then
/// translated: `translation-keys.json` is generated by scanning the sources for exactly that
/// shape, so a key assembled from a value never reaches the list, no host learns to translate
/// it, and it arrives at the user as itself.
function stateText(host: TradingHost, state: StrategyState | string): string {
    switch (state) {
        case StrategyStates.Started: return host.t('Started');
        case StrategyStates.Starting: return host.t('Starting');
        case StrategyStates.Stopping: return host.t('Stopping');
        default: return host.t('Stopped');
    }
}

/// Which way a figure moved, as one character. Blank for no change: an arrow that always points
/// somewhere says a strategy is moving when it is not.
function direction(value: number): string {
    if (value > 0) return '▲';
    if (value < 0) return '▼';
    return '';
}

