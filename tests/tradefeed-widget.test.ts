import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { asDom, asFake, el, installFakeDom, resizeObservers, type FakeElement } from './fake-dom.js';
import { fakeHost } from './fake-host.js';
import { allElements } from './panel-probe.js';
import { formatPrice } from '../src/formatters.js';
import { TradeFeedWidget } from '../src/tradefeed-widget.js';
import type { TradeRow } from '../src/trading-data.js';

installFakeDom();

const TAPE: TradeRow[] = [
    { id: 3, symbol: 'BTC@IMEX', side: 'Buy', price: 68420.5, quantity: 0.25, time: '2026-04-30T12:00:03Z' },
    { id: 2, symbol: 'BTC@IMEX', side: 'Sell', price: 68410.0, quantity: 0.1, time: '2026-04-30T12:00:02Z' },
    { id: 1, symbol: 'BTC@IMEX', side: 0, price: 68400.0, quantity: 1.5, time: '2026-04-30T12:00:01Z' },
];

interface Subscription {
    op: string;
    symbol: string;
    level: string;
}

function tradeFeedPanel(state: Record<string, unknown> = {}) {
    const parent = el('div');
    const host = fakeHost();
    const subscriptions: Subscription[] = [];
    const picked: ((symbol: string) => void)[] = [];
    host.trading.marketData.addSymbol = (symbol, level) => {
        subscriptions.push({ op: 'add', symbol, level });
        return Promise.resolve(true);
    };
    host.trading.marketData.removeSymbol = (symbol) => {
        subscriptions.push({ op: 'remove', symbol, level: '' });
        return Promise.resolve(true);
    };
    host.trading.pickInstrument = (onPicked) => picked.push(onPicked);

    const widget = TradeFeedWidget.create(asDom(parent), state, { host });
    const root = parent.childNodes[0] as FakeElement;
    // Nothing lays anything out here, so the canvas is told how big it is —
    // otherwise every bubble lands in a one-pixel box.
    asFake(widget.bubbleCanvas).setRect({ left: 0, top: 0, width: 400, height: 200 });
    return { widget, root, host, subscriptions, picked };
}

function rows(root: FakeElement): FakeElement[] {
    return root.querySelector('.tf-market')!.childNodes as FakeElement[];
}

function cells(row: FakeElement): string[] {
    return (row.childNodes as FakeElement[]).map(c => c.className);
}

function button(root: FakeElement, selector: string): FakeElement {
    return root.querySelector(selector)!;
}

function click(element: FakeElement): void {
    element.dispatchEvent({ type: 'click', target: element });
}

function context(widget: TradeFeedWidget) {
    return asFake(widget.bubbleCanvas).getContext('2d')!;
}

function showBubbles(root: FakeElement): void {
    click(root.querySelectorAll('.tf-view-btn')[1]!);
}

