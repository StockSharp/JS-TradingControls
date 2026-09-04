// The geometry of a heatmap - one metric over two discrete axes - as pure functions over numbers.
//
// A heatmap is a lattice: every distinct value of one axis crossed with every distinct value of
// the other, one cell per pair, coloured by what that pair measured. What produced the pairs is
// not here and does not need to be - an optimisation sweep is one source of them, and the object
// is the same shape whatever the source.
//
// None of this needs a canvas, which is what makes it checkable: a fake 2D context can only
// record the calls a control made, so the numbers those calls carry are checked here, against
// arithmetic rather than against pixels.
//
// The colour comes out as a signed number in -1..1 rather than as a colour. The sign says which
// side of the anchor a cell fell on and the magnitude how far, and the control turns that into
// one of the two direction colours its host answered with. Nothing in this file knows a colour.

/// Which way is better. Stated wherever a scale is built, never inferred: a metric does not
/// carry its own direction, and a map of drawdowns would otherwise paint its worst corner in
/// the winning colour.
export const HeatDirections = {
    Higher: 'higher',
    Lower: 'lower',
} as const;

export type HeatDirection = typeof HeatDirections[keyof typeof HeatDirections];

/// One measurement: a pair of axis values, and what the metric was there. The axis values are
/// strings because an axis is discrete - "10", "00:05:00" and "True" are all positions on one,
/// and the only arithmetic they take part in is their order.
export interface HeatCell {
    x: string;
    y: string;
    value: number;
}

/// Every measurement at one pair, folded into one. Two runs at the same pair are two samples of
/// the same cell, so the cell is their mean and says how many it is the mean of: a mean over
/// five runs and a single run are not the same evidence, and a map that dropped the count would
/// read as if they were.
export interface HeatBucket {
    x: string;
    y: string;
    value: number;
    count: number;
}

export interface HeatRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/// What the colours are measured against.
export interface HeatScale {
    /// The value the colour turns over at - where a cell is neither good nor bad.
    anchor: number;
    /// Distance from the anchor to full colour, the same on both sides. Never zero: a sweep
    /// whose runs all measured the same thing has nothing to shade, and dividing by the spread
    /// it does not have would make every cell a NaN instead of a neutral one.
    reach: number;
    min: number;
    max: number;
}

export interface HeatCellShape {
    bucket: HeatBucket;
    rect: HeatRect;
    /// -1..1. The sign says which side of the anchor the cell fell on, the magnitude how far.
    tint: number;
    /// The one cell the metric says is best. Exactly one per map.
    best: boolean;
}

/// A pair the sweep never ran. It keeps its place in the lattice - a missing row would slide
/// every cell after it - and carries no value, because there is none.
export interface HeatGapShape {
    x: string;
    y: string;
    rect: HeatRect;
}

/// A string drawn at a point. Where the text anchors is geometry; which end it anchors by is
/// fixed per group and stated by the control that draws it.
export interface HeatLabel {
    text: string;
    x: number;
    y: number;
}

/// A number drawn at a point. Unformatted on purpose: how a metric reads is the control's
/// business, and a formatter passed in here would be policy hiding in the arithmetic.
export interface HeatMark {
    value: number;
    x: number;
    y: number;
}

export interface HeatLegendStep {
    rect: HeatRect;
    tint: number;
}

/// The key the map is read against. The anchor is labelled as well as the two ends, because
/// where the colour turns over is not guessable from the picture: on a sweep that never lost,
/// neutral is the middle of what was tried and not zero.
export interface HeatLegend {
    steps: HeatLegendStep[];
    low: HeatMark;
    anchor: HeatMark;
    high: HeatMark;
}

export interface HeatLayoutInput {
    /// The box one paint fills, in the units the control draws in.
    width: number;
    height: number;
    cells: readonly HeatCell[];
    betterWhen: HeatDirection;
    xLabel: string;
    yLabel: string;
}

