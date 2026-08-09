// Trade history — multi-instance.
//
// Read-only table of executed trades for the active portfolio. Builds its own
// DOM (see `_buildRoot`) rather than cloning a <template> out of the page, so
// it can be constructed by any host that supplies a `TradingHost`.
//
// Which portfolio to load and what to load it through both come off the host's
// trading context rather than being read out of a singleton here: the panel
// renders what it is given, and the host decides what "the active portfolio"
// means.
//
// The table is `DataGrid` from `@stocksharp/grids`: the columns below are this
// blotter's single declaration and the <thead> is left empty for the grid to
// fill.
import { formatPrice, formatQty, formatTime } from './formatters.js';
import { makeElement, makeIconButton, makePanelId, makePanelRoot } from './dom.js';
import { ControlTypes } from './control-types.js';
import { makeGridMenu } from './grid-menu.js';
import { TradingHost, assertHost } from './trading-host.js';
import type { TradeRow } from './trading-data.js';
import { DataGrid, GridColumn } from '@stocksharp/grids/source/data-grid';

/// The panel needs nothing beyond the host port: its data source, its
/// portfolio and its lifecycle all arrive through it.
export interface TradeHistoryDeps {
    host: TradingHost;
}

export class TradeHistoryWidget {
    static TYPE = ControlTypes.TradeHistory;

    rootEl: HTMLElement;
    bodyEl: HTMLElement | null;
    // `//` rather than `///` from here down — see the note in positions-widget.
    _host: TradingHost;
    _closeBtn: HTMLElement | null;
    _refreshBtn: HTMLElement | null;
    _exportBtn: HTMLElement | null;
    _rows: TradeRow[];
    _grid: DataGrid<TradeRow> | null;

    static create(hostEl: HTMLElement, state: Record<string, unknown>, deps: TradeHistoryDeps): TradeHistoryWidget {
        // Assert before building: the markup below is localized through the
        // host, so a missing host has to fail here rather than render a panel
        // captioned with raw English keys.
        const host = assertHost(deps?.host, 'TradeHistoryWidget');
        const root = TradeHistoryWidget._buildRoot(host);
        root.id = makePanelId(TradeHistoryWidget.TYPE);
        hostEl.appendChild(root);
        return new TradeHistoryWidget(root, state || {}, deps);
    }

    // The panel's markup. The host stylesheet reads this structure, and a
    // docking host lifts `.panel-header`'s children into its tab strip.
    static _buildRoot(host: TradingHost): HTMLElement {
        const title = host.t('TradeHistory');
        return makePanelRoot('trade-history-panel', title, [
            makeElement('div', 'panel-header', {}, [
                makeElement('span', '', {}, [title]),
                makeIconButton('bt-icon-btn bt-icon-cancel panel-close-btn', host.t('ClosePanel'), 'bi-x', { type: 'button' }),
            ]),
            makeElement('div', 'panel-body panel-body-with-rail', {}, [
                makeElement('div', 'panel-body-content', {}, [
                    makeElement('table', 'terminal-table trade-history-table', { role: 'table', 'aria-label': host.t('TradeHistoryList') }, [
                        makeElement('thead', '', {}, []),
                        makeElement('tbody', 'trade-history-body', {}, []),
                    ]),
                ]),
                makeElement('div', 'panel-rail', { role: 'toolbar', 'aria-label': host.t('TradeHistoryActions') }, [
                    makeIconButton('bt-icon-btn panel-refresh-btn', host.t('Refresh'), 'bi-arrow-clockwise', {}),
                    makeIconButton('bt-icon-btn panel-export-btn', host.t('ExportToExcel'), 'bi-file-earmark-spreadsheet', {}),
                ]),
            ]),
        ]);
    }

