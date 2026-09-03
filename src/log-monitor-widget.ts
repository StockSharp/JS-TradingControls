// Log monitor — multi-instance.
//
// Two panes: the tree of everything that writes a log on the left, and on the right what the
// selected source and everything under it has written. The desktop version copies each message
// into every ancestor's list, so one line is held as many times as it has ancestors and its own
// counter reports copies rather than messages. Here a message is held once and carries the id
// of the source that wrote it; selecting a node filters by its subtree.
//
// A live log has no end, so this one has a cap. The desktop's grows for the lifetime of the
// window - nothing trims it - which a browser tab cannot afford.
import { makeElement, makeIconButton, makePanelId, makePanelRoot } from './dom.js';
import { ControlTypes } from './control-types.js';
import { makeGridMenu } from './grid-menu.js';
import { TradingHost, assertHost } from './trading-host.js';
import {
    LogLevels, buildLogTree, keepLog, subtreeOf,
    type LogLevel, type LogMessageRow, type LogSourceNode, type LogTreeNode,
} from './log-tree.js';
import { DataGrid, GridColumn } from '@stocksharp/grids/source/data-grid';

/// What the monitor needs beyond the host port. Nothing: a log is written to, not acted on.
export interface LogMonitorDeps {
    host: TradingHost;
    /// How many messages to keep. Older ones fall off the front. Defaults to 5000 - enough to
    /// scroll back through a session, small enough that a chatty connector cannot fill a tab.
    maxMessages?: number;
}

const DEFAULT_MAX = 5_000;

/// The letter a level shows in the narrow column, and the class that colours the row.
///
/// Info gets a letter here. The desktop leaves its cell blank - there is simply no trigger for
/// it among the four that exist - so the commonest level is the one with no marking at all,
/// which is an omission rather than a decision.
const LEVEL_LETTER: Record<string, string> = {
    [LogLevels.Error]: 'E',
    [LogLevels.Warning]: 'W',
    [LogLevels.Info]: 'I',
    [LogLevels.Debug]: 'D',
    [LogLevels.Verbose]: 'V',
};

const ALL_LEVELS: LogLevel[] = [LogLevels.Error, LogLevels.Warning, LogLevels.Info, LogLevels.Debug, LogLevels.Verbose];

export class LogMonitorWidget {
    static TYPE = ControlTypes.LogMonitor;

    rootEl: HTMLElement;
    el: HTMLElement | null;
    // `//` rather than `///` from here down — see the note in positions-widget.
    _host: TradingHost;
    _max: number;
    _closeBtn: HTMLElement | null;
    _clearBtn: HTMLElement | null;
    _exportBtn: HTMLElement | null;
    _treeEl: HTMLElement | null;
    _filterEl: HTMLInputElement | null;
    _sources: LogSourceNode[];
    _messages: LogMessageRow[];
    _levels: Set<string>;
    _text: string;
    _selected: string | null;
    _grid: DataGrid<LogMessageRow> | null;

    static create(hostEl: HTMLElement, state: Record<string, unknown>, deps: LogMonitorDeps): LogMonitorWidget {
        const host = assertHost(deps?.host, 'LogMonitorWidget');
        const root = LogMonitorWidget._buildRoot(host);
        root.id = makePanelId(LogMonitorWidget.TYPE);
        hostEl.appendChild(root);
        return new LogMonitorWidget(root, state || {}, deps);
    }

