// Order entry — a split Buy/Sell pad sharing one order-type selector.
//
// Builds its own DOM (see `_buildRoot`) rather than cloning a <template> out of
// the page it happens to be rendered on, and every element it reads is queried
// under `this.rootEl`, so a host may place more than one of these on a page.
//
// It fetches nothing. Reference prices arrive as the host sees them
// (`setLimitPrice`, `setBbo`), the size and price grid the venue will accept
// arrives as an `InstrumentSpec` (`setInstrument`), and the balance figures the
// percent buttons divide arrive through `setAvailable` / `setMaxQuantity`.
//
// Placing the order is deliberately not this control's to do: `TradingApi` is
// read-only, and everything that has to happen before the wire — the sign-in
// gate, the connection check, which portfolio the order belongs to — is the
// host's. So the pad validates, collects the form and hands both to the
// `submitOrder` dep.
//
// It renders no table, so it is the one control here that does not use
// `DataGrid`.
import { formatPrice, formatQty } from './formatters.js';
import { makeElement, makeIconButton, makePanelId, makePanelRoot } from './dom.js';
import { ControlTypes } from './control-types.js';
import { TradingHost, assertHost } from './trading-host.js';
import type { InstrumentSpec } from './trading-data.js';

/// The pad's two columns. Every method that addresses one takes this rather
/// than a wire side, because a column is the control's own vocabulary: which of
/// the two forms is being filled in, not what the resulting order will say.
export const OrderEntrySides = {
    Buy: 'buy',
    Sell: 'sell',
} as const;

export type OrderEntrySide = typeof OrderEntrySides[keyof typeof OrderEntrySides];

/// The order kinds the pad offers. The values are what `data-type` carries on
/// the tab buttons and what `toApiType` maps onto StockSharp's `OrderTypes`.
export const OrderEntryTypes = {
    Market: 'market',
    Limit: 'limit',
    Stop: 'stop',
    StopLimit: 'stoplimit',
} as const;

export type OrderEntryType = typeof OrderEntryTypes[keyof typeof OrderEntryTypes];

/// One column of the form, read off its inputs at the moment it is asked for.
/// A price the chosen type does not use comes back null, so a host can forward
/// the object without deciding which fields the type made meaningful.
export interface OrderEntryValues {
    type: OrderEntryType;
    quantity: number;
    limitPrice: number | null;
    stopPrice: number | null;
    /// Both null while the take-profit / stop-loss block is switched off.
    takeProfit: number | null;
    stopLoss: number | null;
}

/// Everything the pad needs beyond the host port. `submitOrder` is required: a
/// form that cannot send is not an order pad, and the port cannot carry it —
/// `TradingApi` is read-only by design and the send is host policy.
export interface OrderEntryDeps {
    host: TradingHost;
    submitOrder(side: OrderEntrySide, values: OrderEntryValues): void;
}

// StockSharp `Sides`, the spelling `TradingPresentation.sideText` reads. The
// pad words neither button itself — the host owns the trading vocabulary.
const WIRE_SIDES: Record<OrderEntrySide, number> = { buy: 0, sell: 1 };

// The percentage-of-maximum buttons under the quantity field.
const PERCENT_STEPS = [25, 50, 75, 100];

// Where each value lives inside a column. Structure, not looks: the inputs are
// reached through the field they belong to, so the markup carries one class per
// field rather than one per input.
const PRICE_INPUT = '.oe-field-price input';
const STOP_INPUT = '.oe-field-stop input';
const QTY_INPUT = '.oe-field-qty input';
const TP_INPUT = '.oe-field-tp input';
const SL_INPUT = '.oe-field-sl input';
const TPSL_CHECK = '.oe-tpsl-toggle input';
const AVAILABLE_VALUE = '.oe-avbl .oe-value';
const TOTAL_VALUE = '.oe-total .oe-value';
const MAX_VALUE = '.oe-foot .oe-value';

// The value fields, in the order a column shows them.
const VALUE_INPUTS = [PRICE_INPUT, STOP_INPUT, QTY_INPUT, TP_INPUT, SL_INPUT];

