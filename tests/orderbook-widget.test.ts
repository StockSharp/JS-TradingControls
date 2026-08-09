import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { asDom, asFake, el, installFakeDom, type FakeCanvasContext, type FakeElement, type FakeEvent } from './fake-dom.js';
import { fakeHost } from './fake-host.js';
import { allElements } from './panel-probe.js';
import { OrderBookWidget } from '../src/orderbook-widget.js';
import type { OrderBookFrame } from '../src/trading-data.js';

installFakeDom();

const SYMBOL = 'BTC@IMEX';

const SNAPSHOT: OrderBookFrame = {
    symbol: SYMBOL,
    sequence: 4,
    isSnapshot: true,
    bids: [{ price: 99, quantity: 3 }, { price: 98, quantity: 1 }],
    asks: [{ price: 100, quantity: 2 }, { price: 101, quantity: 6 }],
};

function orderBook(state: Record<string, unknown> = {}, room = 10) {
    const parent = el('div');
    const calls: unknown[][] = [];
    const host = fakeHost();
    const widget = OrderBookWidget.create(asDom(parent), state, {
        host,
        onPriceSelected: (price, side) => calls.push(['select', price, side]),
        onPriceExecuted: (price, side) => calls.push(['execute', price, side]),
        maxDepth: () => room,
        pixelRatio: () => 2,
    });
    return { widget, root: parent.childNodes[0] as FakeElement, calls, host };
}

/// The rendered levels of one side, as [price, qty, total] per row, top to
/// bottom — which is the order the user reads them in.
function levels(root: FakeElement, side: string): string[][] {
    return root.querySelector(side)!.childNodes
        .map(row => (row as FakeElement).childNodes.slice(0, 3).map(cell => cell.textContent));
}

function clickLevel(row: FakeElement, event: Partial<FakeEvent> = {}): void {
    const price = row.querySelector('.price')!;
    price.dispatchEvent({ type: 'click', target: price, ...event } as FakeEvent);
}

