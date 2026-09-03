// Option pricing and the greeks, as pure functions.
//
// The desktop desk gets these from StockSharp.Algo.Derivatives, which a browser cannot call. A
// host could compute them and send them down, and one that already does should - the desk takes
// them either way. But a host that has bid, ask and an expiry has everything the arithmetic
// needs, and making it stand up a pricing service before it can draw a chain is a poor trade.
//
// So the maths ships, and it ships here, apart from the control: a wrong greek is not visible
// on screen the way a wrong column is, and the only defence is checking the numbers against
// values that are known.
//
// Conventions follow the desk that reads them, not the textbook: vega is per one point of
// volatility, theta is per calendar day, and rho is per one point of rate - the units a trader
// works in, rather than per 1.0 of each, which nobody quotes.

export const OptionTypes = {
    Call: 'call',
    Put: 'put',
} as const;

export type OptionType = typeof OptionTypes[keyof typeof OptionTypes];

/// Everything a price depends on. Time is in years, rates and volatility are fractions - 0.05
/// is five percent, not five.
export interface OptionInputs {
    assetPrice: number;
    strike: number;
    /// Years remaining. Zero once expired, which makes every greek zero and the premium
    /// intrinsic.
    timeToExpiry: number;
    riskFree: number;
    dividend: number;
    /// Volatility, as a fraction.
    deviation: number;
}

export interface Greeks {
    delta: number;
    gamma: number;
    /// Per one point of volatility.
    vega: number;
    /// Per calendar day.
    theta: number;
    /// Per one point of rate.
    rho: number;
}

const SQRT_2PI = Math.sqrt(2 * Math.PI);
const DAYS_IN_YEAR = 365;

/// The standard normal CDF.
///
/// Hart's rational approximation, which is what pricing libraries use and what a desk's numbers
/// are expected to agree with: accurate to about 1e-15 across the range, and exactly a half at
/// the mean rather than nearly so. The cheaper Abramowitz-and-Stegun fit is good to 1e-7, which
/// sounds like enough until a greek that should be symmetric is not.
export function normalCdf(x: number): number {
    const z = Math.abs(x);

    // Beyond this the tail is smaller than double precision can carry anyway.
    if (z > 37) return x > 0 ? 1 : 0;

    const e = Math.exp(-(z * z) / 2);
    let tail: number;

    if (z < 7.07106781186547) {
        let b = 3.52624965998911e-02 * z + 0.700383064443688;
        b = b * z + 6.37396220353165;
        b = b * z + 33.912866078383;
        b = b * z + 112.079291497871;
        b = b * z + 221.213596169931;
        b = b * z + 220.206867912376;

        let d = 8.83883476483184e-02 * z + 1.75566716318264;
        d = d * z + 16.064177579207;
        d = d * z + 86.7807322029461;
        d = d * z + 296.564248779674;
        d = d * z + 637.333633378831;
        d = d * z + 793.826512519948;
        d = d * z + 440.413735824752;

        tail = (e * b) / d;
    } else {
        // A continued fraction, which is what stays accurate once the polynomial ratio above
        // starts losing digits to cancellation.
        let b = z + 0.65;
        b = z + 4 / b;
        b = z + 3 / b;
        b = z + 2 / b;
        b = z + 1 / b;
        tail = e / (b * 2.506628274631);
    }

    return x > 0 ? 1 - tail : tail;
}

/// The standard normal density.
export function normalPdf(x: number): number {
    return Math.exp(-0.5 * x * x) / SQRT_2PI;
}

/// d1, or zero when there is no time or no volatility for the division to mean anything.
export function d1(inputs: OptionInputs): number {
    const { assetPrice, strike, timeToExpiry, riskFree, dividend, deviation } = inputs;
    const spread = deviation * Math.sqrt(timeToExpiry);

    if (spread === 0 || assetPrice <= 0 || strike <= 0) return 0;

    return (Math.log(assetPrice / strike) + (riskFree - dividend + (deviation * deviation) / 2) * timeToExpiry) / spread;
}