export class OrderEntryWidget {
    static TYPE = ControlTypes.OrderEntry;
    static SIDES: readonly OrderEntrySide[] = [OrderEntrySides.Buy, OrderEntrySides.Sell];

    rootEl: HTMLElement;
    el: HTMLElement | null;
    // Comment style is `//` on purpose below the public members: the declaration
    // emitter keeps a private member's doc comment while dropping its body, so a
    // `///` here would reattach to the next public member in the API snapshot.
    _host: TradingHost;
    _deps: OrderEntryDeps;
    _closeBtn: HTMLElement | null;
    _cols: Record<OrderEntrySide, HTMLElement | null>;
    _orderType: OrderEntryType;
    _instrument: InstrumentSpec | null;
    _lastPrice: number;
    _bestBid: number;
    _bestAsk: number;
    _maxQuantity: Record<OrderEntrySide, number | null>;
    // Which input the user is in. Tracked here rather than read off
    // `document.activeElement`, which is a document-wide lookup a control scoped
    // to its own root has no business making.
    _focused: HTMLElement | null;
    _enabled: boolean;

    static create(hostEl: HTMLElement, state: Record<string, unknown>, deps: OrderEntryDeps): OrderEntryWidget {
        // Assert before building: the markup below is localized through the
        // host, so a missing host has to fail here rather than render a pad
        // captioned with raw English keys.
        const host = assertHost(deps?.host, 'OrderEntryWidget');
        const root = OrderEntryWidget._buildRoot(host);
        root.id = makePanelId(OrderEntryWidget.TYPE);
        hostEl.appendChild(root);
        return new OrderEntryWidget(root, state || {}, deps);
    }

    // The pad's markup. The host stylesheet reads this structure, and a docking
    // host lifts `.panel-header`'s children into its tab strip.
    //
    // There is no `+` button in the header: a second pad on the same portfolio
    // is a host decision about the account, not a gesture the form offers.
    static _buildRoot(host: TradingHost): HTMLElement {
        const title = host.t('OrderEntry');
        return makePanelRoot('order-entry-panel', title, [
            makeElement('div', 'panel-header', {}, [
                makeElement('span', '', {}, [title]),
                makeIconButton('bt-icon-btn bt-icon-cancel panel-close-btn', host.t('ClosePanel'), 'bi-x', { type: 'button' }),
            ]),
            makeElement('div', 'order-entry-content', {}, [
                OrderEntryWidget._buildTypeTabs(host),
                makeElement('div', 'order-entry-split', {}, [
                    OrderEntryWidget._buildColumn(host, OrderEntrySides.Buy),
                    OrderEntryWidget._buildColumn(host, OrderEntrySides.Sell),
                ]),
            ]),
        ]);
    }

    // Two pairs of type buttons, so each pair lines up with the column beneath
    // it. Which one is active is decided by `setOrderType`, from the constructor
    // and from a later click alike.
    static _buildTypeTabs(host: TradingHost): HTMLElement {
        const tab = (type: OrderEntryType, caption: string) =>
            makeElement('button', 'btn-ot', { type: 'button', 'data-type': type, 'aria-pressed': 'false' }, [caption]);

        return makeElement('div', 'order-type-tabs', { role: 'group', 'aria-label': host.t('OrderType') }, [
            makeElement('div', 'ot-pair', {}, [
                tab(OrderEntryTypes.Market, host.t('Market')),
                tab(OrderEntryTypes.Limit, host.t('Limit')),
            ]),
            makeElement('div', 'ot-pair', {}, [
                tab(OrderEntryTypes.Stop, host.t('Stop')),
                tab(OrderEntryTypes.StopLimit, host.t('StopLimit')),
            ]),
        ]);
    }