describe('OrderBookWidget builds its own panel', () => {
    it('renders the shell a host stylesheet and a docking host both read', () => {
        const { root } = orderBook();
        assert.equal(root.className, 'terminal-panel orderbook-panel ob-view-stacked');
        assert.equal(root.getAttribute('role'), 'region');
        assert.equal(root.getAttribute('aria-label'), 'OrderBook');

        assert.notEqual(root.querySelector('.panel-header .ob-symbol-label'), null);
        assert.notEqual(root.querySelector('.ob-depth-chart'), null);
        assert.notEqual(root.querySelector('.ob-col-headers'), null);
        assert.notEqual(root.querySelector('.orderbook-content .orderbook-asks'), null);
        assert.notEqual(root.querySelector('.orderbook-content .orderbook-mid .ob-mid-price'), null);
        assert.notEqual(root.querySelector('.orderbook-content .orderbook-bids'), null);
        assert.notEqual(root.querySelector('.ob-sentiment .ob-sent-bid'), null);
    });

    it('captions every control through the host, including the column strip', () => {
        const { root } = orderBook();
        assert.deepStrictEqual(
            root.querySelector('.ob-col-headers')!.childNodes.map(cell => cell.textContent),
            ['Price', 'Qty', 'Total']);
        assert.equal(root.querySelector('.ob-symbol-label')!.getAttribute('title'), 'ClickToChangeSymbol');
        assert.equal(root.querySelector('.ob-depth-selector')!.getAttribute('aria-label'), 'OrderBookDepth');
        assert.equal(root.querySelector('.orderbook-asks')!.getAttribute('aria-label'), 'AskOrders');
        assert.equal(root.querySelector('.ob-sentiment')!.getAttribute('aria-label'), 'OrderBookSentiment');
    });

    it('carries the buttons its chrome is made of', () => {
        const { root } = orderBook();
        assert.deepStrictEqual(
            root.querySelectorAll('.btn-ob-depth').map(button => [button.dataset.depth, button.textContent]),
            [['5', '5'], ['10', '10']]);
        assert.deepStrictEqual(
            root.querySelectorAll('.btn-ob-view').map(button => [button.dataset.view, button.getAttribute('title')]),
            [['diagonal', 'OrderBookViewDiagonal'], ['stacked', 'OrderBookViewStacked']]);

        const close = root.querySelector('.ob-close-btn')!;
        assert.equal(close.className, 'bt-icon-btn bt-icon-cancel ob-close-btn');
        assert.equal(close.getAttribute('title'), 'RemoveOrderbook');
        assert.equal((close.childNodes[0] as FakeElement).className, 'bi bi-x');
        assert.equal(root.querySelector('.ob-add-btn')!.className, 'bt-icon-btn ob-add-btn');
        assert.equal(root.querySelector('.btn-ob-depthtoggle')!.getAttribute('title'), 'ToggleDepthChart');
    });

    it('wires its chrome through the port — nothing it renders has an onclick', () => {
        const { widget, root, host } = orderBook();
        widget.applyFrame(SNAPSHOT);
        for (const element of allElements(root))
            assert.equal(element.getAttribute('onclick'), null, `${element.tagName} carries an onclick`);

        const close = root.querySelector('.ob-close-btn')!;
        close.dispatchEvent({ type: 'click', target: close });
        assert.equal(host.calls.closed, 1);
    });

    it('spawns a sibling starting where this one is, pinned rather than following', () => {
        const { widget, root, host } = orderBook({ followsActive: true });
        widget.applyFrame(SNAPSHOT);
        const add = root.querySelector('.ob-add-btn')!;
        add.dispatchEvent({ type: 'click', target: add });

        assert.deepStrictEqual(host.calls.spawned, [{
            symbol: SYMBOL, depth: 10, view: 'stacked',
            invertSides: false, showDepthChart: true, followsActive: false,
        }]);
    });

    it('refuses to wire up without the callbacks and measurements it needs', () => {
        assert.throws(
            () => OrderBookWidget.create(asDom(el('div')), {}, { host: fakeHost() } as never),
            /dep "onPriceSelected" is required/);
        assert.throws(
            () => OrderBookWidget.create(asDom(el('div')), {}, {
                host: fakeHost(), onPriceSelected: () => { }, onPriceExecuted: () => { },
            } as never),
            /dep "maxDepth" is required/);
    });
});

