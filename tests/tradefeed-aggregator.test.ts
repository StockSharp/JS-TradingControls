import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { aggregateBubbles, type FeedTick } from '../src/tradefeed-aggregator.js';

let nextIndex = 0;

function tick(overrides: Partial<FeedTick>): FeedTick {
    return {
        symbol: 'BTC@IMEX',
        side: 'Buy',
        buy: true,
        price: 100,
        quantity: 1,
        time: '2026-04-30T12:00:00Z',
        index: nextIndex++,
        ...overrides,
    };
}

describe('aggregateBubbles', () => {
    it('has nothing to draw for an empty tape', () => {
        assert.deepStrictEqual(aggregateBubbles([], 30), []);
    });

    it('passes every print through while the lane has room', () => {
        const ticks = [
            tick({ price: 100, quantity: 1, buy: true }),
            tick({ price: 101, quantity: 2, buy: true }),
            tick({ price: 99, quantity: 3, buy: false, side: 'Sell' }),
        ];
        const bubbles = aggregateBubbles(ticks, 10);

        assert.equal(bubbles.length, 3);
        for (const bubble of bubbles) assert.equal(bubble.count, 1, 'a print stands only for itself');
        assert.deepStrictEqual(bubbles.filter(b => b.buy).map(b => b.price), [100, 101]);
        assert.deepStrictEqual(bubbles.filter(b => !b.buy).map(b => b.quantity), [3]);
    });

    it('gives each direction its own budget, so a busy side cannot crowd the other out', () => {
        const ticks: FeedTick[] = [];
        for (let i = 0; i < 12; i++) ticks.push(tick({ buy: true, price: 100 + i, quantity: 1 }));
        for (let i = 0; i < 2; i++) ticks.push(tick({ buy: false, side: 'Sell', price: 99, quantity: 5 }));

        const bubbles = aggregateBubbles(ticks, 4);
        const buys = bubbles.filter(b => b.buy);
        const sells = bubbles.filter(b => !b.buy);

        // 12 buys over a budget of 4 is four buckets of three; the two sells are
        // under budget and stay themselves.
        assert.equal(buys.length, 4);
        for (const buy of buys) assert.equal(buy.count, 3);
        assert.equal(sells.length, 2);
        for (const sell of sells) assert.equal(sell.count, 1);
    });

    it('places a bucket at its volume-weighted price, not at its middle one', () => {
        const ticks = [
            tick({ buy: true, price: 100, quantity: 1 }),
            tick({ buy: true, price: 110, quantity: 9 }),   // (100 + 990) / 10
            tick({ buy: true, price: 200, quantity: 4 }),
            tick({ buy: true, price: 220, quantity: 6 }),   // (800 + 1320) / 10
        ];
        const bubbles = aggregateBubbles(ticks, 2);

        assert.deepStrictEqual(bubbles.map(b => b.price), [109, 212]);
        assert.deepStrictEqual(bubbles.map(b => b.quantity), [10, 10]);
        assert.deepStrictEqual(bubbles.map(b => b.count), [2, 2]);
    });

    it('puts a zero-volume bucket at a price rather than at NaN', () => {
        const ticks = [
            tick({ buy: true, price: 100, quantity: 0 }),
            tick({ buy: true, price: 105, quantity: 0 }),
            tick({ buy: true, price: 110, quantity: 0 }),
        ];
        const bubbles = aggregateBubbles(ticks, 1);

        assert.equal(bubbles.length, 1);
        assert.equal(bubbles[0].price, 100, 'a bubble at NaN is a bubble nobody can see');
        assert.equal(bubbles[0].quantity, 0);
        assert.equal(bubbles[0].count, 3);
    });

    it('carries the raw side through, because wording it is the host\'s', () => {
        // The wire spells a side three ways and the tape resolved `buy` from
        // whichever it got; the bubble still holds the original so the host can
        // read it back.
        const bubbles = aggregateBubbles([tick({ side: 0, buy: true }), tick({ side: 'SELL', buy: false })], 10);
        assert.deepStrictEqual(bubbles.map(b => b.side), [0, 'SELL']);
    });

    it('keeps a bucket on the time axis by its middle print', () => {
        const ticks = [
            tick({ buy: true, index: 100 }),
            tick({ buy: true, index: 101 }),
            tick({ buy: true, index: 102 }),
            tick({ buy: true, index: 103 }),
        ];
        // Two buckets of two: the representative of each is its second print.
        assert.deepStrictEqual(aggregateBubbles(ticks, 2).map(b => b.index), [101, 103]);
    });
});
