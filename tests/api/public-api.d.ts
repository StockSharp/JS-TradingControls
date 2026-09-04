// FILE: active-orders-widget.d.ts
import { TradingHost } from './trading-host.js';
import type { OrderRow } from './trading-data.js';
import { DataGrid, GridColumn } from '@stocksharp/grids/source/data-grid';
export declare const OrderStates: {
    readonly PendingRisk: 1;
    readonly Sent: 2;
    readonly Active: 3;
    readonly PartiallyFilled: 4;
    readonly Filled: 5;
    readonly Rejected: 6;
    readonly Cancelled: 7;
};
export interface ActiveOrdersActions {
    cancelOrder(orderId: number): void;
    dismissOrder(orderId: number): void;
    editOrderField(orderId: number, field: string): void;
    replaceOrder(orderId: number, quantity: number, limitPrice: number, stopPrice: number): void;
    cancelAllOrders(): void;
    refreshOrders(): void;
}
export type ActiveOrdersDeps = ({
    host: TradingHost;
    readOnly?: false;
} & ActiveOrdersActions) | {
    host: TradingHost;
    readOnly: true;
};
export declare class ActiveOrdersWidget {
    static TYPE: "activeOrders";
    rootEl: HTMLElement;
    el: HTMLElement | null;
    _host: TradingHost;
    _deps: ActiveOrdersDeps;
    _readOnly: boolean;
    _actions: ActiveOrdersActions | null;
    _closeBtn: HTMLElement | null;
    _cancelAllBtn: HTMLElement | null;
    _refreshBtn: HTMLElement | null;
    _exportBtn: HTMLElement | null;
    _orders: OrderRow[];
    _grid: DataGrid<OrderRow> | null;
    static create(hostEl: HTMLElement, state: Record<string, unknown>, deps: ActiveOrdersDeps): ActiveOrdersWidget;
    static _buildRoot(host: TradingHost, readOnly?: boolean): HTMLElement;
    constructor(rootEl: HTMLElement, _state: Record<string, unknown>, deps: ActiveOrdersDeps);
    dispose(): void;
    update(orders: OrderRow[]): void;
    _export(): void;
    applyDelta(order: OrderRow): void;
    removeOrder(orderId: number): void;
    getOrder(orderId: number): OrderRow | undefined;
    startInlineEdit(orderId: number, field: 'quantity' | 'limitPrice' | 'stopPrice'): void;
    _columns(): GridColumn<OrderRow>[];
    static _rowClass(order: OrderRow): string;
    static _canEdit(order: OrderRow, field: 'quantity' | 'limitPrice' | 'stopPrice'): boolean;
    static _editableClass(order: OrderRow, field: 'quantity' | 'limitPrice' | 'stopPrice'): string;
    _bindInlineEdit(td: HTMLTableCellElement, order: OrderRow, field: 'quantity' | 'limitPrice' | 'stopPrice'): void;
    _statusCell(order: OrderRow): string | Node;
    _actionButton(order: OrderRow): Node;
}

// FILE: black-scholes.d.ts
export declare const OptionTypes: {
    readonly Call: "call";
    readonly Put: "put";
};
export type OptionType = typeof OptionTypes[keyof typeof OptionTypes];
export interface OptionInputs {
    assetPrice: number;
    strike: number;
    timeToExpiry: number;
    riskFree: number;
    dividend: number;
    deviation: number;
}
export interface Greeks {
    delta: number;
    gamma: number;
    vega: number;
    theta: number;
    rho: number;
}
export declare function normalCdf(x: number): number;
export declare function normalPdf(x: number): number;
export declare function d1(inputs: OptionInputs): number;
export declare function d2(inputs: OptionInputs): number;
export declare function premium(type: OptionType, inputs: OptionInputs): number;
export declare function greeks(type: OptionType, inputs: OptionInputs): Greeks;
export declare function impliedVolatility(type: OptionType, inputs: OptionInputs, price: number): number | null;

// FILE: chart-engine.d.ts
export { AreaSeries, CrosshairMode, LineSeries, createChart, } from '@stocksharp/chart';
export type { AreaData, CrosshairEvent, IChartApi, ISeriesApi, LineData, SeriesOptions, Time, } from '@stocksharp/chart';

// FILE: control-types.d.ts
export declare const ControlTypes: {
    readonly Watchlist: "watchlist";
    readonly ActiveOrders: "activeOrders";
    readonly TradeHistory: "tradeHistory";
    readonly Positions: "positions";
    readonly OrderBook: "orderbook";
    readonly TradeFeed: "tradefeed";
    readonly OrderEntry: "orderEntry";
    readonly Statistics: "statistics";
    readonly LogMonitor: "logMonitor";
    readonly Strategies: "strategies";
    readonly OptionDesk: "optionDesk";
    readonly OptionSmile: "optionSmile";
    readonly Equity: "equity";
    readonly OptimizationHeatmap: "optimizationHeatmap";
    readonly OptimizationSurface: "optimizationSurface";
};
export type ControlType = typeof ControlTypes[keyof typeof ControlTypes];

// FILE: dom.d.ts
export declare function makeElement(tag: string, className: string, attrs: Record<string, string>, children: Array<Node | string>): HTMLElement;
export declare function makeIcon(iconClass: string): HTMLElement;
export declare function makeIconButton(className: string, label: string, iconClass: string, attrs: Record<string, string>): HTMLButtonElement;
export declare function makePanelRoot(modifierClass: string, label: string, children: Array<Node | string>): HTMLElement;
export declare function makePanelId(type: string): string;

// FILE: equity-widget.d.ts
import { TradingHost } from './trading-host.js';
import { type PnlPoint } from './pnl-curve.js';
import { type AreaData, type CrosshairEvent, type IChartApi, type ISeriesApi } from './chart-engine.js';
export interface EquityDeps {
    host: TradingHost;
}
export declare class EquityWidget {
    static TYPE: "equity";
    rootEl: HTMLElement;
    _host: TradingHost;
    _closeBtn: HTMLElement | null;
    _resetBtn: HTMLElement | null;
    _lastEl: HTMLElement | null;
    _hoverEl: HTMLElement | null;
    _emptyEl: HTMLElement | null;
    _chartEl: HTMLElement | null;
    _chart: IChartApi | null;
    _series: ISeriesApi<AreaData> | null;
    _points: PnlPoint[];
    _resizeObserver: ResizeObserver | null;
    static create(hostEl: HTMLElement, state: Record<string, unknown>, deps: EquityDeps): EquityWidget;
    static _buildRoot(host: TradingHost): HTMLElement;
    constructor(rootEl: HTMLElement, _state: Record<string, unknown>, deps: EquityDeps);
    dispose(): void;
    update(points: PnlPoint[]): void;
    resetZoom(): void;
    chart(): IChartApi | null;
    _ensureChart(): boolean;
    _render(): void;
    _fit(): void;
    _renderLast(value: number | null): void;
    _renderHover(param: CrosshairEvent): void;
}

// FILE: formatters.d.ts
type Numeric = number | string | null | undefined;
export declare function formatPrice(price: Numeric): string;
export declare function formatQty(qty: Numeric): string;
export declare function formatTime(dateStr: string | number | Date | null | undefined): string;
export declare function formatPnl(pnl: Numeric): string;
export declare function cleanRejectReason(reason: string | null | undefined): string;
export {};

