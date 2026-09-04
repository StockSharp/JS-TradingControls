// The surface's geometry, checked against arithmetic.
//
// Everything here is a number a canvas would later turn into a stroke, so none of it needs one:
// where a corner lands, which face is in front, which pair leaves a hole, and what a drag or a
// pinch does to the view.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { HeatDirections, type HeatCell } from '../src/heatmap-grid.js';
import {
    DEFAULT_VIEW, MAX_PITCH, MIN_PITCH, SURFACE_HEIGHT_TICKS, clampView, dragView, nearestVertex,
    project, surfaceLayout, zoomView,
    type SurfaceView,
} from '../src/surface-grid.js';
import { wheelNotches } from '../src/surface-widget.js';

/// A 3x3 sweep with a single peak in the middle - enough for a ridge, a hole and an ordering.
const GRID: HeatCell[] = [
    { x: '5', y: '30', value: 10 }, { x: '5', y: '50', value: 20 }, { x: '5', y: '80', value: 15 },
    { x: '8', y: '30', value: 20 }, { x: '8', y: '50', value: 90 }, { x: '8', y: '80', value: 25 },
    { x: '12', y: '30', value: 12 }, { x: '12', y: '50', value: 30 }, { x: '12', y: '80', value: 18 },
];

const BOX = { width: 400, height: 300 };
const layout = (cells: HeatCell[] = GRID, view: SurfaceView = DEFAULT_VIEW) =>
    surfaceLayout({ width: BOX.width, height: BOX.height, cells, betterWhen: HeatDirections.Higher, view });

