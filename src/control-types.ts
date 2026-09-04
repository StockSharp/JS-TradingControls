// The identifiers a host and a control agree on for each kind of control this
// package ships.
//
// These strings used to be spelled out independently in four places — a docking
// manager's panel table, its default layouts, each control's static TYPE
// literal and a Razor panels menu — so a typo in any one of them produced a
// panel that opened but never received data, with nothing to compare against.
//
// The VALUES are load-bearing and must not be edited. A host writes them into
// whatever it persists its layout as, so renaming one orphans every saved
// layout that mentions it.
//
// Only the kinds this package implements are named here. A host that has more
// control kinds of its own declares those itself and merges the two sets; that
// keeps every identifier declared exactly once, by whoever owns the control it
// names.
export const ControlTypes = {
    Watchlist: 'watchlist',
    ActiveOrders: 'activeOrders',
    TradeHistory: 'tradeHistory',
    Positions: 'positions',
    OrderBook: 'orderbook',
    TradeFeed: 'tradefeed',
    OrderEntry: 'orderEntry',
    Statistics: 'statistics',
    LogMonitor: 'logMonitor',
    Strategies: 'strategies',
    OptionDesk: 'optionDesk',
    OptionSmile: 'optionSmile',
    Equity: 'equity',
    OptimizationHeatmap: 'optimizationHeatmap',
    OptimizationSurface: 'optimizationSurface',
} as const;

export type ControlType = typeof ControlTypes[keyof typeof ControlTypes];
