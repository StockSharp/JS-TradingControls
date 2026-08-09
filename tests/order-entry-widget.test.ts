import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { asDom, el, installFakeDom, type FakeElement } from './fake-dom.js';
import { fakeHost, type TestHost } from './fake-host.js';
import { allElements } from './panel-probe.js';
import { OrderEntrySides, OrderEntryTypes, OrderEntryWidget, type OrderEntryValues } from '../src/order-entry-widget.js';

installFakeDom();

// A venue whose grid every case below is measured against: whole lots, cent
// ticks, at least one and at most a thousand.
const INSTRUMENT = { symbol: 'BTC@IMEX', lotSize: 1, tickSize: 0.01, minVolume: 1, maxVolume: 1000 };

type Submitted = [string, OrderEntryValues];

function pad(): { widget: OrderEntryWidget; root: FakeElement; submitted: Submitted[]; host: TestHost } {
    const parent = el('div');
    const submitted: Submitted[] = [];
    const host = fakeHost();
    const widget = OrderEntryWidget.create(asDom(parent), {}, {
        host,
        submitOrder: (side, values) => submitted.push([side, values]),
    });
    return { widget, root: parent.childNodes[0] as FakeElement, submitted, host };
}

function column(root: FakeElement, side: string): FakeElement {
    return root.querySelector(side === 'buy' ? '.oe-col-buy' : '.oe-col-sell')!;
}

function field(root: FakeElement, side: string, name: string): FakeElement {
    return column(root, side).querySelector(`.oe-field-${name} input`)!;
}

function type(root: FakeElement, side: string, name: string, value: string): FakeElement {
    const input = field(root, side, name);
    input.value = value;
    input.dispatchEvent({ type: 'input', target: input });
    return input;
}

function click(node: FakeElement): void {
    node.dispatchEvent({ type: 'click', target: node });
}

function tab(root: FakeElement, orderType: string): FakeElement {
    return root.querySelectorAll('.btn-ot').find(button => button.dataset.type === orderType)!;
}

describe('OrderEntryWidget builds its own pad', () => {
    it('renders the shell a host stylesheet and a docking host both read', () => {
        const { root } = pad();
        assert.equal(root.className, 'terminal-panel order-entry-panel');
        assert.equal(root.getAttribute('role'), 'region');
        assert.equal(root.getAttribute('aria-label'), 'OrderEntry');

        assert.equal(root.querySelector('.panel-header')!.childNodes[0].textContent, 'OrderEntry');
        assert.notEqual(root.querySelector('.order-entry-content .order-type-tabs'), null);
        assert.notEqual(root.querySelector('.order-entry-split .oe-col-buy'), null);
        assert.notEqual(root.querySelector('.order-entry-split .oe-col-sell'), null);
    });

    it('carries the chrome its header is made of, and no spawn button', () => {
        const { root } = pad();
        const close = root.querySelector('.panel-close-btn')!;
        assert.equal(close.className, 'bt-icon-btn bt-icon-cancel panel-close-btn');
        assert.equal(close.getAttribute('title'), 'ClosePanel');
        assert.equal((close.childNodes[0] as FakeElement).className, 'bi bi-x');
        // A second pad on one portfolio is the host's decision, so the header
        // offers no `+`.
        assert.equal(root.querySelector('.panel-add-btn'), null);
    });

    it('words both sides through the host, not in its own vocabulary', () => {
        const { root } = pad();
        assert.equal(column(root, 'buy').querySelector('.btn-oe-submit')!.textContent, 'Buy[BuyHotkey]');
        assert.equal(column(root, 'sell').querySelector('.btn-oe-submit')!.textContent, 'Sell[SellHotkey]');
        assert.equal(column(root, 'buy').querySelector('.oe-foot .oe-label')!.textContent, 'Max Buy');
        assert.equal(column(root, 'sell').querySelector('.oe-foot .oe-label')!.textContent, 'Max Sell');
    });

    it('wires every control through listeners — nothing it renders has an onclick', () => {
        const { root, host } = pad();
        for (const element of allElements(root)) {
            assert.equal(element.getAttribute('onclick'), null, `${element.tagName} carries an onclick`);
            assert.equal(element.getAttribute('onchange'), null, `${element.tagName} carries an onchange`);
            assert.deepStrictEqual(element.style.properties, {}, `${element.tagName} carries an inline style`);
        }

        const close = root.querySelector('.panel-close-btn')!;
        click(close);
        assert.equal(host.calls.closed, 1);
    });
});