describe('TradeFeedWidget builds its own panel', () => {
    it('renders the shell a host stylesheet and a docking host both read', () => {
        const { root } = tradeFeedPanel();
        assert.equal(root.className, 'terminal-panel tradefeed-panel tf-tab-market tf-view-list');
        assert.equal(root.getAttribute('role'), 'region');
        assert.equal(root.getAttribute('aria-label'), 'TradeFeed');
        assert.equal(root.querySelector('.panel-header')!.childNodes[0].textContent, 'MarketTrades');
        // The two panes and the canvas the stylesheet shows one of at a time.
        assert.equal(root.querySelector('.tf-market')!.getAttribute('aria-live'), 'polite');
        assert.notEqual(root.querySelector('.tf-my'), null);
        assert.equal(asFake(root.querySelector('.tf-bubbles')).tagName, 'CANVAS');
        // The extras ribbon exists from the start and says it is empty.
        assert.equal(root.querySelector('.tf-extras')!.getAttribute('hidden'), '');
    });

    it('carries the chrome the Razor template never rendered, so both gestures are live', () => {
        const { root } = tradeFeedPanel();
        const header = root.querySelector('.panel-header')!;
        assert.deepStrictEqual(
            header.querySelectorAll('button').map(b => b.getAttribute('title')),
            ['AddInstrument', 'Add trade feed', 'ListView', 'BubbleChart', 'ClosePanel']);
        assert.deepStrictEqual(
            header.querySelectorAll('button').map(b => (b.childNodes[0] as FakeElement).className),
            ['bi bi-plus-lg', 'bi bi-window-plus', 'bi bi-list-ul', 'bi bi-circle-fill', 'bi bi-x']);

        const tabs = root.querySelector('.tf-tabs')!;
        assert.equal(tabs.getAttribute('role'), 'tablist');
        assert.deepStrictEqual(tabs.querySelectorAll('.tf-tab').map(t => t.textContent), ['MarketTrades', 'My trades']);
        assert.deepStrictEqual(tabs.querySelectorAll('.tf-tab').map(t => t.getAttribute('aria-selected')), ['true', 'false']);
    });

    it('wires its chrome through the port — nothing it renders carries an onclick', () => {
        const { widget, root, host, picked } = tradeFeedPanel();
        for (const element of allElements(root))
            assert.equal(element.getAttribute('onclick'), null, `${element.tagName} carries an onclick`);

        click(button(root, '.panel-add-btn'));
        assert.deepStrictEqual(host.calls.spawned, [{ extras: [] }]);

        click(button(root, '.tf-add-symbol-btn'));
        assert.equal(picked.length, 1, 'the + asks the host to run its own picker');

        click(button(root, '.panel-close-btn'));
        assert.equal(host.calls.closed, 1);
        assert.equal(root.parentNode, null, 'and takes itself off the page first');
        assert.equal(widget.rootEl, root);
    });

    it('refuses to wire up without a host, before it renders a single caption', () => {
        assert.throws(
            () => TradeFeedWidget.create(asDom(el('div')), {}, { host: undefined } as never),
            /TradeFeedWidget: host is required/);
        assert.throws(
            () => TradeFeedWidget.create(asDom(el('div')), {}, { host: { isPrimary: true } } as never),
            /TradeFeedWidget: host\.t is required/);
    });
});

describe('TradeFeedWidget: the tape', () => {
    it('paints a print per row, coloured by the direction the HOST read', () => {
        const { widget, root } = tradeFeedPanel();
        widget.setTrades(TAPE);

        assert.equal(rows(root).length, 3);
        assert.deepStrictEqual(cells(rows(root)[0]!), ['time', 'price', 'qty', 'side']);
        assert.deepStrictEqual(rows(root).map(r => r.className.split(' ')[1]), ['side-buy', 'side-sell', 'side-buy']);
        // The numeric 0 on the last row is the same buy as the string on the
        // first: normalising the wire's spellings is the host's job, and the
        // control never inspects the value it passes through.
        assert.equal((rows(root)[2]!.childNodes[3] as FakeElement).textContent, 'Buy');
        assert.equal((rows(root)[0]!.childNodes[1] as FakeElement).textContent, formatPrice(68420.5));
        assert.equal((rows(root)[0]!.childNodes[2] as FakeElement).textContent, '0.25');
    });

    it('prepends a new print and flashes only that one', () => {
        const { widget, root } = tradeFeedPanel();
        widget.setActiveSymbol('BTC@IMEX');
        widget.setTrades(TAPE);
        const before = rows(root)[0]!;

        widget.addTrade({ symbol: 'BTC@IMEX', side: 'Buy', price: 68500, quantity: 2, time: '2026-04-30T12:00:04Z' });

        assert.equal(rows(root).length, 4);
        assert.equal(rows(root)[0]!.classList.contains('flash-new'), true);
        assert.strictEqual(rows(root)[1], before, 'the rows already on screen have to survive, animation and all');
        assert.equal(before.classList.contains('flash-new'), false);
    });

    it('marks a print well above the recent average', () => {
        const { widget, root } = tradeFeedPanel();
        widget.setActiveSymbol('BTC@IMEX');
        widget.setTrades([{ symbol: 'BTC@IMEX', side: 'Buy', price: 100, quantity: 1, time: '2026-04-30T12:00:01Z' }]);
        widget.addTrade({ symbol: 'BTC@IMEX', side: 'Buy', price: 100, quantity: 50, time: '2026-04-30T12:00:02Z' });
        assert.equal(rows(root)[0]!.classList.contains('large-trade'), true);
        assert.equal(rows(root)[1]!.classList.contains('large-trade'), false);
    });

    it('ignores a print for a symbol it does not watch, and keeps the list capped', () => {
        const { widget, root } = tradeFeedPanel();
        widget.setActiveSymbol('BTC@IMEX');
        widget.addTrade({ symbol: 'ETH@IMEX', side: 'Buy', price: 3500, quantity: 1, time: '2026-04-30T12:00:01Z' });
        assert.equal(rows(root).length, 0, 'a host fans every tick to every feed; each one decides');

        for (let i = 0; i < TradeFeedWidget.MAX_ROWS + 10; i++)
            widget.addTrade({ symbol: 'BTC@IMEX', side: 'Buy', price: 100 + i, quantity: 1, time: '2026-04-30T12:00:01Z' });
        assert.equal(rows(root).length, TradeFeedWidget.MAX_ROWS);
        assert.equal(widget.trades.length, TradeFeedWidget.MAX_ROWS);
    });
});

