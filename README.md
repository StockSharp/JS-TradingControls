# StockSharp JS Trading Controls

[![Build and test](https://github.com/StockSharp/TradingControls/actions/workflows/ci.yml/badge.svg)](https://github.com/StockSharp/TradingControls/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/%40stocksharp%2Ftrading-controls.svg)](https://www.npmjs.com/package/@stocksharp/trading-controls)
[![License](https://img.shields.io/badge/license-StockSharp%20EULA-c8202f.svg)](LICENSE)

**StockSharp JS Trading Controls** are the browser panels a trading screen is
made of: an **active orders** blotter with inline edit, a **positions** blotter
with a pinned cash balance, a **trade history** blotter, and a **watchlist**
with live quotes, favourites and category tabs.

Each control builds its own DOM, renders its own table through
[`@stocksharp/grid`](https://www.npmjs.com/package/@stocksharp/grid), and reaches
the outside world through exactly one object — a `TradingHost`.

[StockSharp website](https://stocksharp.com/) ·
[GitHub repository](https://github.com/StockSharp/TradingControls) ·
[Issue tracker](https://github.com/StockSharp/TradingControls/issues)

## Quick start

```sh
npm install @stocksharp/trading-controls
```

```ts
import { PositionsWidget } from '@stocksharp/trading-controls';
import '@stocksharp/trading-controls/styles.css';
// Optional: a working dark/light palette, if your page has none of its own.
import '@stocksharp/trading-controls/theme.css';

const panel = PositionsWidget.create(document.querySelector('#positions')!, {}, {
  host,                                        // see "The host port" below
  closePosition: (pf, instrument, symbol) => api.close(pf, instrument),
  reversePosition: (pf, instrument, symbol) => api.reverse(pf, instrument),
  refreshPositions: () => reload(),
});

panel.update(positions);
panel.updateBalance({ available: 1000, locked: 250, total: 1250 });
```

The package also ships a ready-to-use browser bundle exposed as
`window.SSTradingControls`:

```html
<script src="https://cdn.jsdelivr.net/npm/@stocksharp/trading-controls@0.1.0/dist/sstradingcontrols.js"></script>
<script>
  const { PositionsWidget } = window.SSTradingControls;
</script>
```

## The host port is the whole API surface

A control imports no translator, no settings singleton, no panel registry and no
docking manager, and it never reads a `window` global. Everything it needs
arrives as one `TradingHost`:

| member | what the host answers |
|---|---|
| `isPrimary` | is this the instance that speaks for the page? |
| `t(key, …args)` | translate; see [Text](#everything-a-control-shows-is-the-hosts) for what a key looks like |
| `presentation` | word and colour a side, an order type, a status, a P&L sign |
| `preferences` / `cache` | two stores — settings that must survive, and scratch |
| `trading` | the API, the market-data client, the active portfolio, an instrument picker |
| `ticker` | where a control reports the symbols it is showing |
| `allow(action)` | may the user do this? |
| `log(message)` | where diagnostics go |
| `close()` `spawn(state)` `persistState(patch)` `saveLayout()` | lifecycle calls back |
| `register` `unregister` `broadcast<T>` | the host's handle on live instances |

**Every member is required, and `assertHost` proves it before the control
renders anything.** A half-supplied host is how a control half-works: it draws,
it looks alive, and the one capability nobody wired is discovered by a user
clicking something that does nothing. So a missing member throws at construction
naming the path — `WatchlistWidget: host.trading.api.getExecutions is required` —
nested members included.

**Seven of them no shipped control calls**: `spawn`, `persistState`,
`saveLayout`, `log`, `trading.pickInstrument`, `marketData.resubscribe` and
`marketData.getOrders`. They are required anyway, and not on speculation — the
terminal this was extracted from has seven controls, and the three still on its
side of the boundary (order book, order entry, trade feed) are already written
against this same interface and call every one of those members. Narrowing the
port now and widening it again as each moves in would break every host twice.
If you are adopting only the four controls here, stubs are a correct answer: a
no-op `spawn`, a `log` that forwards to the console.

Two pairs are deliberately separate rather than merged:

- **`preferences` and `cache` are two stores.** The watchlist's per-symbol,
  per-day price baseline is scratch. Routing it through a server-synced settings
  blob is how a settings row becomes a cache.
- **`persistState` and `saveLayout` are two calls.** One records into the panel's
  bag, the other flushes. Hiding a disk write inside "remember this" is exactly
  the invisible coupling the port exists to remove.

## Everything a control shows is the host's

- **Text** arrives through `t()`. There is no dictionary here and no string the
  package decides the wording of — see below for the keys you have to answer.
- **Colour** is class names the control emits; `styles/trading-controls.css`
  gives them meaning and reads its values from `--t-*` custom properties. Four
  names go the other way: `presentation.sideClass` and `pnlClass` are the
  *host's* answer, and a control forwards the string to the cell without
  looking at it. The shipped stylesheet paints `side-buy` / `side-sell` and
  `pnl-positive` / `pnl-negative`; answer with those, or answer with your own
  names and style those yourself. The port exports the list as
  `PRESENTATION_CLASSES`, and `npm test` asserts the stylesheet styles all four.
- **Data** is handed in. A control never fetches on its own — except the two
  reads the port names (`getExecutions`, `searchInstruments`), which the host
  implements.

### The 52 keys a host has to answer

`t()` cannot fail. A key the host does not know is rendered to the user as
itself, so `NoActiveOrders` appears in the empty blotter and `ClosePanel`
becomes a tooltip — a missing translation looks like a typo, never like an
error. The complete list ships with the package:

```ts
import keys from '@stocksharp/trading-controls/translation-keys.json';
// { count: 52, keys: ['Actions', 'ActiveOrders', …] }
```

It is **generated from the sources** (`npm run i18n:update`) and re-checked by
`npm test`, so it cannot drift from what the controls actually ask for.

The keys are not derivable, which is why the list is shipped rather than
described. Most are resource identifiers (`ClosePanel`, `ExportToExcel`,
`NoActiveOrders`, `Change24hPct`); some are English phrases, because that is the
form the terminal's dictionary already held them in (`Close position on {0}`,
`No trade history`, `Locked: ${0}`). `{0}`, `{1}` … are replaced positionally
from the `args` of the same `t()` call, so a translation may reorder them.

Controls render elements, never HTML strings, so nothing here can be an
injection site. A cell that holds a button holds a real element with its own
listener rather than an `onclick` attribute reaching a global.

## The stylesheet contract

The package **ships its stylesheet** — `@stocksharp/trading-controls/styles.css`.
Documenting the class names instead would have left an adopting page to
re-author about six hundred lines of CSS before it could see a table, which is
not "renders outside its original host" in any useful sense.

It is split in two so a host does not have to take a palette it disagrees with:

| file | what it is | when to import |
|---|---|---|
| `@stocksharp/trading-controls/styles.css` | every rule, reading `var(--t-*)` and declaring none | always |
| `@stocksharp/trading-controls/theme.css` | a working dark + light palette (`:root`, and `:root[data-bs-theme="light"]`) | only if your page has no `--t-*` tokens of its own |

**The 22 properties a host must supply** if it skips `theme.css`:

| group | properties |
|---|---|
| surfaces | `--t-bg` `--t-panel` `--t-header` `--t-hover` `--t-border` |
| text | `--t-text` `--t-text-dim` `--t-text-bright` |
| accent | `--t-accent` `--t-accent-hover` `--t-accent-text` `--t-accent-glow-soft` |
| direction | `--t-green` `--t-red` `--t-green-flash` `--t-red-flash` |
| warning | `--t-orange` (destructive but not a cancel) `--t-warning` (read this) |
| type and shape | `--t-font` `--t-mono` `--t-radius` `--t-transition` |

All 22 are required — none of them has a fallback baked into the rule that
reads it. A `var(--t-orange, #f0b90b)` would keep the rule working on a host
that never declared the token, which means the host never finds out, and the
control quietly paints a shade from a palette nobody chose. `--t-orange` and
`--t-warning` were the two that did, and no longer do.

`npm test` runs `tools/check-style-contract.mjs`, which fails if a control emits
a class the stylesheet never styles, if the stylesheet misses one of the
`PRESENTATION_CLASSES` the host may return, if a rule reads a property
`theme.css` does not declare, if `theme.css` declares one no rule reads, or if
any rule reads a property with a fallback. The contract above is therefore
checked, not just written down.

Two things the page still owns:

- **Bootstrap Icons.** A control says which glyph a button wears (`bi bi-x`,
  `bi bi-arrow-clockwise`) but does not draw it, exactly as it names a colour
  token without defining it.
- **`grid-empty`, `visually-hidden`, `sort-asc` / `sort-desc`** come out of
  `@stocksharp/grid`. This stylesheet carries them so an adopting page does not
  have to know that; the second is spelled the way Bootstrap spells it.

## What each control is

### `ActiveOrdersWidget`

The session's whole order list — nothing drops out on its own, so a user can
watch an order's transitions instead of having a row vanish. A terminal row is
greyed; a rejected one carries its reason on a hover icon (unwrapped out of the
venue's JSON blob when it arrives that way) and its × dismisses locally rather
than sending a cancel with nothing to cancel. Quantity, price and stop are
editable in place while the venue still holds the order; committing an edit
restates the whole triple, because a replace is not a field patch.

### `PositionsWidget`

Alphabetical at rest — positions have no natural "newest". Cash sits above them
as a pinned row: a different shape from a position, so it supplies its own cells,
stays out of the sort and out of the exported sheet, and being content it
suppresses the "no positions" row. Close and reverse are per-row buttons wired to
deps.

### `TradeHistoryWidget`

Read-only, newest fill on top, loaded against whichever portfolio the host names
at refresh time rather than one captured at construction.

### `WatchlistWidget`

Live quotes with a search box, favourites and one tab per instrument category
found in the data. A quote patches the two affected cells through the grid's
`(rowKey, columnKey)` lookup instead of repainting — a repaint would cancel the
flash animation it just started. It paints a screenful (`RENDER_CAP`) while the
export and the subscription sync work over the whole filtered set, and only the
primary instance reports to the host's ticker.

## Exported sheets say what the screen says

Every blotter exports to `.xlsx` through the grid, and a column states both
forms: the localized text the user reads (`Sell`, `Filled`) and the raw figure
under it (`2000` rather than the formatted `2,000.00`), so a sheet is sortable as
numbers and cannot drift from the table it came from.

## Development

```sh
npm install
npm test     # typecheck + public-API snapshot + style contract + unit tests
npm run build
```

`dist/` and `tests/_dist/` are build outputs and are gitignored.

There is no browser in the test process: `tests/fake-dom.ts` implements the slice
of DOM the controls touch, and its size is the statement of how narrow that
slice is.
