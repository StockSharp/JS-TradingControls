// The host port — the whole of what a trading control needs from whoever
// embeds it.
//
// A control is written against this interface and nothing else: it never
// imports a translator, a preference singleton, a panel registry or a docking
// manager, and it never reaches a window global. A host — a terminal page, a
// backoffice screen, a demo harness — supplies one object shaped like
// `TradingHost` per control instance, and that object is the only way out of
// the control.
//
// This module imports nothing but the row shapes it names. It is the contract,
// so it must be readable by a host that shares none of the package's internals.
//
// Everything here is REQUIRED, and `assertHost` proves it at construction.
// There is no optional member and no default, because a half-supplied host is
// how a control half-works: it renders, it looks alive, and the one capability
// nobody wired is discovered by a user clicking something that does nothing.
// A missing member has to be a loud failure at wiring time, not a quiet one at
// click time.
//
// Seven members have no call site among the four controls this package ships —
// `spawn`, `persistState`, `saveLayout`, `log`, `trading.pickInstrument`,
// `marketData.resubscribe` and `marketData.getOrders`. They are required
// anyway, and the reason is not a future one:
//
//   The port was extracted from a terminal that has SEVEN controls, four of
//   which now live here. The other three — the order book, the order entry
//   pad and the trade feed — are already written against THIS interface, in
//   this repository's sibling host, importing `TradingHost` and `assertHost`
//   from this module today. Every one of the seven members above is called by
//   them: the order book alone accounts for `resubscribe` (recovering from a
//   sequence gap without unsubscribing its neighbours), `getOrders` (its "your
//   size is here" badge), `log` (wire anomalies the user cannot see) and
//   `pickInstrument`; the order book and the trade feed both `spawn` and both
//   `persistState` + `saveLayout`.
//
//   So this is one port with three of its consumers still on the host's side
//   of the boundary, not a port padded with speculation. Narrowing it now and
//   widening it again as each of those three moves in would break every host
//   twice for the sake of a window in which no control is missing.
//
// The cost is real and worth stating: a host adopting only the four shipped
// controls must still supply seven members nothing will call. They are cheap
// (a no-op `spawn`, a `log` that forwards to the console) — but they are not
// free, and an adopter who supplies stubs is not doing anything wrong.
import type { InstrumentRow, OrderRow, OrderSide, OrderStatus, OrderType, QuoteStats, TradeRow } from './trading-data.js';

/// How a host words and colours the trading vocabulary. The control owns the
/// data; the host owns the language and the stylesheet, so it says what a side
/// or a status reads as and which CSS class carries its colour.
///
/// The two class methods are the one place a host has to agree with the shipped
/// stylesheet rather than merely supply values to it. A control puts whatever
/// string comes back straight onto the cell without inspecting it, so nothing
/// in `src/` ever emits these names and `styles/trading-controls.css` cannot be
/// read to discover them. They are named here, and `PRESENTATION_CLASSES` below
/// is the same list as data — `tools/check-style-contract.mjs` asserts the
/// stylesheet styles every one of them, so the agreement is checked rather than
/// discovered by a cell that came out unstyled.
export interface TradingPresentation {
    /// Localized "Buy" / "Sell".
    sideText(side: OrderSide): string;
    /// Localized short order type — "LMT", "MKT", "STP", "STP-LMT". Needs both
    /// prices because a conditional order is only a stop-limit when it carries
    /// a limit price as well as a stop price.
    typeText(type: OrderType, limitPrice: number, stopPrice: number): string;
    /// Localized order status.
    statusText(status: OrderStatus): string;
    /// CSS class colouring a cell by side. The shipped stylesheet styles
    /// `side-buy` and `side-sell`; a host on its own palette may answer with
    /// its own names and style those instead.
    sideClass(side: OrderSide): string;
    /// CSS class colouring a cell by the sign of a P&L figure. The shipped
    /// stylesheet styles `pnl-positive` and `pnl-negative`; the empty string is
    /// a legitimate answer for "no colour".
    pnlClass(pnl: number): string;
}

/// The class names `TradingPresentation` is expected to return, as data.
///
/// Exported because it is a contract, not a detail: a host writing its own
/// presentation reads this to know which names the shipped stylesheet already
/// paints, and the style-contract check reads it to prove they are all styled.
export const PRESENTATION_CLASSES = {
    sideClass: ['side-buy', 'side-sell'],
    pnlClass: ['pnl-positive', 'pnl-negative'],
} as const;

/// A string-keyed store. Two of these reach a control and they are NOT
/// interchangeable — see `TradingHost.preferences` and `TradingHost.cache`.
export interface HostStore {
    /// The stored value, or `fallback` when the key was never written.
    get(key: string, fallback: string | null): string | null;
    /// Write, or clear by writing null.
    set(key: string, value: string | null): void;
}

