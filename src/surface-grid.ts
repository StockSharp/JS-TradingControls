// The geometry of a 3D surface over a grid, as pure functions over numbers.
//
// The same measurements the heatmap lays out flat, lifted: one metric over two discrete axes,
// with the metric as height instead of as colour. It reads the same `HeatCell[]` and folds them
// the same way, so a consumer that can draw one can draw the other from the identical input.
//
// There is no library under this. A surface is a grid of quads, a rotation is two angles, and a
// projection is six multiplications - all of it arithmetic, which is why it lives here and can be
// checked against numbers rather than against pixels. What the canvas does with the result is
// stroke and fill, nothing more.
//
// Orthographic rather than perspective. A surface is read by comparing heights across it, and
// perspective makes the far side of a ridge shorter than the near side of the same ridge - the
// one comparison the picture exists to support is the one it would distort.
import { foldCells, heatScale, tintOf, type HeatBucket, type HeatCell, type HeatDirection, type HeatScale } from './heatmap-grid.js';

/// Where the surface is looked at from.
export interface SurfaceView {
    /// Rotation about the vertical axis, in radians. Wraps.
    yaw: number;
    /// Tilt, in radians. Clamped: at zero the surface is edge-on and every cell is a line, and
    /// past a right angle the picture flips under itself.
    pitch: number;
    /// How much of the box the surface fills. 1 is fitted; larger magnifies.
    zoom: number;
}

/// The box to draw in, in CSS pixels.
export interface SurfaceBox {
    width: number;
    height: number;
}

/// One cell of the surface, as four projected corners.
export interface SurfaceQuad {
    /// The corners, in draw order.
    points: [number, number][];
    /// Where the cell's value sits against the scale's anchor, -1..1 by `betterWhen` - what the
    /// fill is tinted by, so the surface is coloured exactly the way the flat map is.
    tint: number;
    /// How far from the viewer, for painter ordering. Larger is nearer.
    depth: number;
    /// What this cell is, so a caption can name it without a second lookup.
    bucket: HeatBucket;
}

/// One edge of the floor, projected - the frame that says which way the grid runs.
export interface SurfaceAxis {
    from: [number, number];
    to: [number, number];
    /// Which axis this edge belongs to, so a consumer can label it. `z` is the vertical one, the
    /// scale the surface is measured against.
    axis: 'x' | 'y' | 'z';
    /// Where the ticks fall along it, already projected.
    ticks: SurfaceTick[];
}

/// One mark on an axis: where it lands on screen, what it says, and which way to push the text so
/// it sits outside the floor rather than on it.
export interface SurfaceTick {
    at: [number, number];
    /// The value, worded by whoever built the layout: a parameter as it was swept, a height as the
    /// metric it measures.
    label: string;
    /// Unit vector pointing away from the surface, for the tick stroke and the text offset.
    away: [number, number];
}

/// One measured point of the grid, where it landed and what it is worth. The readout under a
/// pointer is found here rather than by inverting the projection: a projection that flattens three
/// dimensions into two has no single inverse, and the nearest projected vertex is the answer a
/// reader means anyway.
export interface SurfaceVertex {
    at: [number, number];
    x: string;
    y: string;
    value: number;
    /// Nearer the viewer is larger, so two vertices over the same pixel resolve to the front one.
    depth: number;
}

export interface SurfaceLayout {
    /// Far to near: painted in order, nearer cells cover farther ones.
    quads: SurfaceQuad[];
    axes: SurfaceAxis[];
    /// Every measured point, for the readout under a pointer.
    vertices: SurfaceVertex[];
    /// The values each axis steps through, in the order the grid uses them.
    xValues: string[];
    yValues: string[];
    scale: HeatScale;
}

export interface SurfaceInput {
    width: number;
    height: number;
    cells: readonly HeatCell[];
    betterWhen: HeatDirection;
    view: SurfaceView;
}

/// The tilt the surface starts at, and the bounds a drag may take it to.
///
/// Not zero and not a right angle: at zero every cell collapses to a line, and at a right angle
/// the surface is the flat map, which is the other control. The default sits where a ridge reads
/// as a ridge.
export const MIN_PITCH = 0.12;
export const MAX_PITCH = 1.45;
export const DEFAULT_VIEW: SurfaceView = { yaw: -0.7, pitch: 0.62, zoom: 1 };

