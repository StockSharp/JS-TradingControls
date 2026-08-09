// Order book — multi-instance.
//
// Builds its own DOM (see `_buildRoot`) rather than cloning a <template> out of
// the page, so it can be constructed by any host that supplies a `TradingHost`.
// Every instance keeps its own symbol, depth, row layout and side order, and a
// page may hold as many ladders as it has room for.
//
// The ladder is not a table and so not a `DataGrid`: a level is a row of three
// figures behind a proportional volume bar and a heat tint, both of which are
// measured per level. The measurements are handed to the stylesheet as custom
// properties (`--t-ob-bar`, `--t-ob-heat`, `--t-ob-sent`) so the widths and the
// colours stay in CSS, where every other look in this package lives. The one
// exception is the depth chart above the ladder: it is drawn on a canvas, which
// no class name can reach, so its colours come from
// `host.presentation.canvasPalette()` and its geometry from `orderbook-depth.ts`.
//
// Where the data comes from: the host pushes frames in through `applyFrame`,
// one per server frame, fanned to every live instance — which is why each
// instance filters by its own symbol, and why `host.register(this)` at the end
// of the constructor is what makes a ladder update at all. The first frame of a
// (re)subscription is a snapshot and replaces the ledger; the rest are diffs
// (`quantity: 0` deletes a level) carrying a per-symbol sequence. A gap in that
// sequence means a frame was missed and the diffs after it cannot be trusted,
// so the ladder asks the market-data client to resend the symbol from scratch
// rather than drifting. Own resting orders come from
// `marketData.getOrders()` — the badge is an overlay on the levels, not a
// second subscription.
import { formatPrice, formatQty } from './formatters.js';
import { makeElement, makeIconButton, makePanelId, makePanelRoot } from './dom.js';
import { ControlTypes } from './control-types.js';
import { MarketDataLevels, TradingHost, assertHost } from './trading-host.js';
import type { BookLevel, OrderBookFrame, QuoteLevel } from './trading-data.js';
import { depthPolyline, depthSide, type DepthGeometry } from './orderbook-depth.js';

/// What the ladder needs beyond the host port. All required: a click on a price
/// level is this control's whole reason to exist, and the two measurements are
/// the page's to answer — a control that read them off `window` itself could
/// only ever run in a browser tab.
export interface OrderBookDeps {
    host: TradingHost;
    /// Plain click on a level — prefill an order at this price, do not send it.
    onPriceSelected(price: number, side: number): void;
    /// Ctrl/Cmd click on a level — send at this price now.
    onPriceExecuted(price: number, side: number): void;
    /// The most levels per side this host has room for, read per depth change.
    /// A phone-sized page answers 5: ten levels a side overflow the panel and
    /// leave the user with two inner scrollbars to dance around. A host with
    /// room answers the largest depth the ladder offers.
    maxDepth(): number;
    /// Backing-store scale for the depth chart's canvas — `devicePixelRatio` in
    /// a browser. Read per paint, so a window dragged onto a second monitor
    /// repaints sharp.
    pixelRatio(): number;
}

/// The row layouts the ladder offers.
///
/// `stacked` is Price | Qty | Total on every row, the layout every major
/// exchange ladder uses. `diagonal` centres the price and puts the size cell on
/// the outside of each side — the classic two-sided book.
export type OrderBookView = 'diagonal' | 'stacked';

// StockSharp's OrderStates.Active. Only a resting order sits on the book, so
// only a resting order earns the "your size is here" badge. The full enum is
// declared once in `active-orders-widget.ts`; importing it here would pull that
// blotter — and the grid it renders with — into every bundle that wanted a
// ladder and nothing else.
const RESTING_STATE = 3;

// Heat tint per level, as the percentage of the direction colour mixed into the
// row background. Faint at the shallowest level and still faint at the largest,
// because the volume bar behind the row is what carries the size — the tint
// only separates a wall from its neighbours.
const HEAT_FLOOR_PCT = 6;
const HEAT_RANGE_PCT = 18;

export class OrderBookWidget {
    static TYPE = ControlTypes.OrderBook;

    /// The depths the ladder offers, in the order the header shows them.
    static DEPTHS: readonly number[] = [5, 10];

    /// Persisted depth for the instance that follows the host's active symbol.
    /// Pinned instances carry their depth in their own per-panel state instead,
    /// which is what makes two ladders on one page able to differ.
    static DEPTH_KEY = 'terminal.obDepth';

    /// Persisted row layout for the follows-active instance.
    static VIEW_KEY = 'terminal.obView';

    /// Persisted "bids above the mid line" flag for the follows-active instance.
    static INVERT_KEY = 'terminal.obInvert';

    /// Persisted depth-chart visibility for the follows-active instance.
    static DEPTHCHART_KEY = 'terminal.obDepthChart';

