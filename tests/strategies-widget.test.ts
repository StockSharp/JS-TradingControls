import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { asDom, asFake, el, installFakeDom, type FakeElement } from './fake-dom.js';
import { fakeHost } from './fake-host.js';
import { headerCaptions, painted, rowKeys } from './panel-probe.js';
import { StrategiesWidget, StrategyStates, type StrategiesActions, type StrategyRow } from '../src/strategies-widget.js';

installFakeDom();

/// One strategy stopped, one running with a position and a curve, one that failed — the three
/// states the row's buttons and colours branch on.
const ROWS: StrategyRow[] = [
    {
        id: 'sma', name: 'SMA crossover', state: StrategyStates.Started, online: true,
        tradingMode: 'Full', portfolio: 'Sim', security: 'BTCUSDT@BNBFT',
        position: 1.5, ordersCount: 12, tradesCount: 8, pnlChange: 120.5,
        realized: 90, unrealized: 30.5,
        pnl: [{ time: 0, value: 0 }, { time: 10, value: 60 }, { time: 20, value: 120.5 }],
    },
    { id: 'rsi', name: 'RSI', state: StrategyStates.Stopped, online: false, position: 0, pnlChange: 0 },
    { id: 'bad', name: 'Broken', state: StrategyStates.Stopped, error: 'no market data' },
];

type Call = [string, ...unknown[]];

function dashboard(actions: StrategiesActions = {}, rows = ROWS) {
    const parent = el('div');
    const host = fakeHost();
    const widget = StrategiesWidget.create(asDom(parent), {}, {
        host,
        tradingModes: ['Full', 'CancelOrders', 'Disabled'],
        ...actions,
    });
    widget.update(rows.map(r => ({ ...r })));
    return { widget, root: parent.childNodes[0] as FakeElement, host };
}

function cell(widget: InstanceType<typeof StrategiesWidget>, rowKey: string, column: string): FakeElement {
    return asFake(widget._grid!.cellElement(rowKey, column)!);
}