/// How far a drag turns the surface, in radians per CSS pixel. Slow enough that a phone's thumb
/// can land on a face, fast enough that a mouse crosses the whole rotation in one sweep.
const DRAG_TO_RADIANS = 0.008;

const MIN_ZOOM = 0.4;
const MAX_ZOOM = 4;

/// A view kept inside what can be drawn.
export function clampView(view: SurfaceView): SurfaceView {
    const twoPi = Math.PI * 2;
    return {
        // Wrapped rather than clamped: turning the surface right round is a gesture a reader
        // makes on purpose, to see the far side of a ridge.
        yaw: ((view.yaw % twoPi) + twoPi) % twoPi,
        pitch: Math.min(MAX_PITCH, Math.max(MIN_PITCH, view.pitch)),
        zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.zoom)),
    };
}

/// The view a drag of this many pixels leaves behind.
export function dragView(view: SurfaceView, dx: number, dy: number): SurfaceView {
    return clampView({
        yaw: view.yaw + dx * DRAG_TO_RADIANS,
        // Dragging down tips the surface towards a top view, which is the direction the gesture
        // suggests: the far edge comes up to meet the pointer.
        pitch: view.pitch + dy * DRAG_TO_RADIANS,
        zoom: view.zoom,
    });
}

/// The view a zoom of this factor leaves behind. A wheel notch and a pinch both arrive here.
export function zoomView(view: SurfaceView, factor: number): SurfaceView {
    return clampView({ yaw: view.yaw, pitch: view.pitch, zoom: view.zoom * factor });
}

/// Where one point of the unit cube lands on screen.
///
/// `nx` and `ny` run -1..1 across the floor, `nz` runs 0..1 upward. Exported because the widget
/// draws the floor frame from the same projection the quads use, and two projections that drift
/// apart would put the frame under a surface that has moved.
export function project(
    nx: number, ny: number, nz: number, view: SurfaceView, box: SurfaceBox,
): { x: number; y: number; depth: number } {
    const cy = Math.cos(view.yaw);
    const sy = Math.sin(view.yaw);
    const rx = nx * cy - ny * sy;
    const ry = nx * sy + ny * cy;

    const cp = Math.cos(view.pitch);
    const sp = Math.sin(view.pitch);

    // The scale that fits the rotated floor at any yaw: the diagonal is what has to fit, not the
    // side, or the surface would grow and shrink as it turns.
    const span = Math.min(box.width, box.height) / 2;
    const unit = (span * view.zoom) / Math.SQRT2;

    return {
        x: box.width / 2 + rx * unit,
        // Screen y grows downward, so height subtracts.
        y: box.height / 2 + (ry * sp - nz * cp) * unit,
        // Larger is nearer the viewer.
        depth: ry * cp + nz * sp,
    };
}