    rootEl: HTMLElement;
    asksEl: HTMLElement | null;
    bidsEl: HTMLElement | null;
    midEl: HTMLElement | null;
    spreadEl: HTMLElement | null;
    contentEl: HTMLElement | null;
    depthChartEl: HTMLCanvasElement | null;
    // Comment style is `//` on purpose below the public members: the declaration
    // emitter keeps a private member's doc comment while dropping its body, so a
    // `///` here would reattach to the next public member in the API snapshot.
    _host: TradingHost;
    _deps: OrderBookDeps;
    _midSpreadEl: HTMLElement | null;
    _sentimentEl: HTMLElement | null;
    _sentBidPctEl: HTMLElement | null;
    _sentAskPctEl: HTMLElement | null;
    _symbolLabel: HTMLElement | null;
    _depthBtns: HTMLElement[];
    _viewBtns: HTMLElement[];
    _invertBtn: HTMLElement | null;
    _depthToggleBtn: HTMLElement | null;
    _addBtn: HTMLElement | null;
    _closeBtn: HTMLElement | null;
    // Last painted quantity per level, keyed by side and price — what decides
    // whether a level flashes and in which direction.
    _prevQuantities: Map<string, number>;
    _depth: number;
    _view: OrderBookView;
    _invertSides: boolean;
    _showDepthChart: boolean;
    _bidsByPrice: Map<number, number>;
    _asksByPrice: Map<number, number>;
    _lastSequence: number;
    _currentSymbol: string | null;
    _followsActive: boolean;

    static create(hostEl: HTMLElement, state: Record<string, unknown>, deps: OrderBookDeps): OrderBookWidget {
        // Assert before building: the markup below is localized through the
        // host, so a missing host has to fail here rather than render a panel
        // captioned with raw English keys.
        const host = assertHost(deps?.host, 'OrderBookWidget');
        const root = OrderBookWidget._buildRoot(host);
        root.id = makePanelId(OrderBookWidget.TYPE);
        hostEl.appendChild(root);
        return new OrderBookWidget(root, state || {}, deps);
    }

    // The panel's markup. The host stylesheet reads this structure, and a
    // docking host lifts `.panel-header`'s children into its tab strip — which
    // is why the header holds every control the ladder has.
    //
    // The `+` is built here rather than left out: the port documents `spawn` as
    // this control's gesture, and a button nothing renders is a capability
    // nobody can reach.
    static _buildRoot(host: TradingHost): HTMLElement {
        const title = host.t('OrderBook');
        return makePanelRoot('orderbook-panel', title, [
            makeElement('div', 'panel-header', {}, [
                makeElement('span', 'ob-symbol-label',
                    { title: host.t('ClickToChangeSymbol'), role: 'button', tabindex: '0' }, ['--']),
                makeElement('div', 'ob-depth-selector', { role: 'group', 'aria-label': host.t('OrderBookDepth') },
                    OrderBookWidget.DEPTHS.map(depth => makeElement('button', 'btn-ob-depth', {
                        type: 'button',
                        'data-depth': String(depth),
                        'aria-label': host.t('LevelsCount', depth),
                        'aria-pressed': 'false',
                    }, [String(depth)]))),
                makeElement('div', 'ob-view-selector', { role: 'group', 'aria-label': host.t('OrderBookView') }, [
                    makeIconButton('btn-ob-view', host.t('OrderBookViewDiagonal'), 'bi-distribute-horizontal',
                        { type: 'button', 'data-view': 'diagonal', 'aria-pressed': 'false' }),
                    makeIconButton('btn-ob-view', host.t('OrderBookViewStacked'), 'bi-table',
                        { type: 'button', 'data-view': 'stacked', 'aria-pressed': 'false' }),
                ]),
                makeIconButton('btn-ob-invert', host.t('OrderBookInvertSides'), 'bi-arrow-down-up',
                    { type: 'button', 'aria-pressed': 'false' }),
                makeIconButton('btn-ob-depthtoggle', host.t('ToggleDepthChart'), 'bi-graph-up',
                    { type: 'button', 'aria-pressed': 'false' }),
                makeElement('span', 'spread-label', { 'aria-live': 'polite' }, ['--']),
                makeIconButton('bt-icon-btn ob-add-btn', host.t('AddOrderbook'), 'bi-plus-lg', { type: 'button' }),
                makeIconButton('bt-icon-btn bt-icon-cancel ob-close-btn', host.t('RemoveOrderbook'), 'bi-x', { type: 'button' }),
            ]),
            makeElement('canvas', 'ob-depth-chart', { 'aria-hidden': 'true' }, []),
            makeElement('div', 'ob-col-headers', { 'aria-hidden': 'true' }, [
                makeElement('span', 'ob-col-price', {}, [host.t('Price')]),
                makeElement('span', 'ob-col-qty', {}, [host.t('Qty')]),
                makeElement('span', 'ob-col-total', {}, [host.t('Total')]),
            ]),
            makeElement('div', 'orderbook-content', { 'aria-live': 'polite', 'aria-atomic': 'false' }, [
                makeElement('div', 'orderbook-asks', { 'aria-label': host.t('AskOrders') }, []),
                makeElement('div', 'orderbook-mid', { 'aria-label': host.t('MidPrice') }, [
                    makeElement('span', 'ob-mid-price', {}, ['--']),
                    makeElement('span', 'ob-mid-spread', { 'aria-live': 'polite' }, []),
                ]),
                makeElement('div', 'orderbook-bids', { 'aria-label': host.t('BidOrders') }, []),
            ]),
            makeElement('div', 'ob-sentiment', { 'aria-label': host.t('OrderBookSentiment') }, [
                makeElement('div', 'ob-sent-bid', {}, [
                    makeElement('span', 'ob-sent-label', {}, [host.t('BidShort')]),
                    makeElement('span', 'ob-sent-bid-pct', {}, ['--']),
                ]),
                makeElement('div', 'ob-sent-ask', {}, [
                    makeElement('span', 'ob-sent-ask-pct', {}, ['--']),
                    makeElement('span', 'ob-sent-label', {}, [host.t('AskShort')]),
                ]),
            ]),
        ]);
    }