describe('OrderEntryWidget order types', () => {
    it('starts on market with both price fields away', () => {
        const { widget, root } = pad();
        assert.equal(widget.orderType, OrderEntryTypes.Market);
        assert.equal(tab(root, 'market').getAttribute('aria-pressed'), 'true');
        assert.ok(column(root, 'buy').querySelector('.oe-field-price')!.classList.contains('oe-field-hidden'));
        assert.ok(column(root, 'buy').querySelector('.oe-field-stop')!.classList.contains('oe-field-hidden'));
    });

    it('a tab click switches the type and shows the fields that type uses', () => {
        const { widget, root } = pad();
        click(tab(root, 'limit'));

        assert.equal(widget.orderType, OrderEntryTypes.Limit);
        assert.ok(tab(root, 'limit').classList.contains('active'));
        assert.equal(tab(root, 'market').getAttribute('aria-pressed'), 'false');
        assert.equal(column(root, 'sell').querySelector('.oe-field-price')!.classList.contains('oe-field-hidden'), false);
        assert.ok(column(root, 'sell').querySelector('.oe-field-stop')!.classList.contains('oe-field-hidden'));

        click(tab(root, 'stoplimit'));
        assert.equal(column(root, 'buy').querySelector('.oe-field-price')!.classList.contains('oe-field-hidden'), false);
        assert.equal(column(root, 'buy').querySelector('.oe-field-stop')!.classList.contains('oe-field-hidden'), false);
    });

    it('maps a form type onto the wire enum', () => {
        assert.equal(OrderEntryWidget.toApiType(OrderEntryTypes.Limit), 0);
        assert.equal(OrderEntryWidget.toApiType(OrderEntryTypes.Market), 1);
        assert.equal(OrderEntryWidget.toApiType(OrderEntryTypes.Stop), 2);
        assert.equal(OrderEntryWidget.toApiType(OrderEntryTypes.StopLimit), 2);
        assert.equal(OrderEntryWidget.toApiType('garbage'), 1);
    });
});

describe('OrderEntryWidget and the instrument it trades', () => {
    it('adopts the venue grid onto both columns', () => {
        const { widget, root } = pad();
        widget.setInstrument({ lotSize: 0.001, tickSize: 0.5, minVolume: 0.002, maxVolume: 5 });

        const qty = field(root, 'buy', 'qty');
        assert.equal(qty.step, '0.001');
        assert.equal(qty.min, '0.002');
        assert.equal(qty.max, '5');
        // Reset to the minimum lot rather than carried across the switch.
        assert.equal(qty.value, '0.002');
        assert.equal(field(root, 'sell', 'price').step, '0.5');
    });

    it('says there is no upper bound with an empty max, the way an input does', () => {
        const { widget, root } = pad();
        widget.setInstrument({ lotSize: 1, tickSize: 0.01, minVolume: 1, maxVolume: null });
        assert.equal(field(root, 'buy', 'qty').max, '');
    });

    it('hands the instrument back for a host that has to quantize a price itself', () => {
        const { widget } = pad();
        assert.equal(widget.getInstrument(), null);
        widget.setInstrument(INSTRUMENT);
        assert.equal(widget.getInstrument()!.tickSize, 0.01);
    });
});