describe('TradeFeedWidget: pinned extras', () => {
    it('subscribes a pinned instrument to the tape and nothing heavier', async () => {
        const { widget, root, subscriptions, host } = tradeFeedPanel();
        widget.setActiveSymbol('BTC@IMEX');
        await widget.addExtraSymbol('eth@imex');

        assert.deepStrictEqual(subscriptions, [{ op: 'add', symbol: 'ETH@IMEX', level: 'tape' }]);
        assert.deepStrictEqual(widget.getExtraSymbols(), ['ETH@IMEX']);
        assert.equal(root.querySelector('.tf-extras')!.getAttribute('hidden'), null);
        assert.deepStrictEqual(
            root.querySelectorAll('.tf-extra-sym').map(s => s.textContent), ['ETH@IMEX']);
        // Pinning is worth remembering, and worth writing out now.
        assert.deepStrictEqual(host.calls.persisted, [{ extras: ['ETH@IMEX'] }]);
        assert.equal(host.calls.saved, 1);
    });

    it('shows a symbol column once a second instrument is in the feed', async () => {
        const { widget, root } = tradeFeedPanel();
        widget.setActiveSymbol('BTC@IMEX');
        await widget.addExtraSymbol('ETH@IMEX');
        widget.setTrades(TAPE);

        assert.deepStrictEqual(cells(rows(root)[0]!), ['time', 'sym', 'price', 'qty', 'side']);
        assert.equal(rows(root)[0]!.classList.contains('tf-row-multi'), true);
        assert.equal((rows(root)[0]!.childNodes[1] as FakeElement).textContent, 'BTC@IMEX');
    });

    it('unpins from the chip, dropping the subscription and the prints with it', async () => {
        const { widget, root, subscriptions } = tradeFeedPanel();
        widget.setActiveSymbol('BTC@IMEX');
        await widget.addExtraSymbol('ETH@IMEX');
        widget.setTrades([...TAPE, { symbol: 'ETH@IMEX', side: 'Buy', price: 3500, quantity: 1, time: '2026-04-30T12:00:00Z' }]);
        subscriptions.length = 0;

        click(button(root, '.tf-extra-rm'));
        await Promise.resolve();

        assert.deepStrictEqual(subscriptions, [{ op: 'remove', symbol: 'ETH@IMEX', level: '' }]);
        assert.deepStrictEqual(widget.getExtraSymbols(), []);
        assert.equal(root.querySelector('.tf-extras')!.getAttribute('hidden'), '');
        assert.equal(widget.trades.some(t => t.symbol === 'ETH@IMEX'), false);
    });

    it('resubscribes what it was persisted with, so a reload streams what it shows', () => {
        const { widget, subscriptions } = tradeFeedPanel({ extras: ['ETH@IMEX', 'SOL@IMEX'] });
        assert.deepStrictEqual(subscriptions, [
            { op: 'add', symbol: 'ETH@IMEX', level: 'tape' },
            { op: 'add', symbol: 'SOL@IMEX', level: 'tape' },
        ]);
        assert.deepStrictEqual(widget.getExtraSymbols(), ['ETH@IMEX', 'SOL@IMEX']);
    });

    it('releases every subscription when it goes away', () => {
        const { widget, subscriptions } = tradeFeedPanel({ extras: ['ETH@IMEX'] });
        subscriptions.length = 0;
        widget.dispose();
        assert.deepStrictEqual(subscriptions, [{ op: 'remove', symbol: 'ETH@IMEX', level: '' }]);
        assert.equal(resizeObservers.at(-1)!.disconnected, true);
    });
});

