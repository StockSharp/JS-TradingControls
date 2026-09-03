// Strategy statistics — multi-instance.
//
// A read-only table of everything a strategy reports about itself: net profit, drawdown, trade
// counts, latencies. One row per parameter, grouped by the area it belongs to.
//
// The desktop grid derives its rows by reflecting over the strategy's statistic parameters, and
// a browser has no equivalent - so the rows arrive from the consumer already resolved, name and
// description translated, with the two things that decide where a row sits: a stable category
// key and the registry order. Both matter. Grouping on the translated category would regroup
// the table when the language changes, and sorting by name or by value would scatter parameters
// that are read together.
import { makeElement, makeIconButton, makePanelId, makePanelRoot } from './dom.js';
import { ControlTypes } from './control-types.js';
import { makeGridMenu } from './grid-menu.js';
import { TradingHost, assertHost } from './trading-host.js';
import type { StatisticRow } from './trading-data.js';
import { DataGrid, GridColumn } from '@stocksharp/grids/source/data-grid';

/// What the table needs beyond the host port. Nothing: there is nothing here to act on.
export interface StatisticsDeps {
    host: TradingHost;
}

/// A row with its category's place worked out.
interface RankedRow extends StatisticRow {
    categoryRank: number;
}

/// Give every category the place of its first parameter.
///
/// Taken from the rows rather than assumed: the registry bands its orders by category today
/// - profit below a hundred, trades from a hundred - but a consumer numbering them some
/// other way still gets its groups in the order it asked for.
function rank(rows: readonly StatisticRow[]): RankedRow[] {
    const first = new Map<string, number>();
    for (const row of rows) {
        const seen = first.get(row.category);
        if (seen === undefined || row.order < seen) first.set(row.category, row.order);
    }

    return rows.map(row => ({ ...row, categoryRank: first.get(row.category) ?? row.order }));
}

export class StatisticsWidget {
    static TYPE = ControlTypes.Statistics;

    rootEl: HTMLElement;
    el: HTMLElement | null;
    // `//` rather than `///` from here down — see the note in positions-widget.
    _host: TradingHost;
    _closeBtn: HTMLElement | null;
    _exportBtn: HTMLElement | null;
    _rows: RankedRow[];
    _grid: DataGrid<RankedRow> | null;

    static create(hostEl: HTMLElement, state: Record<string, unknown>, deps: StatisticsDeps): StatisticsWidget {
        const host = assertHost(deps?.host, 'StatisticsWidget');
        const root = StatisticsWidget._buildRoot(host);
        root.id = makePanelId(StatisticsWidget.TYPE);
        hostEl.appendChild(root);
        return new StatisticsWidget(root, state || {}, deps);
    }

    // The panel's markup. No rail action but the export: a statistic is produced by the
    // strategy and there is nothing here to cancel, reload or edit.
    static _buildRoot(host: TradingHost): HTMLElement {
        const title = host.t('Statistics');
        return makePanelRoot('statistics-panel', title, [
            makeElement('div', 'panel-header', {}, [
                makeElement('span', '', {}, [title]),
                makeIconButton('bt-icon-btn bt-icon-cancel panel-close-btn', host.t('ClosePanel'), 'bi-x', { type: 'button' }),
            ]),
            makeElement('div', 'panel-body panel-body-with-rail', {}, [
                makeElement('div', 'panel-body-content', {}, [
                    makeElement('table', 'terminal-table statistics-table', { role: 'table', 'aria-label': host.t('StatisticsList') }, [
                        makeElement('thead', '', {}, []),
                        makeElement('tbody', 'statistics-body', {}, []),
                    ]),
                ]),
                makeElement('div', 'panel-rail', { role: 'toolbar', 'aria-label': host.t('StatisticsActions') }, [
                    makeIconButton('bt-icon-btn panel-export-btn', host.t('ExportToExcel'), 'bi-file-earmark-spreadsheet', {}),
                ]),
            ]),
        ]);
    }