    constructor(rootEl: HTMLElement, state: Record<string, unknown>, deps: OrderBookDeps) {
        this._host = assertHost(deps?.host, 'OrderBookWidget');
        for (const name of ['onPriceSelected', 'onPriceExecuted', 'maxDepth', 'pixelRatio'] as const) {
            if (typeof deps?.[name] !== 'function')
                throw new Error(`OrderBookWidget: dep "${name}" is required`);
        }

        this.rootEl = rootEl;
        this._deps = deps;

        this.asksEl = this.rootEl.querySelector('.orderbook-asks');
        this.bidsEl = this.rootEl.querySelector('.orderbook-bids');
        this.midEl = this.rootEl.querySelector('.ob-mid-price');
        this.spreadEl = this.rootEl.querySelector('.spread-label');
        this.contentEl = this.rootEl.querySelector('.orderbook-content');
        this.depthChartEl = this.rootEl.querySelector('.ob-depth-chart');
        this._midSpreadEl = this.rootEl.querySelector('.ob-mid-spread');
        this._sentimentEl = this.rootEl.querySelector('.ob-sentiment');
        this._sentBidPctEl = this.rootEl.querySelector('.ob-sent-bid-pct');
        this._sentAskPctEl = this.rootEl.querySelector('.ob-sent-ask-pct');
        this._symbolLabel = this.rootEl.querySelector('.ob-symbol-label');
        this._depthBtns = Array.from(this.rootEl.querySelectorAll('.btn-ob-depth')) as HTMLElement[];
        this._viewBtns = Array.from(this.rootEl.querySelectorAll('.btn-ob-view')) as HTMLElement[];
        this._invertBtn = this.rootEl.querySelector('.btn-ob-invert');
        this._depthToggleBtn = this.rootEl.querySelector('.btn-ob-depthtoggle');
        this._addBtn = this.rootEl.querySelector('.ob-add-btn');
        this._closeBtn = this.rootEl.querySelector('.ob-close-btn');

        // Per-panel state is whatever the host persisted, so every value is read
        // defensively and falls back to this control's own default.
        const saved = state as {
            symbol?: string; depth?: number; view?: string;
            invertSides?: boolean; showDepthChart?: boolean; followsActive?: boolean;
        };

        this._prevQuantities = new Map();
        this._bidsByPrice = new Map();
        this._asksByPrice = new Map();
        this._lastSequence = 0;
        this._currentSymbol = null;
        this._followsActive = saved.followsActive === true;
        this._view = saved.view === 'diagonal' ? 'diagonal' : 'stacked';
        this._invertSides = saved.invertSides === true;
        // On by default; only an explicit false hides it.
        this._showDepthChart = saved.showDepthChart !== false;
        let depth = OrderBookWidget._isDepth(saved.depth) ? saved.depth : OrderBookWidget._deepest();

        // The follows-active instance restores the settings the user chose the
        // last time, which live in the host's preferences rather than in this
        // panel's state — there is one of it per page and it outlives any
        // particular layout. Pinned instances carry theirs in `state` above.
        if (this._followsActive) {
            const preferences = this._host.preferences;
            const savedDepth = Number(preferences.get(OrderBookWidget.DEPTH_KEY, null));
            if (OrderBookWidget._isDepth(savedDepth)) depth = savedDepth;
            const savedView = preferences.get(OrderBookWidget.VIEW_KEY, null);
            if (savedView === 'diagonal' || savedView === 'stacked') this._view = savedView;
            const savedInvert = preferences.get(OrderBookWidget.INVERT_KEY, null);
            if (savedInvert !== null) this._invertSides = savedInvert === 'true';
            const savedDepthChart = preferences.get(OrderBookWidget.DEPTHCHART_KEY, null);
            if (savedDepthChart !== null) this._showDepthChart = savedDepthChart === 'true';
        }
        this._depth = this._fitDepth(depth);

        this._wireHeader();
        this._wireBookClicks();

        this._refreshDepthButtons();
        this._applyViewState();
        this._refreshViewButtons();
        this._refreshInvertButton();
        this._refreshDepthToggleButton();

        // A follows-active instance ignores any persisted symbol: it inherits
        // the live one from the host on boot, and honouring a stale one here
        // would flash a previous session's instrument until that arrives.
        if (saved.symbol && !this._followsActive) this.setSymbol(saved.symbol);

        // Self-register — this is how incoming frames find their way here, and
        // an unregistered ladder is one that never updates.
        this._host.register(this);
    }