    // One column. The modifier class and the submit button's colour class are
    // assigned as whole literals rather than composed, so the style contract can
    // read this control's class list out of the source.
    static _buildColumn(host: TradingHost, side: OrderEntrySide): HTMLElement {
        const isBuy = side === OrderEntrySides.Buy;
        const sideText = host.presentation.sideText(WIRE_SIDES[side]);
        const maxLabel = isBuy ? host.t('Max Buy') : host.t('Max Sell');
        // The shortcut is the host's, so its letter is a translated string like
        // any other caption rather than a key typed in here.
        const hotkey = isBuy ? host.t('BuyHotkey') : host.t('SellHotkey');

        const submit = makeElement('button', 'btn-oe-submit', { type: 'button', 'aria-label': sideText }, [
            sideText,
            makeElement('span', 'hotkey-hint', {}, [`[${hotkey}]`]),
        ]);
        if (isBuy) submit.className = 'btn-oe-submit btn-buy';
        else submit.className = 'btn-oe-submit btn-sell';

        const column = makeElement('div', 'oe-col', { 'data-side': side }, [
            makeElement('div', 'oe-avbl', {}, [
                makeElement('span', 'oe-label', {}, [host.t('Avbl')]),
                makeElement('span', 'oe-value', {}, ['--']),
            ]),
            makeElement('div', 'oe-field oe-field-price', {}, [
                makeElement('span', 'oe-label', {}, [host.t('Price')]),
                makeElement('div', 'oe-input-grp', {}, [
                    makeElement('input', 'oe-input', { type: 'number', 'aria-label': host.t('Price') }, []),
                    makeElement('button', 'btn-bbo', { type: 'button', title: host.t('BestBidOrOffer') }, [host.t('BBO')]),
                ]),
            ]),
            makeElement('div', 'oe-field oe-field-stop', {}, [
                makeElement('span', 'oe-label', {}, [host.t('StopPrice')]),
                makeElement('input', 'oe-input', { type: 'number', 'aria-label': host.t('StopPrice') }, []),
            ]),
            makeElement('div', 'oe-field oe-field-qty', {}, [
                makeElement('span', 'oe-label', {}, [host.t('Amount')]),
                makeElement('input', 'oe-input', { type: 'number', 'aria-label': host.t('OrderQuantity') }, []),
            ]),
            makeElement('div', 'oe-pct-row', { role: 'group', 'aria-label': host.t('PercentageOfBalance') },
                PERCENT_STEPS.map(pct => makeElement('button', 'btn-oe-pct', { type: 'button', 'data-pct': String(pct) }, [`${pct}%`]))),
            makeElement('div', 'oe-total', {}, [
                makeElement('span', 'oe-label', {}, [host.t('Total')]),
                makeElement('span', 'oe-value', {}, ['--']),
            ]),
            makeElement('label', 'oe-tpsl-toggle', {}, [
                makeElement('input', '', { type: 'checkbox' }, []),
                makeElement('span', '', {}, [host.t('TpSl')]),
            ]),
            makeElement('div', 'oe-tpsl oe-field-hidden', {}, [
                makeElement('div', 'oe-field oe-field-tp', {}, [
                    makeElement('span', 'oe-label', {}, [host.t('TakeProfit')]),
                    makeElement('input', 'oe-input', { type: 'number', 'aria-label': host.t('TakeProfit') }, []),
                ]),
                makeElement('div', 'oe-field oe-field-sl', {}, [
                    makeElement('span', 'oe-label', {}, [host.t('StopLoss')]),
                    makeElement('input', 'oe-input', { type: 'number', 'aria-label': host.t('StopLoss') }, []),
                ]),
            ]),
            makeElement('div', 'oe-foot', {}, [
                makeElement('span', 'oe-label', {}, [maxLabel]),
                makeElement('span', 'oe-value', {}, ['--']),
            ]),
            submit,
            makeElement('div', 'oe-estimate', { 'aria-live': 'polite' }, []),
        ]);
        if (isBuy) column.className = 'oe-col oe-col-buy';
        else column.className = 'oe-col oe-col-sell';
        return column;
    }

