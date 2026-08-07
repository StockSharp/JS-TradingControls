import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { asDom, asFake, el, installFakeDom, type FakeElement } from './fake-dom.js';
import { fakeHost } from './fake-host.js';
import { allElements, painted } from './panel-probe.js';
import { WatchlistWidget } from '../src/watchlist-widget.js';
import type { InstrumentRow } from '../src/trading-data.js';

installFakeDom();

type Watchlist = InstanceType<typeof WatchlistWidget>;

const INSTRUMENTS: InstrumentRow[] = [
    { symbol: 'ETH@IMEX', exchange: 'IMEX', name: 'Ether' },
    { symbol: 'BTC@IMEX', exchange: 'IMEX', name: 'Bitcoin' },
    { symbol: 'SOL@IMEX', exchange: 'IMEX', name: 'Solana', category: 'Alt' },
];

function watchlistPanel() {
    const parent = el('div');
    const selected: string[] = [];
    // isPrimary defaults true on the fake host — only the instance that speaks
    // for the page publishes to the ticker, and that is the host's decision.
    const host = fakeHost();
    host.trading.api.searchInstruments = () => Promise.resolve(INSTRUMENTS);
    const widget = WatchlistWidget.create(asDom(parent), {}, {
        host,
        onSelect: (sym) => selected.push(sym),
    });
    // The constructor's own load is asynchronous; the fixture states the data
    // synchronously so every assertion below reads a settled panel.
    widget.instruments = INSTRUMENTS;
    widget._renderCategoryTabs();
    widget._render();
    return { widget, root: parent.childNodes[0] as FakeElement, selected, published: host.calls.published, host };
}

function wlBody(root: FakeElement): FakeElement { return root.querySelector('.watchlist-body')!; }

function wlRows(root: FakeElement): FakeElement[] { return wlBody(root).childNodes as FakeElement[]; }

function cell(widget: Watchlist, rowKey: string, column: string): FakeElement {
    return asFake(widget._grid!.cellElement(rowKey, column));
}

describe('WatchlistWidget builds its own panel', () => {
    it('renders the shell a host stylesheet and a docking host both read', () => {
        const { root } = watchlistPanel();
        assert.equal(root.className, 'terminal-panel watchlist-panel');
        assert.equal(root.getAttribute('aria-label'), 'Watchlist');
        assert.equal(root.querySelector('.panel-header')!.childNodes[0].textContent, 'Markets');

        // The search row is a sibling of the header, not a child: a docking host
        // lifts the two into its tab strip separately.
        const search = root.querySelector('.watchlist-search')!;
        assert.equal(search.parentNode!.className, 'watchlist-search-row');
        assert.equal(search.parentNode!.parentNode, root);
        assert.equal(search.getAttribute('placeholder'), 'SearchInstruments');
        assert.equal(search.getAttribute('aria-label'), 'SearchInstruments');
        assert.equal(search.getAttribute('autocomplete'), 'off');
    });

    it('starts with the two built-in tabs and appends one per category', () => {
        const { root } = watchlistPanel();
        const tabs = root.querySelector('.watchlist-tabs')!;
        assert.equal(tabs.getAttribute('role'), 'tablist');
        assert.deepStrictEqual(tabs.querySelectorAll('.wl-tab').map(b => b.textContent), ['All', '★', 'Alt']);
        assert.deepStrictEqual(tabs.querySelectorAll('.wl-tab').map(b => b.dataset.filter), ['all', 'favorites', 'Alt']);
        // "All" is the resting filter and says so.
        assert.equal(tabs.querySelectorAll('.wl-tab')[0]!.classList.contains('active'), true);
    });

    it('switching tab filters through the strip, with nothing to click but the panel', () => {
        const { widget, root } = watchlistPanel();
        for (const element of allElements(root))
            assert.equal(element.getAttribute('onclick'), null, `${element.tagName} carries an onclick`);

        const tabs = root.querySelector('.watchlist-tabs')!.querySelectorAll('.wl-tab');
        const alt = tabs[2]!;
        alt.dispatchEvent({ type: 'click', target: alt });
        assert.deepStrictEqual(wlRows(root).map(tr => tr.dataset.rowKey), ['SOL@IMEX']);
        assert.equal(alt.classList.contains('active'), true);
        assert.equal(tabs[0]!.classList.contains('active'), false);

        // The built-in tabs declare their filter as a `data-filter` ATTRIBUTE
        // while the category tabs write it through `dataset`; the click handler
        // reads only the latter, so a built-in tab is the case that proves the
        // two are one thing.
        const favorites = tabs[1]!;
        widget.favorites.add('ETH@IMEX');
        favorites.dispatchEvent({ type: 'click', target: favorites });
        assert.deepStrictEqual(wlRows(root).map(tr => tr.dataset.rowKey), ['ETH@IMEX']);
    });
});