    // The panel's markup: a source tree, a toolbar of level toggles and a text box, and the
    // message table. The level toggles are buttons rather than checkboxes because they are read
    // as a row of states, and each carries its letter so the toolbar and the column agree.
    static _buildRoot(host: TradingHost): HTMLElement {
        const title = host.t('LogMonitor');
        return makePanelRoot('log-monitor-panel', title, [
            makeElement('div', 'panel-header', {}, [
                makeElement('span', '', {}, [title]),
                makeIconButton('bt-icon-btn bt-icon-cancel panel-close-btn', host.t('ClosePanel'), 'bi-x', { type: 'button' }),
            ]),
            makeElement('div', 'panel-body log-monitor-body', {}, [
                makeElement('div', 'log-sources', { role: 'tree', 'aria-label': host.t('LogSources') }, []),
                makeElement('div', 'log-messages', {}, [
                    makeElement('div', 'log-toolbar', { role: 'toolbar', 'aria-label': host.t('LogMonitorActions') }, [
                        ...ALL_LEVELS.map(level => makeElement('button', `log-level-toggle log-level-${level} is-on`, {
                            type: 'button',
                            'data-level': level,
                            'aria-pressed': 'true',
                            title: levelTitle(host, level),
                        }, [LEVEL_LETTER[level]])),
                        makeElement('input', 'form-control form-control-sm log-filter', {
                            type: 'search',
                            placeholder: host.t('Filter'),
                            'aria-label': host.t('Filter'),
                        }, []),
                        makeIconButton('bt-icon-btn log-clear-btn', host.t('ClearItems'), 'bi-eraser', {}),
                        makeIconButton('bt-icon-btn panel-export-btn', host.t('ExportToExcel'), 'bi-file-earmark-spreadsheet', {}),
                    ]),
                    // The table sits in a box of its own rather than being a flex child: a table
                    // told to fill a column stretches its rows to do it, so a log holding one
                    // line drew that line a panel tall - and with the toolbar and the table as
                    // the only two children there was nowhere for a long log to scroll.
                    makeElement('div', 'log-table-scroll', {}, [
                        makeElement('table', 'terminal-table log-table', { role: 'table', 'aria-label': host.t('LogMessages') }, [
                            makeElement('thead', '', {}, []),
                            makeElement('tbody', 'log-body', {}, []),
                        ]),
                    ]),
                ]),
            ]),
        ]);
    }

    constructor(rootEl: HTMLElement, _state: Record<string, unknown>, deps: LogMonitorDeps) {
        this._host = assertHost(deps?.host, 'LogMonitorWidget');
        this._max = deps?.maxMessages && deps.maxMessages > 0 ? deps.maxMessages : DEFAULT_MAX;

        this.rootEl = rootEl;
        this.el = this.rootEl.querySelector('.log-body');
        this._treeEl = this.rootEl.querySelector('.log-sources');
        this._filterEl = this.rootEl.querySelector('.log-filter');
        this._closeBtn = this.rootEl.querySelector('.panel-close-btn');
        this._clearBtn = this.rootEl.querySelector('.log-clear-btn');
        this._exportBtn = this.rootEl.querySelector('.panel-export-btn');

        this._sources = [];
        this._messages = [];
        this._levels = new Set<string>(ALL_LEVELS);
        this._text = '';
        this._selected = null;

        this._closeBtn?.addEventListener('click', (e) => { e.preventDefault(); this._host.close(); });
        this._clearBtn?.addEventListener('click', (e) => { e.preventDefault(); this.clear(); });
        this._exportBtn?.addEventListener('click', (e) => { e.preventDefault(); this._export(); });

        for (const toggle of Array.from(this.rootEl.querySelectorAll<HTMLElement>('.log-level-toggle'))) {
            toggle.addEventListener('click', (e) => {
                e.preventDefault();
                const level = toggle.getAttribute('data-level') ?? '';
                if (this._levels.has(level)) this._levels.delete(level);
                else this._levels.add(level);
                toggle.classList.toggle('is-on', this._levels.has(level));
                toggle.setAttribute('aria-pressed', this._levels.has(level) ? 'true' : 'false');
                this._render();
            });
        }

        this._filterEl?.addEventListener('input', () => {
            this._text = this._filterEl?.value ?? '';
            this._render();
        });

        const head = this.rootEl.querySelector('.log-table thead');
        this._grid = head && this.el
            ? new DataGrid<LogMessageRow>({
                head: head as HTMLElement,
                body: this.el,
                columns: this._columns(),
                // The order it happened in. A log read out of order is not a log.
                defaultSort: { col: 'time', dir: 'asc' },
                rowKey: (m) => String(m.id),
                emptyText: this._host.t('NoLogMessages'),
                rowClass: (m) => `log-row log-row-${m.level}`,
                contextMenu: makeGridMenu(this._host),
                selection: 'multi',
            })
            : null;

        this._host.register(this);
    }

    dispose(): void {
        this._grid?.destroy();
        this._host.unregister(this);
        try { this.rootEl.remove(); } catch { /* already detached */ }
    }