/// d2, which is d1 less one standard deviation of the remaining time.
export function d2(inputs: OptionInputs): number {
    const spread = inputs.deviation * Math.sqrt(inputs.timeToExpiry);
    return spread === 0 ? 0 : d1(inputs) - spread;
}

/// What the option is worth.
///
/// At expiry, or with no volatility, that is its intrinsic value - the formula degenerates to
/// exactly that, and saying so explicitly keeps a zero denominator out of the general case.
export function premium(type: OptionType, inputs: OptionInputs): number {
    const { assetPrice, strike, timeToExpiry, riskFree, dividend, deviation } = inputs;

    if (timeToExpiry <= 0 || deviation <= 0)
        return Math.max(0, type === OptionTypes.Call ? assetPrice - strike : strike - assetPrice);

    const a = d1(inputs);
    const b = d2(inputs);
    const carried = assetPrice * Math.exp(-dividend * timeToExpiry);
    const discounted = strike * Math.exp(-riskFree * timeToExpiry);

    return type === OptionTypes.Call
        ? carried * normalCdf(a) - discounted * normalCdf(b)
        : discounted * normalCdf(-b) - carried * normalCdf(-a);
}

/// Every greek at once: they share d1, and computing them together is both cheaper and the only
/// way they are guaranteed to describe the same moment.
export function greeks(type: OptionType, inputs: OptionInputs): Greeks {
    const { assetPrice, strike, timeToExpiry, riskFree, dividend, deviation } = inputs;
    const sign = type === OptionTypes.Call ? 1 : -1;

    if (timeToExpiry <= 0 || deviation <= 0 || assetPrice <= 0) {
        // An expired option still has a delta - it is one or nothing, depending on which side of
        // the strike it finished. Everything else has stopped moving.
        const inTheMoney = type === OptionTypes.Call ? assetPrice > strike : assetPrice < strike;
        return { delta: inTheMoney ? sign : 0, gamma: 0, vega: 0, theta: 0, rho: 0 };
    }

    const a = d1(inputs);
    const b = d2(inputs);
    const sqrtT = Math.sqrt(timeToExpiry);
    const density = normalPdf(a);
    const carry = Math.exp(-dividend * timeToExpiry);
    const discount = Math.exp(-riskFree * timeToExpiry);

    const delta = sign * carry * normalCdf(sign * a);
    const gamma = (carry * density) / (assetPrice * deviation * sqrtT);

    // Scaled the way a desk quotes them: vega per one volatility point, rho per one rate point,
    // theta per calendar day.
    const vega = assetPrice * carry * density * sqrtT * 0.01;
    const rho = sign * strike * timeToExpiry * discount * normalCdf(sign * b) * 0.01;

    const theta = (
        -(assetPrice * carry * density * deviation) / (2 * sqrtT)
        - sign * riskFree * strike * discount * normalCdf(sign * b)
        + sign * dividend * assetPrice * carry * normalCdf(sign * a)
    ) / DAYS_IN_YEAR;

    return { delta, gamma, vega, theta, rho };
}

/// The volatility that would produce this price, or null when none would.
///
/// Bisection rather than Newton: vega collapses far from the money and deep in time, and a
/// Newton step divided by a vanishing vega walks off to nonsense. Halving cannot, and forty
/// steps over a range this wide is finer than any quote.
export function impliedVolatility(type: OptionType, inputs: OptionInputs, price: number): number | null {
    if (!(price > 0) || inputs.timeToExpiry <= 0) return null;

    const at = (deviation: number): number => premium(type, { ...inputs, deviation });

    let low = 1e-6;
    let high = 5;

    // A price outside what any volatility in that range can produce has no answer, and
    // returning the nearest bound would be a number that means nothing.
    if (price < at(low) || price > at(high)) return null;

    for (let step = 0; step < 60; step++) {
        const mid = (low + high) / 2;
        if (at(mid) < price) low = mid;
        else high = mid;
    }

    return (low + high) / 2;
}