describe('WatchlistWidget', () => {
    it('renders its own right-aligned numeric headers', () => {
        const { root } = watchlistPanel();
        const ths = (root.querySelector('.watchlist-headers')!.childNodes[0] as FakeElement).childNodes as FakeElement[];
        assert.deepStrictEqual(ths.map(th => th.textContent), ['Symbol', 'Last', 'Change24hPct']);
        assert.deepStrictEqual(ths.map(th => th.classList.contains('ta-right')), [false, true, true]);
        // The resting sort is visible from the first paint, not only after a click.
        assert.equal(ths[0]!.classList.contains('sort-asc'), true);
    });

    it('sorts A→Z and shows the short symbol with a favourite star', () => {
        const { root } = watchlistPanel();
        assert.deepStrictEqual(wlRows(root).map(tr => tr.dataset.rowKey), ['BTC@IMEX', 'ETH@IMEX', 'SOL@IMEX']);
        const symCell = wlRows(root)[0]!.childNodes[0] as FakeElement;
        assert.equal(symCell.textContent, '★BTC');
        assert.equal((symCell.childNodes[1] as FakeElement).className, 'wl-sym');
    });

    it('clicking a row picks the instrument; the star does not', () => {
        const { widget, root, selected } = watchlistPanel();
        const row = wlRows(root)[1]!;
        row.dispatchEvent({ type: 'click' });
        assert.deepStrictEqual(selected, ['ETH@IMEX']);

        ((row.childNodes[0] as FakeElement).childNodes[0] as FakeElement).dispatchEvent({ type: 'click' });
        assert.deepStrictEqual(selected, ['ETH@IMEX']);
        assert.equal(widget.favorites.has('ETH@IMEX'), true);
    });

    it('patches a quoted row in place, keeping the flash the repaint would kill', () => {
        const { widget, root } = watchlistPanel();
        widget.onPriceUpdate('BTC@IMEX', 100);
        const before = wlRows(root)[0]!;
        widget.onPriceUpdate('BTC@IMEX', 110);

        assert.strictEqual(wlRows(root)[0], before, 'the row element must survive the update');
        assert.equal(cell(widget, 'BTC@IMEX', 'last').textContent, '110.00');
        assert.equal(cell(widget, 'BTC@IMEX', 'last').classList.contains('flash-up'), true);
        assert.equal(cell(widget, 'BTC@IMEX', 'chgPct').textContent, '+10.00%');
        assert.equal(cell(widget, 'BTC@IMEX', 'chgPct').classList.contains('up'), true);
    });

    it('shows -- for an instrument nothing has quoted yet', () => {
        const { root } = watchlistPanel();
        assert.deepStrictEqual(painted(root)[0]!.slice(1), ['--', '--']);
    });

    it('filters on the qualified display form, not just the bare symbol', () => {
        const { widget, root } = watchlistPanel();
        widget.search = 'btc/imex';
        widget._render();
        assert.deepStrictEqual(wlRows(root).map(tr => tr.dataset.rowKey), ['BTC@IMEX']);

        widget.search = '';
        widget.filter = 'alt';
        widget._render();
        assert.deepStrictEqual(wlRows(root).map(tr => tr.dataset.rowKey), ['SOL@IMEX']);
    });

    it('exports the filtered set with the short symbol and raw figures', () => {
        const { widget } = watchlistPanel();
        widget.onPriceUpdate('BTC@IMEX', 100);
        const sheet = widget._grid!.exportData();
        assert.deepStrictEqual(sheet.headers, ['Symbol', 'Last', 'Change24hPct']);
        assert.deepStrictEqual(sheet.rows, [['BTC', 100, 0], ['ETH', '', ''], ['SOL', '', '']]);
    });

    it('paints a screenful but exports and publishes the whole filtered set', () => {
        const { root, published } = watchlistPanel();
        assert.equal(WatchlistWidget.RENDER_CAP > INSTRUMENTS.length, true);
        assert.equal(wlRows(root).length, 3);
        // A host feeds its ticker from this; it is the visible set, not the
        // painted one, and the control no longer reaches for a ticker itself.
        assert.deepStrictEqual(published.at(-1), ['BTC@IMEX', 'ETH@IMEX', 'SOL@IMEX']);
    });

    it('republishes on a sort the control was never told about', () => {
        const { root, published } = watchlistPanel();
        const headers = root.querySelector('.watchlist-headers')!;
        const symbolHeader = headers.querySelectorAll('[data-sort]').find(th => th.dataset.sort === 'symbol')!;
        headers.dispatchEvent({ type: 'click', target: symbolHeader });
        headers.dispatchEvent({ type: 'click', target: symbolHeader });

        assert.deepStrictEqual(published.at(-1), ['SOL@IMEX', 'ETH@IMEX', 'BTC@IMEX']);
    });

    it('moves the current-symbol highlight without repainting', () => {
        const { widget, root } = watchlistPanel();
        // The class names alone would look the same after a full repaint; it is the
        // row elements surviving that says the highlight was patched onto the rows
        // already on screen, which is what keeps a running flash animation alive.
        const before = wlRows(root).slice();
        const stillOnScreen = () => {
            const now = wlRows(root);
            assert.equal(now.length, before.length, 'the rows must survive the highlight');
            before.forEach((tr, i) => assert.strictEqual(now[i], tr, 'the rows must survive the highlight'));
        };

        widget.setCurrentSymbol('ETH@IMEX');
        stillOnScreen();
        assert.equal(before[1]!.className, 'wl-row wl-current');

        widget.setCurrentSymbol('SOL@IMEX');
        stillOnScreen();
        assert.equal(before[1]!.className, 'wl-row');
        assert.equal(before[2]!.classList.contains('wl-current'), true);
    });

    it('says so when nothing matches the filter', () => {
        const { widget, root } = watchlistPanel();
        widget.search = 'nothing-like-this';
        widget._render();
        assert.deepStrictEqual(painted(root), [['No instruments']]);
    });

    it('refuses to wire up without the callback that makes it a watchlist', () => {
        assert.throws(
            () => WatchlistWidget.create(asDom(el('div')), {}, { host: fakeHost() } as never),
            /dep "onSelect" is required/);
    });

    it('reports a failed instrument load through the host, where support can see it', async () => {
        const host = fakeHost();
        host.trading.api.searchInstruments = () => Promise.reject(new Error('search is down'));
        const widget = WatchlistWidget.create(asDom(el('div')), {}, { host, onSelect: () => { } });
        await widget.init();
        assert.equal(host.calls.logged.length > 0, true, 'the failure has to reach the port');
        assert.match(host.calls.logged[0], /WatchlistWidget: failed to load instruments: .*search is down/);
        assert.deepStrictEqual(widget.instruments, [], 'and the panel stays empty rather than half-loaded');
    });
});
