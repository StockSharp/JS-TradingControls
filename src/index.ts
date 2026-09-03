export { MarketDataLevels, PRESENTATION_CLASSES, assertHost } from './trading-host.js';

export type {
    HostStore,
    MarketDataClient,
    MarketDataLevel,
    TickerSink,
    TradingApi,
    TradingContext,
    TradingControl,
    TradingHost,
    TradingPresentation,
} from './trading-host.js';

export type {
    BalanceRow,
    InstrumentRow,
    OrderRow,
    OrderSide,
    OrderStatus,
    OrderType,
    PositionRow,
    QuoteStats,
    StatisticRow,
    TradeRow,
} from './trading-data.js';

export { ControlTypes } from './control-types.js';

export type { ControlType } from './control-types.js';

export { cleanRejectReason, formatPnl, formatPrice, formatQty, formatTime } from './formatters.js';

// A host that renders its own chrome around these controls builds it with the
// same helpers, so the panel it wraps and the panel it wraps them in agree on
// class names.
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

// The palette a host answers with for the parts a control draws on a canvas,
// where a class name cannot reach.
export type { CanvasPalette } from './trading-host.js';

// The cumulative P&L curve, shared by everything that draws one: a strategy row's
// sparkline and a statistics card are the same curve at two sizes. A backtest's own
// equity is not here - that one shares the price axis and belongs to the chart engine.
export { compressPnl, drawPnlCurve, pnlCurve } from './pnl-curve.js';

export type { PnlBox, PnlCurve, PnlCurveContext, PnlCurveStyle, PnlPoint } from './pnl-curve.js';

export { OptionDeskWidget, greekPlaces, greekScales, scaleChain, sideGreeks } from './option-desk-widget.js';

export type { OptionChainContext, OptionDeskDeps, OptionSide, OptionStrike } from './option-desk-widget.js';

// Option pricing, for a host that has quotes and an expiry but no pricing service. A host
// that computes its own greeks sends them instead and none of this is reached.
export { OptionTypes, d1, d2, greeks, impliedVolatility, normalCdf, normalPdf, premium } from './black-scholes.js';

export type { Greeks, OptionInputs, OptionType } from './black-scholes.js';

export { StrategiesWidget, StrategyStates } from './strategies-widget.js';

export type { StrategiesActions, StrategiesDeps, StrategyRow, StrategyState } from './strategies-widget.js';

export { LogMonitorWidget } from './log-monitor-widget.js';

export type { LogMonitorDeps } from './log-monitor-widget.js';

// The log's own shapes: how sources nest, and which messages a view of them keeps. A host
// rendering its own view of the same feed reads these rather than reinventing the filter.
export { LogLevels, buildLogTree, keepLog, subtreeOf } from './log-tree.js';

export type { LogLevel, LogMessageRow, LogSourceNode, LogTreeNode, LogView } from './log-tree.js';

export { StatisticsWidget, formatStatistic } from './statistics-widget.js';

export type { StatisticsDeps } from './statistics-widget.js';

export { TradeFeedWidget } from './tradefeed-widget.js';

export type { TradeFeedDeps } from './tradefeed-widget.js';

// The tape's own shapes: one print as the chart reads it, and the bubble a
// print (or a slice of them) is drawn as. A host that renders its own view of
// the same feed reads these rather than reinventing the compaction.
export { aggregateBubbles } from './tradefeed-aggregator.js';

export type { FeedBubble, FeedTick } from './tradefeed-aggregator.js';

export { layoutBubbles } from './tradefeed-bubbles.js';

export type { BubbleAxisTick, BubbleLane, BubbleLaneShape, BubbleLayout, BubbleLayoutInput, BubbleShape } from './tradefeed-bubbles.js';

// The grid's own menu, worded by the host. Exported because a host that builds a table of its
// own - a run's log beside the blotters, say - needs the same menu in the same words, and the
// alternative is every consumer restating thirty labels the package already knows.
export { makeGridMenu } from './grid-menu.js';
