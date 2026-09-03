import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { OptionTypes, d1, d2, greeks, impliedVolatility, normalCdf, premium } from '../src/black-scholes.js';

/// The textbook case, and the one every implementation is checked against: a share at 100, a
/// strike at 100, a year to run, 5% risk-free, 20% volatility, no dividend. Its call is worth
/// 10.4506 and its put 5.5735 — figures a wrong sign or a dropped discount factor cannot hit by
/// accident.
const BASE = { assetPrice: 100, strike: 100, timeToExpiry: 1, riskFree: 0.05, dividend: 0, deviation: 0.2 };

const close = (actual: number, expected: number, tolerance: number, what: string): void =>
    assert.ok(Math.abs(actual - expected) < tolerance, `${what}: ${actual} is not within ${tolerance} of ${expected}`);

describe('normalCdf', () => {
    it('is a half at the mean and approaches the ends', () => {
        close(normalCdf(0), 0.5, 1e-12, 'centre');
        close(normalCdf(-1.96), 0.025, 1e-4, 'lower tail');
        close(normalCdf(1.96), 0.975, 1e-4, 'upper tail');
        close(normalCdf(-8), 0, 1e-9, 'far below');
        close(normalCdf(8), 1, 1e-9, 'far above');
    });

    it('is symmetric about the mean, which is what every greek relies on', () => {
        for (const x of [0.1, 0.5, 1, 2.5]) close(normalCdf(x) + normalCdf(-x), 1, 1e-12, `symmetry at ${x}`);
    });
});

describe('d1 and d2', () => {
    it('are the textbook values for the textbook case', () => {
        close(d1(BASE), 0.35, 1e-9, 'd1');
        close(d2(BASE), 0.15, 1e-9, 'd2');
    });

    it('are zero when there is no time or no volatility left to divide by', () => {
        assert.equal(d1({ ...BASE, timeToExpiry: 0 }), 0);
        assert.equal(d1({ ...BASE, deviation: 0 }), 0);
    });
});

describe('premium', () => {
    it('prices the textbook call and put', () => {
        close(premium(OptionTypes.Call, BASE), 10.4506, 1e-3, 'call');
        close(premium(OptionTypes.Put, BASE), 5.5735, 1e-3, 'put');
    });

    it('honours put-call parity, which no separate pair of formulas gets right by luck', () => {
        const call = premium(OptionTypes.Call, BASE);
        const put = premium(OptionTypes.Put, BASE);
        const parity = BASE.assetPrice - BASE.strike * Math.exp(-BASE.riskFree * BASE.timeToExpiry);

        close(call - put, parity, 1e-9, 'C - P = S - Ke^-rT');
    });

    it('is worth its intrinsic value at expiry, and nothing more', () => {
        const expired = { ...BASE, timeToExpiry: 0, assetPrice: 120 };

        close(premium(OptionTypes.Call, expired), 20, 1e-9, 'call in the money');
        close(premium(OptionTypes.Put, expired), 0, 1e-9, 'put out of it');
    });
});

describe('greeks', () => {
    it('are the textbook values for the textbook call', () => {
        const g = greeks(OptionTypes.Call, BASE);

        close(g.delta, 0.6368, 1e-3, 'delta');
        close(g.gamma, 0.018762, 1e-5, 'gamma');
        // Per one point of volatility and per one calendar day, which is how a desk reads them.
        close(g.vega, 0.3752, 1e-3, 'vega per volatility point');
        close(g.theta, -0.01757, 1e-4, 'theta per day');
        close(g.rho, 0.5323, 1e-3, 'rho per rate point');
    });

    it('gives a put the delta of its call, less one', () => {
        const call = greeks(OptionTypes.Call, BASE);
        const put = greeks(OptionTypes.Put, BASE);

        close(put.delta, call.delta - 1, 1e-9, 'put delta');
        close(put.gamma, call.gamma, 1e-9, 'gamma is the same for both');
        close(put.vega, call.vega, 1e-9, 'so is vega');
    });

    it('has a call delta between zero and one, always', () => {
        for (const assetPrice of [1, 50, 100, 150, 1000]) {
            const delta = greeks(OptionTypes.Call, { ...BASE, assetPrice }).delta;
            assert.ok(delta >= 0 && delta <= 1, `delta at ${assetPrice} was ${delta}`);
        }
    });

    it('is nothing at all once the option has expired', () => {
        const g = greeks(OptionTypes.Call, { ...BASE, timeToExpiry: 0 });

        assert.deepStrictEqual([g.gamma, g.vega, g.theta], [0, 0, 0]);
    });
});

describe('impliedVolatility', () => {
    it('recovers the volatility a price was made with', () => {
        for (const sigma of [0.05, 0.2, 0.65, 1.5]) {
            const price = premium(OptionTypes.Call, { ...BASE, deviation: sigma });
            const solved = impliedVolatility(OptionTypes.Call, { ...BASE, deviation: 0 }, price);

            close(solved!, sigma, 1e-4, `solved from a ${sigma} price`);
        }
    });

    it('solves a put as readily as a call', () => {
        const price = premium(OptionTypes.Put, { ...BASE, deviation: 0.42 });

        close(impliedVolatility(OptionTypes.Put, { ...BASE, deviation: 0 }, price)!, 0.42, 1e-4, 'put');
    });

    it('answers nothing rather than a number when no volatility explains the price', () => {
        // Below intrinsic value: no positive volatility produces it.
        assert.equal(impliedVolatility(OptionTypes.Call, { ...BASE, assetPrice: 200 }, 1), null);
        assert.equal(impliedVolatility(OptionTypes.Call, BASE, 0), null);
        assert.equal(impliedVolatility(OptionTypes.Call, { ...BASE, timeToExpiry: 0 }, 5), null);
    });
});
