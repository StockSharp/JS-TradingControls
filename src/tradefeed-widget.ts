// Trade feed — multi-instance.
//
// The public tape: every print for the symbol the page is showing, plus any
// extra instruments this instance has pinned, in one of two renderings. The
// list is a row per print; the bubble chart is the same prints scattered by
// time and price, sized by volume and coloured by direction. Which of the two
// is showing is shared across every feed on the page through the host's
// preference store; the pinned extras belong to the instance and ride in its
// persisted state.
//
// Builds its own DOM (see `_buildRoot`) rather than cloning a <template> out of
// the page, so it can be constructed by any host that supplies a `TradingHost`.
//
// Ticks are pushed in — `setTrades` for a fresh symbol, `addTrade` per print —
// because a host fans one socket to every live feed rather than each of them
// subscribing again. The one thing the panel pulls is the account's own fills,
// on the My-trades tab, through `trading.api.getExecutions`.
//
// The chart is a <canvas>, the single surface a class name cannot reach: its
// geometry comes out of `tradefeed-bubbles.ts` as numbers and its colours out
// of the host's `canvasPalette()`, so the package still paints nothing from a
// palette of its own.
import { formatPrice, formatQty, formatTime } from './formatters.js';
import { makeElement, makeIconButton, makePanelId, makePanelRoot } from './dom.js';
import { ControlTypes } from './control-types.js';
import { MarketDataLevels, TradingHost, assertHost } from './trading-host.js';
import type { TradeRow } from './trading-data.js';
import type { FeedBubble, FeedTick } from './tradefeed-aggregator.js';
import { layoutBubbles, type BubbleLane, type BubbleShape } from './tradefeed-bubbles.js';

/// The panel needs nothing beyond the host port. It reports no application
/// action: a tape is read, and the two gestures it does make — pin an
/// instrument, open another feed — are the host's own `pickInstrument` and
/// `spawn`.
export interface TradeFeedDeps {
    host: TradingHost;
}

// Opacity, not colour. The hue of every stroke below is the host's
// `canvasPalette`; how solid it is drawn is the chart's own business, and
// keeping the two apart is what lets one palette serve a light theme and a dark
// one without the package knowing which it is in.
const FILL_ALPHA = 0.55;
const STROKE_ALPHA = 0.9;
const LABEL_ALPHA = 0.55;
const SEPARATOR_ALPHA = 0.12;
const RULE_ALPHA = 0.08;

// How far from a bubble's edge a cursor still counts as over it. Small bubbles
// are otherwise impossible to hit.
const HOVER_SLACK = 6;
// Gap between the cursor and the tooltip, and between the tooltip and the edge
// it is clamped against.
const TOOLTIP_OFFSET = 12;
const TOOLTIP_MARGIN = 4;

export class TradeFeedWidget {
    static TYPE = ControlTypes.TradeFeed;
    /// Shared across every trade feed on the page: which of the two renderings
    /// the user last chose. The value is what a user's stored settings already
    /// hold, so it is spelled exactly as it always was.
    static VIEW_KEY = 'terminal.tradeFeedView';
    /// Rows kept in the list, and prints kept for the chart. The chart holds
    /// far more because it compacts them: a bubble stands for a slice.
    static MAX_ROWS = 50;
    static MAX_BUBBLES = 500;

    rootEl: HTMLElement;
    marketEl: HTMLElement | null;
    myEl: HTMLElement | null;
    extrasEl: HTMLElement | null;
    bubbleCanvas: HTMLCanvasElement | null;
    trades: TradeRow[];
    bubbleTrades: TradeRow[];
    myTrades: TradeRow[];
    avgQty: number;
    tab: string;
    view: string;
    // `//` rather than `///` from here down — see the note in positions-widget.
    _host: TradingHost;
    _tabsEl: HTMLElement | null;
    _viewToggleEl: HTMLElement | null;
    _tooltipEl: HTMLElement | null;
    _addBtn: HTMLElement | null;
    _closeBtn: HTMLElement | null;
    _addSymbolBtn: HTMLElement | null;
    _bubbleCtx: CanvasRenderingContext2D | null;
    // Rebuilt on every paint: where each bubble landed and what it stands for.
    // Hover walks it backwards so the circle drawn last — the newest print —
    // wins wherever two overlap.
    _bubbleHits: BubbleShape[];
    _canvasSize: { width: number; height: number } | null;
    _resizeObserver: ResizeObserver | null;
    _activeSymbol: string | null;
    _extraSymbols: Set<string>;