    constructor(rootEl: HTMLElement, _state: Record<string, unknown>, deps: StatisticsDeps) {
        this._host = assertHost(deps?.host, 'StatisticsWidget');

        this.rootEl = rootEl;
        this.el = this.rootEl.querySelector('.statistics-body');
        this._closeBtn = this.rootEl.querySelector('.panel-close-btn');
        this._exportBtn = this.rootEl.querySelector('.panel-export-btn');
        this._rows = [];

        this._closeBtn?.addEventListener('click', (e) => {
            e.preventDefault();
            this._host.close();
        });

        this._exportBtn?.addEventListener('click', (e) => {
            e.preventDefault();
            this._export();
        });

        const head = this.rootEl.querySelector('.statistics-table thead');
        this._grid = head && this.el
            ? new DataGrid<RankedRow>({
                head: head as HTMLElement,
                body: this.el,
                columns: this._columns(),
                // Not a sort the reader chose: the registry hands every parameter an order, and
                // the bands it assigns are what puts profit above drawdown above trade counts.
                defaultSort: { col: 'order', dir: 'asc' },
                rowKey: (r) => String(r.key),
                emptyText: this._host.t('NoStatistics'),
                contextMenu: makeGridMenu(this._host),
                // The groups sit where the registry order puts them, not where the
                // alphabet would: profit, then trades, then positions, then orders.
                groupOrder: 'rows',
                selection: 'multi',
            })
            : null;

        // Grouped on the key, never on the caption: the caption is translated and would
        // regroup the table under the reader's language. Neither the key nor the order is a
        // column anyone reads, so both are hidden - declared, so the grid can group and sort
        // on them, and out of the way.
        this._grid?.setState({ group: 'category', hidden: ['category', 'order'] });

        this._host.register(this);
    }

    dispose(): void {
        this._grid?.destroy();
        this._host.unregister(this);
        try { this.rootEl.remove(); } catch { /* already detached */ }
    }

    /// Show these statistics. The whole set at once: a strategy publishes its parameters as one
    /// table and a row that vanished from it has stopped existing, not stopped changing.
    update(rows: StatisticRow[]): void {
        this._rows = rank(rows || []);
        this._grid?.setRows(this._rows);
    }

    _export(): void {
        this._grid?.download('statistics', this._host.t('Statistics'));
    }

    // Two visible columns and one that only groups. The order column is hidden as well: it
    // decides the sort and means nothing to a reader.
    _columns(): GridColumn<RankedRow>[] {
        const label = (key: string) => this._host.t(key);
        return [
            {
                key: 'category',
                header: label('Category'),
                exportable: false,
                // The group's place, not its name: groups are laid out in the order the
                // registry gives their parameters, so profit comes before trade counts.
                // Grouping on the name would order them alphabetically, and on the
                // translated name would reorder them with the reader's language.
                value: (r) => r.categoryRank,
                text: (r) => r.categoryText || r.category,
            },
            {
                key: 'order',
                header: label('Order'),
                exportable: false,
                value: (r) => r.order,
            },
            {
                key: 'name',
                header: label('Name'),
                exportable: true,
                value: (r) => r.name,
                bindCell: (td, r) => {
                    if (r.description) td.setAttribute('title', r.description);
                },
            },
            {
                key: 'value',
                header: label('Value'),
                exportable: true,
                cellClass: () => 'statistic-value',
                // Sorts on the raw value so a number sorts as a number, reads as the text below.
                value: (r) => r.value as string | number | null,
                render: (r) => formatStatistic(r.value),
                exportValue: (r) => r.value ?? '',
            },
        ];
    }
}

/// A statistic as text.
///
/// Three shapes reach this: a number, a moment, and everything else. A number is rounded to two
/// places and shown without trailing zeros - a profit of 11055.75 and a count of 1340 both read
/// the way they are meant to. A moment is a date: these are run-level facts (the day of the
/// maximum drawdown), and the hour would be noise. Anything with no value yet is a blank cell
/// rather than a zero, which would read as a measured nothing.
export function formatStatistic(value: unknown): string {
    if (value === null || value === undefined || value === '') return '';

    if (typeof value === 'number') {
        if (!isFinite(value)) return '';
        return String(Math.round(value * 100) / 100);
    }

    if (value instanceof Date) return isoDate(value);

    if (typeof value === 'string') {
        // A date only when it is unambiguously one: a bare number in a string stays a number,
        // and a name stays a name.
        const at = /^\d{4}-\d{2}-\d{2}([T ]|$)/.test(value) ? new Date(value) : null;
        if (at !== null && !isNaN(at.getTime())) return isoDate(at);
        return value;
    }

    return String(value);
}

function isoDate(at: Date): string {
    return at.toISOString().slice(0, 10);
}
