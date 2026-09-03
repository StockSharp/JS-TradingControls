// The rows the controls render.
//
// These are wire shapes, not domain models: the host fetches them from
// whatever backend it has and hands them over, and this package only reads
// them. That is why every field is optional. A server that omits `realizedPnl`
// on a flat position, a snapshot row that predates a field, an optimistic
// client-side insert carrying half a fill — all of them are ordinary here, and
// every control already guards with `?? 0` / `|| ''` at the point of use. A
// required field would only move that guard to the host, which cannot honour it
// either.
//
// Two fields are deliberately unions rather than enums. `side` and `status`
// arrive in more than one spelling depending on which endpoint produced the row
// (a numeric StockSharp enum from the socket, a name from the DTO, an uppercase
// name from the history endpoint), and normalising them is the host's job —
// `TradingPresentation` is where that knowledge lives. Narrowing the type here
// would only force a cast at every call site that is already correct.
//
// Every numeric field is `number | null` as well as optional, for the same
// reason: an absent price reaches us as an omitted key from one endpoint and as
// an explicit null from another, both meaning "not set". Saying so once here is
// what lets the read sites stay the plain `?? 0` / `|| ''` they already were.
//
// This module has no imports and no behaviour.

/// Buy or sell, in any of the spellings the wire uses: `0`/`1`, `'Buy'`/`'Sell'`
/// or `'BUY'`/`'SELL'`.
export type OrderSide = number | string;

/// A StockSharp `OrderTypes` value (`0` limit, `1` market, `2` conditional) or
/// its name.
export type OrderType = number | string;

/// A StockSharp `OrderStates` value (see `OrderStates` in
/// `active-orders-widget.ts`) or its name.
export type OrderStatus = number | string;

/// One open position in a portfolio.
export interface PositionRow {
    portfolioId?: number | null;
    /// Numeric instrument id where the source has one. Rows from an unsaved
    /// snapshot may carry only `instrument`, which is why the identity used for
    /// matching falls back to it.
    instrumentId?: number | null;
    instrument?: string;
    quantity?: number | null;
    avgPrice?: number | null;
    currentPrice?: number | null;
    unrealizedPnl?: number | null;
    realizedPnl?: number | null;
}

/// The cash side of a portfolio, rendered as a pinned row above the positions.
export interface BalanceRow {
    available?: number | null;
    locked?: number | null;
    total?: number | null;
}

/// One live or recently terminal order.
export interface OrderRow {
    /// The register transaction id. This is what cancel, replace and inline edit
    /// address an order by, and what the grid keys rows on.
    id?: number | null;
    /// Per-user friendly counter shown in the ID column. Absent on rows cached
    /// from before the counter shipped.
    localId?: number | null;
    instrument?: string;
    side?: OrderSide;
    type?: OrderType;
    quantity?: number | null;
    /// The unfilled remainder. A control that shows what is still resting on
    /// the book reads this and falls back to `quantity` — a snapshot row taken
    /// before anything filled carries only the latter.
    balance?: number | null;
    limitPrice?: number | null;
    stopPrice?: number | null;
    status?: OrderStatus;
    /// Venue text for a rejection. Some adapters wrap it in a JSON blob — see
    /// `cleanRejectReason`.
    rejectReason?: string;
}

/// One executed trade.
export interface TradeRow {
    id?: number | null;
    /// Execution time. `executedAt` is what the API returns; `time` is what a
    /// socket fill carries, and the control reads whichever is present.
    executedAt?: string;
    time?: string;
    instrumentSymbol?: string;
    symbol?: string;
    side?: OrderSide;
    quantity?: number | null;
    price?: number | null;
    /// The order this fill belongs to, under either of the two names the
    /// endpoints use.
    order?: number | null;
    orderId?: number | null;
}

/// One tradable instrument, as the instrument search returns it.
/// One statistic a strategy reports about itself.
///
/// The desktop grid reflects these off the strategy's parameter objects; a browser is handed
/// them already resolved. `category` groups and `order` sorts - both are the registry's, not
/// the reader's, and neither is the translated text beside it.
export interface StatisticRow {
    /// Stable identity, and what the row is addressed by. The parameter's own kind.
    key: string;
    /// Grouping key. Stable across languages.
    category: string;
    /// What that group is called here.
    categoryText?: string;
    /// Where the parameter sits among its peers. Banded by category by the registry.
    order: number;
    /// Localized caption.
    name: string;
    /// Localized explanation, shown on hover.
    description?: string;
    /// A number, a moment, or a word - whatever the parameter measures. Null until measured.
    value?: number | string | Date | null;
}

export interface InstrumentRow {
    /// Qualified symbol — `BTC@IMEX`. The display form drops the venue.
    symbol?: string;
    name?: string;
    exchange?: string;
    /// Admin-assigned grouping. The watchlist turns the distinct values into
    /// filter tabs, so the tab set is configured rather than hardcoded.
    category?: string;
}

/// One price level of an order book side, as the wire delivers it. A level
/// whose quantity is zero is a delete instruction in a diff frame, not an empty
/// level, so the field carries meaning at every value including zero.
export interface QuoteLevel {
    price?: number | null;
    quantity?: number | null;
}

/// One order-book update.
///
/// The first frame of a (re)subscription is a snapshot: the receiver drops what
/// it holds and applies every level. The frames after it are diffs touching
/// only the levels that changed. `sequence` is monotonic per symbol, so a gap
/// means a frame was missed and the diffs after it cannot be trusted — the cure
/// is a fresh snapshot, which is what `MarketDataClient.resubscribe` asks for.
export interface OrderBookFrame {
    symbol?: string;
    sequence?: number | null;
    isSnapshot?: boolean;
    bids?: QuoteLevel[];
    asks?: QuoteLevel[];
}

/// One level of a book a control has already accepted: sorted, clipped to the
/// visible depth and free of the malformed levels a wire frame can carry. Both
/// fields are present, which is the difference from `QuoteLevel` — everything
/// that could be absent was dropped on the way in.
export interface BookLevel {
    price: number;
    quantity: number;
}

/// The grid a venue will accept an order on: the sizes it trades in and the
/// prices it quotes at. Separate from `InstrumentRow` because it answers a
/// different question — that one is what an instrument IS, this one is what an
/// order on it may say — and the two arrive from different endpoints.
export interface InstrumentSpec {
    symbol?: string;
    /// The size an order's quantity must be a whole number of.
    lotSize?: number | null;
    /// The smallest price increment the venue quotes.
    tickSize?: number | null;
    minVolume?: number | null;
    /// Absent (or null) means the venue states no upper bound.
    maxVolume?: number | null;
}

/// What a control has computed about a symbol from the live tape. Handed to the
/// host's ticker sink as-is.
export interface QuoteStats {
    lastPrice?: number | null;
    /// First price observed this session-day, the change percentage is measured
    /// from.
    baseline?: number | null;
    chgPct?: number | null;
}
