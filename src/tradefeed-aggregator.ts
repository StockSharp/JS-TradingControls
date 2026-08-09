// Bubble compaction for a tape.
//
// One lane of a bubble chart is one symbol's ticks, and a busy symbol delivers
// far more of them than a lane has room for: drawn one circle per print, the
// lane melts into a solid wall. Bucketing by time slice and side turns that
// back into something readable — at most two bubbles per slice, each placed at
// its slice's volume-weighted average price and sized by its summed volume.
//
// Pure: no DOM, no host, no clock. The trade feed renders what comes out of
// here, which is what lets the arithmetic a busy symbol depends on be covered
// directly rather than through a canvas.
import type { OrderSide } from './trading-data.js';

/// One print, with the two things the tape has already decided about it: which
/// direction it went, and where it sits on the shared time axis.
///
/// `buy` is resolved by the host's presentation before a tick reaches this
/// module — the wire spells a side three ways and normalising it is the host's
/// job, not this file's — while `side` keeps the raw value, because wording it
/// is the host's job too and only it can do that. `index` is the tick's
/// position in the WHOLE feed rather than in its lane, so two symbols with
/// wildly different prices still flow along one time axis.
export interface FeedTick {
    symbol: string;
    side: OrderSide;
    buy: boolean;
    price: number;
    quantity: number;
    time: string;
    index: number;
}

/// One bubble: a tick, or the slice of ticks it stands for.
export interface FeedBubble extends FeedTick {
    /// How many ticks this bubble represents — 1 when it is a tick itself, and
    /// what the tooltip reads to say "VWAP" instead of "Price".
    count: number;
}

/// Bucket one lane's ticks into at most `maxBucketsPerSide` bubbles per side.
///
/// Below that budget every tick passes through as its own one-tick bubble, so a
/// sparse symbol still shows every print. Above it, each (side, slice) merges
/// into one bubble. `ticks` is newest-first, which is how the tape holds them,
/// so the first slice is the most recent block.
export function aggregateBubbles(ticks: FeedTick[], maxBucketsPerSide: number): FeedBubble[] {
    if (!ticks || ticks.length === 0) return [];
    const budget = Math.max(1, Math.floor(maxBucketsPerSide));

    // The two directions compete for the same horizontal room, so each gets its
    // own budget rather than the busier one crowding the other out.
    const buys: FeedTick[] = [];
    const sells: FeedTick[] = [];
    for (const tick of ticks) (tick.buy ? buys : sells).push(tick);

    const bubbles: FeedBubble[] = [];
    for (const side of [buys, sells]) {
        if (side.length === 0) continue;
        if (side.length <= budget) {
            for (const tick of side) bubbles.push({ ...tick, count: 1 });
            continue;
        }
        const bucketSize = Math.ceil(side.length / budget);
        for (let start = 0; start < side.length; start += bucketSize)
            bubbles.push(merge(side.slice(start, start + bucketSize)));
    }
    return bubbles;
}

/// One slice as a single bubble: total volume, volume-weighted price, and the
/// slice's middle tick for its position on the time axis.
function merge(slice: FeedTick[]): FeedBubble {
    let quantity = 0;
    let weighted = 0;
    for (const tick of slice) {
        const q = tick.quantity || 0;
        quantity += q;
        weighted += q * tick.price;
    }
    // A slice can legitimately total zero volume (an all-zero-quantity tape is
    // rare live and ordinary in a fixture), and dividing by it would place the
    // bubble at NaN — nowhere, silently. Its first price is the honest answer.
    const price = quantity > 0 ? weighted / quantity : slice[0].price;
    const middle = slice[Math.floor(slice.length / 2)];
    return {
        symbol: slice[0].symbol,
        side: slice[0].side,
        buy: slice[0].buy,
        price,
        quantity,
        time: middle.time,
        index: middle.index,
        count: slice.length,
    };
}
