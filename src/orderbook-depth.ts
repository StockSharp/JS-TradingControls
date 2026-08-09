// The geometry of the order book's depth chart, as pure functions over
// numbers.
//
// The chart is a classic market-depth curve: price runs along X with the mid
// line in the middle, bids fanning left and asks right, and Y is the cumulative
// quantity from the best price on that side out to the price under the cursor.
// It is a step curve because a book is discrete — a horizontal run between two
// prices at the same accumulation, then a vertical jump where the next level
// adds its size.
//
// None of that needs a canvas, and keeping it here is what makes it testable:
// a fake 2D context can only record the calls a control made, so the numbers
// those calls carry are checked here instead, against arithmetic rather than
// against pixels.
import type { BookLevel } from './trading-data.js';

/// The box one paint fills, in device pixels.
export interface DepthGeometry {
    /// X of the mid line, which both sides start from.
    midX: number;
    /// Gap left at the mid line and at the outer edge, so the curve does not
    /// touch either.
    pad: number;
    /// Distance from the mid line to the outer edge — the width one side has.
    halfWidth: number;
    /// Y of the zero-volume baseline.
    baseY: number;
    /// Height the largest cumulative quantity rises to.
    innerHeight: number;
}

/// One accumulation point: the pixel a level sits at and the running quantity
/// up to and including it.
export interface DepthPoint {
    x: number;
    cumulative: number;
}

/// One side of the chart, ready to be stroked.
export interface DepthSide {
    points: DepthPoint[];
    /// Cumulative quantity of the whole side — what the two sides are scaled
    /// against, so the taller one reaches the top and the other keeps its
    /// proportion.
    total: number;
}

/// Accumulate one side of the book into pixel space.
///
/// `direction` is -1 for the side drawn left of the mid line and +1 for the
/// right. Each side is scaled by its OWN price span, so both fill their half
/// even when one is quoted far wider than the other — the chart is about the
/// shape of the liquidity, not about the two spans being comparable.
///
/// Null when there is nothing to draw: no levels, or every level at one price,
/// which has no span to spread over.
export function depthSide(levels: BookLevel[], direction: 1 | -1, geometry: DepthGeometry): DepthSide | null {
    if (levels.length === 0) return null;

    const best = levels[0].price;
    const worst = levels[levels.length - 1].price;
    const span = Math.abs(best - worst);
    if (!(span > 0)) return null;

    const reach = geometry.halfWidth - geometry.pad;
    const points: DepthPoint[] = [{ x: geometry.midX + direction * geometry.pad, cumulative: 0 }];
    let cumulative = 0;
    for (const level of levels) {
        cumulative += level.quantity;
        const distance = Math.abs(level.price - best);
        points.push({
            x: geometry.midX + direction * (geometry.pad + (distance / span) * reach),
            cumulative,
        });
    }
    return { points, total: cumulative };
}

/// Turn one side into the step polyline that is both stroked and filled.
///
/// Two points per level: the horizontal run arrives at the new price still at
/// the previous accumulation, then the vertical jump adds the level's size. The
/// first point sits on the baseline so the filled area closes against it.
///
/// `maxTotal` is the scale both sides share — pass the larger of the two totals
/// so the halves stay comparable.
export function depthPolyline(side: DepthSide, maxTotal: number, geometry: DepthGeometry): [number, number][] {
    const scale = maxTotal > 0 ? maxTotal : 1;
    const yOf = (cumulative: number) => geometry.baseY - (cumulative / scale) * geometry.innerHeight;

    const line: [number, number][] = [[side.points[0].x, geometry.baseY]];
    for (let i = 1; i < side.points.length; i++) {
        const previous = side.points[i - 1];
        const current = side.points[i];
        line.push([current.x, yOf(previous.cumulative)]);
        line.push([current.x, yOf(current.cumulative)]);
    }
    return line;
}
