// Positions — multi-instance.
//
// Builds its own DOM (see `_buildRoot`) rather than cloning a <template> out of
// the page it happens to be rendered on, so it can be constructed by any host
// that supplies a `TradingHost`. Every instance shares the same data source
// (the host's refresh / a position update off the socket); the host broadcasts
// each update to every live instance so duplicates of the panel render in
// lockstep.
//
// The table is `DataGrid` from `@stocksharp/grids`: the columns below are this
// blotter's single declaration and the <thead> is left empty for the grid to
// fill. The cash balance is a pinned row — a different shape from a position,
// so it supplies its own cells, sits outside the sort and stays out of the
// exported sheet.
import { formatPnl, formatPrice } from './formatters.js';
import { makeElement, makeIconButton, makePanelId, makePanelRoot } from './dom.js';
import { ControlTypes } from './control-types.js';
import { makeGridMenu } from './grid-menu.js';
import { TradingHost, assertHost } from './trading-host.js';
import type { BalanceRow, PositionRow } from './trading-data.js';
import { DataGrid, GridColumn, GridPinnedRow, GridPinnedPlacements } from '@stocksharp/grids/source/data-grid';

/// Everything the blotter needs beyond the host port. All required: the action
/// buttons live in the cells and in the rail now, so a panel that cannot
/// close, reverse or reload a position is not this panel.
export interface PositionsDeps {
    host: TradingHost;
    closePosition(portfolioId: number, instrumentId: number, symbol: string): void;
    reversePosition(portfolioId: number, instrumentId: number, symbol: string): void;
    refreshPositions(): void;
}

export class PositionsWidget {
    static TYPE = ControlTypes.Positions;

    rootEl: HTMLElement;
    el: HTMLElement | null;
    // Comment style is `//` on purpose below the public members: the declaration
    // emitter keeps a private member's doc comment while dropping its body, so a
    // `///` here would reattach to the next public member in the API snapshot.
    _host: TradingHost;
    _deps: PositionsDeps;
    _closeBtn: HTMLElement | null;
    _refreshBtn: HTMLElement | null;
    _exportBtn: HTMLElement | null;
    _positions: PositionRow[];
    _balance: BalanceRow | null;
    _grid: DataGrid<PositionRow> | null;

    static create(hostEl: HTMLElement, state: Record<string, unknown>, deps: PositionsDeps): PositionsWidget {
        // Assert before building: the markup below is localized through the
        // host, so a missing host has to fail here rather than render a panel
        // captioned with raw English keys.
        const host = assertHost(deps?.host, 'PositionsWidget');
        const root = PositionsWidget._buildRoot(host);
        root.id = makePanelId(PositionsWidget.TYPE);
        hostEl.appendChild(root);
        return new PositionsWidget(root, state || {}, deps);
    }

    // The panel's markup. The host stylesheet reads this structure, and a
    // docking host lifts `.panel-header`'s children into its tab strip.
    //
    // The rail's refresh button is the one thing that could not come across
    // unchanged from the terminal's Razor template: it used to be an inline
    // `onclick="terminalApp.refreshPositions()"`, which is a reference to a
    // global this control must not have. It carries `.panel-refresh-btn` now —
    // the name the trade-history rail already gave the identical button — and
    // is wired to the `refreshPositions` dep.
    static _buildRoot(host: TradingHost): HTMLElement {
        const title = host.t('OpenPositions');
        return makePanelRoot('positions-panel', title, [
            makeElement('div', 'panel-header', {}, [
                makeElement('span', '', {}, [host.t('Positions')]),
                makeIconButton('bt-icon-btn bt-icon-cancel panel-close-btn', host.t('ClosePanel'), 'bi-x', { type: 'button' }),
            ]),
            makeElement('div', 'panel-body panel-body-with-rail', {}, [
                makeElement('div', 'panel-body-content', {}, [
                    makeElement('table', 'terminal-table positions-table', { role: 'table', 'aria-label': title }, [
                        makeElement('thead', '', {}, []),
                        makeElement('tbody', 'positions-body', {}, []),
                    ]),
                ]),
                makeElement('div', 'panel-rail', { role: 'toolbar', 'aria-label': host.t('PositionsActions') }, [
                    makeIconButton('bt-icon-btn panel-refresh-btn', host.t('Refresh'), 'bi-arrow-clockwise', {}),
                    makeIconButton('bt-icon-btn panel-export-btn', host.t('ExportToExcel'), 'bi-file-earmark-spreadsheet', {}),
                ]),
            ]),
        ]);
    }

