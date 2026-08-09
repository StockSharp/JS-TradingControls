// Active orders — multi-instance.
//
// Builds its own DOM (see `_buildRoot`) rather than cloning a <template> out of
// the page, so it can be constructed by any host that supplies a `TradingHost`.
// Every instance shares the same data source (a host refresh / an order update
// off the socket); each update fans through the host's broadcast so duplicates
// stay in sync.
//
// The table itself is `DataGrid` from `@stocksharp/grids`: the columns below are
// the single declaration of this blotter — caption, value, rendering, colour
// class and export all live together, and the <thead> is left empty for the
// grid to fill. Cells that hold a control return a real Node with its own
// listener, so nothing here reaches a global through an inline onclick
// attribute; the callbacks arrive as deps instead.
import { cleanRejectReason, formatPrice, formatQty } from './formatters.js';
import { makeElement, makeIconButton, makePanelId, makePanelRoot } from './dom.js';
import { ControlTypes } from './control-types.js';
import { makeGridMenu } from './grid-menu.js';
import { TradingHost, assertHost } from './trading-host.js';
import type { OrderRow } from './trading-data.js';
import { DataGrid, GridColumn } from '@stocksharp/grids/source/data-grid';

/// StockSharp order states as they arrive on the wire. The blotter branches on
/// them for row colour, for whether a cell can be edited in place and for what
/// the × button does, so they are named once here instead of appearing as bare
/// numbers at each branch.
export const OrderStates = {
    PendingRisk: 1,
    Sent: 2,
    Active: 3,
    PartiallyFilled: 4,
    Filled: 5,
    Rejected: 6,
    Cancelled: 7,
} as const;

/// What the blotter needs beyond the host port. All required: a panel that
/// cannot cancel, modify or reload its orders is not this panel.
export interface ActiveOrdersDeps {
    host: TradingHost;
    cancelOrder(orderId: number): void;
    dismissOrder(orderId: number): void;
    editOrderField(orderId: number, field: string): void;
    replaceOrder(orderId: number, quantity: number, limitPrice: number, stopPrice: number): void;
    cancelAllOrders(): void;
    refreshOrders(): void;
}

export class ActiveOrdersWidget {
    static TYPE = ControlTypes.ActiveOrders;

    rootEl: HTMLElement;
    el: HTMLElement | null;
    // `//` rather than `///` from here down — see the note in positions-widget.
    _host: TradingHost;
    _deps: ActiveOrdersDeps;
    _closeBtn: HTMLElement | null;
    _cancelAllBtn: HTMLElement | null;
    _refreshBtn: HTMLElement | null;
    _exportBtn: HTMLElement | null;
    _orders: OrderRow[];
    _grid: DataGrid<OrderRow> | null;

    static create(hostEl: HTMLElement, state: Record<string, unknown>, deps: ActiveOrdersDeps): ActiveOrdersWidget {
        // Assert before building: the markup below is localized through the
        // host, so a missing host has to fail here rather than render a panel
        // captioned with raw English keys.
        const host = assertHost(deps?.host, 'ActiveOrdersWidget');
        const root = ActiveOrdersWidget._buildRoot(host);
        root.id = makePanelId(ActiveOrdersWidget.TYPE);
        hostEl.appendChild(root);
        return new ActiveOrdersWidget(root, state || {}, deps);
    }

    // The panel's markup. The host stylesheet reads this structure, and a
    // docking host lifts `.panel-header`'s children into its tab strip.
    //
    // The rail's first two buttons are the ones that could not come across
    // unchanged from the terminal's Razor template: they were inline
    // `onclick="terminalApp.cancelAll()"` / `refreshOrders()`, references to a
    // global this control must not have. They carry `.panel-cancel-all-btn` and
    // `.panel-refresh-btn` now — the latter the name the other blotters' rails
    // already give the identical button — and are wired to deps. Cancel-all
    // keeps a distinct accessible name from its tooltip, which is why it states
    // `aria-label` rather than taking the tooltip for both.
    static _buildRoot(host: TradingHost): HTMLElement {
        return makePanelRoot('active-orders-panel', host.t('ActiveOrders'), [
            makeElement('div', 'panel-header', {}, [
                makeElement('span', '', {}, [host.t('OpenOrders')]),
                makeIconButton('bt-icon-btn bt-icon-cancel panel-close-btn', host.t('ClosePanel'), 'bi-x', { type: 'button' }),
            ]),
            makeElement('div', 'panel-body panel-body-with-rail', {}, [
                makeElement('div', 'panel-body-content', {}, [
                    makeElement('table', 'terminal-table active-orders-table', { role: 'table', 'aria-label': host.t('ActiveOrdersList') }, [
                        makeElement('thead', '', {}, []),
                        makeElement('tbody', 'active-orders-body', {}, []),
                    ]),
                ]),
                makeElement('div', 'panel-rail', { role: 'toolbar', 'aria-label': host.t('ActiveOrdersActions') }, [
                    makeIconButton('bt-icon-btn bt-icon-cancel-all panel-cancel-all-btn', host.t('CancelAll'), 'bi-x-circle',
                        { 'aria-label': host.t('CancelAllOrders') }),
                    makeIconButton('bt-icon-btn panel-refresh-btn', host.t('Refresh'), 'bi-arrow-clockwise', {}),
                    makeIconButton('bt-icon-btn panel-export-btn', host.t('ExportToExcel'), 'bi-file-earmark-spreadsheet', {}),
                ]),
            ]),
        ]);
    }

