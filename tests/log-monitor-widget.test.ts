import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { asDom, el, installFakeDom, type FakeElement } from './fake-dom.js';
import { fakeHost } from './fake-host.js';
import { headerCaptions, painted, rowKeys } from './panel-probe.js';
import { LogLevels, type LogMessageRow, type LogSourceNode } from '../src/log-tree.js';
import { LogMonitorWidget } from '../src/log-monitor-widget.js';

installFakeDom();

const SOURCES: LogSourceNode[] = [
    { id: 'root', name: 'Terminal' },
    { id: 'conn', name: 'Binance', parentId: 'root' },
    { id: 'sma', name: 'SMA', parentId: 'conn' },
];

const MESSAGES: LogMessageRow[] = [
    { id: 1, time: '2024-03-01T10:00:00Z', level: LogLevels.Info, sourceId: 'root', message: 'started' },
    { id: 2, time: '2024-03-01T10:00:01Z', level: LogLevels.Error, sourceId: 'sma', message: 'order rejected' },
    { id: 3, time: '2024-03-01T10:00:02Z', level: LogLevels.Debug, sourceId: 'conn', message: 'socket frame' },
];

function monitor(maxMessages?: number) {
    const parent = el('div');
    const host = fakeHost();
    const widget = LogMonitorWidget.create(asDom(parent), {}, { host, maxMessages });
    widget.setSources(SOURCES.map(s => ({ ...s })));
    widget.append(MESSAGES.map(m => ({ ...m })));
    return { widget, root: parent.childNodes[0] as FakeElement, host };
}

describe('LogMonitorWidget', () => {
    it('shows where a line came from, when, at what level, and what it said', () => {
        const { root } = monitor();

        assert.deepStrictEqual(headerCaptions(root), ['Source', 'Time', 'Type', 'Message']);
    });

    it('names the source of a line that did not carry its own name', () => {
        const { root } = monitor();
        const sources = painted(root).map(cells => cells[0]);

        assert.deepStrictEqual(sources, ['Terminal', 'SMA', 'Binance']);
    });

    it('gives every level a letter, Info included', () => {
        const { root } = monitor();

        assert.deepStrictEqual(painted(root).map(cells => cells[2]), ['I', 'E', 'D']);
    });

    it('lists every source as a row, indented by depth, under an entry for all of them', () => {
        const { root } = monitor();
        const rows = root.querySelectorAll('.log-source');

        assert.deepStrictEqual(rows.map(r => r.textContent), ['AllSources', 'Terminal', 'Binance', 'SMA']);
        assert.ok((rows[3].getAttribute('style') ?? '').includes('2.2'), 'SMA sits two levels in');
    });

    it('shows a node and everything under it when one is selected', () => {
        const { widget, root } = monitor();

        widget.select('conn');

        assert.deepStrictEqual(rowKeys(root), ['2', '3'], 'the connector and the strategy under it');
    });

    it('goes back to everything when the selection is cleared', () => {
        const { widget, root } = monitor();

        widget.select('sma');
        widget.select(null);

        assert.deepStrictEqual(rowKeys(root), ['1', '2', '3']);
    });

    it('drops a selection whose source has gone', () => {
        const { widget, root } = monitor();

        widget.select('sma');
        widget.setSources([{ id: 'root', name: 'Terminal' }]);

        assert.deepStrictEqual(rowKeys(root), ['1', '2', '3'], 'not an empty table under a node nobody can see');
    });

    it('hides a level when its toggle is turned off, and brings it back', () => {
        const { root } = monitor();
        const debug = root.querySelector('.log-level-debug')!;

        debug.dispatchEvent({ type: 'click', target: debug });
        assert.deepStrictEqual(rowKeys(root), ['1', '2']);
        assert.equal(debug.getAttribute('aria-pressed'), 'false');

        debug.dispatchEvent({ type: 'click', target: debug });
        assert.deepStrictEqual(rowKeys(root), ['1', '2', '3']);
    });

    it('keeps only what the typed text matches', () => {
        const { root } = monitor();
        const filter = root.querySelector('.log-filter')!;

        filter.value = 'REJECT';
        filter.dispatchEvent({ type: 'input', target: filter });

        assert.deepStrictEqual(rowKeys(root), ['2']);
    });

    it('forgets the messages on clear and keeps the sources', () => {
        const { widget, root } = monitor();

        widget.clear();

        assert.deepStrictEqual(painted(root), [['NoLogMessages']]);
        assert.equal(root.querySelectorAll('.log-source').length, 4, 'a quiet source still exists');
    });

    it('drops the oldest once it is full, rather than growing without end', () => {
        const { widget } = monitor(2);

        widget.append([{ id: 4, time: '2024-03-01T10:00:03Z', level: LogLevels.Info, sourceId: 'root', message: 'later' }]);

        assert.deepStrictEqual(widget.visible().map(m => m.id), [3, 4]);
    });

    it('words its times through the host, like every other control', () => {
        const parent = el('div');
        const host = fakeHost();
        host.presentation.timeText = () => 'worded';
        const widget = LogMonitorWidget.create(asDom(parent), {}, { host });
        widget.setSources(SOURCES);
        widget.append([MESSAGES[0]]);

        const root = parent.childNodes[0] as FakeElement;
        assert.equal(painted(root)[0][1], 'worded');
    });
});