    /// Release the market-data subscription, leave the fan-out and remove the
    /// panel. Called by the host when the panel is destroyed.
    dispose(): void {
        if (this._currentSymbol)
            void this._host.trading.marketData.removeSymbol(this._currentSymbol).catch(() => { });
        this._host.unregister(this);
        try { this.rootEl.remove(); } catch { /* already detached */ }
    }

    /// Switch to a new instrument: drop the old subscription, take a new one and
    /// blank the ledger, because a diff for the old symbol must never be applied
    /// to the new one.
    setSymbol(symbol: string): void {
        if (!symbol) return;
        const next = String(symbol).toUpperCase();
        if (next === this._currentSymbol) return;

        const previous = this._currentSymbol;
        this._currentSymbol = next;
        this._resetLedger();
        if (this._symbolLabel) this._symbolLabel.textContent = next;
        this._render();

        // addSymbol / removeSymbol are refcounted by the client, so two ladders
        // on one symbol hold one subscription and neither can drop the other's.
        const marketData = this._host.trading.marketData;
        if (previous) void marketData.removeSymbol(previous).catch(() => { });
        // A ladder needs the depth, and the header reads best bid/ask, so it
        // asks for the whole set rather than for quotes alone.
        void marketData.addSymbol(next, MarketDataLevels.Full).catch(() => { });

        // A pinned instance remembers its instrument so a reload restores this
        // exact ladder; the follows-active one deliberately does not, because it
        // tracks whatever the host is showing.
        if (!this._followsActive) this._persistState({ symbol: next });
    }

    getSymbol(): string | null { return this._currentSymbol; }

    getDepth(): number { return this._depth; }

    /// True for the instance that follows the host's active symbol. A page has
    /// at most one, and a host that feeds a best-bid/ask from a ladder asks for
    /// it by this.
    isFollowsActive(): boolean { return this._followsActive; }

    /// The ledger as levels, best price first. Public because a host reads the
    /// touch off the ladder rather than keeping a second copy of the book.
    getBids(): BookLevel[] {
        return OrderBookWidget._sorted(this._bidsByPrice, -1);
    }

    getAsks(): BookLevel[] {
        return OrderBookWidget._sorted(this._asksByPrice, 1);
    }

    // The three setters below repaint BEFORE they persist: `_persistState` ends
    // in a layout flush and the host serializes the live panel to produce it, so
    // persisting first would write out the panel as it looked before the change
    // the user just made.
    setDepth(depth: number): void {
        if (!OrderBookWidget._isDepth(depth)) return;
        this._depth = this._fitDepth(depth);
        this._refreshDepthButtons();
        this._render();
        if (this._followsActive) this._host.preferences.set(OrderBookWidget.DEPTH_KEY, String(this._depth));
        else this._persistState({ depth: this._depth });
    }

    setView(view: OrderBookView): void {
        if (view !== 'diagonal' && view !== 'stacked') return;
        this._view = view;
        this._applyViewState();
        this._refreshViewButtons();
        if (this._followsActive) this._host.preferences.set(OrderBookWidget.VIEW_KEY, view);
        else this._persistState({ view });
    }

    /// Put the bid block above the mid line and the ask block below it, the
    /// reverse of the convention every Western exchange UI follows.
    setInvertSides(invert: boolean): void {
        this._invertSides = invert === true;
        this._applyViewState();
        this._refreshInvertButton();
        if (this._followsActive)
            this._host.preferences.set(OrderBookWidget.INVERT_KEY, this._invertSides ? 'true' : 'false');
        else this._persistState({ invertSides: this._invertSides });
    }

    /// Show or hide the depth chart above the ladder. The canvas keeps its last
    /// bitmap while hidden, so showing it again brings the chart straight back
    /// and the next frame repaints it.
    setShowDepthChart(show: boolean): void {
        this._showDepthChart = show === true;
        this._applyViewState();
        this._refreshDepthToggleButton();
        if (this._followsActive)
            this._host.preferences.set(OrderBookWidget.DEPTHCHART_KEY, this._showDepthChart ? 'true' : 'false');
        this._persistState({ showDepthChart: this._showDepthChart });
    }