    /// The sources that exist. Sent whole: a source that has gone is gone from the tree, and
    /// the selection falls back to everything rather than to a node nobody can see.
    setSources(sources: LogSourceNode[]): void {
        this._sources = sources || [];
        if (this._selected !== null && !this._sources.some(s => s.id === this._selected)) this._selected = null;
        this._renderTree();
        this._render();
    }

    /// Add what has just been written. The oldest fall off the front once the cap is reached.
    append(messages: LogMessageRow[]): void {
        if (!messages || messages.length === 0) return;

        this._messages.push(...messages);
        if (this._messages.length > this._max) this._messages.splice(0, this._messages.length - this._max);
        this._render();
    }

    /// Forget every message. The sources stay: they still exist, they have just gone quiet.
    clear(): void {
        this._messages = [];
        this._render();
    }

    /// Show one source's subtree, or everything when given null.
    select(sourceId: string | null): void {
        this._selected = sourceId;
        this._renderTree();
        this._render();
    }

    /// What is on screen, after every filter.
    visible(): LogMessageRow[] {
        const sources = subtreeOf(this._sources, this._selected);
        return this._messages.filter(m => keepLog(m, { levels: this._levels, text: this._text, sources }));
    }

    _render(): void {
        this._grid?.setRows(this.visible());
    }

    _renderTree(): void {
        const tree = this._treeEl;
        if (tree === null) return;

        tree.innerHTML = '';
        tree.appendChild(this._treeRow({ id: '', name: this._host.t('AllSources'), depth: 0, children: [] }, null));
        for (const root of buildLogTree(this._sources)) this._appendNode(tree, root);
    }

    _appendNode(into: HTMLElement, node: LogTreeNode): void {
        into.appendChild(this._treeRow(node, node.id));
        for (const child of node.children) this._appendNode(into, child);
    }

    // Flat rows with an indent rather than nested lists: the tree is read, not restructured,
    // and one list is what a keyboard walks through in the order the eye does.
    _treeRow(node: LogTreeNode, id: string | null): HTMLElement {
        const selected = this._selected === id;
        const row = makeElement('button', `log-source${selected ? ' is-selected' : ''}`, {
            type: 'button',
            role: 'treeitem',
            'aria-selected': selected ? 'true' : 'false',
            'aria-level': String(node.depth + 1),
            style: `padding-left: ${0.5 + node.depth * 0.85}rem`,
        }, [node.name]);

        row.addEventListener('click', (e) => { e.preventDefault(); this.select(id); });
        return row;
    }

    _export(): void {
        this._grid?.download('log', this._host.t('LogMonitor'));
    }

    _columns(): GridColumn<LogMessageRow>[] {
        const label = (key: string) => this._host.t(key);
        return [
            {
                key: 'source',
                header: label('Source'),
                exportable: true,
                value: (m) => m.source ?? this._sourceName(m.sourceId),
            },
            {
                key: 'time',
                header: label('Time'),
                exportable: true,
                value: (m) => m.time,
                render: (m) => this._host.presentation.timeText(m.time),
                exportValue: (m) => this._host.presentation.timeText(m.time),
            },
            {
                key: 'level',
                header: label('Type'),
                headerClass: 'log-level-col',
                exportable: true,
                cellClass: (m) => `log-level-cell log-level-${m.level}`,
                value: (m) => m.level,
                render: (m) => LEVEL_LETTER[m.level] ?? String(m.level ?? '').slice(0, 1).toUpperCase(),
                // The sheet carries the level's name, not the letter the column has room for.
                exportValue: (m) => m.level,
            },
            {
                key: 'message',
                header: label('Message'),
                exportable: true,
                cellClass: () => 'log-message-cell',
                value: (m) => m.message,
            },
        ];
    }

    _sourceName(id: string): string {
        return this._sources.find(s => s.id === id)?.name ?? id;
    }
}

/// What a level's toggle is called.
///
/// Literal keys at the point they are asked for - see the note on the same shape in
/// strategies-widget: a key built from a value is invisible to the scan that generates
/// `translation-keys.json`, and reaches the user untranslated.
function levelTitle(host: TradingHost, level: LogLevel): string {
    switch (level) {
        case LogLevels.Error: return host.t('Errors');
        case LogLevels.Warning: return host.t('Warnings');
        case LogLevels.Info: return host.t('Messages');
        case LogLevels.Debug: return host.t('Debug');
        default: return host.t('Verbose');
    }
}