/// The read side of the trading account, as far as a control is concerned.
/// Narrow on purpose: a control asks for the few calls it makes rather than
/// being handed a whole API client to explore.
export interface TradingApi {
    /// Executed trades, newest first, for one portfolio. A null `symbol` means
    /// every instrument — the argument is stated either way rather than being
    /// left off, so a call site says which of the two it wants.
    getExecutions(portfolioId: number, symbol: string | null, limit: number): Promise<TradeRow[]>;
    /// Instruments matching a query; the empty query means "everything".
    searchInstruments(query: string): Promise<InstrumentRow[]>;
}

/// How much of a symbol a control wants streamed. A quote row needs the last
/// price, a tape needs every print, a ladder needs the book as well — and each
/// costs the wire something different, so a control states which it is asking
/// for rather than leaving the argument off and taking a default.
export const MarketDataLevels = {
    /// Level 1 only: best bid/ask and last price.
    Quotes: 'l1only',
    /// Level 1 plus every tick.
    Tape: 'tape',
    /// Level 1, ticks and market depth.
    Full: 'full',
} as const;

export type MarketDataLevel = typeof MarketDataLevels[keyof typeof MarketDataLevels];

/// The live market-data connection. `addSymbol` / `removeSymbol` are
/// refcounted by the implementation, so two controls watching one symbol hold
/// one subscription between them and neither can unsubscribe the other.
export interface MarketDataClient {
    addSymbol(symbol: string, level: MarketDataLevel): Promise<unknown>;
    removeSymbol(symbol: string): Promise<unknown>;
    /// Make the server resend `symbol` from scratch, without touching the
    /// refcount. A control applying diffs against a sequence cannot recover
    /// from a missed frame on its own — the only cure is a fresh snapshot, and
    /// asking for one must not unsubscribe the other controls watching the
    /// same symbol.
    resubscribe(symbol: string, level: MarketDataLevel): Promise<void>;
    /// The client's cache of this session's own orders. The order book paints
    /// its "you have size here" badge from this rather than subscribing again.
    getOrders(): OrderRow[];
}

/// What a control reads about the account and the instrument universe.
export interface TradingContext {
    readonly api: TradingApi;
    readonly marketData: MarketDataClient;
    /// The portfolio a control should load against, read per use rather than
    /// captured — the user can switch portfolio under a control that is
    /// already on screen.
    portfolioId(): number | null;
    /// Ask the host to let the user pick an instrument. The host owns the
    /// picker UI; the control only learns what was chosen, and learns nothing
    /// if the user dismisses it.
    pickInstrument(onPicked: (symbol: string) => void): void;
}

/// Where a control's summary of what it is showing goes. A status-bar ticker is
/// page chrome outside any control, so a control reports and the host decides
/// what to do with the report.
export interface TickerSink {
    publish(symbols: string[], stats: Map<string, QuoteStats>): void;
}

/// One live control instance, from the host's side. Deliberately opaque: the
/// host holds a heterogeneous set and only ever hands instances back to the
/// control that asked for them, which is what `broadcast<T>` expresses.
export type TradingControl = object;

/// Everything a trading control needs from its host.
export interface TradingHost {
    // -- this instance's role on the page ---------------------------------
    /// True when this instance is the one that speaks for the page. A page has
    /// one status-bar ticker and a control can be duplicated, so somebody has
    /// to decide which duplicate feeds it — and that is host policy, not
    /// something a control can work out about itself.
    readonly isPrimary: boolean;

    // -- language and wording ---------------------------------------------
    /// Translate. `key` is the English source text; `{0}`, `{1}` … in the
    /// translation are replaced positionally from `args`.
    t(key: string, ...args: unknown[]): string;
    readonly presentation: TradingPresentation;

    // -- storage ------------------------------------------------------------
    /// Settings that belong to the user and are expected to survive — a chosen
    /// depth, a view mode, a favourites list. May be slow and may be shared
    /// across devices.
    readonly preferences: HostStore;
    /// Local scratch that may be thrown away — a per-day price baseline, a
    /// memoised computation. Deliberately a different store from
    /// `preferences`: writing high-churn per-symbol keys into a synced
    /// per-user settings blob is how a settings row becomes a cache.
    readonly cache: HostStore;

    // -- the trading context it reads ---------------------------------------
    readonly trading: TradingContext;

    // -- where its ticker updates go ----------------------------------------
    readonly ticker: TickerSink;

    // -- permission and diagnostics -----------------------------------------
    /// May the user do this? `action` is the English name of the attempt
    /// ("add to favorites"); the host translates it and may show a sign-in
    /// prompt before answering false.
    allow(action: string): boolean;
    /// Send a diagnostic line wherever this host collects them. Controls use
    /// it for wire anomalies the user cannot see and support has to.
    log(message: string): void;

