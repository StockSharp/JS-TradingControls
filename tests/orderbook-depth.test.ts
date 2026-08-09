import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { depthPolyline, depthSide, type DepthGeometry } from '../src/orderbook-depth.js';

// A box with round numbers, so every expectation below is arithmetic a reader
// can redo: the mid line at 100, two pixels of padding either side of it, and a
// 50-pixel climb from the baseline at y=50.
const BOX: DepthGeometry = { midX: 100, pad: 2, halfWidth: 98, baseY: 50, innerHeight: 50 };

const ASKS = [{ price: 10, quantity: 2 }, { price: 12, quantity: 3 }];

describe('depthSide', () => {
    it('accumulates outward from the best price, scaled by the side own span', () => {
        const side = depthSide(ASKS, 1, BOX)!;
        assert.equal(side.total, 5);
        assert.deepStrictEqual(side.points, [
            // The curve starts on the mid line at nothing accumulated.
            { x: 102, cumulative: 0 },
            // The best ask is the near edge of the side, so it lands on the same x.
            { x: 102, cumulative: 2 },
            // The far level reaches the outer edge, whatever its price distance is.
            { x: 198, cumulative: 5 },
        ]);
    });

    it('mirrors the other side around the mid line', () => {
        const side = depthSide([{ price: 10, quantity: 2 }, { price: 8, quantity: 3 }], -1, BOX)!;
        assert.deepStrictEqual(side.points.map(point => point.x), [98, 98, 2]);
    });

    it('has nothing to draw for an empty side or a side quoted at one price', () => {
        assert.equal(depthSide([], 1, BOX), null);
        assert.equal(depthSide([{ price: 10, quantity: 2 }], 1, BOX), null);
        assert.equal(depthSide([{ price: 10, quantity: 2 }, { price: 10, quantity: 4 }], 1, BOX), null);
    });
});

describe('depthPolyline', () => {
    it('steps: along at the old accumulation, then up at the new price', () => {
        const side = depthSide(ASKS, 1, BOX)!;
        assert.deepStrictEqual(depthPolyline(side, side.total, BOX), [
            [102, 50],    // on the baseline, so the filled area closes
            [102, 50],    // run to the first level, still at nothing
            [102, 30],    // 2 of 5 -> 50 - 0.4 * 50
            [198, 30],    // run out to the far level at that accumulation
            [198, 0],     // the whole side -> the full 50 of climb
        ]);
    });

    it('scales against the shared maximum, so the smaller side stays smaller', () => {
        const side = depthSide(ASKS, 1, BOX)!;
        const line = depthPolyline(side, 10, BOX);
        // Half the volume of the other side reaches half the height.
        assert.equal(line[line.length - 1][1], 25);
    });

    it('treats an empty scale as one rather than dividing by zero', () => {
        const side = depthSide(ASKS, 1, BOX)!;
        for (const [, y] of depthPolyline(side, 0, BOX)) assert.equal(Number.isFinite(y), true);
    });
});