describe('OrderEntryWidget prices', () => {
    it('seeds each column passively — buy joins the bid, sell joins the ask', () => {
        const { widget, root } = pad();
        widget.setInstrument(INSTRUMENT);
        widget.setBbo(99.5, 100.25);

        assert.equal(field(root, 'buy', 'price').value, '99.50');
        assert.equal(field(root, 'sell', 'price').value, '100.25');
    });

    it('rounds to the tick, so a mid price does not arrive as a float tail', () => {
        const { widget, root } = pad();
        widget.setInstrument({ lotSize: 1, tickSize: 0.0001, minVolume: 1, maxVolume: null });
        widget.seedLimitPrice(0.44625000000000004);
        assert.equal(field(root, 'buy', 'price').value, '0.4463');
    });

    it('stops following the market once the trader has typed a price', () => {
        const { widget, root } = pad();
        widget.setInstrument(INSTRUMENT);
        widget.setBbo(99.5, 100.25);

        type(root, 'buy', 'price', '95');
        widget.setBbo(98, 101);
        assert.equal(field(root, 'buy', 'price').value, '95');
        // The other column was never touched, so it keeps tracking.
        assert.equal(field(root, 'sell', 'price').value, '101.00');
    });

    it('leaves the field the trader is standing in alone, focus tracked by the pad', () => {
        const { widget, root } = pad();
        widget.setInstrument(INSTRUMENT);

        const price = field(root, 'buy', 'price');
        price.dispatchEvent({ type: 'focus', target: price });
        widget.setBbo(50, 51);
        assert.equal(price.value, '');

        price.dispatchEvent({ type: 'blur', target: price });
        widget.setBbo(52, 53);
        assert.equal(price.value, '52.00');
    });

    it('a force-seed outranks what was typed', () => {
        const { widget, root } = pad();
        widget.setInstrument(INSTRUMENT);
        type(root, 'buy', 'price', '95');
        widget.seedLimitPrice(120);
        assert.equal(field(root, 'buy', 'price').value, '120.00');
    });

    it('the BBO button takes the other side of the book, and lets ticks resume', () => {
        const { widget, root } = pad();
        widget.setInstrument(INSTRUMENT);
        widget.setBbo(99.5, 100.25);
        type(root, 'buy', 'price', '1');

        click(column(root, 'buy').querySelector('.btn-bbo')!);
        assert.equal(field(root, 'buy', 'price').value, '100.25');

        widget.setBbo(99, 103);
        assert.equal(field(root, 'buy', 'price').value, '99.00');
    });

    it('setPrice is the seam a click on a book level goes through', () => {
        const { widget, root } = pad();
        widget.setInstrument(INSTRUMENT);
        widget.setPrice(OrderEntrySides.Sell, 100.017);
        assert.equal(field(root, 'sell', 'price').value, '100.02');
    });
});

describe('OrderEntryWidget quantity', () => {
    it('setQuantity applies to both columns', () => {
        const { widget, root } = pad();
        widget.setQuantity(4);
        assert.equal(field(root, 'buy', 'qty').value, '4');
        assert.equal(field(root, 'sell', 'qty').value, '4');
    });

    it('percent buttons divide the maximum the host supplied, floored to a lot', () => {
        const { widget, root } = pad();
        widget.setInstrument(INSTRUMENT);
        widget.setMaxQuantity(OrderEntrySides.Buy, 7);

        const half = column(root, 'buy').querySelectorAll('.btn-oe-pct').find(b => b.dataset.pct === '50')!;
        click(half);
        assert.equal(field(root, 'buy', 'qty').value, '3');
        assert.equal(column(root, 'buy').querySelector('.oe-foot .oe-value')!.textContent, '7');
    });

    it('reports the missing maximum instead of taking a percentage of the current size', () => {
        const { widget, root, host } = pad();
        widget.setInstrument(INSTRUMENT);
        const before = field(root, 'buy', 'qty').value;

        click(column(root, 'buy').querySelectorAll('.btn-oe-pct')[0]!);

        assert.equal(field(root, 'buy', 'qty').value, before);
        assert.equal(host.calls.logged.length, 1);
        assert.match(host.calls.logged[0], /no maximum quantity for the buy side/);
    });

    it('shows the cash the host says is available, and "--" until it says', () => {
        const { widget, root } = pad();
        assert.equal(column(root, 'sell').querySelector('.oe-avbl .oe-value')!.textContent, '--');
        widget.setAvailable(OrderEntrySides.Sell, 1234.5);
        assert.equal(column(root, 'sell').querySelector('.oe-avbl .oe-value')!.textContent, '1234.5');
        widget.setAvailable(OrderEntrySides.Sell, null);
        assert.equal(column(root, 'sell').querySelector('.oe-avbl .oe-value')!.textContent, '--');
    });
});