    // -- lifecycle calls it makes back --------------------------------------
    /// This control wants to go away.
    close(): void;
    /// The `+` gesture: another control of the same kind, starting from
    /// `state`. The host knows what kind this one is, so the control does not
    /// name its own type.
    spawn(state: Record<string, unknown>): void;
    /// Remember this control's per-instance state. Recording only — call
    /// `saveLayout` when the change is worth flushing.
    persistState(patch: Record<string, unknown>): void;
    /// Write the layout out now, bypassing any debounce the host applies.
    saveLayout(): void;

    // -- the host's handle on live instances --------------------------------
    /// Announce this instance. A host fans incoming data to every live control
    /// of a kind, so an unregistered control is a control that never updates.
    register(control: TradingControl): void;
    unregister(control: TradingControl): void;
    /// Apply something to every live control of this kind, this one included.
    /// The caller knows what its own siblings are, which is why `T` is its to
    /// name.
    broadcast<T>(apply: (control: T) => void): void;
}

/// Prove a host object satisfies the port, and say precisely what is missing
/// when it does not.
///
/// Called from every control's constructor before anything else, so a
/// mis-wired host fails at construction with the member named, instead of at
/// the first click that needed it.
export function assertHost(host: TradingHost, controlName: string): TradingHost {
    _required(host, 'host', 'object', controlName);

    _required(host.isPrimary, 'host.isPrimary', 'boolean', controlName);
    _required(host.t, 'host.t', 'function', controlName);

    _required(host.presentation, 'host.presentation', 'object', controlName);
    _required(host.presentation.sideText, 'host.presentation.sideText', 'function', controlName);
    _required(host.presentation.typeText, 'host.presentation.typeText', 'function', controlName);
    _required(host.presentation.statusText, 'host.presentation.statusText', 'function', controlName);
    _required(host.presentation.sideClass, 'host.presentation.sideClass', 'function', controlName);
    _required(host.presentation.pnlClass, 'host.presentation.pnlClass', 'function', controlName);

    _required(host.preferences, 'host.preferences', 'object', controlName);
    _required(host.preferences.get, 'host.preferences.get', 'function', controlName);
    _required(host.preferences.set, 'host.preferences.set', 'function', controlName);

    _required(host.cache, 'host.cache', 'object', controlName);
    _required(host.cache.get, 'host.cache.get', 'function', controlName);
    _required(host.cache.set, 'host.cache.set', 'function', controlName);

    _required(host.trading, 'host.trading', 'object', controlName);
    _required(host.trading.api, 'host.trading.api', 'object', controlName);
    // The calls, not just the objects holding them. An `api: {}` is the shape a
    // half-wired host actually has — the object gets built, the methods get
    // forgotten — so stopping at the object would skip exactly the members this
    // function exists to catch.
    _required(host.trading.api.getExecutions, 'host.trading.api.getExecutions', 'function', controlName);
    _required(host.trading.api.searchInstruments, 'host.trading.api.searchInstruments', 'function', controlName);
    _required(host.trading.marketData, 'host.trading.marketData', 'object', controlName);
    _required(host.trading.marketData.addSymbol, 'host.trading.marketData.addSymbol', 'function', controlName);
    _required(host.trading.marketData.removeSymbol, 'host.trading.marketData.removeSymbol', 'function', controlName);
    _required(host.trading.marketData.resubscribe, 'host.trading.marketData.resubscribe', 'function', controlName);
    _required(host.trading.marketData.getOrders, 'host.trading.marketData.getOrders', 'function', controlName);
    _required(host.trading.portfolioId, 'host.trading.portfolioId', 'function', controlName);
    _required(host.trading.pickInstrument, 'host.trading.pickInstrument', 'function', controlName);

    _required(host.ticker, 'host.ticker', 'object', controlName);
    _required(host.ticker.publish, 'host.ticker.publish', 'function', controlName);

    _required(host.allow, 'host.allow', 'function', controlName);
    _required(host.log, 'host.log', 'function', controlName);

    _required(host.close, 'host.close', 'function', controlName);
    _required(host.spawn, 'host.spawn', 'function', controlName);
    _required(host.persistState, 'host.persistState', 'function', controlName);
    _required(host.saveLayout, 'host.saveLayout', 'function', controlName);

    _required(host.register, 'host.register', 'function', controlName);
    _required(host.unregister, 'host.unregister', 'function', controlName);
    _required(host.broadcast, 'host.broadcast', 'function', controlName);

    return host;
}

// `typeof null` is 'object', which would let a null store through the object
// checks — the one case worth spelling out, because null is exactly what an
// unwired dependency looks like.
function _required(value: unknown, path: string, kind: string, controlName: string): void {
    if (value === null || value === undefined || typeof value !== kind)
        throw new Error(`${controlName}: ${path} is required`);
}