// FILE: grid-menu.d.ts
import { TradingHost } from './trading-host.js';
import type { GridMenuOptions } from '@stocksharp/grids/source/data-grid';
export declare function makeGridMenu<TRow>(host: TradingHost): GridMenuOptions<TRow>;

// FILE: heatmap-grid.d.ts
export declare const HeatDirections: {
    readonly Higher: "higher";
    readonly Lower: "lower";
};
export type HeatDirection = typeof HeatDirections[keyof typeof HeatDirections];
export interface HeatCell {
    x: string;
    y: string;
    value: number;
}
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
export interface HeatScale {
    anchor: number;
    reach: number;
    min: number;
    max: number;
}
export interface HeatCellShape {
    bucket: HeatBucket;
    rect: HeatRect;
    tint: number;
    best: boolean;
}
export interface HeatGapShape {
    x: string;
    y: string;
    rect: HeatRect;
}
export interface HeatLabel {
    text: string;
    x: number;
    y: number;
}
export interface HeatMark {
    value: number;
    x: number;
    y: number;
}
export interface HeatLegendStep {
    rect: HeatRect;
    tint: number;
}
export interface HeatLegend {
    steps: HeatLegendStep[];
    low: HeatMark;
    anchor: HeatMark;
    high: HeatMark;
}
export interface HeatLayoutInput {
    width: number;
    height: number;
    cells: readonly HeatCell[];
    betterWhen: HeatDirection;
    xLabel: string;
    yLabel: string;
}
export interface HeatLayout {
    plot: HeatRect;
    columns: string[];
    rows: string[];
    cells: HeatCellShape[];
    gaps: HeatGapShape[];
    xTicks: HeatLabel[];
    yTicks: HeatLabel[];
    xTitle: HeatLabel;
    yTitle: HeatLabel;
    legend: HeatLegend;
    scale: HeatScale;
}
export declare function foldCells(cells: readonly HeatCell[]): HeatBucket[];
export declare function axisValues(values: readonly string[]): string[];
export declare function heatScale(buckets: readonly HeatBucket[]): HeatScale;
export declare function tintOf(value: number, scale: HeatScale, betterWhen: HeatDirection): number;
export declare function valueAt(tint: number, scale: HeatScale, betterWhen: HeatDirection): number;
export declare function layoutHeatmap(input: HeatLayoutInput): HeatLayout | null;
export declare function hitHeatmap(layout: HeatLayout, x: number, y: number): HeatCellShape | null;

// FILE: index.d.ts
export { MarketDataLevels, PRESENTATION_CLASSES, assertHost } from './trading-host.js';
export type { HostStore, MarketDataClient, MarketDataLevel, TickerSink, TradingApi, TradingContext, TradingControl, TradingHost, TradingPresentation, } from './trading-host.js';
export type { BalanceRow, InstrumentRow, OrderRow, OrderSide, OrderStatus, OrderType, PositionRow, QuoteStats, StatisticRow, TradeRow, } from './trading-data.js';
export { ControlTypes } from './control-types.js';
export type { ControlType } from './control-types.js';
export { cleanRejectReason, formatPnl, formatPrice, formatQty, formatTime } from './formatters.js';
export { makeElement, makeIcon, makeIconButton, makePanelId, makePanelRoot } from './dom.js';
export { ActiveOrdersWidget, OrderStates } from './active-orders-widget.js';
export type { ActiveOrdersDeps } from './active-orders-widget.js';
export { PositionsWidget } from './positions-widget.js';
export type { PositionsDeps } from './positions-widget.js';
export { TradeHistoryWidget } from './trade-history-widget.js';
export type { TradeHistoryDeps } from './trade-history-widget.js';
export { WatchlistWidget } from './watchlist-widget.js';
export type { WatchlistDeps } from './watchlist-widget.js';
export { OrderEntrySides, OrderEntryTypes, OrderEntryWidget } from './order-entry-widget.js';
export type { OrderEntryDeps, OrderEntrySide, OrderEntryType, OrderEntryValues } from './order-entry-widget.js';
export type { InstrumentSpec } from './trading-data.js';
export { OrderBookWidget } from './orderbook-widget.js';
export type { OrderBookDeps, OrderBookView } from './orderbook-widget.js';
export type { BookLevel, OrderBookFrame, QuoteLevel } from './trading-data.js';
export type { CanvasPalette } from './trading-host.js';
export { compressPnl, drawPnlCurve, pnlCurve } from './pnl-curve.js';
export { EquityWidget } from './equity-widget.js';
export type { EquityDeps } from './equity-widget.js';
export { AreaSeries, CrosshairMode, LineSeries, createChart } from './chart-engine.js';
export type { IChartApi, ISeriesApi } from './chart-engine.js';
export { OptimizationHeatmapWidget } from './optimization-heatmap-widget.js';
export type { OptimizationHeatmapDeps } from './optimization-heatmap-widget.js';
export { HeatDirections, heatScale, hitHeatmap, layoutHeatmap, tintOf, valueAt } from './heatmap-grid.js';
export { SurfaceWidget } from './surface-widget.js';
export type { SurfaceData, SurfaceDeps } from './surface-widget.js';
export { DEFAULT_VIEW, MAX_PITCH, MIN_PITCH, clampView, dragView, project, surfaceLayout, zoomView, } from './surface-grid.js';
export type { SurfaceAxis, SurfaceBox, SurfaceInput, SurfaceLayout, SurfaceQuad, SurfaceView } from './surface-grid.js';
export type { HeatBucket, HeatCell, HeatCellShape, HeatDirection, HeatGapShape, HeatLabel, HeatLayout, HeatLayoutInput, HeatLegend, HeatLegendStep, HeatMark, HeatRect, HeatScale, } from './heatmap-grid.js';
export type { PnlBox, PnlCurve, PnlCurveContext, PnlCurveStyle, PnlPoint } from './pnl-curve.js';
export { OptionDeskWidget, greekPlaces, greekScales, scaleChain, sideGreeks } from './option-desk-widget.js';
export { OptionSmileWidget } from './option-smile-widget.js';
export type { OptionSmileDeps } from './option-smile-widget.js';
export { sideVolatility, sortedChain, toSmileSeries } from './option-smile-widget.js';
export type { OptionChainContext, OptionDeskDeps, OptionSide, OptionStrike } from './option-desk-widget.js';
export { OptionTypes, d1, d2, greeks, impliedVolatility, normalCdf, normalPdf, premium } from './black-scholes.js';
export type { Greeks, OptionInputs, OptionType } from './black-scholes.js';
export { StrategiesWidget, StrategyStates } from './strategies-widget.js';
export type { StrategiesActions, StrategiesDeps, StrategyRow, StrategyState } from './strategies-widget.js';
export { LogMonitorWidget } from './log-monitor-widget.js';
export type { LogMonitorDeps } from './log-monitor-widget.js';
export { LogLevels, buildLogTree, keepLog, subtreeOf } from './log-tree.js';
export type { LogLevel, LogMessageRow, LogSourceNode, LogTreeNode, LogView } from './log-tree.js';
export { StatisticsWidget, formatStatistic } from './statistics-widget.js';
export type { StatisticsDeps } from './statistics-widget.js';
export { TradeFeedWidget } from './tradefeed-widget.js';
export type { TradeFeedDeps } from './tradefeed-widget.js';
export { aggregateBubbles } from './tradefeed-aggregator.js';
export type { FeedBubble, FeedTick } from './tradefeed-aggregator.js';
export { layoutBubbles } from './tradefeed-bubbles.js';
export type { BubbleAxisTick, BubbleLane, BubbleLaneShape, BubbleLayout, BubbleLayoutInput, BubbleShape } from './tradefeed-bubbles.js';
export { makeGridMenu } from './grid-menu.js';