    static create(hostEl: HTMLElement, state: Record<string, unknown>, deps: TradeFeedDeps): TradeFeedWidget {
        // Assert before building: the markup below is localized through the
        // host, so a missing host has to fail here rather than render a panel
        // captioned with raw English keys.
        const host = assertHost(deps?.host, 'TradeFeedWidget');
        const root = TradeFeedWidget._buildRoot(host);
        root.id = makePanelId(TradeFeedWidget.TYPE);
        hostEl.appendChild(root);
        return new TradeFeedWidget(root, state || {}, deps);
    }

    // The panel's markup. The host stylesheet reads this structure, and a
    // docking host lifts `.panel-header`'s children into its tab strip.
    //
    // Two `+` buttons, and they are not the same gesture: the one in the header
    // pins another instrument to THIS feed, the one beside it asks the host for
    // another feed panel. The tooltips are what tell them apart, so neither is
    // an icon on its own.
    static _buildRoot(host: TradingHost): HTMLElement {
        const addInstrument = host.t('AddInstrument');
        const marketTrades = host.t('MarketTrades');
        return makePanelRoot('tradefeed-panel tf-tab-market tf-view-list', host.t('TradeFeed'), [
            makeElement('div', 'panel-header', {}, [
                makeElement('span', '', {}, [marketTrades]),
                makeIconButton('bt-icon-btn tf-add-symbol-btn', addInstrument, 'bi-plus-lg', { type: 'button' }),
                makeIconButton('bt-icon-btn panel-add-btn', host.t('Add trade feed'), 'bi-window-plus', { type: 'button' }),
                makeElement('div', 'tradefeed-view-toggle tf-view-toggle', { role: 'group', 'aria-label': host.t('TradeFeedView') }, [
                    makeIconButton('tf-view-btn', host.t('ListView'), 'bi-list-ul', { type: 'button', 'data-view': 'list' }),
                    makeIconButton('tf-view-btn', host.t('BubbleChart'), 'bi-circle-fill', { type: 'button', 'data-view': 'bubbles' }),
                ]),
                makeIconButton('bt-icon-btn bt-icon-cancel panel-close-btn', host.t('ClosePanel'), 'bi-x', { type: 'button' }),
            ]),
            makeElement('div', 'tf-tabs', { role: 'tablist', 'aria-label': host.t('Trade feed tabs') }, [
                makeElement('button', 'tf-tab active', { type: 'button', role: 'tab', 'aria-selected': 'true', 'data-tab': 'market' }, [marketTrades]),
                makeElement('button', 'tf-tab', { type: 'button', role: 'tab', 'aria-selected': 'false', 'data-tab': 'my' }, [host.t('My trades')]),
            ]),
            makeElement('div', 'tf-extras', { role: 'list', 'aria-label': host.t('ExtraInstruments'), hidden: '' }, []),
            makeElement('div', 'tradefeed-content tf-market', { 'aria-live': 'polite' }, []),
            makeElement('div', 'tradefeed-content tf-my', {}, []),
            makeElement('canvas', 'tradefeed-bubbles tf-bubbles', { 'aria-hidden': 'true' }, []),
            makeElement('div', 'tf-bubble-tooltip', { role: 'tooltip', hidden: '' }, []),
        ]);
    }