/// Lay the surface out, or null when there is nothing to draw.
///
/// A quad needs all four of its corners, so a pair with no run leaves a hole rather than being
/// interpolated across - the same rule the flat map draws a gap by, for the same reason: an
/// absent result is not a result of zero.
export function surfaceLayout(input: SurfaceInput): SurfaceLayout | null {
    const buckets = foldCells(input.cells);
    if (buckets.length === 0) return null;

    const xValues = axisOrder(buckets.map(b => b.x));
    const yValues = axisOrder(buckets.map(b => b.y));
    if (xValues.length < 2 || yValues.length < 2) return null;

    const scale = heatScale(buckets);
    const at = new Map<string, HeatBucket>();
    for (const bucket of buckets) at.set(`${bucket.x} ${bucket.y}`, bucket);

    const box: SurfaceBox = { width: input.width, height: input.height };
    const view = clampView(input.view);

    // Every grid point, projected once. A corner is shared by up to four quads, and projecting it
    // per quad would cost four times as much and let rounding split one point into four.
    const corners: { x: number; y: number; depth: number; tint: number }[][] = [];
    const vertices: SurfaceVertex[] = [];
    for (let ix = 0; ix < xValues.length; ix++) {
        const column: { x: number; y: number; depth: number; tint: number }[] = [];
        for (let iy = 0; iy < yValues.length; iy++) {
            const bucket = at.get(`${xValues[ix]} ${yValues[iy]}`);
            const tint = bucket === undefined ? 0 : tintOf(bucket.value, scale, input.betterWhen);
            const nx = axisPosition(ix, xValues.length);
            const ny = axisPosition(iy, yValues.length);
            // Colour is signed around the scale's anchor and height is not: a run below the
            // anchor is one the flat map paints red, but on a surface it still stands on the
            // floor. So the elevation is the tint folded into 0..1, which puts the anchor half
            // way up and makes the floor mean something rather than being the worst run's shelf.
            const point = project(nx, ny, (tint + 1) / 2, view, box);
            column.push({ ...point, tint });
            // A pair nobody ran has no value to report, so it is not offered to the pointer.
            if (bucket !== undefined) {
                vertices.push({
                    at: [point.x, point.y],
                    x: xValues[ix],
                    y: yValues[iy],
                    value: bucket.value,
                    depth: point.depth,
                });
            }
        }
        corners.push(column);
    }

    const quads: SurfaceQuad[] = [];
    for (let ix = 0; ix + 1 < xValues.length; ix++) {
        for (let iy = 0; iy + 1 < yValues.length; iy++) {
            const near = at.get(`${xValues[ix]} ${yValues[iy]}`);
            const holes = [
                near,
                at.get(`${xValues[ix + 1]} ${yValues[iy]}`),
                at.get(`${xValues[ix + 1]} ${yValues[iy + 1]}`),
                at.get(`${xValues[ix]} ${yValues[iy + 1]}`),
            ];
            if (near === undefined || holes.some(b => b === undefined)) continue;

            const a = corners[ix][iy];
            const b = corners[ix + 1][iy];
            const c = corners[ix + 1][iy + 1];
            const d = corners[ix][iy + 1];

            quads.push({
                points: [[a.x, a.y], [b.x, b.y], [c.x, c.y], [d.x, d.y]],
                // The mean of the corners, so a face slopes in colour the way it slopes in height
                // rather than taking the tint of whichever corner happened to be first.
                tint: (a.tint + b.tint + c.tint + d.tint) / 4,
                depth: (a.depth + b.depth + c.depth + d.depth) / 4,
                bucket: near,
            });
        }
    }

    // Painter's algorithm: far first, so a near ridge covers what is behind it. Quads on a grid
    // never interpenetrate, so sorting by mean depth is exact here rather than an approximation.
    quads.sort((p, q) => p.depth - q.depth);

    const floor = (nx: number, ny: number) => {
        const p = project(nx, ny, 0, view, box);
        return [p.x, p.y] as [number, number];
    };

    // Which way is out. An edge's ticks are pushed away from the floor's middle, so they stay
    // outside the surface however far it has been turned - the direction is the turned edge's own
    // rather than a fixed screen offset that would swing onto the landscape at some angles.
    const outward = (from: [number, number], to: [number, number]): [number, number] => {
        const centre = floor(0, 0);
        const midX = (from[0] + to[0]) / 2;
        const midY = (from[1] + to[1]) / 2;
        const dx = midX - centre[0];
        const dy = midY - centre[1];
        const length = Math.hypot(dx, dy) || 1;
        return [dx / length, dy / length];
    };

    // A square floor has two edges per axis, and the surface stands between them. Labels go on
    // whichever is nearer the viewer: the far one is behind the landscape, where a number is drawn
    // over the mesh it is supposed to be measuring. Which is nearer changes as the view turns, so
    // it is decided per render rather than fixed.
    const depthAt = (nx: number, ny: number) => project(nx, ny, 0, view, box).depth;
    const xSide = depthAt(0, -1) >= depthAt(0, 1) ? -1 : 1;
    const ySide = depthAt(-1, 0) >= depthAt(1, 0) ? -1 : 1;

    const xEdge: [[number, number], [number, number]] = [floor(-1, xSide), floor(1, xSide)];
    const yEdge: [[number, number], [number, number]] = [floor(ySide, -1), floor(ySide, 1)];
    const xAway = outward(xEdge[0], xEdge[1]);
    const yAway = outward(yEdge[0], yEdge[1]);

    // The vertical edge rises from the corner OPPOSITE the two labelled ones. The corner they meet
    // at is the nearest point of the floor, and the landscape stands directly over it - an axis
    // there is drawn through the middle of the picture with its numbers over the mesh. The far
    // corner is behind the surface, where a scale belongs.
    const zBottom = project(-ySide, -xSide, 0, view, box);
    const zTop = project(-ySide, -xSide, 1, view, box);
    const zAway = outward([zBottom.x, zBottom.y], [zTop.x, zTop.y]);

    return {
        quads,
        vertices,
        axes: [
            {
                from: xEdge[0],
                to: xEdge[1],
                axis: 'x',
                ticks: axisTicks(xValues, i => floor(axisPosition(i, xValues.length), xSide), xAway),
            },
            {
                from: yEdge[0],
                to: yEdge[1],
                axis: 'y',
                ticks: axisTicks(yValues, i => floor(ySide, axisPosition(i, yValues.length)), yAway),
            },
            {
                from: [zBottom.x, zBottom.y],
                to: [zTop.x, zTop.y],
                axis: 'z',
                // Five marks up the height, which is what the colour scale runs over: the floor is
                // the worst run and the top the best. Worded by the caller, which knows the metric.
                ticks: heightTicks(view, box, zAway, -ySide, -xSide),
            },
        ],
        xValues,
        yValues,
        scale,
    };
}