    /// Apply one frame. A snapshot replaces the ledger; a diff merges into it,
    /// with `quantity: 0` deleting a level. A break in the sequence means a
    /// frame was missed, so the ladder asks for a fresh snapshot instead of
    /// applying a diff to state it can no longer trust.
    ///
    /// Every instance receives every frame, so the symbol filter here is what
    /// keeps a frame for one instrument out of a ladder watching another.
    applyFrame(frame: OrderBookFrame): void {
        if (!frame || !frame.symbol) return;
        if (this._currentSymbol && frame.symbol !== this._currentSymbol) return;
        if (this._currentSymbol !== frame.symbol) {
            this._currentSymbol = frame.symbol;
            // The follows-active instance can receive its first frame before the
            // host calls setSymbol, whose early return on an unchanged symbol
            // would then skip the label.
            if (this._symbolLabel) this._symbolLabel.textContent = frame.symbol;
        }

        const sequence = frame.sequence ?? 0;
        if (frame.isSnapshot) {
            this._resetLedger();
            this._applySnapshotSide(this._bidsByPrice, frame.bids, 'bid', frame.symbol, sequence);
            this._applySnapshotSide(this._asksByPrice, frame.asks, 'ask', frame.symbol, sequence);
            this._lastSequence = sequence;
        } else {
            if (this._lastSequence !== 0 && sequence !== this._lastSequence + 1) {
                this._anomaly(`sequence gap: expected ${this._lastSequence + 1}, got ${sequence} sym=${frame.symbol} — requesting snapshot`);
                this._lastSequence = 0;
                void this._requestResubscribe(frame.symbol);
                return;
            }
            this._applyDiffSide(this._bidsByPrice, frame.bids, 'bid', frame.symbol, sequence);
            this._applyDiffSide(this._asksByPrice, frame.asks, 'ask', frame.symbol, sequence);
            this._lastSequence = sequence || this._lastSequence;
        }
        this._validateBookCross(frame.symbol, sequence, frame.isSnapshot === true);
        this._render();
    }

