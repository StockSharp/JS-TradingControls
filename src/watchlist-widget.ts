// Watchlist — multi-instance.
//
// Builds its own DOM (see `_buildRoot`) rather than cloning a <template> out of
// the page, so it can be constructed by any host that supplies a `TradingHost`.
// Each instance has its own search/filter/sort state; favourites are shared,
// held under one key in the host's preference store.
//
// The table is `DataGrid` from `@stocksharp/grids`. The grid holds the FILTERED
// instruments and does the sorting, which is what makes the two caps mean
// different things: `renderLimit` caps what gets painted while the export and
// the subscription sync read the whole filtered set. A live quote patches one
// cell through the grid's (rowKey, columnKey) lookup instead of repainting — a
// repaint would restart the flash animation it just triggered.
import { makeElement, makeIconButton, makePanelId, makePanelRoot } from './dom.js';
import { ControlTypes } from './control-types.js';
import { makeGridMenu } from './grid-menu.js';
import { MarketDataClient, MarketDataLevels, TradingApi, TradingHost, assertHost } from './trading-host.js';
import type { InstrumentRow, QuoteStats } from './trading-data.js';
import { DataGrid, GridColumn } from '@stocksharp/grids/source/data-grid';

/// What the panel needs beyond the host port. Picking an instrument is the one
/// thing it reports that is not the ticker: the panel does not switch the
/// host's instrument itself, it says what the user chose and the host acts.
export interface WatchlistDeps {
    host: TradingHost;
    onSelect(symbol: string): void;
}

export class WatchlistWidget {
    static FAVORITES_KEY = 'terminal_watchlist_favorites';
    // Cache-key prefix for the per-session baseline price used to compute the
    // change %. Day-scoped so the baseline resets every UTC day and the
    // percent matches "since today open" intuitively. (Without a REST bars
    // endpoint there is no broker-side day-open available, and the watchlist
    // deliberately avoids REST — the live stream is its only source.) It goes
    // in the host's cache rather than its preferences: one key per symbol per
    // day is scratch, not a setting worth syncing.
    static BASELINE_KEY_PREFIX = 'wlBaseline:';
    static VISIBLE_CAP = 30;
    static RENDER_CAP = 300;
    static TYPE = ControlTypes.Watchlist;

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
    // `//` rather than `///` from here down — see the note in positions-widget.
    _host: TradingHost;
    _deps: WatchlistDeps;
    // Symbols this widget currently holds a live-quote subscription for.
    // Re-synced from the visible list on every render — see _syncSubs.
    _subscribedSyms: Set<string>;
    _closeBtn: HTMLElement | null;
    _exportBtn: HTMLElement | null;
    _grid: DataGrid<InstrumentRow> | null;

    static create(hostEl: HTMLElement, state: Record<string, unknown>, deps: WatchlistDeps): WatchlistWidget {
        // Assert before building: the markup below is localized through the
        // host, so a missing host has to fail here rather than render a panel
        // captioned with raw English keys.
        const host = assertHost(deps?.host, 'WatchlistWidget');
        const root = WatchlistWidget._buildRoot(host);
        root.id = makePanelId(WatchlistWidget.TYPE);
        hostEl.appendChild(root);
        return new WatchlistWidget(root, state || {}, deps);
    }