describe('surfaceLayout', () => {
    it('makes a quad per square of the grid, not per point', () => {
        // Three by three points is two by two squares.
        assert.equal(layout()!.quads.length, 4);
    });

    it('steps a numeric axis in numeric order, not alphabetical', () => {
        const out = layout()!;

        assert.deepStrictEqual(out.xValues, ['5', '8', '12'], '12 sorts after 8, not before 5');
        assert.deepStrictEqual(out.yValues, ['30', '50', '80']);
    });

    it('leaves a hole where a pair has no run, rather than spanning it', () => {
        const withGap = GRID.filter(c => !(c.x === '8' && c.y === '50'));
        const out = layout(withGap)!;

        // The missing point is a corner of all four squares, so all four go.
        assert.equal(out.quads.length, 0);
    });

    it('draws far to near, so a near ridge covers what is behind it', () => {
        const depths = layout()!.quads.map(q => q.depth);

        for (let i = 1; i < depths.length; i++)
            assert.ok(depths[i] >= depths[i - 1], `out of order at ${i}: ${depths.join(', ')}`);
    });

    it('tints a face by the mean of its corners, not by whichever came first', () => {
        const out = layout()!;
        // The tint is signed around the scale's anchor, exactly as the flat map's is - and it is
        // a MEAN, so a single peak among low neighbours does not make its faces positive: the
        // peak is one corner of four. What must hold is that the faces touching it are the
        // brightest of the four, and that nothing leaves the scale.
        const brightest = out.quads.reduce((best, q) => (q.tint > best.tint ? q : best));
        const darkest = out.quads.reduce((worst, q) => (q.tint < worst.tint ? q : worst));

        assert.ok(brightest.tint > darkest.tint, 'a flat map of one peak has a bright end');
        for (const q of out.quads) assert.ok(q.tint >= -1 && q.tint <= 1, `tint ${q.tint} out of range`);
    });

    it('is flat when every run scored the same, rather than picking a winner out of noise', () => {
        const level: HeatCell[] = GRID.map(c => ({ ...c, value: 42 }));
        const out = layout(level)!;

        for (const q of out.quads) assert.equal(q.tint, 0, 'no cell is better than any other');

        // A flat surface sits at one height, so its corners span no more than the floor does.
        const ys = out.quads.flatMap(q => q.points.map(([, y]) => y));
        const floorYs = [[-1, -1], [1, -1], [1, 1], [-1, 1]]
            .map(([nx, ny]) => project(nx, ny, 0.5, DEFAULT_VIEW, BOX).y);
        assert.ok(Math.max(...ys) - Math.min(...ys) <= Math.max(...floorYs) - Math.min(...floorYs) + 0.001);
    });

    it('names each face by the cell at its near corner', () => {
        for (const quad of layout()!.quads) {
            assert.ok(quad.bucket.x.length > 0);
            assert.ok(GRID.some(c => c.x === quad.bucket.x && c.y === quad.bucket.y));
        }
    });

    it('says nothing when one axis has a single value, because a line is not a surface', () => {
        const oneColumn: HeatCell[] = [
            { x: '5', y: '30', value: 1 }, { x: '5', y: '50', value: 2 },
        ];

        assert.equal(layout(oneColumn), null);
    });

    it('says nothing when there is nothing at all', () => {
        assert.equal(layout([]), null);
    });

    it('frames all three axes, the two swept and the one measured', () => {
        const axes = layout()!.axes;

        assert.deepStrictEqual(axes.map(a => a.axis), ['x', 'y', 'z']);
        for (const a of axes) assert.ok(a.from[0] !== a.to[0] || a.from[1] !== a.to[1], 'an edge of no length');
    });

    it('marks every swept value while they fit', () => {
        const axes = layout()!.axes;
        const x = axes.find(a => a.axis === 'x')!;
        const y = axes.find(a => a.axis === 'y')!;

        assert.deepStrictEqual(x.ticks.map(t => t.label), ['5', '8', '12']);
        assert.deepStrictEqual(y.ticks.map(t => t.label), ['30', '50', '80']);
    });

    it('thins a long axis but keeps its ends, so the span still reads true', () => {
        const many: HeatCell[] = [];
        for (let i = 0; i < 40; i++) many.push({ x: String(i), y: '30', value: i });
        // Two rows, because one row of points makes no square and therefore no surface.
        for (let i = 0; i < 40; i++) many.push({ x: String(i), y: '50', value: i });

        const x = layout(many)!.axes.find(a => a.axis === 'x')!;

        assert.ok(x.ticks.length <= 9, `40 values wrote ${x.ticks.length} labels`);
        assert.equal(x.ticks[0].label, '0');
        assert.equal(x.ticks[x.ticks.length - 1].label, '39', 'the far end of the sweep went unmarked');
    });

    it('marks the height axis at every step of the scale', () => {
        const z = layout()!.axes.find(a => a.axis === 'z')!;

        assert.deepStrictEqual(z.ticks.map(t => Number(t.label)), [...SURFACE_HEIGHT_TICKS]);
    });

    it('leans every axis away from the floor, whichever way it is turned', () => {
        // What a label needs is to sit outside the landscape, and what puts it there is the
        // direction its axis leans: one direction per edge, so a row of labels stays a row rather
        // than fanning out. The check is on that direction - pushing the edge along it has to
        // increase its distance from the middle of the floor - and every tick on the edge carries
        // the same one.
        for (const view of [DEFAULT_VIEW, { yaw: 2.1, pitch: 0.5, zoom: 1 }, { yaw: -1.3, pitch: 0.2, zoom: 2 }]) {
            const out = layout(GRID, view)!;
            const centre = project(0, 0, 0, view, BOX);

            for (const axis of out.axes) {
                assert.ok(axis.ticks.length > 0, `the ${axis.axis} axis carries no marks`);

                const away = axis.ticks[0].away;
                const length = Math.hypot(away[0], away[1]);
                assert.ok(Math.abs(length - 1) < 1e-9, 'the lean is not a unit direction');

                const midX = (axis.from[0] + axis.to[0]) / 2;
                const midY = (axis.from[1] + axis.to[1]) / 2;
                const before = Math.hypot(midX - centre.x, midY - centre.y);
                const after = Math.hypot(midX + away[0] * 10 - centre.x, midY + away[1] * 10 - centre.y);
                assert.ok(after > before, `the ${axis.axis} axis leans onto the surface`);

                for (const tick of axis.ticks)
                    assert.deepStrictEqual(tick.away, away, 'marks on one edge lean different ways');
            }
        }
    });

    it('offers a vertex per run, and none for a pair nobody ran', () => {
        const full = layout()!;
        assert.equal(full.vertices.length, 9);

        const withGap = GRID.filter(c => !(c.x === '8' && c.y === '50'));
        assert.equal(layout(withGap)!.vertices.length, 8, 'a hole was offered as a reading');
    });

    it('carries the run own figure on its vertex, not the height it was drawn at', () => {
        const peak = layout()!.vertices.find(v => v.x === '8' && v.y === '50')!;

        assert.equal(peak.value, 90);
    });
});

describe('nearestVertex', () => {
    const vertices = [
        { at: [10, 10] as [number, number], x: '5', y: '30', value: 1, depth: 0 },
        { at: [40, 10] as [number, number], x: '8', y: '30', value: 2, depth: 0 },
    ];

    it('answers the one within reach', () => {
        assert.equal(nearestVertex(vertices, 12, 12, 20)?.x, '5');
        assert.equal(nearestVertex(vertices, 38, 8, 20)?.x, '8');
    });

    it('answers nothing rather than the far side of a gap', () => {
        assert.equal(nearestVertex(vertices, 200, 200, 20), null);
    });

    it('breaks a tie towards the viewer, so a near ridge wins over what is behind it', () => {
        const front = { at: [10, 10] as [number, number], x: 'near', y: 'near', value: 9, depth: 5 };
        const back = { at: [10, 10] as [number, number], x: 'far', y: 'far', value: 1, depth: -5 };

        assert.equal(nearestVertex([back, front], 10, 10, 20)?.x, 'near');
        assert.equal(nearestVertex([front, back], 10, 10, 20)?.x, 'near');
    });
});