// FILE: log-monitor-widget.d.ts
import { TradingHost } from './trading-host.js';
import { type LogMessageRow, type LogSourceNode, type LogTreeNode } from './log-tree.js';
import { DataGrid, GridColumn } from '@stocksharp/grids/source/data-grid';
export interface LogMonitorDeps {
    host: TradingHost;
    maxMessages?: number;
}
export declare class LogMonitorWidget {
    static TYPE: "logMonitor";
    rootEl: HTMLElement;
    el: HTMLElement | null;
    _host: TradingHost;
    _max: number;
    _closeBtn: HTMLElement | null;
    _clearBtn: HTMLElement | null;
    _exportBtn: HTMLElement | null;
    _treeEl: HTMLElement | null;
    _filterEl: HTMLInputElement | null;
    _sources: LogSourceNode[];
    _messages: LogMessageRow[];
    _levels: Set<string>;
    _text: string;
    _selected: string | null;
    _grid: DataGrid<LogMessageRow> | null;
    static create(hostEl: HTMLElement, state: Record<string, unknown>, deps: LogMonitorDeps): LogMonitorWidget;
    static _buildRoot(host: TradingHost): HTMLElement;
    constructor(rootEl: HTMLElement, _state: Record<string, unknown>, deps: LogMonitorDeps);
    dispose(): void;
    setSources(sources: LogSourceNode[]): void;
    append(messages: LogMessageRow[]): void;
    clear(): void;
    select(sourceId: string | null): void;
    visible(): LogMessageRow[];
    _render(): void;
    _renderTree(): void;
    _appendNode(into: HTMLElement, node: LogTreeNode): void;
    _treeRow(node: LogTreeNode, id: string | null): HTMLElement;
    _export(): void;
    _columns(): GridColumn<LogMessageRow>[];
    _sourceName(id: string): string;
}

// FILE: log-tree.d.ts
export declare const LogLevels: {
    readonly Error: "error";
    readonly Warning: "warning";
    readonly Info: "info";
    readonly Debug: "debug";
    readonly Verbose: "verbose";
};
export type LogLevel = typeof LogLevels[keyof typeof LogLevels];
export interface LogSourceNode {
    id: string;
    name: string;
    parentId?: string | null;
}
export interface LogTreeNode extends LogSourceNode {
    depth: number;
    children: LogTreeNode[];
}
export interface LogMessageRow {
    id: number | string;
    time: number | string;
    level: LogLevel | string;
    sourceId: string;
    source?: string;
    message: string;
}
export declare function buildLogTree(sources: readonly LogSourceNode[]): LogTreeNode[];
export declare function subtreeOf(sources: readonly LogSourceNode[], selectedId: string | null): Set<string> | null;
export interface LogView {
    levels: ReadonlySet<string>;
    text: string;
    sources: ReadonlySet<string> | null;
}
export declare function keepLog(message: LogMessageRow, view: LogView): boolean;

// FILE: optimization-heatmap-widget.d.ts
import { TradingHost } from './trading-host.js';
import type { HeatCell, HeatCellShape, HeatDirection, HeatLayout, HeatRect } from './heatmap-grid.js';
export interface HeatmapData {
    xLabel: string;
    yLabel: string;
    metricLabel: string;
    betterWhen: HeatDirection;
    cells: HeatCell[];
}
export interface OptimizationHeatmapDeps {
    host: TradingHost;
}
export declare class OptimizationHeatmapWidget {
    static TYPE: "optimizationHeatmap";
    rootEl: HTMLElement;
    canvasEl: HTMLCanvasElement | null;
    _host: TradingHost;
    _metricEl: HTMLElement | null;
    _emptyEl: HTMLElement | null;
    _tooltipEl: HTMLElement | null;
    _closeBtn: HTMLElement | null;
    _ctx: CanvasRenderingContext2D | null;
    _data: HeatmapData | null;
    _layout: HeatLayout | null;
    _size: {
        width: number;
        height: number;
    } | null;
    _resizeObserver: ResizeObserver | null;
    static create(hostEl: HTMLElement, state: Record<string, unknown>, deps: OptimizationHeatmapDeps): OptimizationHeatmapWidget;
    static _buildRoot(host: TradingHost): HTMLElement;
    constructor(rootEl: HTMLElement, _state: Record<string, unknown>, deps: OptimizationHeatmapDeps);
    dispose(): void;
    update(data: HeatmapData): void;
    _sizeCanvas(): void;
    _render(): void;
    _paintTint(ctx: CanvasRenderingContext2D, rect: HeatRect, tint: number, ground: string, up: string, down: string): void;
    static _outline(ctx: CanvasRenderingContext2D, rect: HeatRect, inset: number): void;
    _setEmpty(empty: boolean): void;
    _bindHover(): void;
    _showTooltip(shape: HeatCellShape, x: number, y: number): void;
    _tooltipLine(label: string, value: string): HTMLElement;
    _hideTooltip(): void;
}

// FILE: option-desk-widget.d.ts
import { TradingHost } from './trading-host.js';
import { type Greeks } from './black-scholes.js';
import { DataGrid, GridColumn } from '@stocksharp/grids/source/data-grid';
export interface OptionSide {
    symbol?: string;
    bid?: number | null;
    ask?: number | null;
    last?: number | null;
    theoretical?: number | null;
    volume?: number | null;
    openInterest?: number | null;
    ivBid?: number | null;
    ivAsk?: number | null;
    ivLast?: number | null;
    historicalVolatility?: number | null;
    greeks?: Greeks;
}
export interface OptionStrike {
    strike: number;
    call: OptionSide;
    put: OptionSide;
}
export interface OptionChainContext {
    assetPrice?: number | null;
    timeToExpiry?: number | null;
    riskFree?: number;
    dividend?: number;
}
export interface OptionDeskDeps {
    host: TradingHost;
}
interface DeskRow extends OptionStrike {
    maxCallVolume: number;
    maxPutVolume: number;
    maxCallOpenInterest: number;
    maxPutOpenInterest: number;
    maxVolatility: number;
    callIntrinsic: number;
    putIntrinsic: number;
}
export declare class OptionDeskWidget {
    static TYPE: "optionDesk";
    rootEl: HTMLElement;
    el: HTMLElement | null;
    _host: TradingHost;
    _closeBtn: HTMLElement | null;
    _exportBtn: HTMLElement | null;
    _rows: DeskRow[];
    _context: OptionChainContext;
    _places: Record<keyof Greeks, number>;
    _grid: DataGrid<DeskRow> | null;
    static create(hostEl: HTMLElement, state: Record<string, unknown>, deps: OptionDeskDeps): OptionDeskWidget;
    static _buildRoot(host: TradingHost): HTMLElement;
    constructor(rootEl: HTMLElement, _state: Record<string, unknown>, deps: OptionDeskDeps);
    dispose(): void;
    update(strikes: OptionStrike[], context?: OptionChainContext): void;
    rows(): readonly DeskRow[];
    _export(): void;
    _rowClass(row: DeskRow): string;
    _columns(): GridColumn<DeskRow>[];
    _bar(value: number | null | undefined, max: number, kind: 'call' | 'put' | 'iv', text: string): string | Node;
}
export declare function scaleChain(strikes: readonly OptionStrike[], context: OptionChainContext): DeskRow[];
export declare function sideGreeks(row: OptionStrike, which: 'call' | 'put', context: OptionChainContext): Greeks | null;
export declare function greekPlaces(values: readonly (number | null | undefined)[]): number;
export declare function greekScales(rows: readonly OptionStrike[], context: OptionChainContext): Record<keyof Greeks, number>;
export {};