    constructor(rootEl: HTMLElement, _state: Record<string, unknown>, deps: OrderEntryDeps) {
        this._host = assertHost(deps?.host, 'OrderEntryWidget');
        for (const name of ['submitOrder'] as const) {
            if (typeof deps?.[name] !== 'function')
                throw new Error(`OrderEntryWidget: dep "${name}" is required`);
        }

        this.rootEl = rootEl;
        this._deps = deps;
        this.el = this.rootEl.querySelector('.order-entry-content');
        this._closeBtn = this.rootEl.querySelector('.panel-close-btn');
        this._cols = {
            buy: this.rootEl.querySelector('.oe-col-buy'),
            sell: this.rootEl.querySelector('.oe-col-sell'),
        };
        this._orderType = OrderEntryTypes.Market;
        this._instrument = null;
        this._lastPrice = 0;
        this._bestBid = 0;
        this._bestAsk = 0;
        this._maxQuantity = { buy: null, sell: null };
        this._focused = null;
        this._enabled = true;

        this._closeBtn?.addEventListener('click', (e) => {
            e.preventDefault();
            this._host.close();
        });

        this._bindTypeTabs();
        for (const side of OrderEntryWidget.SIDES) this._bindColumn(side);
        this.setOrderType(OrderEntryTypes.Market);

        this._host.register(this);
    }

    dispose(): void {
        this._host.unregister(this);
        try { this.rootEl.remove(); } catch { /* already detached */ }
    }

    /// The type the form is on. A host reads it before deciding whether a
    /// click-to-trade gesture has to switch the pad over first.
    get orderType(): OrderEntryType {
        return this._orderType;
    }

    /// The instrument the form is sized and priced against, or null before the
    /// host has named one. Read for its tick by a host that has to quantize a
    /// price of its own before handing it over.
    getInstrument(): InstrumentSpec | null {
        return this._instrument;
    }

    /// Switch the form's order type and mark the matching tab. The tab lives
    /// under this control's own root, so a host switches type by naming the
    /// type rather than by handing over a button it looked up itself.
    setOrderType(type: OrderEntryType): void {
        this._orderType = type;
        for (const button of this.rootEl.querySelectorAll('.btn-ot')) {
            const tab = button as HTMLElement;
            const on = tab.dataset.type === type;
            tab.classList.toggle('active', on);
            tab.setAttribute('aria-pressed', String(on));
        }
        this._applyTypeVisibility();
        for (const side of OrderEntryWidget.SIDES) this._recalculate(side);
    }

    /// Adopt the venue's size and price grid: the quantity input steps by the
    /// lot, the price inputs by the tick, and the quantity resets to the minimum
    /// lot — carrying the previous value across a switch yields nonsense like
    /// "10 BTC" after a stock.
    setInstrument(instrument: InstrumentSpec | null): void {
        this._instrument = instrument;
        if (!instrument) return;

        const lotSize = Number(instrument.lotSize) || 1;
        const tickSize = Number(instrument.tickSize) || 0.01;
        const minVolume = Number(instrument.minVolume) > 0 ? Number(instrument.minVolume) : lotSize;
        const maxVolume = instrument.maxVolume != null ? Number(instrument.maxVolume) : null;

        for (const side of OrderEntryWidget.SIDES) {
            const qty = this._input(side, QTY_INPUT);
            if (qty) {
                qty.step = String(lotSize);
                qty.min = String(minVolume);
                // The empty string is how an input says "no upper bound".
                qty.max = maxVolume != null ? String(maxVolume) : '';
                qty.value = OrderEntryWidget._formatQty(minVolume);
            }
            for (const selector of [PRICE_INPUT, STOP_INPUT, TP_INPUT, SL_INPUT]) {
                const input = this._input(side, selector);
                if (input) input.step = String(tickSize);
            }
        }

        for (const side of OrderEntryWidget.SIDES) this._recalculate(side);
    }

    /// The cash this side may still commit. Null reads as "not known yet",
    /// which is not the same as zero.
    setAvailable(side: OrderEntrySide, available: number | null): void {
        const value = this._cols[side]?.querySelector(AVAILABLE_VALUE);
        if (value) value.textContent = formatPrice(available);
    }

    /// The largest quantity this side can trade — what the percent buttons take
    /// a percentage OF. Without it they have no denominator, so they report the
    /// gap through `host.log` rather than inventing one (see `applyPercent`).
    setMaxQuantity(side: OrderEntrySide, max: number | null): void {
        this._maxQuantity[side] = max != null && isFinite(max) ? max : null;
        const value = this._cols[side]?.querySelector(MAX_VALUE);
        if (value) value.textContent = formatQty(this._maxQuantity[side]);
    }

