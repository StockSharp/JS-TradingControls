// The stylesheet contract, checked rather than described.
//
// The package renders no colour and no measurement from TypeScript: a control
// emits class names and `styles/trading-controls.css` gives them meaning. Two
// things can silently break that arrangement, and neither shows up in a unit
// test because neither side throws:
//
//   1. A control starts emitting a class the stylesheet never styles. The
//      control still works; it is just invisible, or unstyled, on every host.
//   2. A rule starts reading a `--t-*` property the default theme does not
//      declare. It resolves to nothing (or to a literal fallback nobody
//      documented), so the knob the rule advertises does not exist. Four such
//      properties existed in the stylesheet this package was extracted from,
//      which is why this check is here and not a comment.
//
// Both directions are checked. A class name that is only ever produced by
// string concatenation would be missed, so the controls spell their class lists
// as literals — which is also what makes them greppable.
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const stylesheetPath = join(root, 'styles', 'trading-controls.css');
const themePath = join(root, 'styles', 'theme.css');
const portPath = join(root, 'src', 'trading-host.ts');

// Emitted by @stocksharp/grids, not by this package, but a host still has to
// style them — so the stylesheet carries them and this check knows why.
const _fromGrid = ['grid-empty', 'visually-hidden', 'sort-asc', 'sort-desc'];

// Class names a control writes onto an element that the host's own chrome is
// expected to style (or that carry no looks of their own). Listing them is the
// decision to leave them unstyled here, so a new one has to be argued rather
// than defaulted.
const _hostStyled = new Set([
    // Structural hooks the controls query themselves; they carry no looks.
    'positions-body', 'trade-history-body', 'active-orders-body',
    'watchlist-headers', 'watchlist-search', 'watchlist-pane', 'panel-close-btn',
    'panel-refresh-btn', 'panel-export-btn', 'panel-cancel-all-btn', 'panel-add-btn',
    // The ladder's close button. Its looks come from the `bt-icon-btn
    // bt-icon-cancel` pair beside it; this name is only how the control finds
    // the button it built.
    'ob-close-btn',
    // Table identity classes; the skin is on `.terminal-table` / `.watchlist-table`.
    'positions-table', 'trade-history-table', 'active-orders-table',
    'positions-panel', 'trade-history-panel', 'active-orders-panel',
    // Bootstrap's, and Bootstrap Icons'.
    'form-control', 'form-control-sm', 'bi',
    // The grid's own row marker, styled through `.watchlist-table tbody tr`.
    'wl-row',
    // Order entry: the panel modifier, plus one class per field of the form.
    // The field classes are how the pad reaches its own inputs (`.oe-field-qty
    // input`) and which of them the current order type shows; the looks are on
    // `.oe-field` and `.oe-field-hidden`, so these carry none of their own.
    'order-entry-panel',
    'oe-field-price', 'oe-field-stop', 'oe-field-qty', 'oe-field-tp', 'oe-field-sl',
]);

const stylesheet = await readFile(stylesheetPath, 'utf8');
const theme = await readFile(themePath, 'utf8');
const port = await readFile(portPath, 'utf8');
const failures = [];

// --- 1. every class a control emits is styled, or deliberately not ----------

const styled = new Set([...stylesheet.matchAll(/\.([A-Za-z][\w-]*)/g)].map((m) => m[1]));
for (const name of _fromGrid) {
    if (!styled.has(name))
        failures.push(`styles/trading-controls.css does not style ".${name}", which @stocksharp/grids emits.`);
}

for (const [file, emitted] of await emittedClasses()) {
    for (const name of emitted) {
        if (styled.has(name) || _hostStyled.has(name)) continue;
        failures.push(
            `src/${file} emits class "${name}" that styles/trading-controls.css never styles. ` +
            'Add a rule, or add it to _hostStyled in this tool with the reason.',
        );
    }
}

// --- 1b. every class the HOST's presentation returns is styled --------------

// The one set of names that reaches a cell without passing through src/ at all:
// `TradingPresentation.sideClass` / `pnlClass` are the host's answer, and a
// control forwards the string without inspecting it. The check above cannot see
// them for exactly that reason, so they are read off the port's own
// PRESENTATION_CLASSES rather than repeated here.
for (const name of presentationClasses()) {
    if (!styled.has(name))
        failures.push(
            `styles/trading-controls.css does not style ".${name}", which the port's PRESENTATION_CLASSES promises.`,
        );
}

