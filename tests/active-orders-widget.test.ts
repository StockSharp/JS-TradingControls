import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { asDom, asFake, el, installFakeDom, type FakeElement } from './fake-dom.js';
import { fakeHost } from './fake-host.js';
import { allElements, body, head, headerCaptions, painted, rowKeys } from './panel-probe.js';
import { ActiveOrdersWidget } from '../src/active-orders-widget.js';

// Before any test body runs, and that is early enough: no module in the package
// touches `document` while it is being evaluated, only while a control is being
// created.
installFakeDom();

type ActiveOrders = InstanceType<typeof ActiveOrdersWidget>;

/// One live order, one rejected and one filled — enough for every branch the
/// blotter has: row colour, which cells can still be edited, and what the ×
/// means. Every order carries a `localId` that differs from its `id`, because
/// those two are the same number nowhere but in a fixture that forgot to tell
/// them apart: the ID column shows the friendly counter, while cancel, replace
/// and inline edit all address the register tx.
const ORDERS = [
    { id: 501, localId: 1, instrument: 'BTC/USD', side: 0, type: 0, quantity: 2, limitPrice: 100, stopPrice: null, status: 3 },
    {
        id: 502, localId: 2, instrument: 'ETH/USD', side: 1, type: 1, quantity: 3, limitPrice: null, stopPrice: null, status: 6,
        rejectReason: 'failed to complete request (err=Forbidden): {"code":40310000,"message":"insufficient balance"}',
    },
    { id: 503, localId: 3, instrument: 'BTC/USD', side: 0, type: 0, quantity: 1, limitPrice: 90, stopPrice: null, status: 5 },
];

type Call = unknown[];

function activeOrdersPanel(orders = ORDERS) {
    const parent = el('div');
    const calls: Call[] = [];
    const host = fakeHost();
    let widget: ActiveOrders;
    widget = ActiveOrdersWidget.create(asDom(parent), {}, {
        host,
        cancelOrder: (id) => calls.push(['cancel', id]),
        dismissOrder: (id) => calls.push(['dismiss', id]),
        // Wired the way a controller wires it: the panel asks for an edit, and
        // the controller hands the request back to every open blotter.
        editOrderField: (id, field) => { calls.push(['edit', id, field]); widget.startInlineEdit(id, field as 'quantity'); },
        replaceOrder: (id, qty, limit, stop) => calls.push(['replace', id, qty, limit, stop]),
        cancelAllOrders: () => calls.push(['cancelAll']),
        refreshOrders: () => calls.push(['refresh']),
    });
    widget.update(orders.map(o => ({ ...o })));
    return { widget, root: parent.childNodes[0] as FakeElement, calls, host };
}

/// The × of the row with this key.
function actionButton(widget: ActiveOrders, rowKey: string): FakeElement {
    return (asFake(widget._grid!.cellElement(rowKey, 'actions'))).childNodes[0] as FakeElement;
}

function cell(widget: ActiveOrders, rowKey: string, column: string): FakeElement {
    return asFake(widget._grid!.cellElement(rowKey, column));
}

function row(widget: ActiveOrders, rowKey: string): FakeElement {
    return asFake(widget._grid!.rowElement(rowKey));
}

describe('ActiveOrdersWidget builds its own panel', () => {
    it('renders the shell a host stylesheet and a docking host both read', () => {
        const { root } = activeOrdersPanel();
        assert.equal(root.className, 'terminal-panel active-orders-panel');
        assert.equal(root.getAttribute('role'), 'region');
        assert.equal(root.getAttribute('aria-label'), 'ActiveOrders');

        // A docking host moves .panel-header's children into its tab and expects
        // .terminal-panel to be the panel root — losing either leaves the panel
        // with two rows of chrome, or none.
        const header = root.querySelector('.panel-header')!;
        assert.equal(header.childNodes[0].textContent, 'OpenOrders');
        assert.notEqual(root.querySelector('.panel-body-with-rail .panel-body-content'), null);
        assert.equal(root.querySelector('.active-orders-table')!.getAttribute('aria-label'), 'ActiveOrdersList');
        assert.equal(root.querySelector('.panel-rail')!.getAttribute('aria-label'), 'ActiveOrdersActions');
        assert.notEqual(root.querySelector('.active-orders-body'), null);
    });

    it('gives cancel-all an accessible name distinct from its tooltip', () => {
        const { root } = activeOrdersPanel();
        const cancelAll = root.querySelector('.panel-cancel-all-btn')!;
        assert.equal(cancelAll.className, 'bt-icon-btn bt-icon-cancel-all panel-cancel-all-btn');
        assert.equal(cancelAll.getAttribute('title'), 'CancelAll');
        assert.equal(cancelAll.getAttribute('aria-label'), 'CancelAllOrders');
        assert.equal(cancelAll.childNodes[0].textContent, '');
        assert.equal((cancelAll.childNodes[0] as FakeElement).className, 'bi bi-x-circle');
    });

    it('wires the rail through deps — nothing it renders has an onclick', () => {
        const { root, calls, host } = activeOrdersPanel();
        for (const element of allElements(root))
            assert.equal(element.getAttribute('onclick'), null, `${element.tagName} carries an onclick`);

        for (const [selector, expected] of [
            ['.panel-cancel-all-btn', 'cancelAll'],
            ['.panel-refresh-btn', 'refresh'],
        ] as const) {
            const button = root.querySelector(selector)!;
            button.dispatchEvent({ type: 'click', target: button });
            assert.deepStrictEqual(calls.at(-1), [expected]);
        }

        const close = root.querySelector('.panel-close-btn')!;
        close.dispatchEvent({ type: 'click', target: close });
        assert.equal(host.calls.closed, 1);
    });
});

