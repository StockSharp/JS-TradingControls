// Demo harness for @stocksharp/trading-controls.
//
// ---------------------------------------------------------------------------
// THE HOST HERE IS A DEMO STAND-IN.
//
// `TradingHost` is the whole API surface of this package: a control imports no
// translator, no settings singleton, no panel registry and no socket, and every
// control asserts the port is complete (`assertHost`) before it renders. The
// real implementation of that port lives in the StockSharp web terminal these
// four controls were extracted from — the page that owns the docking manager,
// the translation dictionary, the user's synced settings, the market-data
// socket and the trading API client.
//
// What follows implements the same port honestly against sample data: `t()`
// answers from a dictionary and says so in the log when a key is missing, the
// two stores are plain objects, `allow()` grants everything, and the API and
// market-data calls resolve from the arrays below instead of reaching a
// network. Nothing on this page is drawn by hand — every table, button, tab and
// inline edit comes out of the package.
// ---------------------------------------------------------------------------

(function () {
    'use strict';

    const {
        ActiveOrdersWidget,
        PositionsWidget,
        TradeHistoryWidget,
        WatchlistWidget,
        ControlTypes,
        OrderStates,
        PRESENTATION_CLASSES,
    } = window.SSTradingControls;

    const PORTFOLIO_ID = 7;

    // StockSharp wire enums the sample rows are written in. `side` and `type`
    // arrive as numbers or names depending on the endpoint, which is why the
    // presentation below normalises rather than switches on one spelling.
    const Sides = { Buy: 0, Sell: 1 };
    const OrderTypes = { Limit: 0, Market: 1, Conditional: 2 };

    // ---------------------------------------------------------------- sample data

    // The instrument universe. The wire half (symbol / name / exchange /
    // category) is what `searchInstruments` returns; the rest is this demo's own
    // price simulation state. `category` is what the watchlist turns into filter
    // tabs, so the tab strip below is data, not markup.
    const UNIVERSE = [
        { symbol: 'BTC@IMEX', name: 'Bitcoin / USD', exchange: 'IMEX', category: 'Crypto', id: 101, price: 68420.5, dayOpen: 67310.0, vol: 0.0012, dp: 1 },
        { symbol: 'ETH@IMEX', name: 'Ether / USD', exchange: 'IMEX', category: 'Crypto', id: 102, price: 3512.25, dayOpen: 3564.8, vol: 0.0014, dp: 2 },
        { symbol: 'SOL@IMEX', name: 'Solana / USD', exchange: 'IMEX', category: 'Crypto', id: 103, price: 172.44, dayOpen: 168.02, vol: 0.0019, dp: 2 },
        { symbol: 'AAPL@NASDAQ', name: 'Apple Inc.', exchange: 'NASDAQ', category: 'Equity', id: 201, price: 231.18, dayOpen: 229.44, vol: 0.0006, dp: 2 },
        { symbol: 'MSFT@NASDAQ', name: 'Microsoft Corp.', exchange: 'NASDAQ', category: 'Equity', id: 202, price: 428.6, dayOpen: 431.05, vol: 0.0005, dp: 2 },
        { symbol: 'NVDA@NASDAQ', name: 'NVIDIA Corp.', exchange: 'NASDAQ', category: 'Equity', id: 203, price: 121.34, dayOpen: 118.2, vol: 0.0011, dp: 2 },
        { symbol: 'ESZ5@CME', name: 'E-mini S&P 500 Dec 25', exchange: 'CME', category: 'Futures', id: 301, price: 5812.5, dayOpen: 5796.25, vol: 0.0004, dp: 2 },
        { symbol: 'CLZ5@NYMEX', name: 'Crude Oil Dec 25', exchange: 'NYMEX', category: 'Futures', id: 302, price: 71.86, dayOpen: 72.94, vol: 0.0013, dp: 2 },
        { symbol: 'EURUSD@FX', name: 'Euro / US Dollar', exchange: 'FX', category: 'FX', id: 401, price: 1.0842, dayOpen: 1.0871, vol: 0.0003, dp: 4 },
        { symbol: 'XAUUSD@FX', name: 'Gold / US Dollar', exchange: 'FX', category: 'FX', id: 402, price: 2648.3, dayOpen: 2639.15, vol: 0.0005, dp: 2 },
    ];

    const PRISTINE_PRICES = UNIVERSE.map(u => u.price);

    function minutesAgo(n) {
        return new Date(Date.now() - n * 60000).toISOString();
    }

    // One winner (BTC), one loser (NVDA, short into a rally), one small winner
    // riding on a realized loss (ESZ5) — so the P&L colouring shows both classes
    // and the "realized + unrealized" total the column actually sorts on.
    const PRISTINE_POSITIONS = [
        { portfolioId: PORTFOLIO_ID, instrumentId: 101, instrument: 'BTC@IMEX', quantity: 0.75, avgPrice: 66980.0, realizedPnl: 120.0 },
        { portfolioId: PORTFOLIO_ID, instrumentId: 203, instrument: 'NVDA@NASDAQ', quantity: -400, avgPrice: 118.9, realizedPnl: 0 },
        { portfolioId: PORTFOLIO_ID, instrumentId: 301, instrument: 'ESZ5@CME', quantity: 2, avgPrice: 5798.25, realizedPnl: -15.0 },
    ];

    const PRISTINE_BALANCE = { available: 48250.75, locked: 12500.0, total: 60750.75 };

    // `id` is the register transaction — what cancel / replace / inline edit
    // address an order by. `localId` is the friendly counter the ID column shows.
    // Sides are spelled three ways on purpose: that is what the wire looks like.
    const PRISTINE_ORDERS = [
        {
            id: 90121, localId: 44, instrument: 'ETH@IMEX', side: 'SELL', type: OrderTypes.Limit,
            quantity: 3, balance: 3, limitPrice: 3521.0, stopPrice: null, status: OrderStates.Active,
        },
        {
            id: 90120, localId: 43, instrument: 'AAPL@NASDAQ', side: 'Buy', type: OrderTypes.Market,
            quantity: 100, balance: 100, limitPrice: null, stopPrice: null, status: OrderStates.Rejected,
            rejectReason: 'failed to complete request (err=Forbidden): {"code":40310000,"message":"buying power exceeded: need $23,118.00, available $18,402.55"}',
        },
        {
            id: 90119, localId: 42, instrument: 'NVDA@NASDAQ', side: Sides.Sell, type: OrderTypes.Conditional,
            quantity: 400, balance: 400, limitPrice: 120.85, stopPrice: 121.0, status: OrderStates.Active,
        },
        {
            id: 90118, localId: 41, instrument: 'BTC@IMEX', side: Sides.Buy, type: OrderTypes.Limit,
            quantity: 0.5, balance: 0.5, limitPrice: 68300.0, stopPrice: null, status: OrderStates.Active,
        },
        {
            id: 90117, localId: 40, instrument: 'SOL@IMEX', side: Sides.Buy, type: OrderTypes.Limit,
            quantity: 25, balance: 25, limitPrice: 168.9, stopPrice: null, status: OrderStates.Cancelled,
        },
    ];

    const PRISTINE_TRADES = [
        { id: 5518, executedAt: minutesAgo(4), instrumentSymbol: 'ESZ5@CME', side: Sides.Buy, quantity: 2, price: 5798.25, order: 90114 },
        { id: 5517, executedAt: minutesAgo(11), instrumentSymbol: 'NVDA@NASDAQ', side: Sides.Sell, quantity: 400, price: 118.9, order: 90113 },
        { id: 5516, executedAt: minutesAgo(26), instrumentSymbol: 'BTC@IMEX', side: Sides.Buy, quantity: 0.25, price: 67150.0, order: 90111 },
        { id: 5515, executedAt: minutesAgo(38), instrumentSymbol: 'XAUUSD@FX', side: Sides.Sell, quantity: 10, price: 2651.4, order: 90109 },
        { id: 5514, executedAt: minutesAgo(52), instrumentSymbol: 'BTC@IMEX', side: Sides.Buy, quantity: 0.5, price: 66895.0, order: 90107 },
        { id: 5513, executedAt: minutesAgo(74), instrumentSymbol: 'ETH@IMEX', side: Sides.Buy, quantity: 4, price: 3488.7, order: 90104 },
        { id: 5512, executedAt: minutesAgo(96), instrumentSymbol: 'ETH@IMEX', side: Sides.Sell, quantity: 4, price: 3541.15, order: 90102 },
        { id: 5511, executedAt: minutesAgo(133), instrumentSymbol: 'CLZ5@NYMEX', side: Sides.Buy, quantity: 5, price: 72.41, order: 90099 },
    ];

    const state = {
        positions: [],
        balance: null,
        orders: [],
        trades: [],
        nextTradeId: 5600,
        // Orders this session sends itself — closing or reversing a position is
        // an order too, and its fill has to name one.
        nextOrderId: 90200,
    };

    const clone = (value) => JSON.parse(JSON.stringify(value));

    function resetState() {
        UNIVERSE.forEach((u, i) => { u.price = PRISTINE_PRICES[i]; });
        state.positions = clone(PRISTINE_POSITIONS).map(markToMarket);
        state.balance = clone(PRISTINE_BALANCE);
        state.orders = clone(PRISTINE_ORDERS);
        state.trades = clone(PRISTINE_TRADES);
        state.nextTradeId = 5600;
        state.nextOrderId = 90200;
    }

    const universeOf = (symbol) => UNIVERSE.find(u => u.symbol === symbol) || null;

    // --------------------------------------------------------------- page chrome

    const logEl = document.getElementById('log');
    const tickerEl = document.getElementById('ticker');

    function logLine(kind, text) {
        const line = document.createElement('div');
        line.className = 'log-line ' + kind;
        const stamp = document.createElement('span');
        stamp.className = 't';
        stamp.textContent = new Date().toLocaleTimeString('en-US', { hour12: false });
        line.appendChild(stamp);
        line.appendChild(document.createTextNode(text));
        logEl.appendChild(line);
        while (logEl.childElementCount > 300) logEl.removeChild(logEl.firstElementChild);
        logEl.scrollTop = logEl.scrollHeight;
    }

    // What the primary watchlist reports through `TickerSink.publish` — the symbols
    // currently on screen and its live stats for them. Page chrome outside any
    // control, which is exactly why the control reports instead of drawing it.
    function renderTicker(symbols, stats) {
        tickerEl.textContent = '';
        if (!symbols.length) {
            const empty = document.createElement('span');
            empty.className = 'tk-empty';
            empty.textContent = 'ticker: the watchlist has published no visible symbols';
            tickerEl.appendChild(empty);
            return;
        }
        for (const symbol of symbols.slice(0, 14)) {
            const stat = stats.get(symbol) || {};
            const box = document.createElement('span');
            box.className = 'tk';

            const sym = document.createElement('span');
            sym.className = 'tk-sym';
            sym.textContent = String(symbol).split('@')[0];
            box.appendChild(sym);

            const px = document.createElement('span');
            px.className = 'tk-px';
            px.textContent = stat.lastPrice == null ? '--' : Number(stat.lastPrice).toLocaleString(undefined, { maximumFractionDigits: 4 });
            box.appendChild(px);

            const chg = document.createElement('span');
            const pct = Number(stat.chgPct);
            chg.className = 'tk-chg ' + (isFinite(pct) && pct < 0 ? 'down' : 'up');
            chg.textContent = isFinite(pct) ? `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%` : '--';
            box.appendChild(chg);

            tickerEl.appendChild(box);
        }
    }

    // ------------------------------------------------------------------ the port

    // Every key the controls pass to `t()` — the list is `translation-keys.json`,
    // generated from src/. A key missing from here is logged rather than rendered
    // blank, so a control that grows a caption is visible on this page at once.
    const TEXT = {
        'Actions': 'Actions',
        'ActiveOrders': 'Active orders',
        'ActiveOrdersActions': 'Active order actions',
        'ActiveOrdersList': 'Active orders',
        'All': 'All',
        'AvgPrice': 'Avg',
        'Cancel order': 'Cancel order',
        'CancelAll': 'Cancel all',
        'CancelAllOrders': 'Cancel all orders',
        'Change24hPct': 'Chg %',
        'Close position': 'Close position',
        'Close position on {0}': 'Close position on {0}',
        'ClosePanel': 'Close panel',
        'Current': 'Last',
        'Dismiss': 'Dismiss',
        'ExportToExcel': 'Export to Excel',
        'Favorite': 'Favourite',
        'Favorites': 'Favourites',
        'ID': 'ID',
        'Last': 'Last',
        'Locked: ${0}': 'Locked: ${0}',
        'Markets': 'Markets',
        'MKT': 'MKT',
        'No instruments': 'No instruments',
        'No positions': 'No open positions',
        'No trade history': 'No trades yet',
        'NoActiveOrders': 'No active orders',
        'OpenOrders': 'Open orders',
        'OpenPositions': 'Open positions',
        'Order': 'Order',
        'PnL': 'P&L',
        'Positions': 'Positions',
        'PositionsActions': 'Position actions',
        'Price': 'Price',
        'Qty': 'Qty',
        'Refresh': 'Refresh',
        'Reverse position': 'Reverse position',
        'Reverse position on {0}': 'Reverse position on {0}',
        'SearchInstruments': 'Search instruments',
        'Side': 'Side',
        'Status': 'Status',
        'Stop': 'Stop',
        'Sym': 'Sym',
        'Symbol': 'Symbol',
        'Time': 'Time',
        'TradeHistory': 'Trade history',
        'TradeHistoryActions': 'Trade history actions',
        'TradeHistoryList': 'Trade history',
        'Type': 'Type',
        'USD': 'USD',
        'Watchlist': 'Watchlist',
        'WatchlistFilter': 'Watchlist filter',
    };

    function translate(key, ...args) {
        let text = TEXT[key];
        if (text === undefined) {
            logLine('warn', `t("${key}") has no translation — falling back to the key`);
            text = String(key);
        }
        return text.replace(/\{(\d+)\}/g, (match, index) => {
            const arg = args[Number(index)];
            return arg === undefined ? match : String(arg);
        });
    }

    // `side`, `type` and `status` reach a control in whatever spelling the
    // endpoint that produced the row used. Normalising them is the host's job —
    // this is the one place in the demo that knows what a 0 or a "SELL" means.
    const isBuy = (side) => (typeof side === 'number' ? side === Sides.Buy : String(side).trim().toUpperCase() === 'BUY');

    function normalizeType(type) {
        if (typeof type === 'number') return type;
        const name = String(type).trim().toUpperCase();
        if (name === 'MARKET') return OrderTypes.Market;
        if (name === 'CONDITIONAL' || name === 'STOP') return OrderTypes.Conditional;
        return OrderTypes.Limit;
    }

    const STATUS_TEXT = {
        [OrderStates.PendingRisk]: 'Pending',
        [OrderStates.Sent]: 'Sent',
        [OrderStates.Active]: 'Active',
        [OrderStates.PartiallyFilled]: 'Partial',
        [OrderStates.Filled]: 'Filled',
        [OrderStates.Rejected]: 'Rejected',
        [OrderStates.Cancelled]: 'Cancelled',
    };

    // The two class methods are the one place a host has to agree with the shipped
    // stylesheet, so they answer with the names the package states rather than with
    // literals typed here — see PRESENTATION_CLASSES in trading-host.ts.
    const [SIDE_BUY_CLASS, SIDE_SELL_CLASS] = PRESENTATION_CLASSES.sideClass;
    const [PNL_POSITIVE_CLASS, PNL_NEGATIVE_CLASS] = PRESENTATION_CLASSES.pnlClass;

    const presentation = {
        sideText: (side) => (isBuy(side) ? 'Buy' : 'Sell'),
        typeText: (type, limitPrice, stopPrice) => {
            const kind = normalizeType(type);
            if (kind === OrderTypes.Market) return 'MKT';
            if (kind === OrderTypes.Conditional || stopPrice) return limitPrice ? 'STP-LMT' : 'STP';
            return 'LMT';
        },
        statusText: (status) => STATUS_TEXT[status] || String(status),
        sideClass: (side) => (isBuy(side) ? SIDE_BUY_CLASS : SIDE_SELL_CLASS),
        // The empty string is a legitimate answer for "no colour" — a flat P&L is
        // neither a win nor a loss.
        pnlClass: (pnl) => (pnl > 0 ? PNL_POSITIVE_CLASS : pnl < 0 ? PNL_NEGATIVE_CLASS : ''),
    };

    // Two stores, not one, because the port keeps them apart on purpose: the
    // watchlist's per-symbol-per-day price baseline is scratch and must not be
    // written into a synced settings blob. Both are plain objects here — a page
    // reload starts clean, which is what a demo wants.
    function makeStore(name, bag) {
        return {
            get(key, fallback) {
                const value = Object.prototype.hasOwnProperty.call(bag, key) ? bag[key] : null;
                return value === null || value === undefined ? fallback : value;
            },
            set(key, value) {
                if (value === null) delete bag[key];
                else bag[key] = String(value);
                logLine('dim', `${name}.set("${key}")`);
            },
        };
    }

    const preferencesBag = Object.create(null);
    const cacheBag = Object.create(null);
    const preferences = makeStore('preferences', preferencesBag);
    const cache = makeStore('cache', cacheBag);

    // The watchlist measures its change % from the first price it sees, unless the
    // host's cache already holds today's baseline. Seeding it with the sample day
    // open is what makes the first paint show a real percentage instead of +0.00%,
    // and it exercises exactly the contract the widget documents. If the key shape
    // ever changes the seed simply misses and the first tick becomes the baseline.
    function seedBaselines() {
        const day = new Date().toISOString().slice(0, 10);
        for (const u of UNIVERSE)
            cacheBag[`${WatchlistWidget.BASELINE_KEY_PREFIX}${day}:${u.symbol}`] = String(u.dayOpen);
    }

    // The read side of the account. Both calls resolve from the arrays above after
    // a short delay — a real one crosses a network, and a control that only ever
    // saw an instant answer would hide its own loading behaviour.
    const api = {
        getExecutions(portfolioId, symbol, limit) {
            logLine('data', `api.getExecutions(portfolio ${portfolioId}, ${symbol === null ? 'every instrument' : symbol}, limit ${limit})`);
            const rows = state.trades
                .filter(t => symbol === null || t.instrumentSymbol === symbol)
                .slice(0, limit);
            return new Promise(resolve => setTimeout(() => resolve(clone(rows)), 90));
        },
        searchInstruments(query) {
            logLine('data', `api.searchInstruments("${query}")`);
            const q = String(query || '').trim().toLowerCase();
            const rows = UNIVERSE
                .filter(u => !q || u.symbol.toLowerCase().includes(q) || u.name.toLowerCase().includes(q))
                .map(u => ({ symbol: u.symbol, name: u.name, exchange: u.exchange, category: u.category }));
            return new Promise(resolve => setTimeout(() => resolve(rows), 70));
        },
    };

    // Refcounted the way the real client is: two controls watching one symbol hold
    // one subscription between them, and neither can unsubscribe the other.
    const subscriptions = new Map();

    const marketData = {
        addSymbol(symbol, level) {
            const count = (subscriptions.get(symbol) || 0) + 1;
            subscriptions.set(symbol, count);
            logLine('dim', `marketData.addSymbol("${symbol}", "${level}") — refcount ${count}`);
            return Promise.resolve(true);
        },
        removeSymbol(symbol) {
            const count = Math.max(0, (subscriptions.get(symbol) || 0) - 1);
            if (count === 0) subscriptions.delete(symbol);
            else subscriptions.set(symbol, count);
            logLine('dim', `marketData.removeSymbol("${symbol}") — refcount ${count}`);
            return Promise.resolve(true);
        },
        resubscribe(symbol, level) {
            logLine('dim', `marketData.resubscribe("${symbol}", "${level}")`);
            return Promise.resolve();
        },
        getOrders: () => clone(state.orders),
    };

    // ---------------------------------------------------------- control registry

    // The host's handle on live instances. Keyed by control kind, because
    // `broadcast` means "every live control of this kind" — the watchlist uses it
    // to fan a favourites change to its siblings.
    const registry = new Map();
    const live = new Map();

    function makeHost(kind) {
        if (!registry.has(kind)) registry.set(kind, new Set());
        const peers = registry.get(kind);
        // One instance per kind speaks for the page. Nothing is on screen for this
        // kind when the host is built, so this one is it.
        const isPrimary = peers.size === 0;

        return {
            isPrimary,
            t: translate,
            presentation,
            preferences,
            cache,
            trading: {
                api,
                marketData,
                portfolioId: () => PORTFOLIO_ID,
                // Host-owned UI. None of the four shipped controls calls it (the
                // order book and the order entry pad do), so the demo logs the
                // request and picks nothing — a stub is the documented answer for
                // an adopter that takes only these four.
                pickInstrument: () => logLine('warn', `${kind}: trading.pickInstrument() — this demo has no picker, nothing was chosen`),
            },
            ticker: {
                publish(symbols, stats) {
                    logLine('dim', `ticker.publish(${symbols.length} visible symbols)`);
                    renderTicker(symbols, stats);
                },
            },
            allow(action) {
                logLine('dim', `allow("${action}") — granted`);
                return true;
            },
            log: (message) => logLine('warn', `log: ${message}`),
            close: () => closePanel(kind),
            // Uncalled by these four controls; the port requires them anyway
            // because the three controls still on the terminal's side call them.
            spawn: (panelState) => logLine('act', `${kind}: spawn(${JSON.stringify(panelState)}) — this demo hosts one panel per kind`),
            persistState: (patch) => logLine('dim', `${kind}: persistState(${JSON.stringify(patch)})`),
            saveLayout: () => logLine('dim', `${kind}: saveLayout()`),
            register(control) {
                peers.add(control);
                logLine('dim', `register(${kind}) — ${peers.size} live`);
            },
            unregister(control) {
                peers.delete(control);
                logLine('dim', `unregister(${kind}) — ${peers.size} live`);
            },
            broadcast(apply) {
                for (const control of Array.from(peers)) apply(control);
            },
        };
    }

    // ------------------------------------------------------------- book-keeping

    function markToMarket(position) {
        const u = universeOf(position.instrument);
        if (u) {
            position.currentPrice = u.price;
            position.unrealizedPnl = (u.price - position.avgPrice) * position.quantity;
        }
        return position;
    }

    function addExecution(symbol, side, quantity, price, orderId) {
        state.trades.unshift({
            id: state.nextTradeId++,
            executedAt: new Date().toISOString(),
            instrumentSymbol: symbol,
            side,
            quantity,
            price,
            order: orderId,
        });
        // The blotter reloads through the port rather than being handed a row:
        // its only data source is `api.getExecutions`, which now returns this fill.
        const history = live.get(ControlTypes.TradeHistory);
        if (history) void history.refresh();
    }

    // Apply a fill to the portfolio and push the resulting row into the blotter.
    // Averaging up on the same side, realizing P&L when the fill reduces — the
    // position row a control renders has to come from somewhere, and a demo that
    // just made numbers up would show a P&L that contradicts its own trade list.
    function applyFill(symbol, buy, quantity, price) {
        const u = universeOf(symbol);
        const signed = buy ? quantity : -quantity;
        let position = state.positions.find(p => p.instrument === symbol);

        if (!position) {
            position = {
                portfolioId: PORTFOLIO_ID, instrumentId: u ? u.id : null, instrument: symbol,
                quantity: 0, avgPrice: price, realizedPnl: 0,
            };
            state.positions.push(position);
        }

        const oldQty = position.quantity || 0;
        const newQty = oldQty + signed;

        if (oldQty === 0 || Math.sign(oldQty) === Math.sign(signed)) {
            position.avgPrice = (Math.abs(oldQty) * position.avgPrice + quantity * price) / (Math.abs(oldQty) + quantity);
        } else {
            const closed = Math.min(Math.abs(oldQty), quantity);
            position.realizedPnl = (position.realizedPnl || 0) + (price - position.avgPrice) * closed * Math.sign(oldQty);
            if (newQty !== 0 && Math.sign(newQty) !== Math.sign(oldQty)) position.avgPrice = price;
        }

        position.quantity = newQty;
        markToMarket(position);

        const positions = live.get(ControlTypes.Positions);
        if (newQty === 0) {
            state.positions = state.positions.filter(p => p !== position);
            // Quantity zero is how a delta says "closed" — the blotter drops the row.
            if (positions) positions.applyDelta({ ...position, quantity: 0 });
        } else if (positions) {
            positions.applyDelta(clone(position));
        }
    }

    function updateOrder(orderId, patch) {
        const order = state.orders.find(o => o.id === orderId);
        if (order) Object.assign(order, patch);
        const orders = live.get(ControlTypes.ActiveOrders);
        if (orders) orders.applyDelta({ id: orderId, ...patch });
        return order;
    }

    function fillOrder(order, price) {
        const quantity = order.balance != null ? order.balance : order.quantity;
        const buy = isBuy(order.side);
        updateOrder(order.id, { status: OrderStates.Filled, balance: 0 });
        addExecution(order.instrument, order.side, quantity, price, order.id);
        applyFill(order.instrument, buy, quantity, price);
        logLine(buy ? 'up' : 'down',
            `fill: #${order.localId} ${presentation.sideText(order.side)} ${quantity} ${order.instrument} @ ${price} — order filled, execution added, position updated`);
    }

    // A resting order the market reached. Limit fills at its own price; a
    // conditional triggers on the stop and fills at its limit when it carries one.
    function checkFill(order) {
        if (order.status !== OrderStates.Active) return;
        const u = universeOf(order.instrument);
        if (!u) return;
        const buy = isBuy(order.side);
        const kind = normalizeType(order.type);

        if (kind === OrderTypes.Limit && order.limitPrice) {
            if (buy ? u.price <= order.limitPrice : u.price >= order.limitPrice) fillOrder(order, order.limitPrice);
            return;
        }
        if (kind === OrderTypes.Conditional && order.stopPrice) {
            const triggered = buy ? u.price >= order.stopPrice : u.price <= order.stopPrice;
            if (triggered) fillOrder(order, order.limitPrice || u.price);
        }
    }

    // ------------------------------------------------------------------- panels

    function pushPrices() {
        const watchlist = live.get(ControlTypes.Watchlist);
        if (!watchlist) return;
        for (const u of UNIVERSE) watchlist.onPriceUpdate(u.symbol, u.price);
    }

    function createWatchlist(hostEl) {
        const widget = WatchlistWidget.create(hostEl, {}, {
            host: makeHost(ControlTypes.Watchlist),
            // The panel does not switch the page's instrument itself: it reports
            // what the user chose and the host acts.
            onSelect: (symbol) => {
                widget.setCurrentSymbol(symbol);
                logLine('act', `watchlist.onSelect("${symbol}") — host highlighted the row`);
            },
        });
        return widget;
    }

    function createPositions(hostEl) {
        const widget = PositionsWidget.create(hostEl, {}, {
            host: makeHost(ControlTypes.Positions),
            closePosition: (portfolioId, instrumentId, symbol) => {
                const position = state.positions.find(p => p.instrument === symbol);
                if (!position) return;
                logLine('act', `closePosition(${portfolioId}, ${instrumentId}, "${symbol}") — flattening at the last price`);
                const u = universeOf(symbol);
                addExecution(symbol, position.quantity > 0 ? Sides.Sell : Sides.Buy, Math.abs(position.quantity), u.price, state.nextOrderId++);
                applyFill(symbol, position.quantity < 0, Math.abs(position.quantity), u.price);
            },
            reversePosition: (portfolioId, instrumentId, symbol) => {
                const position = state.positions.find(p => p.instrument === symbol);
                if (!position) return;
                logLine('act', `reversePosition(${portfolioId}, ${instrumentId}, "${symbol}") — trading twice the size the other way`);
                const u = universeOf(symbol);
                const quantity = Math.abs(position.quantity) * 2;
                addExecution(symbol, position.quantity > 0 ? Sides.Sell : Sides.Buy, quantity, u.price, state.nextOrderId++);
                applyFill(symbol, position.quantity < 0, quantity, u.price);
            },
            refreshPositions: () => {
                logLine('act', 'refreshPositions() — host re-pushed its snapshot');
                widget.update(clone(state.positions.map(markToMarket)));
                widget.updateBalance(clone(state.balance));
            },
        });
        widget.update(clone(state.positions.map(markToMarket)));
        widget.updateBalance(clone(state.balance));
        return widget;
    }

    function createOrders(hostEl) {
        const widget = ActiveOrdersWidget.create(hostEl, {}, {
            host: makeHost(ControlTypes.ActiveOrders),
            cancelOrder: (orderId) => {
                logLine('act', `cancelOrder(${orderId}) — venue acknowledged`);
                updateOrder(orderId, { status: OrderStates.Cancelled });
            },
            // Nothing left to cancel on a terminal row: the × drops it locally.
            dismissOrder: (orderId) => {
                logLine('act', `dismissOrder(${orderId}) — removed from the local view only`);
                state.orders = state.orders.filter(o => o.id !== orderId);
                widget.removeOrder(orderId);
            },
            // The double-click on an editable cell reaches the host, and the host
            // asks the control to open its editor. The control owns the input; the
            // host owns the decision that editing is allowed.
            editOrderField: (orderId, field) => {
                logLine('act', `editOrderField(${orderId}, "${field}") — host opened the inline editor`);
                widget.startInlineEdit(orderId, field);
            },
            replaceOrder: (orderId, quantity, limitPrice, stopPrice) => {
                logLine('act', `replaceOrder(${orderId}, qty ${quantity}, limit ${limitPrice}, stop ${stopPrice})`);
                updateOrder(orderId, { quantity, balance: quantity, limitPrice, stopPrice });
            },
            cancelAllOrders: () => {
                const activeIds = state.orders.filter(o => o.status === OrderStates.Active).map(o => o.id);
                logLine('act', `cancelAllOrders() — ${activeIds.length} resting order(s)`);
                for (const id of activeIds) updateOrder(id, { status: OrderStates.Cancelled });
            },
            refreshOrders: () => {
                logLine('act', 'refreshOrders() — host re-pushed its snapshot');
                widget.update(clone(state.orders));
            },
        });
        widget.update(clone(state.orders));
        return widget;
    }

    function createHistory(hostEl) {
        const widget = TradeHistoryWidget.create(hostEl, {}, { host: makeHost(ControlTypes.TradeHistory) });
        // The blotter loads on demand, not on construction — the first load is the
        // host's call, exactly like the refresh button's.
        void widget.refresh();
        return widget;
    }

    const PANELS = {
        [ControlTypes.Watchlist]: { hostId: 'watchlistHost', label: 'watchlist', create: createWatchlist },
        [ControlTypes.Positions]: { hostId: 'positionsHost', label: 'positions', create: createPositions },
        [ControlTypes.ActiveOrders]: { hostId: 'ordersHost', label: 'active orders', create: createOrders },
        [ControlTypes.TradeHistory]: { hostId: 'historyHost', label: 'trade history', create: createHistory },
    };

    function openPanel(kind) {
        const panel = PANELS[kind];
        const hostEl = document.getElementById(panel.hostId);
        hostEl.textContent = '';
        live.set(kind, panel.create(hostEl));
        if (kind === ControlTypes.Watchlist) pushPrices();
    }

    // `host.close()` — the panel's × asked to go away. The watchlist and the trade
    // history dispose themselves first and the other two leave it to the host, so
    // disposing here is unconditional (a second dispose is a no-op).
    function closePanel(kind) {
        const panel = PANELS[kind];
        const control = live.get(kind);
        if (control) control.dispose();
        live.delete(kind);
        logLine('act', `close() — the ${panel.label} panel asked the host to remove it`);

        const hostEl = document.getElementById(panel.hostId);
        hostEl.textContent = '';
        const placeholder = document.createElement('div');
        placeholder.className = 'cell-closed';
        placeholder.appendChild(document.createTextNode(`The ${panel.label} panel closed itself through the host port.`));
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'tbtn';
        button.textContent = `Create it again`;
        button.addEventListener('click', () => openPanel(kind));
        placeholder.appendChild(button);
        hostEl.appendChild(placeholder);
    }

    // -------------------------------------------------------------------- ticks

    // One simulated market tick: nudge every price, feed the watchlist, mark the
    // positions to market, and let any resting order the market reached fill.
    function tick() {
        for (const u of UNIVERSE) {
            const drift = (Math.random() - 0.5) * 2 * u.vol;
            u.price = Number((u.price * (1 + drift)).toFixed(u.dp));
        }
        pushPrices();

        const positions = live.get(ControlTypes.Positions);
        if (positions) positions.update(clone(state.positions.map(markToMarket)));

        for (const order of Array.from(state.orders)) checkFill(order);
    }

    let autoTimer = null;

    function toggleAuto(button) {
        if (autoTimer) {
            clearInterval(autoTimer);
            autoTimer = null;
            button.classList.remove('on');
            logLine('act', 'auto ticks stopped');
            return;
        }
        autoTimer = setInterval(tick, 1200);
        button.classList.add('on');
        logLine('act', 'auto ticks started — one tick every 1.2s');
    }

    // ------------------------------------------------------------------ startup

    resetState();
    seedBaselines();
    for (const kind of Object.keys(PANELS)) openPanel(kind);

    document.getElementById('tickBtn').addEventListener('click', tick);
    document.getElementById('autoBtn').addEventListener('click', (e) => toggleAuto(e.currentTarget));
    document.getElementById('clearLogBtn').addEventListener('click', () => { logEl.textContent = ''; });

    document.getElementById('resetBtn').addEventListener('click', () => {
        resetState();
        logLine('act', 'reset — sample prices, positions, orders and fills restored');
        pushPrices();
        const positions = live.get(ControlTypes.Positions);
        if (positions) {
            positions.update(clone(state.positions));
            positions.updateBalance(clone(state.balance));
        }
        const orders = live.get(ControlTypes.ActiveOrders);
        if (orders) orders.update(clone(state.orders));
        const history = live.get(ControlTypes.TradeHistory);
        if (history) void history.refresh();
    });

    // The package's own theme.css keys its light palette off `data-bs-theme`, and
    // demo.css re-declares the same tokens under the same attribute — one switch
    // moves the page and every panel on it.
    document.getElementById('themeBtn').addEventListener('click', (e) => {
        const root = document.documentElement;
        const light = root.getAttribute('data-bs-theme') === 'light';
        root.setAttribute('data-bs-theme', light ? 'dark' : 'light');
        e.currentTarget.innerHTML = light ? '&#9788; Light' : '&#9789; Dark';
    });

    logLine('act', 'demo host ready — four controls created over one TradingHost each');
})();