    /// A reference price off the tape. Both columns follow the market while the
    /// form is untouched; the field the trader is typing in is left alone.
    setLimitPrice(price: number): void {
        this._lastPrice = price;
        this._writePrices(this._bestBid > 0 ? this._bestBid : price, this._bestAsk > 0 ? this._bestAsk : price, false);
    }

    /// The same reference price, force-written: an explicit host gesture
    /// ("price this order here") outranks whatever was typed.
    seedLimitPrice(price: number): void {
        this._lastPrice = price;
        this._writePrices(this._bestBid > 0 ? this._bestBid : price, this._bestAsk > 0 ? this._bestAsk : price, true);
    }

    /// Best bid and offer. The passive seed for a limit form is Buy = best bid
    /// and Sell = best ask — joining the book on each side, so the spread in the
    /// form matches the spread in the book. The BBO button next to the field is
    /// the opposite, explicit gesture: take what the other side is showing.
    setBbo(bid: number, ask: number): void {
        if (bid > 0) this._bestBid = bid;
        if (ask > 0) this._bestAsk = ask;
        this._writePrices(
            this._bestBid > 0 ? this._bestBid : this._lastPrice,
            this._bestAsk > 0 ? this._bestAsk : this._lastPrice,
            false);
    }

    /// Fill one column's price with the best quote for that direction: Buy takes
    /// the ask, Sell takes the bid.
    applyBbo(side: OrderEntrySide): void {
        const bbo = side === OrderEntrySides.Buy ? this._bestAsk : this._bestBid;
        if (!(bbo > 0)) return;
        this.setPrice(side, bbo);
    }

    /// Force one column's price and let ticks resume updating it afterwards —
    /// what a click on a book level or a chart price means. Quantized to the
    /// instrument's tick, so a raw chart coordinate does not fail validation.
    setPrice(side: OrderEntrySide, price: number): void {
        const input = this._input(side, PRICE_INPUT);
        if (!input) return;
        const text = this._formatPriceForInput(price);
        if (!text) return;
        input.dataset.userEdited = '0';
        input.value = text;
        this._recalculate(side);
    }

    /// The same quantity in both columns — a quick-size gesture applies to
    /// whichever side the user goes on to press.
    setQuantity(quantity: number): void {
        for (const side of OrderEntryWidget.SIDES) {
            const input = this._input(side, QTY_INPUT);
            if (!input) continue;
            input.value = OrderEntryWidget._formatQty(quantity);
            this._recalculate(side);
        }
    }

    /// Take a percentage of this side's maximum quantity, rounded down to a
    /// whole number of lots.
    applyPercent(side: OrderEntrySide, pct: number): void {
        const max = this._maxQuantity[side];
        if (max == null) {
            this._host.log(`OrderEntryWidget: no maximum quantity for the ${side} side, so ${pct}% of it is unknown`);
            return;
        }
        const qty = this._input(side, QTY_INPUT);
        if (!qty) return;

        const step = Number(qty.step) || 0;
        let target = max * (pct / 100);
        if (step > 0) target = Math.floor(target / step) * step;
        qty.value = OrderEntryWidget._formatQty(target);
        this._recalculate(side);
    }

    /// Show or hide one column's take-profit / stop-loss block, checkbox
    /// included, so a host can set it without reaching for the input.
    toggleTpSl(side: OrderEntrySide, on: boolean): void {
        const check = this._input(side, TPSL_CHECK);
        if (check) check.checked = on;
        this._show(this._cols[side]?.querySelector('.oe-tpsl') as HTMLElement | null, on);
    }

    /// Mark one column's submit button as the one a host-level gesture aimed at.
    /// Null clears both.
    preselect(side: OrderEntrySide | null): void {
        for (const each of OrderEntryWidget.SIDES) {
            const button = this._cols[each]?.querySelector('.btn-oe-submit');
            button?.classList.toggle('btn-preselected', each === side);
        }
    }