// FILE: option-smile-widget.d.ts
import { TradingHost } from './trading-host.js';
import type { OptionChainContext, OptionSide, OptionStrike } from './option-desk-widget.js';
import { type CrosshairEvent, type IChartApi, type ISeriesApi, type LineData } from './chart-engine.js';
export interface OptionSmileDeps {
    host: TradingHost;
}
export declare function sideVolatility(side: OptionSide | undefined): number | null;
export declare function sortedChain(strikes: readonly OptionStrike[]): OptionStrike[];
export declare function toSmileSeries(chain: readonly OptionStrike[], put: boolean): LineData[];
export declare class OptionSmileWidget {
    static TYPE: "optionSmile";
    rootEl: HTMLElement;
    _host: TradingHost;
    _closeBtn: HTMLElement | null;
    _resetBtn: HTMLElement | null;
    _emptyEl: HTMLElement | null;
    _chartEl: HTMLElement | null;
    _spotEl: HTMLElement | null;
    _hoverEl: HTMLElement | null;
    _chart: IChartApi | null;
    _call: ISeriesApi<LineData> | null;
    _put: ISeriesApi<LineData> | null;
    _strikes: OptionStrike[];
    _context: OptionChainContext;
    _resizeObserver: ResizeObserver | null;
    static create(hostEl: HTMLElement, state: Record<string, unknown>, deps: OptionSmileDeps): OptionSmileWidget;
    static _buildRoot(host: TradingHost): HTMLElement;
    constructor(rootEl: HTMLElement, _state: Record<string, unknown>, deps: OptionSmileDeps);
    dispose(): void;
    update(strikes: OptionStrike[], context?: OptionChainContext): void;
    resetZoom(): void;
    chart(): IChartApi | null;
    _ensureChart(): boolean;
    _render(): void;
    _fit(): void;
    _renderSpot(): void;
    _renderHover(param: CrosshairEvent): void;
}

// FILE: order-entry-widget.d.ts
import { TradingHost } from './trading-host.js';
import type { InstrumentSpec } from './trading-data.js';
export declare const OrderEntrySides: {
    readonly Buy: "buy";
    readonly Sell: "sell";
};
export type OrderEntrySide = typeof OrderEntrySides[keyof typeof OrderEntrySides];
export declare const OrderEntryTypes: {
    readonly Market: "market";
    readonly Limit: "limit";
    readonly Stop: "stop";
    readonly StopLimit: "stoplimit";
};
export type OrderEntryType = typeof OrderEntryTypes[keyof typeof OrderEntryTypes];
export interface OrderEntryValues {
    type: OrderEntryType;
    quantity: number;
    limitPrice: number | null;
    stopPrice: number | null;
    takeProfit: number | null;
    stopLoss: number | null;
}
export interface OrderEntryDeps {
    host: TradingHost;
    submitOrder(side: OrderEntrySide, values: OrderEntryValues): void;
}
export declare class OrderEntryWidget {
    static TYPE: "orderEntry";
    static SIDES: readonly OrderEntrySide[];
    rootEl: HTMLElement;
    el: HTMLElement | null;
    _host: TradingHost;
    _deps: OrderEntryDeps;
    _closeBtn: HTMLElement | null;
    _cols: Record<OrderEntrySide, HTMLElement | null>;
    _orderType: OrderEntryType;
    _instrument: InstrumentSpec | null;
    _lastPrice: number;
    _bestBid: number;
    _bestAsk: number;
    _maxQuantity: Record<OrderEntrySide, number | null>;
    _focused: HTMLElement | null;
    _enabled: boolean;
    static create(hostEl: HTMLElement, state: Record<string, unknown>, deps: OrderEntryDeps): OrderEntryWidget;
    static _buildRoot(host: TradingHost): HTMLElement;
    static _buildTypeTabs(host: TradingHost): HTMLElement;
    static _buildColumn(host: TradingHost, side: OrderEntrySide): HTMLElement;
    constructor(rootEl: HTMLElement, _state: Record<string, unknown>, deps: OrderEntryDeps);
    dispose(): void;
    get orderType(): OrderEntryType;
    getInstrument(): InstrumentSpec | null;
    setOrderType(type: OrderEntryType): void;
    setInstrument(instrument: InstrumentSpec | null): void;
    setAvailable(side: OrderEntrySide, available: number | null): void;
    setMaxQuantity(side: OrderEntrySide, max: number | null): void;
    setLimitPrice(price: number): void;
    seedLimitPrice(price: number): void;
    setBbo(bid: number, ask: number): void;
    applyBbo(side: OrderEntrySide): void;
    setPrice(side: OrderEntrySide, price: number): void;
    setQuantity(quantity: number): void;
    applyPercent(side: OrderEntrySide, pct: number): void;
    toggleTpSl(side: OrderEntrySide, on: boolean): void;
    preselect(side: OrderEntrySide | null): void;
    setEnabled(enabled: boolean): void;
    submit(side: OrderEntrySide): void;
    getValues(side: OrderEntrySide): OrderEntryValues;
    validate(side: OrderEntrySide): string | null;
    static toApiType(uiType: OrderEntryType | string): number;
    static _isMultipleOf(value: number, step: number): boolean;
    static _formatQty(n: number): string;
    static _decimals(n: number): number;
    _bindTypeTabs(): void;
    _bindColumn(side: OrderEntrySide): void;
    _applyTypeVisibility(): void;
    _show(element: HTMLElement | null, visible: boolean): void;
    _writePrices(buyPrice: number, sellPrice: number, reset: boolean): void;
    _writePrice(side: OrderEntrySide, price: number, reset: boolean): void;
    _formatPriceForInput(price: number): string;
    _recalculate(side: OrderEntrySide): void;
    _updateEstimate(side: OrderEntrySide): void;
    _validateSide(side: OrderEntrySide): void;
    _input(side: OrderEntrySide, selector: string): HTMLInputElement | null;
    _number(side: OrderEntrySide, selector: string): number | null;
}

// FILE: orderbook-depth.d.ts
import type { BookLevel } from './trading-data.js';
export interface DepthGeometry {
    midX: number;
    pad: number;
    halfWidth: number;
    baseY: number;
    innerHeight: number;
}
export interface DepthPoint {
    x: number;
    cumulative: number;
}
export interface DepthSide {
    points: DepthPoint[];
    total: number;
}
export declare function depthSide(levels: BookLevel[], direction: 1 | -1, geometry: DepthGeometry): DepthSide | null;
export declare function depthPolyline(side: DepthSide, maxTotal: number, geometry: DepthGeometry): [number, number][];

