// FILE: active-orders-widget.d.ts
import { TradingHost } from './trading-host.js';
import type { OrderRow } from './trading-data.js';
import { DataGrid, GridColumn } from '@stocksharp/grid/source/data-grid';
export declare const OrderStates: {
    readonly PendingRisk: 1;
    readonly Sent: 2;
    readonly Active: 3;
    readonly PartiallyFilled: 4;
    readonly Filled: 5;
    readonly Rejected: 6;
    readonly Cancelled: 7;
};
export interface ActiveOrdersDeps {
    host: TradingHost;
    cancelOrder(orderId: number): void;
    dismissOrder(orderId: number): void;
    editOrderField(orderId: number, field: string): void;
    replaceOrder(orderId: number, quantity: number, limitPrice: number, stopPrice: number): void;
    cancelAllOrders(): void;
    refreshOrders(): void;
}
export declare class ActiveOrdersWidget {
    static TYPE: "activeOrders";
    rootEl: HTMLElement;
    el: HTMLElement | null;
    _host: TradingHost;
    _deps: ActiveOrdersDeps;
    _closeBtn: HTMLElement | null;
    _cancelAllBtn: HTMLElement | null;
    _refreshBtn: HTMLElement | null;
    _exportBtn: HTMLElement | null;
    _orders: OrderRow[];
    _grid: DataGrid<OrderRow> | null;
    static create(hostEl: HTMLElement, state: Record<string, unknown>, deps: ActiveOrdersDeps): ActiveOrdersWidget;
    static _buildRoot(host: TradingHost): HTMLElement;
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

// FILE: control-types.d.ts
export declare const ControlTypes: {
    readonly Watchlist: "watchlist";
    readonly ActiveOrders: "activeOrders";
    readonly TradeHistory: "tradeHistory";
    readonly Positions: "positions";
};
export type ControlType = typeof ControlTypes[keyof typeof ControlTypes];

// FILE: dom.d.ts
export declare function makeElement(tag: string, className: string, attrs: Record<string, string>, children: Array<Node | string>): HTMLElement;
export declare function makeIcon(iconClass: string): HTMLElement;
export declare function makeIconButton(className: string, label: string, iconClass: string, attrs: Record<string, string>): HTMLButtonElement;
export declare function makePanelRoot(modifierClass: string, label: string, children: Array<Node | string>): HTMLElement;
export declare function makePanelId(type: string): string;

// FILE: formatters.d.ts
type Numeric = number | string | null | undefined;
export declare function formatPrice(price: Numeric): string;
export declare function formatQty(qty: Numeric): string;
export declare function formatTime(dateStr: string | number | Date | null | undefined): string;
export declare function formatPnl(pnl: Numeric): string;
export declare function cleanRejectReason(reason: string | null | undefined): string;
export {};

// FILE: index.d.ts
export { MarketDataLevels, PRESENTATION_CLASSES, assertHost } from './trading-host.js';
export type { HostStore, MarketDataClient, MarketDataLevel, TickerSink, TradingApi, TradingContext, TradingControl, TradingHost, TradingPresentation, } from './trading-host.js';
export type { BalanceRow, InstrumentRow, OrderRow, OrderSide, OrderStatus, OrderType, PositionRow, QuoteStats, TradeRow, } from './trading-data.js';
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

// FILE: positions-widget.d.ts
import { TradingHost } from './trading-host.js';
import type { BalanceRow, PositionRow } from './trading-data.js';
import { DataGrid, GridColumn, GridPinnedRow } from '@stocksharp/grid/source/data-grid';
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

// FILE: trade-history-widget.d.ts
import { TradingHost } from './trading-host.js';
import type { TradeRow } from './trading-data.js';
import { DataGrid, GridColumn } from '@stocksharp/grid/source/data-grid';
export interface TradeHistoryDeps {
    host: TradingHost;
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
    static _buildRoot(host: TradingHost): HTMLElement;
    constructor(rootEl: HTMLElement, _state: Record<string, unknown>, deps: TradeHistoryDeps);
    dispose(): void;
    refresh(): Promise<void>;
    _export(): void;
    _columns(): GridColumn<TradeRow>[];
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
export interface InstrumentRow {
    symbol?: string;
    name?: string;
    exchange?: string;
    category?: string;
}
export interface QuoteStats {
    lastPrice?: number | null;
    baseline?: number | null;
    chgPct?: number | null;
}

// FILE: trading-host.d.ts
import type { InstrumentRow, OrderRow, OrderSide, OrderStatus, OrderType, QuoteStats, TradeRow } from './trading-data.js';
export interface TradingPresentation {
    sideText(side: OrderSide): string;
    typeText(type: OrderType, limitPrice: number, stopPrice: number): string;
    statusText(status: OrderStatus): string;
    sideClass(side: OrderSide): string;
    pnlClass(pnl: number): string;
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
import { DataGrid, GridColumn } from '@stocksharp/grid/source/data-grid';
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
