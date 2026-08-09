// Where every bubble, rule and label of a bubble chart goes.
//
// The trade feed's second rendering is a scatter of prints: time along X,
// price up Y, volume as the radius, direction as the colour. It is drawn on a
// canvas, which is the one surface a class name cannot reach — so the geometry
// is computed here, as numbers, and the control does nothing but stroke and
// fill what comes back.
//
// Pure, and that is the point: a fake canvas that swallows drawing calls proves
// nothing, while the arithmetic below — lanes sharing one time axis, a price
// scale per symbol, a radius that stays inside its lane — is exactly what can
// be wrong. It is covered directly.
import { aggregateBubbles, type FeedBubble, type FeedTick } from './tradefeed-aggregator.js';

/// One symbol's prints. A feed following a single symbol has one unnamed lane;
/// pinning extras splits the height into one lane each so a $76k symbol and a
/// $270 one both stay visible instead of one flattening the other.
export interface BubbleLane {
    symbol: string;
    ticks: FeedTick[];
}

export interface BubbleLayoutInput {
    width: number;
    height: number;
    lanes: BubbleLane[];
    /// How many ticks the whole feed holds. The X axis is a tick's index in
    /// that list, so lanes flow along one shared time axis rather than each
    /// stretching its own count across the full width.
    total: number;
}

/// One bubble, placed.
export interface BubbleShape {
    x: number;
    y: number;
    radius: number;
    bubble: FeedBubble;
}

/// One price label on the right-hand axis, and the rule leading to it.
export interface BubbleAxisTick {
    text: string;
    y: number;
}

/// One lane, placed. `label` is null for a feed following a single symbol —
/// naming the only lane says nothing — and `separatorY` is null for the first
/// lane, which has nothing above it to be divided from.
export interface BubbleLaneShape {
    symbol: string;
    label: { x: number; y: number } | null;
    separatorY: number | null;
    ticks: BubbleAxisTick[];
}

export interface BubbleLayout {
    /// Left edge of the axis strip: rules stop just short of it, labels start
    /// just past it.
    axisX: number;
    /// Where an axis label's text begins.
    labelX: number;
    lanes: BubbleLaneShape[];
    /// Every bubble in draw order — oldest first, so the newest print lands on
    /// top of what it overlaps. Hit-testing walks this backwards for the same
    /// reason.
    bubbles: BubbleShape[];
}

// Geometry. These are the chart's proportions, not the host's looks: a canvas
// has no cascade to read them from, and moving them into CSS would only mean
// reading them back out again.
const PAD_X = 10;
const PAD_Y = 10;
const AXIS_WIDTH = 56;
const LABEL_GAP = 4;
const LANE_GAP = 2;
const MIN_LANE_HEIGHT = 20;
const AXIS_TICKS = 3;
const MIN_RADIUS = 2;
const MAX_RADIUS = 22;
/// A bubble may grow to this share of its lane's height, so a lane with one
/// enormous print does not draw a circle taller than the lane it sits in.
const RADIUS_LANE_SHARE = 0.4;
/// Horizontal room one bucket wants. Narrower and the lane reads as a wall;
/// wider and a sparse symbol turns into a handful of lonely dots.
const BUCKET_WIDTH = 8;
const MIN_BUCKETS = 6;
const MAX_BUCKETS = 30;