    // The panel's markup. The host stylesheet reads this structure, and a
    // docking host lifts `.panel-header`'s children — and, for this panel,
    // `.watchlist-search-row` as well — into its tab strip, which is why the
    // search row is a sibling of the header rather than a child of it.
    //
    // "All" and "Favorites" are the built-in tabs. The rest are appended at
    // runtime from the distinct categories of the loaded instruments, so the
    // tab set is configured through whatever assigns those categories rather
    // than being spelled out here — see _renderCategoryTabs.
    static _buildRoot(host: TradingHost): HTMLElement {
        const search = host.t('SearchInstruments');
        const favorites = host.t('Favorites');
        return makePanelRoot('watchlist-panel', host.t('Watchlist'), [
            makeElement('div', 'panel-header', {}, [
                makeElement('span', '', {}, [host.t('Markets')]),
                makeIconButton('bt-icon-btn panel-export-btn', host.t('ExportToExcel'), 'bi-file-earmark-spreadsheet', { type: 'button' }),
                makeIconButton('bt-icon-btn bt-icon-cancel panel-close-btn', host.t('ClosePanel'), 'bi-x', { type: 'button' }),
            ]),
            makeElement('div', 'watchlist-search-row', {}, [
                makeElement('input', 'form-control form-control-sm watchlist-search-input watchlist-search',
                    { type: 'text', placeholder: search, autocomplete: 'off', 'aria-label': search }, []),
            ]),
            makeElement('div', 'watchlist-tabs', { role: 'tablist', 'aria-label': host.t('WatchlistFilter') }, [
                makeElement('button', 'wl-tab active', { 'data-filter': 'all', role: 'tab', 'aria-selected': 'true' }, [host.t('All')]),
                makeElement('button', 'wl-tab', { 'data-filter': 'favorites', role: 'tab', 'aria-selected': 'false', 'aria-label': favorites, title: favorites }, ['★']),
            ]),
            makeElement('div', 'watchlist-pane', {}, [
                makeElement('table', 'watchlist-table', {}, [
                    makeElement('thead', 'watchlist-headers', {}, []),
                    makeElement('tbody', 'watchlist-body', {}, []),
                ]),
            ]),
        ]);
    }

    constructor(rootEl: HTMLElement, _state: Record<string, unknown>, deps: WatchlistDeps) {
        this._host = assertHost(deps?.host, 'WatchlistWidget');
        if (typeof deps?.onSelect !== 'function')
            throw new Error('WatchlistWidget: dep "onSelect" is required');

        this.rootEl = rootEl;
        this._deps = deps;
        this.api = this._host.trading.api;

        this.instruments = [];
        this.stats = new Map();
        this.favorites = new Set(this._loadFavorites());
        this.filter = 'all';
        this.search = '';
        this.currentSymbol = null;
        this._subscribedSyms = new Set();
        this.wsClient = this._host.trading.marketData;

        this.bodyEl = this.rootEl.querySelector('.watchlist-body');
        this.searchEl = this.rootEl.querySelector('.watchlist-search');
        this.tabsEl = this.rootEl.querySelector('.watchlist-tabs');
        this.sortHeaderEl = this.rootEl.querySelector('.watchlist-headers');
        this._closeBtn = this.rootEl.querySelector('.panel-close-btn');
        this._exportBtn = this.rootEl.querySelector('.panel-export-btn');

        this._closeBtn?.addEventListener('click', (e) => {
            e.preventDefault();
            this.dispose();
            this._host.close();
        });
        this._exportBtn?.addEventListener('click', (e) => {
            e.preventDefault();
            this._export();
        });

        this._grid = this.sortHeaderEl && this.bodyEl
            ? new DataGrid<InstrumentRow>({
                head: this.sortHeaderEl,
                body: this.bodyEl,
                columns: this._columns(),
                // Symbol A→Z at rest — an instrument list has no natural "newest",
                // and alphabetical is what the user scans by.
                defaultSort: { col: 'symbol', dir: 'asc' },
                rowKey: (i) => String(i.symbol),
                emptyText: this._host.t('No instruments'),
                rowClass: (i) => (i.symbol === this.currentSymbol ? 'wl-row wl-current' : 'wl-row'),
                bindRow: (tr, i) => tr.addEventListener('click', () => this._deps.onSelect(i.symbol!)),
                // Paint a screenful, export and subscribe over the whole filtered set.
                renderLimit: WatchlistWidget.RENDER_CAP,
                // A header click re-renders through the grid, so this is the only
                // place that sees every change to the visible set — including a sort
                // the widget was never told about.
                afterRender: () => {
                    this._syncSubs();
                    this._publishVisible();
                },
                contextMenu: makeGridMenu(this._host),
            })
            : null;

        this._bind();

        this._host.register(this);

        // Auto-init data load: a caller that creates the panel expects a working
        // widget without further ceremony. Unconditional — the host port
        // guarantees an API client, so there is no "maybe we can load" state
        // left to branch on.
        void this.init();
    }

    dispose(): void {
        // Release every live subscription this widget held — the market-data
        // client refcounts them, so another control's subscription survives if
        // it happened to share a symbol with us.
        for (const sym of this._subscribedSyms) {
            try { void this.wsClient?.removeSymbol(sym); } catch { /* socket may be torn down */ }
        }
        this._subscribedSyms.clear();
        this._host.unregister(this);
        try { this.rootEl.remove(); } catch { /* already detached */ }
    }

