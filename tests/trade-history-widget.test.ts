import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { asDom, asFake, el, installFakeDom, type FakeElement } from './fake-dom.js';
import { fakeHost } from './fake-host.js';
import { allElements, headerCaptions, painted, rowKeys } from './panel-probe.js';
import { TradeHistoryWidget } from '../src/trade-history-widget.js';
import type { TradeRow } from '../src/trading-data.js';

installFakeDom();

type TradeHistory = InstanceType<typeof TradeHistoryWidget>;

const TRADES: TradeRow[] = [
    { id: 11, executedAt: '2026-02-01T10:00:00Z', instrumentSymbol: 'BTC/USD', side: 0, quantity: 2, price: 100, order: 501 },
    { id: 12, executedAt: '2026-02-01T11:00:00Z', instrumentSymbol: 'ETH/USD', side: 1, quantity: 3, price: 2000, order: 502 },
];

function tradeHistoryPanel(portfolioId: () => number | null, executions: TradeRow[]) {
    const parent = el('div');
    const asked: unknown[][] = [];
    const host = fakeHost();
    host.trading.portfolioId = () => portfolioId();
    host.trading.api.getExecutions = (pf, symbol, limit) => {
        asked.push([pf, symbol, limit]);
        return Promise.resolve(executions);
    };
    const widget = TradeHistoryWidget.create(asDom(parent), {}, { host });
    return { widget, root: parent.childNodes[0] as FakeElement, asked, host };
}

function cell(widget: TradeHistory, rowKey: string, column: string): FakeElement {
    return asFake(widget._grid!.cellElement(rowKey, column));
}

describe('TradeHistoryWidget builds its own panel', () => {
    it('renders the shell a host stylesheet and a docking host both read', () => {
        const { root } = tradeHistoryPanel(() => 3, TRADES);
        assert.equal(root.className, 'terminal-panel trade-history-panel');
        assert.equal(root.getAttribute('aria-label'), 'TradeHistory');
        assert.equal(root.querySelector('.panel-header')!.childNodes[0].textContent, 'TradeHistory');
        assert.equal(root.querySelector('.trade-history-table')!.getAttribute('aria-label'), 'TradeHistoryList');
        assert.equal(root.querySelector('.panel-rail')!.getAttribute('aria-label'), 'TradeHistoryActions');
        assert.notEqual(root.querySelector('.trade-history-body'), null);
        assert.deepStrictEqual(headerCaptions(root), ['ID', 'Time', 'Sym', 'Side', 'Qty', 'Price', 'Order']);
    });

    it('reloads from the rail against the portfolio the host names, with nothing of its own to ask', async () => {
        const { root, asked } = tradeHistoryPanel(() => 7, TRADES);
        const refresh = root.querySelector('.panel-refresh-btn')!;
        refresh.dispatchEvent({ type: 'click', target: refresh });
        await Promise.resolve();
        assert.deepStrictEqual(asked, [[7, null, 200]]);
        for (const element of allElements(root))
            assert.equal(element.getAttribute('onclick'), null, `${element.tagName} carries an onclick`);
    });
});

