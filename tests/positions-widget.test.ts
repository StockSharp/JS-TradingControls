import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { asDom, asFake, el, installFakeDom, type FakeElement } from './fake-dom.js';
import { fakeHost } from './fake-host.js';
import { allElements, head, headerCaptions, painted, rowKeys } from './panel-probe.js';
import { PositionsWidget } from '../src/positions-widget.js';

installFakeDom();

type Positions = InstanceType<typeof PositionsWidget>;

const POSITIONS = [
    { portfolioId: 7, instrumentId: 2, instrument: 'ETH/USD', quantity: -3, avgPrice: 2000, currentPrice: 1990, unrealizedPnl: 30, realizedPnl: 0 },
    { portfolioId: 7, instrumentId: 1, instrument: 'BTC/USD', quantity: 2, avgPrice: 100, currentPrice: 110, unrealizedPnl: 20, realizedPnl: -5 },
];

function positionsPanel() {
    const parent = el('div');
    const calls: unknown[][] = [];
    const host = fakeHost();
    const widget = PositionsWidget.create(asDom(parent), {}, {
        host,
        closePosition: (pf, inst, sym) => calls.push(['close', pf, inst, sym]),
        reversePosition: (pf, inst, sym) => calls.push(['reverse', pf, inst, sym]),
        refreshPositions: () => calls.push(['refresh']),
    });
    return { widget, root: parent.childNodes[0] as FakeElement, calls, host };
}

function cell(widget: Positions, rowKey: string, column: string): FakeElement {
    return asFake(widget._grid!.cellElement(rowKey, column));
}

function row(widget: Positions, rowKey: string): FakeElement {
    return asFake(widget._grid!.rowElement(rowKey));
}

describe('PositionsWidget builds its own panel', () => {
    it('renders the shell a host stylesheet and a docking host both read', () => {
        const { root } = positionsPanel();
        assert.equal(root.className, 'terminal-panel positions-panel');
        assert.equal(root.getAttribute('role'), 'region');
        assert.equal(root.getAttribute('aria-label'), 'OpenPositions');

        const header = root.querySelector('.panel-header')!;
        assert.equal(header.childNodes[0].textContent, 'Positions');
        assert.notEqual(root.querySelector('.panel-body-with-rail .panel-body-content'), null);
        assert.notEqual(root.querySelector('.positions-table thead'), null);
        assert.notEqual(root.querySelector('.positions-body'), null);
    });

    it('carries the icon buttons its chrome is made of', () => {
        const { root } = positionsPanel();
        const close = root.querySelector('.panel-close-btn')!;
        assert.equal(close.className, 'bt-icon-btn bt-icon-cancel panel-close-btn');
        assert.equal(close.getAttribute('type'), 'button');
        assert.equal(close.getAttribute('title'), 'ClosePanel');
        assert.equal((close.childNodes[0] as FakeElement).className, 'bi bi-x');
        assert.equal((root.querySelector('.panel-export-btn')!.childNodes[0] as FakeElement).className, 'bi bi-file-earmark-spreadsheet');
        assert.equal((root.querySelector('.panel-refresh-btn')!.childNodes[0] as FakeElement).className, 'bi bi-arrow-clockwise');
        assert.equal(root.querySelector('.panel-rail')!.getAttribute('role'), 'toolbar');
    });

    it('wires the rail through deps — nothing it renders has an onclick', () => {
        const { root, calls, host } = positionsPanel();
        for (const element of allElements(root))
            assert.equal(element.getAttribute('onclick'), null, `${element.tagName} carries an onclick`);

        const refresh = root.querySelector('.panel-refresh-btn')!;
        refresh.dispatchEvent({ type: 'click', target: refresh });
        assert.deepStrictEqual(calls, [['refresh']]);

        const close = root.querySelector('.panel-close-btn')!;
        close.dispatchEvent({ type: 'click', target: close });
        assert.equal(host.calls.closed, 1);
    });
});

