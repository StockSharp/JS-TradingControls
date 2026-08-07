import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { asDom, el, installFakeDom } from './fake-dom.js';
import { HOST_MEMBERS, HOST_NESTED_MEMBERS, fakeHost, withoutMember } from './fake-host.js';
import { PRESENTATION_CLASSES } from '../src/trading-host.js';
import { PositionsWidget } from '../src/positions-widget.js';

installFakeDom();

/// Any control would do — the assertion runs before a control does anything of
/// its own, which is the whole point of it.
function createWithHost(host: unknown) {
    return () => PositionsWidget.create(asDom(el('div')), {}, {
        host, closePosition: () => { }, reversePosition: () => { }, refreshPositions: () => { },
    } as never);
}

describe('the host port', () => {
    it('refuses to construct a control with no host at all', () => {
        assert.throws(
            () => PositionsWidget.create(asDom(el('div')), {}, {} as never),
            /PositionsWidget: host is required/);
    });

    it('names the member a host left out, instead of failing at the click that needed it', () => {
        for (const member of HOST_MEMBERS) {
            const host = fakeHost() as unknown as Record<string, unknown>;
            delete host[member];
            assert.throws(createWithHost(host), new RegExp(`host\\.${member} is required`),
                `a host missing "${member}" has to be rejected by name`);
        }
    });

    it('names a nested member too — a store with no set is not a store', () => {
        const host = fakeHost() as unknown as Record<string, unknown>;
        host.cache = { get: () => null };
        assert.throws(createWithHost(host), /host\.cache\.set is required/);
    });

    it('reaches the calls, not just the objects holding them', () => {
        // The failure this guards against: `trading: { api: {}, marketData: {} }`
        // satisfies a check that stops at the object, and then the first
        // getExecutions is a TypeError inside a promise nobody is awaiting.
        for (const path of HOST_NESTED_MEMBERS) {
            const host = withoutMember(fakeHost(), path);
            assert.throws(createWithHost(host), new RegExp(`host\\.${path.replaceAll('.', '\\.')} is required`),
                `a host missing "${path}" has to be rejected by name`);
        }
    });

    it('states the class names a presentation may answer with', () => {
        // Named here rather than left to be discovered: nothing in src/ emits
        // them, so the stylesheet is the only other place they appear and a
        // host has no way to guess them from the sources.
        assert.deepStrictEqual(PRESENTATION_CLASSES.sideClass, ['side-buy', 'side-sell']);
        assert.deepStrictEqual(PRESENTATION_CLASSES.pnlClass, ['pnl-positive', 'pnl-negative']);
    });

    it('rejects a store that is present but null — null is what an unwired dependency looks like', () => {
        const host = fakeHost() as unknown as Record<string, unknown>;
        host.preferences = null;
        assert.throws(createWithHost(host), /host\.preferences is required/);
    });

    it('fails before it renders, so a mis-wired host never puts a half-built panel on the page', () => {
        const parent = el('div');
        const host = fakeHost() as unknown as Record<string, unknown>;
        delete host.t;
        assert.throws(() => PositionsWidget.create(asDom(parent), {}, {
            host, closePosition: () => { }, reversePosition: () => { }, refreshPositions: () => { },
        } as never));
        assert.equal(parent.childNodes.length, 0, 'nothing may reach the page before the host is proven');
    });
});