export interface HeatLayout {
    /// The lattice itself, inside the gutters the labels need.
    plot: HeatRect;
    /// The axis values, in the order they are laid out: columns left to right, rows bottom up.
    columns: string[];
    rows: string[];
    /// Row-major from the foot of the axis, which is both draw order and scan order.
    cells: HeatCellShape[];
    gaps: HeatGapShape[];
    xTicks: HeatLabel[];
    yTicks: HeatLabel[];
    xTitle: HeatLabel;
    yTitle: HeatLabel;
    legend: HeatLegend;
    scale: HeatScale;
}

// Proportions, not looks: a canvas has no cascade to read them from, and moving them into CSS
// would only mean reading them back out again.
const LEFT_GUTTER = 54;
const RIGHT_PAD = 6;
const TOP_BAND = 26;
const BOTTOM_BAND = 30;
const TICK_GAP = 4;
const LABEL_HEIGHT = 13;
/// Half a pixel off each side, so abutting cells show a hairline of the panel between them and
/// the lattice reads as cells rather than as one continuous wash.
const CELL_INSET = 0.5;
const LEGEND_WIDTH = 140;
const LEGEND_HEIGHT = 8;
const LEGEND_Y = 14;
const LEGEND_STEPS = 28;
/// Room one label wants. Below this the labels touch, and an axis whose values overprint each
/// other is worse than an axis showing every fourth value.
const MIN_TICK_WIDTH = 34;
const MIN_TICK_HEIGHT = 13;

/// A value that is a number written as text, trailing unit included: "12", "-0.5", "7.5%".
const NUMERIC = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?\s*%?$/;

/// Every run at a pair, as one cell.
///
/// A run whose metric is not a number is dropped rather than folded in: a report that carries a
/// missing figure as an empty string would otherwise turn the whole cell into a NaN, and a NaN
/// cell paints as nothing while claiming the pair was measured.
export function foldCells(cells: readonly HeatCell[]): HeatBucket[] {
    const folded = new Map<string, { x: string; y: string; sum: number; count: number }>();
    const order: string[] = [];

    for (const cell of cells) {
        if (cell === null || cell === undefined || !Number.isFinite(cell.value)) continue;
        const id = pairKey(cell.x, cell.y);
        const found = folded.get(id);
        if (found === undefined) {
            folded.set(id, { x: cell.x, y: cell.y, sum: cell.value, count: 1 });
            order.push(id);
        } else {
            found.sum += cell.value;
            found.count += 1;
        }
    }

    return order.map(id => {
        const fold = folded.get(id)!;
        return { x: fold.x, y: fold.y, value: fold.sum / fold.count, count: fold.count };
    });
}