describe('OrderBookWidget renders a book', () => {
    it('puts the best prices next to the mid line and accumulates outward', () => {
        const { widget, root } = orderBook();
        widget.applyFrame(SNAPSHOT);

        // Asks are painted worst-first so the best ask ends up against the mid
        // line, while the total still accumulates from the best one.
        assert.deepStrictEqual(levels(root, '.orderbook-asks'), [
            ['101.00', '6', '8'],
            ['100.00', '2', '2'],
        ]);
        assert.deepStrictEqual(levels(root, '.orderbook-bids'), [
            ['99.00', '3', '3'],
            ['98.00', '1', '4'],
        ]);
        assert.equal(root.querySelector('.ob-mid-price')!.textContent, '99.50');
        assert.equal(root.querySelector('.ob-mid-spread')!.textContent, '1.00');
        assert.equal(root.querySelector('.spread-label')!.textContent, 'Spread: 1.00');
    });

    it('measures the bar and the tint per level instead of styling them itself', () => {
        const { widget, root } = orderBook();
        widget.applyFrame(SNAPSHOT);
        const bestBid = root.querySelector('.orderbook-bids')!.childNodes[0] as FakeElement;
        const worstBid = root.querySelector('.orderbook-bids')!.childNodes[1] as FakeElement;

        // The bar is a share of the largest level on its OWN side.
        assert.equal(bestBid.style.getPropertyValue('--t-ob-bar'), '100%');
        assert.equal(worstBid.style.getPropertyValue('--t-ob-bar'), '33%');
        // The tint is scaled across both sides, so the two halves stay
        // comparable: 3 of the 6-lot maximum.
        assert.equal(bestBid.style.getPropertyValue('--t-ob-heat'), '15.0%');
        // No colour and no width reached the element itself.
        assert.deepStrictEqual(Object.keys(bestBid.style.properties), ['--t-ob-bar', '--t-ob-heat']);
    });

    it('splits the sentiment strip with one measurement, so the halves agree', () => {
        const { widget, root } = orderBook();
        widget.applyFrame(SNAPSHOT);
        // 4 bid against 8 ask.
        assert.equal(root.querySelector('.ob-sentiment')!.style.getPropertyValue('--t-ob-sent'), '33%');
        assert.equal(root.querySelector('.ob-sent-bid-pct')!.textContent, '33%');
        assert.equal(root.querySelector('.ob-sent-ask-pct')!.textContent, '67%');
    });

    it('flashes a level that changed, in the direction the change reads as', () => {
        const { widget, root } = orderBook();
        widget.applyFrame(SNAPSHOT);
        widget.applyFrame({
            symbol: SYMBOL, sequence: 5,
            bids: [{ price: 99, quantity: 5 }],
            asks: [{ price: 100, quantity: 4 }],
        });

        // More size bid is pressure up, more size offered is pressure down.
        assert.equal((root.querySelector('.orderbook-bids')!.childNodes[0] as FakeElement).className,
            'ob-row bid flash-green');
        assert.equal((root.querySelector('.orderbook-asks')!.childNodes[1] as FakeElement).className,
            'ob-row ask flash-red');
    });

    it('clips to the depth the host says it has room for', () => {
        const { widget, root } = orderBook({ depth: 10 }, 1);
        assert.equal(widget.getDepth(), 1);
        widget.applyFrame(SNAPSHOT);
        assert.equal(levels(root, '.orderbook-bids').length, 1);

        // A user pressing the deeper button still gets what fits.
        const deeper = root.querySelectorAll('.btn-ob-depth')[1];
        deeper.dispatchEvent({ type: 'click', target: deeper });
        assert.equal(widget.getDepth(), 1);
    });

    it('hands the ledger back best price first', () => {
        const { widget } = orderBook();
        widget.applyFrame(SNAPSHOT);
        assert.deepStrictEqual(widget.getBids().map(level => level.price), [99, 98]);
        assert.deepStrictEqual(widget.getAsks().map(level => level.price), [100, 101]);
    });
});

describe('OrderBookWidget clicks', () => {
    it('reports the price and the side the user would trade, through the deps', () => {
        const { widget, root, calls } = orderBook();
        widget.applyFrame(SNAPSHOT);

        clickLevel(root.querySelector('.orderbook-bids')!.childNodes[0] as FakeElement);
        clickLevel(root.querySelector('.orderbook-asks')!.childNodes[1] as FakeElement, { ctrlKey: true } as Partial<FakeEvent>);

        // Clicking a bid is where a seller meets the market, and the other way
        // round — so a bid row reports side 1 and an ask row side 0.
        assert.deepStrictEqual(calls, [['select', 99, 1], ['execute', 100, 0]]);
    });

    it('asks the host for a picker and retargets only itself', () => {
        const { widget, root, host } = orderBook({ followsActive: true });
        host.trading.pickInstrument = (onPicked) => onPicked('ETH@IMEX');

        const label = root.querySelector('.ob-symbol-label')!;
        label.dispatchEvent({ type: 'click', target: label });

        assert.equal(widget.getSymbol(), 'ETH@IMEX');
        assert.equal(label.textContent, 'ETH@IMEX');
        // Picking detaches it: it is a pinned ladder on the chosen symbol now.
        assert.equal(widget.isFollowsActive(), false);
        assert.deepStrictEqual(host.calls.persisted, [{ followsActive: false }, { symbol: 'ETH@IMEX' }]);
    });
});