describe('ActiveOrdersWidget', () => {
    it('renders its own header, and only a column with a value is sortable', () => {
        const { root } = activeOrdersPanel();
        assert.deepStrictEqual(headerCaptions(root),
            ['ID', 'Sym', 'Side', 'Type', 'Qty', 'Price', 'Stop', 'Status', 'Actions']);
        // "Actions" is named for a screen reader but has nothing to sort by.
        assert.deepStrictEqual(head(root).querySelectorAll('[data-sort]').map(th => th.dataset.sort),
            ['id', 'instrument', 'side', 'type', 'quantity', 'limitPrice', 'stopPrice', 'status']);
    });

    it('rests newest-first on the friendly counter, keyed by the register tx', () => {
        const { root } = activeOrdersPanel();
        assert.deepStrictEqual(rowKeys(root), ['503', '502', '501']);
        assert.deepStrictEqual(painted(root).map(cells => cells[0]), ['3', '2', '1']);
    });

    it('greys out a row the venue is done with and leaves a live one plain', () => {
        const { widget } = activeOrdersPanel();
        assert.equal(row(widget, '501').className, '');
        assert.equal(row(widget, '502').className, 'order-rejected');
        assert.equal(row(widget, '503').className, 'order-filled');

        widget.applyDelta({ id: 501, status: 7 });
        assert.equal(row(widget, '501').className, 'order-cancelled');
    });

    it('the × is a real button through the deps — nothing in the table has an onclick', () => {
        const { widget, root, calls } = activeOrdersPanel();
        const actions = cell(widget, '501', 'actions');
        assert.equal(actions.className, 'position-actions');
        const button = actions.childNodes[0] as FakeElement;
        assert.equal(button.tagName, 'BUTTON');
        assert.equal(button.className, 'bt-icon-btn bt-icon-cancel');
        assert.equal((button.childNodes[0] as FakeElement).className, 'bi bi-x-circle');

        for (const element of [...allElements(head(root)), ...allElements(body(root))])
            assert.equal(element.getAttribute('onclick'), null, `${element.tagName} carries an onclick`);

        button.dispatchEvent({ type: 'click', target: button });
        assert.deepStrictEqual(calls, [['cancel', 501]]);
    });

    it('the × cancels a live order and dismisses one that is already history', () => {
        const { widget, calls } = activeOrdersPanel();
        assert.equal(actionButton(widget, '501').title, 'Cancel order');
        assert.equal(actionButton(widget, '501').getAttribute('aria-label'), 'Cancel order #501');
        assert.equal(actionButton(widget, '502').title, 'Dismiss');
        assert.equal(actionButton(widget, '502').getAttribute('aria-label'), 'Dismiss #502');
        assert.equal(actionButton(widget, '503').title, 'Dismiss');

        // Rejected and Filled have nothing left to cancel, so their × only drops the row.
        actionButton(widget, '502').dispatchEvent({ type: 'click' });
        actionButton(widget, '503').dispatchEvent({ type: 'click' });
        assert.deepStrictEqual(calls, [['dismiss', 502], ['dismiss', 503]]);
    });

    it('double-click opens the editor on the cell that was double-clicked', () => {
        const { widget, calls } = activeOrdersPanel();
        const qty = cell(widget, '501', 'quantity');
        assert.equal(qty.className, 'cell-editable');

        qty.dispatchEvent({ type: 'dblclick', target: qty });
        assert.deepStrictEqual(calls, [['edit', 501, 'quantity']]);

        // The editor is addressed by the row key (the register tx, 501) and the column
        // key. The ID column shows the friendly counter — a lookup that scanned the
        // rendered ID text for the order id would match nothing and silently do nothing.
        assert.equal(cell(widget, '501', 'id').textContent, '1');
        const input = qty.querySelector('input');
        assert.notEqual(input, null, 'the double-clicked cell must hold the editor');
        assert.equal(input!.className, 'inline-edit-input');
        assert.equal(input!.value, '2');
    });

    it('only the cells that can still change are editable', () => {
        const { widget, calls } = activeOrdersPanel();
        // Active, but this order has no stop price — there is nothing in that cell to edit.
        const stop = cell(widget, '501', 'stopPrice');
        assert.equal(stop.className, '');
        stop.dispatchEvent({ type: 'dblclick', target: stop });

        // Filled: the venue is done with the order, so even its price is frozen.
        const filledPrice = cell(widget, '503', 'limitPrice');
        assert.equal(filledPrice.className, '');
        filledPrice.dispatchEvent({ type: 'dblclick', target: filledPrice });

        assert.deepStrictEqual(calls, []);
    });

    it('committing the editor replaces the order with the whole triple', () => {
        const { widget, calls } = activeOrdersPanel();
        widget.startInlineEdit(501, 'quantity');
        const input = cell(widget, '501', 'quantity').querySelector('input')!;
        input.value = '5';
        input.dispatchEvent({ type: 'blur', target: input });

        // Quantity is what the user changed; price and stop travel along unchanged,
        // because a replace restates the order rather than patching one field.
        assert.deepStrictEqual(calls, [['replace', 501, 5, 100, null]]);
    });

    it('an edit that changes nothing repaints instead of replacing the order', () => {
        const { widget, calls } = activeOrdersPanel();
        widget.startInlineEdit(501, 'quantity');
        const input = cell(widget, '501', 'quantity').querySelector('input')!;
        input.value = '2';
        input.dispatchEvent({ type: 'blur', target: input });

        assert.deepStrictEqual(calls, []);
        assert.equal(cell(widget, '501', 'quantity').textContent, '2');
    });

    it('carries a rejection reason on an icon rather than in the status text', () => {
        const { widget } = activeOrdersPanel();
        const status = cell(widget, '502', 'status');
        assert.equal(status.textContent, 'Rejected ');
        assert.equal((status.childNodes[1] as FakeElement).className, 'bi bi-question-circle reject-reason-icon');
        // The venue wrapped its message in a JSON blob; the user reads the message.
        assert.equal((status.childNodes[1] as FakeElement).title, 'insufficient balance');
        // A live order has nothing to explain, so it gets text and no icon.
        assert.equal(cell(widget, '501', 'status').childNodes.length, 1);
    });

    it('exports the texts on screen and the raw figures under them', () => {
        const { widget, root } = activeOrdersPanel();
        assert.deepStrictEqual(painted(root)[1],
            ['2', 'ETH/USD', 'Sell', 'MKT', '3', 'MKT', '--', 'Rejected ', '']);

        const sheet = widget._grid!.exportData();
        // The actions column has nothing to say in a sheet.
        assert.deepStrictEqual(sheet.headers, ['ID', 'Sym', 'Side', 'Type', 'Qty', 'Price', 'Stop', 'Status']);
        // Side and status read as numbers on the wire and as words on screen: the sheet
        // gets the words. The prices go the other way — the raw number, not the
        // formatted cell — and an absent stop is a blank rather than the screen's "--".
        assert.deepStrictEqual(sheet.rows, [
            [3, 'BTC/USD', 'Buy', 'LMT', 1, 90, '', 'Filled'],
            [2, 'ETH/USD', 'Sell', 'MKT', 3, 'MKT', '', 'Rejected'],
            [1, 'BTC/USD', 'Buy', 'LMT', 2, 100, '', 'Active'],
        ]);
    });

    it('merges a delta into a known order and keeps a finished one on screen', () => {
        const { widget, root } = activeOrdersPanel();
        widget.applyDelta({ id: 501, status: 4, limitPrice: 105 });
        assert.equal(cell(widget, '501', 'limitPrice').textContent, '105.00');
        assert.equal(cell(widget, '501', 'status').textContent, 'PartFill');

        // An unknown order joins the list, and a filled one stays: this blotter is the
        // session's whole order list, so no row vanishes on its own.
        widget.applyDelta({ id: 504, localId: 4, instrument: 'SOL/USD', side: 0, type: 0, quantity: 7, limitPrice: 20, status: 5 });
        assert.deepStrictEqual(rowKeys(root), ['504', '503', '502', '501']);

        widget.removeOrder(504);
        assert.deepStrictEqual(rowKeys(root), ['503', '502', '501']);
    });

    it('refuses to wire up without the callbacks that make it an orders panel', () => {
        assert.throws(
            () => ActiveOrdersWidget.create(asDom(el('div')), {}, {
                host: fakeHost(), cancelOrder: () => { }, dismissOrder: () => { }, editOrderField: () => { },
                cancelAllOrders: () => { }, refreshOrders: () => { },
            } as never),
            /dep "replaceOrder" is required/);
    });
});