/// One axis, in the order it is read.
///
/// Numerically when every value on it is a number, which is the whole point: a text sort puts
/// "10" before "2" and the axis stops being monotonic, so the map's shape becomes an artefact of
/// how the values happened to be spelled. Text order otherwise - and it is the right answer for
/// the shapes that actually arrive, because .NET writes a time span at a fixed width, so
/// "00:05:00" < "00:15:00" < "01:00:00" is also chronological.
export function axisValues(values: readonly string[]): string[] {
    const unique: string[] = [];
    const seen = new Set<string>();
    for (const value of values) {
        if (seen.has(value)) continue;
        seen.add(value);
        unique.push(value);
    }

    if (unique.every(value => NUMERIC.test(value)))
        return unique.sort((left, right) => numberOf(left) - numberOf(right));

    return unique.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

/// What the colours are measured against.
///
/// Two anchors, and which one applies is decided by the data rather than by the caller. When the
/// values straddle zero, zero is the anchor: profit and loss are different in kind, not merely
/// in degree, and a map that shaded a loss green because it was less bad than the others would
/// be lying about the only thing a reader checks first. When zero is nowhere in the range - a
/// Sharpe of 1.8 to 2.2, a profit of 100 to 5000 - the anchor is the middle of the range,
/// because anchoring at a zero the sweep never came near produces one flat block with no
/// contrast, and comparing the cells with each other is what the reader came for.
///
/// The reach is the same on both sides of the anchor, so one unit of colour means one amount of
/// metric everywhere on the map. Scaling each side to its own extreme instead would make a five
/// dollar loss look exactly as red as a five hundred dollar one.
export function heatScale(buckets: readonly HeatBucket[]): HeatScale {
    let min = Infinity;
    let max = -Infinity;
    for (const bucket of buckets) {
        if (bucket.value < min) min = bucket.value;
        if (bucket.value > max) max = bucket.value;
    }
    if (!isFinite(min) || !isFinite(max)) { min = 0; max = 0; }

    const anchor = min <= 0 && max >= 0 ? 0 : (min + max) / 2;
    const reach = Math.max(Math.abs(max - anchor), Math.abs(anchor - min));

    return { anchor, reach: reach > 0 ? reach : 1, min, max };
}

/// How good a value is, as -1..1. Positive is better whichever way better runs.
export function tintOf(value: number, scale: HeatScale, betterWhen: HeatDirection): number {
    const distance = (value - scale.anchor) / scale.reach;
    const signed = betterWhen === HeatDirections.Lower ? -distance : distance;
    return Math.max(-1, Math.min(1, signed));
}

/// The inverse, for labelling a legend: what value a tint stands for.
export function valueAt(tint: number, scale: HeatScale, betterWhen: HeatDirection): number {
    const distance = betterWhen === HeatDirections.Lower ? -tint : tint;
    return scale.anchor + distance * scale.reach;
}

/// Lay one map out, or null when nothing was measured.
export function layoutHeatmap(input: HeatLayoutInput): HeatLayout | null {
    const buckets = foldCells(input.cells);
    if (buckets.length === 0) return null;

    const columns = axisValues(buckets.map(bucket => bucket.x));
    const rows = axisValues(buckets.map(bucket => bucket.y));
    const scale = heatScale(buckets);

    const plot: HeatRect = {
        x: LEFT_GUTTER,
        y: TOP_BAND,
        width: Math.max(1, input.width - LEFT_GUTTER - RIGHT_PAD),
        height: Math.max(1, input.height - TOP_BAND - BOTTOM_BAND),
    };

    const cellWidth = plot.width / columns.length;
    const cellHeight = plot.height / rows.length;
    const rectOf = (column: number, row: number): HeatRect => ({
        x: plot.x + column * cellWidth + CELL_INSET,
        // Row 0 sits at the FOOT of the plot: this is a chart, and a chart's Y grows upward. A
        // table would put it at the top, and then the map and its axis would disagree about
        // which corner is which.
        y: plot.y + plot.height - (row + 1) * cellHeight + CELL_INSET,
        width: Math.max(1, cellWidth - CELL_INSET * 2),
        height: Math.max(1, cellHeight - CELL_INSET * 2),
    });

    const measured = new Map(buckets.map(bucket => [pairKey(bucket.x, bucket.y), bucket]));
    const cells: HeatCellShape[] = [];
    const gaps: HeatGapShape[] = [];
    for (let row = 0; row < rows.length; row++) {
        for (let column = 0; column < columns.length; column++) {
            const bucket = measured.get(pairKey(columns[column], rows[row]));
            if (bucket === undefined) {
                gaps.push({ x: columns[column], y: rows[row], rect: rectOf(column, row) });
                continue;
            }
            cells.push({
                bucket,
                rect: rectOf(column, row),
                tint: tintOf(bucket.value, scale, input.betterWhen),
                best: false,
            });
        }
    }

    // The highest tint is the best cell whichever way better runs, which is the reason the tint
    // is signed by direction rather than by the metric. A tie goes to the first in scan order -
    // the cell nearest the origin - rather than to whichever run happened to arrive first.
    let best = cells[0];
    for (const shape of cells) if (shape.tint > best.tint) best = shape;
    best.best = true;

    const xTicks = tickIndices(columns.length, tickStep(columns.length, plot.width, MIN_TICK_WIDTH))
        .map(index => ({
            text: columns[index],
            x: plot.x + (index + 0.5) * cellWidth,
            y: plot.y + plot.height + TICK_GAP,
        }));

    const yTicks = tickIndices(rows.length, tickStep(rows.length, plot.height, MIN_TICK_HEIGHT))
        .map(index => ({
            text: rows[index],
            x: plot.x - TICK_GAP,
            y: plot.y + plot.height - (index + 0.5) * cellHeight,
        }));

    return {
        plot,
        columns,
        rows,
        cells,
        gaps,
        xTicks,
        yTicks,
        xTitle: { text: input.xLabel, x: plot.x + plot.width / 2, y: plot.y + plot.height + TICK_GAP + LABEL_HEIGHT },
        // Above the plot rather than beside it: a title down the left edge would have to be
        // rotated, and a rotation is a transform the control would then have to unwind around
        // everything else it draws.
        yTitle: { text: input.yLabel, x: 0, y: 0 },
        legend: legendOf(plot, scale, input.betterWhen),
        scale,
    };
}

/// The cell under a point, or null. Cells never overlap, so the first match is the only one -
/// unlike a scatter, where the hit test has to walk the draw order backwards.
export function hitHeatmap(layout: HeatLayout, x: number, y: number): HeatCellShape | null {
    for (const shape of layout.cells) {
        const rect = shape.rect;
        if (x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height)
            return shape;
    }
    return null;
}

function legendOf(plot: HeatRect, scale: HeatScale, betterWhen: HeatDirection): HeatLegend {
    const right = plot.x + plot.width;
    const left = Math.max(plot.x, right - LEGEND_WIDTH);
    const stepWidth = (right - left) / LEGEND_STEPS;

    const steps: HeatLegendStep[] = [];
    for (let step = 0; step < LEGEND_STEPS; step++) {
        steps.push({
            // Half a pixel of overlap: abutting fills leave a seam wherever the boundary is
            // fractional, and a key with a comb of background through it reads as a scale with
            // holes in it.
            rect: { x: left + step * stepWidth, y: LEGEND_Y, width: stepWidth + 0.5, height: LEGEND_HEIGHT },
            tint: -1 + (2 * step) / (LEGEND_STEPS - 1),
        });
    }

    return {
        steps,
        low: { value: valueAt(-1, scale, betterWhen), x: left, y: 0 },
        anchor: { value: scale.anchor, x: (left + right) / 2, y: 0 },
        high: { value: valueAt(1, scale, betterWhen), x: right, y: 0 },
    };
}

/// How many values to skip between labels so they do not touch.
function tickStep(count: number, span: number, room: number): number {
    const slots = Math.max(1, Math.floor(span / room));
    return Math.max(1, Math.ceil(count / slots));
}

/// Which values get a label. The last one always does - the end of an axis is what a reader
/// checks first - and the label before it gives way when the step would land them on top of
/// each other.
function tickIndices(count: number, step: number): number[] {
    const indices: number[] = [];
    for (let index = 0; index < count; index += step) indices.push(index);

    const last = count - 1;
    if (indices[indices.length - 1] !== last) {
        if (last - indices[indices.length - 1] < step) indices.pop();
        indices.push(last);
    }
    return indices;
}

/// A pair as one map key. NUL rather than a printable separator: an axis value may contain any
/// character a parameter's own notation uses, and "a|b" crossed with "c" must not collide with
/// "a" crossed with "b|c".
function pairKey(x: string, y: string): string {
    return `${x}\u0000${y}`;
}

function numberOf(value: string): number {
    return Number(value.trim().replace(/%$/, ''));
}