/// The height a tick sits at, 0..1, for each mark on the vertical axis. Exported so a caller can
/// word them: the layout knows where they land, not what the metric is called.
export const SURFACE_HEIGHT_TICKS: readonly number[] = [0, 0.25, 0.5, 0.75, 1];

/// At most this many marks on a parameter axis. A sweep of forty settings would otherwise write
/// forty labels into the width of a chart and leave a smear.
const MAX_AXIS_TICKS = 8;

function axisTicks(
    values: readonly string[],
    at: (index: number) => [number, number],
    away: [number, number],
): SurfaceTick[] {
    if (values.length === 0) return [];

    // Every value while they fit, then every second, every third... so the first and the last are
    // always marked and the spacing stays even between them.
    const step = Math.max(1, Math.ceil(values.length / MAX_AXIS_TICKS));
    const ticks: SurfaceTick[] = [];
    for (let i = 0; i < values.length; i += step) ticks.push({ at: at(i), label: values[i], away });

    const last = values.length - 1;
    if (last > 0 && (last % step) !== 0)
        ticks.push({ at: at(last), label: values[last], away });
    return ticks;
}

function heightTicks(
    view: SurfaceView,
    box: SurfaceBox,
    away: [number, number],
    nx: number,
    ny: number,
): SurfaceTick[] {
    return SURFACE_HEIGHT_TICKS.map(height => {
        const point = project(nx, ny, height, view, box);
        // The height itself as the label, for a caller that does not replace it. A caller that
        // knows the metric words it as money or as a ratio.
        return { at: [point.x, point.y] as [number, number], label: String(height), away };
    });
}

/// The measured point nearest a screen position, or null when none is within `reach` pixels.
///
/// Ties break towards the viewer: two vertices over the same pixel are a near ridge in front of a
/// far one, and the near one is what a reader is pointing at.
export function nearestVertex(
    vertices: readonly SurfaceVertex[],
    x: number,
    y: number,
    reach: number,
): SurfaceVertex | null {
    let best: SurfaceVertex | null = null;
    let bestDistance = reach;

    for (const vertex of vertices) {
        const distance = Math.hypot(vertex.at[0] - x, vertex.at[1] - y);
        if (distance > bestDistance) continue;
        if (distance === bestDistance && best !== null && vertex.depth <= best.depth) continue;
        best = vertex;
        bestDistance = distance;
    }
    return best;
}

/// The distinct values of one axis, in the order the grid steps through them.
///
/// Numbers sort as numbers and everything else as text: a sweep of 5, 8, 12, 40 is a sequence,
/// and sorting it as text would put 12 before 5 and make the surface a lie about which way the
/// parameter runs.
function axisOrder(values: readonly string[]): string[] {
    const distinct = [...new Set(values)];
    const numeric = distinct.every(v => v.trim() !== '' && isFinite(Number(v)));
    return numeric
        ? distinct.sort((a, b) => Number(a) - Number(b))
        : distinct.sort((a, b) => a.localeCompare(b));
}

/// Where the nth of `count` steps sits across the floor, -1..1.
function axisPosition(index: number, count: number): number {
    return count < 2 ? 0 : (index / (count - 1)) * 2 - 1;
}