/// Place every lane and every bubble for one paint.
export function layoutBubbles(input: BubbleLayoutInput): BubbleLayout {
    const { width, height, total } = input;
    const axisX = Math.max(PAD_X + 1, width - AXIS_WIDTH);
    const drawWidth = Math.max(1, axisX - PAD_X);
    const layout: BubbleLayout = { axisX, labelX: axisX + LABEL_GAP, lanes: [], bubbles: [] };

    const lanes = input.lanes.filter(lane => lane.ticks.length > 0);
    if (lanes.length === 0) return layout;

    const named = input.lanes.length > 1;
    const laneHeight = Math.max(
        MIN_LANE_HEIGHT,
        (height - 2 * PAD_Y - LANE_GAP * (input.lanes.length - 1)) / input.lanes.length);

    // Placed against the DECLARED lanes, not the non-empty ones: a symbol that
    // has not printed yet keeps its slot rather than letting the lanes below it
    // slide up and back down on its first tick.
    input.lanes.forEach((lane, position) => {
        const laneTop = named ? PAD_Y + position * (laneHeight + LANE_GAP) : PAD_Y;
        const laneSpan = named ? laneHeight : Math.max(MIN_LANE_HEIGHT, height - 2 * PAD_Y);
        const scale = priceScale(lane.ticks, laneTop, laneSpan);

        layout.lanes.push({
            symbol: lane.symbol,
            label: named ? { x: LABEL_GAP, y: laneTop + 2 } : null,
            separatorY: named && position > 0 ? laneTop - LANE_GAP / 2 : null,
            ticks: lane.ticks.length === 0 ? [] : axisTicks(scale),
        });

        if (lane.ticks.length === 0) return;
        const buckets = Math.max(MIN_BUCKETS, Math.min(MAX_BUCKETS, Math.floor(drawWidth / BUCKET_WIDTH)));
        const bubbles = aggregateBubbles(lane.ticks, buckets);
        let maxQuantity = 0;
        for (const bubble of bubbles) if (bubble.quantity > maxQuantity) maxQuantity = bubble.quantity;
        const quantityScale = Math.max(maxQuantity, Number.EPSILON);
        const radiusCap = Math.min(MAX_RADIUS, laneSpan * RADIUS_LANE_SHARE);

        for (const bubble of bubbles) {
            layout.bubbles.push({
                // Newest print (index 0) at the right edge, oldest at the left.
                x: PAD_X + drawWidth * (total <= 1 ? 1 : 1 - bubble.index / (total - 1)),
                y: scale.top + scale.height * (1 - (bubble.price - scale.min) / scale.range),
                radius: MIN_RADIUS + Math.sqrt(Math.max(0, bubble.quantity) / quantityScale) * radiusCap,
                bubble,
            });
        }
    });

    // Oldest first: a later print draws over an earlier one, and the hit test
    // reads the same list backwards so the circle on top is the one picked.
    layout.bubbles.sort((left, right) => right.bubble.index - left.bubble.index);
    return layout;
}

interface PriceScale {
    top: number;
    height: number;
    min: number;
    range: number;
}

/// The lane's price range, as the Y axis. `range` is never zero — a lane whose
/// prints are all at one price would otherwise divide by it — so a flat lane
/// draws along its own top edge rather than nowhere.
function priceScale(ticks: FeedTick[], top: number, height: number): PriceScale {
    let min = Infinity;
    let max = -Infinity;
    for (const tick of ticks) {
        if (tick.price < min) min = tick.price;
        if (tick.price > max) max = tick.price;
    }
    if (!isFinite(min) || !isFinite(max)) { min = 0; max = 0; }
    return { top, height, min, range: Math.max(max - min, Number.EPSILON) };
}

/// Three labels down the lane: its high, its middle and its low.
function axisTicks(scale: PriceScale): BubbleAxisTick[] {
    const format = priceFormatter(scale.min, scale.min + scale.range);
    const ticks: BubbleAxisTick[] = [];
    for (let step = 0; step < AXIS_TICKS; step++) {
        const fraction = step / (AXIS_TICKS - 1);
        ticks.push({
            text: format((scale.min + scale.range) - scale.range * fraction),
            y: scale.top + scale.height * fraction,
        });
    }
    return ticks;
}

/// Decimals chosen from the lane's magnitude. A fixed precision is wrong at
/// both ends: two decimals on a $76,000 print is noise, and none on a $0.04 one
/// collapses the whole lane onto a single label.
export function priceFormatter(min: number, max: number): (price: number) => string {
    const magnitude = Math.max(Math.abs(min), Math.abs(max));
    let digits = 6;
    if (magnitude >= 1000) digits = 0;
    else if (magnitude >= 10) digits = 2;
    else if (magnitude >= 0.1) digits = 4;
    return (price: number) => price.toLocaleString(undefined, {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
    });
}
