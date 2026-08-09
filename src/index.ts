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

export { TradeFeedWidget } from './tradefeed-widget.js';

export type { TradeFeedDeps } from './tradefeed-widget.js';

// The tape's own shapes: one print as the chart reads it, and the bubble a
// print (or a slice of them) is drawn as. A host that renders its own view of
// the same feed reads these rather than reinventing the compaction.
export { aggregateBubbles } from './tradefeed-aggregator.js';

export type { FeedBubble, FeedTick } from './tradefeed-aggregator.js';

export { layoutBubbles } from './tradefeed-bubbles.js';

export type { BubbleAxisTick, BubbleLane, BubbleLaneShape, BubbleLayout, BubbleLayoutInput, BubbleShape } from './tradefeed-bubbles.js';
