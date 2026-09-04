import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { asDom, asFake, el, installFakeDom, resizeObservers, type FakeCanvasContext, type FakeElement } from './fake-dom.js';
import { fakeHost } from './fake-host.js';
import { HeatDirections, axisValues, foldCells, heatScale, hitHeatmap, layoutHeatmap, tintOf } from '../src/heatmap-grid.js';
import { OptimizationHeatmapWidget, type HeatmapData } from '../src/optimization-heatmap-widget.js';

installFakeDom();

/// A three by two sweep with one pair run twice, one pair that lost, one that broke even and
/// one that was never run - enough for everything the map has to get right: the fold, the
/// anchor, the gap, and which corner is best.
const SWEEP: HeatmapData = {
    xLabel: 'Length',
    yLabel: 'Threshold',
    metricLabel: 'Net profit',
    betterWhen: HeatDirections.Higher,
    cells: [
        { x: '2', y: '1', value: 0 },
        { x: '2', y: '2', value: 200 },
        { x: '2', y: '2', value: 100 },
        { x: '5', y: '1', value: -100 },
        { x: '5', y: '2', value: 50 },
        { x: '10', y: '1', value: 20 },
    ],
};

const BOX = { width: 400, height: 200 };

function laid(data: HeatmapData = SWEEP) {
    return layoutHeatmap({
        width: BOX.width, height: BOX.height, cells: data.cells,
        betterWhen: data.betterWhen, xLabel: data.xLabel, yLabel: data.yLabel,
    })!;
}

function cellAt(x: string, y: string) {
    return laid().cells.find(shape => shape.bucket.x === x && shape.bucket.y === y)!;
}

function panel(data: HeatmapData = SWEEP) {
    const parent = el('div');
    const host = fakeHost();
    const widget = OptimizationHeatmapWidget.create(asDom(parent), {}, { host });
    // There is no layout engine here, so the box a canvas sizes itself from is whatever the
    // test says it is.
    asFake(widget.canvasEl).setRect({ left: 0, top: 0, width: BOX.width, height: BOX.height });
    widget.update(data);
    return { widget, host, root: parent.childNodes[0] as FakeElement };
}

function context(widget: OptimizationHeatmapWidget): FakeCanvasContext {
    return asFake(widget.canvasEl).getContext('2d')!;
}

function fillsAt(widget: OptimizationHeatmapWidget, rect: { x: number; y: number }): string[] {
    return context(widget).opsOf('fillRect')
        .filter(call => call.args[0] === rect.x && call.args[1] === rect.y)
        .map(call => call.fillStyle);
}