describe('PositionsWidget', () => {
    it('renders its own header, so the column set is stated once', () => {
        const { root } = positionsPanel();
        assert.deepStrictEqual(headerCaptions(root), ['Symbol', 'Qty', 'AvgPrice', 'Current', 'PnL', 'Actions']);
        // The actions column has nothing to sort by, so its header is inert.
        assert.deepStrictEqual(head(root).querySelectorAll('[data-sort]').map(th => th.dataset.sort),
            ['instrument', 'quantity', 'avgPrice', 'currentPrice', 'pnl']);
    });

    it('sorts by symbol at rest and keys rows by portfolio + instrument', () => {
        const { widget, root } = positionsPanel();
        widget.update(POSITIONS);
        assert.deepStrictEqual(rowKeys(root), ['7:1', '7:2']);
    });

    it('colours quantity by direction and sums realized into the PnL cell', () => {
        const { widget } = positionsPanel();
        widget.update(POSITIONS);
        assert.equal((row(widget, '7:1').childNodes[1] as FakeElement).className, 'side-buy');
        assert.equal((row(widget, '7:2').childNodes[1] as FakeElement).className, 'side-sell');
        assert.equal(cell(widget, '7:1', 'pnl').textContent, '+15.00');
    });

    it('exports raw numbers under the formatted cells', () => {
        const { widget } = positionsPanel();
        widget.update(POSITIONS);
        const sheet = widget._grid!.exportData();
        assert.deepStrictEqual(sheet.headers, ['Symbol', 'Qty', 'AvgPrice', 'Current', 'PnL']);
        assert.deepStrictEqual(sheet.rows, [
            ['BTC/USD', 2, 100, 110, 15],
            ['ETH/USD', -3, 2000, 1990, 30],
        ]);
    });

    it('pins the cash balance on top, out of the sheet and out of the sort', () => {
        const { widget, root } = positionsPanel();
        widget.update(POSITIONS);
        widget.updateBalance({ available: 1000, locked: 250, total: 1250 });

        assert.deepStrictEqual(rowKeys(root), ['balance', '7:1', '7:2']);
        assert.deepStrictEqual(painted(root)[0],
            ['USD', '$1,000.00', 'Locked: $250.00', '', '$1,250.00', '']);
        assert.equal(widget._grid!.exportData().rows.length, 2);
    });

    it('shows the balance alone rather than "no positions" next to it', () => {
        const { widget, root } = positionsPanel();
        widget.updateBalance({ available: 5, locked: 0, total: 5 });
        assert.deepStrictEqual(rowKeys(root), ['balance']);

        widget.updateBalance(null);
        assert.equal(painted(root)[0][0], 'No positions');
    });

    it('tracks the live balance without the widget repainting rows itself', () => {
        const { widget, root } = positionsPanel();
        widget.updateBalance({ available: 1, locked: 0, total: 1 });
        widget.updateBalance({ available: 2, locked: 0, total: 2 });
        assert.equal(painted(root)[0][1], '$2.00');
    });

    it('close and reverse call the injected deps, not a global', () => {
        const { widget, calls } = positionsPanel();
        widget.update(POSITIONS);
        const actions = cell(widget, '7:1', 'actions');
        assert.equal(actions.getAttribute('onclick'), null);

        (actions.childNodes[0] as FakeElement).dispatchEvent({ type: 'click' });
        (actions.childNodes[1] as FakeElement).dispatchEvent({ type: 'click' });
        assert.deepStrictEqual(calls, [['close', 7, 1, 'BTC/USD'], ['reverse', 7, 1, 'BTC/USD']]);
    });

    it('refuses to wire up without the callbacks that make it a positions panel', () => {
        assert.throws(
            () => PositionsWidget.create(asDom(el('div')), {}, { host: fakeHost() } as never),
            /dep "closePosition" is required/);
    });

    it('drops a position closed by a delta and merges one that moved', () => {
        const { widget, root } = positionsPanel();
        widget.update([...POSITIONS]);
        widget.applyDelta({ portfolioId: 7, instrumentId: 2, quantity: 0 });
        assert.deepStrictEqual(rowKeys(root), ['7:1']);

        widget.applyDelta({ portfolioId: 7, instrumentId: 1, quantity: 2, currentPrice: 130, unrealizedPnl: 60 });
        assert.equal(cell(widget, '7:1', 'currentPrice').textContent, '130.00');
        assert.equal(cell(widget, '7:1', 'pnl').textContent, '+55.00');
    });
});