    constructor(rootEl: HTMLElement, _state: Record<string, unknown>, deps: PositionsDeps) {
        this._host = assertHost(deps?.host, 'PositionsWidget');
        for (const name of ['closePosition', 'reversePosition', 'refreshPositions'] as const) {
            if (typeof deps?.[name] !== 'function')
                throw new Error(`PositionsWidget: dep "${name}" is required`);
        }

        this.rootEl = rootEl;
        this._deps = deps;
        this.el = this.rootEl.querySelector('.positions-body');
        this._closeBtn = this.rootEl.querySelector('.panel-close-btn');
        this._refreshBtn = this.rootEl.querySelector('.panel-refresh-btn');
        this._exportBtn = this.rootEl.querySelector('.panel-export-btn');
        this._positions = [];
        this._balance = null;

        this._closeBtn?.addEventListener('click', (e) => {
            e.preventDefault();
            this._host.close();
        });

        this._refreshBtn?.addEventListener('click', (e) => {
            e.preventDefault();
            this._deps.refreshPositions();
        });

        this._exportBtn?.addEventListener('click', (e) => {
            e.preventDefault();
            this._export();
        });

        const head = this.rootEl.querySelector('.positions-table thead');
        this._grid = head && this.el
            ? new DataGrid<PositionRow>({
                head: head as HTMLElement,
                body: this.el,
                columns: this._columns(),
                // Alphabetical by instrument at rest — a stable, predictable order (positions have no
                // natural "newest") the user can scan by symbol.
                defaultSort: { col: 'instrument', dir: 'asc' },
                // Same identity applyDelta matches on: id alone isn't unique (id=0 for
                // unsaved snapshots), and a portfolio can hold one position per instrument.
                rowKey: (p) => PositionsWidget._key(p),
                emptyText: this._host.t('No positions'),
                // Re-read on every render, so the cash figures track the live balance
                // without the widget having to repaint the position rows itself.
                pinnedRows: () => this._pinnedRows(),
                contextMenu: makeGridMenu(this._host),
                // Press to mark, drag or Shift to range, Ctrl to toggle, Ctrl+C
                // to copy — the pinned cash row stays outside the selection the
                // same way it stays outside the sort.
                selection: 'multi',
            })
            : null;

        this._host.register(this);

        // If the host already has a positions snapshot it will broadcast it on
        // demand; new instances start empty until the first refresh tick.
    }

    dispose(): void {
        // The grid holds document-level listeners (the copy shortcut) that
        // outlive a removed subtree — it has to be told, not just detached.
        this._grid?.destroy();
        this._host.unregister(this);
        try { this.rootEl.remove(); } catch { /* already detached */ }
    }

    update(positions: PositionRow[]): void {
        this._positions = positions || [];
        this._grid?.setRows(this._positions);
    }

    /// Null clears the pinned row — which is not the same as an all-zero
    /// balance, and reads differently: no row at all versus a row of zeros.
    updateBalance(balance: BalanceRow | null): void {
        this._balance = balance;
        this._grid?.render();
    }

    /// Apply a single position delta. Match by (portfolioId, instrumentId) — id
    /// alone isn't unique (id=0 for unsaved snapshots). Quantity hitting zero
    /// closes the row.
    applyDelta(position: PositionRow): void {
        if (!position) return;
        const idx = this._positions.findIndex(p =>
            p.portfolioId === position.portfolioId &&
            ((position.instrumentId != null && p.instrumentId === position.instrumentId) ||
             (position.instrumentId == null && p.instrument === position.instrument)));
        const closed = (position.quantity || 0) === 0;

        if (idx >= 0) {
            if (closed) this._positions.splice(idx, 1);
            else this._positions[idx] = { ...this._positions[idx], ...position };
        } else if (!closed) {
            this._positions.push(position);
        }
        this.update(this._positions);
    }

    // Export the table to .xlsx in the currently rendered (sorted) order. The
    // balance summary is a pinned row — a different shape from a position — so
    // the grid keeps it out of the sheet.
    _export(): void {
        this._grid?.download('positions', this._host.t('Positions'));
    }

