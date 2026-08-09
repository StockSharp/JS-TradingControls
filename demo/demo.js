// Demo harness for @stocksharp/trading-controls.
//
// ---------------------------------------------------------------------------
// THE HOST HERE IS A DEMO STAND-IN.
//
// `TradingHost` is the whole API surface of this package: a control imports no
// translator, no settings singleton, no panel registry and no socket, and every
// control asserts the port is complete (`assertHost`) before it renders. The
// real implementation of that port lives in the StockSharp web terminal these
// controls were extracted from — the page that owns the docking manager, the
// translation dictionary, the user's synced settings, the market-data socket
// and the trading API client.
//
// What follows implements the same port honestly against sample data: `t()`
// answers from a dictionary and says so in the log when a key is missing, the
// two stores are plain objects, `allow()` grants everything, and the API and
// market-data calls resolve from the arrays below instead of reaching a
// network. Nothing on this page is drawn by hand — every table, button, tab and
// inline edit comes out of the package.
//
// The page itself is laid out by dockview-core — the same docking library the
// StockSharp web terminal runs — and the chart panel is @stocksharp/chart, so
// this demo is assembled the way the terminal is: every panel is a dockview
// panel, its chrome is the dockview tab, and the control's own header row is
// lifted into that tab (the controls' markup documents `.panel-header` as
// designed for exactly this lift).
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
        OrderEntryWidget,
        OrderEntrySides,
        TradeFeedWidget,
        OrderBookWidget,
        MarketDataLevels,
        PRESENTATION_CLASSES,
    } = window.SSTradingControls;

    // dockview-core's UMD build registers under its package name.
    const DV = window['dockview-core'];

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

    // The log lives in a dockview panel that may not be mounted yet (or may be
    // closed), so the element exists up front and the panel adopts it — lines
    // logged while it is offscreen are simply there when it comes back.
    const logEl = document.createElement('div');
    logEl.className = 'log';

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

    // The instrument picker `trading.pickInstrument` puts on screen. It belongs
    // to the host on purpose: a control that opened its own would have to know
    // what this page's dialogs look like, and would have to fetch the universe
    // itself. Dismissing it calls nothing back, which is the contract — the
    // control learns what was chosen, and learns nothing when nothing was.
    function pickInstrument(kind, onPicked) {
        logLine('act', `${kind}: trading.pickInstrument() — the host opened its picker`);

        const overlay = document.createElement('div');
        overlay.className = 'picker';

        const sheet = document.createElement('div');
        sheet.className = 'picker-sheet';
        const title = document.createElement('div');
        title.className = 'picker-title';
        title.textContent = 'Pick an instrument';
        sheet.appendChild(title);

        const close = () => overlay.remove();
        for (const instrument of UNIVERSE) {
            const option = document.createElement('button');
            option.type = 'button';
            option.className = 'picker-option';
            option.textContent = `${instrument.symbol} — ${instrument.name}`;
            option.addEventListener('click', () => {
                close();
                logLine('act', `${kind}: picked ${instrument.symbol}`);
                onPicked(instrument.symbol);
            });
            sheet.appendChild(option);
        }

        const dismiss = document.createElement('button');
        dismiss.type = 'button';
        dismiss.className = 'tbtn picker-dismiss';
        dismiss.textContent = 'Dismiss';
        dismiss.addEventListener('click', () => {
            close();
            logLine('dim', `${kind}: the picker was dismissed — the control was told nothing`);
        });
        sheet.appendChild(dismiss);

        overlay.appendChild(sheet);
        document.body.appendChild(overlay);
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

        // Order entry: the form's captions, the letters of the two keyboard
        // shortcuts (the badge on each submit button is a translated string
        // because the shortcut belongs to the host), and the wording of every
        // rule the pad enforces.
        'Amount': 'Amount',
        'Avbl': 'Avbl',
        'BBO': 'BBO',
        'BestBidOrOffer': 'Best bid or offer',
        'BuyHotkey': 'B',
        'Limit': 'Limit',
        'Limit price must be a multiple of {0}': 'Limit price must be a multiple of {0}',
        'Limit price must be positive': 'Limit price must be positive',
        'Market': 'Market',
        'Max Buy': 'Max buy',
        'Max Sell': 'Max sell',
        'OrderEntry': 'Order entry',
        'OrderQuantity': 'Order quantity',
        'OrderType': 'Order type',
        'PercentageOfBalance': 'Percentage of balance',
        'Quantity must be <= {0}': 'Quantity must be <= {0}',
        'Quantity must be >= {0}': 'Quantity must be >= {0}',
        'Quantity must be a multiple of {0}': 'Quantity must be a multiple of {0}',
        'Quantity must be positive': 'Quantity must be positive',
        'SellHotkey': 'S',
        'StopLimit': 'Stop limit',
        'StopLoss': 'Stop loss',
        'StopPrice': 'Stop price',
        'Stop price must be a multiple of {0}': 'Stop price must be a multiple of {0}',
        'Stop price must be positive': 'Stop price must be positive',
        'TakeProfit': 'Take profit',
        'Total': 'Total',
        'TpSl': 'TP / SL',

        // Trade feed: the panel chrome, the two tabs, the two renderings, and
        // the bubble tooltip's rows — which read "VWAP" and "Total qty" once a
        // bubble stands for more than one print.
        'Add trade feed': 'Add trade feed',
        'AddInstrument': 'Add instrument',
        'BubbleChart': 'Bubble chart',
        'ExtraInstruments': 'Extra instruments',
        'ListView': 'List',
        'MarketTrades': 'Market trades',
        'My trades': 'My trades',
        'No trades yet': 'No trades yet',
        'Remove': 'Remove',
        'Total qty': 'Total qty',
        'Trade feed tabs': 'Trade feed tabs',
        'TradeFeed': 'Trade feed',
        'TradeFeedView': 'Trade feed view',
        'Trades': 'Trades',
        'VWAP': 'VWAP',

        // Order book: the header's settings, the labels a screen reader reads
        // the three regions by, and the two letters the sentiment strip has room
        // for — short enough that only a translator can decide what they should
        // be in another language, which is why they come through `t()` too.
        'AddOrderbook': 'Add order book',
        'AskOrders': 'Ask orders',
        'AskShort': 'S',
        'BidOrders': 'Bid orders',
        'BidShort': 'B',
        'ClickToChangeSymbol': 'Click to change the instrument',
        'LevelsCount': '{0} levels',
        'MidPrice': 'Mid price',
        'OrderBook': 'Order book',
        'OrderBookDepth': 'Order book depth',
        'OrderBookInvertSides': 'Put bids on top',
        'OrderBookSentiment': 'Buy versus sell',
        'OrderBookView': 'Order book layout',
        'OrderBookViewDiagonal': 'Two-sided layout',
        'OrderBookViewStacked': 'Price, size and total',
        'RemoveOrderbook': 'Remove this order book',
        'Spread: {0}': 'Spread: {0}',
        'ToggleDepthChart': 'Show the depth chart',
        'YourOrder': 'Your order',
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

    // The colours a control paints with directly. A class name cannot reach a
    // canvas, so this host answers with the very tokens its stylesheet paints
    // from, read off the document — which is why the depth curve follows the
    // theme button at the top of the page. The literals are what a page that
    // loaded no theme at all would get.
    function canvasPalette() {
        const styles = getComputedStyle(document.documentElement);
        const token = (name, absent) => (styles.getPropertyValue(name) || '').trim() || absent;
        return {
            up: token('--t-green', '#0ecb81'),
            down: token('--t-red', '#f6465d'),
            grid: token('--t-text-dim', '#848e9c'),
            font: `10px ${token('--t-mono', 'monospace')}`,
        };
    }

    const presentation = {
        sideText: (side) => (isBuy(side) ? 'Buy' : 'Sell'),
        // The predicate behind the two above: which of `0`, `"Buy"` and `"BUY"`
        // means a buy is this host's knowledge, not any control's.
        isBuy,
        canvasPalette,
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
            // A subscription that asked for the depth is answered with a
            // snapshot, which is what makes the diffs after it mean anything.
            // On a timer because a real one crosses a network, and because a
            // control subscribes from inside its own constructor.
            if (level === MarketDataLevels.Full) setTimeout(() => sendBookSnapshot(symbol), 60);
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
            logLine('dim', `marketData.resubscribe("${symbol}", "${level}") — resending the book from scratch`);
            // What a resubscribe is FOR: the ladder lost its place in the
            // sequence and cannot trust another diff, so the only useful answer
            // is a fresh snapshot.
            sendBookSnapshot(symbol);
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
                // Host-owned UI: the control asks, the host puts a picker on
                // screen, and the control learns only what was chosen — nothing
                // at all if the user dismisses it.
                pickInstrument: (onPicked) => pickInstrument(kind, onPicked),
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
            // The panel's × (in the dockview tab) and this call end in the same
            // place: the panel leaves the dock and the renderer disposes the
            // widget.
            close: () => closeDockPanel(kind),
            // Uncalled by the four blotters; the port requires them anyway
            // because the terminal's other controls call them.
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

    // ------------------------------------------------------------- order books

    // A book per symbol, kept HERE rather than in the ladder: the control holds
    // only what the frames it received add up to, which is the whole point of a
    // snapshot-then-diff protocol and the reason a missed frame has to be
    // recoverable. Everything below is what a server would be doing.
    const books = new Map();

    const BOOK_LEVELS = 12;
    // One frame in this many carries a sequence number one higher than it should
    // — the gap a real feed produces when a message is dropped. The ladder
    // notices, says so through `host.log`, and asks for a new snapshot rather
    // than applying a diff to a book it can no longer trust.
    const FRAMES_PER_GAP = 9;

    const level = (price, dp) => Number(price.toFixed(dp));
    const size = () => Number((0.4 + Math.random() * 6).toFixed(2));

    function makeBook(symbol) {
        const u = universeOf(symbol);
        if (!u) return null;
        const tick = Math.max(Number((u.price * 0.0004).toFixed(u.dp)), Math.pow(10, -u.dp));
        // Rebuilding a book does not restart its sequence: a feed keeps counting
        // whatever it decides to send, and the ladder's gap check is what that
        // number is for.
        const previous = books.get(symbol);
        const book = {
            symbol, tick, dp: u.dp, bids: new Map(), asks: new Map(),
            sequence: previous ? previous.sequence : 0,
            frames: previous ? previous.frames : 0,
        };
        for (let i = 1; i <= BOOK_LEVELS; i++) {
            book.bids.set(level(u.price - tick * i, u.dp), size());
            book.asks.set(level(u.price + tick * i, u.dp), size());
        }
        books.set(symbol, book);
        return book;
    }

    function bookOf(symbol) {
        return books.get(symbol) || makeBook(symbol);
    }

    // Every live ladder gets every frame and drops the ones for symbols it is not
    // watching. It goes through the registry rather than through the reference
    // that built the panel, because that is the fan-out a real host does — and
    // because a ladder subscribes from inside its own constructor, before
    // anything outside has a handle on it.
    function deliverFrame(frame) {
        for (const ladder of registry.get(ControlTypes.OrderBook) || []) ladder.applyFrame(frame);
    }

    function sendBookSnapshot(symbol) {
        const book = bookOf(symbol);
        if (!book) return;
        book.sequence += 1;
        deliverFrame({
            symbol,
            sequence: book.sequence,
            isSnapshot: true,
            bids: [...book.bids].map(([price, quantity]) => ({ price, quantity })),
            asks: [...book.asks].map(([price, quantity]) => ({ price, quantity })),
        });
    }

    // One diff: three levels resize, one is taken out (quantity zero, which is
    // how a delete travels) and one appears a tick beyond the far edge, so the
    // side keeps its depth while its shape changes.
    function sendBookDiff(symbol) {
        const book = bookOf(symbol);
        if (!book) return;
        const bids = [];
        const asks = [];

        for (const [side, changes] of [[book.bids, bids], [book.asks, asks]]) {
            const step = side === book.bids ? -book.tick : book.tick;
            const prices = [...side.keys()];
            for (let i = 0; i < 3; i++) {
                const price = prices[Math.floor(Math.random() * prices.length)];
                const quantity = size();
                side.set(price, quantity);
                changes.push({ price, quantity });
            }

            const gone = prices[Math.floor(Math.random() * prices.length)];
            side.delete(gone);
            changes.push({ price: gone, quantity: 0 });

            // The far edge is the lowest bid or the highest ask, whichever side
            // this is — which is what `step` already says.
            const far = prices.reduce((worst, price) => ((price - worst) * step > 0 ? price : worst), prices[0]);
            const edge = level(far + step, book.dp);
            const quantity = size();
            side.set(edge, quantity);
            changes.push({ price: edge, quantity });
        }

        book.frames += 1;
        book.sequence += book.frames % FRAMES_PER_GAP === 0 ? 2 : 1;
        if (book.frames % FRAMES_PER_GAP === 0)
            logLine('warn', `feed: dropping a frame for ${symbol} on purpose — the next one skips a sequence number`);

        deliverFrame({ symbol, sequence: book.sequence, isSnapshot: false, bids, asks });
    }

    // How far the last print may wander from the book's touch before the diffs
    // stop making sense and the feed rebuilds the book around the new price.
    const REBUILD_AFTER_TICKS = 8;

    function pushBookFrames() {
        const orderBook = live.get(ControlTypes.OrderBook);
        if (!orderBook) return;
        const symbol = orderBook.getSymbol();
        if (!symbol) return;

        const book = bookOf(symbol);
        const u = universeOf(symbol);
        if (!book || !u) return;
        const touch = (Math.max(...book.bids.keys()) + Math.min(...book.asks.keys())) / 2;
        if (Math.abs(u.price - touch) > book.tick * REBUILD_AFTER_TICKS) {
            makeBook(symbol);
            sendBookSnapshot(symbol);
            return;
        }
        sendBookDiff(symbol);
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

    // The venue grid the order pad sizes and prices against. One instrument in
    // this demo; a terminal re-states it whenever the page's symbol changes.
    const ORDER_ENTRY_SPEC = { symbol: 'BTC@IMEX', lotSize: 0.001, tickSize: 0.1, minVolume: 0.001, maxVolume: 5 };

    // The pad has no data source of its own, so everything it shows is pushed:
    // the reference prices, the cash it may commit and the size the percent
    // buttons take a percentage of.
    function pushOrderEntry() {
        const pad = live.get(ControlTypes.OrderEntry);
        if (!pad) return;
        const u = universeOf(ORDER_ENTRY_SPEC.symbol);
        if (!u) return;

        // A demo spread of one tick either side of the last print.
        pad.setLimitPrice(u.price);
        pad.setBbo(
            Number((u.price - ORDER_ENTRY_SPEC.tickSize).toFixed(u.dp)),
            Number((u.price + ORDER_ENTRY_SPEC.tickSize).toFixed(u.dp)));

        const cash = (state.balance && state.balance.available) || 0;
        pad.setAvailable(OrderEntrySides.Buy, cash);
        pad.setMaxQuantity(OrderEntrySides.Buy, Math.floor((cash / u.price) * 1000) / 1000);

        // Selling is capped by what is actually held, which is why the two sides
        // are set separately rather than sharing one number.
        const position = state.positions.find(p => p.instrument === ORDER_ENTRY_SPEC.symbol);
        const size = position ? Math.abs(position.quantity) : 0;
        pad.setAvailable(OrderEntrySides.Sell, size * u.price);
        pad.setMaxQuantity(OrderEntrySides.Sell, size);
    }

    function createOrderEntry(hostEl) {
        const widget = OrderEntryWidget.create(hostEl, {}, {
            host: makeHost(ControlTypes.OrderEntry),
            // The pad validated the form and collected it; sending is the host's
            // half, and this is what proves the dep exists. A market order fills
            // against the last print, anything else rests in the demo's own book
            // until the tick loop reaches it — so a form on this panel becomes a
            // row on the active-orders panel next to it.
            submitOrder: (side, values) => {
                const buy = side === OrderEntrySides.Buy;
                const u = universeOf(ORDER_ENTRY_SPEC.symbol);
                const apiType = OrderEntryWidget.toApiType(values.type);
                const at = values.limitPrice != null ? ` @ ${values.limitPrice}` : '';
                logLine('act', `submitOrder("${side}", ${values.type} ${values.quantity} ${ORDER_ENTRY_SPEC.symbol}${at})`);

                const id = state.nextOrderId++;
                if (apiType === OrderTypes.Market) {
                    addExecution(ORDER_ENTRY_SPEC.symbol, buy ? Sides.Buy : Sides.Sell, values.quantity, u.price, id);
                    applyFill(ORDER_ENTRY_SPEC.symbol, buy, values.quantity, u.price);
                    pushOrderEntry();
                    return;
                }

                state.orders.unshift({
                    id,
                    localId: Math.max(0, ...state.orders.map(o => o.localId || 0)) + 1,
                    instrument: ORDER_ENTRY_SPEC.symbol,
                    side: buy ? Sides.Buy : Sides.Sell,
                    type: apiType,
                    quantity: values.quantity,
                    balance: values.quantity,
                    limitPrice: values.limitPrice,
                    stopPrice: values.stopPrice,
                    status: OrderStates.Active,
                });
                const orders = live.get(ControlTypes.ActiveOrders);
                if (orders) orders.update(clone(state.orders));
            },
        });
        widget.setInstrument(clone(ORDER_ENTRY_SPEC));
        return widget;
    }

    // The ladder starts on the same instrument the order pad quotes, so a click
    // on a level lands in a form that is already on that symbol.
    const BOOK_SYMBOL = 'BTC@IMEX';

    function createOrderBook(hostEl) {
        const widget = OrderBookWidget.create(hostEl, { followsActive: true }, {
            host: makeHost(ControlTypes.OrderBook),
            // A plain click prefills a price, and that is all: the ladder reports
            // the level and the side, the host decides what to do with it.
            onPriceSelected: (price, side) => {
                logLine('act', `onPriceSelected(${price}, ${side}) — prefilling the order pad`);
                const pad = live.get(ControlTypes.OrderEntry);
                if (pad) {
                    pad.preselect(side === Sides.Buy ? OrderEntrySides.Buy : OrderEntrySides.Sell);
                    pad.setLimitPrice(price);
                }
            },
            // Ctrl-click sends at that price. It rests in the demo's own order
            // list, so the ladder's badge and the active-orders panel both show
            // it on the next frame.
            onPriceExecuted: (price, side) => {
                const buy = side === Sides.Buy;
                const quantity = size();
                logLine('act', `onPriceExecuted(${price}, ${side}) — resting ${quantity} ${buy ? 'bid' : 'offer'}`);
                state.orders.unshift({
                    id: state.nextOrderId++,
                    localId: Math.max(0, ...state.orders.map(o => o.localId || 0)) + 1,
                    instrument: widget.getSymbol(),
                    side: buy ? Sides.Buy : Sides.Sell,
                    type: OrderTypes.Limit,
                    quantity,
                    balance: quantity,
                    limitPrice: price,
                    stopPrice: null,
                    status: OrderStates.Active,
                });
                const orders = live.get(ControlTypes.ActiveOrders);
                if (orders) orders.update(clone(state.orders));
            },
            // The two measurements the control refuses to read off `window`
            // itself. A phone gets half the levels, and the curve is drawn at the
            // screen's real resolution.
            maxDepth: () => (window.matchMedia('(max-width: 768px), (max-height: 500px)').matches ? 5 : 10),
            pixelRatio: () => window.devicePixelRatio || 1,
        });
        // The host drives the symbol, exactly as a terminal drives its
        // follows-active ladder. The first snapshot arrives through the host's
        // fan-out once the subscription lands, not through this reference.
        widget.setSymbol(BOOK_SYMBOL);
        return widget;
    }

    // The instrument the page is "showing". The feed accepts prints for it
    // without it being pinned, exactly as a terminal's active symbol does.
    const FEED_SYMBOL = 'BTC@IMEX';

    // What the tape has already seen per symbol, so a print can say which way
    // the price went. Held here rather than in `tick` because it is the tape's
    // book-keeping, not the simulation's.
    const lastTapePrice = new Map();

    // A price move is a print somebody made. Every symbol prints on every tick;
    // the feed filters by the symbols it watches itself — that is why pinning
    // an extra starts showing prints without the demo being told anything.
    function pushTape() {
        const feed = live.get(ControlTypes.TradeFeed);
        for (const u of UNIVERSE) {
            const previous = lastTapePrice.get(u.symbol);
            lastTapePrice.set(u.symbol, u.price);
            if (!feed) continue;
            const buy = previous === undefined ? Math.random() < 0.5 : u.price >= previous;
            feed.addTrade({
                symbol: u.symbol,
                side: buy ? Sides.Buy : Sides.Sell,
                price: u.price,
                quantity: Number((Math.random() * 3 + 0.05).toFixed(3)),
                time: new Date().toISOString(),
            });
        }
    }

    // Enough history for the bubble chart to have something to compact — a feed
    // opened onto an empty tape looks broken rather than quiet.
    function seedTape(symbol) {
        const u = universeOf(symbol);
        const prints = [];
        for (let i = 0; i < 120; i++) {
            const drift = (Math.random() - 0.5) * 2 * u.vol * 8;
            prints.push({
                symbol,
                side: drift >= 0 ? Sides.Buy : Sides.Sell,
                price: Number((u.price * (1 + drift)).toFixed(u.dp)),
                quantity: Number((Math.random() * 3 + 0.05).toFixed(3)),
                time: new Date(Date.now() - i * 1500).toISOString(),
            });
        }
        return prints;
    }

    function createTradeFeed(hostEl) {
        const widget = TradeFeedWidget.create(hostEl, {}, { host: makeHost(ControlTypes.TradeFeed) });
        // Two pushes, because they are two things the host knows and the panel
        // does not: which symbol the page is on, and what has printed so far.
        widget.setActiveSymbol(FEED_SYMBOL);
        widget.setTrades(seedTape(FEED_SYMBOL));
        return widget;
    }

    // -------------------------------------------------------------- chart panel

    // The chart is @stocksharp/chart — the engine the terminal's chart panel
    // runs — fed by the same price simulation the rest of this page ticks on.
    // Ten-second bars, so the auto-tick loop visibly builds candles instead of
    // nudging one bar for five minutes.
    const CHART_TF = 10;
    const CHART_BARS = 240;

    let chartPanel = null;

    // The library paints from explicit colour strings, not CSS variables, so the
    // host reads its own tokens and hands them over — and does it again when the
    // theme flips.
    function chartColors() {
        const styles = getComputedStyle(document.documentElement);
        const token = (name, absent) => (styles.getPropertyValue(name) || '').trim() || absent;
        return {
            bg: token('--t-panel', '#131820'),
            text: token('--t-text-dim', '#6b7a8d'),
            grid: token('--t-border', '#2a3546'),
            up: token('--t-green', '#26a69a'),
            down: token('--t-red', '#ef5350'),
            mono: token('--t-mono', 'monospace'),
        };
    }

    function candleColors(colors) {
        return {
            upColor: colors.up, downColor: colors.down,
            borderUpColor: colors.up, borderDownColor: colors.down,
            wickUpColor: colors.up, wickDownColor: colors.down,
        };
    }

    // A random walk backwards from the current price, so history ends exactly
    // where the live simulation starts. `time` is Unix seconds, ascending.
    function seedChartData() {
        const u = universeOf(BOOK_SYMBOL);
        const nowBar = Math.floor(Date.now() / 1000 / CHART_TF) * CHART_TF;
        const bars = [];
        let close = u.price;
        for (let i = 0; i < CHART_BARS; i++) {
            const drift = (Math.random() - 0.5) * 2 * u.vol * 3;
            const open = Number((close * (1 - drift)).toFixed(u.dp));
            const high = Number((Math.max(open, close) * (1 + Math.random() * u.vol)).toFixed(u.dp));
            const low = Number((Math.min(open, close) * (1 - Math.random() * u.vol)).toFixed(u.dp));
            bars.unshift({
                time: nowBar - i * CHART_TF,
                open, high, low, close,
                volume: Number((Math.random() * 6 + 0.2).toFixed(3)),
            });
            close = open;
        }
        return bars;
    }

    function loadChartData(panel) {
        const bars = seedChartData();
        panel.candles.setData(bars.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
        panel.volume.setData(bars.map(({ time, volume }) => ({ time, value: volume })));
        const last = bars[bars.length - 1];
        panel.last = { time: last.time, open: last.open, high: last.high, low: last.low, close: last.close };
        panel.lastVol = { time: last.time, value: last.volume };
        panel.chart.timeScale().fitContent();
    }

    function createChartPanel(hostEl) {
        const wrap = document.createElement('div');
        wrap.className = 'chart-wrap';
        hostEl.appendChild(wrap);

        const colors = chartColors();
        const chart = SSChart.createChart(wrap, {
            layout: {
                background: { type: 'solid', color: colors.bg },
                textColor: colors.text,
                fontFamily: colors.mono,
                fontSize: 11,
                attributionLogo: false,
            },
            grid: { vertLines: { color: colors.grid }, horzLines: { color: colors.grid } },
            crosshair: { mode: SSChart.CrosshairMode.Normal },
            rightPriceScale: { borderColor: colors.grid },
            timeScale: { borderColor: colors.grid, timeVisible: true, secondsVisible: true, mode: 'ordinal' },
        });

        const candles = chart.addSeries(SSChart.CandlestickSeries, candleColors(colors));
        // A theme-neutral grey on purpose: per-bar colouring would have to be
        // recomputed on every theme flip for no demo value.
        const volume = chart.addSeries(SSChart.HistogramSeries, {
            color: 'rgba(128, 138, 153, 0.3)',
            priceFormat: { type: 'volume' },
            priceScaleId: '',
        });
        volume.priceScale().applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });

        const panel = { chart, candles, volume, last: null, lastVol: null };
        loadChartData(panel);

        // Dockview resizes the panel box; the chart is told. Through resize(),
        // not applyOptions: the engine sizes its canvases only through the
        // former — the latter records the numbers without applying them.
        const ro = new ResizeObserver(() => {
            if (wrap.clientWidth > 0 && wrap.clientHeight > 0)
                chart.resize(wrap.clientWidth, wrap.clientHeight);
        });
        ro.observe(wrap);

        chartPanel = panel;
        return {
            dispose() {
                ro.disconnect();
                chart.remove();
                chartPanel = null;
            },
        };
    }

    function updateChartTick() {
        if (!chartPanel) return;
        const u = universeOf(BOOK_SYMBOL);
        const time = Math.floor(Date.now() / 1000 / CHART_TF) * CHART_TF;
        const panel = chartPanel;

        if (panel.last && panel.last.time === time) {
            panel.last.close = u.price;
            if (u.price > panel.last.high) panel.last.high = u.price;
            if (u.price < panel.last.low) panel.last.low = u.price;
            panel.lastVol.value = Number((panel.lastVol.value + Math.random() * 0.8).toFixed(3));
        } else {
            panel.last = { time, open: u.price, high: u.price, low: u.price, close: u.price };
            panel.lastVol = { time, value: Number((Math.random() * 0.8 + 0.1).toFixed(3)) };
        }

        // Same time mutates the forming bar, a newer time appends the next one.
        panel.candles.update({ ...panel.last });
        panel.volume.update({ ...panel.lastVol });
    }

    function applyChartTheme() {
        if (!chartPanel) return;
        const colors = chartColors();
        chartPanel.chart.applyOptions({
            layout: { background: { type: 'solid', color: colors.bg }, textColor: colors.text },
            grid: { vertLines: { color: colors.grid }, horzLines: { color: colors.grid } },
            rightPriceScale: { borderColor: colors.grid },
            timeScale: { borderColor: colors.grid },
        });
        chartPanel.candles.applyOptions(candleColors(colors));
    }

    // ---------------------------------------------------------- host port log

    function createHostLog(hostEl) {
        // The buttons ride in an element the tab lift picks up, so the log gets
        // the same single-row chrome every other panel has.
        const actions = document.createElement('div');
        actions.className = 'hostlog-actions';

        const note = document.createElement('span');
        note.className = 'hostlog-note';
        note.textContent = 'every line is a call a control made into the demo host';
        actions.appendChild(note);

        const clear = document.createElement('button');
        clear.type = 'button';
        clear.className = 'tbtn tbtn-sm';
        clear.textContent = 'Clear';
        clear.addEventListener('click', () => { logEl.textContent = ''; });
        actions.appendChild(clear);

        hostEl.appendChild(actions);
        hostEl.appendChild(logEl);
        return {
            dispose() {
                // The element outlives the panel so the log survives a close —
                // reopening (Reset layout) adopts it with its history intact.
                logEl.remove();
            },
        };
    }

    // ----------------------------------------------------------------- docking

    // The same assembly the terminal does: dockview owns the board, every panel
    // is a content renderer that mounts a widget, and a custom tab carries the
    // title, the panel's own header controls (lifted), and the ×.
    const dockEl = document.getElementById('dockHost');
    let dockApi = null;

    // Where each panel's lifted header controls land — filled by the tab
    // renderer, read by the lift.
    const tabSlots = new Map();

    const PANELS = {
        chart: { label: 'chart', title: () => `Chart · ${BOOK_SYMBOL}`, create: createChartPanel },
        [ControlTypes.Watchlist]: { label: 'watchlist', title: () => translate('Watchlist'), create: createWatchlist, lift: ['.watchlist-search-row'] },
        [ControlTypes.Positions]: { label: 'positions', title: () => translate('Positions'), create: createPositions },
        [ControlTypes.ActiveOrders]: { label: 'active orders', title: () => translate('ActiveOrders'), create: createOrders },
        [ControlTypes.TradeHistory]: { label: 'trade history', title: () => translate('TradeHistory'), create: createHistory },
        [ControlTypes.OrderEntry]: { label: 'order entry', title: () => translate('OrderEntry'), create: createOrderEntry },
        [ControlTypes.TradeFeed]: { label: 'trade feed', title: () => translate('TradeFeed'), create: createTradeFeed },
        [ControlTypes.OrderBook]: { label: 'order book', title: () => translate('OrderBook'), create: createOrderBook },
        hostlog: { label: 'host log', title: () => 'Host port traffic', create: createHostLog, lift: ['.hostlog-actions'] },
    };

    function makeTab(panelId) {
        const element = document.createElement('div');
        element.className = 'terminal-tab';

        const title = document.createElement('span');
        title.className = 'terminal-tab-title';

        const actions = document.createElement('div');
        actions.className = 'terminal-tab-actions';
        // Poking a lifted control must not start a tab drag.
        for (const type of ['pointerdown', 'mousedown', 'click'])
            actions.addEventListener(type, (e) => e.stopPropagation());

        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'terminal-tab-close';
        close.setAttribute('aria-label', translate('ClosePanel'));
        close.textContent = '✕';

        element.append(title, actions, close);
        tabSlots.set(panelId, actions);

        let titleWatch = null;
        return {
            element,
            init(params) {
                title.textContent = params.api.title || '';
                titleWatch = params.api.onDidTitleChange(() => { title.textContent = params.api.title || ''; });
                close.addEventListener('pointerdown', (e) => e.stopPropagation());
                close.addEventListener('click', (e) => {
                    e.stopPropagation();
                    params.api.close();
                });
            },
            dispose() {
                if (titleWatch) titleWatch.dispose();
                tabSlots.delete(panelId);
            },
        };
    }

    // The move the controls' markup was designed for (their comments say so):
    // `.panel-header`'s children go to the dockview tab, so a panel has one row
    // of chrome, not two. The bare caption span and the control's own × stay
    // behind — the tab already carries a title and a close.
    function liftHeaderToTab(kind, rootEl) {
        const slot = tabSlots.get(kind);
        if (!slot) return;

        const header = rootEl.querySelector('.panel-header');
        if (header) {
            for (const child of Array.from(header.children)) {
                if (child.tagName === 'SPAN' && !child.className) continue;
                if (child.classList.contains('panel-close-btn') || child.classList.contains('ob-close-btn')) continue;
                slot.appendChild(child);
            }
            header.style.display = 'none';
        }

        for (const selector of PANELS[kind].lift || []) {
            const extra = rootEl.querySelector(selector);
            if (extra) slot.appendChild(extra);
        }
    }

    function makeRenderer(kind) {
        const panel = PANELS[kind];
        const element = document.createElement('div');
        element.className = 'terminal-dock-panel';

        if (!panel) {
            element.textContent = `[unknown panel ${kind}]`;
            return { element, init() { } };
        }

        let widget = null;
        return {
            element,
            init() {
                widget = panel.create(element);
                if (widget && kind !== 'chart' && kind !== 'hostlog') live.set(kind, widget);
                // Next tick, because the tab element joins the DOM as part of
                // the same addPanel this init runs in.
                setTimeout(() => liftHeaderToTab(kind, element), 0);
            },
            dispose() {
                if (widget && typeof widget.dispose === 'function') {
                    try { widget.dispose(); } catch (err) { logLine('warn', `${panel.label}: dispose failed — ${err.message}`); }
                }
                widget = null;
                live.delete(kind);
                logLine('act', `the ${panel.label} panel left the dock`);
            },
        };
    }

    function closeDockPanel(kind) {
        if (!dockApi) return;
        const panel = dockApi.getPanel(kind);
        if (panel) dockApi.removePanel(panel);
    }

    function addDockPanel(kind, position, sizing) {
        dockApi.addPanel(Object.assign({
            id: kind,
            component: kind,
            title: PANELS[kind].title(),
        }, position ? { position } : null, sizing || null));
    }

    // The terminal's default board: chart on the left, the tape and the ladder
    // to its right, the watchlist under the ladder, the order pad and the
    // blotters (tabbed) along the bottom.
    function buildDefaultLayout() {
        addDockPanel('chart', null);
        addDockPanel(ControlTypes.OrderEntry, { referencePanel: 'chart', direction: 'below' }, { initialHeight: 260 });
        addDockPanel(ControlTypes.TradeFeed, { referencePanel: 'chart', direction: 'right' }, { initialWidth: 280 });
        addDockPanel(ControlTypes.OrderBook, { referencePanel: ControlTypes.TradeFeed, direction: 'right' }, { initialWidth: 340 });
        addDockPanel(ControlTypes.Watchlist, { referencePanel: ControlTypes.OrderBook, direction: 'below' }, { initialHeight: 300 });
        addDockPanel(ControlTypes.ActiveOrders, { referencePanel: ControlTypes.OrderEntry, direction: 'right' });
        addDockPanel(ControlTypes.TradeHistory, { referencePanel: ControlTypes.ActiveOrders, direction: 'within' });
        addDockPanel(ControlTypes.Positions, { referencePanel: ControlTypes.ActiveOrders, direction: 'within' });
        addDockPanel('hostlog', { referencePanel: ControlTypes.ActiveOrders, direction: 'within' });

        const orders = dockApi.getPanel(ControlTypes.ActiveOrders);
        if (orders) orders.api.setActive();

        // initialWidth/initialHeight are advisory while the tree is being
        // built; the real proportions are pushed once dockview has laid out —
        // the same double-rAF the terminal uses.
        requestAnimationFrame(() => requestAnimationFrame(applyRatios));
    }

    function applyRatios() {
        if (!dockApi) return;
        const width = dockEl.clientWidth || 1440;
        const height = dockEl.clientHeight || 900;
        const setSize = (kind, box) => {
            const panel = dockApi.getPanel(kind);
            if (panel && panel.group) panel.group.api.setSize(box);
        };
        setSize('chart', { width: Math.floor(width * 0.50) });
        setSize(ControlTypes.TradeFeed, { width: Math.floor(width * 0.22) });
        setSize(ControlTypes.OrderBook, { width: Math.floor(width * 0.28) });
        setSize(ControlTypes.OrderEntry, { height: 260 });
        // The right column splits between the ladder and the watchlist; the
        // ladder gets the larger share — ten levels a side need the room.
        setSize(ControlTypes.Watchlist, { height: Math.floor((height - 260) * 0.42) });
    }

    function initDock() {
        dockApi = DV.createDockview(dockEl, {
            // themeDark supplies dockview's structural styling; the colours are
            // re-pointed at the --t-* tokens in demo.css, so the light theme
            // works by flipping the tokens, not the dockview theme.
            theme: DV.themeDark,
            // Everything renders at once: this page is a demo of nine live
            // panels, and the port log at the bottom should show them all
            // registering at boot.
            defaultRenderer: 'always',
            createComponent: (options) => makeRenderer(options.name),
            defaultTabComponent: 'terminalTab',
            createTabComponent: (options) => makeTab(options.id),
            // A lone tab spans its whole strip, so lifted header controls
            // right-align against the panel edge.
            singleTabMode: 'fullwidth',
        });

        const observer = new ResizeObserver(() => {
            const w = dockEl.clientWidth;
            const h = dockEl.clientHeight;
            if (w > 0 && h > 0) dockApi.layout(w, h, true);
        });
        observer.observe(dockEl);

        buildDefaultLayout();
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
        pushOrderEntry();
        pushTape();
        pushBookFrames();
        updateChartTick();

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
    initDock();
    pushPrices();
    pushOrderEntry();

    document.getElementById('tickBtn').addEventListener('click', tick);
    document.getElementById('autoBtn').addEventListener('click', (e) => toggleAuto(e.currentTarget));

    document.getElementById('resetBtn').addEventListener('click', () => {
        resetState();
        logLine('act', 'reset — sample prices, positions, orders and fills restored');
        pushPrices();
        pushOrderEntry();
        const positions = live.get(ControlTypes.Positions);
        if (positions) {
            positions.update(clone(state.positions));
            positions.updateBalance(clone(state.balance));
        }
        const orders = live.get(ControlTypes.ActiveOrders);
        if (orders) orders.update(clone(state.orders));
        const history = live.get(ControlTypes.TradeHistory);
        if (history) void history.refresh();
        // The books are rebuilt around the restored prices, and each ladder is
        // told so the only way it ever is: with a snapshot.
        books.clear();
        const orderBook = live.get(ControlTypes.OrderBook);
        if (orderBook && orderBook.getSymbol()) sendBookSnapshot(orderBook.getSymbol());
        // The chart's history random-walked from the old price; reseed it
        // around the restored one.
        if (chartPanel) loadChartData(chartPanel);
    });

    // Closed a panel? This puts the whole default board back — the dockview
    // equivalent of the old per-cell "Create it again" button.
    document.getElementById('layoutBtn').addEventListener('click', () => {
        logLine('act', 'reset layout — rebuilding the default dock');
        dockApi.clear();
        buildDefaultLayout();
        pushPrices();
        pushOrderEntry();
    });

    // The package's own theme.css keys its light palette off `data-bs-theme`, and
    // demo.css re-declares the same tokens under the same attribute — one switch
    // moves the page, every panel, the dockview chrome and the chart at once.
    document.getElementById('themeBtn').addEventListener('click', (e) => {
        const root = document.documentElement;
        const light = root.getAttribute('data-bs-theme') === 'light';
        root.setAttribute('data-bs-theme', light ? 'dark' : 'light');
        e.currentTarget.innerHTML = light ? '&#9788; Light' : '&#9789; Dark';
        applyChartTheme();
    });

    const clockEl = document.getElementById('statusClock');
    const showClock = () => { clockEl.textContent = new Date().toLocaleTimeString('en-US', { hour12: false }); };
    showClock();
    setInterval(showClock, 1000);

    logLine('act', 'demo host ready — every panel below is a live control over its own TradingHost');
})();
