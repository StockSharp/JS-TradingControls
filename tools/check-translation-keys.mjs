// The translation keys this package asks its host for, as data.
//
// Every caption, tooltip, aria-label and empty-state string in the package
// arrives through `TradingHost.t(key)`. A host that does not answer a key gets
// the key rendered at the user: `t()` has no way to fail, and a key like
// `ClosePanel` or `NoActiveOrders` reads as a missing translation on screen
// rather than as an error anywhere. So an adopter needs the list, and had no
// way to get one short of grepping the sources.
//
// Hence: generated FROM the sources, checked in, and re-checked by `npm test`.
// Hand-typing it would put a second list next to the real one, and the point of
// shipping it is that it is not a second list.
//
//   npm run i18n:update   rewrite translation-keys.json from src/
//   npm run i18n:check    fail if it no longer matches src/
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const listPath = join(root, 'translation-keys.json');
const update = process.argv.includes('--update');

const keys = await translationKeys();
const generated = JSON.stringify({
    // Stated in the file itself, so a copy of it that has drifted away from
    // this repository still says what it is and how it was made.
    $comment: 'Generated from src/ by tools/check-translation-keys.mjs -- do not edit by hand. '
        + 'Every string here is passed to TradingHost.t(); a host that answers none of them renders these '
        + 'literally to the user. See README.md ("Text arrives through t()").',
    count: keys.length,
    keys,
}, null, 4) + '\n';

if (update) {
    await writeFile(listPath, generated, 'utf8');
    console.log(`updated ${listPath} (${keys.length} keys)`);
} else {
    let expected;
    try {
        expected = (await readFile(listPath, 'utf8')).replaceAll('\r\n', '\n');
    } catch {
        console.error('translation-keys.json is missing. Run npm run i18n:update.');
        process.exitCode = 1;
    }
    if (expected !== undefined) {
        if (expected === generated) {
            console.log(`translation keys match (${keys.length} keys the host must answer)`);
        } else {
            console.error(
                'translation-keys.json no longer matches the sources. '
                + 'Run npm run i18n:update, and tell the hosts about the keys that changed.',
            );
            process.exitCode = 1;
        }
    }
}

/// Every key handed to the host's translator, from the three forms the sources
/// use: `host.t('X')` while a panel builds its own markup, `this._host.t('X')`
/// from an instance, and `label('X')` inside a column declaration -- where
/// `label` is the local alias each blotter binds to `this._host.t` so a row
/// lambda's own `t` (a trade) cannot shadow the translator.
///
/// Only literals are collected, which is the reason the sources never build a
/// key by concatenation: a computed key would be invisible here and would reach
/// a user as itself.
async function translationKeys() {
    const found = new Set();
    for (const file of (await readdir(join(root, 'src'))).sort()) {
        if (!file.endsWith('.ts')) continue;
        const source = await readFile(join(root, 'src', file), 'utf8');
        for (const m of source.matchAll(/(?:\bhost\.t|\bthis\._host\.t|\blabel)\(\s*'((?:[^'\\]|\\.)*)'/g))
            found.add(m[1]);
    }
    return [...found].sort((left, right) => left.localeCompare(right, 'en'));
}
