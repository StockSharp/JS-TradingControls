// The geometry of a cumulative P&L curve, as pure functions over numbers.
//
// The same curve is read in three places and drawn at three sizes: a strategy row's sparkline,
// a statistics card, and a backtest's own chart. Only the last of those is a price chart - it
// shares the price axis and belongs to the chart engine. The other two are a curve in a box,
// and this is that curve: where each point lands, where the baseline sits, and which way the
// run ended. No canvas, so it can be checked against arithmetic rather than against pixels.

/// One sample of a run's cumulative P&L. Time is whatever the caller counts in - seconds, unix
/// milliseconds - because only the spacing between samples is used, never the absolute value.
export interface PnlPoint {
    time: number;
    value: number;
}

/// The box one curve fills, in device pixels. The padding keeps a curve at its extreme off the
/// edge, where a stroke would be clipped in half.
export interface PnlBox {
    width: number;
    height: number;
    padX: number;
    padY: number;
}

export interface PnlCurve {
    /// The curve, in draw order.
    points: [number, number][];
    /// The curve closed down to the baseline, ready to fill.
    area: [number, number][];
    /// Y of zero P&L. Always inside the box: the range is widened to include it.
    zeroY: number;
    /// The value range the box covers, zero included.
    min: number;
    max: number;
    /// Whether the run ended at or above where it started. What the curve is coloured by - and
    /// the last value, not the highest: a run that peaked and gave it all back is a loss.
    positive: boolean;
}

/// A run reduced to at most `count` samples, spanning the same stretch of time.
///
/// A sparkline that keeps only the newest N samples marches sideways: each new sample pushes the
/// oldest off the left edge, so the shape slides and the run's beginning is lost. Compressing
/// instead keeps the whole run in the box and re-buckets it, so a new sample changes the curve's
/// shape rather than its position - which is what makes two readings of the same strategy
/// comparable.
///
/// A bucket is summarised by its LAST sample, not by an average. This is a cumulative figure:
/// the last value in a bucket is where the run actually stood at that moment, while an average
/// would draw a rising run below the line it was on. Every point returned is therefore a real
/// sample, never a computed one, and the first and last are kept exactly - they are where the
/// run started and where it stands now.
export function compressPnl(points: readonly PnlPoint[], count: number): PnlPoint[] {
    if (points.length <= count || count < 2) return points.slice();

    const first = points[0];
    const last = points[points.length - 1];
    const span = last.time - first.time;

    // Every sample at the same instant: there is no time to bucket by, so fall back to position.
    if (!(span > 0)) {
        const step = (points.length - 1) / (count - 1);
        return Array.from({ length: count }, (_, i) => points[Math.round(i * step)]);
    }

    // One bucket per output point, the last sample in each standing for it. Buckets that caught
    // nothing are skipped rather than repeated, so a quiet stretch reads as a long flat segment
    // instead of as a row of identical points.
    // `count - 1` buckets, not `count`: the first sample is seeded and the last is appended, so
    // the buckets between them may contribute at most `count - 2` points. Sized any wider the
    // result can overrun `count`, and trimming it afterwards would drop the run's start - the
    // one point this function exists to keep.
    const buckets = count - 1;
    const out: PnlPoint[] = [first];
    let bucket = 0;
    for (let i = 1; i < points.length; i++) {
        const index = Math.min(buckets - 1, Math.floor(((points[i].time - first.time) / span) * buckets));
        if (index > bucket) {
            out.push(points[i - 1]);
            bucket = index;
        }
    }
    if (out[out.length - 1] !== last) out.push(last);

    return out;
}

