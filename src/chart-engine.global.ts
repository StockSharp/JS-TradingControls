// The chart engine, off the global its own bundle publishes.
//
// Only the IIFE build uses this file: `build.mjs` points `./chart-engine.js` here, so the browser
// bundle carries no copy of @stocksharp/chart. A page that loads `sschart.js` and
// `sstradingcontrols.js` would otherwise hold two of them - a megabyte twice, and two registries
// of series definitions that do not recognise each other's, so a series added through one engine
// is invisible to the other.
//
// Everything an npm consumer sees goes through `chart-engine.ts` and imports the package
// properly; this exists because a script tag has no module resolution to do that with.
import type {
    TimedSeriesData,
    AreaData as EngineAreaData,
    CrosshairEvent as EngineCrosshairEvent,
    IChartApi as EngineChartApi,
    ISeriesApi as EngineSeriesApi,
    LineData as EngineLineData,
    SeriesOptions as EngineSeriesOptions,
    Time as EngineTime,
} from '@stocksharp/chart';

export type AreaData = EngineAreaData;
export type CrosshairEvent = EngineCrosshairEvent;
export type IChartApi = EngineChartApi;
export type ISeriesApi<T extends TimedSeriesData> = EngineSeriesApi<T>;
export type LineData = EngineLineData;
export type SeriesOptions = EngineSeriesOptions;
export type Time = EngineTime;

/// The global `@stocksharp/chart`'s own bundle assigns itself to.
interface ChartGlobal {
    createChart: typeof import('@stocksharp/chart').createChart;
    AreaSeries: typeof import('@stocksharp/chart').AreaSeries;
    LineSeries: typeof import('@stocksharp/chart').LineSeries;
    CrosshairMode: typeof import('@stocksharp/chart').CrosshairMode;
}

function engine(): ChartGlobal {
    const found = (globalThis as { SSChart?: ChartGlobal }).SSChart;
    if (found === undefined || found === null) {
        // Named plainly, because the fix is one script tag and a message that only says
        // "createChart is not a function" sends a reader into this package instead.
        throw new Error(
            'The chart panels need @stocksharp/chart. Load its bundle (sschart.js) before '
            + 'sstradingcontrols.js, or import this package from npm rather than as a script.');
    }
    return found;
}

// Read through on every call rather than captured at load: a script tag order that puts this
// bundle first would otherwise fail permanently instead of only until the engine arrives.
export const createChart: ChartGlobal['createChart'] = (container, options) => engine().createChart(container, options);

export const AreaSeries = new Proxy({} as ChartGlobal['AreaSeries'], {
    get: (_target, key) => (engine().AreaSeries as unknown as Record<string | symbol, unknown>)[key],
});

export const LineSeries = new Proxy({} as ChartGlobal['LineSeries'], {
    get: (_target, key) => (engine().LineSeries as unknown as Record<string | symbol, unknown>)[key],
});

export const CrosshairMode = new Proxy({} as ChartGlobal['CrosshairMode'], {
    get: (_target, key) => (engine().CrosshairMode as unknown as Record<string | symbol, unknown>)[key],
});
