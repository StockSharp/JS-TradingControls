// The chart engine, in one place.
//
// Two panels here are charts rather than drawings - an equity curve over time and a smile over
// strike - and @stocksharp/chart already does what a chart does: a crosshair that names the
// point under the pointer, a wheel that zooms about it, a drag that pans, tick labels that pick
// their own step. Re-implementing that was two engines and a poorer result, so it is a peer
// dependency now and the panels are built on it.
//
// Every import of it goes through this module, for one reason: the IIFE bundle must NOT inline
// the engine. A page that loads `sschart.js` and `sstradingcontrols.js` would otherwise hold two
// copies of it - a megabyte twice over, and two registries of series definitions that do not
// recognise each other's. `build.mjs` points this specifier at `chart-engine.global.ts` for that
// build, which reads the engine off the global the chart's own bundle publishes.
export {
    AreaSeries,
    CrosshairMode,
    LineSeries,
    createChart,
} from '@stocksharp/chart';

export type {
    AreaData,
    CrosshairEvent,
    IChartApi,
    ISeriesApi,
    LineData,
    SeriesOptions,
    Time,
} from '@stocksharp/chart';
