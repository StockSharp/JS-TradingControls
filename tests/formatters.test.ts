import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { formatQty, formatTime } from '../src/formatters.js';

// The tape formats a time and a quantity for every row of every paint. Asking
// the locale for a formatter on each call made those two the costliest lines of
// a busy page — so they read through one formatter each, and print exactly what
// they always printed.

const CLOCK: Intl.DateTimeFormatOptions = { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' };

describe('formatTime', () => {
    it('reads the clock as it always did, whatever the time arrives as', () => {
        const values: (string | number | Date)[] = [
            '2026-04-30T12:00:03Z',
            '2026-04-30T00:00:00Z',
            '2026-04-30T23:59:59.999Z',
            Date.UTC(2026, 3, 30, 9, 5, 7),
            new Date(Date.UTC(2026, 0, 1, 12, 0, 0)),
        ];
        for (const value of values)
            assert.equal(formatTime(value), new Date(value as string).toLocaleTimeString('en-US', CLOCK), String(value));
    });

    it('says a time it cannot read is no date, as it did', () => {
        assert.equal(formatTime('not a time'), new Date('not a time').toLocaleTimeString('en-US', CLOCK));
        assert.equal(formatTime(null), new Date(null as unknown as string).toLocaleTimeString('en-US', CLOCK));
    });
});

describe('formatQty', () => {
    it('writes a quantity as it always did', () => {
        for (const value of [0, 1, 0.25, 2.5, -3.5, 1e-8, 0.123456789, 1234567.12345678, '2.5'])
            assert.equal(formatQty(value), Number(value).toLocaleString(undefined, { maximumFractionDigits: 8 }), String(value));
    });

    it('writes no number as a dash', () => {
        for (const value of [null, undefined, NaN, Infinity, 'abc'])
            assert.equal(formatQty(value as never), '--', String(value));
    });
});

describe('the formatters on a busy page', () => {
    it('build no locale formatter per call', () => {
        const timeText = Date.prototype.toLocaleTimeString;
        const numberText = Number.prototype.toLocaleString;
        let asked = 0;
        Date.prototype.toLocaleTimeString = function (this: Date, ...args: unknown[]) { asked++; return timeText.apply(this, args as never); };
        Number.prototype.toLocaleString = function (this: number, ...args: unknown[]) { asked++; return numberText.apply(this, args as never); };

        try {
            for (let i = 0; i < 100; i++) {
                formatTime(Date.UTC(2026, 3, 30, 12, 0, i % 60));
                formatQty(i / 7);
            }
        } finally {
            Date.prototype.toLocaleTimeString = timeText;
            Number.prototype.toLocaleString = numberText;
        }

        assert.equal(asked, 0, 'a locale formatter was built for a call');
    });
});