/// Lay a run out in a box, or null when there is no curve to draw.
///
/// Two rules that are not arbitrary. Zero is always in the range, so a run that only ever won
/// still shows the line it started from and the height of the curve means something. And the
/// horizontal axis is time, not sample index: a strategy that traded twice in the morning and
/// forty times after lunch should look like that, not like a curve with evenly spaced steps.
export function pnlCurve(points: readonly PnlPoint[], box: PnlBox): PnlCurve | null {
    const clean = points
        .filter(p => p !== null && p !== undefined && Number.isFinite(p.time) && Number.isFinite(p.value))
        .slice()
        .sort((a, b) => a.time - b.time);

    if (clean.length < 2) return null;

    // One sample per drawable pixel is as much as a box can show; past that the extra points are
    // strokes on top of strokes. Compressing here rather than asking the caller to do it is what
    // lets a host keep the whole run and still get a curve that does not slide.
    const drawable = Math.max(2, Math.round(box.width - box.padX * 2));
    const shown = compressPnl(clean, drawable);

    const values = shown.map(p => p.value);
    const min = Math.min(0, ...values);
    const max = Math.max(0, ...values);

    const left = box.padX;
    const right = box.width - box.padX;
    const top = box.padY;
    const bottom = box.height - box.padY;

    const firstTime = shown[0].time;
    const lastTime = shown[shown.length - 1].time;
    const timeSpan = lastTime - firstTime;
    const valueSpan = max - min;

    // A run with no spread in one axis collapses onto a line rather than dividing by nothing:
    // every sample at the same instant stacks at the left edge, every sample at the same value
    // rests on the top edge, which for a flat run is also its baseline.
    const x = (time: number): number => (timeSpan === 0 ? left : left + ((time - firstTime) / timeSpan) * (right - left));
    const y = (value: number): number => (valueSpan === 0 ? top : bottom - ((value - min) / valueSpan) * (bottom - top));

    const curve = shown.map(p => [x(p.time), y(p.value)] as [number, number]);
    const zeroY = y(0);

    return {
        points: curve,
        // Closed along the baseline rather than along the foot of the box: a run entirely above
        // water fills the gap between itself and zero, and nothing below it.
        area: [...curve, [curve[curve.length - 1][0], zeroY], [curve[0][0], zeroY]],
        zeroY,
        min,
        max,
        positive: shown[shown.length - 1].value >= 0,
    };
}

/// What a curve is drawn with. Colours come from the caller because the page owns its palette;
/// the two directions are the same pair every other control uses for up and down.
export interface PnlCurveStyle {
    up: string;
    down: string;
    /// The zero line. A curve is read against it, so it is drawn even when nothing crosses it.
    baseline: string;
    lineWidth: number;
    /// How much of the direction colour the filled area keeps, 0 to 1.
    fillOpacity: number;
}

/// The 2D calls one paint makes. Narrow on purpose: a test supplies a recorder, and a control
/// that started reaching for something else shows up here rather than in a screenshot.
export interface PnlCurveContext {
    clearRect(x: number, y: number, w: number, h: number): void;
    beginPath(): void;
    moveTo(x: number, y: number): void;
    lineTo(x: number, y: number): void;
    closePath(): void;
    stroke(): void;
    fill(): void;
    setLineDash(segments: number[]): void;
    globalAlpha: number;
    // The browser's own type for these, so a real 2D context satisfies this contract as
    // it stands: it accepts a gradient or a pattern where this only ever writes a colour.
    strokeStyle: string | CanvasGradient | CanvasPattern;
    fillStyle: string | CanvasGradient | CanvasPattern;
    lineWidth: number;
}

/// Paint a laid-out curve: the baseline, the filled area under it, then the line itself.
export function drawPnlCurve(ctx: PnlCurveContext, curve: PnlCurve, box: PnlBox, style: PnlCurveStyle): void {
    const colour = curve.positive ? style.up : style.down;

    ctx.clearRect(0, 0, box.width, box.height);

    ctx.setLineDash([2, 3]);
    ctx.strokeStyle = style.baseline;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(box.padX, curve.zeroY);
    ctx.lineTo(box.width - box.padX, curve.zeroY);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.globalAlpha = style.fillOpacity;
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.moveTo(curve.area[0][0], curve.area[0][1]);
    for (const [px, py] of curve.area.slice(1)) ctx.lineTo(px, py);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.strokeStyle = colour;
    ctx.lineWidth = style.lineWidth;
    ctx.beginPath();
    ctx.moveTo(curve.points[0][0], curve.points[0][1]);
    for (const [px, py] of curve.points.slice(1)) ctx.lineTo(px, py);
    ctx.stroke();
}