    constructor(rootEl: HTMLElement, state: Record<string, unknown>, deps: TradeFeedDeps) {
        this._host = assertHost(deps?.host, 'TradeFeedWidget');

        this.rootEl = rootEl;
        this.marketEl = this.rootEl.querySelector('.tf-market');
        this.myEl = this.rootEl.querySelector('.tf-my');
        this.extrasEl = this.rootEl.querySelector('.tf-extras');
        this.bubbleCanvas = this.rootEl.querySelector('.tf-bubbles');
        this._tabsEl = this.rootEl.querySelector('.tf-tabs');
        this._viewToggleEl = this.rootEl.querySelector('.tf-view-toggle');
        this._tooltipEl = this.rootEl.querySelector('.tf-bubble-tooltip');
        this._addBtn = this.rootEl.querySelector('.panel-add-btn');
        this._closeBtn = this.rootEl.querySelector('.panel-close-btn');
        this._addSymbolBtn = this.rootEl.querySelector('.tf-add-symbol-btn');
        this._bubbleCtx = this.bubbleCanvas?.getContext('2d') ?? null;

        this.trades = [];
        this.bubbleTrades = [];
        this.myTrades = [];
        // Seed rather than zero: the "unusually large" test is a multiple of the
        // running average, and an average starting at zero would flag the first
        // print of the session.
        this.avgQty = 100;
        this.tab = 'market';
        this._bubbleHits = [];
        this._canvasSize = null;
        this._resizeObserver = null;

        const saved = this._host.preferences.get(TradeFeedWidget.VIEW_KEY, null);
        this.view = saved === 'bubbles' ? 'bubbles' : 'list';

        // The page's active symbol drives the primary feed; extras are the
        // instruments this instance pinned on top of it, each refcount-
        // subscribed and shown with a symbol column.
        this._activeSymbol = null;
        this._extraSymbols = new Set(Array.isArray(state.extras) ? state.extras as string[] : []);

        this._addBtn?.addEventListener('click', (e) => {
            e.preventDefault();
            this._host.spawn({ extras: [...this._extraSymbols] });
        });
        this._closeBtn?.addEventListener('click', (e) => {
            e.preventDefault();
            this.dispose();
            this._host.close();
        });
        this._addSymbolBtn?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this._host.trading.pickInstrument((symbol) => void this.addExtraSymbol(symbol));
        });

        this._bindTabs();
        this._bindViewToggle();
        this._bindBubbleHover();
        this._applyView();
        this._renderExtras();

        // Resubscribe the persisted extras up front: without this a reload
        // renders the chip and streams nothing behind it.
        for (const symbol of this._extraSymbols)
            void this._host.trading.marketData.addSymbol(symbol, MarketDataLevels.Tape).catch(() => { });

        if (this.bubbleCanvas && typeof ResizeObserver === 'function') {
            this._resizeObserver = new ResizeObserver(() => { this._sizeCanvas(); this._renderBubbles(); });
            this._resizeObserver.observe(this.bubbleCanvas);
        }

        this._host.register(this);
    }

    dispose(): void {
        try { this._resizeObserver?.disconnect(); } catch { /* already torn down */ }
        // Drop this feed's share of every extra so a symbol nobody else watches
        // stops streaming — the client refcounts, so a neighbour keeps its own.
        for (const symbol of this._extraSymbols)
            void this._host.trading.marketData.removeSymbol(symbol).catch(() => { });
        this._host.unregister(this);
        try { this.rootEl.remove(); } catch { /* already detached */ }
    }

    /// Which symbol the rest of the page is showing. The feed accepts prints
    /// for it without it being pinned, and re-renders so the symbol column
    /// appears or disappears with the pinned set.
    setActiveSymbol(symbol: string | null): void {
        this._activeSymbol = symbol || null;
        this._renderExtras();
        this._renderMarket();
        this._renderBubbles();
    }

    /// Replace the tape wholesale — what a host does when the page moves to a
    /// different instrument.
    setTrades(trades: TradeRow[]): void {
        const rows = trades || [];
        this.trades = rows.slice(0, TradeFeedWidget.MAX_ROWS);
        this.bubbleTrades = rows.slice(0, TradeFeedWidget.MAX_BUBBLES);
        if (this.trades.length > 0) {
            const total = this.trades.reduce((sum, t) => sum + (t.quantity ?? 0), 0);
            this.avgQty = total / this.trades.length || this.avgQty;
        }
        this._renderMarket();
        this._renderBubbles();
    }

    /// One print off the wire. Ignored unless this feed watches its symbol:
    /// a host fans every tick to every feed and each decides for itself, which
    /// is the only arrangement that supports per-instance extras.
    addTrade(trade: TradeRow): void {
        if (!trade || !this._watches(trade.symbol)) return;
        this.trades.unshift(trade);
        if (this.trades.length > TradeFeedWidget.MAX_ROWS) this.trades.length = TradeFeedWidget.MAX_ROWS;
        this.bubbleTrades.unshift(trade);
        if (this.bubbleTrades.length > TradeFeedWidget.MAX_BUBBLES) this.bubbleTrades.length = TradeFeedWidget.MAX_BUBBLES;
        // A rolling average rather than a re-sum: "unusually large" should track
        // the recent tape, not the whole session.
        this.avgQty = this.avgQty * 0.95 + (trade.quantity ?? 0) * 0.05;

        if (this.marketEl) {
            const row = this._createRow(trade, true);
            if (this.marketEl.firstChild) this.marketEl.insertBefore(row, this.marketEl.firstChild);
            else this.marketEl.appendChild(row);
            while (this.marketEl.childNodes.length > TradeFeedWidget.MAX_ROWS && this.marketEl.lastChild)
                this.marketEl.removeChild(this.marketEl.lastChild);
        }
        this._renderBubbles();
    }

    /// The account's own fills for the My-trades tab. The one thing this panel
    /// pulls rather than being pushed.
    async loadMyTrades(portfolioId: number | null, symbol: string | null): Promise<void> {
        if (!portfolioId) {
            this.myTrades = [];
            this._renderMy();
            return;
        }
        try {
            this.myTrades = await this._host.trading.api.getExecutions(portfolioId, symbol, TradeFeedWidget.MAX_ROWS) || [];
        } catch (err) {
            // Through the port, not the console: this is the diagnostic the
            // user cannot see and support has to, and routing it here is also
            // what makes it assertable.
            this._host.log(`TradeFeedWidget: failed to load own trades: ${err}`);
            this.myTrades = [];
        }
        this._renderMy();
    }

    /// Pin an extra instrument to this feed: subscribe it, show it alongside
    /// the primary, and remember it in the instance's state.
    async addExtraSymbol(symbol: string): Promise<void> {
        if (!symbol) return;
        const sym = String(symbol).toUpperCase();
        if (sym === this._activeSymbol || this._extraSymbols.has(sym)) return;
        this._extraSymbols.add(sym);
        // A tape needs the prints, and only the prints — the depth `Full` would
        // add is bandwidth this panel never renders.
        try { await this._host.trading.marketData.addSymbol(sym, MarketDataLevels.Tape); } catch { /* socket race */ }
        this._renderExtras();
        this._renderMarket();
        this._renderBubbles();
        this._persistExtras();
    }

    /// Unpin one, dropping its subscription and the prints already on screen.
    async removeExtraSymbol(symbol: string): Promise<void> {
        if (!symbol) return;
        const sym = String(symbol).toUpperCase();
        if (!this._extraSymbols.has(sym)) return;
        this._extraSymbols.delete(sym);
        try { await this._host.trading.marketData.removeSymbol(sym); } catch { /* socket race */ }
        this.trades = this.trades.filter(t => t.symbol !== sym);
        this.bubbleTrades = this.bubbleTrades.filter(t => t.symbol !== sym);
        this._renderExtras();
        this._renderMarket();
        this._renderBubbles();
        this._persistExtras();
    }

    getExtraSymbols(): string[] {
        return [...this._extraSymbols];
    }

    // Record what this instance pins, then ask for the layout to be flushed.
    // Two calls because they are two decisions: what the instance remembers,
    // and whether that is worth writing out now. Pinning is — losing the pin on
    // the next reload is exactly the complaint.
    _persistExtras(): void {
        this._host.persistState({ extras: [...this._extraSymbols] });
        this._host.saveLayout();
    }

    // Does this feed show `symbol` — as the page's active one, or pinned?
    _watches(symbol: string | undefined): boolean {
        if (!symbol) return false;
        return symbol === this._activeSymbol || this._extraSymbols.has(symbol);
    }

    // ---------------------------------------------------------------- the list

    _createRow(trade: TradeRow, isNew: boolean): HTMLElement {
        const presentation = this._host.presentation;
        const showSymbol = this._extraSymbols.size > 0;
        const children: HTMLElement[] = [makeElement('span', 'time', {}, [formatTime(trade.time || trade.executedAt)])];
        if (showSymbol) children.push(makeElement('span', 'sym', {}, [trade.symbol || '']));
        children.push(makeElement('span', 'price', {}, [formatPrice(trade.price)]));
        children.push(makeElement('span', 'qty', {}, [formatQty(trade.quantity)]));
        children.push(makeElement('span', 'side', {}, [presentation.sideText(trade.side!)]));

        const row = makeElement('div', 'tf-row', {}, children);
        // Modifiers, each conditional: the direction class is the host's answer,
        // `flash-new` only on a print that just landed, `large-trade` on one
        // well above the running average, `tf-row-multi` when a symbol column
        // is showing. All four are styled in `styles/trading-controls.css`.
        // Split, because the host's answer is a class LIST and a host on its own
        // palette may well return two names.
        for (const name of presentation.sideClass(trade.side!).split(' ')) if (name) row.classList.add(name);
        if (isNew) row.classList.add('flash-new');
        if ((trade.quantity ?? 0) > this.avgQty * 2) row.classList.add('large-trade');
        if (showSymbol) row.classList.add('tf-row-multi');
        return row;
    }

    _renderMarket(): void {
        if (!this.marketEl) return;
        this.marketEl.replaceChildren(...this.trades.map(t => this._createRow(t, false)));
    }

    _renderMy(): void {
        if (!this.myEl) return;
        if (this.myTrades.length === 0) {
            this.myEl.replaceChildren(makeElement('div', 'empty-state', {}, [this._host.t('No trades yet')]));
            return;
        }
        this.myEl.replaceChildren(...this.myTrades.map(t => this._createRow(t, false)));
    }

    _renderExtras(): void {
        if (!this.extrasEl) return;
        if (this._extraSymbols.size === 0) {
            this.extrasEl.replaceChildren();
            this.extrasEl.setAttribute('hidden', '');
            return;
        }
        this.extrasEl.removeAttribute('hidden');
        const remove = this._host.t('Remove');
        const chips = [...this._extraSymbols].map((symbol) => {
            const button = makeIconButton('tf-extra-rm', remove, 'bi-x', { type: 'button' });
            button.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                void this.removeExtraSymbol(symbol);
            });
            return makeElement('span', 'tf-extra-chip', { role: 'listitem' }, [
                makeElement('span', 'tf-extra-sym', {}, [symbol]),
                button,
            ]);
        });
        this.extrasEl.replaceChildren(...chips);
    }

    // --------------------------------------------------------------- the views

    _bindTabs(): void {
        this._tabsEl?.addEventListener('click', (e) => {
            const button = (e.target as Element | null)?.closest('.tf-tab') as HTMLElement | null;
            if (!button) return;
            this._selectTab(button.dataset.tab || 'market');
        });
    }

    _selectTab(tab: string): void {
        this.tab = tab === 'my' ? 'my' : 'market';
        this._tabsEl?.querySelectorAll('.tf-tab').forEach((b) => {
            const selected = (b as HTMLElement).dataset.tab === this.tab;
            b.classList.toggle('active', selected);
            b.setAttribute('aria-selected', selected ? 'true' : 'false');
        });
        this.rootEl.classList.toggle('tf-tab-market', this.tab === 'market');
        this.rootEl.classList.toggle('tf-tab-my', this.tab === 'my');
        // The tab is also the request: opening it is when the fills are worth
        // fetching, and the portfolio is read per use because the user can have
        // switched account under a panel that is already on screen.
        if (this.tab === 'my') void this.loadMyTrades(this._host.trading.portfolioId(), this._activeSymbol);
        else this._renderBubbles();
    }

    _bindViewToggle(): void {
        this._viewToggleEl?.addEventListener('click', (e) => {
            const button = (e.target as Element | null)?.closest('.tf-view-btn') as HTMLElement | null;
            if (!button) return;
            const next = button.dataset.view;
            if ((next !== 'list' && next !== 'bubbles') || next === this.view) return;
            this.view = next;
            this._host.preferences.set(TradeFeedWidget.VIEW_KEY, next);
            this._applyView();
        });
    }

    // Which rendering is showing is two class names on the root, not a display
    // written onto elements: a narrow viewport forces the list back on, and
    // that is a stylesheet's decision to make, not this control's.
    _applyView(): void {
        const list = this.view === 'list';
        this.rootEl.classList.toggle('tf-view-list', list);
        this.rootEl.classList.toggle('tf-view-bubbles', !list);
        this._viewToggleEl?.querySelectorAll('.tf-view-btn').forEach((b) => {
            const selected = (b as HTMLElement).dataset.view === this.view;
            b.classList.toggle('active', selected);
            b.setAttribute('aria-pressed', selected ? 'true' : 'false');
        });
        if (!list) {
            this._sizeCanvas();
            this._renderBubbles();
        }
    }

    // -------------------------------------------------------------- the chart

    // The canvas in CSS pixels, and its backing store in device pixels. Without
    // the second the chart is drawn at a third of the resolution the screen has.
    _sizeCanvas(): void {
        const canvas = this.bubbleCanvas;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const ratio = typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1;
        const width = Math.max(1, Math.floor(rect.width));
        const height = Math.max(1, Math.floor(rect.height));
        if (canvas.width !== width * ratio || canvas.height !== height * ratio) {
            canvas.width = width * ratio;
            canvas.height = height * ratio;
            this._bubbleCtx?.setTransform(ratio, 0, 0, ratio, 0, 0);
        }
        this._canvasSize = { width, height };
    }

    // The prints as the chart reads them: direction decided once by the host,
    // and a position on the shared time axis. Newest first, as the tape holds
    // them.
    _feedTicks(): FeedTick[] {
        const presentation = this._host.presentation;
        return this.bubbleTrades.map((trade, index) => ({
            symbol: trade.symbol || '',
            side: trade.side!,
            buy: presentation.isBuy(trade.side!),
            price: Number(trade.price ?? 0),
            quantity: Number(trade.quantity ?? 0),
            time: trade.time || trade.executedAt || '',
            index,
        }));
    }

    // One lane per watched symbol, active first. A feed with nothing pinned is
    // one lane over everything it holds, which is also the only case where the
    // lane needs no name.
    _lanes(ticks: FeedTick[]): BubbleLane[] {
        if (this._extraSymbols.size === 0)
            return [{ symbol: this._activeSymbol || '', ticks }];
        const symbols = this._activeSymbol ? [this._activeSymbol] : [];
        for (const symbol of this._extraSymbols) if (!symbols.includes(symbol)) symbols.push(symbol);
        return symbols.map(symbol => ({ symbol, ticks: ticks.filter(t => t.symbol === symbol) }));
    }

    _renderBubbles(): void {
        const ctx = this._bubbleCtx;
        if (!ctx || this.view !== 'bubbles') return;
        if (!this._canvasSize) this._sizeCanvas();
        const size = this._canvasSize;
        if (!size) return;

        ctx.clearRect(0, 0, size.width, size.height);
        this._bubbleHits = [];
        const ticks = this._feedTicks();
        if (ticks.length === 0) return;

        const layout = layoutBubbles({ width: size.width, height: size.height, total: ticks.length, lanes: this._lanes(ticks) });
        const palette = this._host.presentation.canvasPalette();
        ctx.font = palette.font;
        ctx.lineWidth = 1;

        for (const lane of layout.lanes) {
            if (lane.separatorY !== null) {
                ctx.globalAlpha = SEPARATOR_ALPHA;
                ctx.strokeStyle = palette.grid;
                TradeFeedWidget._rule(ctx, 0, size.width, lane.separatorY);
            }
            if (lane.label) {
                ctx.globalAlpha = LABEL_ALPHA;
                ctx.fillStyle = palette.grid;
                ctx.textBaseline = 'top';
                ctx.textAlign = 'left';
                ctx.fillText(lane.symbol, lane.label.x, lane.label.y);
            }
            for (const tick of lane.ticks) {
                ctx.globalAlpha = RULE_ALPHA;
                ctx.strokeStyle = palette.grid;
                TradeFeedWidget._rule(ctx, 0, layout.axisX - 2, tick.y);
                ctx.globalAlpha = LABEL_ALPHA;
                ctx.fillStyle = palette.grid;
                ctx.textBaseline = 'middle';
                ctx.textAlign = 'left';
                ctx.fillText(tick.text, layout.labelX, tick.y);
            }
        }

        for (const shape of layout.bubbles) {
            const colour = shape.bubble.buy ? palette.up : palette.down;
            ctx.fillStyle = colour;
            ctx.strokeStyle = colour;
            ctx.beginPath();
            ctx.arc(shape.x, shape.y, shape.radius, 0, Math.PI * 2);
            // Filled softly and outlined firmly, so overlapping prints stay
            // countable instead of merging into one blob.
            ctx.globalAlpha = FILL_ALPHA;
            ctx.fill();
            ctx.globalAlpha = STROKE_ALPHA;
            ctx.stroke();
            this._bubbleHits.push(shape);
        }
        ctx.globalAlpha = 1;
    }

    static _rule(ctx: CanvasRenderingContext2D, from: number, to: number, y: number): void {
        ctx.beginPath();
        ctx.moveTo(from, y);
        ctx.lineTo(to, y);
        ctx.stroke();
    }

    _bindBubbleHover(): void {
        const canvas = this.bubbleCanvas;
        if (!canvas) return;
        canvas.addEventListener('mousemove', (e: MouseEvent) => {
            if (this.view !== 'bubbles') { this._hideTooltip(); return; }
            const rect = canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            const hit = this._hitTest(x, y);
            if (hit) this._showTooltip(hit.bubble, x, y);
            else this._hideTooltip();
        });
        canvas.addEventListener('mouseleave', () => this._hideTooltip());
    }

    // Backwards, so the circle drawn last — the newest print, on top — is the
    // one a cursor over both picks.
    _hitTest(x: number, y: number): BubbleShape | null {
        for (let i = this._bubbleHits.length - 1; i >= 0; i--) {
            const shape = this._bubbleHits[i];
            const dx = x - shape.x;
            const dy = y - shape.y;
            const reach = Math.max(shape.radius, HOVER_SLACK);
            if (dx * dx + dy * dy <= reach * reach) return shape;
        }
        return null;
    }

    _showTooltip(bubble: FeedBubble, x: number, y: number): void {
        const tooltip = this._tooltipEl;
        const canvas = this.bubbleCanvas;
        if (!tooltip || !canvas) return;
        const presentation = this._host.presentation;
        const aggregated = bubble.count > 1;
        // The raw side the print carried, not a spelling this file picked:
        // wording and colouring it are the host's, whichever of the three
        // spellings its wire uses.
        const side = bubble.side;

        const lines: HTMLElement[] = [];
        if (this._extraSymbols.size > 0) lines.push(this._tooltipLine(this._host.t('Symbol'), bubble.symbol, ''));
        lines.push(this._tooltipLine(this._host.t('Time'), formatTime(bubble.time), ''));
        lines.push(this._tooltipLine(aggregated ? this._host.t('VWAP') : this._host.t('Price'), formatPrice(bubble.price), ''));
        lines.push(this._tooltipLine(aggregated ? this._host.t('Total qty') : this._host.t('Qty'), formatQty(bubble.quantity), ''));
        lines.push(this._tooltipLine(this._host.t('Side'), presentation.sideText(side), presentation.sideClass(side)));
        if (aggregated) lines.push(this._tooltipLine(this._host.t('Trades'), String(bubble.count), ''));
        tooltip.replaceChildren(...lines);

        // Measured, then placed: the size is only known once it is showing, and
        // it is clamped inside the canvas so a print near the right or bottom
        // edge does not push its own tooltip out of view.
        tooltip.removeAttribute('hidden');
        const canvasRect = canvas.getBoundingClientRect();
        const parentRect = tooltip.offsetParent?.getBoundingClientRect() ?? canvasRect;
        const originX = canvasRect.left - parentRect.left;
        const originY = canvasRect.top - parentRect.top;
        const maxX = originX + canvasRect.width - tooltip.offsetWidth - TOOLTIP_MARGIN;
        const maxY = originY + canvasRect.height - tooltip.offsetHeight - TOOLTIP_MARGIN;
        tooltip.style.left = `${Math.max(0, Math.min(originX + x + TOOLTIP_OFFSET, maxX))}px`;
        tooltip.style.top = `${Math.max(0, Math.min(originY + y + TOOLTIP_OFFSET, maxY))}px`;
    }

    _tooltipLine(label: string, value: string, valueClass: string): HTMLElement {
        const row = makeElement('div', 'tf-bbtt-row', {}, [
            makeElement('span', 'tf-bbtt-label', {}, [label]),
            makeElement('span', 'tf-bbtt-value', {}, [value]),
        ]);
        for (const name of valueClass.split(' ')) if (name) (row.childNodes[1] as HTMLElement).classList.add(name);
        return row;
    }

    _hideTooltip(): void {
        this._tooltipEl?.setAttribute('hidden', '');
    }
}
