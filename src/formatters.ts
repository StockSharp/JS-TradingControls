// Value formatters — pure functions over numbers, prices, quantities, times
// and one venue string.
//
// Nothing here reaches a translator, the DOM, a singleton or a window global,
// and the module has no import and no side effect. That is why it is its own
// file: this is the half of the presentation a control needs in ANY host. The
// other half — a host's own vocabulary for a side, a type, a status — is
// `TradingPresentation`, which is handed to a control rather than imported by
// it.
type Numeric = number | string | null | undefined;

/// Digits chosen from the magnitude of the price. A fixed two decimals
/// collapses distinct ticks of a penny instrument onto the same "0.44" —
/// on the Y axis, in the order book, in the price header, everywhere — while
/// six decimals on a $76,000 print is noise.
export function formatPrice(price: Numeric): string {
    if (price == null || isNaN(Number(price))) return '--';
    const n = Number(price);
    const a = Math.abs(n);
    let prec = 2;
    if (a < 1) prec = 4;
    if (a < 0.1) prec = 5;
    if (a < 0.001) prec = 6;
    if (a >= 1000) prec = 1;
    if (a >= 10000) prec = 0;
    return n.toFixed(prec);
}

/// Crypto quantities carry up to 8 decimals, so the cap is 8 rather than the
/// locale default of 3; trailing zeros are trimmed because a size of "1" reads
/// better than "1.00000000" in a ladder.
export function formatQty(qty: Numeric): string {
    if (qty == null) return '--';
    const n = Number(qty);
    if (!isFinite(n)) return '--';
    return n.toLocaleString(undefined, { maximumFractionDigits: 8 });
}

/// Wall-clock time of day, 24h, seconds included — a trade blotter is read by
/// eye against the tape, so the format is fixed rather than locale-driven.
export function formatTime(dateStr: string | number | Date | null | undefined): string {
    const d = new Date(dateStr as string);
    return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/// A signed figure: profit carries an explicit `+` so a gain and a loss are
/// told apart by the number alone, without relying on the colour class.
export function formatPnl(pnl: Numeric): string {
    if (pnl == null) return '--';
    const val = Number(pnl);
    const sign = val >= 0 ? '+' : '';
    return sign + val.toFixed(2);
}

/// Some venue adapters hand us a wrapped error string like
///   "failed to complete request (err=Forbidden): {"code":40310000,"message":"cost basis must be >= ..."}"
/// The raw form is stored for audit, but users should see the human-readable
/// message only. Pull `message` out of the embedded JSON when present;
/// otherwise return the reason as-is.
export function cleanRejectReason(reason: string | null | undefined): string {
    if (!reason) return '';
    const i = reason.indexOf('{');
    const j = reason.lastIndexOf('}');
    if (i >= 0 && j > i) {
        try {
            const parsed = JSON.parse(reason.substring(i, j + 1));
            if (parsed && typeof parsed.message === 'string' && parsed.message.length > 0)
                return parsed.message;
        } catch { /* fall through to raw */ }
    }
    return reason;
}