describe('StrategiesWidget', () => {
    it('shows what a strategy is, what it is doing and what it has made', () => {
        const { root } = dashboard();

        assert.deepStrictEqual(headerCaptions(root), [
            'State', 'Actions', 'Online', 'Trading', 'Name', 'Portfolio', 'Sym',
            'Position', 'OrderCount', 'NumOfTrades', 'PnLChange', 'PnLChart',
            'RealizedProfit', 'UnrealizedProfit', 'Error',
        ]);
    });

    it('reads down by name, so a list of twenty can be searched by eye', () => {
        const { root } = dashboard();

        assert.deepStrictEqual(rowKeys(root), ['bad', 'rsi', 'sma']);
    });

    it('says the state in words as well as in colour', () => {
        const { widget } = dashboard();

        assert.ok(cell(widget, 'sma', 'state').textContent.includes('Started'));
        assert.ok(cell(widget, 'rsi', 'state').textContent.includes('Stopped'));
    });

    it('offers no button for something the host cannot do', () => {
        const { widget } = dashboard({});

        assert.equal(cell(widget, 'sma', 'actions').childNodes.length, 0, 'a read-only dashboard shows no controls');
    });

    it('offers exactly the actions the host declared', () => {
        const calls: Call[] = [];
        const { widget } = dashboard({
            start: (id) => calls.push(['start', id]),
            stop: (id) => calls.push(['stop', id]),
        });

        const running = cell(widget, 'sma', 'actions');
        assert.equal(running.childNodes.length, 2, 'start and stop, and nothing for open or risk');
    });

    it('leaves Start dead on a running strategy and Stop dead on a stopped one', () => {
        const calls: Call[] = [];
        const { widget } = dashboard({
            start: (id) => calls.push(['start', id]),
            stop: (id) => calls.push(['stop', id]),
        });

        const start = cell(widget, 'sma', 'actions').querySelector('.strategy-start-btn')!;
        const stop = cell(widget, 'sma', 'actions').querySelector('.strategy-stop-btn')!;

        assert.ok(start.disabled, 'it is already running');
        assert.ok(!stop.disabled, 'and can be stopped');

        stop.dispatchEvent({ type: 'click', target: stop });
        assert.deepStrictEqual(calls, [['stop', 'sma']]);
    });

    it('flattens only a running strategy that holds something', () => {
        const calls: Call[] = [];
        const { widget } = dashboard({ closePosition: (id) => calls.push(['close', id]) });

        const holding = cell(widget, 'sma', 'position').querySelector('.strategy-flatten-btn')!;
        const flat = cell(widget, 'rsi', 'position').querySelector('.strategy-flatten-btn')!;

        assert.equal(flat.disabled, true, 'nothing to close');
        holding.dispatchEvent({ type: 'click', target: holding });
        assert.deepStrictEqual(calls, [['close', 'sma']]);
    });

    it('edits the trading mode only when the host can carry the change out', () => {
        const calls: Call[] = [];
        // `rsi` is the stopped one: the mode is what a run will be started with, so it is
        // offered on the same terms start is.
        const withSetter = dashboard({ setTradingMode: (id, mode) => calls.push(['mode', id, mode]) });
        const select = cell(withSetter.widget, 'rsi', 'tradingMode').querySelector('select')!;

        select.value = 'Disabled';
        select.dispatchEvent({ type: 'change', target: select });
        assert.deepStrictEqual(calls, [['mode', 'rsi', 'Disabled']]);

        const readOnly = dashboard({});
        assert.equal(cell(readOnly.widget, 'sma', 'tradingMode').querySelector('select'), null);
        assert.equal(cell(readOnly.widget, 'sma', 'tradingMode').textContent, 'Full');
    });

    it('will not let the mode be changed under a run that is trading', () => {
        // Same rule as the buttons beside it: start is offered on a stopped run, stop on a
        // started one, and the mode - which is what the next run begins with - on a stopped one.
        const calls: Call[] = [];
        const { widget } = dashboard({ setTradingMode: (id, mode) => calls.push(['mode', id, mode]) });

        const running = cell(widget, 'sma', 'tradingMode').querySelector('select')!;
        assert.equal(running.disabled, true);

        running.value = 'Disabled';
        running.dispatchEvent({ type: 'change', target: running });
        assert.deepStrictEqual(calls, [], 'and a change forced onto it reaches no host');

        assert.equal(cell(widget, 'rsi', 'tradingMode').querySelector('select')!.disabled, false);
    });

    it('says a failed run failed, and carries the reason where a reader looks', () => {
        const { widget } = dashboard({});
        const state = cell(widget, 'bad', 'state');
        const text = state.querySelector('.strategy-state-text')!;
        const dot = state.querySelector('.strategy-dot')!;

        assert.equal(text.textContent, 'Error', 'not "Stopped" with only a colour to tell them apart');
        assert.equal(text.title, 'no market data');
        assert.equal(dot.title, 'no market data', 'the dot is what the eye goes to first');

        // A run stopped with nothing wrong reads as an ordinary stop.
        const clean = cell(widget, 'rsi', 'state');
        assert.equal(clean.querySelector('.strategy-state-text')!.textContent, 'Stopped');
    });

    it('draws the P&L curve in the colour the run ended in', () => {
        const { widget } = dashboard();
        const canvas = cell(widget, 'sma', 'pnlChart').querySelector('canvas')!;
        const ctx = canvas.getContext('2d')!;

        const strokes = ctx.calls.filter(c => c.op === 'stroke');
        assert.ok(strokes.length >= 2, 'the baseline and the curve');
        // Every recorded call carries the style in force when it was made, so the curve's own
        // stroke says which direction colour it took.
        const palette = widget._host.presentation.canvasPalette();
        const colours = strokes.map(c => c.strokeStyle);
        assert.ok(colours.includes(palette.up), `a winning run is drawn up: ${colours.join(', ')}`);
        assert.ok(!colours.includes(palette.down));
    });

    it('draws no curve for a strategy that has not traded', () => {
        const { widget } = dashboard();

        assert.equal(cell(widget, 'rsi', 'pnlChart').querySelector('canvas'), null);
    });

    it('shows a direction beside a change, and none when nothing changed', () => {
        const { widget } = dashboard();

        assert.ok(cell(widget, 'sma', 'pnlChange').textContent.startsWith('▲'));
        assert.ok(!cell(widget, 'rsi', 'pnlChange').textContent.includes('▲'));
        assert.ok(!cell(widget, 'rsi', 'pnlChange').textContent.includes('▼'));
    });

    it('carries the last error, and marks the row that has one', () => {
        const { widget, root } = dashboard();

        assert.equal(cell(widget, 'bad', 'error').textContent, 'no market data');
        const row = root.querySelectorAll('tr').find(r => r.dataset.rowKey === 'bad')!;
        assert.ok((row.className ?? '').includes('strategy-failed'));
    });

    it('says so when nothing is running', () => {
        const { root } = dashboard({}, []);

        assert.deepStrictEqual(painted(root), [['NoStrategies']]);
    });
});