describe('TradeFeedWidget: the two tabs', () => {
    it('moves the tab state onto the root, where the stylesheet reads it', () => {
        const { root } = tradeFeedPanel();
        const tabs = root.querySelectorAll('.tf-tab');

        click(tabs[1]!);
        assert.equal(root.classList.contains('tf-tab-my'), true);
        assert.equal(root.classList.contains('tf-tab-market'), false);
        assert.deepStrictEqual(tabs.map(t => t.getAttribute('aria-selected')), ['false', 'true']);
        assert.deepStrictEqual(tabs.map(t => t.classList.contains('active')), [false, true]);

        click(tabs[0]!);
        assert.equal(root.classList.contains('tf-tab-market'), true);
    });

    it('pulls the account\'s own fills through the port, per portfolio and symbol', async () => {
        const { widget, root, host } = tradeFeedPanel();
        const asked: unknown[][] = [];
        host.trading.portfolioId = () => 7;
        host.trading.api.getExecutions = (portfolioId, symbol, limit) => {
            asked.push([portfolioId, symbol, limit]);
            return Promise.resolve([{ symbol: 'BTC@IMEX', side: 'Sell', price: 68000, quantity: 0.5, executedAt: '2026-04-30T11:00:00Z' }]);
        };
        widget.setActiveSymbol('BTC@IMEX');

        await widget.loadMyTrades(7, 'BTC@IMEX');

        assert.deepStrictEqual(asked, [[7, 'BTC@IMEX', TradeFeedWidget.MAX_ROWS]]);
        const myRows = root.querySelector('.tf-my')!.childNodes as FakeElement[];
        assert.equal(myRows.length, 1);
        assert.equal(myRows[0]!.classList.contains('side-sell'), true);
    });

    it('says so when the account has no fills, and reports a failed load to the host', async () => {
        const { widget, root, host } = tradeFeedPanel();
        await widget.loadMyTrades(null, null);
        assert.equal(root.querySelector('.tf-my')!.textContent, 'No trades yet');

        host.trading.api.getExecutions = () => Promise.reject(new Error('history is down'));
        await widget.loadMyTrades(7, 'BTC@IMEX');
        assert.match(host.calls.logged[0]!, /TradeFeedWidget: failed to load own trades: .*history is down/);
        assert.equal(root.querySelector('.tf-my')!.textContent, 'No trades yet');
    });
});

