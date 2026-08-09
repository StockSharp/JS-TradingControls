// A complete TradingHost, recording what a control asks of it.
//
// This object is the point of the port: if it is enough here, it is enough
// anywhere. Nothing in it knows what a terminal is — the translator answers
// with the English source text, so the captions the tests assert are the keys
// themselves, and the presentation vocabulary is a plain implementation of
// `TradingPresentation` rather than any application's.
//
// The presentation below is a HOST's answer, not the package's: the wire
// spellings it accepts (`0`/`'Buy'`/`'BUY'`) are exactly the ones a control
// hands it, so a control that stopped passing the raw value through would show
// up here.
import type {
    HostStore, OrderSide, OrderStatus, OrderType,
    QuoteStats, TradingHost, TradingPresentation,
} from '../src/index.js';

export interface HostCalls {
    closed: number;
    spawned: Record<string, unknown>[];
    persisted: Record<string, unknown>[];
    saved: number;
    published: string[][];
    allowed: string[];
    logged: string[];
    registered: object[];
}

export type TestHost = TradingHost & { calls: HostCalls };

/// StockSharp OrderStates as they arrive on the wire, mapped to the text this
/// host words them as.
const STATE_TEXT: Record<number, string> = {
    1: 'PendRisk',
    2: 'Sent',
    3: 'Active',
    4: 'PartFill',
    5: 'Filled',
    6: 'Rejected',
    7: 'Cancelled',
};

export const testPresentation: TradingPresentation = {
    sideText(side: OrderSide) {
        if (side === 0 || side === 'Buy' || side === 'BUY') return 'Buy';
        if (side === 1 || side === 'Sell' || side === 'SELL') return 'Sell';
        return String(side);
    },

    isBuy(side: OrderSide) {
        return side === 0 || side === 'Buy' || side === 'BUY';
    },

    typeText(type: OrderType, limitPrice: number, stopPrice: number) {
        if (type === 0 || type === 'Limit') return 'LMT';
        if (type === 1 || type === 'Market') return 'MKT';
        if (type === 2 || type === 'Conditional')
            return (limitPrice != null && stopPrice != null) ? 'STP-LMT' : 'STP';
        return String(type);
    },

    statusText(status: OrderStatus) {
        return (typeof status === 'number' ? STATE_TEXT[status] : status) ?? String(status);
    },

    sideClass(side: OrderSide) {
        if (side === 0 || side === 'Buy' || side === 'BUY') return 'side-buy';
        if (side === 1 || side === 'Sell' || side === 'SELL') return 'side-sell';
        return '';
    },

    pnlClass(pnl: number) {
        if (pnl == null) return '';
        return Number(pnl) >= 0 ? 'pnl-positive' : 'pnl-negative';
    },

    // Deliberately unlike the two token colours a real host would answer with:
    // a control that painted a literal of its own would still look plausible on
    // screen, and would be caught here.
    canvasPalette() {
        return { up: 'test-up', down: 'test-down', grid: 'test-grid', font: 'test-font' };
    },
};

/// The port's member names, for the "a missing member is named" test.
export const HOST_MEMBERS = [
    'isPrimary', 't', 'presentation', 'preferences', 'cache', 'trading', 'ticker',
    'allow', 'log', 'close', 'spawn', 'persistState', 'saveLayout',
    'register', 'unregister', 'broadcast',
] as const;

/// Every member that hangs off one of the objects above. Listed separately
/// because they are the ones actually at risk: a host builds `trading.api` as an
/// object and then forgets a call on it, which the object-level check above
/// cannot see. Paths, so the test can delete one and read the name back out of
/// the error.
export const HOST_NESTED_MEMBERS = [
    'presentation.sideText', 'presentation.isBuy', 'presentation.typeText', 'presentation.statusText',
    'presentation.sideClass', 'presentation.pnlClass', 'presentation.canvasPalette',
    'preferences.get', 'preferences.set',
    'cache.get', 'cache.set',
    'trading.api', 'trading.api.getExecutions', 'trading.api.searchInstruments',
    'trading.marketData', 'trading.marketData.addSymbol', 'trading.marketData.removeSymbol',
    'trading.marketData.resubscribe', 'trading.marketData.getOrders',
    'trading.portfolioId', 'trading.pickInstrument',
    'ticker.publish',
] as const;

/// A copy of `host` with one dotted path missing, so a test can ask what its
/// absence reports.
///
/// Copied down the path rather than deleted in place: every host these tests
/// build shares one `presentation` object, and a delete on it would leak into
/// the next case of the loop that called this.
export function withoutMember(host: TestHost, path: string): Record<string, unknown> {
    return remove(host as unknown as Record<string, unknown>, path.split('.'));

    function remove(node: Record<string, unknown>, [head, ...rest]: string[]): Record<string, unknown> {
        const copy = { ...node };
        if (rest.length === 0) delete copy[head];
        else copy[head] = remove(node[head] as Record<string, unknown>, rest);
        return copy;
    }
}

/// `{0}`, `{1}` … replaced positionally, and an unknown key answers as itself.
function translate(key: string, ...args: unknown[]): string {
    let out = key;
    args.forEach((arg, i) => { out = out.split(`{${i}}`).join(String(arg)); });
    return out;
}

function memoryStore(): HostStore {
    const map = new Map<string, string>();
    return {
        get: (key, fallback) => (map.has(key) ? map.get(key)! : fallback),
        set: (key, value) => { if (value === null) map.delete(key); else map.set(key, value); },
    };
}

export function fakeHost(): TestHost {
    const calls: HostCalls = {
        closed: 0, spawned: [], persisted: [], saved: 0,
        published: [], allowed: [], logged: [], registered: [],
    };
    const siblings = new Set<object>();

    const host: TradingHost = {
        isPrimary: true,
        t: translate,
        presentation: testPresentation,
        preferences: memoryStore(),
        cache: memoryStore(),
        trading: {
            api: { getExecutions: () => Promise.resolve([]), searchInstruments: () => Promise.resolve([]) },
            marketData: {
                addSymbol: () => Promise.resolve(), removeSymbol: () => Promise.resolve(),
                resubscribe: () => Promise.resolve(), getOrders: () => [],
            },
            portfolioId: () => null,
            pickInstrument: () => { },
        },
        ticker: { publish: (symbols: string[], _stats: Map<string, QuoteStats>) => calls.published.push(symbols) },
        allow: (action) => { calls.allowed.push(action); return true; },
        log: (message) => calls.logged.push(message),
        close: () => { calls.closed += 1; },
        spawn: (state) => calls.spawned.push(state),
        persistState: (patch) => calls.persisted.push(patch),
        saveLayout: () => { calls.saved += 1; },
        register: (control) => { siblings.add(control); calls.registered.push(control); },
        unregister: (control) => { siblings.delete(control); },
        broadcast: (apply) => siblings.forEach(apply as (control: object) => void),
    };

    return Object.assign(host, { calls });
}