    constructor(rootEl: HTMLElement, _state: Record<string, unknown>, deps: ActiveOrdersDeps) {
        this._host = assertHost(deps?.host, 'ActiveOrdersWidget');
        for (const name of ['cancelOrder', 'dismissOrder', 'editOrderField', 'replaceOrder', 'cancelAllOrders', 'refreshOrders'] as const) {
            if (typeof deps?.[name] !== 'function')
                throw new Error(`ActiveOrdersWidget: dep "${name}" is required`);
        }

        this.rootEl = rootEl;
        this._deps = deps;
        this.el = this.rootEl.querySelector('.active-orders-body');
        this._closeBtn = this.rootEl.querySelector('.panel-close-btn');
        this._cancelAllBtn = this.rootEl.querySelector('.panel-cancel-all-btn');
        this._refreshBtn = this.rootEl.querySelector('.panel-refresh-btn');
        this._exportBtn = this.rootEl.querySelector('.panel-export-btn');
        this._orders = [];

        this._closeBtn?.addEventListener('click', (e) => {
            e.preventDefault();
            this._host.close();
        });

        this._cancelAllBtn?.addEventListener('click', (e) => {
            e.preventDefault();
            this._deps.cancelAllOrders();
        });

        this._refreshBtn?.addEventListener('click', (e) => {
            e.preventDefault();
            this._deps.refreshOrders();
        });

        this._exportBtn?.addEventListener('click', (e) => {
            e.preventDefault();
            this._export();
        });

        const head = this.rootEl.querySelector('.active-orders-table thead');
        this._grid = head && this.el
            ? new DataGrid<OrderRow>({
                head: head as HTMLElement,
                body: this.el,
                columns: this._columns(),
                // Newest order on top by default (localId is monotonic) — the resting view puts the
                // user's most recent actions where they look, instead of raw cache order. Natural
                // array order is "newest first" too (deltas unshift), but only by accident; any
                // header click re-renders the same array through the sorter.
                defaultSort: { col: 'id', dir: 'desc' },
                // The register tx, not the friendly localId shown in the ID column: it is what
                // cancel / replace / inline edit address an order by.
                rowKey: (o) => String(o.id),
                emptyText: this._host.t('NoActiveOrders'),
                // Terminal rows are greyed out so the live ones stay visually prominent.
                rowClass: (o) => ActiveOrdersWidget._rowClass(o),
                contextMenu: makeGridMenu(this._host),
            })
            : null;

        this._host.register(this);
    }

    dispose(): void {
        this._host.unregister(this);
        try { this.rootEl.remove(); } catch { /* already detached */ }
    }

    update(orders: OrderRow[]): void {
        this._orders = orders || [];
        this._grid?.setRows(this._orders);
    }

    // Export the table to .xlsx in the currently rendered (sorted) order, with the
    // same localized side/type/status texts the user sees on screen — the columns
    // carry both forms, so the sheet cannot drift from the table.
    _export(): void {
        this._grid?.download('orders', this._host.t('OpenOrders'));
    }

    /// Apply a single order delta from the feed. Insert if new, merge if known.
    /// Nothing drops out of the list: Filled and Cancelled rows stay so the user
    /// can watch an order's transitions instead of having a row vanish, and a
    /// Rejected row stays so its reason can be read on hover and dismissed
    /// explicitly through the × button.
    applyDelta(order: OrderRow): void {
        if (!order || order.id == null) return;
        const idx = this._orders.findIndex(o => o.id === order.id);
        if (idx >= 0)
            this._orders[idx] = { ...this._orders[idx], ...order };
        else
            this._orders.unshift(order);
        this.update(this._orders);
    }

