import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { LogLevels, buildLogTree, keepLog, subtreeOf, type LogMessageRow, type LogSourceNode } from '../src/log-tree.js';

/// A connector under the root, a strategy under it, and a second strategy beside it — enough
/// for the one thing the tree is for: selecting a node shows what it and everything under it
/// said, and selecting its sibling shows none of that.
const SOURCES: LogSourceNode[] = [
    { id: 'root', name: 'Terminal' },
    { id: 'conn', name: 'Binance', parentId: 'root' },
    { id: 'sma', name: 'SMA crossover', parentId: 'conn' },
    { id: 'rsi', name: 'RSI', parentId: 'root' },
];

const MESSAGES: LogMessageRow[] = [
    { id: 1, time: 10, level: LogLevels.Info, sourceId: 'root', message: 'started' },
    { id: 2, time: 20, level: LogLevels.Error, sourceId: 'sma', message: 'order rejected' },
    { id: 3, time: 30, level: LogLevels.Debug, sourceId: 'conn', message: 'socket frame' },
    { id: 4, time: 40, level: LogLevels.Warning, sourceId: 'rsi', message: 'no data' },
];

describe('buildLogTree', () => {
    it('nests each source under its parent, roots first', () => {
        const tree = buildLogTree(SOURCES);

        assert.deepStrictEqual(tree.map(n => n.id), ['root']);
        assert.deepStrictEqual(tree[0].children.map(n => n.id), ['conn', 'rsi']);
        assert.deepStrictEqual(tree[0].children[0].children.map(n => n.id), ['sma']);
    });

    it('carries depth, so a flat list can render an indent', () => {
        const tree = buildLogTree(SOURCES);

        assert.equal(tree[0].depth, 0);
        assert.equal(tree[0].children[0].depth, 1);
        assert.equal(tree[0].children[0].children[0].depth, 2);
    });

    it('roots a source whose parent it has never been told about', () => {
        // A strategy can announce itself before the connector that owns it does.
        const tree = buildLogTree([{ id: 'orphan', name: 'Lost', parentId: 'never-seen' }]);

        assert.deepStrictEqual(tree.map(n => n.id), ['orphan']);
    });

    it('does not hang on sources that claim each other as parents', () => {
        // What matters is not where a cycle ends up but that it ends: every source is placed,
        // exactly once, and nothing under it points back at it.
        const tree = buildLogTree([
            { id: 'a', name: 'A', parentId: 'b' },
            { id: 'b', name: 'B', parentId: 'a' },
        ]);

        const placed: string[] = [];
        const walk = (nodes: typeof tree, seen: string[]): void => {
            for (const n of nodes) {
                assert.ok(!seen.includes(n.id), `${n.id} sits under itself`);
                placed.push(n.id);
                walk(n.children, [...seen, n.id]);
            }
        };
        walk(tree, []);

        assert.deepStrictEqual(placed.slice().sort(), ['a', 'b']);
    });

    it('shows a dash for a source that reported no name', () => {
        assert.equal(buildLogTree([{ id: 'x', name: '' }])[0].name, '—');
    });
});

describe('subtreeOf', () => {
    it('is the node and everything under it', () => {
        assert.deepStrictEqual([...subtreeOf(SOURCES, 'conn')!].sort(), ['conn', 'sma']);
        assert.deepStrictEqual([...subtreeOf(SOURCES, 'root')!].sort(), ['conn', 'root', 'rsi', 'sma']);
        assert.deepStrictEqual([...subtreeOf(SOURCES, 'rsi')!].sort(), ['rsi']);
    });

    it('is everything when nothing is selected', () => {
        assert.equal(subtreeOf(SOURCES, null), null, 'null means no filtering at all');
    });
});

describe('keepLog', () => {
    const all = new Set([LogLevels.Error, LogLevels.Warning, LogLevels.Info, LogLevels.Debug, LogLevels.Verbose]);

    it('keeps everything when every level is on and nothing is typed', () => {
        const kept = MESSAGES.filter(m => keepLog(m, { levels: all, text: '', sources: null }));

        assert.equal(kept.length, 4);
    });

    it('keeps only the levels that are on', () => {
        const kept = MESSAGES.filter(m => keepLog(m, { levels: new Set([LogLevels.Error]), text: '', sources: null }));

        assert.deepStrictEqual(kept.map(m => m.id), [2]);
    });

    it('matches the typed text anywhere in the message, ignoring case', () => {
        const kept = MESSAGES.filter(m => keepLog(m, { levels: all, text: 'REJECT', sources: null }));

        assert.deepStrictEqual(kept.map(m => m.id), [2]);
    });

    it('keeps a subtree: the node selected and everything below it', () => {
        const kept = MESSAGES.filter(m => keepLog(m, { levels: all, text: '', sources: subtreeOf(SOURCES, 'conn') }));

        assert.deepStrictEqual(kept.map(m => m.id), [2, 3]);
    });

    it('applies every filter together, not whichever is narrowest', () => {
        const kept = MESSAGES.filter(m => keepLog(m, {
            levels: new Set([LogLevels.Error, LogLevels.Debug]),
            text: 'socket',
            sources: subtreeOf(SOURCES, 'conn'),
        }));

        assert.deepStrictEqual(kept.map(m => m.id), [3]);
    });
});