    _wireHeader(): void {
        for (const button of this._depthBtns) {
            button.addEventListener('click', (e) => {
                e.preventDefault();
                this.setDepth(Number(button.dataset.depth));
            });
        }
        for (const button of this._viewBtns) {
            button.addEventListener('click', (e) => {
                e.preventDefault();
                const view = button.dataset.view;
                if (view === 'diagonal' || view === 'stacked') this.setView(view);
            });
        }
        this._invertBtn?.addEventListener('click', (e) => {
            e.preventDefault();
            this.setInvertSides(!this._invertSides);
        });
        this._depthToggleBtn?.addEventListener('click', (e) => {
            e.preventDefault();
            this.setShowDepthChart(!this._showDepthChart);
        });

        // Another ladder, starting where this one is — the most natural copy
        // gesture, and the host decides where it goes.
        this._addBtn?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this._host.spawn({
                symbol: this._currentSymbol,
                depth: this._depth,
                view: this._view,
                invertSides: this._invertSides,
                showDepthChart: this._showDepthChart,
                followsActive: false,
            });
        });

        this._closeBtn?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this._host.close();
        });

        // Picking an instrument retargets THIS ladder only — a user who wanted
        // the whole page to follow would have used the host's own instrument
        // selector. Picking on the follows-active instance detaches it: it
        // becomes a pinned ladder on the chosen symbol, identical to any other.
        this._symbolLabel?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this._host.trading.pickInstrument((symbol) => {
                if (this._followsActive) {
                    this._followsActive = false;
                    this._persistState({ followsActive: false });
                }
                this.setSymbol(symbol);
            });
        });
    }

    // A click anywhere on a level, caught once on the container: the rows are
    // rebuilt on every frame, so a listener per row would be re-bound dozens of
    // times a second.
    //
    // Plain click prefills an order at that price and leaves the sending to the
    // user. Ctrl/Cmd click sends at once — a single click doing that is how a
    // sneeze on the bid becomes a fill.
    _wireBookClicks(): void {
        this.contentEl?.addEventListener('click', (e) => {
            const target = e.target as Element | null;
            const row = target?.closest('.ob-row') as HTMLElement | null;
            if (!row) return;
            const price = Number(row.dataset.price);
            if (!Number.isFinite(price)) return;

            // A bid row is where the user sells and an ask row is where they
            // buy, so the row carries the side of the order, not of the level.
            const side = row.dataset.side === 'buy' ? 0 : 1;
            if (e.ctrlKey || e.metaKey) this._deps.onPriceExecuted(price, side);
            else this._deps.onPriceSelected(price, side);
        });
    }

    _refreshDepthButtons(): void {
        for (const button of this._depthBtns) {
            const on = Number(button.dataset.depth) === this._depth;
            button.classList.toggle('active', on);
            button.setAttribute('aria-pressed', on ? 'true' : 'false');
        }
    }

    _refreshViewButtons(): void {
        for (const button of this._viewBtns) {
            const on = button.dataset.view === this._view;
            button.classList.toggle('active', on);
            button.setAttribute('aria-pressed', on ? 'true' : 'false');
        }
    }

    _refreshInvertButton(): void {
        this._invertBtn?.classList.toggle('active', this._invertSides);
        this._invertBtn?.setAttribute('aria-pressed', this._invertSides ? 'true' : 'false');
    }

    _refreshDepthToggleButton(): void {
        this._depthToggleBtn?.classList.toggle('active', this._showDepthChart);
        this._depthToggleBtn?.setAttribute('aria-pressed', this._showDepthChart ? 'true' : 'false');
    }

    // The variant classes on the panel root the stylesheet keys the two layouts,
    // the side order and the depth chart off.
    _applyViewState(): void {
        this.rootEl.classList.toggle('ob-view-stacked', this._view === 'stacked');
        this.rootEl.classList.toggle('ob-view-diagonal', this._view === 'diagonal');
        this.rootEl.classList.toggle('ob-invert', this._invertSides);
        this.rootEl.classList.toggle('ob-hide-depth', !this._showDepthChart);
    }

    // Record what this panel remembers, then ask the host to flush the layout.
    // Two calls because they are two decisions, and every caller here is a
    // setting the user just changed by hand — so it is worth flushing.
    _persistState(patch: Record<string, unknown>): void {
        this._host.persistState(patch);
        this._host.saveLayout();
    }

    _resetLedger(): void {
        this._bidsByPrice.clear();
        this._asksByPrice.clear();
        this._prevQuantities.clear();
        this._lastSequence = 0;
    }

    // The host answers how many levels it has room for, so a phone-sized page
    // narrows the ladder without this control knowing what a viewport is.
    _fitDepth(depth: number): number {
        const room = Number(this._deps.maxDepth());
        if (!Number.isFinite(room) || room < 1) return depth;
        return Math.min(depth, room);
    }

    static _isDepth(depth: unknown): depth is number {
        return typeof depth === 'number' && OrderBookWidget.DEPTHS.includes(depth);
    }

    static _deepest(): number {
        return OrderBookWidget.DEPTHS[OrderBookWidget.DEPTHS.length - 1];
    }

    static _sorted(ledger: Map<number, number>, direction: 1 | -1): BookLevel[] {
        return [...ledger.entries()]
            .filter(([price, quantity]) => Number.isFinite(price) && quantity > 0)
            .sort((left, right) => direction * (left[0] - right[0]))
            .map(([price, quantity]) => ({ price, quantity }));
    }

    _applySnapshotSide(ledger: Map<number, number>, levels: QuoteLevel[] | undefined, side: string, symbol: string, sequence: number): void {
        for (const level of levels || []) {
            const quantity = level.quantity ?? 0;
            if (level.price == null || !Number.isFinite(level.price) || !(quantity > 0)) {
                this._anomaly(`snapshot ${side} level dropped: price=${level.price} qty=${level.quantity} sym=${symbol} seq=${sequence}`);
                continue;
            }
            ledger.set(level.price, quantity);
        }
    }

    _applyDiffSide(ledger: Map<number, number>, levels: QuoteLevel[] | undefined, side: string, symbol: string, sequence: number): void {
        for (const level of levels || []) {
            // A level with a non-finite price is wire corruption: applying it
            // lands a NaN key in the ledger, which sorts unpredictably and
            // renders as a phantom row between two real levels.
            if (level.price == null || !Number.isFinite(level.price)) {
                this._anomaly(`invalid ${side} price: price=${level.price} qty=${level.quantity} sym=${symbol} seq=${sequence} — ignoring`);
                continue;
            }
            const quantity = level.quantity ?? 0;
            if (quantity < 0) {
                this._anomaly(`negative ${side} qty: price=${level.price} qty=${quantity} sym=${symbol} seq=${sequence} — ignoring`);
                continue;
            }
            if (quantity === 0) {
                if (!ledger.has(level.price)) {
                    this._anomaly(`delete missing ${side}: price=${level.price} sym=${symbol} seq=${sequence}`);
                    continue;
                }
                ledger.delete(level.price);
            } else {
                ledger.set(level.price, quantity);
            }
        }
    }

    // Best bid below best ask, or something upstream is broken — usually a diff
    // applied to stale state after a gap the sequence check did not catch.
    _validateBookCross(symbol: string, sequence: number, wasSnapshot: boolean): void {
        if (this._bidsByPrice.size === 0 || this._asksByPrice.size === 0) return;
        let bestBid = -Infinity;
        let bestAsk = Infinity;
        for (const price of this._bidsByPrice.keys()) if (price > bestBid) bestBid = price;
        for (const price of this._asksByPrice.keys()) if (price < bestAsk) bestAsk = price;
        if (bestBid >= bestAsk) {
            this._anomaly(`crossed book: bid=${bestBid} >= ask=${bestAsk} sym=${symbol} seq=${sequence} ${wasSnapshot ? 'snapshot' : 'diff'}`);
        }
    }

    // Ask for the symbol from scratch. Idempotent as far as the user is
    // concerned: the ladder blanks for a frame and refills.
    async _requestResubscribe(symbol: string): Promise<void> {
        try {
            await this._host.trading.marketData.resubscribe(symbol, MarketDataLevels.Full);
        } catch (err) {
            this._anomaly(`resubscribe after a gap failed for ${symbol}: ${err}`);
        }
    }

    // Wire trouble the user cannot see and support has to, through the port.
    _anomaly(message: string): void {
        this._host.log(`OrderBookWidget: ${message}`);
    }

    _render(): void {
        this._paint(this.getBids(), this.getAsks());
    }

    _paint(bids: BookLevel[], asks: BookLevel[]): void {
        if (!this.asksEl || !this.bidsEl) return;

        const visibleAsks = asks.slice(0, this._depth);
        const visibleBids = bids.slice(0, this._depth);

        // The bar is scaled per side — a 100k bid wall must not flatten a normal
        // 200-lot ask ladder on the other half — while the heat tint is scaled
        // across both, so the two halves stay perceptually comparable.
        const maxBid = Math.max(...visibleBids.map(level => level.quantity), 1);
        const maxAsk = Math.max(...visibleAsks.map(level => level.quantity), 1);
        const maxBoth = Math.max(maxBid, maxAsk, 1);

        const own = this._ownQuantities();
        const painted = new Map<string, number>();

        // Asks are rendered worst-first so the best ask ends up next to the mid
        // line, while the cumulative total runs the other way — the best ask
        // reads `qty == total` and the sum grows as the eye moves away from the
        // spread.
        const askTotals: number[] = [];
        let running = 0;
        for (const level of visibleAsks) {
            running += level.quantity;
            askTotals.push(running);
        }
        const askRows: HTMLElement[] = [];
        for (let i = visibleAsks.length - 1; i >= 0; i--) {
            askRows.push(this._levelRow(visibleAsks[i], {
                rowClass: 'ob-row ask',
                orderSide: 'buy',
                key: `a_${visibleAsks[i].price}`,
                cumulative: askTotals[i],
                barPct: (visibleAsks[i].quantity / maxAsk) * 100,
                heatPct: HEAT_FLOOR_PCT + HEAT_RANGE_PCT * (visibleAsks[i].quantity / maxBoth),
                // More size on the offer is pressure downward, so a growing ask
                // level flashes in the falling colour.
                growthClass: 'flash-red',
                shrinkClass: 'flash-green',
                ownQuantity: own.asks.get(OrderBookWidget._priceKey(visibleAsks[i].price)),
                painted,
            }));
        }
        this.asksEl.replaceChildren(...askRows);

        running = 0;
        const bidRows: HTMLElement[] = [];
        for (const level of visibleBids) {
            running += level.quantity;
            bidRows.push(this._levelRow(level, {
                rowClass: 'ob-row bid',
                orderSide: 'sell',
                key: `b_${level.price}`,
                cumulative: running,
                barPct: (level.quantity / maxBid) * 100,
                heatPct: HEAT_FLOOR_PCT + HEAT_RANGE_PCT * (level.quantity / maxBoth),
                growthClass: 'flash-green',
                shrinkClass: 'flash-red',
                ownQuantity: own.bids.get(OrderBookWidget._priceKey(level.price)),
                painted,
            }));
        }
        this.bidsEl.replaceChildren(...bidRows);

        this._prevQuantities = painted;

        if (asks.length > 0 && bids.length > 0) {
            const bestAsk = asks[0].price;
            const bestBid = bids[0].price;
            const spread = bestAsk - bestBid;
            if (this.midEl) this.midEl.textContent = formatPrice((bestAsk + bestBid) / 2);
            if (this._midSpreadEl) this._midSpreadEl.textContent = formatPrice(spread);
            if (this.spreadEl) this.spreadEl.textContent = this._host.t('Spread: {0}', formatPrice(spread));
        }

        this._paintSentiment(visibleBids, visibleAsks);
        this._paintDepthChart(visibleBids, visibleAsks);
    }

    // One level. Every measurement it carries — the bar's share of its side, the
    // heat tint — reaches the stylesheet as a custom property, so the widths and
    // the colours are still declared in CSS.
    _levelRow(level: BookLevel, options: {
        rowClass: string; orderSide: string; key: string; cumulative: number;
        barPct: number; heatPct: number; growthClass: string; shrinkClass: string;
        ownQuantity: number | undefined; painted: Map<string, number>;
    }): HTMLElement {
        const quantity = makeElement('span', 'qty', {}, [formatQty(level.quantity)]);
        if (options.ownQuantity) {
            quantity.appendChild(makeElement('span', 'own-badge',
                { title: this._host.t('YourOrder') }, [formatQty(options.ownQuantity)]));
        }

        const row = makeElement('div', options.rowClass, {
            'data-side': options.orderSide,
            'data-price': String(level.price),
        }, [
            makeElement('span', 'price', {}, [formatPrice(level.price)]),
            quantity,
            makeElement('span', 'total', {}, [formatQty(options.cumulative)]),
            makeElement('span', 'bar', {}, []),
        ]);
        row.style.setProperty('--t-ob-bar', `${options.barPct.toFixed(0)}%`);
        row.style.setProperty('--t-ob-heat', `${options.heatPct.toFixed(1)}%`);
        if (options.ownQuantity) row.classList.add('own');

        const previous = this._prevQuantities.get(options.key);
        if (previous !== undefined && previous !== level.quantity)
            row.classList.add(level.quantity > previous ? options.growthClass : options.shrinkClass);
        options.painted.set(options.key, level.quantity);

        return row;
    }

    // This session's resting orders on this symbol, summed per price — the "your
    // size is here" badge is an overlay on the ledger, so it reads the client's
    // own order cache rather than subscribing to anything.
    //
    // Prices are keyed as fixed-point text: two floats that print the same are
    // the same level to a user, and `===` on them is not.
    _ownQuantities(): { bids: Map<string, number>; asks: Map<string, number> } {
        const bids = new Map<string, number>();
        const asks = new Map<string, number>();
        if (!this._currentSymbol) return { bids, asks };

        for (const order of this._host.trading.marketData.getOrders() || []) {
            if (!order || order.instrument !== this._currentSymbol) continue;
            if (order.status !== RESTING_STATE) continue;
            if (order.limitPrice == null || order.side == null) continue;
            const side = this._host.presentation.isBuy(order.side) ? bids : asks;
            const key = OrderBookWidget._priceKey(order.limitPrice);
            const left = Number(order.balance ?? order.quantity) || 0;
            side.set(key, (side.get(key) || 0) + left);
        }
        return { bids, asks };
    }

    static _priceKey(price: number): string {
        return Number(price).toFixed(8);
    }

    // The bid/ask split under the ladder, as one measurement the stylesheet
    // turns into two widths.
    //
    // It sums the VISIBLE levels only, so the figure moves when the user changes
    // depth. A whole-book share needs the server to aggregate one, which the
    // frame does not carry today.
    _paintSentiment(bids: BookLevel[], asks: BookLevel[]): void {
        if (!this._sentimentEl) return;
        const bidSum = bids.reduce((sum, level) => sum + level.quantity, 0);
        const askSum = asks.reduce((sum, level) => sum + level.quantity, 0);
        const total = bidSum + askSum;

        if (total <= 0) {
            this._sentimentEl.style.setProperty('--t-ob-sent', '50%');
            if (this._sentBidPctEl) this._sentBidPctEl.textContent = '--';
            if (this._sentAskPctEl) this._sentAskPctEl.textContent = '--';
            return;
        }
        // Rounded so the two halves sum to exactly 100 — a strip reading 99% is
        // read as a bug rather than as rounding.
        const askPct = Math.round((askSum / total) * 100);
        const bidPct = 100 - askPct;
        this._sentimentEl.style.setProperty('--t-ob-sent', `${bidPct}%`);
        if (this._sentBidPctEl) this._sentBidPctEl.textContent = `${bidPct}%`;
        if (this._sentAskPctEl) this._sentAskPctEl.textContent = `${askPct}%`;
    }

    // The depth curve above the ladder. Everything shaped is in
    // `orderbook-depth.ts`; what is left here is the canvas plumbing and the
    // host's palette, because a canvas takes colours as values and a class name
    // cannot reach one.
    _paintDepthChart(bids: BookLevel[], asks: BookLevel[]): void {
        const canvas = this.depthChartEl;
        if (!canvas || !this._showDepthChart) return;

        const ratio = Number(this._deps.pixelRatio()) || 1;
        const cssWidth = canvas.clientWidth || 0;
        const cssHeight = canvas.clientHeight || 0;
        if (cssWidth < 4 || cssHeight < 4) return;

        const width = Math.floor(cssWidth * ratio);
        const height = Math.floor(cssHeight * ratio);
        if (canvas.width !== width) canvas.width = width;
        if (canvas.height !== height) canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.clearRect(0, 0, width, height);
        if (bids.length === 0 && asks.length === 0) return;

        const pad = 2 * ratio;
        const midX = Math.floor(width / 2);
        const geometry: DepthGeometry = {
            midX,
            pad,
            halfWidth: midX - pad,
            baseY: height - pad,
            innerHeight: height - pad * 2,
        };

        const bidSide = depthSide(bids, -1, geometry);
        const askSide = depthSide(asks, 1, geometry);
        const maxTotal = Math.max(bidSide ? bidSide.total : 0, askSide ? askSide.total : 0, 1);
        const palette = this._host.presentation.canvasPalette();

        if (bidSide) this._strokeDepthSide(ctx, depthPolyline(bidSide, maxTotal, geometry), palette.up, geometry, ratio);
        if (askSide) this._strokeDepthSide(ctx, depthPolyline(askSide, maxTotal, geometry), palette.down, geometry, ratio);

        // The mid line, so the two halves read as two sides of one price rather
        // than as two charts.
        ctx.globalAlpha = 0.4;
        ctx.fillStyle = palette.grid;
        ctx.fillRect(midX - Math.max(1, ratio / 2), 0, Math.max(1, ratio), height);
        ctx.globalAlpha = 1;
    }

    // Area under the step curve, then the curve on top. Opacity is varied here
    // rather than in the colour, so the host states one solid colour per
    // direction and this decides how much of it a fill is worth.
    _strokeDepthSide(ctx: CanvasRenderingContext2D, line: [number, number][], color: string, geometry: DepthGeometry, ratio: number): void {
        if (line.length === 0) return;

        ctx.beginPath();
        ctx.moveTo(line[0][0], geometry.baseY);
        for (const [x, y] of line) ctx.lineTo(x, y);
        ctx.lineTo(line[line.length - 1][0], geometry.baseY);
        ctx.closePath();
        ctx.globalAlpha = 0.18;
        ctx.fillStyle = color;
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(line[0][0], line[0][1]);
        for (let i = 1; i < line.length; i++) ctx.lineTo(line[i][0], line[i][1]);
        ctx.lineWidth = Math.max(1.5, 1.5 * ratio);
        ctx.lineJoin = 'miter';
        ctx.globalAlpha = 0.95;
        ctx.strokeStyle = color;
        ctx.stroke();
        ctx.globalAlpha = 1;
    }
}