describe('OrderBookWidget applies the wire', () => {
    it('merges a diff and deletes a level whose size went to zero', () => {
        const { widget, root } = orderBook();
        widget.applyFrame(SNAPSHOT);
        widget.applyFrame({
            symbol: SYMBOL, sequence: 5,
            bids: [{ price: 98, quantity: 0 }, { price: 97, quantity: 9 }],
            asks: [],
        });
        assert.deepStrictEqual(levels(root, '.orderbook-bids').map(row => row[0]), ['99.00', '97.00']);
    });

    it('asks for a fresh snapshot rather than trusting a diff after a gap', () => {
        const { widget, host } = orderBook();
        const asked: string[] = [];
        host.trading.marketData.resubscribe = (symbol) => { asked.push(symbol); return Promise.resolve(); };

        widget.applyFrame(SNAPSHOT);
        widget.applyFrame({ symbol: SYMBOL, sequence: 9, bids: [{ price: 99, quantity: 5 }] });

        assert.deepStrictEqual(asked, [SYMBOL]);
        assert.match(host.calls.logged.join('\n'), /sequence gap: expected 5, got 9/);
        // The missed frame was not applied on the way past.
        assert.deepStrictEqual(widget.getBids().map(level => level.quantity), [3, 1]);
    });

    it('reports the levels it refuses, through the port rather than the console', () => {
        const { widget, host } = orderBook();
        widget.applyFrame(SNAPSHOT);
        widget.applyFrame({
            symbol: SYMBOL, sequence: 5,
            bids: [{ price: null, quantity: 2 }, { price: 97, quantity: -1 }, { price: 50, quantity: 0 }],
        });

        const logged = host.calls.logged.join('\n');
        assert.match(logged, /invalid bid price/);
        assert.match(logged, /negative bid qty/);
        assert.match(logged, /delete missing bid/);
        assert.deepStrictEqual(widget.getBids().map(level => level.price), [99, 98]);
    });

    it('says so when the two sides cross', () => {
        const { widget, host } = orderBook();
        widget.applyFrame({
            symbol: SYMBOL, sequence: 1, isSnapshot: true,
            bids: [{ price: 105, quantity: 1 }],
            asks: [{ price: 100, quantity: 1 }],
        });
        assert.match(host.calls.logged.join('\n'), /crossed book: bid=105 >= ask=100/);
    });

    it('drops a frame for an instrument it is not watching', () => {
        const { widget } = orderBook();
        widget.applyFrame(SNAPSHOT);
        widget.applyFrame({ symbol: 'ETH@IMEX', sequence: 1, isSnapshot: true, bids: [{ price: 1, quantity: 1 }] });
        assert.deepStrictEqual(widget.getBids().map(level => level.price), [99, 98]);
    });

    it('badges the levels this session has size resting on', () => {
        const { widget, root, host } = orderBook();
        // Uppercase on purpose: which spellings mean "buy" is the host's
        // knowledge, and the ladder asks rather than listing them itself.
        host.trading.marketData.getOrders = () => [
            { instrument: SYMBOL, status: 3, side: 'BUY', limitPrice: 99, balance: 2 },
            { instrument: SYMBOL, status: 7, side: 'BUY', limitPrice: 98, balance: 5 },
            { instrument: 'ETH@IMEX', status: 3, side: 'SELL', limitPrice: 100, balance: 4 },
        ];
        widget.applyFrame(SNAPSHOT);

        const bids = root.querySelector('.orderbook-bids')!;
        const badged = bids.childNodes[0] as FakeElement;
        assert.equal(badged.className, 'ob-row bid own');
        assert.equal(badged.querySelector('.own-badge')!.textContent, '2');
        assert.equal(badged.querySelector('.own-badge')!.getAttribute('title'), 'YourOrder');
        // A cancelled order rests on nothing, and another instrument is another
        // ladder's business.
        assert.equal((bids.childNodes[1] as FakeElement).querySelector('.own-badge'), null);
    });
});