describe('OrderEntryWidget validation', () => {
    it('says nothing until the instrument is known — every rule measures against it', () => {
        const { widget, root } = pad();
        assert.equal(widget.validate(OrderEntrySides.Buy), null);
        assert.equal(column(root, 'buy').querySelector('.oe-estimate')!.textContent, '');
    });

    it(`puts the host's wording on the estimate line and stops the button`, () => {
        const { widget, root } = pad();
        widget.setInstrument({ lotSize: 5, tickSize: 0.01, minVolume: 5, maxVolume: 100 });
        type(root, 'buy', 'qty', '7');

        const estimate = column(root, 'buy').querySelector('.oe-estimate')!;
        assert.equal(estimate.textContent, 'Quantity must be a multiple of 5');
        assert.ok(estimate.classList.contains('oe-estimate-error'));
        assert.equal(column(root, 'buy').querySelector('.btn-oe-submit')!.disabled, true);

        type(root, 'buy', 'qty', '10');
        assert.equal(estimate.textContent, '');
        assert.equal(column(root, 'buy').querySelector('.btn-oe-submit')!.disabled, false);
    });

    it('checks the prices the chosen type actually uses', () => {
        const { widget, root } = pad();
        widget.setInstrument(INSTRUMENT);
        click(tab(root, 'limit'));

        assert.equal(widget.validate(OrderEntrySides.Buy), 'Limit price must be positive');
        type(root, 'buy', 'price', '100.005');
        assert.equal(widget.validate(OrderEntrySides.Buy), 'Limit price must be a multiple of 0.01');
        type(root, 'buy', 'price', '100.01');
        assert.equal(widget.validate(OrderEntrySides.Buy), null);
    });

    it('estimates the order at the price it would fill at', () => {
        const { widget, root } = pad();
        widget.setInstrument(INSTRUMENT);
        widget.setBbo(99, 101);
        type(root, 'buy', 'qty', '3');
        // Market on the buy side lifts the offer.
        assert.equal(column(root, 'buy').querySelector('.oe-total .oe-value')!.textContent, '303.00');

        click(tab(root, 'limit'));
        type(root, 'buy', 'price', '50');
        assert.equal(column(root, 'buy').querySelector('.oe-total .oe-value')!.textContent, '150.00');
    });
});

