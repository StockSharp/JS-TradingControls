import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { asDom, asFake, el, installFakeDom, type FakeElement } from './fake-dom.js';
import { fakeHost } from './fake-host.js';
import { headerCaptions, painted, rowKeys } from './panel-probe.js';
import { OptionDeskWidget, greekPlaces, greekScales, scaleChain, sideGreeks, type OptionChainContext, type OptionStrike } from '../src/option-desk-widget.js';

installFakeDom();

/// Three strikes around a spot of 100: one where the call is in the money, one at it, one where
/// the put is. Volumes differ per side so the two scales can be told apart.
const CHAIN: OptionStrike[] = [
    {
        strike: 90,
        call: { symbol: 'C90', bid: 11, ask: 11.5, volume: 40, openInterest: 400, ivLast: 0.25 },
        put: { symbol: 'P90', bid: 1, ask: 1.2, volume: 10, openInterest: 100, ivLast: 0.30 },
    },
    {
        strike: 100,
        call: { symbol: 'C100', bid: 5, ask: 5.4, volume: 100, openInterest: 900, ivLast: 0.20 },
        put: { symbol: 'P100', bid: 4.8, ask: 5.1, volume: 50, openInterest: 500, ivLast: 0.21 },
    },
    {
        strike: 110,
        call: { symbol: 'C110', bid: 1.1, ask: 1.4, volume: 20, openInterest: 200, ivLast: 0.28 },
        put: { symbol: 'P110', bid: 10.5, ask: 11, volume: 25, openInterest: 250, ivLast: 0.35 },
    },
];

const CONTEXT: OptionChainContext = { assetPrice: 100, timeToExpiry: 0.5, riskFree: 0.05, dividend: 0 };

function desk(chain = CHAIN, context: OptionChainContext = CONTEXT) {
    const parent = el('div');
    const host = fakeHost();
    const widget = OptionDeskWidget.create(asDom(parent), {}, { host });
    widget.update(chain.map(r => ({ ...r })), context);
    return { widget, root: parent.childNodes[0] as FakeElement, host };
}

function cell(widget: InstanceType<typeof OptionDeskWidget>, strike: string, column: string): FakeElement {
    return asFake(widget._grid!.cellElement(strike, column)!);
}

describe('greekPlaces', () => {
    it('gives the smallest figure in the column three significant digits', () => {
        assert.equal(greekPlaces([0.6946, 0.4299]), 4, 'a delta reads to four places');
        assert.equal(greekPlaces([0.000034012, 0.000042]), 8, 'a gamma this small needs eight');
        assert.equal(greekPlaces([75.8187, 86.2701]), 2, 'a vega in the tens needs two');
    });

    it('ignores what carries no scale, rather than being dragged to the floor by it', () => {
        assert.equal(greekPlaces([0, 0.6946]), 4, 'a zero is not a small number');
        assert.equal(greekPlaces([null, undefined, NaN, Infinity, 0.6946]), 4);
    });

    it('has an answer when there is nothing to measure', () => {
        const places = greekPlaces([]);
        assert.ok(places >= 2 && places <= 8, `${places} is a usable count`);
    });
});

describe('greekScales', () => {
    it('formats a greek the same on both sides, because the desk is read across', () => {
        const scales = greekScales(scaleChain(CHAIN, CONTEXT), CONTEXT);

        assert.equal(typeof scales.gamma, 'number');
        assert.ok(scales.gamma > scales.delta, 'gamma is the smaller number and needs the more places');
    });
});