// --- 2. every custom property a rule reads is declared by the theme ---------

const declared = new Set([...theme.matchAll(/^\s*(--[\w-]+):/gm)].map((m) => m[1]));
const read = new Set([...stylesheet.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]));
for (const property of [...read].sort()) {
    if (!declared.has(property))
        failures.push(`styles/trading-controls.css reads ${property}, which styles/theme.css does not declare.`);
}

// A `var(--t-x, #abc)` fallback is a colour literal hidden in a stylesheet whose
// header says it holds none: the rule keeps working against a host that never
// declared the token, so the missing declaration is never noticed and the
// control silently paints a shade from someone else's palette. The whole point
// of the two checks around this one is that a token is either declared or the
// build fails, and a fallback is how a property quietly opts out of that.
for (const m of stylesheet.matchAll(/var\(\s*(--[\w-]+)\s*,([^)]*)\)/g))
    failures.push(
        `styles/trading-controls.css reads ${m[1]} with a fallback of "${m[2].trim()}". ` +
        'Declare the property in styles/theme.css (and in the host) instead.',
    );

// A token nobody reads is a promise the README makes and the package does not
// keep, so the check runs both ways.
for (const property of [...declared].sort()) {
    if (!read.has(property))
        failures.push(`styles/theme.css declares ${property}, which no rule reads. Remove it or use it.`);
}

if (failures.length > 0) {
    for (const failure of failures) console.error(failure);
    process.exitCode = 1;
} else {
    console.log(`style contract holds (${styled.size} classes styled, ${declared.size} theme properties, all read)`);
}

/// The class names the port's `PRESENTATION_CLASSES` promises a host may
/// return, read out of the declaration itself so the two cannot drift.
function presentationClasses() {
    const block = /export const PRESENTATION_CLASSES = \{([\s\S]*?)\n\} as const;/.exec(port);
    if (!block) {
        failures.push('src/trading-host.ts no longer declares PRESENTATION_CLASSES; this check cannot read it.');
        return [];
    }
    return [...block[1].matchAll(/'([a-z][\w-]*)'/g)].map((m) => m[1]);
}

/// Class names each control writes, read out of the two forms the sources use:
/// a `className`-shaped string literal, and the class argument of a `makeElement`
/// / `makeIconButton` / `makePanelRoot` call. Both are plain literals in this
/// package precisely so this can be checked.
async function emittedClasses() {
    const result = [];
    for (const file of (await readdir(join(root, 'src'))).sort()) {
        if (!file.endsWith('.ts')) continue;
        const source = await readFile(join(root, 'src', file), 'utf8');
        const names = new Set();

        // makeElement(tag, className, …) — the class is the SECOND argument.
        for (const m of source.matchAll(/makeElement\(\s*'[^']*'\s*,\s*'([^']*)'/g))
            add(names, m[1]);

        // makeIconButton(className, …) / makePanelRoot(modifierClass, …) — first.
        for (const m of source.matchAll(/make(?:IconButton|PanelRoot)\(\s*'([^']*)'/g))
            add(names, m[1]);

        // element.className = 'wl-fav active';  el.className = `bt-icon-btn ${x}`;
        for (const m of source.matchAll(/\.className\s*=\s*[`']([^`']*)[`']/g))
            add(names, m[1]);

        // cellClass / rowClass / render returning a bare class list
        for (const m of source.matchAll(/=>\s*'([a-z][\w-]*(?:\s+[a-z][\w-]*)*)'/g))
            add(names, m[1]);

        if (names.size > 0) result.push([file, [...names].sort()]);
    }
    return result;
}

function add(names, value) {
    for (const name of value.split(/\s+/)) {
        // Skip anything that is not a plain class token: template holes, empty
        // strings, and the sort/filter words that the arrow-function pattern
        // above also matches (they are values, not classes).
        if (!/^[a-z][\w-]*$/.test(name)) continue;
        // Bootstrap Icons glyph names. The package states which glyph a button
        // wears but does not draw it — the icon font is the host's, exactly as
        // the palette is.
        if (name.startsWith('bi-')) continue;
        names.add(name);
    }
}
