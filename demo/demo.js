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
        StatisticsWidget,
        StrategiesWidget,
        StrategyStates,
        LogMonitorWidget,
        LogLevels,
        OptionDeskWidget,
        OptionSmileWidget,
        EquityWidget,
        OptimizationHeatmapWidget,
        SurfaceWidget,
        HeatDirections,
        OptionTypes,
        premium,
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
    // What the blotter's own fills add up to: the two BTC buys blended, the NVDA short and the
    // ES long, each at the price its fills were made at. The two lists have to agree - a
    // position panel that contradicts the trade list beside it is a demo teaching nothing.
    const PRISTINE_POSITIONS = [
        { portfolioId: PORTFOLIO_ID, instrumentId: 101, instrument: 'BTC@IMEX', quantity: 0.75, avgPrice: 68093.33, realizedPnl: 120.0 },
        { portfolioId: PORTFOLIO_ID, instrumentId: 203, instrument: 'NVDA@NASDAQ', quantity: -400, avgPrice: 120.85, realizedPnl: 0 },
        { portfolioId: PORTFOLIO_ID, instrumentId: 301, instrument: 'ESZ5@CME', quantity: 2, avgPrice: 5806.75, realizedPnl: -15.0 },
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

    // A session already behind this page.
    //
    // The eight fills below are the ones a reader can check against the blotter by eye. On their
    // own they are also the whole of the run, which left the equity curve with eight corners and
    // the statistics measuring almost nothing - a drawdown over eight trades is not a drawdown.
    // So the tape opens with a few hours of trading before them, generated rather than typed:
    // what matters is the shape of a session, and two hundred rows written out by hand would fix
    // one shape forever and be unreadable besides.
    //
    // Round trips, not a stream of buys: a fill that closes a position is what books a profit or
    // a loss, and a tape that only ever opened would draw a curve that never realised anything.
    const BACKFILL_FILLS = 240;
    const BACKFILL_MINUTES = 8 * 60;

    function backfillTrades() {
        // Each instrument walks its own price backwards from where it stands now, newest fill
        // first: the session has to END at the live price, or the newest backfilled fill and the
        // first live one price the same instrument hours apart, and the equity curve pays for it
        // with a step the size of the whole session.
        const walk = new Map(UNIVERSE.map(u => [u.symbol, { price: u.price, open: 0, avg: 0 }]));
        const fills = [];

        for (let step = 0; step < BACKFILL_FILLS; step++) {
            const u = UNIVERSE[Math.floor(Math.random() * UNIVERSE.length)];
            const book = walk.get(u.symbol);

            // The live tick's drift, widened by two and a half so a few hours cover ground -
            // not by six. A position here is opened by one fill and closed by the next for its
            // symbol, so its whole life is two points on the curve: whatever the price moved
            // between them arrives as one step. At six the step is several times the curve's own
            // range and the panel draws a picket fence.
            // Tilted downward going backwards, which is a session that rose: a coin-flip walk
            // is as likely to end flat as anything, and a demo whose equity never rises shows
            // neither a peak nor a drawdown - the two things the panel exists to draw.
            const drift = (Math.random() - 0.54) * 2 * u.vol * 2.5;
            book.price = Number((book.price * (1 + drift)).toFixed(u.dp));

            const closing = book.open !== 0;
            const quantity = closing ? Math.abs(book.open) : Number((u.price > 1000 ? 0.25 : 25).toFixed(2));
            const buy = closing ? book.open < 0 : Math.random() < 0.5;

            // Numbered downward with the walk, because it runs backwards: an older fill has a
            // smaller id and a smaller order number, the way a blotter reads.
            fills.push({
                id: 5510 - step,
                executedAt: minutesAgo(Math.round(BACKFILL_MINUTES * (step / BACKFILL_FILLS)) + 5),
                instrumentSymbol: u.symbol,
                side: buy ? Sides.Buy : Sides.Sell,
                quantity,
                price: book.price,
                order: 89000 + (BACKFILL_FILLS - step),
            });

            book.open = closing ? 0 : (buy ? quantity : -quantity);
            if (!closing) book.avg = book.price;
        }

        // Already newest first, the way the blotter reads and the way the eight below are
        // written: the walk runs backwards through the session.
        return fills;
    }

    // The eight the blotter is written around, newest first. Their prices sit within a few
    // tenths of a percent of where their instruments trade now, and that is not cosmetic: these
    // are the last fills of the session, so between them and the live ones there is nothing to
    // re-price a held position. A fill two percent off the live price makes the equity curve
    // jump by the size of the position every time the mark crosses back and forth between the
    // two, which draws a picket fence over an otherwise readable session.
    const PRISTINE_TRADES = [
        { id: 5518, executedAt: minutesAgo(4), instrumentSymbol: 'ESZ5@CME', side: Sides.Buy, quantity: 2, price: 5806.75, order: 90114 },
        { id: 5517, executedAt: minutesAgo(11), instrumentSymbol: 'NVDA@NASDAQ', side: Sides.Sell, quantity: 400, price: 120.85, order: 90113 },
        { id: 5516, executedAt: minutesAgo(26), instrumentSymbol: 'BTC@IMEX', side: Sides.Buy, quantity: 0.25, price: 68180.0, order: 90111 },
        { id: 5515, executedAt: minutesAgo(38), instrumentSymbol: 'XAUUSD@FX', side: Sides.Sell, quantity: 10, price: 2652.6, order: 90109 },
        { id: 5514, executedAt: minutesAgo(52), instrumentSymbol: 'BTC@IMEX', side: Sides.Buy, quantity: 0.5, price: 68050.0, order: 90107 },
        { id: 5513, executedAt: minutesAgo(74), instrumentSymbol: 'ETH@IMEX', side: Sides.Buy, quantity: 4, price: 3505.4, order: 90104 },
        { id: 5512, executedAt: minutesAgo(96), instrumentSymbol: 'ETH@IMEX', side: Sides.Sell, quantity: 4, price: 3518.9, order: 90102 },
        { id: 5511, executedAt: minutesAgo(133), instrumentSymbol: 'CLZ5@NYMEX', side: Sides.Buy, quantity: 5, price: 71.62, order: 90099 },
        ...backfillTrades(),
    ];

    // Three runs over three instruments from the universe above, one of each kind
    // of row: a winner holding a lot, a loser that is flat, and one that never
    // started and says why. `lot` is the size a run works in - it goes to one lot
    // and back to flat, never averaging in, which keeps its own book to two lines.
    const PRISTINE_STRATEGIES = [
        {
            id: 'sma', name: 'SMA crossover', symbol: 'BTC@IMEX', state: StrategyStates.Started,
            mode: 'Full', lot: 0.05, position: 0.05, avgPrice: 68180.0, realized: 640.0,
            orders: 35, trades: 34, anchor: 0, error: null,
        },
        {
            id: 'rsi', name: 'RSI reversal', symbol: 'NVDA@NASDAQ', state: StrategyStates.Started,
            mode: 'CancelOrders', lot: 50, position: 0, avgPrice: 0, realized: -212.5,
            orders: 61, trades: 60, anchor: 0, error: null,
        },
        {
            id: 'grid', name: 'Grid maker', symbol: 'ESZ5@CME', state: StrategyStates.Stopped,
            mode: 'Disabled', lot: 1, position: 0, avgPrice: 0, realized: 0,
            orders: 0, trades: 0, anchor: 0, error: 'no market data for ESZ5@CME',
        },
    ];

    const state = {
        positions: [],
        balance: null,
        orders: [],
        trades: [],
        strategies: [],
        // The run's equity high-water mark. A drawdown is a property of the path
        // equity took: once it has fallen back, nothing in the snapshot says how
        // high it stood, so the peak is carried as the run goes.
        equity: { peak: 0, peakAt: null, drawdown: 0 },
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
        // A run that has traded sixty times did not start ten seconds ago, so its
        // curve is seeded back to where it began; one that never ran has no curve
        // and the dashboard draws no sparkline for it.
        state.strategies = clone(PRISTINE_STRATEGIES).map(strategy => {
            strategy.pnl = strategy.trades > 0 ? seedStrategyCurve(strategy) : [];
            strategy.samples = strategy.pnl.length;
            return strategy;
        });
        // Seeded from the tape rather than starting at zero. The mark is carried as the run
        // goes because a snapshot cannot recover a peak it has already fallen from - but the
        // backfilled session IS a path, so walking it once gives the peak and the fall that
        // actually happened. Without this the curve shows a run that peaked and gave it back
        // while the statistics report a drawdown of nothing.
        state.equity = seedEquityMark();
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

    // How many lines the page keeps, and how far back a monitor that opens late is
    // seeded from. One number for both, so a panel that was closed for a while comes
    // back showing what it would have shown had it been on screen throughout.
    const LOG_HISTORY = 500;

    // What each of the page's line kinds reads as in a log monitor. `dim` is the
    // book-keeping the page already prints in grey, `data` is a call that would cross
    // a network, and a kind with no row here reads as an ordinary message.
    const LOG_LEVELS = {
        act: LogLevels.Info,
        up: LogLevels.Info,
        down: LogLevels.Info,
        data: LogLevels.Debug,
        dim: LogLevels.Verbose,
        warn: LogLevels.Warning,
    };

    // The root of the source tree: the demo host itself, which wrote every line no
    // control asked for - the API client, the market-data feed, the stores, the dock.
    const HOST_SOURCE = 'host';

    // Every line written so far, capped, plus the tail the monitor has not been given
    // yet. The history seeds a panel that opens late; the queue feeds the one on screen.
    const logHistory = [];
    const pendingLog = [];
    let nextLogId = 1;
    let draining = false;

    // Every line goes to two places: the page's own log element, and the log monitor,
    // which is the package's own control over the same stream. `sourceId` names who the
    // line is about - the host itself, or the control kind whose port call this is.
    function logLine(kind, text, sourceId) {
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

        recordLog({
            id: nextLogId++,
            time: new Date().toISOString(),
            level: LOG_LEVELS[kind] || LogLevels.Info,
            sourceId,
            message: text,
        });
    }

    // Keep the line, and hand it on if a monitor is up. Both stores are capped the way
    // the widget caps itself, so a session spent with the panel closed cannot grow them.
    function recordLog(row) {
        logHistory.push(row);
        pendingLog.push(row);
        if (logHistory.length > LOG_HISTORY) logHistory.splice(0, logHistory.length - LOG_HISTORY);
        if (pendingLog.length > LOG_HISTORY) pendingLog.splice(0, pendingLog.length - LOG_HISTORY);
        drainLog();
    }

    // Give the monitor what is waiting, oldest first. Appending renders, and the monitor
    // sits over a real host - so a line written while it renders only queues, and this
    // loop takes it on the next turn. A line is delayed at worst, never nested.
    function drainLog() {
        const monitor = live.get(ControlTypes.LogMonitor);
        if (!monitor || draining) return;
        draining = true;
        try {
            while (pendingLog.length > 0) monitor.append(pendingLog.splice(0, pendingLog.length));
        } finally {
            draining = false;
        }
    }

    // What the primary watchlist reports through `TickerSink.publish` — the symbols
    // currently on screen and its live stats for them. Page chrome outside any
    // control, which is exactly why the control reports instead of drawing it.
    function renderTicker(symbols, stats) {
        tickerEl.textContent = '';
        if (!symbols.length) {
            const empty = document.createElement('span');
            empty.className = 'tk-empty';
            empty.textContent = LANG.page.tickerEmpty;
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
        logLine('act', `${kind}: trading.pickInstrument() — the host opened its picker`, kind);

        const overlay = document.createElement('div');
        overlay.className = 'picker';

        const sheet = document.createElement('div');
        sheet.className = 'picker-sheet';
        const title = document.createElement('div');
        title.className = 'picker-title';
        title.textContent = LANG.page.pickerTitle;
        sheet.appendChild(title);

        const close = () => overlay.remove();
        for (const instrument of UNIVERSE) {
            const option = document.createElement('button');
            option.type = 'button';
            option.className = 'picker-option';
            option.textContent = `${instrument.symbol} — ${instrument.name}`;
            option.addEventListener('click', () => {
                close();
                logLine('act', `${kind}: picked ${instrument.symbol}`, kind);
                onPicked(instrument.symbol);
            });
            sheet.appendChild(option);
        }

        const dismiss = document.createElement('button');
        dismiss.type = 'button';
        dismiss.className = 'tbtn picker-dismiss';
        dismiss.textContent = LANG.page.pickerDismiss;
        dismiss.addEventListener('click', () => {
            close();
            logLine('dim', `${kind}: the picker was dismissed — the control was told nothing`, kind);
        });
        sheet.appendChild(dismiss);

        overlay.appendChild(sheet);
        document.body.appendChild(overlay);
    }

    // ------------------------------------------------------------------ the port

    // The demo speaks two languages — demo/i18n.js holds both dictionaries.
    // `controls` covers every key the package passes to `t()` (the list is
    // `translation-keys.json`, generated from src/), so flipping the language
    // and re-creating the panels re-captions the whole board: the controls
    // hardcode no wording. A key missing from the active dictionary is logged
    // rather than rendered blank, so a control that grows a caption is visible
    // on this page at once.
    let LANG = window.SSDemoText.en;

    function translate(key, ...args) {
        let text = LANG.controls[key];
        if (text === undefined) {
            logLine('warn', `t("${key}") has no ${LANG.code} translation — falling back to the key`, HOST_SOURCE);
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

    // Wire states mapped to meanings; the wording behind each meaning lives in
    // the language dictionaries, because status text is the host's to say.
    const STATUS_KEYS = {
        [OrderStates.PendingRisk]: 'pending',
        [OrderStates.Sent]: 'sent',
        [OrderStates.Active]: 'active',
        [OrderStates.PartiallyFilled]: 'partial',
        [OrderStates.Filled]: 'filled',
        [OrderStates.Rejected]: 'rejected',
        [OrderStates.Cancelled]: 'cancelled',
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
        sideText: (side) => (isBuy(side) ? LANG.side.buy : LANG.side.sell),
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
        statusText: (status) => LANG.status[STATUS_KEYS[status]] || String(status),
        // A live demo is a tape, so it reads the time of day in the reader's own zone.
        timeText: (value) => new Date(value).toLocaleTimeString('en-US',
            { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }),
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
                logLine('dim', `${name}.set("${key}")`, HOST_SOURCE);
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
            logLine('data', `api.getExecutions(portfolio ${portfolioId}, ${symbol === null ? 'every instrument' : symbol}, limit ${limit})`, HOST_SOURCE);
            const rows = state.trades
                .filter(t => symbol === null || t.instrumentSymbol === symbol)
                .slice(0, limit);
            return new Promise(resolve => setTimeout(() => resolve(clone(rows)), 90));
        },
        searchInstruments(query) {
            logLine('data', `api.searchInstruments("${query}")`, HOST_SOURCE);
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
            logLine('dim', `marketData.addSymbol("${symbol}", "${level}") — refcount ${count}`, HOST_SOURCE);
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
            logLine('dim', `marketData.removeSymbol("${symbol}") — refcount ${count}`, HOST_SOURCE);
            return Promise.resolve(true);
        },
        resubscribe(symbol, level) {
            logLine('dim', `marketData.resubscribe("${symbol}", "${level}") — resending the book from scratch`, HOST_SOURCE);
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
                    logLine('dim', `ticker.publish(${symbols.length} visible symbols)`, kind);
                    renderTicker(symbols, stats);
                },
            },
            allow(action) {
                logLine('dim', `allow("${action}") — granted`, kind);
                return true;
            },
            log: (message) => logLine('warn', `log: ${message}`, kind),
            // The panel's × (in the dockview tab) and this call end in the same
            // place: the panel leaves the dock and the renderer disposes the
            // widget.
            close: () => closeDockPanel(kind),
            // Uncalled by the four blotters; the port requires them anyway
            // because the terminal's other controls call them.
            spawn: (panelState) => logLine('act', `${kind}: spawn(${JSON.stringify(panelState)}) — this demo hosts one panel per kind`, kind),
            persistState: (patch) => logLine('dim', `${kind}: persistState(${JSON.stringify(patch)})`, kind),
            saveLayout: () => logLine('dim', `${kind}: saveLayout()`, kind),
            register(control) {
                peers.add(control);
                logLine('dim', `register(${kind}) — ${peers.size} live`, kind);
            },
            unregister(control) {
                peers.delete(control);
                logLine('dim', `unregister(${kind}) — ${peers.size} live`, kind);
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

        // The fill moved the tape and the portfolio, so every figure derived from them
        // moved with it.
        pushStatistics();
    }

    function updateOrder(orderId, patch) {
        const order = state.orders.find(o => o.id === orderId);
        if (order) Object.assign(order, patch);
        const orders = live.get(ControlTypes.ActiveOrders);
        if (orders) orders.applyDelta({ id: orderId, ...patch });
        pushStatistics();
        return order;
    }

    function fillOrder(order, price) {
        const quantity = order.balance != null ? order.balance : order.quantity;
        const buy = isBuy(order.side);
        updateOrder(order.id, { status: OrderStates.Filled, balance: 0 });
        addExecution(order.instrument, order.side, quantity, price, order.id);
        applyFill(order.instrument, buy, quantity, price);
        logLine(buy ? 'up' : 'down',
            `fill: #${order.localId} ${presentation.sideText(order.side)} ${quantity} ${order.instrument} @ ${price} — order filled, execution added, position updated`, HOST_SOURCE);
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
            logLine('warn', `feed: dropping a frame for ${symbol} on purpose — the next one skips a sequence number`, HOST_SOURCE);

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
                logLine('act', `watchlist.onSelect("${symbol}") — host highlighted the row`, ControlTypes.Watchlist);
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
                logLine('act', `closePosition(${portfolioId}, ${instrumentId}, "${symbol}") — flattening at the last price`, ControlTypes.Positions);
                const u = universeOf(symbol);
                addExecution(symbol, position.quantity > 0 ? Sides.Sell : Sides.Buy, Math.abs(position.quantity), u.price, state.nextOrderId++);
                applyFill(symbol, position.quantity < 0, Math.abs(position.quantity), u.price);
            },
            reversePosition: (portfolioId, instrumentId, symbol) => {
                const position = state.positions.find(p => p.instrument === symbol);
                if (!position) return;
                logLine('act', `reversePosition(${portfolioId}, ${instrumentId}, "${symbol}") — trading twice the size the other way`, ControlTypes.Positions);
                const u = universeOf(symbol);
                const quantity = Math.abs(position.quantity) * 2;
                addExecution(symbol, position.quantity > 0 ? Sides.Sell : Sides.Buy, quantity, u.price, state.nextOrderId++);
                applyFill(symbol, position.quantity < 0, quantity, u.price);
            },
            refreshPositions: () => {
                logLine('act', 'refreshPositions() — host re-pushed its snapshot', ControlTypes.Positions);
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
                logLine('act', `cancelOrder(${orderId}) — venue acknowledged`, ControlTypes.ActiveOrders);
                updateOrder(orderId, { status: OrderStates.Cancelled });
            },
            // Nothing left to cancel on a terminal row: the × drops it locally.
            dismissOrder: (orderId) => {
                logLine('act', `dismissOrder(${orderId}) — removed from the local view only`, ControlTypes.ActiveOrders);
                state.orders = state.orders.filter(o => o.id !== orderId);
                widget.removeOrder(orderId);
                pushStatistics();
            },
            // The double-click on an editable cell reaches the host, and the host
            // asks the control to open its editor. The control owns the input; the
            // host owns the decision that editing is allowed.
            editOrderField: (orderId, field) => {
                logLine('act', `editOrderField(${orderId}, "${field}") — host opened the inline editor`, ControlTypes.ActiveOrders);
                widget.startInlineEdit(orderId, field);
            },
            replaceOrder: (orderId, quantity, limitPrice, stopPrice) => {
                logLine('act', `replaceOrder(${orderId}, qty ${quantity}, limit ${limitPrice}, stop ${stopPrice})`, ControlTypes.ActiveOrders);
                updateOrder(orderId, { quantity, balance: quantity, limitPrice, stopPrice });
            },
            cancelAllOrders: () => {
                const activeIds = state.orders.filter(o => o.status === OrderStates.Active).map(o => o.id);
                logLine('act', `cancelAllOrders() — ${activeIds.length} resting order(s)`, ControlTypes.ActiveOrders);
                for (const id of activeIds) updateOrder(id, { status: OrderStates.Cancelled });
            },
            refreshOrders: () => {
                logLine('act', 'refreshOrders() — host re-pushed its snapshot', ControlTypes.ActiveOrders);
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
                logLine('act', `submitOrder("${side}", ${values.type} ${values.quantity} ${ORDER_ENTRY_SPEC.symbol}${at})`, ControlTypes.OrderEntry);

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
                logLine('act', `onPriceSelected(${price}, ${side}) — prefilling the order pad`, ControlTypes.OrderBook);
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
                logLine('act', `onPriceExecuted(${price}, ${side}) — resting ${quantity} ${buy ? 'bid' : 'offer'}`, ControlTypes.OrderBook);
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

    // -------------------------------------------------------------- statistics

    // What the fills add up to. The tape is replayed oldest-first because the figures
    // below are properties of the path the run took, not of the snapshot it ended on:
    // a win, a loss and a drawdown only exist in order. The averaging and realizing
    // rules are `applyFill`'s, applied to a private ledger so the replay leaves the
    // portfolio alone.
    function replayFills() {
        const ledger = new Map();
        const closes = [];
        let realized = 0;
        let maxLong = 0;
        let maxShort = 0;

        // `state.trades` is newest-first, the way the blotter reads it.
        for (const fill of state.trades.slice().reverse()) {
            const quantity = Math.abs(fill.quantity);
            const signed = isBuy(fill.side) ? quantity : -quantity;
            let held = ledger.get(fill.instrumentSymbol);
            if (!held) {
                held = { quantity: 0, avgPrice: fill.price, lastPrice: fill.price };
                ledger.set(fill.instrumentSymbol, held);
            }
            held.lastPrice = fill.price;

            const oldQty = held.quantity;
            const newQty = oldQty + signed;
            if (oldQty === 0 || Math.sign(oldQty) === Math.sign(signed)) {
                held.avgPrice = (Math.abs(oldQty) * held.avgPrice + quantity * fill.price) / (Math.abs(oldQty) + quantity);
            } else {
                const closed = Math.min(Math.abs(oldQty), quantity);
                const profit = (fill.price - held.avgPrice) * closed * Math.sign(oldQty);
                realized += profit;
                closes.push(profit);
                if (newQty !== 0 && Math.sign(newQty) !== Math.sign(oldQty)) held.avgPrice = fill.price;
            }
            held.quantity = newQty;

            // Exposure is money, not quantity: 400 shares and 0.75 bitcoin are
            // comparable only once they are priced.
            let long = 0;
            let short = 0;
            for (const open of ledger.values()) {
                const value = open.quantity * open.lastPrice;
                if (value > 0) long += value;
                else short -= value;
            }
            if (long > maxLong) maxLong = long;
            if (short > maxShort) maxShort = short;
        }

        // The open books at the live price, which is what makes a tick move the panel
        // and not only a fill.
        let unrealized = 0;
        for (const [symbol, held] of ledger) {
            const u = universeOf(symbol);
            unrealized += ((u ? u.price : held.lastPrice) - held.avgPrice) * held.quantity;
        }

        return {
            realized,
            unrealized,
            netProfit: realized + unrealized,
            closes,
            wins: closes.filter(profit => profit > 0).length,
            losses: closes.filter(profit => profit < 0).length,
            maxLong,
            maxShort,
        };
    }

    // The replay, plus the run's high-water mark advanced by it. Recomputing the peak
    // from the snapshot would read zero forever, because a snapshot taken after the
    // fall no longer contains the height it fell from.
    function runFigures() {
        const run = replayFills();
        const mark = state.equity;

        if (run.netProfit > mark.peak) {
            mark.peak = run.netProfit;
            mark.peakAt = new Date().toISOString();
        }
        const fall = mark.peak - run.netProfit;
        if (fall > mark.drawdown) mark.drawdown = fall;

        return run;
    }

    // One row as the panel reads it. The key and the category are stable across a
    // language switch and the order places the row; the wording for both is the
    // host's, because a statistic reaches this control already captioned.
    function statRow(category, order, key, value) {
        const text = LANG.stats;
        return {
            key,
            category,
            categoryText: text.categories[category] || category,
            order,
            name: text.names[key] || key,
            description: text.hints[key] || '',
            value,
        };
    }

    // The whole set, derived from the run rather than typed out. The orders are banded
    // the way the desktop registry bands them - P&L below a hundred, trades from a
    // hundred, positions from two hundred, orders from three hundred - and that banding
    // is what lays the groups out in that sequence. Null rather than zero wherever
    // nothing has been measured: the panel leaves such a cell blank, and a zero would
    // read as a measured nothing.
    function computeStatistics() {
        const run = runFigures();
        const mark = state.equity;
        const positions = state.positions.map(markToMarket);
        const capital = (state.balance && state.balance.total) || 0;
        const exposure = positions.reduce((sum, p) => sum + Math.abs(p.quantity * (p.currentPrice || p.avgPrice)), 0);
        const closes = run.closes.length;
        const countOrders = (status) => state.orders.filter(o => o.status === status).length;

        return [
            statRow('pnl', 1, 'NetProfit', run.netProfit),
            statRow('pnl', 2, 'RealizedPnL', run.realized),
            statRow('pnl', 3, 'UnrealizedPnL', run.unrealized),
            statRow('pnl', 4, 'MaxProfit', mark.peak),
            // A moment, not a number - the panel prints it as a date.
            statRow('pnl', 5, 'MaxProfitDate', mark.peakAt),
            statRow('pnl', 6, 'MaxDrawdown', mark.drawdown),
            statRow('pnl', 7, 'MaxRelativeDrawdown', mark.peak > 0 ? (mark.drawdown / mark.peak) * 100 : null),
            statRow('pnl', 8, 'Capital', capital),
            statRow('pnl', 9, 'Return', capital > 0 ? (run.netProfit / capital) * 100 : null),

            statRow('trades', 100, 'TradeCount', state.trades.length),
            statRow('trades', 101, 'WinningTrades', run.wins),
            statRow('trades', 102, 'LosingTrades', run.losses),
            statRow('trades', 103, 'WinRate', closes > 0 ? (run.wins / closes) * 100 : null),
            statRow('trades', 104, 'MaxWin', closes > 0 ? Math.max.apply(null, run.closes) : null),
            statRow('trades', 105, 'MaxLoss', closes > 0 ? Math.min.apply(null, run.closes) : null),

            statRow('positions', 200, 'PositionCount', positions.length),
            statRow('positions', 201, 'CurrentExposure', exposure),
            statRow('positions', 202, 'MaxLongPosition', run.maxLong),
            statRow('positions', 203, 'MaxShortPosition', run.maxShort),

            statRow('orders', 300, 'OrderCount', state.orders.length),
            statRow('orders', 301, 'ActiveOrders', countOrders(OrderStates.Active)),
            statRow('orders', 302, 'FilledOrders', countOrders(OrderStates.Filled)),
            statRow('orders', 303, 'CancelledOrders', countOrders(OrderStates.Cancelled)),
            statRow('orders', 304, 'RejectedOrders', countOrders(OrderStates.Rejected)),
        ];
    }

    // The set is worked out even when the panel is closed, because the run's high-water
    // mark has to keep moving with the market: reopening the panel must not hand the
    // run a fresh peak and a drawdown of nothing.
    function pushStatistics() {
        const rows = computeStatistics();
        const statistics = live.get(ControlTypes.Statistics);
        if (!statistics) return;
        logLine('dim', `statistics.update(${rows.length} parameters from ${state.trades.length} fills)`, ControlTypes.Statistics);
        statistics.update(rows);
    }

    function createStatistics(hostEl) {
        const widget = StatisticsWidget.create(hostEl, {}, { host: makeHost(ControlTypes.Statistics) });
        // The panel takes no callbacks: a statistic is produced by the run and there is
        // nothing on the table to act on. So everything it shows is pushed - here at
        // first paint, and again on every tick and every fill.
        const rows = computeStatistics();
        logLine('act', `statistics: first set pushed - ${rows.length} parameters derived from the run`, ControlTypes.Statistics);
        widget.update(rows);
        return widget;
    }

    // -------------------------------------------------------------- strategies

    // The one account this demo trades. The dashboard's Portfolio column wants a word
    // where a position row carries PORTFOLIO_ID, so the host supplies one.
    const STRATEGY_PORTFOLIO = 'Sim';

    // What a run may do, in the order the dashboard offers them. Keys, not captions:
    // the control words each through t().
    const STRATEGY_MODES = ['Full', 'CancelOrders', 'Disabled'];

    // How much curve a seeded run arrives with. There is no second number for how much a live
    // run keeps: it keeps all of it, and the sparkline compresses the whole run into its box, so
    // a new sample changes the curve's shape instead of pushing the run's start off the left.
    const STRATEGY_SEED_POINTS = 40;

    // How long forming and stopping take. A run does not go from Stopped to Started in
    // one frame, and the dashboard has a word for each half-state.
    const STRATEGY_TRANSITION_MS = 700;

    const strategyOf = (id) => state.strategies.find(s => s.id === id) || null;

    // What the run has made: what it banked, plus what its open lot is worth now.
    function strategyPnl(strategy) {
        const u = universeOf(strategy.symbol);
        const unrealized = u && strategy.position !== 0 ? (u.price - strategy.avgPrice) * strategy.position : 0;
        return { realized: strategy.realized, unrealized, total: strategy.realized + unrealized };
    }

    // A walk that converges on where the run actually stands, so the seeded curve ends
    // on the same number the P&L column shows. Time is the sample index: the curve
    // reads only the spacing between points, and this demo's clock is ticks.
    function seedStrategyCurve(strategy) {
        const end = strategyPnl(strategy).total - strategy.anchor;
        const points = [];
        let value = 0;
        for (let i = 0; i < STRATEGY_SEED_POINTS; i++) {
            value += (end - value) / (STRATEGY_SEED_POINTS - i) + (Math.random() - 0.5) * Math.abs(end) * 0.3;
            points.push({ time: i, value });
        }
        points.push({ time: STRATEGY_SEED_POINTS, value: end });
        return points;
    }

    // The row the dashboard reads. `pnlChange` is measured from the anchor the current
    // run started at - the widget leaves that number to the host to mean, and this host
    // means "what this run has made".
    function toStrategyRow(strategy) {
        const pnl = strategyPnl(strategy);
        return {
            id: strategy.id,
            name: strategy.name,
            state: strategy.state,
            // Formed and connected, which is one condition: running, with nothing wrong
            // with its feed.
            online: strategy.state === StrategyStates.Started && !strategy.error,
            tradingMode: strategy.mode,
            portfolio: STRATEGY_PORTFOLIO,
            security: strategy.symbol,
            position: strategy.position,
            ordersCount: strategy.orders,
            tradesCount: strategy.trades,
            pnlChange: pnl.total - strategy.anchor,
            realized: pnl.realized,
            unrealized: pnl.unrealized,
            pnl: strategy.pnl,
            error: strategy.error,
        };
    }

    // A market order a run sends, and the three places its fill lands: the run's own
    // book, the trade history, and the account.
    function sendStrategyOrder(strategy, buy, quantity, price) {
        const side = buy ? Sides.Buy : Sides.Sell;
        const orderId = state.nextOrderId++;

        // The run's own book, kept apart from the portfolio's: a strategy is judged on
        // what it did, not on what the account happens to hold. Two lines because a run
        // here is only ever flat or holding one lot.
        if (strategy.position === 0) strategy.avgPrice = price;
        else strategy.realized += (price - strategy.avgPrice) * strategy.position;
        strategy.position = strategy.position === 0 ? (buy ? quantity : -quantity) : 0;
        strategy.orders += 1;
        strategy.trades += 1;

        addExecution(strategy.symbol, side, quantity, price, orderId);
        applyFill(strategy.symbol, buy, quantity, price);
        logLine(buy ? 'up' : 'down',
            `${strategy.name}: ${presentation.sideText(side)} ${quantity} ${strategy.symbol} @ ${price} - the run's own fill`,
            ControlTypes.Strategies);
    }

    // What a running strategy does with a tick, and what the trading mode is for: Full
    // may open and close, CancelOrders may only take risk off, Disabled sends nothing.
    function stepStrategy(strategy) {
        if (strategy.state !== StrategyStates.Started || strategy.mode === 'Disabled') return;
        const u = universeOf(strategy.symbol);
        if (!u) return;

        if (strategy.position !== 0) {
            if (Math.random() < 0.25) sendStrategyOrder(strategy, strategy.position < 0, Math.abs(strategy.position), u.price);
            return;
        }
        if (strategy.mode === 'Full' && Math.random() < 0.2)
            sendStrategyOrder(strategy, Math.random() < 0.5, strategy.lot, u.price);
    }

    // One sample per tick while a run is alive - this is what grows the sparkline. A flat run
    // still samples: its curve is level, which is the honest picture.
    function sampleStrategy(strategy) {
        if (strategy.state === StrategyStates.Stopped) return;
        strategy.pnl.push({ time: strategy.samples++, value: strategyPnl(strategy).total - strategy.anchor });
    }

    // The dashboard takes whole snapshots - it has no per-row patch - so a tick
    // repaints it. It holds off while a trading-mode select is open: the repaint
    // replaces the row, and the dropdown would close under the pointer.
    function pushStrategies() {
        const panel = live.get(ControlTypes.Strategies);
        if (!panel) return;
        const focused = document.activeElement;
        if (focused && focused.classList.contains('strategy-mode') && panel.rootEl.contains(focused)) return;
        panel.update(state.strategies.map(toStrategyRow));
    }

    function createStrategies(hostEl) {
        const widget = StrategiesWidget.create(hostEl, {}, {
            host: makeHost(ControlTypes.Strategies),
            // The modes this host can put a run in, in the order it offers them. The
            // control words each one through t(), so these are keys, not captions.
            tradingModes: STRATEGY_MODES,
            // Forming is not instant and the dashboard has a word for the wait, so the
            // host says Starting first and Started once the run has formed.
            start: (id) => {
                const strategy = strategyOf(id);
                if (!strategy || strategy.state !== StrategyStates.Stopped) return;
                logLine('act', `strategies.start("${id}") - ${strategy.name} is forming`, ControlTypes.Strategies);
                strategy.state = StrategyStates.Starting;
                strategy.error = null;
                // A run is measured from where it starts: the change column and the
                // curve both restart here rather than carrying the last run's number.
                strategy.anchor = strategyPnl(strategy).total;
                strategy.pnl = [{ time: strategy.samples++, value: 0 }];
                pushStrategies();
                setTimeout(() => {
                    if (strategy.state !== StrategyStates.Starting) return;
                    strategy.state = StrategyStates.Started;
                    logLine('act', `strategies: ${strategy.name} formed and is running`, ControlTypes.Strategies);
                    pushStrategies();
                }, STRATEGY_TRANSITION_MS);
            },
            // Stopping ends the run, not the position: flattening is its own button, and
            // a host that did both would take off a position nobody asked it to.
            stop: (id) => {
                const strategy = strategyOf(id);
                if (!strategy || strategy.state !== StrategyStates.Started) return;
                logLine('act', `strategies.stop("${id}") - ${strategy.name} is cancelling its orders`, ControlTypes.Strategies);
                strategy.state = StrategyStates.Stopping;
                pushStrategies();
                setTimeout(() => {
                    if (strategy.state !== StrategyStates.Stopping) return;
                    strategy.state = StrategyStates.Stopped;
                    logLine('act', `strategies: ${strategy.name} stopped, still holding ${strategy.position}`, ControlTypes.Strategies);
                    pushStrategies();
                }, STRATEGY_TRANSITION_MS);
            },
            closePosition: (id) => {
                const strategy = strategyOf(id);
                if (!strategy || strategy.position === 0) return;
                const u = universeOf(strategy.symbol);
                logLine('act', `strategies.closePosition("${id}") - flattening ${strategy.position} ${strategy.symbol} at the last price`, ControlTypes.Strategies);
                sendStrategyOrder(strategy, strategy.position < 0, Math.abs(strategy.position), u.price);
                pushStrategies();
            },
            // This demo hosts one board and has no strategy editor, so the call is
            // reported and nothing opens - the same answer `spawn` gives.
            openStrategy: (id) => {
                const strategy = strategyOf(id);
                logLine('act', `strategies.openStrategy("${id}") - a terminal would open ${strategy ? strategy.name : id} on its own board`, ControlTypes.Strategies);
            },
            setTradingMode: (id, mode) => {
                const strategy = strategyOf(id);
                if (!strategy) return;
                logLine('act', `strategies.setTradingMode("${id}", "${mode}") - ${strategy.name} trades to it from the next tick`, ControlTypes.Strategies);
                strategy.mode = mode;
                // No push: the select the user just changed already reads the new mode,
                // and a repaint would pull the focus out of it.
            },
        });
        widget.update(state.strategies.map(toStrategyRow));
        return widget;
    }

    // ------------------------------------------------------------- log monitor

    // The host at the root and every control kind currently on the board under it, each
    // named exactly as its tab is. Sent whole, so a panel that has gone leaves the tree
    // and a selection pointing at it falls back to everything.
    function publishLogSources() {
        const monitor = live.get(ControlTypes.LogMonitor);
        if (!monitor) return;
        monitor.setSources([{ id: HOST_SOURCE, name: LANG.page.hostSource }].concat(
            Object.keys(PANELS)
                .filter(kind => live.has(kind))
                .map(kind => ({ id: kind, name: PANELS[kind].title(), parentId: HOST_SOURCE }))));
    }

    function createLogMonitor(hostEl) {
        const widget = LogMonitorWidget.create(hostEl, {}, {
            host: makeHost(ControlTypes.LogMonitor),
            // The same number the page keeps its own history at, so the panel holds
            // exactly what it would be seeded with after a close.
            maxMessages: LOG_HISTORY,
        });
        // Everything written before this panel existed: the port calls of the panels
        // built ahead of it, and its own `register`, which the widget wrote from its
        // constructor while nothing held a reference to it yet. The queue had nowhere to
        // drain to; the history holds the same lines, so it is what fills the table.
        pendingLog.length = 0;
        widget.append(logHistory.slice());
        return widget;
    }

    // ------------------------------------------------------------- option desk

    // The chain is written on an instrument the page already trades, so the desk
    // re-prices on the same ticks the chart and the ladder move on.
    const CHAIN_SYMBOL = 'BTC@IMEX';

    // A venue lists strikes on a fixed grid and leaves them there: the ladder is listed
    // once around the price and the price then moves through it, which is what carries
    // the in-the-money split across the strikes.
    const CHAIN_STRIKE_STEP = 250;
    const CHAIN_WINGS = 5;

    // The front expiry, two days out and fixed at boot, so the time to expiry the desk
    // is given runs down on the page's own clock.
    const CHAIN_EXPIRY = Date.now() + 2 * 24 * 3600 * 1000;
    const YEAR_MS = 365 * 24 * 3600 * 1000;

    // What this host states about the money rather than about any one contract: a demo
    // money-market rate, and no carry on the underlying.
    const CHAIN_RISK_FREE = 0.045;
    const CHAIN_DIVIDEND = 0;

    // The surface the chain is quoted from: at-the-money volatility, how much the wings
    // lift above it, how much more the downside is worth than the strike the same
    // distance above, and the extra a put carries over the call on its own strike.
    // Measured against the move the underlying has left, which is the space a smile
    // keeps its shape in.
    const CHAIN_ATM_VOL = 0.48;
    const CHAIN_SMILE = 0.03;
    const CHAIN_SKEW = 0.05;
    const CHAIN_PUT_OVER_CALL = 0.005;

    // Half the bid/ask, in volatility as well: a desk quotes an option in vol and the
    // two prices follow from it, which is what makes `ivBid` and `ivAsk` the
    // volatilities the quotes beside them were solved from.
    const CHAIN_VOL_SPREAD = 0.008;

    // The underlying's realized volatility as the venue reports it: one figure for the
    // whole chain, because it belongs to the underlying and not to any strike, and under
    // the implied, which is the usual state of affairs.
    const CHAIN_HISTORICAL_VOL = 0.44;

    // One entry per strike, holding what a venue keeps between prints: the two contract
    // symbols, the open interest each carries, the volume each has traded today, and
    // where in its spread the last print landed.
    let chain = [];

    function chainBook(symbol, strike, spot, put) {
        // Heaviest at the money and thinning into the wings, and heavier on the put
        // side, where the hedges are - the difference the desk's two volume scales
        // exist to keep readable.
        const distance = (strike - spot) / (CHAIN_WINGS * CHAIN_STRIKE_STEP);
        const shape = Math.exp(-2.2 * distance * distance) * (put ? 1.6 : 1);
        return {
            symbol,
            openInterest: Math.round(shape * 900 * (0.7 + Math.random() * 0.6)),
            volume: Math.round(shape * 180 * (0.5 + Math.random())),
            lastBias: 0.35 + Math.random() * 0.3,
        };
    }

    // The ladder: an odd number of strikes on the venue's grid, the middle one at the
    // strike nearest the money.
    function listChain(spot) {
        const middle = Math.round(spot / CHAIN_STRIKE_STEP) * CHAIN_STRIKE_STEP;
        const root = CHAIN_SYMBOL.split('@')[0];
        const expiry = new Date(CHAIN_EXPIRY).toISOString().slice(0, 10);
        chain = [];
        for (let i = -CHAIN_WINGS; i <= CHAIN_WINGS; i++) {
            const strike = middle + i * CHAIN_STRIKE_STEP;
            const name = `${root}-${expiry.replace(/-/g, '')}-${strike}`;
            chain.push({
                strike,
                call: chainBook(`${name}-C`, strike, spot, false),
                put: chainBook(`${name}-P`, strike, spot, true),
            });
        }
        logLine('data', `option desk: listed ${chain.length} strikes on ${CHAIN_SYMBOL}, ${chain[0].strike} to ${chain[chain.length - 1].strike}, expiring ${expiry}`, ControlTypes.OptionDesk);
    }

    // Two strikes of room either side: a price sitting on the outermost rung has no wing
    // left to read, and a venue would have listed more by then.
    function chainBrackets(spot) {
        return chain.length > 0
            && spot > chain[0].strike + 2 * CHAIN_STRIKE_STEP
            && spot < chain[chain.length - 1].strike - 2 * CHAIN_STRIKE_STEP;
    }

    // One contract, quoted the way a desk quotes one: a volatility for the strike, and
    // the prices Black-Scholes gives at the two ends of the spread around it. No greeks
    // travel with it - the volatility and the context are everything the desk needs to
    // price those itself.
    function chainSide(entry, put, spot, years) {
        const book = put ? entry.put : entry.call;
        const type = put ? OptionTypes.Put : OptionTypes.Call;
        // Distance from the money in standard deviations of the move that is left,
        // floored at a day so a chain still quotes on its expiry date.
        const move = CHAIN_ATM_VOL * Math.sqrt(Math.max(years, 1 / 365));
        const distance = Math.log(entry.strike / spot) / move;
        const mid = Math.max(0.05, CHAIN_ATM_VOL
            + CHAIN_SMILE * distance * distance
            - CHAIN_SKEW * distance
            + (put ? CHAIN_PUT_OVER_CALL : 0));
        const spread = CHAIN_VOL_SPREAD * (1 + Math.abs(distance));
        const bidVol = Math.max(0.01, mid - spread);
        const askVol = mid + spread;
        const lastVol = bidVol + (askVol - bidVol) * book.lastBias;
        const at = (vol) => premium(type, {
            assetPrice: spot,
            strike: entry.strike,
            timeToExpiry: years,
            riskFree: CHAIN_RISK_FREE,
            dividend: CHAIN_DIVIDEND,
            deviation: vol,
        });

        return {
            symbol: book.symbol,
            bid: at(bidVol),
            ask: at(askVol),
            last: at(lastVol),
            theoretical: at(mid),
            volume: book.volume,
            openInterest: book.openInterest,
            ivBid: bidVol,
            ivAsk: askVol,
            ivLast: lastVol,
            historicalVolatility: CHAIN_HISTORICAL_VOL,
        };
    }

    // A tick is somebody trading, and what they trade is near the money: the print goes
    // to the strike closest to the spot, so the volume bars follow the underlying. Open
    // interest is the venue's overnight figure and does not move with it.
    function tradeChain(spot) {
        const nearest = chain.reduce((best, entry) =>
            (Math.abs(entry.strike - spot) < Math.abs(best.strike - spot) ? entry : best), chain[0]);
        const book = Math.random() < 0.5 ? nearest.call : nearest.put;
        book.volume += Math.round(1 + Math.random() * 12);
    }

    // The chain and the context it is priced against go in one call, because they are one
    // observation: greeks solved against a spot the desk was told about separately would
    // describe a moment that never happened. The frame is built once and handed to both option
    // panels for the same reason - a desk and a smile quoting two different spots are quoting
    // two different moments.
    let chainFrame = null;

    function stepChain() {
        const u = universeOf(CHAIN_SYMBOL);
        const years = Math.max(0, (CHAIN_EXPIRY - Date.now()) / YEAR_MS);
        if (!chainBrackets(u.price)) listChain(u.price);
        tradeChain(u.price);
        chainFrame = {
            strikes: chain.map(entry => ({
                strike: entry.strike,
                call: chainSide(entry, false, u.price, years),
                put: chainSide(entry, true, u.price, years),
            })),
            context: {
                assetPrice: u.price,
                timeToExpiry: years,
                riskFree: CHAIN_RISK_FREE,
                dividend: CHAIN_DIVIDEND,
            },
        };
        return chainFrame;
    }

    function pushOptionChain() {
        const frame = stepChain();
        for (const kind of [ControlTypes.OptionDesk, ControlTypes.OptionSmile]) {
            const panel = live.get(kind);
            if (panel) panel.update(frame.strikes, frame.context);
        }
    }

    // A panel opened between ticks has missed the frame its neighbour is showing, so it is given
    // that one rather than trading the chain a second time to build its own.
    function seedOptionPanel(widget) {
        const frame = chainFrame || stepChain();
        widget.update(frame.strikes, frame.context);
    }

    function createOptionDesk(hostEl) {
        const widget = OptionDeskWidget.create(hostEl, {}, { host: makeHost(ControlTypes.OptionDesk) });
        // The host shape that sends volatility rather than greeks: this demo has quotes
        // and an expiry but no pricing service, so it sends the volatility each quote
        // was solved from and the desk prices delta through rho from that.
        logLine('data', `option desk: quoting ${CHAIN_SYMBOL} options in volatility - the desk computes the greeks`, ControlTypes.OptionDesk);
        seedOptionPanel(widget);
        return widget;
    }

    // ------------------------------------------------------------------ equity

    // The run's own equity, from the same replay the statistics table reads. One walk of the
    // tape produces both, which is the point: a curve and a net-profit row that disagreed would
    // be two answers to one question.
    //
    // A point per fill rather than per tick - a fill is when the number actually moved, and a
    // tick that filled nothing draws a flat step that says nothing.
    function equityPoints() {
        const ledger = new Map();
        // The last price each instrument was seen at, walking the session forward. An open
        // position is worth what it was worth then, which is what an equity curve plots.
        const marks = new Map();
        const points = [];
        let realized = 0;

        for (const fill of state.trades.slice().reverse()) {
            const quantity = Math.abs(fill.quantity);
            const signed = isBuy(fill.side) ? quantity : -quantity;
            let held = ledger.get(fill.instrumentSymbol);
            if (!held) {
                held = { quantity: 0, avgPrice: fill.price };
                ledger.set(fill.instrumentSymbol, held);
            }

            const oldQty = held.quantity;
            const newQty = oldQty + signed;
            if (oldQty === 0 || Math.sign(oldQty) === Math.sign(signed)) {
                held.avgPrice = (Math.abs(oldQty) * held.avgPrice + quantity * fill.price) / (Math.abs(oldQty) + quantity);
            } else {
                const closed = Math.min(Math.abs(oldQty), quantity);
                realized += (fill.price - held.avgPrice) * closed * Math.sign(oldQty);
                if (newQty !== 0 && Math.sign(newQty) !== Math.sign(oldQty)) held.avgPrice = fill.price;
            }
            held.quantity = newQty;

            // Marked where the fill left the book, so the curve carries the open position too -
            // realized alone would draw a staircase that only moves when something is closed.
            //
            // At the prices of that moment, not today's: marking every historical point at the
            // current price makes each one answer a question about now, and the curve reads as
            // noise because a position taken hours ago is scored against a price it never saw.
            marks.set(fill.instrumentSymbol, fill.price);
            let open = 0;
            for (const [symbol, book] of ledger) {
                const mark = marks.get(symbol);
                if (mark !== undefined && book.quantity !== 0) open += (mark - book.avgPrice) * book.quantity;
            }
            // Milliseconds, because that is what `presentation.timeText` is handed everywhere
            // else on this page: a number in seconds reads as a moment in 1970 and dates the
            // axis with it.
            points.push({ time: Date.parse(fill.executedAt), value: realized + open });
        }

        // Where the run stands now. Only the last point is marked at live prices: it is the one
        // that answers "what is this worth", and it is why the curve keeps moving between fills.
        if (points.length > 0) {
            let open = 0;
            for (const [symbol, book] of ledger) {
                const u = universeOf(symbol);
                if (u && book.quantity !== 0) open += (u.price - book.avgPrice) * book.quantity;
            }
            points.push({ time: Date.now(), value: realized + open });
        }
        return points;
    }

    // The high-water mark of the session already behind the page: the highest the run stood,
    // when it stood there, and the largest fall from a peak along the way.
    function seedEquityMark() {
        const mark = { peak: 0, peakAt: null, drawdown: 0 };
        for (const point of equityPoints()) {
            if (point.value > mark.peak) {
                mark.peak = point.value;
                mark.peakAt = new Date(point.time).toISOString();
            }
            const fall = mark.peak - point.value;
            if (fall > mark.drawdown) mark.drawdown = fall;
        }
        return mark;
    }

    function pushEquity() {
        const panel = live.get(ControlTypes.Equity);
        if (panel) panel.update(equityPoints());
    }

    function createEquity(hostEl) {
        const widget = EquityWidget.create(hostEl, {}, { host: makeHost(ControlTypes.Equity) });
        widget.update(equityPoints());
        return widget;
    }

    // ------------------------------------------------------- optimisation heatmap

    // A parameter sweep, as one would arrive from a run of them: two parameters varied, one
    // metric measured at each pair. Invented here the way the chain and the strategies are -
    // this page has no optimiser behind it - but shaped exactly as a real sweep is, so the
    // control is fed nothing a report would not carry.
    //
    // The surface has a ridge rather than a single peak, because that is what a real sweep of a
    // moving-average pair looks like: a band of settings that work and cliffs either side.
    const SWEEP_FAST = [4, 6, 8, 10, 13, 16, 20, 25, 31, 38, 47, 58];
    const SWEEP_SLOW = [25, 35, 48, 65, 88, 115, 150, 190, 240, 300];

    function sweepCells() {
        const cells = [];
        for (const fast of SWEEP_FAST) {
            for (const slow of SWEEP_SLOW) {
                // A pair that does not separate is not a crossover at all, and a sweep would
                // have no result for it. Left out, so the map has a gap where the runs do.
                if (slow <= fast * 2) continue;
                const ratio = Math.log(slow / fast);
                const ridge = Math.exp(-Math.pow(ratio - 1.9, 2) * 1.6);
                const cost = fast < 8 ? 0.55 : 1;
                cells.push({
                    x: String(fast),
                    y: String(slow),
                    value: Math.round((ridge * cost * 14200 - 2600) * 100) / 100,
                });
            }
        }
        return cells;
    }

    function createOptimizationHeatmap(hostEl) {
        const widget = OptimizationHeatmapWidget.create(hostEl, {}, { host: makeHost(ControlTypes.OptimizationHeatmap) });
        logLine('data', `optimization: ${SWEEP_FAST.length} x ${SWEEP_SLOW.length} sweep of a moving-average pair`, ControlTypes.OptimizationHeatmap);
        widget.update({
            xLabel: LANG.page.sweepFast,
            yLabel: LANG.page.sweepSlow,
            metricLabel: LANG.stats.names.NetProfit,
            betterWhen: HeatDirections.Higher,
            cells: sweepCells(),
        });
        return widget;
    }

    // The same sweep as a landscape. One set of results, two ways of reading it: the map
    // compares cells, the surface shows the shape they make.
    function createOptimizationSurface(hostEl) {
        const widget = SurfaceWidget.create(hostEl, {}, { host: makeHost(ControlTypes.OptimizationSurface) });
        widget.update({
            xLabel: LANG.page.sweepFast,
            yLabel: LANG.page.sweepSlow,
            metricLabel: LANG.stats.names.NetProfit,
            betterWhen: HeatDirections.Higher,
            cells: sweepCells(),
        });
        return widget;
    }

    function createOptionSmile(hostEl) {
        const widget = OptionSmileWidget.create(hostEl, {}, { host: makeHost(ControlTypes.OptionSmile) });
        // The same rows the desk is given, off the same frame: the smile reads the chain the desk
        // is tabulating, and neither is told anything the other is not.
        logLine('data', `option smile: ${CHAIN_SYMBOL} implied volatility by strike, both sides on one scale`, ControlTypes.OptionSmile);
        seedOptionPanel(widget);
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
            accent: token('--t-accent', '#4a9eff'),
            orange: token('--t-orange', '#e8a33d'),
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
        // Kept so a tick can extend it: the studies and the legend read the whole window, not
        // just the bar that moved.
        panel.bars = bars;
        // One call for both, so the strip cannot end up reading the window before last.
        panel.ui.setCandles(panel.bars);
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

        // The chart's own UI layer: the crosshair legend, the right-click menu, the indicator
        // picker and the pane chrome an oscillator lands in. One call, and none of it lives here -
        // this page is a demo of the trading controls, and the chart beside them is the chart
        // package's business.
        const ui = SSChartUI.createChartUi(chart, {
            container: wrap,
            host: SSChartUI.standaloneHost,
            priceSource: candles,
            chartTypes: [],
            storage: SSChartUI.localChartUiStorage('sstradingcontrols:demo'),
        });

        const panel = { chart, candles, volume, ui, last: null, lastVol: null };
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
        const bar = { ...panel.last, volume: panel.lastVol.value };
        if (panel.bars[panel.bars.length - 1].time === time) panel.bars[panel.bars.length - 1] = bar;
        else panel.bars.push(bar);
        panel.ui.setCandles(panel.bars);
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
        // The sub-panes an oscillator was dropped into get the same options: the engine gives each
        // its own chart, and a theme flip that skipped them would leave them on the old palette.
        chartPanel.ui.paneManager.getPanes().forEach((id) => {
            const pane = chartPanel.ui.paneManager.getChart(id);
            if (pane) pane.applyOptions({ layout: { background: { type: 'solid', color: colors.bg }, textColor: colors.text } });
        });
    }

    // ---------------------------------------------------------- host port log

    function createHostLog(hostEl) {
        // The buttons ride in an element the tab lift picks up, so the log gets
        // the same single-row chrome every other panel has.
        const actions = document.createElement('div');
        actions.className = 'hostlog-actions';

        const note = document.createElement('span');
        note.className = 'hostlog-note';
        note.textContent = LANG.page.hostLogNote;
        actions.appendChild(note);

        const clear = document.createElement('button');
        clear.type = 'button';
        clear.className = 'tbtn tbtn-sm';
        clear.textContent = LANG.page.clearLog;
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
        chart: { label: 'chart', title: () => `${LANG.page.chart} · ${BOOK_SYMBOL}`, create: createChartPanel },
        [ControlTypes.Watchlist]: { label: 'watchlist', title: () => translate('Watchlist'), create: createWatchlist, lift: ['.watchlist-search-row'] },
        [ControlTypes.Positions]: { label: 'positions', title: () => translate('Positions'), create: createPositions },
        [ControlTypes.ActiveOrders]: { label: 'active orders', title: () => translate('ActiveOrders'), create: createOrders },
        [ControlTypes.TradeHistory]: { label: 'trade history', title: () => translate('TradeHistory'), create: createHistory },
        [ControlTypes.OrderEntry]: { label: 'order entry', title: () => translate('OrderEntry'), create: createOrderEntry },
        [ControlTypes.TradeFeed]: { label: 'trade feed', title: () => translate('TradeFeed'), create: createTradeFeed },
        [ControlTypes.OrderBook]: { label: 'order book', title: () => translate('OrderBook'), create: createOrderBook },
        [ControlTypes.Statistics]: { label: 'statistics', title: () => translate('Statistics'), create: createStatistics },
        [ControlTypes.Strategies]: { label: 'strategies', title: () => translate('Strategies'), create: createStrategies },
        [ControlTypes.OptionDesk]: { label: 'option desk', title: () => translate('OptionDesk'), create: createOptionDesk },
        [ControlTypes.OptionSmile]: { label: 'option smile', title: () => translate('OptionSmile'), create: createOptionSmile },
        [ControlTypes.Equity]: { label: 'equity', title: () => translate('Equity'), create: createEquity },
        [ControlTypes.OptimizationHeatmap]: { label: 'optimization', title: () => translate('OptimizationHeatmap'), create: createOptimizationHeatmap },
        [ControlTypes.OptimizationSurface]: { label: 'optimization surface', title: () => translate('OptimizationSurface'), create: createOptimizationSurface },
        [ControlTypes.LogMonitor]: { label: 'log monitor', title: () => translate('LogMonitor'), create: createLogMonitor },
        hostlog: { label: 'host log', title: () => LANG.page.hostLog, create: createHostLog, lift: ['.hostlog-actions'] },
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
                // The log's source tree names what is on the board, so the board
                // changing republishes it.
                publishLogSources();
                // Next tick, because the tab element joins the DOM as part of
                // the same addPanel this init runs in.
                setTimeout(() => liftHeaderToTab(kind, element), 0);
            },
            dispose() {
                if (widget && typeof widget.dispose === 'function') {
                    try { widget.dispose(); } catch (err) { logLine('warn', `${panel.label}: dispose failed — ${err.message}`, HOST_SOURCE); }
                }
                widget = null;
                live.delete(kind);
                publishLogSources();
                logLine('act', `the ${panel.label} panel left the dock`, HOST_SOURCE);
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

    // The same breakpoint the terminal (and this page's `maxDepth` dep) tests.
    const MOBILE_BREAKPOINT = window.matchMedia('(max-width: 768px)');

    // Which board this page is. One page with every panel on it made a trading screen that
    // also optimised strategies and monitored a log - three jobs no one screen has, and a
    // reader looking for the ladder had to find it among fifteen tabs. So the demo is three
    // pages over one set of data: the panels, the host and the tape are shared, and a board
    // decides only which panels are on it and where.
    const BOARD = dockEl.dataset.board || 'terminal';

    // The phone board, per board: one column, every panel under the previous, the page scrolls.
    // Order and height per row - the pad and the ladder need more room than a blotter.
    const MOBILE_BOARDS = {
        terminal: [
            ['chart', 340],
            [ControlTypes.OrderBook, 400],
            [ControlTypes.OrderEntry, 440],
            [ControlTypes.TradeFeed, 360],
            [ControlTypes.Watchlist, 400],
            [ControlTypes.ActiveOrders, 300],
            [ControlTypes.TradeHistory, 300],
            [ControlTypes.Positions, 300],
            [ControlTypes.OptionDesk, 340],
            [ControlTypes.OptionSmile, 300],
            ['hostlog', 300],
        ],
        strategies: [
            [ControlTypes.Strategies, 320],
            [ControlTypes.Equity, 320],
            [ControlTypes.Statistics, 380],
            [ControlTypes.LogMonitor, 360],
            ['hostlog', 300],
        ],
        optimization: [
            [ControlTypes.OptimizationHeatmap, 380],
            [ControlTypes.OptimizationSurface, 380],
            ['hostlog', 300],
        ],
    };

    const MOBILE_ROWS = MOBILE_BOARDS[BOARD] || MOBILE_BOARDS.terminal;

    // The trading screen: chart on the left, the tape and the ladder to its right, the
    // watchlist under the ladder, the order pad and the blotters (tabbed) along the bottom.
    function buildTerminalBoard() {
        addDockPanel('chart', null);
        addDockPanel(ControlTypes.OrderEntry, { referencePanel: 'chart', direction: 'below' }, { initialHeight: 260 });
        addDockPanel(ControlTypes.TradeFeed, { referencePanel: 'chart', direction: 'right' }, { initialWidth: 280 });
        addDockPanel(ControlTypes.OrderBook, { referencePanel: ControlTypes.TradeFeed, direction: 'right' }, { initialWidth: 340 });
        addDockPanel(ControlTypes.Watchlist, { referencePanel: ControlTypes.OrderBook, direction: 'below' }, { initialHeight: 300 });
        addDockPanel(ControlTypes.ActiveOrders, { referencePanel: ControlTypes.OrderEntry, direction: 'right' });
        addDockPanel(ControlTypes.TradeHistory, { referencePanel: ControlTypes.ActiveOrders, direction: 'within' });
        addDockPanel(ControlTypes.Positions, { referencePanel: ControlTypes.ActiveOrders, direction: 'within' });
        addDockPanel(ControlTypes.OptionDesk, { referencePanel: ControlTypes.ActiveOrders, direction: 'within' });
        addDockPanel(ControlTypes.OptionSmile, { referencePanel: ControlTypes.ActiveOrders, direction: 'within' });
        addDockPanel('hostlog', { referencePanel: ControlTypes.ActiveOrders, direction: 'within' });

        const orders = dockApi.getPanel(ControlTypes.ActiveOrders);
        if (orders) orders.api.setActive();
    }

    // What a running strategy looks like: the dashboard across the top, its equity and its
    // statistics under it, and what it said in the log beside them. Nothing here is a place to
    // trade from - that is the terminal board.
    function buildStrategiesBoard() {
        addDockPanel(ControlTypes.Strategies, null);
        addDockPanel(ControlTypes.Equity, { referencePanel: ControlTypes.Strategies, direction: 'below' }, { initialHeight: 420 });
        addDockPanel(ControlTypes.Statistics, { referencePanel: ControlTypes.Equity, direction: 'right' }, { initialWidth: 460 });
        addDockPanel(ControlTypes.LogMonitor, { referencePanel: ControlTypes.Statistics, direction: 'right' }, { initialWidth: 560 });
        addDockPanel('hostlog', { referencePanel: ControlTypes.LogMonitor, direction: 'within' });

        const monitor = dockApi.getPanel(ControlTypes.LogMonitor);
        if (monitor) monitor.api.setActive();
    }

    // One sweep, two readings: the map compares pairs, the landscape shows the shape they make.
    // Side by side on purpose - they are the same numbers, and the point is that neither answers
    // the other's question.
    function buildOptimizationBoard() {
        addDockPanel(ControlTypes.OptimizationHeatmap, null);
        addDockPanel(ControlTypes.OptimizationSurface, { referencePanel: ControlTypes.OptimizationHeatmap, direction: 'right' });
        addDockPanel('hostlog', { referencePanel: ControlTypes.OptimizationHeatmap, direction: 'below' }, { initialHeight: 200 });
    }

    const DESKTOP_BOARDS = {
        terminal: buildTerminalBoard,
        strategies: buildStrategiesBoard,
        optimization: buildOptimizationBoard,
    };

    function buildDefaultLayout() {
        if (MOBILE_BREAKPOINT.matches) {
            buildMobileLayout();
            return;
        }

        // The dock's height is the CSS rule's business again after a mobile build pinned it.
        dockEl.style.height = '';

        (DESKTOP_BOARDS[BOARD] || buildTerminalBoard)();

        // initialWidth/initialHeight are advisory while the tree is being built; the real
        // proportions are pushed once dockview has laid out - the same double-rAF the terminal
        // uses.
        requestAnimationFrame(() => requestAnimationFrame(applyRatios));
    }

    function buildMobileLayout() {
        // The dock is as tall as its rows add up to and the page scrolls
        // through it — a fixed height, because dockview distributes whatever
        // box it is given and a phone board must not squeeze nine panels into
        // one screen.
        dockEl.style.height = MOBILE_ROWS.reduce((sum, [, height]) => sum + height, 0) + 'px';

        let previous = null;
        for (const [kind] of MOBILE_ROWS) {
            addDockPanel(kind, previous ? { referencePanel: previous, direction: 'below' } : null);
            previous = kind;
        }

        requestAnimationFrame(() => requestAnimationFrame(() => {
            if (!dockApi) return;
            for (const [kind, height] of MOBILE_ROWS) {
                const panel = dockApi.getPanel(kind);
                if (panel && panel.group) panel.group.api.setSize({ height });
            }
        }));
    }

    // What dockview splits evenly is rarely what a board wants, so each says its own proportions
    // once the tree has been laid out. Shares of the board rather than pixels: the same page is
    // opened on a laptop and on a wall.
    function applyRatios() {
        if (!dockApi) return;
        const width = dockEl.clientWidth || 1440;
        const height = dockEl.clientHeight || 900;
        const setSize = (kind, box) => {
            const panel = dockApi.getPanel(kind);
            if (panel && panel.group) panel.group.api.setSize(box);
        };

        if (BOARD === 'strategies') {
            // The dashboard is a handful of rows however many strategies there are; the three
            // panels under it are the ones a reader dwells on.
            setSize(ControlTypes.Strategies, { height: Math.max(200, Math.floor(height * 0.30)) });
            setSize(ControlTypes.Equity, { width: Math.floor(width * 0.34) });
            setSize(ControlTypes.Statistics, { width: Math.floor(width * 0.28) });
            return;
        }

        if (BOARD === 'optimization') {
            // Half each to the two readings of the sweep. The log is a strip under them: it is
            // here to show the port traffic, not to be read alongside a landscape.
            setSize(ControlTypes.OptimizationHeatmap, { width: Math.floor(width * 0.46) });
            setSize('hostlog', { height: 180 });
            return;
        }

        setSize('chart', { width: Math.floor(width * 0.50) });
        setSize(ControlTypes.TradeFeed, { width: Math.floor(width * 0.22) });
        setSize(ControlTypes.OrderBook, { width: Math.floor(width * 0.28) });
        // The bottom row is the order pad beside the tabbed blotters. An option chain of eleven
        // strikes needs more than the pad's own 260px, so the row takes a share of the board and
        // the pad's height is the floor rather than the figure.
        const bottom = Math.max(260, Math.floor(height * 0.38));
        setSize(ControlTypes.OrderEntry, { height: bottom });
        // The right column splits between the ladder and the watchlist; the ladder gets the
        // larger share - ten levels a side need the room.
        setSize(ControlTypes.Watchlist, { height: Math.floor((height - bottom) * 0.42) });
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

        for (const strategy of state.strategies) {
            stepStrategy(strategy);
            sampleStrategy(strategy);
        }
        pushStrategies();

        pushOptionChain();

        for (const order of Array.from(state.orders)) checkFill(order);

        // Prices moved, so the open positions are worth something else even on a tick
        // that filled nothing.
        pushStatistics();
        pushEquity();
    }

    let autoTimer = null;

    function toggleAuto(button) {
        if (autoTimer) {
            clearInterval(autoTimer);
            autoTimer = null;
            button.classList.remove('on');
            logLine('act', 'auto ticks stopped', HOST_SOURCE);
            return;
        }
        autoTimer = setInterval(tick, 1200);
        button.classList.add('on');
        logLine('act', 'auto ticks started — one tick every 1.2s', HOST_SOURCE);
    }

    // ------------------------------------------------------------------ startup

    // The page's own chrome — buttons, statusbar, the language button itself.
    // Everything inside the panels is re-captioned by re-creating the controls,
    // which is what the language switch below does.
    function applyPageText() {
        document.getElementById('tickBtn').textContent = LANG.page.simulateTick;
        document.getElementById('autoBtn').innerHTML = '<span class="dot"></span> ' + LANG.page.autoTicks;
        document.getElementById('resetBtn').textContent = LANG.page.resetData;
        document.getElementById('layoutBtn').textContent = LANG.page.resetLayout;
        const light = document.documentElement.getAttribute('data-bs-theme') === 'light';
        document.getElementById('themeBtn').textContent = light ? LANG.page.themeDark : LANG.page.themeLight;
        document.getElementById('langBtn').textContent = LANG.switchTo;
        document.querySelector('.demo-statusbar .status-left').textContent = LANG.page.statusLeft;
        for (const link of document.querySelectorAll('[data-board-link]')) {
            const board = link.dataset.boardLink;
            link.textContent = LANG.page.boards[board] || board;
            link.classList.toggle('is-current', board === BOARD);
        }
    }

    resetState();
    seedBaselines();
    initDock();
    pushPrices();
    pushOrderEntry();
    applyPageText();

    document.getElementById('tickBtn').addEventListener('click', tick);
    document.getElementById('autoBtn').addEventListener('click', (e) => toggleAuto(e.currentTarget));

    document.getElementById('resetBtn').addEventListener('click', () => {
        resetState();
        logLine('act', 'reset — sample prices, positions, orders and fills restored', HOST_SOURCE);
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
        pushStrategies();
        pushStatistics();
        pushEquity();
        chain = [];
        chainFrame = null;
        pushOptionChain();
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
        logLine('act', 'reset layout — rebuilding the default dock', HOST_SOURCE);
        dockApi.clear();
        buildDefaultLayout();
        pushPrices();
        pushOrderEntry();
    });

    // Crossing the breakpoint rebuilds the board in the other shape — the same
    // path the Reset layout button takes.
    MOBILE_BREAKPOINT.addEventListener('change', () => {
        logLine('act', `viewport crossed the mobile breakpoint — rebuilding as ${MOBILE_BREAKPOINT.matches ? 'a single column' : 'the desktop board'}`, HOST_SOURCE);
        dockApi.clear();
        buildDefaultLayout();
        pushPrices();
        pushOrderEntry();
    });

    // The package's own theme.css keys its light palette off `data-bs-theme`, and
    // demo.css re-declares the same tokens under the same attribute — one switch
    // moves the page, every panel, the dockview chrome and the chart at once.
    document.getElementById('themeBtn').addEventListener('click', () => {
        const root = document.documentElement;
        const light = root.getAttribute('data-bs-theme') === 'light';
        root.setAttribute('data-bs-theme', light ? 'dark' : 'light');
        applyPageText();
        applyChartTheme();
    });

    // The proof the controls hardcode nothing: answer `t()` from the other
    // dictionary and re-create every panel through its host. The board comes
    // back fully re-captioned — the package brought no words of its own.
    document.getElementById('langBtn').addEventListener('click', () => {
        LANG = LANG === window.SSDemoText.en ? window.SSDemoText.zh : window.SSDemoText.en;
        document.documentElement.lang = LANG.htmlLang;
        logLine('act', `language switched to ${LANG.code} — re-creating every control through its host`, HOST_SOURCE);
        applyPageText();
        dockApi.clear();
        buildDefaultLayout();
        pushPrices();
        pushOrderEntry();
    });

    const clockEl = document.getElementById('statusClock');
    const showClock = () => { clockEl.textContent = new Date().toLocaleTimeString('en-US', { hour12: false }); };
    showClock();
    setInterval(showClock, 1000);

    logLine('act', 'demo host ready — every panel below is a live control over its own TradingHost', HOST_SOURCE);
})();