    /// Remove a row from the local view without touching the server. Used by the
    /// × button on a terminal order (nothing left to cancel), and in any other
    /// client-side dismiss path.
    removeOrder(orderId: number): void {
        const idx = this._orders.findIndex(o => o.id === orderId);
        if (idx >= 0) {
            this._orders.splice(idx, 1);
            this.update(this._orders);
        }
    }

    getOrder(orderId: number): OrderRow | undefined {
        return this._orders.find(o => o.id === orderId);
    }

    startInlineEdit(orderId: number, field: 'quantity' | 'limitPrice' | 'stopPrice'): void {
        const order = this.getOrder(orderId);
        if (!order) return;
        // Addressed by the grid's row key (the register tx) and the column key, so
        // the edit lands on the right cell whatever the sort is. A lookup that
        // scanned the rendered ID column for the order id would never match, because
        // that column shows the friendly counter.
        const cell = this._grid?.cellElement(String(orderId), field);
        if (!cell || cell.querySelector('input')) return;
        const currentValue = order[field];
        const input = document.createElement('input');
        input.type = 'number';
        input.className = 'inline-edit-input';
        input.value = String(currentValue ?? '');
        input.step = field === 'quantity' ? '1' : '0.01';
        input.min = field === 'quantity' ? '1' : '0.01';
        cell.textContent = '';
        cell.appendChild(input);
        input.focus();
        input.select();
        const commit = () => {
            const newVal = parseFloat(input.value);
            if (isNaN(newVal) || newVal <= 0) { this.update(this._orders); return; }
            if (newVal === currentValue) { this.update(this._orders); return; }
            const updated = { quantity: order.quantity, limitPrice: order.limitPrice, stopPrice: order.stopPrice };
            updated[field] = newVal;
            this._deps.replaceOrder(orderId, updated.quantity!, updated.limitPrice!, updated.stopPrice!);
        };
        input.addEventListener('blur', commit);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
            if (e.key === 'Escape') { this.update(this._orders); }
        });
    }

    // The blotter's single column declaration: what the header says, what the
    // grid sorts on, what the cell shows, how it is coloured, and what reaches
    // the exported sheet.
    _columns(): GridColumn<OrderRow>[] {
        // `label`, not `t` — every row lambda below binds `o` for the order,
        // but keeping the translator under a name of its own reads clearer
        // next to the presentation object it sits beside.
        const label = (key: string) => this._host.t(key);
        const presentation = this._host.presentation;
        return [
            {
                key: 'id',
                header: label('ID'),
                exportable: true,
                // Per-user friendly counter (1, 2, 3, …) issued by the host. `o.id`
                // keeps the register tx for cancel / replace routing; `o.localId` is
                // just the badge the user wants to see. Rows cached from before the
                // counter shipped have no localId — fall back to id so they don't go
                // blank until the next snapshot replay reassigns one.
                value: (o) => o.localId ?? o.id,
            },
            {
                key: 'instrument',
                header: label('Sym'),
                exportable: true,
                value: (o) => o.instrument,
            },
            {
                key: 'side',
                header: label('Side'),
                exportable: true,
                value: (o) => o.side,
                render: (o) => presentation.sideText(o.side!),
                cellClass: (o) => presentation.sideClass(o.side!),
                exportValue: (o) => presentation.sideText(o.side!),
            },
            {
                key: 'type',
                header: label('Type'),
                exportable: true,
                value: (o) => o.type,
                render: (o) => presentation.typeText(o.type!, o.limitPrice!, o.stopPrice!),
                exportValue: (o) => presentation.typeText(o.type!, o.limitPrice!, o.stopPrice!),
            },
            {
                key: 'quantity',
                header: label('Qty'),
                exportable: true,
                value: (o) => o.quantity,
                render: (o) => formatQty(o.quantity),
                cellClass: (o) => ActiveOrdersWidget._editableClass(o, 'quantity'),
                bindCell: (td, o) => this._bindInlineEdit(td, o, 'quantity'),
            },
            {
                key: 'limitPrice',
                header: label('Price'),
                exportable: true,
                value: (o) => o.limitPrice,
                render: (o) => o.limitPrice ? formatPrice(o.limitPrice) : label('MKT'),
                cellClass: (o) => ActiveOrdersWidget._editableClass(o, 'limitPrice'),
                bindCell: (td, o) => this._bindInlineEdit(td, o, 'limitPrice'),
                exportValue: (o) => o.limitPrice ?? label('MKT'),
            },
            {
                key: 'stopPrice',
                header: label('Stop'),
                exportable: true,
                value: (o) => o.stopPrice,
                render: (o) => o.stopPrice ? formatPrice(o.stopPrice) : '--',
                cellClass: (o) => ActiveOrdersWidget._editableClass(o, 'stopPrice'),
                bindCell: (td, o) => this._bindInlineEdit(td, o, 'stopPrice'),
                exportValue: (o) => o.stopPrice ?? '',
            },
            {
                key: 'status',
                header: label('Status'),
                exportable: true,
                value: (o) => o.status,
                render: (o) => this._statusCell(o),
                exportValue: (o) => presentation.statusText(o.status!),
            },
            {
                key: 'actions',
                header: label('Actions'),
                headerHidden: true,
                exportable: false,
                cellClass: () => 'position-actions',
                render: (o) => this._actionButton(o),
            },
        ];
    }

    static _rowClass(order: OrderRow): string {
        if (order.status === OrderStates.Filled) return 'order-filled';
        if (order.status === OrderStates.Rejected) return 'order-rejected';
        if (order.status === OrderStates.Cancelled) return 'order-cancelled';
        return '';
    }

    // An order can still be modified while the venue holds it. A market order has
    // no limit price and an unconditional order no stop price, so those cells have
    // nothing to edit even then.
    static _canEdit(order: OrderRow, field: 'quantity' | 'limitPrice' | 'stopPrice'): boolean {
        const modifiable = order.status === OrderStates.Active || order.status === OrderStates.Sent;
        return modifiable && (field === 'quantity' || !!order[field]);
    }

    static _editableClass(order: OrderRow, field: 'quantity' | 'limitPrice' | 'stopPrice'): string {
        return ActiveOrdersWidget._canEdit(order, field) ? 'cell-editable' : '';
    }

    // Double-click to edit belongs to the whole cell rather than to a control
    // inside it, which is why it is wired here instead of returned by render().
    _bindInlineEdit(td: HTMLTableCellElement, order: OrderRow, field: 'quantity' | 'limitPrice' | 'stopPrice'): void {
        if (!ActiveOrdersWidget._canEdit(order, field)) return;
        td.addEventListener('dblclick', () => this._deps.editOrderField(order.id!, field));
    }

    // Status text, plus a hoverable icon carrying the rejection reason. Some
    // venues wrap the human-readable rejection inside a JSON blob;
    // cleanRejectReason extracts `.message` and falls back to the raw string.
    // The reason goes on the element's title property, so no quote escaping is
    // involved the way it was when this row was built as markup.
    _statusCell(order: OrderRow): string | Node {
        const text = this._host.presentation.statusText(order.status!);
        const reason = order.status === OrderStates.Rejected ? cleanRejectReason(order.rejectReason) : '';
        if (!reason) return text;

        const cell = document.createDocumentFragment();
        cell.appendChild(document.createTextNode(text + ' '));
        const icon = document.createElement('i');
        icon.className = 'bi bi-question-circle reject-reason-icon';
        icon.title = reason;
        cell.appendChild(icon);
        return cell;
    }

    // The × button, wired to the controller through deps. Status decides what it
    // means: Pending / Active is a real cancel over the wire, while Filled /
    // Rejected / Cancelled have nothing left to cancel — the row is history kept
    // around so the user can read its final state, so the button dismisses it
    // locally.
    _actionButton(order: OrderRow): Node {
        const isTerminal = order.status === OrderStates.Filled
            || order.status === OrderStates.Rejected
            || order.status === OrderStates.Cancelled;
        const title = isTerminal ? this._host.t('Dismiss') : this._host.t('Cancel order');

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'bt-icon-btn bt-icon-cancel';
        button.title = title;
        button.setAttribute('aria-label', `${title} #${order.id}`);
        const icon = document.createElement('i');
        icon.className = 'bi bi-x-circle';
        button.appendChild(icon);
        button.addEventListener('click', () => {
            if (isTerminal) this._deps.dismissOrder(order.id!);
            else this._deps.cancelOrder(order.id!);
        });
        return button;
    }
}