// FILE: orderbook-widget.d.ts
import { TradingHost } from './trading-host.js';
import type { BookLevel, OrderBookFrame, QuoteLevel } from './trading-data.js';
import { type DepthGeometry } from './orderbook-depth.js';
export interface OrderBookDeps {
    host: TradingHost;
    onPriceSelected(price: number, side: number): void;
    onPriceExecuted(price: number, side: number): void;
    maxDepth(): number;
    pixelRatio(): number;
}
export type OrderBookView = 'diagonal' | 'stacked';
export declare class OrderBookWidget {
    static TYPE: "orderbook";
    static DEPTHS: readonly number[];
    static DEPTH_KEY: string;
    static VIEW_KEY: string;
    static INVERT_KEY: string;
    static DEPTHCHART_KEY: string;
    rootEl: HTMLElement;
    asksEl: HTMLElement | null;
    bidsEl: HTMLElement | null;
    midEl: HTMLElement | null;
    spreadEl: HTMLElement | null;
    contentEl: HTMLElement | null;
    depthChartEl: HTMLCanvasElement | null;
    _host: TradingHost;
    _deps: OrderBookDeps;
    _midSpreadEl: HTMLElement | null;
    _sentimentEl: HTMLElement | null;
    _sentBidPctEl: HTMLElement | null;
    _sentAskPctEl: HTMLElement | null;
    _symbolLabel: HTMLElement | null;
    _depthBtns: HTMLElement[];
    _viewBtns: HTMLElement[];
    _invertBtn: HTMLElement | null;
    _depthToggleBtn: HTMLElement | null;
    _addBtn: HTMLElement | null;
    _closeBtn: HTMLElement | null;
    _prevQuantities: Map<string, number>;
    _depth: number;
    _view: OrderBookView;
    _invertSides: boolean;
    _showDepthChart: boolean;
    _bidsByPrice: Map<number, number>;
    _asksByPrice: Map<number, number>;
    _lastSequence: number;
    _currentSymbol: string | null;
    _followsActive: boolean;
    static create(hostEl: HTMLElement, state: Record<string, unknown>, deps: OrderBookDeps): OrderBookWidget;
    static _buildRoot(host: TradingHost): HTMLElement;
    constructor(rootEl: HTMLElement, state: Record<string, unknown>, deps: OrderBookDeps);
    dispose(): void;
    setSymbol(symbol: string): void;
    getSymbol(): string | null;
    getDepth(): number;
    isFollowsActive(): boolean;
    getBids(): BookLevel[];
    getAsks(): BookLevel[];
    setDepth(depth: number): void;
    setView(view: OrderBookView): void;
    setInvertSides(invert: boolean): void;
    setShowDepthChart(show: boolean): void;
    applyFrame(frame: OrderBookFrame): void;
    _wireHeader(): void;
    _wireBookClicks(): void;
    _refreshDepthButtons(): void;
    _refreshViewButtons(): void;
    _refreshInvertButton(): void;
    _refreshDepthToggleButton(): void;
    _applyViewState(): void;
    _persistState(patch: Record<string, unknown>): void;
    _resetLedger(): void;
    _fitDepth(depth: number): number;
    static _isDepth(depth: unknown): depth is number;
    static _deepest(): number;
    static _sorted(ledger: Map<number, number>, direction: 1 | -1): BookLevel[];
    _applySnapshotSide(ledger: Map<number, number>, levels: QuoteLevel[] | undefined, side: string, symbol: string, sequence: number): void;
    _applyDiffSide(ledger: Map<number, number>, levels: QuoteLevel[] | undefined, side: string, symbol: string, sequence: number): void;
    _validateBookCross(symbol: string, sequence: number, wasSnapshot: boolean): void;
    _requestResubscribe(symbol: string): Promise<void>;
    _anomaly(message: string): void;
    _render(): void;
    _paint(bids: BookLevel[], asks: BookLevel[]): void;
    _levelRow(level: BookLevel, options: {
        rowClass: string;
        orderSide: string;
        key: string;
        cumulative: number;
        barPct: number;
        heatPct: number;
        growthClass: string;
        shrinkClass: string;
        ownQuantity: number | undefined;
        painted: Map<string, number>;
    }): HTMLElement;
    _ownQuantities(): {
        bids: Map<string, number>;
        asks: Map<string, number>;
    };
    static _priceKey(price: number): string;
    _paintSentiment(bids: BookLevel[], asks: BookLevel[]): void;
    _paintDepthChart(bids: BookLevel[], asks: BookLevel[]): void;
    _strokeDepthSide(ctx: CanvasRenderingContext2D, line: [number, number][], color: string, geometry: DepthGeometry, ratio: number): void;
}

// FILE: pnl-curve.d.ts
export interface PnlPoint {
    time: number;
    value: number;
}
export interface PnlBox {
    width: number;
    height: number;
    padX: number;
    padY: number;
}
export interface PnlCurve {
    points: [number, number][];
    area: [number, number][];
    zeroY: number;
    min: number;
    max: number;
    from: number;
    to: number;
    last: number;
    positive: boolean;
}
export declare function compressPnl(points: readonly PnlPoint[], count: number): PnlPoint[];
export declare function pnlCurve(points: readonly PnlPoint[], box: PnlBox): PnlCurve | null;
export interface PnlCurveStyle {
    up: string;
    down: string;
    baseline: string;
    lineWidth: number;
    fillOpacity: number;
}
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
    strokeStyle: string | CanvasGradient | CanvasPattern;
    fillStyle: string | CanvasGradient | CanvasPattern;
    lineWidth: number;
}
export declare function drawPnlCurve(ctx: PnlCurveContext, curve: PnlCurve, box: PnlBox, style: PnlCurveStyle): void;

// FILE: positions-widget.d.ts
import { TradingHost } from './trading-host.js';
import type { BalanceRow, PositionRow } from './trading-data.js';
import { DataGrid, GridColumn, GridPinnedRow } from '@stocksharp/grids/source/data-grid';
export interface PositionsDeps {
    host: TradingHost;
    closePosition(portfolioId: number, instrumentId: number, symbol: string): void;
    reversePosition(portfolioId: number, instrumentId: number, symbol: string): void;
    refreshPositions(): void;
}
export declare class PositionsWidget {
    static TYPE: "positions";
    rootEl: HTMLElement;
    el: HTMLElement | null;
    _host: TradingHost;
    _deps: PositionsDeps;
    _closeBtn: HTMLElement | null;
    _refreshBtn: HTMLElement | null;
    _exportBtn: HTMLElement | null;
    _positions: PositionRow[];
    _balance: BalanceRow | null;
    _grid: DataGrid<PositionRow> | null;
    static create(hostEl: HTMLElement, state: Record<string, unknown>, deps: PositionsDeps): PositionsWidget;
    static _buildRoot(host: TradingHost): HTMLElement;
    constructor(rootEl: HTMLElement, _state: Record<string, unknown>, deps: PositionsDeps);
    dispose(): void;
    update(positions: PositionRow[]): void;
    updateBalance(balance: BalanceRow | null): void;
    applyDelta(position: PositionRow): void;
    _export(): void;
    _columns(): GridColumn<PositionRow>[];
    _pinnedRows(): GridPinnedRow[];
    static _totalPnl(position: PositionRow): number;
    static _key(position: PositionRow): string;
    _actionButtons(position: PositionRow): Node;
    _actionButton(styleClass: string, iconClass: string, title: string, label: string, onClick: () => void): HTMLButtonElement;
}