describe('TradeHistoryWidget', () => {
    it('loads against whichever portfolio is active at refresh time', async () => {
        let active = 3;
        const { widget, root, asked } = tradeHistoryPanel(() => active, TRADES);
        await widget.refresh();
        assert.deepStrictEqual(asked, [[3, null, 200]]);
        // Most recent fill on top.
        assert.deepStrictEqual(rowKeys(root), ['12', '11']);

        active = 9;
        await widget.refresh();
        assert.deepStrictEqual(asked[1], [9, null, 200]);
    });

    it('does not call the API with no portfolio', async () => {
        const { widget, asked } = tradeHistoryPanel(() => null, TRADES);
        await widget.refresh();
        assert.deepStrictEqual(asked, []);
    });

    it('does not ask for somebody\'s trades on a session the host will not allow', async () => {
        // The panel has an account to load and no usable credential for it —
        // a page holding a stale portfolio id, say. Firing the request would
        // buy nothing but a 401.
        const { widget, asked, host } = tradeHistoryPanel(() => 4, TRADES);
        host.allow = () => false;
        await widget.refresh();
        assert.deepStrictEqual(asked, []);
    });

    it('settles the portfolio first, so a session with no account is quiet rather than prompted', async () => {
        // `allow` is the call that may put a sign-in prompt on screen, and
        // refresh runs unprompted (on boot, and on every fill). A guest has no
        // portfolio, so it must not get that far.
        const { widget, host } = tradeHistoryPanel(() => null, TRADES);
        await widget.refresh();
        assert.deepStrictEqual(host.calls.allowed, []);
    });

    it('reports a failed load through the host, where support can see it', async () => {
        const { widget, host } = tradeHistoryPanel(() => 4, TRADES);
        host.trading.api.getExecutions = () => Promise.reject(new Error('gateway timed out'));
        await widget.refresh();
        assert.equal(host.calls.logged.length, 1);
        assert.match(host.calls.logged[0], /TradeHistoryWidget: failed to load trade history: .*gateway timed out/);
    });

    it('reads "#42" but exports the bare id, on both id columns', async () => {
        const { widget, root } = tradeHistoryPanel(() => 3, TRADES);
        await widget.refresh();
        const first = painted(root)[0];
        assert.equal(first[0], '#12');
        assert.equal(first[6], '#502');
        assert.equal(cell(widget, '12', 'id').className, 'mono-id');

        const sheet = widget._grid!.exportData();
        assert.deepStrictEqual(sheet.headers, ['ID', 'Time', 'Sym', 'Side', 'Qty', 'Price', 'Order']);
        assert.deepStrictEqual(sheet.rows.map(r => [r[0], r[3], r[4], r[5], r[6]]), [
            [12, 'Sell', 3, 2000, 502],
            [11, 'Buy', 2, 100, 501],
        ]);
    });

    it('says so when there is nothing to show', () => {
        const { root } = tradeHistoryPanel(() => 3, []);
        assert.deepStrictEqual(painted(root), [['No trade history']]);
    });
});

// The same blotter over a finished run. There is no account to load from and
// nothing to reload, so the rows arrive from the consumer and the refresh
// gesture is not rendered — see the note on ActiveOrdersWidget's read-only mode.
describe('trade history, read-only', () => {
    const ROWS = [
        { id: 11, executedAt: '2024-03-01T18:20:00Z', instrumentSymbol: 'BTC/USD', side: 0, quantity: 2, price: 100, order: 501 },
        { id: 12, executedAt: '2024-03-02T00:25:00Z', instrumentSymbol: 'ETH/USD', side: 1, quantity: 3, price: 2000, order: 502 },
    ];

    function readOnlyPanel() {
        const parent = el('div');
        const host = fakeHost();
        let pulled = false;
        host.trading.api.getExecutions = () => { pulled = true; return Promise.resolve([]); };
        const widget = TradeHistoryWidget.create(asDom(parent), {}, { host, readOnly: true });
        return { widget, root: parent.childNodes[0] as FakeElement, host, wasPulled: () => pulled };
    }

    it('renders the rows it is handed, without asking the host for any', () => {
        const { widget, root, wasPulled } = readOnlyPanel();

        widget.update(ROWS.map(r => ({ ...r })));

        assert.deepStrictEqual(rowKeys(root), ['12', '11']);
        assert.equal(wasPulled(), false, 'a pushed blotter reads no account');
    });

    it('renders no refresh gesture', () => {
        const { root } = readOnlyPanel();

        assert.equal(root.querySelector('.panel-refresh-btn'), null, 'nothing to reload');
        assert.notEqual(root.querySelector('.panel-export-btn'), null, 'the table can still be exported');
    });

    it('says so when it is handed nothing', () => {
        const { widget, root } = readOnlyPanel();

        widget.update([]);

        assert.deepStrictEqual(painted(root), [['No trade history']]);
    });
});