describe('wheelNotches', () => {
    it('reads one mouse notch as one notch', () => {
        assert.equal(wheelNotches(100, 0), 1);
        assert.equal(wheelNotches(-100, 0), -1);
    });

    it('reads a trackpad stroke as the fraction of a notch it is', () => {
        // The bug this replaced: a step taken per event zoomed a trackpad's stream of small
        // deltas as hard as a mouse's single large one.
        assert.ok(Math.abs(wheelNotches(8, 0)) < 0.2, 'a nudge moved a whole notch');
    });

    it('reads lines and pages, which is how a mouse reports on some browsers', () => {
        assert.equal(wheelNotches(3, 1), 1, 'three lines is a notch');
        assert.equal(wheelNotches(1, 2), 1, 'a page is a notch');
    });

    it('clamps a runaway delta, so no single event zooms the whole range', () => {
        assert.equal(wheelNotches(100000, 0), 2);
        assert.equal(wheelNotches(-100000, 0), -2);
    });

    it('ignores a delta that says nothing', () => {
        assert.equal(wheelNotches(0, 0), 0);
        assert.equal(wheelNotches(Number.NaN, 0), 0);
    });
});

describe('project', () => {
    it('puts the middle of the floor in the middle of the box', () => {
        const p = project(0, 0, 0, { yaw: 0, pitch: 0.6, zoom: 1 }, BOX);

        assert.equal(Math.round(p.x), BOX.width / 2);
        assert.equal(Math.round(p.y), BOX.height / 2);
    });

    it('draws height upward, which is a smaller screen y', () => {
        const view = { yaw: 0, pitch: 0.6, zoom: 1 };
        const floor = project(0, 0, 0, view, BOX);
        const high = project(0, 0, 1, view, BOX);

        assert.ok(high.y < floor.y, `${high.y} should be above ${floor.y}`);
    });

    it('keeps the surface the same size as it turns', () => {
        // The corner farthest from the middle, at two rotations a quarter turn apart: a
        // projection that fitted the side rather than the diagonal would breathe as it spun.
        const reach = (yaw: number) => {
            const view = { yaw, pitch: 0.6, zoom: 1 };
            return Math.max(...[[-1, -1], [1, -1], [1, 1], [-1, 1]]
                .map(([nx, ny]) => Math.abs(project(nx, ny, 0, view, BOX).x - BOX.width / 2)));
        };

        assert.ok(Math.abs(reach(0) - reach(Math.PI / 2)) < 0.001);
    });

    it('zooms about the middle', () => {
        const near = project(1, 1, 0, { yaw: 0.3, pitch: 0.6, zoom: 1 }, BOX);
        const far = project(1, 1, 0, { yaw: 0.3, pitch: 0.6, zoom: 2 }, BOX);

        assert.ok(Math.abs(far.x - BOX.width / 2) > Math.abs(near.x - BOX.width / 2));
    });
});

describe('the view a gesture leaves behind', () => {
    it('wraps a turn rather than stopping it', () => {
        const spun = clampView({ ...DEFAULT_VIEW, yaw: Math.PI * 3 });

        assert.ok(spun.yaw >= 0 && spun.yaw < Math.PI * 2, `${spun.yaw}`);
    });

    it('will not tip past edge-on or past a top view', () => {
        assert.equal(clampView({ ...DEFAULT_VIEW, pitch: -5 }).pitch, MIN_PITCH);
        assert.equal(clampView({ ...DEFAULT_VIEW, pitch: 5 }).pitch, MAX_PITCH);
    });

    it('turns on a horizontal drag and tips on a vertical one', () => {
        const turned = dragView(DEFAULT_VIEW, 40, 0);
        const tipped = dragView(DEFAULT_VIEW, 0, 40);

        assert.notEqual(turned.yaw, clampView(DEFAULT_VIEW).yaw);
        assert.equal(turned.pitch, clampView(DEFAULT_VIEW).pitch, 'a sideways drag does not tip');
        assert.ok(tipped.pitch > clampView(DEFAULT_VIEW).pitch, 'dragging down brings the far edge up');
        assert.equal(tipped.yaw, clampView(DEFAULT_VIEW).yaw, 'a vertical drag does not turn');
    });

    it('holds the zoom between what is legible and what is useful', () => {
        let view = DEFAULT_VIEW;
        for (let i = 0; i < 20; i++) view = zoomView(view, 2);
        assert.ok(view.zoom <= 4, `${view.zoom}`);

        for (let i = 0; i < 40; i++) view = zoomView(view, 0.5);
        assert.ok(view.zoom >= 0.4, `${view.zoom}`);
    });

    it('leaves the other two alone when only one changes', () => {
        const zoomed = zoomView(DEFAULT_VIEW, 1.5);

        assert.equal(zoomed.yaw, clampView(DEFAULT_VIEW).yaw);
        assert.equal(zoomed.pitch, DEFAULT_VIEW.pitch);
    });
});
