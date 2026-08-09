// The wording of the grid's context menu and its filter dialog.
//
// `@stocksharp/grids` draws the menu and speaks English by default; a control
// here says nothing in its own words, so every label is taken from `host.t()`
// and handed over through the grid's `contextMenu` option. Each blotter calls
// this at construction — the labels are read once per grid, which is the same
// lifetime as every other caption a control renders.
//
// Every key below is a literal on purpose: `translation-keys.json` is generated
// by scanning for them, and a computed key would be invisible to that scan and
// reach a user as itself.
import { TradingHost } from './trading-host.js';
import type { GridMenuOptions } from '@stocksharp/grids/source/data-grid';

/// The grid's `contextMenu` option, worded by the host. Generic over the row
/// type only because the option is; no label depends on it.
export function makeGridMenu<TRow>(host: TradingHost): GridMenuOptions<TRow> {
    return {
        labels: {
            sortAsc: host.t('SortAscending'),
            sortDesc: host.t('SortDescending'),
            sortClear: host.t('ClearSort'),
            hideColumn: host.t('HideColumn'),
            showAllColumns: host.t('ShowAllColumns'),
            groupBy: host.t('GroupByColumn'),
            ungroup: host.t('Ungroup'),
            filterByValue: (text) => host.t('Filter by this value: {0}', text),
            filterRule: host.t('FilterRule'),
            showFilters: host.t('ShowFilterRow'),
            hideFilters: host.t('HideFilterRow'),
            showHeader: host.t('ShowHeaderRow'),
            hideHeader: host.t('HideHeaderRow'),
            clearFilters: host.t('ClearFilters'),
            copyCell: host.t('CopyCell'),
            copyRow: host.t('CopyRow'),
            copyRows: (count) => host.t('Copy selected rows ({0})', count),
            exportXlsx: host.t('ExportToXlsx'),
        },
        filterDialog: {
            labels: {
                title: (header) => host.t('Filter: {0}', header),
                apply: host.t('Apply'),
                clear: host.t('Clear'),
                cancel: host.t('Cancel'),
                value: host.t('Value'),
                and: host.t('FilterAnd'),
                ops: {
                    contains: host.t('FilterOpContains'),
                    notContains: host.t('FilterOpNotContains'),
                    startsWith: host.t('FilterOpStartsWith'),
                    endsWith: host.t('FilterOpEndsWith'),
                    eq: host.t('FilterOpEq'),
                    ne: host.t('FilterOpNe'),
                    gt: host.t('FilterOpGt'),
                    ge: host.t('FilterOpGe'),
                    lt: host.t('FilterOpLt'),
                    le: host.t('FilterOpLe'),
                    between: host.t('FilterOpBetween'),
                    anyOf: host.t('FilterOpAnyOf'),
                    noneOf: host.t('FilterOpNoneOf'),
                    empty: host.t('FilterOpEmpty'),
                    notEmpty: host.t('FilterOpNotEmpty'),
                },
            },
        },
    };
}
