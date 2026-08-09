import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { FeedTick } from '../src/tradefeed-aggregator.js';
import { layoutBubbles, priceFormatter } from '../src/tradefeed-bubbles.js';

function tick(index: number, price: number, overrides: Partial<FeedTick>): FeedTick {
    return {
        symbol: 'BTC@IMEX',
        side: 'Buy',
        buy: true,
        price,
        quantity: 1,
        time: '2026-04-30T12:00:00Z',
        index,
        ...overrides,
    };
}

// A tape of four prices, newest first — index 0 is the most recent print.
const TICKS: FeedTick[] = [
    tick(0, 130, {}),
    tick(1, 120, { buy: false, side: 'Sell' }),
    tick(2, 110, {}),
    tick(3, 100, { buy: false, side: 'Sell' }),
];

function oneLane() {
    return layoutBubbles({ width: 400, height: 200, total: TICKS.length, lanes: [{ symbol: 'BTC@IMEX', ticks: TICKS }] });
}

describe('layoutBubbles', () => {
    it('has nothing to place for a tape with no prints', () => {
        const layout = layoutBubbles({ width: 400, height: 200, total: 0, lanes: [{ symbol: 'BTC@IMEX', ticks: [] }] });
        assert.deepStrictEqual(layout.bubbles, []);
        assert.deepStrictEqual(layout.lanes, []);
    });

    it('reserves a strip on the right for the price axis', () => {
        const layout = oneLane();
        assert.equal(layout.axisX, 400 - 56);
        assert.equal(layout.labelX > layout.axisX, true, 'labels sit past the rules, not on them');
        for (const bubble of layout.bubbles)
            assert.equal(bubble.x <= layout.axisX, true, 'a bubble never draws over the axis');
    });

    it('runs time left to right, newest at the right edge', () => {
        const layout = oneLane();
        const newest = layout.bubbles.find(b => b.bubble.index === 0)!;
        const oldest = layout.bubbles.find(b => b.bubble.index === 3)!;
        assert.equal(newest.x > oldest.x, true);
        assert.equal(Math.round(newest.x), layout.axisX, 'the newest print sits at the right edge of the plot');
    });

    it('runs price bottom to top, scaled to the lane', () => {
        const layout = oneLane();
        const high = layout.bubbles.find(b => b.bubble.price === 130)!;
        const low = layout.bubbles.find(b => b.bubble.price === 100)!;
        assert.equal(high.y < low.y, true, 'the higher price is the higher pixel');
        // The lane spans the canvas less its padding, so the extremes land on
        // its edges rather than somewhere inside it.
        assert.equal(Math.round(high.y), 10);
        assert.equal(Math.round(low.y), 190);
    });

    it('draws oldest first, so the newest print lands on top of what it overlaps', () => {
        const indexes = oneLane().bubbles.map(b => b.bubble.index);
        assert.deepStrictEqual(indexes, [...indexes].sort((a, b) => b - a));
    });

    it('names and separates lanes only when there is more than one symbol', () => {
        const single = oneLane();
        assert.equal(single.lanes.length, 1);
        assert.equal(single.lanes[0].label, null, 'naming the only lane says nothing');
        assert.equal(single.lanes[0].separatorY, null);

        const split = layoutBubbles({
            width: 400, height: 200, total: 4,
            lanes: [
                { symbol: 'BTC@IMEX', ticks: [TICKS[0], TICKS[2]] },
                { symbol: 'ETH@IMEX', ticks: [tick(1, 3500, { symbol: 'ETH@IMEX' }), tick(3, 3400, { symbol: 'ETH@IMEX' })] },
            ],
        });
        assert.deepStrictEqual(split.lanes.map(l => l.symbol), ['BTC@IMEX', 'ETH@IMEX']);
        assert.deepStrictEqual(split.lanes.map(l => l.label !== null), [true, true]);
        assert.equal(split.lanes[0].separatorY, null, 'the first lane has nothing above it');
        assert.equal(typeof split.lanes[1].separatorY, 'number');
    });

    it('scales each lane to its own prices, so a $76k symbol does not flatten a $270 one', () => {
        const layout = layoutBubbles({
            width: 400, height: 200, total: 4,
            lanes: [
                { symbol: 'BTC@IMEX', ticks: [tick(0, 76000, {}), tick(2, 75000, {})] },
                { symbol: 'AAPL@NASDAQ', ticks: [tick(1, 271, { symbol: 'AAPL@NASDAQ' }), tick(3, 269, { symbol: 'AAPL@NASDAQ' })] },
            ],
        });
        const spread = (symbol: string) => {
            const ys = layout.bubbles.filter(b => b.bubble.symbol === symbol).map(b => b.y);
            return Math.max(...ys) - Math.min(...ys);
        };
        assert.equal(spread('BTC@IMEX') > 50, true, 'a lane uses its own height');
        assert.equal(spread('AAPL@NASDAQ') > 50, true, 'and so does the one two orders of magnitude below it');
        // Both lanes still share one time axis: same index, same column.
        const btc = layout.bubbles.find(b => b.bubble.index === 0)!;
        const aapl = layout.bubbles.find(b => b.bubble.index === 1)!;
        assert.equal(btc.x > aapl.x, true);
    });

    it('keeps a bubble inside its lane however large the print', () => {
        const huge = [tick(0, 100, { quantity: 1_000_000 }), tick(1, 101, { quantity: 1 })];
        const layout = layoutBubbles({
            width: 400, height: 200, total: 2,
            lanes: [{ symbol: 'A', ticks: huge }, { symbol: 'B', ticks: [tick(2, 5, { symbol: 'B' })] }],
        });
        const laneHeight = (200 - 20 - 2) / 2;
        for (const bubble of layout.bubbles)
            assert.equal(bubble.radius <= laneHeight * 0.4 + 2, true, 'a circle taller than its lane is a wall');
    });

    it('labels the axis with the lane high, middle and low', () => {
        const ticks = oneLane().lanes[0].ticks;
        assert.deepStrictEqual(ticks.map(t => t.text), ['130.00', '115.00', '100.00']);
        assert.equal(ticks[0].y < ticks[2].y, true, 'the high label is the top one');
    });

    it('holds a lane whose prints are all at one price at a single row', () => {
        const flat = [tick(0, 42, {}), tick(1, 42, {})];
        const layout = layoutBubbles({ width: 400, height: 200, total: 2, lanes: [{ symbol: 'A', ticks: flat }] });
        for (const bubble of layout.bubbles) assert.equal(isFinite(bubble.y), true, 'a flat lane must not divide by its range');
    });
});

describe('priceFormatter', () => {
    it('picks its decimals from the magnitude it is asked to label', () => {
        assert.equal(priceFormatter(75000, 76000)(75500), (75500).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 }));
        assert.equal(priceFormatter(269, 271)(270.5), '270.50');
        assert.equal(priceFormatter(0.5, 0.9)(0.6125), '0.6125');
        assert.equal(priceFormatter(0.001, 0.002)(0.0015), '0.001500');
    });
});
