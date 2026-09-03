import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { compressPnl, pnlCurve, type PnlPoint } from '../src/pnl-curve.js';

/// A run that goes up, dips below where it started, and recovers — enough for the three things
/// the layout has to get right: the baseline sitting inside the box, the curve reaching both
/// edges of the value range, and time spacing the points rather than their index doing it.
const RUN: PnlPoint[] = [
    { time: 0, value: 0 },
    { time: 100, value: 40 },
    { time: 200, value: -20 },
    { time: 400, value: 60 },
];

const BOX = { width: 200, height: 100, padX: 0, padY: 0 };

describe('pnlCurve', () => {
    it('spreads points by time, not by their position in the list', () => {
        const curve = pnlCurve(RUN, BOX)!;

        // The last gap is twice the others, so the third point sits halfway, not two-thirds along.
        assert.deepStrictEqual(curve.points.map(p => p[0]), [0, 50, 100, 200]);
    });

    it('reaches both edges of the value range', () => {
        const curve = pnlCurve(RUN, BOX)!;
        const ys = curve.points.map(p => p[1]);

        assert.equal(Math.min(...ys), 0, 'the peak touches the top');
        assert.equal(Math.max(...ys), 100, 'the trough touches the bottom');
    });

    it('always includes zero in the range, so the baseline is on screen', () => {
        // A run that never loses still shows where it started from.
        const curve = pnlCurve([
            { time: 0, value: 10 },
            { time: 1, value: 30 },
        ], BOX)!;

        assert.equal(curve.zeroY, 100, 'zero sits at the foot of the box');
        assert.equal(curve.min, 0);
        assert.equal(curve.max, 30);
    });

    it('is positive when it ends above water and negative when it ends below', () => {
        assert.equal(pnlCurve(RUN, BOX)!.positive, true);
        assert.equal(pnlCurve([{ time: 0, value: 5 }, { time: 1, value: -5 }], BOX)!.positive, false);
        // Flat at zero is not a loss.
        assert.equal(pnlCurve([{ time: 0, value: 0 }, { time: 1, value: 0 }], BOX)!.positive, true);
    });

    it('keeps a flat run on the baseline rather than dividing by nothing', () => {
        const curve = pnlCurve([
            { time: 0, value: 7 },
            { time: 1, value: 7 },
        ], BOX)!;

        assert.deepStrictEqual(curve.points.map(p => p[1]), [0, 0]);
        assert.ok(Number.isFinite(curve.zeroY));
    });

    it('honours the padding, so a curve at its extreme is still drawn inside the box', () => {
        const curve = pnlCurve(RUN, { width: 200, height: 100, padX: 10, padY: 5 })!;
        const xs = curve.points.map(p => p[0]);
        const ys = curve.points.map(p => p[1]);

        assert.equal(Math.min(...xs), 10);
        assert.equal(Math.max(...xs), 190);
        assert.equal(Math.min(...ys), 5);
        assert.equal(Math.max(...ys), 95);
    });

    it('sorts points that arrive out of order', () => {
        const curve = pnlCurve([
            { time: 200, value: -20 },
            { time: 0, value: 0 },
            { time: 100, value: 40 },
        ], BOX)!;

        assert.deepStrictEqual(curve.points.map(p => p[0]), [0, 100, 200]);
    });

    it('draws nothing from nothing, or from a single point', () => {
        assert.equal(pnlCurve([], BOX), null);
        assert.equal(pnlCurve([{ time: 0, value: 1 }], BOX), null);
    });

    it('ignores points that carry no number', () => {
        const curve = pnlCurve([
            { time: 0, value: 0 },
            { time: 1, value: Number.NaN },
            { time: 2, value: 10 },
        ], BOX)!;

        assert.equal(curve.points.length, 2);
    });

    it('closes the filled area along the baseline, not along the bottom of the box', () => {
        // A run entirely above water fills down to zero; the fill must not reach past it.
        const curve = pnlCurve([
            { time: 0, value: 10 },
            { time: 1, value: 20 },
        ], BOX)!;

        assert.deepStrictEqual(curve.area[curve.area.length - 1], [0, curve.zeroY]);
        assert.deepStrictEqual(curve.area[curve.area.length - 2], [200, curve.zeroY]);
    });
});

describe('compressPnl', () => {
    const run = (n: number): PnlPoint[] =>
        Array.from({ length: n }, (_, i) => ({ time: i, value: Math.sin(i / 7) * 100 }));

    it('leaves a run that already fits alone', () => {
        const points = run(20);

        assert.deepStrictEqual(compressPnl(points, 50), points);
    });

    it('never returns more than it was asked for', () => {
        for (const count of [2, 10, 100]) assert.ok(compressPnl(run(1000), count).length <= count, String(count));
    });

    it('keeps the first and the last sample exactly, because they are the run', () => {
        const points = run(1000);
        const out = compressPnl(points, 40);

        assert.deepStrictEqual(out[0], points[0]);
        assert.deepStrictEqual(out[out.length - 1], points[points.length - 1]);
    });

    it('stays in time order', () => {
        const out = compressPnl(run(500), 30);

        for (let i = 1; i < out.length; i++) assert.ok(out[i].time > out[i - 1].time, `at ${i}`);
    });

    it('compresses rather than slides: one more sample does not push the first one out', () => {
        // The property the whole function exists for. A sparkline that keeps the last N samples
        // marches sideways as it fills; this keeps the run's start where it is and re-buckets.
        const before = compressPnl(run(500), 40);
        const after = compressPnl(run(501), 40);

        assert.deepStrictEqual(after[0], before[0], 'the run still starts where it started');
        assert.ok(after[after.length - 1].time > before[before.length - 1].time, 'and now ends later');
    });

    it('summarises a bucket by where the run stood at its end, not by an average', () => {
        // Cumulative P&L: the last value in a bucket is the running total at that moment, and
        // averaging a rising run would draw it below where it actually was.
        const points: PnlPoint[] = [
            { time: 0, value: 0 }, { time: 1, value: 10 }, { time: 2, value: 20 },
            { time: 3, value: 30 }, { time: 4, value: 40 },
        ];
        const out = compressPnl(points, 3);

        assert.equal(out[out.length - 1].value, 40);
        for (const p of out) assert.ok(points.some(q => q.time === p.time && q.value === p.value), 'every point is a real sample');
    });
});