    async init(): Promise<void> {
        try {
            this.instruments = await this.api.searchInstruments('');
        } catch (err) {
            // Through the port, not the console: this is the diagnostic the
            // user cannot see and support has to, and routing it here is also
            // what makes it assertable.
            this._host.log(`WatchlistWidget: failed to load instruments: ${err}`);
            this.instruments = [];
        }
        this._renderCategoryTabs();
        this._render();
    }

    // Build the filter tabs from the assigned instrument categories. "All" and
    // "Favorites" are built into the markup; here we append one tab per distinct
    // non-empty category found in the loaded instruments. Re-runnable: clears
    // any category tabs a previous load added.
    _renderCategoryTabs(): void {
        if (!this.tabsEl) return;
        this.tabsEl.querySelectorAll('.wl-tab[data-category]').forEach(el => el.remove());

        const cats = Array.from(new Set(
            this.instruments
                .map(i => (i.category || '').trim())
                .filter(c => c.length > 0)))
            .sort((a, b) => a.localeCompare(b));

        for (const cat of cats) {
            const btn = document.createElement('button');
            btn.className = 'wl-tab';
            btn.setAttribute('role', 'tab');
            btn.setAttribute('aria-selected', 'false');
            btn.dataset.filter = cat;
            btn.dataset.category = '1';
            btn.textContent = cat;
            this.tabsEl.appendChild(btn);
        }
    }

    /// Highlight the instrument the rest of the page is showing. Patches the two
    /// affected rows rather than repainting: a repaint here would restart any
    /// flash animation currently running in a price cell.
    setCurrentSymbol(symbol: string | null): void {
        const previous = this.currentSymbol;
        this.currentSymbol = symbol;
        if (!this._grid) return;
        if (previous) this._grid.rowElement(String(previous))?.classList.remove('wl-current');
        if (symbol) this._grid.rowElement(String(symbol))?.classList.add('wl-current');
    }

    onPriceUpdate(symbol: string, price: number): void {
        if (price == null || !isFinite(price)) return;
        let full = symbol;
        if (!full.includes('@')) {
            const match = this.instruments.find(i => String(i.symbol).split('@')[0] === symbol);
            if (match?.symbol) full = match.symbol;
        }
        const cur = this.stats.get(full);
        const prev = cur?.lastPrice;

        // Session-day baseline: first observed live price per (UTC-day, symbol).
        // Kept in the host's cache so reloading the page doesn't jump the
        // baseline mid-day. New UTC day = fresh baseline.
        const baselineKey = WatchlistWidget._baselineKey(full);
        let baseline = cur?.baseline;
        if (baseline == null) {
            const stored = this._host.cache.get(baselineKey, null);
            baseline = stored ? Number(stored) : undefined;
        }
        if (baseline == null || !isFinite(baseline) || baseline === 0) {
            baseline = price;
            this._host.cache.set(baselineKey, String(price));
        }
        const chgPct = baseline ? ((price - baseline) / baseline) * 100 : 0;

        this.stats.set(full, { ...(cur || {}), lastPrice: price, baseline, chgPct });
        this._updateRow(full, prev);
    }

    static _baselineKey(symbol: string): string {
        const day = new Date().toISOString().slice(0, 10);    // YYYY-MM-DD (UTC)
        return WatchlistWidget.BASELINE_KEY_PREFIX + day + ':' + symbol;
    }

    _bind(): void {
        if (this.searchEl) {
            this.searchEl.addEventListener('input', () => {
                this.search = (this.searchEl!.value || '').trim().toLowerCase();
                this._render();
            });
        }
        if (this.tabsEl) {
            this.tabsEl.addEventListener('click', (e) => {
                const tgt = e.target as Element | null;
                const btn = tgt?.closest('.wl-tab') as HTMLElement | null;
                if (!btn) return;
                this.filter = btn.dataset.filter || 'all';
                this.tabsEl!.querySelectorAll('.wl-tab').forEach(b => b.classList.toggle('active', b === btn));
                this._render();
            });
        }
        // Sort header clicks are handled by the grid (wired in the constructor).
    }