    constructor(rootEl: HTMLElement, _state: Record<string, unknown>, deps: TradeHistoryDeps) {
        this._host = assertHost(deps?.host, 'TradeHistoryWidget');

        this.rootEl = rootEl;
        this.bodyEl = this.rootEl.querySelector('.trade-history-body');
        this._closeBtn = this.rootEl.querySelector('.panel-close-btn');
        this._refreshBtn = this.rootEl.querySelector('.panel-refresh-btn');
        this._exportBtn = this.rootEl.querySelector('.panel-export-btn');

        this._closeBtn?.addEventListener('click', (e) => {
            e.preventDefault();
            this.dispose();
            this._host.close();
        });
        this._refreshBtn?.addEventListener('click', (e) => {
            e.preventDefault();
            void this.refresh();
        });

        this._exportBtn?.addEventListener('click', (e) => {
            e.preventDefault();
            this._export();
        });

        this._rows = [];

        const head = this.rootEl.querySelector('.trade-history-table thead');
        this._grid = head && this.bodyEl
            ? new DataGrid<TradeRow>({
                head: head as HTMLElement,
                body: this.bodyEl,
                columns: this._columns(),
                // Most recent fill on top by default — the natural way to read a trade blotter.
                defaultSort: { col: 'time', dir: 'desc' },
                rowKey: (t) => String(t.id),
                emptyText: this._host.t('No trade history'),
                contextMenu: makeGridMenu(this._host),
                // Press to mark, drag or Shift to range, Ctrl to toggle, Ctrl+C
                // to copy — all the grid's own.
                selection: 'multi',
            })
            : null;

        this._host.register(this);
    }

    dispose(): void {
        // The grid holds document-level listeners (the copy shortcut) that
        // outlive a removed subtree — it has to be told, not just detached.
        this._grid?.destroy();
        this._host.unregister(this);
        try { this.rootEl.remove(); } catch { /* already detached */ }
    }

    /// Reload against whichever portfolio the host says is active right now.
    ///
    /// Two guards, and they are not the same one. No portfolio means there is
    /// nothing to show — a guest session has none. A portfolio the host will
    /// not `allow` reading means the session cannot make the call at all: this
    /// is somebody's executed trades, so a page that has a portfolio id lying
    /// around but no live credential must not fire the request and collect a
    /// 401 for it. The panel asks the host rather than inspecting a token,
    /// because what counts as a usable session is the host's to know.
    ///
    /// Order matters: the portfolio check runs first, so a session with no
    /// portfolio is simply quiet — `allow` is the one that may put a sign-in
    /// prompt on screen, and reaching it means the page did have an account to
    /// load.
    async refresh(): Promise<void> {
        const pf = this._host.trading.portfolioId();
        if (!pf || !this._grid) return;
        if (!this._host.allow('load trade history')) return;
        try {
            this._rows = await this._host.trading.api.getExecutions(pf, null, 200) || [];
            this._grid.setRows(this._rows);
        } catch (err) {
            // Through the port, not the console: this is the diagnostic the
            // user cannot see and support has to, and routing it here is also
            // what makes it assertable.
            this._host.log(`TradeHistoryWidget: failed to load trade history: ${err}`);
        }
    }

    // Export the table to .xlsx in the currently rendered (sorted) order.
    _export(): void {
        this._grid?.download('trades', this._host.t('TradeHistory'));
    }

    // The blotter's single column declaration. The two id columns read `#42` on
    // screen and export the bare number, so the sheet stays sortable as a number.
    _columns(): GridColumn<TradeRow>[] {
        // `label`, not `t` — every row lambda below already binds `t` as the
        // trade it is rendering, and a translator sharing that name would be
        // shadowed inside exactly the callbacks that read it.
        const label = (key: string) => this._host.t(key);
        const presentation = this._host.presentation;
        return [
            {
                key: 'id',
                header: label('ID'),
                exportable: true,
                value: (t) => t.id,
                render: (t) => '#' + t.id,
                cellClass: () => 'mono-id',
            },
            {
                key: 'time',
                header: label('Time'),
                exportable: true,
                value: (t) => t.executedAt || t.time,
                render: (t) => formatTime(t.executedAt || t.time),
                exportValue: (t) => formatTime(t.executedAt || t.time),
            },
            {
                key: 'symbol',
                header: label('Sym'),
                exportable: true,
                value: (t) => t.instrumentSymbol || t.symbol,
            },
            {
                key: 'side',
                header: label('Side'),
                exportable: true,
                value: (t) => t.side,
                render: (t) => presentation.sideText(t.side!),
                cellClass: (t) => presentation.sideClass(t.side!),
                exportValue: (t) => presentation.sideText(t.side!),
            },
            {
                key: 'quantity',
                header: label('Qty'),
                exportable: true,
                value: (t) => t.quantity,
                render: (t) => formatQty(t.quantity),
            },
            {
                key: 'price',
                header: label('Price'),
                exportable: true,
                value: (t) => t.price,
                render: (t) => formatPrice(t.price),
            },
            {
                key: 'order',
                header: label('Order'),
                exportable: true,
                value: (t) => t.order || t.orderId,
                render: (t) => '#' + (t.order || t.orderId || ''),
                cellClass: () => 'mono-id',
            },
        ];
    }
}