    /// Turn submitting off while the host cannot send — a dropped socket, a
    /// portfolio still loading. The form stays readable and editable; only the
    /// two buttons stop.
    setEnabled(enabled: boolean): void {
        this._enabled = enabled;
        this.el?.classList.toggle('oe-offline', !enabled);
        for (const side of OrderEntryWidget.SIDES) this._validateSide(side);
    }

    /// The submit button, and whatever host gesture stands in for it. Validates
    /// first, so a form the venue would reject never reaches the account.
    submit(side: OrderEntrySide): void {
        const error = this.validate(side);
        this._validateSide(side);
        if (error || !this._enabled) return;
        this._deps.submitOrder(side, this.getValues(side));
    }

    /// What one column currently says.
    getValues(side: OrderEntrySide): OrderEntryValues {
        const type = this._orderType;
        const carriesLimit = type === OrderEntryTypes.Limit || type === OrderEntryTypes.StopLimit;
        const carriesStop = type === OrderEntryTypes.Stop || type === OrderEntryTypes.StopLimit;
        const tpSlOn = this._input(side, TPSL_CHECK)?.checked === true;

        return {
            type,
            quantity: this._number(side, QTY_INPUT) ?? 0,
            limitPrice: carriesLimit ? this._number(side, PRICE_INPUT) : null,
            stopPrice: carriesStop ? this._number(side, STOP_INPUT) : null,
            takeProfit: tpSlOn ? this._number(side, TP_INPUT) : null,
            stopLoss: tpSlOn ? this._number(side, SL_INPUT) : null,
        };
    }

    /// The reason this column cannot be sent, worded by the host, or null when
    /// it can. Nothing is checked before the instrument is known — the venue's
    /// grid is what every rule below measures against.
    validate(side: OrderEntrySide): string | null {
        const instrument = this._instrument;
        if (!instrument) return null;

        const { quantity, limitPrice, stopPrice, type } = this.getValues(side);

        if (quantity <= 0) return this._host.t('Quantity must be positive');

        const lotSize = Number(instrument.lotSize) || 0;
        if (lotSize > 0 && !OrderEntryWidget._isMultipleOf(quantity, lotSize))
            return this._host.t('Quantity must be a multiple of {0}', lotSize);

        const minVolume = Number(instrument.minVolume) > 0 ? Number(instrument.minVolume) : lotSize;
        if (minVolume > 0 && quantity < minVolume) return this._host.t('Quantity must be >= {0}', minVolume);

        if (instrument.maxVolume != null && quantity > Number(instrument.maxVolume))
            return this._host.t('Quantity must be <= {0}', instrument.maxVolume);

        const tickSize = Number(instrument.tickSize) || 0;

        if (type === OrderEntryTypes.Limit || type === OrderEntryTypes.StopLimit) {
            if (!limitPrice || limitPrice <= 0) return this._host.t('Limit price must be positive');
            if (tickSize > 0 && !OrderEntryWidget._isMultipleOf(limitPrice, tickSize))
                return this._host.t('Limit price must be a multiple of {0}', tickSize);
        }

        if (type === OrderEntryTypes.Stop || type === OrderEntryTypes.StopLimit) {
            if (!stopPrice || stopPrice <= 0) return this._host.t('Stop price must be positive');
            if (tickSize > 0 && !OrderEntryWidget._isMultipleOf(stopPrice, tickSize))
                return this._host.t('Stop price must be a multiple of {0}', tickSize);
        }

        return null;
    }

    /// Map a form type onto StockSharp's `OrderTypes`: Limit=0, Market=1,
    /// Conditional=2. Static because a host needs it to word the order it is
    /// about to send, which it can do before any instance exists.
    static toApiType(uiType: OrderEntryType | string): number {
        switch (uiType) {
            case OrderEntryTypes.Limit: return 0;
            case OrderEntryTypes.Market: return 1;
            case OrderEntryTypes.Stop:
            case OrderEntryTypes.StopLimit: return 2;
            default: return 1;
        }
    }