// FILE: statistics-widget.d.ts
import { TradingHost } from './trading-host.js';
import type { StatisticRow } from './trading-data.js';
import { DataGrid, GridColumn } from '@stocksharp/grids/source/data-grid';
export interface StatisticsDeps {
    host: TradingHost;
}
interface RankedRow extends StatisticRow {
    categoryRank: number;
}
export declare class StatisticsWidget {
    static TYPE: "statistics";
    rootEl: HTMLElement;
    el: HTMLElement | null;
    _host: TradingHost;
    _closeBtn: HTMLElement | null;
    _exportBtn: HTMLElement | null;
    _rows: RankedRow[];
    _grid: DataGrid<RankedRow> | null;
    static create(hostEl: HTMLElement, state: Record<string, unknown>, deps: StatisticsDeps): StatisticsWidget;
    static _buildRoot(host: TradingHost): HTMLElement;
    constructor(rootEl: HTMLElement, _state: Record<string, unknown>, deps: StatisticsDeps);
    dispose(): void;
    update(rows: StatisticRow[]): void;
    _export(): void;
    _columns(): GridColumn<RankedRow>[];
}
export declare function formatStatistic(value: unknown): string;
export {};

// FILE: strategies-widget.d.ts
import { TradingHost } from './trading-host.js';
import { type PnlPoint } from './pnl-curve.js';
import { DataGrid, GridColumn } from '@stocksharp/grids/source/data-grid';
export declare const StrategyStates: {
    readonly Stopped: "stopped";
    readonly Starting: "starting";
    readonly Started: "started";
    readonly Stopping: "stopping";
};
export type StrategyState = typeof StrategyStates[keyof typeof StrategyStates];
export interface StrategyRow {
    id: string;
    name: string;
    state: StrategyState | string;
    online?: boolean;
    tradingMode?: string;
    portfolio?: string;
    security?: string;
    position?: number | null;
    ordersCount?: number | null;
    tradesCount?: number | null;
    pnlChange?: number | null;
    realized?: number | null;
    unrealized?: number | null;
    pnl?: PnlPoint[];
    error?: string;
}
export interface StrategiesActions {
    start?(id: string): void;
    stop?(id: string): void;
    closePosition?(id: string): void;
    openStrategy?(id: string): void;
    riskRules?(id: string): void;
    setTradingMode?(id: string, mode: string): void;
}
export interface StrategiesDeps extends StrategiesActions {
    host: TradingHost;
    tradingModes?: readonly string[];
}
export declare class StrategiesWidget {
    static TYPE: "strategies";
    rootEl: HTMLElement;
    el: HTMLElement | null;
    _host: TradingHost;
    _deps: StrategiesDeps;
    _closeBtn: HTMLElement | null;
    _exportBtn: HTMLElement | null;
    _rows: StrategyRow[];
    _grid: DataGrid<StrategyRow> | null;
    static create(hostEl: HTMLElement, state: Record<string, unknown>, deps: StrategiesDeps): StrategiesWidget;
    static _buildRoot(host: TradingHost): HTMLElement;
    constructor(rootEl: HTMLElement, _state: Record<string, unknown>, deps: StrategiesDeps);
    dispose(): void;
    update(rows: StrategyRow[]): void;
    _export(): void;
    _columns(): GridColumn<StrategyRow>[];
    _stateCell(row: StrategyRow): string | Node;
    _actionCell(row: StrategyRow): Node;
    _positionCell(row: StrategyRow): string | Node;
    _tradingCell(row: StrategyRow): string | Node;
    _sparkline(row: StrategyRow): string | Node;
}