describe('OrderBookWidget settings', () => {
    it('remembers the follows-active instance in the preferences the user carries', () => {
        const { widget, root, host } = orderBook({ followsActive: true });
        const diagonal = root.querySelectorAll('.btn-ob-view')[0];
        diagonal.dispatchEvent({ type: 'click', target: diagonal });
        const invert = root.querySelector('.btn-ob-invert')!;
        invert.dispatchEvent({ type: 'click', target: invert });

        assert.equal(host.preferences.get(OrderBookWidget.VIEW_KEY, null), 'diagonal');
        assert.equal(host.preferences.get(OrderBookWidget.INVERT_KEY, null), 'true');
        assert.equal(widget.rootEl.className, 'terminal-panel orderbook-panel ob-view-diagonal ob-invert');
        // A page-wide setting is not this panel's state.
        assert.deepStrictEqual(host.calls.persisted, []);
    });

    it('remembers a pinned instance in its own panel state instead', () => {
        const { root, host } = orderBook({ followsActive: false });
        const shallow = root.querySelectorAll('.btn-ob-depth')[0];
        shallow.dispatchEvent({ type: 'click', target: shallow });

        assert.deepStrictEqual(host.calls.persisted, [{ depth: 5 }]);
        assert.equal(host.calls.saved, 1);
        assert.equal(host.preferences.get(OrderBookWidget.DEPTH_KEY, null), null);
        assert.equal(shallow.getAttribute('aria-pressed'), 'true');
    });

    it('restores what the user left the follows-active ladder set to', () => {
        const { host } = orderBook();
        host.preferences.set(OrderBookWidget.DEPTH_KEY, '5');
        host.preferences.set(OrderBookWidget.VIEW_KEY, 'diagonal');
        host.preferences.set(OrderBookWidget.DEPTHCHART_KEY, 'false');

        const parent = el('div');
        const widget = OrderBookWidget.create(asDom(parent), { followsActive: true }, {
            host,
            onPriceSelected: () => { }, onPriceExecuted: () => { },
            maxDepth: () => 10, pixelRatio: () => 1,
        });
        assert.equal(widget.getDepth(), 5);
        assert.equal(widget.rootEl.className, 'terminal-panel orderbook-panel ob-view-diagonal ob-hide-depth');
    });

    it('releases its subscription and leaves the fan-out when it goes', () => {
        const { widget, host } = orderBook();
        const released: string[] = [];
        host.trading.marketData.removeSymbol = (symbol) => { released.push(symbol); return Promise.resolve(); };
        widget.setSymbol(SYMBOL);
        widget.dispose();

        assert.deepStrictEqual(released, [SYMBOL]);
        host.broadcast<OrderBookWidget>(() => assert.fail('a disposed ladder is still being broadcast to'));
    });
});

describe('OrderBookWidget depth chart', () => {
    function painted(room = 10) {
        const book = orderBook({}, room);
        const canvas = asFake(book.widget.depthChartEl);
        canvas.clientWidth = 200;
        canvas.clientHeight = 80;
        book.widget.applyFrame(SNAPSHOT);
        return { ...book, canvas, ctx: canvas.getContext('2d') as FakeCanvasContext };
    }

    it('sizes its backing store from the ratio the host answered with', () => {
        const { canvas } = painted();
        assert.equal(canvas.width, 400);
        assert.equal(canvas.height, 160);
    });

    it('paints in the host palette and in nothing else', () => {
        const { ctx, host } = painted();
        const palette = host.presentation.canvasPalette();
        const used = new Set(ctx.calls
            .filter(call => call.op === 'fill' || call.op === 'stroke' || call.op === 'fillRect')
            .flatMap(call => [call.op === 'stroke' ? call.strokeStyle : call.fillStyle]));

        assert.deepStrictEqual([...used].sort(), [palette.down, palette.grid, palette.up].sort());
    });

    it('fills each side faintly under a solid stroke, so both sides read', () => {
        const { ctx } = painted();
        assert.deepStrictEqual(ctx.opsOf('fill').map(call => [call.fillStyle, call.globalAlpha]),
            [['test-up', 0.18], ['test-down', 0.18]]);
        assert.deepStrictEqual(ctx.opsOf('stroke').map(call => [call.strokeStyle, call.globalAlpha]),
            [['test-up', 0.95], ['test-down', 0.95]]);
    });

    it('draws nothing while the header toggle has it hidden', () => {
        const { widget, ctx } = painted();
        const before = ctx.calls.length;
        widget.setShowDepthChart(false);
        widget.applyFrame({ symbol: SYMBOL, sequence: 5, bids: [{ price: 99, quantity: 4 }] });
        assert.equal(ctx.calls.length, before);
    });
});
