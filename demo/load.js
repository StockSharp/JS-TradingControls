// Load page for @stocksharp/trading-controls.
//
// The tape, and the ladder beside it on request, fed the way the web terminal
// feeds them: one print per socket message, fanned to every live control of a
// kind, at a rate picked on the page — from ten prints a second to five
// hundred. The meters say what that costs while it runs: the frames the browser
// still draws, how often the tape and the ladder repaint, how many DOM nodes
// those paints create, and the share of the main thread spent inside the calls
// the feed makes into the controls.
//
// A run nobody watches starts from the address and reads the counters back:
//   load.html?rate=200&book=1&auto=1
//   window.__loadReset()   — count from now
//   window.__loadReport()  — what was counted since
//
// The host below is the port implemented as thinly as it can be. This page
// feeds the controls and trades nothing, so the trading calls answer empty.

(function () {
    'use strict';

    const {
        TradeFeedWidget,
        OrderBookWidget,
        ControlTypes,
        MarketDataLevels,
        PRESENTATION_CLASSES,
        formatTime,
    } = window.SSTradingControls;

    const TEXT = window.SSDemoText;
    let LANG = TEXT.en;

    const SYMBOL = 'BTC@IMEX';
    const RATES = [0, 10, 50, 100, 200, 500];
    // The ladder gets a frame for every fourth print: a venue moves its book less
    // often than it prints, and a ladder fed at the tape's rate would measure a
    // feed nobody sends.
    const PRINTS_PER_BOOK_FRAME = 4;
    const BOOK_LEVELS = 12;
    const TICK = 0.5;

    const params = new URLSearchParams(location.search);
    let rate = RATES.includes(Number(params.get('rate'))) ? Number(params.get('rate')) : 0;
    let withBook = params.get('book') === '1';
    const autoStart = params.get('auto') === '1';

    // ------------------------------------------------------------- counters

    // Everything the meters show, counted from the last reset. `busyMs` is the
    // time spent inside the controls: the deliveries below, and the paints a
    // control asked a frame for.
    const counters = {
        startedAt: performance.now(),
        prints: 0,
        bookFrames: 0,
        paints: 0,
        nodes: 0,
        frames: 0,
        busyMs: 0,
    };

    function resetCounters() {
        counters.startedAt = performance.now();
        counters.prints = 0;
        counters.bookFrames = 0;
        counters.paints = 0;
        counters.nodes = 0;
        counters.frames = 0;
        counters.busyMs = 0;
    }

    function timed(work) {
        const started = performance.now();
        try {
            work();
        } finally {
            counters.busyMs += performance.now() - started;
        }
    }

    // ------------------------------------------------------------------ host

    function translate(key, ...args) {
        const text = LANG.controls[key] === undefined ? String(key) : LANG.controls[key];
        return text.replace(/\{(\d+)\}/g, (match, index) => {
            const arg = args[Number(index)];
            return arg === undefined ? match : String(arg);
        });
    }

    const isBuy = (side) => side === 0 || side === 'Buy' || side === 'BUY';
    const [SIDE_BUY_CLASS, SIDE_SELL_CLASS] = PRESENTATION_CLASSES.sideClass;
    const [PNL_POSITIVE_CLASS, PNL_NEGATIVE_CLASS] = PRESENTATION_CLASSES.pnlClass;

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

    // The terminal's own presentation reads the clock through the package's
    // formatter, so this page does too: the cost measured is the cost shipped.
    const presentation = {
        sideText: (side) => (isBuy(side) ? LANG.side.buy : LANG.side.sell),
        isBuy,
        canvasPalette,
        typeText: () => 'LMT',
        statusText: (status) => String(status),
        timeText: (value) => formatTime(value),
        sideClass: (side) => (isBuy(side) ? SIDE_BUY_CLASS : SIDE_SELL_CLASS),
        pnlClass: (pnl) => (pnl > 0 ? PNL_POSITIVE_CLASS : pnl < 0 ? PNL_NEGATIVE_CLASS : ''),
    };

    function memoryStore() {
        const bag = new Map();
        return {
            get: (key, fallback) => (bag.has(key) ? bag.get(key) : fallback),
            set: (key, value) => { if (value === null) bag.delete(key); else bag.set(key, String(value)); },
        };
    }

    const preferences = memoryStore();
    const cache = memoryStore();

    // Frames are the browser's. A page nobody is looking at draws none: what was
    // asked of it waits until the page is shown again. requestAnimationFrame
    // already holds its callbacks in a background tab; the page holds them too,
    // so a tab that only says it is hidden behaves the same.
    const heldPaints = [];

    const frames = {
        request(paint) {
            if (document.hidden) {
                heldPaints.push(paint);
                return;
            }
            requestAnimationFrame(() => timed(paint));
        },
    };

    document.addEventListener('visibilitychange', () => {
        if (document.hidden)
            return;
        for (const paint of heldPaints.splice(0))
            requestAnimationFrame(() => timed(paint));
    });

    const registry = new Map();

    function makeHost(kind) {
        if (!registry.has(kind)) registry.set(kind, new Set());
        const peers = registry.get(kind);

        return {
            isPrimary: peers.size === 0,
            t: translate,
            presentation,
            preferences,
            cache,
            trading: {
                api: {
                    getExecutions: () => Promise.resolve([]),
                    searchInstruments: () => Promise.resolve([]),
                },
                marketData: {
                    // A ladder that asked for the depth is answered with a
                    // snapshot, which is what makes the diffs after it mean anything.
                    addSymbol: (symbol, level) => {
                        if (level === MarketDataLevels.Full) setTimeout(() => sendSnapshot(), 0);
                        return Promise.resolve(true);
                    },
                    removeSymbol: () => Promise.resolve(true),
                    resubscribe: () => { sendSnapshot(); return Promise.resolve(); },
                    getOrders: () => [],
                },
                portfolioId: () => null,
                pickInstrument: () => { },
            },
            ticker: { publish: () => { } },
            allow: () => true,
            log: (message) => console.warn(`${kind}: ${message}`),
            close: () => { },
            spawn: () => { },
            persistState: () => { },
            saveLayout: () => { },
            register: (control) => peers.add(control),
            unregister: (control) => peers.delete(control),
            broadcast: (apply) => { for (const control of Array.from(peers)) apply(control); },
            frames,
        };
    }

    // ------------------------------------------------------------- the feed

    // A random walk the prints and the book follow, so the tape reads like one.
    let price = 68400;
    const book = { bids: new Map(), asks: new Map(), sequence: 0 };

    const roundToTick = (value) => Math.round(value / TICK) * TICK;

    function nextPrint() {
        price = Math.max(TICK, roundToTick(price + (Math.random() - 0.5) * 4 * TICK));
        const buy = Math.random() < 0.5;
        // Mostly small, now and then a print twenty times the usual, which is
        // what the tape's "unusually large" mark is for.
        const quantity = Number((Math.random() < 0.03 ? 5 + Math.random() * 20 : Math.random() * 1.5 + 0.01).toFixed(3));
        return { symbol: SYMBOL, side: buy ? 'Buy' : 'Sell', price, quantity, time: new Date().toISOString() };
    }

    function rebuildBook() {
        book.bids.clear();
        book.asks.clear();
        for (let i = 1; i <= BOOK_LEVELS; i++) {
            book.bids.set(roundToTick(price - TICK * i), Number((Math.random() * 5 + 0.1).toFixed(3)));
            book.asks.set(roundToTick(price + TICK * i), Number((Math.random() * 5 + 0.1).toFixed(3)));
        }
    }

    function sendSnapshot() {
        rebuildBook();
        book.sequence += 1;
        post({
            frame: {
                symbol: SYMBOL,
                sequence: book.sequence,
                isSnapshot: true,
                bids: [...book.bids].map(([p, q]) => ({ price: p, quantity: q })),
                asks: [...book.asks].map(([p, q]) => ({ price: p, quantity: q })),
            },
        });
    }

    // Three levels resize on each side; the book is rebuilt around the last
    // print once the print has wandered off it, through a snapshot as a real
    // feed would.
    function nextBookFrame() {
        const bestBid = Math.max(...book.bids.keys());
        const bestAsk = Math.min(...book.asks.keys());
        if (price < bestBid - TICK * 4 || price > bestAsk + TICK * 4)
            return null;

        const bids = [];
        const asks = [];
        for (const [side, changes] of [[book.bids, bids], [book.asks, asks]]) {
            const prices = [...side.keys()];
            for (let i = 0; i < 3; i++) {
                const level = prices[Math.floor(Math.random() * prices.length)];
                const quantity = Number((Math.random() * 5 + 0.1).toFixed(3));
                side.set(level, quantity);
                changes.push({ price: level, quantity });
            }
        }
        book.sequence += 1;
        return { symbol: SYMBOL, sequence: book.sequence, isSnapshot: false, bids, asks };
    }

    // One message per print: the terminal's socket delivers every print as its
    // own task, and a feed that handed the controls a batch at a time would
    // measure a cheaper page than the one users have.
    const channel = new MessageChannel();
    const post = (message) => channel.port2.postMessage(message);

    channel.port1.onmessage = (event) => {
        const message = event.data;
        timed(() => {
            if (message.trade) {
                counters.prints += 1;
                for (const feed of registry.get(ControlTypes.TradeFeed) || []) feed.addTrade(message.trade);
            } else if (message.frame) {
                counters.bookFrames += 1;
                for (const ladder of registry.get(ControlTypes.OrderBook) || []) ladder.applyFrame(message.frame);
            }
        });
    };

    let feedTimer = null;
    let feedStartedAt = 0;
    let printsSent = 0;

    // Paced from the clock rather than by a timer per print: a timer cannot fire
    // five hundred times a second, the clock says how many prints are due.
    function pump() {
        const due = Math.floor(rate * (performance.now() - feedStartedAt) / 1000) - printsSent;
        for (let i = 0; i < due; i++) {
            printsSent += 1;
            post({ trade: nextPrint() });
            if (withBook && printsSent % PRINTS_PER_BOOK_FRAME === 0) {
                const frame = nextBookFrame();
                if (frame) post({ frame });
                else sendSnapshot();
            }
        }
    }

    function setRate(next) {
        rate = next;
        if (feedTimer !== null) {
            clearInterval(feedTimer);
            feedTimer = null;
        }
        if (rate > 0) {
            feedStartedAt = performance.now();
            printsSent = 0;
            feedTimer = setInterval(pump, 10);
        }
        renderRates();
        resetCounters();
    }

    // ------------------------------------------------------------ the panels

    let feed = null;
    let ladder = null;

    function createPanels() {
        feed?.dispose();
        ladder?.dispose();
        feed = null;
        ladder = null;

        const feedHost = document.getElementById('feedHost');
        const bookHost = document.getElementById('bookHost');
        feedHost.replaceChildren();
        bookHost.replaceChildren();

        feed = TradeFeedWidget.create(feedHost, {}, { host: makeHost(ControlTypes.TradeFeed), ownTradesTab: false });
        feed.setActiveSymbol(SYMBOL);
        feed.setTrades([]);

        bookHost.hidden = !withBook;
        if (withBook) {
            ladder = OrderBookWidget.create(bookHost, {}, {
                host: makeHost(ControlTypes.OrderBook),
                onPriceSelected: () => { },
                onPriceExecuted: () => { },
                maxDepth: () => 10,
                pixelRatio: () => window.devicePixelRatio || 1,
            });
            ladder.setSymbol(SYMBOL);
        }
    }

    // ------------------------------------------------------------ the meters

    // What a paint looks like from outside: nodes added under the panels. The
    // observer reports once per task that changed them, and a task is one paint
    // of the tape or the ladder, so a report that added something counts as one.
    // A row built for a paint brings its cells with it, so every element under
    // an added node counts as created too.
    function countNode(node) {
        return node.nodeType === 1 ? 1 + node.getElementsByTagName('*').length : 1;
    }

    new MutationObserver((records) => {
        let painted = false;
        for (const record of records) {
            if (record.addedNodes.length === 0)
                continue;
            painted = true;
            for (const node of record.addedNodes) counters.nodes += countNode(node);
        }
        if (painted)
            counters.paints += 1;
    }).observe(document.querySelector('.load-panels'), { childList: true, subtree: true });

    function countFrames() {
        counters.frames += 1;
        requestAnimationFrame(countFrames);
    }
    requestAnimationFrame(countFrames);

    function report() {
        const seconds = Math.max(0.001, (performance.now() - counters.startedAt) / 1000);
        const perSecond = (value) => Math.round(value / seconds * 10) / 10;
        return {
            rate,
            book: withBook,
            hidden: document.hidden,
            seconds: Math.round(seconds * 10) / 10,
            prints: counters.prints,
            printsPerSecond: perSecond(counters.prints),
            bookFramesPerSecond: perSecond(counters.bookFrames),
            fps: perSecond(counters.frames),
            paintsPerSecond: perSecond(counters.paints),
            nodesPerSecond: perSecond(counters.nodes),
            busyPercent: Math.round(counters.busyMs / (seconds * 1000) * 1000) / 10,
        };
    }

    // The meters show the last second, not the run so far: a rate changed a
    // moment ago reads as itself straight away.
    let last = { ...counters, at: performance.now() };

    function renderMeters() {
        const now = performance.now();
        const seconds = Math.max(0.001, (now - last.at) / 1000);
        const delta = (name) => (counters[name] - (last[name] || 0)) / seconds;
        const set = (name, value) => { document.querySelector(`[data-meter="${name}"]`).textContent = value; };
        set('trades', Math.round(Math.max(0, delta('prints'))));
        set('fps', Math.round(Math.max(0, delta('frames'))));
        set('paints', Math.round(Math.max(0, delta('paints'))));
        set('nodes', Math.round(Math.max(0, delta('nodes'))).toLocaleString());
        set('busy', `${Math.round(Math.max(0, delta('busyMs')) / 10)}%`);
        last = { ...counters, at: now };
    }

    setInterval(renderMeters, 1000);

    window.__loadReset = resetCounters;
    window.__loadReport = report;

    // -------------------------------------------------------------- chrome

    function renderRates() {
        const group = document.getElementById('rates');
        group.setAttribute('aria-label', LANG.page.load.rate);
        group.replaceChildren(...RATES.map((value) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'tbtn tbtn-sm';
            button.classList.toggle('on', value === rate);
            button.setAttribute('aria-pressed', value === rate ? 'true' : 'false');
            button.textContent = value === 0 ? LANG.page.load.stop : String(value);
            button.addEventListener('click', () => setRate(value));
            return button;
        }));
    }

    function applyPageText() {
        const text = LANG.page.load;
        document.documentElement.lang = LANG.htmlLang;
        document.getElementById('rateLabel').textContent = text.rate;
        document.getElementById('bookBtn').innerHTML = '<span class="dot"></span> ' + text.book;
        document.getElementById('bookBtn').classList.toggle('on', withBook);
        const light = document.documentElement.getAttribute('data-bs-theme') === 'light';
        document.getElementById('themeBtn').textContent = light ? LANG.page.themeDark : LANG.page.themeLight;
        document.getElementById('langBtn').textContent = LANG.switchTo;
        document.querySelector('.demo-statusbar .status-left').textContent = LANG.page.statusLeft;
        document.getElementById('loadNote').textContent = text.note;
        for (const label of document.querySelectorAll('[data-meter-label]'))
            label.textContent = text.meters[label.dataset.meterLabel];
        for (const link of document.querySelectorAll('[data-board-link]')) {
            const board = link.dataset.boardLink;
            link.textContent = LANG.page.boards[board] || board;
            link.classList.toggle('is-current', board === 'load');
        }
        renderRates();
    }

    document.getElementById('bookBtn').addEventListener('click', () => {
        withBook = !withBook;
        createPanels();
        applyPageText();
        resetCounters();
    });

    document.getElementById('themeBtn').addEventListener('click', () => {
        const light = document.documentElement.getAttribute('data-bs-theme') === 'light';
        document.documentElement.setAttribute('data-bs-theme', light ? 'dark' : 'light');
        applyPageText();
    });

    document.getElementById('langBtn').addEventListener('click', () => {
        LANG = LANG === TEXT.en ? TEXT.zh : TEXT.en;
        // The controls are captioned when they are built, so a new language is
        // a new pair of panels — what the demo's own switch does too.
        createPanels();
        applyPageText();
    });

    createPanels();
    applyPageText();
    if (autoStart && rate > 0)
        setRate(rate);
})();
