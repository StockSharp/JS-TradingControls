import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { asDom, el, installFakeDom, type FakeElement } from './fake-dom.js';
import { fakeHost } from './fake-host.js';
import { body, headerCaptions, painted, rowKeys } from './panel-probe.js';
import type { StatisticRow } from '../src/index.js';
import { StatisticsWidget } from '../src/statistics-widget.js';

installFakeDom();

/// A strategy's statistics as the desktop grid shows them: a localized name, a value of
/// whatever type the parameter is, and the category and order that decide where the row sits.
/// The order values are banded by category the way the registry assigns them — P&L below 100,
/// trades from 100, positions from 200 — so a row's place does not depend on its category
/// string, which is translated.
const ROWS: StatisticRow[] = [
    { key: 'MaxDrawdown', category: 'pnl', categoryText: 'P&L', order: 4, name: 'Max drawdown', description: 'The largest fall from a peak', value: 5395.25 },
    { key: 'TradeCount', category: 'trades', categoryText: 'Trades', order: 100, name: 'Trade count', description: 'How many trades were made', value: 1340 },
    { key: 'NetProfit', category: 'pnl', categoryText: 'P&L', order: 1, name: 'Net profit', description: 'What the run made', value: 11055.75 },
    { key: 'MaxProfitDate', category: 'pnl', categoryText: 'P&L', order: 2, name: 'Max profit date', description: 'When the peak was reached', value: '2024-03-26T07:30:00Z' },
];

/// Only the parameter rows: with grouping on, the body also holds a caption row per category,
/// and those carry no row key.
function dataRows(root: FakeElement): { key: string; cells: string[] }[] {
    const keys = rowKeys(root);
    return painted(root)
        .map((cells, i) => ({ key: keys[i], cells }))
        .filter((r): r is { key: string; cells: string[] } => r.key !== undefined);
}

function panel(rows: StatisticRow[] = ROWS) {
    const parent = el('div');
    const host = fakeHost();
    const widget = StatisticsWidget.create(asDom(parent), {}, { host });
    widget.update(rows.map(r => ({ ...r })));
    return { widget, root: parent.childNodes[0] as FakeElement, host };
}

describe('StatisticsWidget', () => {
    it('shows a name and a value, and nothing else', () => {
        const { root } = panel();

        assert.deepStrictEqual(headerCaptions(root), ['Name', 'Value']);
    });

    it('orders rows by the registry order, not by name or by value', () => {
        const { root } = panel();

        // Within P&L: NetProfit (1), MaxProfitDate (2), MaxDrawdown (4). Trades follows.
        assert.deepStrictEqual(dataRows(root).map(r => r.key), ['NetProfit', 'MaxProfitDate', 'MaxDrawdown', 'TradeCount']);
    });

    it('groups by category, and groups on the key rather than on the translated text', () => {
        const { widget, root } = panel();

        assert.equal(widget._grid!.groupedBy(), 'category');
        // The caption a reader sees is the translated one; the grouping key is not.
        const captions = (body(root).childNodes as FakeElement[])
            .filter(n => (n.className ?? '').includes('grid-group'))
            .map(n => n.textContent ?? '');
        assert.ok(captions.some(c => c.includes('P&L')), `group captions were: ${captions.join(' | ')}`);
    });

    it("lays the groups out in the registry order, not in the alphabet", () => {
        // P&L before Trades before Positions before Orders — which is the order their
        // parameters carry, and the reverse of what grouping on the category name gives.
        const { root } = panel([
            { key: 'OrderCount', category: 'orders', categoryText: 'Orders', order: 300, name: 'Order count', value: 1 },
            { key: 'TradeCount', category: 'trades', categoryText: 'Trades', order: 100, name: 'Trade count', value: 2 },
            { key: 'NetProfit', category: 'pnl', categoryText: 'P&L', order: 1, name: 'Net profit', value: 3 },
            { key: 'MaxLong', category: 'positions', categoryText: 'Positions', order: 200, name: 'Max long', value: 4 },
        ]);

        const captions = (body(root).childNodes as FakeElement[])
            .filter(n => (n.className ?? '').includes('grid-group'))
            .map(n => (n.textContent ?? '').replace(/[^A-Za-z&]/g, ''));

        assert.deepStrictEqual(captions, ['P&L', 'Trades', 'Positions', 'Orders']);
    });

    it('rounds a number to two places and leaves a whole one whole', () => {
        const { root } = panel([
            { key: 'A', category: 'pnl', categoryText: 'P&L', order: 1, name: 'Fractional', description: '', value: 1.23456 },
            { key: 'B', category: 'pnl', categoryText: 'P&L', order: 2, name: 'Whole', description: '', value: 42 },
        ]);

        assert.deepStrictEqual(dataRows(root).map(r => r.cells[r.cells.length - 1]), ['1.23', '42']);
    });

    it('shows a date as a date', () => {
        const { root } = panel([
            { key: 'D', category: 'pnl', categoryText: 'P&L', order: 1, name: 'When', description: '', value: '2024-03-26T07:30:00Z' },
        ]);

        const [row] = dataRows(root);
        assert.equal(row.cells[row.cells.length - 1], '2024-03-26');
    });

    it('leaves a cell empty when the parameter has no value yet', () => {
        const { root } = panel([
            { key: 'N', category: 'pnl', categoryText: 'P&L', order: 1, name: 'Not yet', description: '', value: null },
        ]);

        const [row] = dataRows(root);
        assert.equal(row.cells[row.cells.length - 1], '');
    });

    it('carries the description as the name cell\'s tooltip', () => {
        const { widget } = panel();
        const cell = widget._grid!.cellElement('NetProfit', 'name');

        assert.equal((cell as unknown as FakeElement).getAttribute('title'), 'What the run made');
    });

    it('says so when a run produced no statistics', () => {
        const { root } = panel([]);

        assert.deepStrictEqual(painted(root), [['NoStatistics']]);
    });

    it('replaces the whole set on update, keeping row identity by key', () => {
        const { widget, root } = panel();

        widget.update([{ key: 'NetProfit', category: 'pnl', categoryText: 'P&L', order: 1, name: 'Net profit', description: '', value: 99 }]);

        assert.deepStrictEqual(dataRows(root).map(r => r.key), ['NetProfit']);
        assert.deepStrictEqual(dataRows(root).map(r => r.cells[r.cells.length - 1]), ['99']);
    });
});