    // The instruments matching the search box and the active tab, unsorted —
    // the grid owns the order.
    _filtered(): InstrumentRow[] {
        const q = this.search;
        const rows: InstrumentRow[] = [];
        for (const inst of this.instruments) {
            const sym = (inst.symbol || '').toUpperCase();
            // Match the "symbol/exchange" (and "symbol@exchange") display form too, so a
            // full "BTC/IMEX" query resolves — not only the bare symbol "BTC".
            const symL = sym.toLowerCase();
            const shortSym = symL.split('@')[0];
            const exch = (inst.exchange || '').toLowerCase();
            const qualified = `${shortSym}/${exch}`;
            const qualifiedAt = `${shortSym}@${exch}`;
            if (q && !symL.includes(q) && !(inst.name || '').toLowerCase().includes(q) && !qualified.includes(q) && !qualifiedAt.includes(q)) continue;
            if (this.filter === 'favorites') {
                if (!this.favorites.has(sym)) continue;
            } else if (this.filter !== 'all') {
                // Any other filter value is an assigned instrument category,
                // matched case-insensitively.
                if ((inst.category || '').toLowerCase() !== this.filter.toLowerCase()) continue;
            }
            rows.push(inst);
        }
        return rows;
    }

    _render(): void {
        this._grid?.setRows(this._filtered());
    }

    // The blotter's single column declaration. Prices and percentages come off
    // the live stats map rather than the instrument row, so a quote arriving
    // between two renders is picked up by the next one.
    _columns(): GridColumn<InstrumentRow>[] {
        const label = (key: string) => this._host.t(key);
        return [
            {
                key: 'symbol',
                header: label('Symbol'),
                exportable: true,
                value: (i) => i.symbol,
                cellClass: () => 'wl-sym-cell',
                render: (i) => this._symbolCell(i),
                exportValue: (i) => String(i.symbol).split('@')[0],
            },
            {
                key: 'last',
                header: label('Last'),
                headerClass: 'ta-right',
                exportable: true,
                value: (i) => this._statsOf(i).lastPrice,
                cellClass: () => 'wl-last',
                render: (i) => WatchlistWidget._priceText(this._statsOf(i).lastPrice),
                exportValue: (i) => this._statsOf(i).lastPrice ?? '',
            },
            {
                key: 'chgPct',
                header: label('Change24hPct'),
                headerClass: 'ta-right',
                exportable: true,
                value: (i) => this._statsOf(i).chgPct,
                cellClass: (i) => ('wl-chg ' + WatchlistWidget._changeClass(this._statsOf(i).chgPct)).trim(),
                render: (i) => WatchlistWidget._changeText(this._statsOf(i).chgPct),
                exportValue: (i) => this._statsOf(i).chgPct ?? '',
            },
        ];
    }

    _statsOf(instrument: InstrumentRow): QuoteStats {
        return this.stats.get(String(instrument.symbol)) ?? {};
    }

    // The favourite star plus the short symbol. The star stops the click from
    // reaching the row, whose own listener switches the host's instrument.
    _symbolCell(instrument: InstrumentRow): Node {
        const cell = document.createDocumentFragment();

        const star = document.createElement('button');
        star.type = 'button';
        star.className = this.favorites.has(instrument.symbol!) ? 'wl-fav active' : 'wl-fav';
        star.title = this._host.t('Favorite');
        star.textContent = '★';
        star.addEventListener('click', (e) => {
            e.stopPropagation();
            this._toggleFavorite(instrument.symbol!);
        });
        cell.appendChild(star);

        const label = document.createElement('span');
        label.className = 'wl-sym';
        label.textContent = String(instrument.symbol).split('@')[0];
        cell.appendChild(label);

        return cell;
    }

    // Export the current filtered+sorted view to .xlsx — every matching
    // instrument, without the RENDER_CAP truncation applied to the DOM.
    _export(): void {
        this._grid?.download('watchlist', this._host.t('Markets'));
    }