describe('the heatmap lattice', () => {
    it('orders an axis by its numbers, so 10 does not come after 2 by accident', () => {
        assert.deepStrictEqual(axisValues(['10', '2', '5', '2']), ['2', '5', '10']);
    });

    it('falls back to text order, which is the right order for the shapes that arrive', () => {
        // .NET writes a time span at a fixed width, so text order is chronological order.
        assert.deepStrictEqual(
            axisValues(['01:00:00', '00:05:00', '1.00:00:00', '00:15:00']),
            ['00:05:00', '00:15:00', '01:00:00', '1.00:00:00']);
    });

    it('folds two runs at one pair into their mean, and says how many it is a mean of', () => {
        const folded = foldCells(SWEEP.cells);
        const twice = folded.find(bucket => bucket.x === '2' && bucket.y === '2')!;

        assert.equal(twice.value, 150);
        assert.equal(twice.count, 2);
        assert.equal(folded.length, 5, 'six runs, five pairs');
    });

    it('drops a run whose metric is not a number rather than folding it in', () => {
        // One NaN would otherwise turn the whole cell into a NaN, which paints as nothing while
        // still claiming the pair was measured.
        const folded = foldCells([
            { x: '1', y: '1', value: Number.NaN },
            { x: '1', y: '1', value: 10 },
        ]);

        assert.deepStrictEqual(folded, [{ x: '1', y: '1', value: 10, count: 1 }]);
    });

    it('anchors the colour at zero when the sweep both won and lost', () => {
        const scale = heatScale(foldCells(SWEEP.cells));

        assert.equal(scale.anchor, 0);
        // Symmetric: the same distance means the same colour on both sides, so a small loss
        // beside a large profit reads as the small loss it is.
        assert.equal(scale.reach, 150);
    });

    it('anchors it at the middle of the range when zero is nowhere in it', () => {
        // A Sharpe of 1.8 to 2.2 anchored at zero is one flat block of green with no contrast,
        // and comparing the cells with each other is what the reader came for.
        const scale = heatScale(foldCells([
            { x: '1', y: '1', value: 1.8 },
            { x: '2', y: '1', value: 2.2 },
        ]));

        assert.equal(scale.anchor, 2);
        assert.ok(Math.abs(scale.reach - 0.2) < 1e-9, String(scale.reach));
    });

    it('shades a flat sweep neutrally instead of dividing by a spread it has not got', () => {
        const scale = heatScale(foldCells([
            { x: '1', y: '1', value: 7 },
            { x: '2', y: '1', value: 7 },
        ]));

        assert.equal(tintOf(7, scale, HeatDirections.Higher), 0);
    });

    it('reads the tint the other way round when lower is better', () => {
        const scale = heatScale(foldCells([
            { x: '1', y: '1', value: 0 },
            { x: '2', y: '1', value: 400 },
        ]));

        // A drawdown of 400 against a best of nothing: the worst corner, not the winning one.
        assert.equal(tintOf(400, scale, HeatDirections.Lower), -1);
        assert.equal(tintOf(400, scale, HeatDirections.Higher), 1);
    });

    it('puts the first row of the axis at the foot of the plot, the way a chart does', () => {
        assert.ok(cellAt('2', '2').rect.y < cellAt('2', '1').rect.y);
        assert.ok(cellAt('5', '1').rect.x > cellAt('2', '1').rect.x);
    });

    it('tiles the plot: a cell per pair, measured or not', () => {
        const map = laid();

        assert.deepStrictEqual(map.columns, ['2', '5', '10']);
        assert.deepStrictEqual(map.rows, ['1', '2']);
        assert.equal(map.cells.length + map.gaps.length, 6);
        assert.ok(Math.abs(map.cells[0].rect.width - map.plot.width / 3) < 2);
        assert.ok(Math.abs(map.cells[0].rect.height - map.plot.height / 2) < 2);
    });

    it('leaves the pair nobody ran as a gap rather than as a measured zero', () => {
        assert.deepStrictEqual(laid().gaps.map(gap => [gap.x, gap.y]), [['10', '2']]);
    });

    it('marks exactly one cell as the best', () => {
        const best = laid().cells.filter(shape => shape.best);

        assert.equal(best.length, 1);
        assert.deepStrictEqual([best[0].bucket.x, best[0].bucket.y], ['2', '2']);
    });

    it('marks the lowest cell instead when lower is better', () => {
        const map = layoutHeatmap({
            ...BOX, cells: SWEEP.cells, betterWhen: HeatDirections.Lower, xLabel: 'x', yLabel: 'y',
        })!;

        assert.deepStrictEqual(
            [map.cells.find(shape => shape.best)!.bucket.x, map.cells.find(shape => shape.best)!.bucket.y],
            ['5', '1']);
    });

    it('thins the tick labels rather than overprinting them, and always labels the end', () => {
        const wide = layoutHeatmap({
            width: 400, height: 200, betterWhen: HeatDirections.Higher, xLabel: 'x', yLabel: 'y',
            cells: Array.from({ length: 40 }, (_, i) => ({ x: String(i), y: '1', value: i })),
        })!;

        assert.equal(wide.columns.length, 40, 'every column is still a column');
        assert.ok(wide.xTicks.length < 20, `${wide.xTicks.length} labels across 340px`);
        assert.equal(wide.xTicks[0].text, '0');
        assert.equal(wide.xTicks[wide.xTicks.length - 1].text, '39');
    });

    it('labels the legend with both ends of the scale and the anchor between them', () => {
        const legend = laid().legend;

        assert.equal(legend.low.value, -150);
        assert.equal(legend.anchor.value, 0);
        assert.equal(legend.high.value, 150);
        assert.ok(legend.steps.length > 8, 'enough steps to read as a ramp');
    });

    it('draws nothing from a sweep that measured nothing', () => {
        assert.equal(layoutHeatmap({ ...BOX, cells: [], betterWhen: HeatDirections.Higher, xLabel: 'x', yLabel: 'y' }), null);
    });

    it('finds the cell under a point, and nothing over a gap', () => {
        const map = laid();
        const best = map.cells.find(shape => shape.best)!;
        const gap = map.gaps[0];

        assert.equal(hitHeatmap(map, best.rect.x + best.rect.width / 2, best.rect.y + best.rect.height / 2), best);
        assert.equal(hitHeatmap(map, gap.rect.x + gap.rect.width / 2, gap.rect.y + gap.rect.height / 2), null);
    });
});