describe('OrderEntryWidget submitting', () => {
    it('collects the column and hands it to the dep, not to a global', () => {
        const { widget, root, submitted } = pad();
        widget.setInstrument(INSTRUMENT);
        click(tab(root, 'limit'));
        type(root, 'sell', 'qty', '2');
        type(root, 'sell', 'price', '101.5');

        click(column(root, 'sell').querySelector('.btn-oe-submit')!);

        assert.deepStrictEqual(submitted, [['sell', {
            type: OrderEntryTypes.Limit,
            quantity: 2,
            limitPrice: 101.5,
            stopPrice: null,
            takeProfit: null,
            stopLoss: null,
        }]]);
    });

    it('drops the prices the chosen type does not use', () => {
        const { widget, root, submitted } = pad();
        widget.setInstrument(INSTRUMENT);
        click(tab(root, 'limit'));
        type(root, 'buy', 'price', '90');
        click(tab(root, 'market'));

        click(column(root, 'buy').querySelector('.btn-oe-submit')!);
        assert.equal(submitted[0][1].limitPrice, null);
        assert.equal(submitted[0][1].type, OrderEntryTypes.Market);
    });

    it('carries take-profit and stop-loss only while the block is on', () => {
        const { widget, root, submitted } = pad();
        widget.setInstrument(INSTRUMENT);
        type(root, 'buy', 'tp', '120');
        type(root, 'buy', 'sl', '80');

        click(column(root, 'buy').querySelector('.btn-oe-submit')!);
        assert.equal(submitted[0][1].takeProfit, null);

        const check = column(root, 'buy').querySelector('.oe-tpsl-toggle input')!;
        check.checked = true;
        check.dispatchEvent({ type: 'change', target: check });
        assert.equal(column(root, 'buy').querySelector('.oe-tpsl')!.classList.contains('oe-field-hidden'), false);

        click(column(root, 'buy').querySelector('.btn-oe-submit')!);
        assert.equal(submitted[1][1].takeProfit, 120);
        assert.equal(submitted[1][1].stopLoss, 80);
    });

    it('refuses a form the venue would reject', () => {
        const { widget, root, submitted } = pad();
        widget.setInstrument(INSTRUMENT);
        type(root, 'buy', 'qty', '0');

        widget.submit(OrderEntrySides.Buy);
        assert.deepStrictEqual(submitted, []);
        assert.equal(column(root, 'buy').querySelector('.oe-estimate')!.textContent, 'Quantity must be positive');
    });

    it('sends nothing while the host says it cannot', () => {
        const { widget, root, submitted } = pad();
        widget.setInstrument(INSTRUMENT);
        widget.setEnabled(false);

        assert.ok(root.querySelector('.order-entry-content')!.classList.contains('oe-offline'));
        assert.equal(column(root, 'buy').querySelector('.btn-oe-submit')!.disabled, true);
        widget.submit(OrderEntrySides.Buy);
        assert.deepStrictEqual(submitted, []);

        widget.setEnabled(true);
        assert.equal(column(root, 'buy').querySelector('.btn-oe-submit')!.disabled, false);
        widget.submit(OrderEntrySides.Buy);
        assert.equal(submitted.length, 1);
    });

    it('marks the side a host gesture aimed at, and clears it', () => {
        const { widget, root } = pad();
        widget.preselect(OrderEntrySides.Sell);
        assert.ok(column(root, 'sell').querySelector('.btn-oe-submit')!.classList.contains('btn-preselected'));
        assert.equal(column(root, 'buy').querySelector('.btn-oe-submit')!.classList.contains('btn-preselected'), false);

        widget.preselect(null);
        assert.equal(column(root, 'sell').querySelector('.btn-oe-submit')!.classList.contains('btn-preselected'), false);
    });

    it('refuses to wire up without the callback that makes it an order pad', () => {
        assert.throws(
            () => OrderEntryWidget.create(asDom(el('div')), {}, { host: fakeHost() } as never),
            /dep "submitOrder" is required/);
    });

    it('registers itself, so a host that fans prices reaches it, and unregisters on dispose', () => {
        const { widget, host } = pad();
        assert.equal(host.calls.registered.length, 1);
        widget.dispose();
        let seen = 0;
        host.broadcast(() => { seen += 1; });
        assert.equal(seen, 0);
    });
});

describe('OrderEntryWidget size arithmetic', () => {
    it('writes a quantity the way an input reads it back', () => {
        assert.equal(OrderEntryWidget._formatQty(10), '10');
        assert.equal(OrderEntryWidget._formatQty(0.001), '0.001');
        assert.equal(OrderEntryWidget._formatQty(1e-9), '0.000000001');
        assert.equal(OrderEntryWidget._formatQty(0), '0');
    });

    it('answers the lot question at crypto scale, where a modulo cannot', () => {
        assert.equal(OrderEntryWidget._isMultipleOf(10, 1), true);
        assert.equal(OrderEntryWidget._isMultipleOf(7, 5), false);
        assert.equal(OrderEntryWidget._isMultipleOf(0.3, 0.01), true);
        assert.equal(OrderEntryWidget._isMultipleOf(100.001, 0.01), false);
        assert.equal(OrderEntryWidget._isMultipleOf(0.0000001, 1e-9), true);
        assert.equal(OrderEntryWidget._isMultipleOf(0.0000000001, 1e-9), false);
        assert.equal(OrderEntryWidget._isMultipleOf(100.15, 0.05), true);
        assert.equal(OrderEntryWidget._isMultipleOf(100.17, 0.05), false);
        // A step of zero or less is no constraint at all.
        assert.equal(OrderEntryWidget._isMultipleOf(1, 0), true);
        assert.equal(OrderEntryWidget._isMultipleOf(1, -1), true);
    });
});