    // Patch the price and change cells of one row in place. A full render would
    // replace the cell element and so cancel the flash animation started here.
    _updateRow(symbol: string, prevPrice: number | null | undefined): void {
        if (!this._grid) return;
        const st = this.stats.get(symbol) || {};
        const lastEl = this._grid.cellElement(String(symbol), 'last');
        const chgEl = this._grid.cellElement(String(symbol), 'chgPct');
        if (lastEl && st.lastPrice != null) {
            lastEl.textContent = WatchlistWidget._priceText(st.lastPrice);
            if (prevPrice != null && st.lastPrice !== prevPrice) {
                lastEl.classList.remove('flash-up', 'flash-down');
                void lastEl.offsetWidth;
                lastEl.classList.add(st.lastPrice > prevPrice ? 'flash-up' : 'flash-down');
            }
        }
        if (chgEl && st.chgPct != null && isFinite(Number(st.chgPct))) {
            chgEl.textContent = WatchlistWidget._changeText(st.chgPct);
            chgEl.classList.remove('up', 'down');
            chgEl.classList.add(WatchlistWidget._changeClass(st.chgPct));
        }
    }

    _toggleFavorite(symbol: string): void {
        if (!this._host.allow('add to favorites')) return;
        if (this.favorites.has(symbol)) this.favorites.delete(symbol);
        else this.favorites.add(symbol);
        this._saveFavorites();
        // Broadcast the change to every other watchlist instance so they reflect
        // the new state without a fresh fetch.
        this._host.broadcast<WatchlistWidget>(w => {
            if (w !== this) { w.favorites = new Set(this.favorites); w._render(); }
        });
        this._render();
    }

    _loadFavorites(): string[] {
        try {
            const raw = this._host.preferences.get(WatchlistWidget.FAVORITES_KEY, null);
            return raw ? JSON.parse(raw) : [];
        } catch { return []; }
    }

    _saveFavorites(): void {
        try { this._host.preferences.set(WatchlistWidget.FAVORITES_KEY, JSON.stringify(Array.from(this.favorites))); }
        catch { /* store may be unavailable */ }
    }

    // The symbols at the top of the current order — the ones a user is actually
    // looking at, and the set both the subscriptions and the host's ticker are
    // sized to.
    _visible(): InstrumentRow[] {
        return this._grid ? this._grid.sortedRows().slice(0, WatchlistWidget.VISIBLE_CAP) : [];
    }

    // Diff the desired set of visible symbols against currently-held live-price
    // subscriptions, then add/remove to converge. Called after every render that
    // may have changed the visible list (filter, sort, search). add/removeSymbol
    // refcount internally, so another control's subscription on the same symbol
    // is not affected.
    _syncSubs(): void {
        if (!this.wsClient) return;
        const desired = new Set(this._visible().map(i => String(i.symbol).split('@')[0]));

        for (const sym of this._subscribedSyms) {
            if (!desired.has(sym)) {
                try { void this.wsClient.removeSymbol(sym); } catch { /* socket race */ }
                this._subscribedSyms.delete(sym);
            }
        }
        // Stagger the subscribe burst — firing every watchlist symbol
        // simultaneously while a chart is fetching its history starves the
        // adapter and stalls the chart's snapshot. 80ms between calls keeps the
        // pipe quiet enough for that fetch to return on time, while still
        // feeling instant to the user.
        let i = 0;
        for (const sym of desired) {
            if (this._subscribedSyms.has(sym)) continue;
            this._subscribedSyms.add(sym);
            setTimeout(() => {
                try { void this.wsClient.addSymbol(sym, MarketDataLevels.Quotes); } catch { /* socket race */ }
            }, i * 80);
            i++;
        }
    }

    // Tell the host which symbols are on screen. Only the primary instance
    // speaks for the page: duplicated watchlist panels have their own filters,
    // and the page has one ticker for them to fight over.
    _publishVisible(): void {
        if (!this._host.isPrimary) return;
        this._host.ticker.publish(this._visible().map(i => String(i.symbol)), this.stats);
    }

    static _priceText(price: number | null | undefined): string {
        const n = Number(price);
        if (price == null || !isFinite(n) || n === 0) return '--';
        if (n >= 1) return n.toFixed(2);
        if (n >= 0.01) return n.toFixed(4);
        return n.toFixed(6);
    }

    static _changeText(chgPct: number | null | undefined): string {
        const pct = Number(chgPct);
        if (chgPct == null || !isFinite(pct)) return '--';
        return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
    }

    static _changeClass(chgPct: number | null | undefined): string {
        const pct = Number(chgPct);
        if (chgPct == null || !isFinite(pct)) return '';
        return pct >= 0 ? 'up' : 'down';
    }
}