    // The blotter's single column declaration: what the header says, what the
    // grid sorts on, what the cell shows, how it is coloured, and what reaches
    // the exported sheet. Prices are formatted on screen but exported raw, so
    // the sheet stays numeric.
    _columns(): GridColumn<PositionRow>[] {
        const label = (key: string) => this._host.t(key);
        return [
            {
                key: 'instrument',
                header: label('Symbol'),
                exportable: true,
                value: (p) => p.instrument,
            },
            {
                key: 'quantity',
                header: label('Qty'),
                exportable: true,
                value: (p) => p.quantity,
                cellClass: (p) => ((p.quantity ?? 0) > 0 ? 'side-buy' : 'side-sell'),
            },
            {
                key: 'avgPrice',
                header: label('AvgPrice'),
                exportable: true,
                value: (p) => p.avgPrice,
                render: (p) => formatPrice(p.avgPrice),
            },
            {
                key: 'currentPrice',
                header: label('Current'),
                exportable: true,
                value: (p) => p.currentPrice,
                render: (p) => formatPrice(p.currentPrice),
            },
            {
                key: 'pnl',
                header: label('PnL'),
                exportable: true,
                value: (p) => PositionsWidget._totalPnl(p),
                render: (p) => formatPnl(PositionsWidget._totalPnl(p)),
                cellClass: (p) => this._host.presentation.pnlClass(PositionsWidget._totalPnl(p)),
            },
            {
                key: 'actions',
                header: label('Actions'),
                headerHidden: true,
                exportable: false,
                cellClass: () => 'position-actions',
                render: (p) => this._actionButtons(p),
            },
        ];
    }

    // The cash balance, pinned above the positions. It does not share the shape
    // the position columns read, so it supplies its own cells; it is not a row
    // of data, so it is neither sorted nor exported. Being content, it also
    // suppresses the "no positions" row — a table showing a balance is not empty.
    _pinnedRows(): GridPinnedRow[] {
        const balance = this._balance;
        if (!balance) return [];

        const fmt = (v: number | null | undefined) => (v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        return [{
            key: 'balance',
            className: 'balance-row',
            place: GridPinnedPlacements.Top,
            cells: [
                { content: this._host.t('USD'), className: 'balance-ccy' },
                { content: '$' + fmt(balance.available), className: 'balance-available' },
                { content: this._host.t('Locked: ${0}', fmt(balance.locked)), className: 'balance-locked' },
                { content: '', className: '' },
                { content: '$' + fmt(balance.total), className: 'balance-total' },
            ],
        }];
    }

    // Realized and unrealized together — what the PnL column shows, sorts and
    // exports, so the three cannot drift apart.
    static _totalPnl(position: PositionRow): number {
        return (position.unrealizedPnl || 0) + (position.realizedPnl || 0);
    }

    static _key(position: PositionRow): string {
        return `${position.portfolioId}:${position.instrumentId ?? position.instrument}`;
    }

    // Close and reverse, wired to the controller through deps. Real buttons with
    // their own listeners — the symbol used to be interpolated into an inline
    // onclick attribute, which is why it needed quote-escaping first.
    _actionButtons(position: PositionRow): Node {
        const cell = document.createDocumentFragment();
        cell.appendChild(this._actionButton(
            'bt-icon-cancel', 'bi-x-circle',
            this._host.t('Close position'), this._host.t('Close position on {0}', position.instrument),
            () => this._deps.closePosition(position.portfolioId!, position.instrumentId!, position.instrument!)));
        cell.appendChild(this._actionButton(
            'bt-icon-reverse', 'bi-arrow-left-right',
            this._host.t('Reverse position'), this._host.t('Reverse position on {0}', position.instrument),
            () => this._deps.reversePosition(position.portfolioId!, position.instrumentId!, position.instrument!)));
        return cell;
    }

    _actionButton(styleClass: string, iconClass: string, title: string, label: string, onClick: () => void): HTMLButtonElement {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `bt-icon-btn ${styleClass}`;
        button.title = title;
        button.setAttribute('aria-label', label);
        const icon = document.createElement('i');
        icon.className = `bi ${iconClass}`;
        button.appendChild(icon);
        button.addEventListener('click', onClick);
        return button;
    }
}