describe('OptionDeskWidget', () => {
    it('mirrors the two sides around the strike', () => {
        const { root } = desk();
        const headers = headerCaptions(root);
        const middle = headers.indexOf('Strike');

        // Walking out from the strike, both sides pass the same columns in the same order.
        // Whichever columns are on screen: the mirror is a property of the layout, not of which
        // greeks happen to be shown.
        assert.equal(headers[middle + 1], 'IntrinsicValue', 'the strike and what it is worth sit together');
        // The one column that does not mirror is the one that names its side.
        const side = (h: string): string => (h === 'Call' || h === 'Put' ? 'Symbol' : h);
        assert.deepStrictEqual(
            headers.slice(0, middle).reverse().map(side),
            headers.slice(middle + 2).map(side));
        assert.ok(middle > 3, `the call side has columns: ${headers.join(', ')}`);
    });

    it('puts the intrinsic value beside the strike, on the side that has it', () => {
        const { widget } = desk();

        const worth = (strike: string): number => Number(cell(widget, strike, 'intrinsic').textContent);

        assert.equal(worth('90'), 10, 'the 90 call is ten in the money');
        assert.equal(worth('110'), 10, 'and so is the 110 put');
        assert.equal(worth('100'), 0, 'at the money, neither');
    });

    it('reads as a ladder, lowest strike first', () => {
        const { root } = desk();

        assert.deepStrictEqual(rowKeys(root), ['90', '100', '110']);
    });

    it('marks which side of the money each strike is on', () => {
        const { root } = desk();
        const rows = root.querySelectorAll('tr').filter(r => r.dataset.rowKey !== undefined);

        assert.ok((rows[0].className ?? '').includes('option-itm-call'));
        assert.ok((rows[2].className ?? '').includes('option-itm-put'));
    });

    it('scales volume per side, because calls and puts trade in different sizes', () => {
        const rows = scaleChain(CHAIN, CONTEXT);

        assert.equal(rows[0].maxCallVolume, 100);
        assert.equal(rows[0].maxPutVolume, 50);
    });

    it('scales volatility across both sides, because the skew is the comparison between them', () => {
        const rows = scaleChain(CHAIN, CONTEXT);

        assert.equal(rows[0].maxVolatility, 0.35, 'the busiest volatility on either side');
    });

    it('draws a bar as a share of that scale, and none for a figure that is not there', () => {
        const { widget } = desk();

        const busiest = cell(widget, '100', 'callVolume').querySelector('.option-bar')!;
        const quieter = cell(widget, '90', 'callVolume').querySelector('.option-bar')!;

        assert.equal(busiest.style.width, '100.0%');
        assert.equal(quieter.style.width, '40.0%');
    });

    it('shows a volatility in the points a desk quotes, not as a fraction', () => {
        const { widget } = desk();

        assert.ok(cell(widget, '100', 'callIvLast').textContent.includes('20.00%'));
    });

    it('computes the greeks when the host sent volatility instead', () => {
        const g = sideGreeks(CHAIN[1], 'call', CONTEXT)!;

        assert.ok(g.delta > 0.5 && g.delta < 0.65, `an at-the-money call: ${g.delta}`);
        assert.ok(g.gamma > 0, 'and it has convexity');
    });

    it('shows the greeks the host sent, rather than computing over them', () => {
        const given = { delta: 0.42, gamma: 1, vega: 2, theta: -3, rho: 4 };
        const g = sideGreeks({ ...CHAIN[1], call: { ...CHAIN[1].call, greeks: given } }, 'call', CONTEXT);

        assert.deepStrictEqual(g, given);
    });

    it('shows no greek at all when nothing can price one', () => {
        assert.equal(sideGreeks(CHAIN[1], 'call', { assetPrice: 100 }), null, 'no time to expiry');
        assert.equal(sideGreeks({ ...CHAIN[1], call: { bid: 1 } }, 'call', CONTEXT), null, 'no volatility');
    });

    it('leaves a greek blank when it cannot be priced, and zero when it genuinely is', () => {
        // Nothing to price against: a blank, because no delta was measured.
        const unpriced = desk(CHAIN, { assetPrice: 100 });
        assert.equal(cell(unpriced.widget, '100', 'callGamma').textContent, '');

        // Expired: gamma really is zero, and saying so is not the same as saying nothing.
        const expired = desk(CHAIN, { assetPrice: 100, timeToExpiry: 0, riskFree: 0, dividend: 0 });
        assert.equal(Number(cell(expired.widget, '100', 'callGamma').textContent), 0);
    });

    it('shows a gamma rather than rounding it away, however small the numbers are', () => {
        // A chain on an underlying in the tens of thousands: gamma is about 3e-5, and a column
        // of four decimal places shows every strike as 0.0000.
        const big = CHAIN.map(r => ({
            strike: r.strike * 620,
            call: { ...r.call, ivLast: r.call.ivLast },
            put: { ...r.put, ivLast: r.put.ivLast },
        }));
        const { widget } = desk(big, { assetPrice: 62000, timeToExpiry: 0.12, riskFree: 0.05, dividend: 0 });

        const shown = big.map(r => cell(widget, String(r.strike), 'callGamma').textContent);

        for (const text of shown) assert.ok(Number(text) > 0, `gamma read as ${text}`);
        assert.equal(new Set(shown).size, shown.length, `every strike has its own gamma: ${shown.join(', ')}`);
    });

    it('says so when the chain is empty', () => {
        const { root } = desk([], CONTEXT);

        assert.deepStrictEqual(painted(root), [['NoOptions']]);
    });
});