    /// Is `value` a whole number of `step`s? Scaled to integers first: a crypto
    /// lot of 1e-9 against a quantity of 0.001 is not a modulo binary floats can
    /// answer directly.
    static _isMultipleOf(value: number, step: number): boolean {
        if (!(step > 0)) return true;
        if (value === 0) return true;
        const maxDec = Math.max(OrderEntryWidget._decimals(step), OrderEntryWidget._decimals(value));
        const scale = Math.pow(10, maxDec);
        const scaledValue = Math.round(value * scale);
        const scaledStep = Math.round(step * scale);
        if (scaledStep <= 0) return true;
        if (scaledValue === 0) return false;
        return scaledValue % scaledStep === 0;
    }

    /// A quantity as an input's `value`: every significant decimal, no thousands
    /// separator and no exponent, because the browser reads this string back as
    /// a number.
    static _formatQty(n: number): string {
        if (!isFinite(n) || n === 0) return '0';
        const d = OrderEntryWidget._decimals(n);
        return n.toFixed(Math.min(d, 20));
    }

    /// How many decimals a number is written with, exponent form included.
    static _decimals(n: number): number {
        if (!isFinite(n) || n === 0) return 0;
        const s = Math.abs(n).toString();
        const eIdx = s.indexOf('e-');
        if (eIdx >= 0) {
            const mantissaDec = s.slice(0, eIdx).split('.')[1]?.length ?? 0;
            return parseInt(s.slice(eIdx + 2), 10) + mantissaDec;
        }
        const dot = s.indexOf('.');
        return dot < 0 ? 0 : s.length - dot - 1;
    }

    _bindTypeTabs(): void {
        for (const button of this.rootEl.querySelectorAll('.btn-ot')) {
            const tab = button as HTMLElement;
            tab.addEventListener('click', (e) => {
                e.preventDefault();
                const type = tab.dataset.type as OrderEntryType | undefined;
                if (type) this.setOrderType(type);
            });
        }
    }

    // Everything one column listens to. Scoped to the column element, which is
    // what lets two pads coexist: an input is found by the field it belongs to
    // under its own root, never by a page-wide id.
    _bindColumn(side: OrderEntrySide): void {
        const column = this._cols[side];
        if (!column) return;

        const qty = this._input(side, QTY_INPUT);
        if (qty) {
            qty.value = '1';
            qty.min = '1';
            qty.step = '1';
        }

        for (const selector of VALUE_INPUTS) {
            const input = this._input(side, selector);
            if (!input) continue;
            input.addEventListener('input', () => this._recalculate(side));
            input.addEventListener('focus', () => { this._focused = input; });
            input.addEventListener('blur', () => { if (this._focused === input) this._focused = null; });
            // Mark a price the trader typed, so an incoming tick stops
            // overwriting it mid-keystroke.
            if (selector === PRICE_INPUT || selector === STOP_INPUT)
                input.addEventListener('input', () => { input.dataset.userEdited = '1'; });
        }

        column.querySelector('.btn-bbo')?.addEventListener('click', (e) => {
            e.preventDefault();
            this.applyBbo(side);
        });

        for (const button of column.querySelectorAll('.btn-oe-pct')) {
            const pct = button as HTMLElement;
            pct.addEventListener('click', (e) => {
                e.preventDefault();
                this.applyPercent(side, Number(pct.dataset.pct) || 0);
            });
        }

        const check = this._input(side, TPSL_CHECK);
        check?.addEventListener('change', () => this.toggleTpSl(side, check.checked === true));

        column.querySelector('.btn-oe-submit')?.addEventListener('click', (e) => {
            e.preventDefault();
            this.submit(side);
        });
    }

    // Which price fields the current type makes meaningful. A class toggle, not
    // a display style: the pad emits names and the stylesheet decides.
    _applyTypeVisibility(): void {
        const showLimit = this._orderType === OrderEntryTypes.Limit || this._orderType === OrderEntryTypes.StopLimit;
        const showStop = this._orderType === OrderEntryTypes.Stop || this._orderType === OrderEntryTypes.StopLimit;
        for (const side of OrderEntryWidget.SIDES) {
            this._show(this._cols[side]?.querySelector('.oe-field-price') as HTMLElement | null, showLimit);
            this._show(this._cols[side]?.querySelector('.oe-field-stop') as HTMLElement | null, showStop);
        }
    }