describe('TradeFeedWidget: the bubble chart', () => {
    it('keeps which rendering is showing on the root, and remembers it for the page', () => {
        const { widget, root, host } = tradeFeedPanel();
        assert.equal(widget.view, 'list');

        showBubbles(root);

        assert.equal(widget.view, 'bubbles');
        assert.equal(root.classList.contains('tf-view-bubbles'), true);
        assert.equal(root.classList.contains('tf-view-list'), false);
        assert.equal(host.preferences.get(TradeFeedWidget.VIEW_KEY, null), 'bubbles');
        assert.deepStrictEqual(
            root.querySelectorAll('.tf-view-btn').map(b => b.getAttribute('aria-pressed')), ['false', 'true']);
    });

    it('opens in the rendering the store already held', () => {
        const first = tradeFeedPanel();
        showBubbles(first.root);
        // A second feed on the same page reads the same preference store.
        const second = TradeFeedWidget.create(asDom(el('div')), {}, { host: first.host });
        assert.equal(second.view, 'bubbles');
    });

    it('sizes its backing store to the display before it paints', () => {
        const { widget, root } = tradeFeedPanel();
        showBubbles(root);
        const canvas = asFake(widget.bubbleCanvas);
        assert.equal(canvas.width, 400, 'a canvas left at its default size draws nothing at the right scale');
        assert.equal(canvas.height, 200);
        assert.deepStrictEqual(context(widget).opsOf('setTransform')[0]!.args, [1, 0, 0, 1, 0, 0]);
    });

    it('paints every print in the palette the HOST answered with', () => {
        const { widget, root } = tradeFeedPanel();
        widget.setActiveSymbol('BTC@IMEX');
        widget.setTrades(TAPE);
        showBubbles(root);

        const ctx = context(widget);
        const circles = ctx.opsOf('arc');
        assert.equal(circles.length, 3, 'one bubble per print while the lane has room');
        // `test-up` / `test-down` are the fake host's answer, not colours this
        // package could have written: a literal here would fail on sight.
        assert.deepStrictEqual([...new Set(circles.map(c => c.fillStyle))].sort(), ['test-down', 'test-up']);
        assert.equal(ctx.opsOf('fillText').every(c => c.fillStyle === 'test-grid'), true);
        assert.equal(ctx.font, 'test-font');
        // Opacity is the chart's own business; the hue is never the package's.
        assert.equal(circles.every(c => c.globalAlpha < 1), true);
    });

    it('labels a lane per pinned symbol and draws none when the feed follows one', async () => {
        const { widget, root } = tradeFeedPanel();
        widget.setActiveSymbol('BTC@IMEX');
        widget.setTrades(TAPE);
        showBubbles(root);
        const single = context(widget).opsOf('fillText').map(c => c.text);
        assert.equal(single.includes('BTC@IMEX'), false, 'naming the only lane says nothing');

        await widget.addExtraSymbol('ETH@IMEX');
        widget.addTrade({ symbol: 'ETH@IMEX', side: 'Buy', price: 3500, quantity: 1, time: '2026-04-30T12:00:05Z' });
        const split = context(widget).opsOf('fillText').map(c => c.text);
        assert.equal(split.includes('BTC@IMEX'), true);
        assert.equal(split.includes('ETH@IMEX'), true);
    });

    it('repaints when its box changes, without being told a window exists', () => {
        const { widget, root } = tradeFeedPanel();
        widget.setActiveSymbol('BTC@IMEX');
        widget.setTrades(TAPE);
        showBubbles(root);
        const ctx = context(widget);
        const painted = ctx.opsOf('arc').length;

        asFake(widget.bubbleCanvas).setRect({ left: 0, top: 0, width: 800, height: 400 });
        resizeObservers.at(-1)!.callback();

        assert.equal(asFake(widget.bubbleCanvas).width, 800);
        assert.equal(ctx.opsOf('arc').length > painted, true);
    });

    it('shows the print under the cursor, and hides again when there is none', () => {
        const { widget, root } = tradeFeedPanel();
        widget.setActiveSymbol('BTC@IMEX');
        widget.setTrades(TAPE);
        showBubbles(root);

        const target = widget._bubbleHits[0]!;
        const canvas = asFake(widget.bubbleCanvas);
        canvas.dispatchEvent({ type: 'mousemove', clientX: target.x, clientY: target.y });

        const tooltip = root.querySelector('.tf-bubble-tooltip')!;
        assert.equal(tooltip.getAttribute('hidden'), null);
        assert.deepStrictEqual(
            tooltip.querySelectorAll('.tf-bbtt-label').map(l => l.textContent), ['Time', 'Price', 'Qty', 'Side']);
        // One print, so its own price — a bucket of several reads VWAP instead.
        assert.equal(tooltip.querySelectorAll('.tf-bbtt-value')[1]!.textContent, formatPrice(target.bubble.price));
        // The direction is worded and coloured by the host, here as everywhere.
        assert.equal(tooltip.querySelectorAll('.tf-bbtt-value')[3]!.className, 'tf-bbtt-value side-buy');

        canvas.dispatchEvent({ type: 'mousemove', clientX: 5, clientY: 5 });
        assert.equal(tooltip.getAttribute('hidden'), '');
    });

    it('reads a bucket of prints as a volume-weighted one', () => {
        const { widget, root } = tradeFeedPanel();
        widget.setActiveSymbol('BTC@IMEX');
        // Well past the per-side bucket budget, so the lane compacts.
        widget.setTrades(Array.from({ length: 200 }, (_, i) => ({
            symbol: 'BTC@IMEX', side: 'Buy', price: 100 + i, quantity: 1, time: '2026-04-30T12:00:00Z',
        })));
        showBubbles(root);

        const bucket = widget._bubbleHits.find(hit => hit.bubble.count > 1)!;
        assert.notEqual(bucket, undefined, 'a busy lane has to compact, or it draws a wall');
        const canvas = asFake(widget.bubbleCanvas);
        canvas.dispatchEvent({ type: 'mousemove', clientX: bucket.x, clientY: bucket.y });

        const tooltip = root.querySelector('.tf-bubble-tooltip')!;
        assert.deepStrictEqual(
            tooltip.querySelectorAll('.tf-bbtt-label').map(l => l.textContent),
            ['Time', 'VWAP', 'Total qty', 'Side', 'Trades']);
    });
});

describe('TradeFeedWidget', () => {
    it('registers itself, or a host would fan every tick to nobody', () => {
        const panel = tradeFeedPanel();
        assert.deepStrictEqual(panel.host.calls.registered, [panel.widget]);
        panel.widget.dispose();
        // A second dispose is a no-op, which is what lets a host dispose
        // unconditionally after the control already did.
        panel.widget.dispose();
    });
});
