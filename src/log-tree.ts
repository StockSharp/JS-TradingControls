// The log monitor's shape, as pure functions: how sources nest, and which messages a view of
// them keeps.
//
// A log source announces its parent, not its children, and it can announce itself before its
// parent has said anything — so the tree is assembled from whatever has arrived rather than
// walked from a root that may not exist yet. Keeping that here is what makes it checkable: a
// cycle, an orphan and an unnamed source are all things a live feed produces, and none of them
// should be discovered as a hung page.

/// The levels a log message carries. The names are the wire's; the letter is what a narrow
/// column shows.
export const LogLevels = {
    Error: 'error',
    Warning: 'warning',
    Info: 'info',
    Debug: 'debug',
    Verbose: 'verbose',
} as const;

export type LogLevel = typeof LogLevels[keyof typeof LogLevels];

/// One source of log messages, as it announces itself.
export interface LogSourceNode {
    id: string;
    name: string;
    /// The source this one runs under, when it has one.
    parentId?: string | null;
}

/// A source placed in the tree.
export interface LogTreeNode extends LogSourceNode {
    depth: number;
    children: LogTreeNode[];
}

/// One line of a log.
export interface LogMessageRow {
    id: number | string;
    /// When it was written, in whatever the consumer counts in.
    time: number | string;
    level: LogLevel | string;
    /// Which source wrote it. The tree filters on this.
    sourceId: string;
    /// That source's name, when the consumer sends it rather than looking it up.
    source?: string;
    message: string;
}

/// Assemble the sources into a forest, roots first, each node carrying its depth.
///
/// A source whose parent is not among these is a root: it is the only honest place for it, and
/// dropping it would silently lose a whole strategy's log because its connector had not spoken
/// yet. A cycle is broken the same way, by rooting the first node of it — a wrong tree beats a
/// walk that never ends.
export function buildLogTree(sources: readonly LogSourceNode[]): LogTreeNode[] {
    const byId = new Map<string, LogTreeNode>();
    for (const s of sources)
        byId.set(s.id, { ...s, name: s.name && s.name.length > 0 ? s.name : '—', depth: 0, children: [] });

    const roots: LogTreeNode[] = [];

    for (const node of byId.values()) {
        const parent = node.parentId != null ? byId.get(node.parentId) : undefined;
        if (parent !== undefined && parent !== node && !descends(byId, parent, node.id)) parent.children.push(node);
        else roots.push(node);
    }

    const setDepth = (node: LogTreeNode, depth: number): void => {
        node.depth = depth;
        for (const child of node.children) setDepth(child, depth + 1);
    };
    for (const root of roots) setDepth(root, 0);

    return roots;
}

/// Whether `node` already sits under `id`, which is how a cycle is spotted before it is made.
function descends(byId: Map<string, LogTreeNode>, node: LogTreeNode, id: string): boolean {
    const seen = new Set<string>();
    let at: LogTreeNode | undefined = node;
    while (at !== undefined && !seen.has(at.id)) {
        if (at.id === id) return true;
        seen.add(at.id);
        at = at.parentId != null ? byId.get(at.parentId) : undefined;
    }
    return false;
}

/// The ids a selected node covers: itself and everything under it, or null for no selection.
///
/// Null rather than every id, because "everything" and "this node, which happens to be the
/// root" are different questions and only one of them narrows when a new source appears.
export function subtreeOf(sources: readonly LogSourceNode[], selectedId: string | null): Set<string> | null {
    if (selectedId === null) return null;

    const children = new Map<string, string[]>();
    for (const s of sources) {
        if (s.parentId == null) continue;
        const siblings = children.get(s.parentId);
        if (siblings === undefined) children.set(s.parentId, [s.id]);
        else siblings.push(s.id);
    }

    const out = new Set<string>();
    const walk = (id: string): void => {
        if (out.has(id)) return;
        out.add(id);
        for (const child of children.get(id) ?? []) walk(child);
    };
    walk(selectedId);
    return out;
}

/// What a view of the log is showing.
export interface LogView {
    levels: ReadonlySet<string>;
    text: string;
    /// Source ids to keep, or null for all of them.
    sources: ReadonlySet<string> | null;
}

/// Whether this message belongs in that view. Every filter applies at once.
export function keepLog(message: LogMessageRow, view: LogView): boolean {
    if (!view.levels.has(message.level)) return false;
    if (view.sources !== null && !view.sources.has(message.sourceId)) return false;

    const text = view.text.trim();
    if (text.length === 0) return true;

    return (message.message ?? '').toLowerCase().includes(text.toLowerCase());
}