    _show(element: HTMLElement | null, visible: boolean): void {
        element?.classList.toggle('oe-field-hidden', !visible);
    }

    // Write both price inputs. `reset` is the explicit gesture: it clears the
    // "typed in" mark so the field follows the market again. Without it, a field
    // the user is in or has already edited is left alone.
    _writePrices(buyPrice: number, sellPrice: number, reset: boolean): void {
        this._writePrice(OrderEntrySides.Buy, buyPrice, reset);
        this._writePrice(OrderEntrySides.Sell, sellPrice, reset);
        for (const side of OrderEntryWidget.SIDES) this._recalculate(side);
    }

    _writePrice(side: OrderEntrySide, price: number, reset: boolean): void {
        const input = this._input(side, PRICE_INPUT);
        if (!input) return;
        const text = this._formatPriceForInput(price);
        if (!text) return;
        if (reset) {
            input.dataset.userEdited = '0';
            input.value = text;
            return;
        }
        if (this._focused === input) return;
        if (input.dataset.userEdited === '1') return;
        input.value = text;
    }

    // Round a price to the instrument's tick and cut the float tail: a mid price
    // of (bid+ask)/2 otherwise reaches the field as 0.44625000000000004.
    _formatPriceForInput(price: number): string {
        const n = Number(price);
        if (!isFinite(n)) return '';
        const tickSize = Number(this._instrument?.tickSize) || 0;
        if (tickSize > 0)
            return (Math.round(n / tickSize) * tickSize).toFixed(OrderEntryWidget._decimals(tickSize));
        return String(parseFloat(n.toPrecision(12)));
    }

    _recalculate(side: OrderEntrySide): void {
        this._updateEstimate(side);
        this._validateSide(side);
    }

    // What the order is worth at the price it would most likely fill at: the
    // limit or stop the form names, else the side-appropriate BBO, else the last
    // print.
    _updateEstimate(side: OrderEntrySide): void {
        const total = this._cols[side]?.querySelector(TOTAL_VALUE);
        if (!total) return;

        const quantity = this._number(side, QTY_INPUT) ?? 0;
        let price: number;
        if (this._orderType === OrderEntryTypes.Limit || this._orderType === OrderEntryTypes.StopLimit) {
            price = this._number(side, PRICE_INPUT) ?? 0;
        } else if (this._orderType === OrderEntryTypes.Stop) {
            price = this._number(side, STOP_INPUT) ?? this._lastPrice;
        } else {
            const bbo = side === OrderEntrySides.Buy ? this._bestAsk : this._bestBid;
            price = bbo > 0 ? bbo : this._lastPrice;
        }

        total.textContent = quantity > 0 && price > 0
            ? (quantity * price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
            : '--';
    }

    // The estimate line doubles as the validation message and the submit button
    // follows it. A disabled pad reads as invalid for the same reason: there is
    // nothing the button could do.
    _validateSide(side: OrderEntrySide): void {
        const error = this.validate(side);
        const estimate = this._cols[side]?.querySelector('.oe-estimate');
        const submit = this._cols[side]?.querySelector('.btn-oe-submit') as HTMLButtonElement | null;

        if (estimate) {
            estimate.textContent = error || '';
            estimate.classList.toggle('oe-estimate-error', !!error);
        }
        if (submit) submit.disabled = !!error || !this._enabled;
    }

    _input(side: OrderEntrySide, selector: string): HTMLInputElement | null {
        return (this._cols[side]?.querySelector(selector) as HTMLInputElement | null) ?? null;
    }

    // An input's value as a number, or null when it is blank or unparseable —
    // which is what "the user has not said" looks like on a number field.
    _number(side: OrderEntrySide, selector: string): number | null {
        const parsed = parseFloat(this._input(side, selector)?.value ?? '');
        return isFinite(parsed) ? parsed : null;
    }
}