describe('OptimizationHeatmapWidget', () => {
    it('captions itself with the metric the colours mean', () => {
        const { root } = panel();

        assert.equal(root.querySelector('.heatmap-metric')!.textContent, 'Net profit');
    });

    it('sizes its backing store to the display before it paints', () => {
        const { widget } = panel();
        const canvas = asFake(widget.canvasEl);

        assert.equal(canvas.width, 400, 'a canvas left at its default size draws at the wrong scale');
        assert.equal(canvas.height, 200);
        assert.deepStrictEqual(context(widget).opsOf('setTransform').at(-1)!.args, [1, 0, 0, 1, 0, 0]);
    });

    it('paints every cell in the palette the HOST answered with', () => {
        const { widget } = panel();
        const ctx = context(widget);

        // `test-up` / `test-down` / `test-grid` are the fake host's answer, not colours this
        // package could have written: a literal here would fail on sight.
        assert.deepStrictEqual(
            [...new Set(ctx.opsOf('fillRect').map(call => call.fillStyle))].sort(),
            ['test-down', 'test-grid', 'test-up']);
        assert.equal(ctx.opsOf('fillText').every(call => call.fillStyle === 'test-grid'), true);
        assert.equal(ctx.font, 'test-font');
    });

    it('paints a losing pair down and a winning one up', () => {
        const { widget } = panel();

        // Ground first, then as much of the direction colour as the cell earned.
        assert.deepStrictEqual(fillsAt(widget, cellAt('5', '1').rect), ['test-grid', 'test-down']);
        assert.deepStrictEqual(fillsAt(widget, cellAt('2', '2').rect), ['test-grid', 'test-up']);
    });

    it('still draws a cell sitting exactly on the anchor', () => {
        const { widget } = panel();

        // No tint at all, and still visibly a cell: the ground under it is what tells a pair
        // that broke even from a pair that was never run.
        assert.deepStrictEqual(fillsAt(widget, cellAt('2', '1').rect), ['test-grid']);
    });

    it('strikes the pair nobody ran through instead of colouring it', () => {
        const { widget } = panel();
        const gap = laid().gaps[0];

        assert.deepStrictEqual(fillsAt(widget, gap.rect), [], 'no fill of any kind');
        const diagonal = context(widget).opsOf('moveTo')
            .some(call => call.args[0] === gap.rect.x && call.args[1] === gap.rect.y + gap.rect.height);
        assert.equal(diagonal, true);
    });

    it('says what a cell is on hover, the run count included when it is a mean', () => {
        const { widget, root } = panel();
        const canvas = asFake(widget.canvasEl);
        const best = cellAt('2', '2');

        canvas.dispatchEvent({
            type: 'mousemove',
            clientX: best.rect.x + best.rect.width / 2,
            clientY: best.rect.y + best.rect.height / 2,
        });

        const tooltip = root.querySelector('.heatmap-tooltip')!;
        assert.equal(tooltip.getAttribute('hidden'), null);
        assert.deepStrictEqual(
            tooltip.querySelectorAll('.heatmap-tt-label').map(node => node.textContent),
            ['Length', 'Threshold', 'Net profit', 'Runs']);
        assert.deepStrictEqual(
            tooltip.querySelectorAll('.heatmap-tt-value').map(node => node.textContent),
            ['2', '2', '150', '2']);
        assert.equal(tooltip.querySelector('.heatmap-tt-best')!.textContent, 'Best');
    });

    it('leaves the count off a cell that is one run, and says nothing over a gap', () => {
        const { widget, root } = panel();
        const canvas = asFake(widget.canvasEl);
        const single = cellAt('5', '2');
        const gap = laid().gaps[0];
        const tooltip = root.querySelector('.heatmap-tooltip')!;

        canvas.dispatchEvent({
            type: 'mousemove',
            clientX: single.rect.x + single.rect.width / 2,
            clientY: single.rect.y + single.rect.height / 2,
        });
        assert.deepStrictEqual(
            tooltip.querySelectorAll('.heatmap-tt-label').map(node => node.textContent),
            ['Length', 'Threshold', 'Net profit'], 'a count of one on every cell is a column of noise');
        assert.equal(tooltip.querySelector('.heatmap-tt-best'), null);

        canvas.dispatchEvent({
            type: 'mousemove',
            clientX: gap.rect.x + gap.rect.width / 2,
            clientY: gap.rect.y + gap.rect.height / 2,
        });
        assert.equal(tooltip.getAttribute('hidden'), '', 'a pair nobody ran has nothing to say');
    });

    it('says so when the sweep measured nothing', () => {
        const { widget, root } = panel({ ...SWEEP, cells: [] });

        assert.equal(root.querySelector('.heatmap-empty')!.getAttribute('hidden'), null);
        assert.equal(context(widget).opsOf('fillRect').length, 0);
    });

    it('repaints when its box changes, without being told a window exists', () => {
        const { widget } = panel();
        const before = context(widget).calls.length;

        asFake(widget.canvasEl).setRect({ left: 0, top: 0, width: 800, height: 400 });
        resizeObservers.at(-1)!.callback();

        assert.equal(asFake(widget.canvasEl).width, 800);
        assert.ok(context(widget).calls.length > before);
    });

    it('lets go of its observer and its host when it goes away', () => {
        const { widget, host } = panel();

        widget.dispose();

        assert.equal(resizeObservers.at(-1)!.disconnected, true);
        assert.equal(host.calls.registered.includes(widget), true, 'it announced itself while it lived');
    });
});