// FILE: surface-grid.d.ts
import { type HeatBucket, type HeatCell, type HeatDirection, type HeatScale } from './heatmap-grid.js';
export interface SurfaceView {
    yaw: number;
    pitch: number;
    zoom: number;
}
export interface SurfaceBox {
    width: number;
    height: number;
}
export interface SurfaceQuad {
    points: [number, number][];
    tint: number;
    depth: number;
    bucket: HeatBucket;
}
export interface SurfaceAxis {
    from: [number, number];
    to: [number, number];
    axis: 'x' | 'y' | 'z';
    ticks: SurfaceTick[];
}
export interface SurfaceTick {
    at: [number, number];
    label: string;
    away: [number, number];
}
export interface SurfaceVertex {
    at: [number, number];
    x: string;
    y: string;
    value: number;
    depth: number;
}
export interface SurfaceLayout {
    quads: SurfaceQuad[];
    axes: SurfaceAxis[];
    vertices: SurfaceVertex[];
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
export declare const MIN_PITCH = 0.12;
export declare const MAX_PITCH = 1.45;
export declare const DEFAULT_VIEW: SurfaceView;
export declare function clampView(view: SurfaceView): SurfaceView;
export declare function dragView(view: SurfaceView, dx: number, dy: number): SurfaceView;
export declare function zoomView(view: SurfaceView, factor: number): SurfaceView;
export declare function project(nx: number, ny: number, nz: number, view: SurfaceView, box: SurfaceBox): {
    x: number;
    y: number;
    depth: number;
};
export declare function surfaceLayout(input: SurfaceInput): SurfaceLayout | null;
export declare const SURFACE_HEIGHT_TICKS: readonly number[];
export declare function nearestVertex(vertices: readonly SurfaceVertex[], x: number, y: number, reach: number): SurfaceVertex | null;

// FILE: surface-widget.d.ts
import { TradingHost } from './trading-host.js';
import { type HeatCell, type HeatDirection } from './heatmap-grid.js';
import { type SurfaceLayout, type SurfaceVertex, type SurfaceView } from './surface-grid.js';
export interface SurfaceData {
    xLabel: string;
    yLabel: string;
    metricLabel: string;
    betterWhen: HeatDirection;
    cells: HeatCell[];
}
export interface SurfaceDeps {
    host: TradingHost;
}
export declare function wheelNotches(deltaY: number, deltaMode: number): number;
export declare class SurfaceWidget {
    static TYPE: "optimizationSurface";
    rootEl: HTMLElement;
    canvasEl: HTMLCanvasElement | null;
    _host: TradingHost;
    _closeBtn: HTMLElement | null;
    _resetBtn: HTMLElement | null;
    _emptyEl: HTMLElement | null;
    _ctx: CanvasRenderingContext2D | null;
    _data: SurfaceData | null;
    _view: SurfaceView;
    _resizeObserver: ResizeObserver | null;
    _pointers: Map<number, {
        x: number;
        y: number;
    }>;
    _pinch: number;
    _layout: SurfaceLayout | null;
    _hover: SurfaceVertex | null;
    _hoverEl: HTMLElement | null;
    static create(hostEl: HTMLElement, state: Record<string, unknown>, deps: SurfaceDeps): SurfaceWidget;
    static _buildRoot(host: TradingHost): HTMLElement;
    constructor(rootEl: HTMLElement, _state: Record<string, unknown>, deps: SurfaceDeps);
    dispose(): void;
    update(data: SurfaceData): void;
    view(): SurfaceView;
    resetView(): void;
    _bindGestures(): void;
    _setHover(x: number | null, y: number | null): void;
    _renderHover(): void;
    _pointerSpread(): number;
    _render(): void;
    _drawAxes(ctx: CanvasRenderingContext2D, layout: SurfaceLayout, palette: {
        grid: string;
        font: string;
    }): void;
    _tickLabel(axis: 'x' | 'y' | 'z', label: string, layout: SurfaceLayout): string;
    _axisCaption(axis: 'x' | 'y' | 'z'): string;
    _drawHover(ctx: CanvasRenderingContext2D, palette: {
        up: string;
        grid: string;
    }): void;
    _drawFloor(ctx: CanvasRenderingContext2D, layout: SurfaceLayout, colour: string): void;
    _drawFaces(ctx: CanvasRenderingContext2D, layout: SurfaceLayout, palette: {
        up: string;
        down: string;
        grid: string;
    }): void;
}

// FILE: trade-history-widget.d.ts
import { TradingHost } from './trading-host.js';
import type { TradeRow } from './trading-data.js';
import { DataGrid, GridColumn } from '@stocksharp/grids/source/data-grid';
export interface TradeHistoryDeps {
    host: TradingHost;
    readOnly?: boolean;
}
export declare class TradeHistoryWidget {
    static TYPE: "tradeHistory";
    rootEl: HTMLElement;
    bodyEl: HTMLElement | null;
    _host: TradingHost;
    _closeBtn: HTMLElement | null;
    _refreshBtn: HTMLElement | null;
    _exportBtn: HTMLElement | null;
    _rows: TradeRow[];
    _grid: DataGrid<TradeRow> | null;
    static create(hostEl: HTMLElement, state: Record<string, unknown>, deps: TradeHistoryDeps): TradeHistoryWidget;
    static _buildRoot(host: TradingHost, readOnly?: boolean): HTMLElement;
    constructor(rootEl: HTMLElement, _state: Record<string, unknown>, deps: TradeHistoryDeps);
    dispose(): void;
    refresh(): Promise<void>;
    update(rows: TradeRow[]): void;
    _export(): void;
    _columns(): GridColumn<TradeRow>[];
}

// FILE: tradefeed-aggregator.d.ts
import type { OrderSide } from './trading-data.js';
export interface FeedTick {
    symbol: string;
    side: OrderSide;
    buy: boolean;
    price: number;
    quantity: number;
    time: string;
    index: number;
}
export interface FeedBubble extends FeedTick {
    count: number;
}
export declare function aggregateBubbles(ticks: FeedTick[], maxBucketsPerSide: number): FeedBubble[];

// FILE: tradefeed-bubbles.d.ts
import { type FeedBubble, type FeedTick } from './tradefeed-aggregator.js';
export interface BubbleLane {
    symbol: string;
    ticks: FeedTick[];
}
export interface BubbleLayoutInput {
    width: number;
    height: number;
    lanes: BubbleLane[];
    total: number;
}
export interface BubbleShape {
    x: number;
    y: number;
    radius: number;
    bubble: FeedBubble;
}
export interface BubbleAxisTick {
    text: string;
    y: number;
}
export interface BubbleLaneShape {
    symbol: string;
    label: {
        x: number;
        y: number;
    } | null;
    separatorY: number | null;
    ticks: BubbleAxisTick[];
}
export interface BubbleLayout {
    axisX: number;
    labelX: number;
    lanes: BubbleLaneShape[];
    bubbles: BubbleShape[];
}
export declare function layoutBubbles(input: BubbleLayoutInput): BubbleLayout;
export declare function priceFormatter(min: number, max: number): (price: number) => string;

// FILE: tradefeed-widget.d.ts
import { TradingHost } from './trading-host.js';
import type { TradeRow } from './trading-data.js';
import type { FeedBubble, FeedTick } from './tradefeed-aggregator.js';
import { type BubbleLane, type BubbleShape } from './tradefeed-bubbles.js';
import { DataGrid, GridColumn } from '@stocksharp/grids/source/data-grid';
export interface TradeFeedDeps {
    host: TradingHost;
}
export declare class TradeFeedWidget {
    static TYPE: "tradefeed";
    static VIEW_KEY: string;
    static MAX_ROWS: number;
    static MAX_BUBBLES: number;
    rootEl: HTMLElement;
    extrasEl: HTMLElement | null;
    bubbleCanvas: HTMLCanvasElement | null;
    trades: TradeRow[];
    bubbleTrades: TradeRow[];
    myTrades: TradeRow[];
    avgQty: number;
    tab: string;
    view: string;
    _host: TradingHost;
    _marketGrid: DataGrid<TradeRow> | null;
    _myGrid: DataGrid<TradeRow> | null;
    _seq: number;
    _tabsEl: HTMLElement | null;
    _viewToggleEl: HTMLElement | null;
    _tooltipEl: HTMLElement | null;
    _addBtn: HTMLElement | null;
    _closeBtn: HTMLElement | null;
    _addSymbolBtn: HTMLElement | null;
    _bubbleCtx: CanvasRenderingContext2D | null;
    _bubbleHits: BubbleShape[];
    _canvasSize: {
        width: number;
        height: number;
    } | null;
    _resizeObserver: ResizeObserver | null;
    _activeSymbol: string | null;
    _extraSymbols: Set<string>;
    static create(hostEl: HTMLElement, state: Record<string, unknown>, deps: TradeFeedDeps): TradeFeedWidget;
    static _buildRoot(host: TradingHost): HTMLElement;
    constructor(rootEl: HTMLElement, state: Record<string, unknown>, deps: TradeFeedDeps);
    dispose(): void;
    setActiveSymbol(symbol: string | null): void;
    setTrades(trades: TradeRow[]): void;
    addTrade(trade: TradeRow): void;
    loadMyTrades(portfolioId: number | null, symbol: string | null): Promise<void>;
    _makeGrid(containerSelector: string): DataGrid<TradeRow> | null;
    _stamp(trade: TradeRow): TradeRow;
    static _key(trade: TradeRow): string;
    _rowClass(trade: TradeRow): string;
    _columns(): GridColumn<TradeRow>[];
    _syncSymbolColumn(): void;
    addExtraSymbol(symbol: string): Promise<void>;
    removeExtraSymbol(symbol: string): Promise<void>;
    getExtraSymbols(): string[];
    _persistExtras(): void;
    _watches(symbol: string | undefined): boolean;
    _renderMy(): void;
    _renderExtras(): void;
    _bindTabs(): void;
    _selectTab(tab: string): void;
    _bindViewToggle(): void;
    _applyView(): void;
    _sizeCanvas(): void;
    _feedTicks(): FeedTick[];
    _lanes(ticks: FeedTick[]): BubbleLane[];
    _renderBubbles(): void;
    static _rule(ctx: CanvasRenderingContext2D, from: number, to: number, y: number): void;
    _bindBubbleHover(): void;
    _hitTest(x: number, y: number): BubbleShape | null;
    _showTooltip(bubble: FeedBubble, x: number, y: number): void;
    _tooltipLine(label: string, value: string, valueClass: string): HTMLElement;
    _hideTooltip(): void;
}

// FILE: trading-data.d.ts
export type OrderSide = number | string;
export type OrderType = number | string;
export type OrderStatus = number | string;
export interface PositionRow {
    portfolioId?: number | null;
    instrumentId?: number | null;
    instrument?: string;
    quantity?: number | null;
    avgPrice?: number | null;
    currentPrice?: number | null;
    unrealizedPnl?: number | null;
    realizedPnl?: number | null;
}
export interface BalanceRow {
    available?: number | null;
    locked?: number | null;
    total?: number | null;
}
export interface OrderRow {
    id?: number | null;
    localId?: number | null;
    instrument?: string;
    side?: OrderSide;
    type?: OrderType;
    quantity?: number | null;
    balance?: number | null;
    limitPrice?: number | null;
    stopPrice?: number | null;
    status?: OrderStatus;
    rejectReason?: string;
}
export interface TradeRow {
    id?: number | null;
    executedAt?: string;
    time?: string;
    instrumentSymbol?: string;
    symbol?: string;
    side?: OrderSide;
    quantity?: number | null;
    price?: number | null;
    order?: number | null;
    orderId?: number | null;
}
export interface StatisticRow {
    key: string;
    category: string;
    categoryText?: string;
    order: number;
    name: string;
    description?: string;
    value?: number | string | Date | null;
}
export interface InstrumentRow {
    symbol?: string;
    name?: string;
    exchange?: string;
    category?: string;
}
export interface QuoteLevel {
    price?: number | null;
    quantity?: number | null;
}
export interface OrderBookFrame {
    symbol?: string;
    sequence?: number | null;
    isSnapshot?: boolean;
    bids?: QuoteLevel[];
    asks?: QuoteLevel[];
}
export interface BookLevel {
    price: number;
    quantity: number;
}
export interface InstrumentSpec {
    symbol?: string;
    lotSize?: number | null;
    tickSize?: number | null;
    minVolume?: number | null;
    maxVolume?: number | null;
}
export interface QuoteStats {
    lastPrice?: number | null;
    baseline?: number | null;
    chgPct?: number | null;
}

// FILE: trading-host.d.ts
import type { InstrumentRow, OrderRow, OrderSide, OrderStatus, OrderType, QuoteStats, TradeRow } from './trading-data.js';
export interface CanvasPalette {
    up: string;
    down: string;
    grid: string;
    font: string;
}
export interface TradingPresentation {
    sideText(side: OrderSide): string;
    isBuy(side: OrderSide): boolean;
    typeText(type: OrderType, limitPrice: number, stopPrice: number): string;
    statusText(status: OrderStatus): string;
    timeText(value: string | number | Date): string;
    sideClass(side: OrderSide): string;
    pnlClass(pnl: number): string;
    canvasPalette(): CanvasPalette;
}
export declare const PRESENTATION_CLASSES: {
    readonly sideClass: readonly ["side-buy", "side-sell"];
    readonly pnlClass: readonly ["pnl-positive", "pnl-negative"];
};
export interface HostStore {
    get(key: string, fallback: string | null): string | null;
    set(key: string, value: string | null): void;
}
export interface TradingApi {
    getExecutions(portfolioId: number, symbol: string | null, limit: number): Promise<TradeRow[]>;
    searchInstruments(query: string): Promise<InstrumentRow[]>;
}
export declare const MarketDataLevels: {
    readonly Quotes: "l1only";
    readonly Tape: "tape";
    readonly Full: "full";
};
export type MarketDataLevel = typeof MarketDataLevels[keyof typeof MarketDataLevels];
export interface MarketDataClient {
    addSymbol(symbol: string, level: MarketDataLevel): Promise<unknown>;
    removeSymbol(symbol: string): Promise<unknown>;
    resubscribe(symbol: string, level: MarketDataLevel): Promise<void>;
    getOrders(): OrderRow[];
}
export interface TradingContext {
    readonly api: TradingApi;
    readonly marketData: MarketDataClient;
    portfolioId(): number | null;
    pickInstrument(onPicked: (symbol: string) => void): void;
}
export interface TickerSink {
    publish(symbols: string[], stats: Map<string, QuoteStats>): void;
}
export type TradingControl = object;
export interface TradingHost {
    readonly isPrimary: boolean;
    t(key: string, ...args: unknown[]): string;
    readonly presentation: TradingPresentation;
    readonly preferences: HostStore;
    readonly cache: HostStore;
    readonly trading: TradingContext;
    readonly ticker: TickerSink;
    allow(action: string): boolean;
    log(message: string): void;
    close(): void;
    spawn(state: Record<string, unknown>): void;
    persistState(patch: Record<string, unknown>): void;
    saveLayout(): void;
    register(control: TradingControl): void;
    unregister(control: TradingControl): void;
    broadcast<T>(apply: (control: T) => void): void;
}
export declare function assertHost(host: TradingHost, controlName: string): TradingHost;

// FILE: watchlist-widget.d.ts
import { MarketDataClient, TradingApi, TradingHost } from './trading-host.js';
import type { InstrumentRow, QuoteStats } from './trading-data.js';
import { DataGrid, GridColumn } from '@stocksharp/grids/source/data-grid';
export interface WatchlistDeps {
    host: TradingHost;
    onSelect(symbol: string): void;
}
export declare class WatchlistWidget {
    static FAVORITES_KEY: string;
    static BASELINE_KEY_PREFIX: string;
    static VISIBLE_CAP: number;
    static RENDER_CAP: number;
    static TYPE: "watchlist";
    rootEl: HTMLElement;
    api: TradingApi;
    instruments: InstrumentRow[];
    stats: Map<string, QuoteStats>;
    favorites: Set<string>;
    filter: string;
    search: string;
    currentSymbol: string | null;
    wsClient: MarketDataClient;
    bodyEl: HTMLElement | null;
    searchEl: HTMLInputElement | null;
    tabsEl: HTMLElement | null;
    sortHeaderEl: HTMLElement | null;
    _host: TradingHost;
    _deps: WatchlistDeps;
    _subscribedSyms: Set<string>;
    _closeBtn: HTMLElement | null;
    _exportBtn: HTMLElement | null;
    _grid: DataGrid<InstrumentRow> | null;
    static create(hostEl: HTMLElement, state: Record<string, unknown>, deps: WatchlistDeps): WatchlistWidget;
    static _buildRoot(host: TradingHost): HTMLElement;
    constructor(rootEl: HTMLElement, _state: Record<string, unknown>, deps: WatchlistDeps);
    dispose(): void;
    init(): Promise<void>;
    _renderCategoryTabs(): void;
    setCurrentSymbol(symbol: string | null): void;
    onPriceUpdate(symbol: string, price: number): void;
    static _baselineKey(symbol: string): string;
    _bind(): void;
    _filtered(): InstrumentRow[];
    _render(): void;
    _columns(): GridColumn<InstrumentRow>[];
    _statsOf(instrument: InstrumentRow): QuoteStats;
    _symbolCell(instrument: InstrumentRow): Node;
    _export(): void;
    _updateRow(symbol: string, prevPrice: number | null | undefined): void;
    _toggleFavorite(symbol: string): void;
    _loadFavorites(): string[];
    _saveFavorites(): void;
    _visible(): InstrumentRow[];
    _syncSubs(): void;
    _publishVisible(): void;
    static _priceText(price: number | null | undefined): string;
    static _changeText(chgPct: number | null | undefined): string;
    static _changeClass(chgPct: number | null | undefined): string;
}
