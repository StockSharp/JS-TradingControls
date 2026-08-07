// The DOM the tests run against.
//
// The package has no DOM library and no browser in its test process, so the
// slice of DOM the controls touch is implemented here. Keeping the fake small
// is deliberate: it is also the statement of how narrow that surface is —
// create an element, set a class, set text, append, replace the children, read
// a data-* key, match a selector, dispatch an event.
//
// Three behaviours are load-bearing and therefore modelled rather than
// approximated:
//
//   * appendChild MOVES a node that already has a parent, and unwraps a
//     DocumentFragment. Cells are built as fragments (a star plus a label, a
//     status plus an icon), so a fake that appended the fragment itself would
//     nest a node the browser would have flattened.
//   * dispatchEvent BUBBLES until something stops it. The watchlist's favourite
//     star relies on stopPropagation to keep its click off the row underneath,
//     which is untestable against a fake that only calls the target's listeners.
//   * `dataset` is a view over `data-*`. The grid writes a row key through one
//     and the controls read selectors through the other.
//
// Installing the globals is a call rather than an import side effect, so a test
// file states that it needs a DOM instead of acquiring one by accident.

export interface FakeEvent {
    type: string;
    target?: FakeElement;
    key?: string;
    stopPropagation?(): void;
    preventDefault?(): void;
}

type FakeListener = (event: FakeEvent) => void;

export class FakeText {
    readonly nodeType = 3;
    data: string;
    parentNode: FakeElement | null = null;

    constructor(text: string) {
        this.data = String(text);
    }

    get textContent(): string { return this.data; }
}

export class FakeFragment {
    readonly nodeType = 11;
    childNodes: FakeNode[] = [];

    appendChild<T extends FakeNode>(node: T): T {
        this.childNodes.push(node);
        return node;
    }
}

export type FakeNode = FakeElement | FakeText;

function classSet(el: FakeElement): Set<string> {
    return new Set(el.className.split(' ').filter(Boolean));
}

/// camelCase dataset key -> data-* attribute name (`rowKey` -> `data-row-key`).
function dataAttribute(key: string): string {
    return 'data-' + key.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
}

/// data-* attribute name -> camelCase dataset key (`data-row-key` -> `rowKey`).
function datasetKey(attribute: string): string {
    return attribute.slice(5).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

/// Split a compound simple selector ("button.wl-fav[data-x]") into its parts.
function simpleParts(selector: string): string[] {
    return selector.match(/(^[a-zA-Z]+)|(\.[A-Za-z0-9_-]+)|(\[[^\]]+\])/g) || [];
}

function matchesSimple(el: FakeElement, selector: string): boolean {
    return simpleParts(selector).every(part => {
        if (part.startsWith('.')) return classSet(el).has(part.slice(1));
        if (part.startsWith('[')) {
            const attr = part.slice(1, -1);
            if (!attr.startsWith('data-')) throw new Error(`fake DOM: unsupported selector ${selector}`);
            const key = attr.slice(5).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
            return el.dataset[key] !== undefined;
        }
        return el.tagName === part.toUpperCase();
    });
}

export class FakeElement {
    readonly nodeType = 1;
    tagName: string;
    childNodes: FakeNode[] = [];
    parentNode: FakeElement | null = null;
    className = '';
    attributes: Record<string, string> = {};
    style: Record<string, string> = {};
    // Set by the controls on the elements that have them; the fake stores them
    // the way the browser does, as plain properties.
    value = '';
    type = '';
    step = '';
    min = '';
    title = '';
    id = '';
    // Reading it is how a control forces a reflow before restarting an
    // animation. There is no layout here, so it is a number that exists.
    readonly offsetWidth = 0;

    private _listeners = new Map<string, FakeListener[]>();

    constructor(tagName: string) {
        this.tagName = tagName.toUpperCase();
    }

    /// A view over the `data-*` attributes, not a second store. The grid writes
    /// a row key through `dataset` and the controls read `[data-filter]` back
    /// through a selector; a fake that kept the two apart would pass a test the
    /// browser fails.
    get dataset(): Record<string, string | undefined> {
        const attributes = this.attributes;
        return new Proxy({} as Record<string, string | undefined>, {
            get: (_target, key) => (typeof key === 'string' ? attributes[dataAttribute(key)] : undefined),
            set: (_target, key, value) => {
                if (typeof key === 'string') attributes[dataAttribute(key)] = String(value);
                return true;
            },
            has: (_target, key) => typeof key === 'string' && dataAttribute(key) in attributes,
            ownKeys: () => Object.keys(attributes).filter(a => a.startsWith('data-')).map(datasetKey),
            getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
        });
    }

    get classList() {
        const el = this;
        return {
            add(...names: string[]) {
                const set = classSet(el);
                for (const name of names) set.add(name);
                el.className = [...set].join(' ');
            },
            remove(...names: string[]) {
                const set = classSet(el);
                for (const name of names) set.delete(name);
                el.className = [...set].join(' ');
            },
            contains: (name: string) => classSet(el).has(name),
            toggle(name: string, force?: boolean) {
                const set = classSet(el);
                const on = force === undefined ? !set.has(name) : force;
                if (on) set.add(name); else set.delete(name);
                el.className = [...set].join(' ');
                return on;
            },
        };
    }

    get textContent(): string {
        return this.childNodes.map(n => n.textContent).join('');
    }

    set textContent(value: string) {
        this.childNodes = [];
        if (value !== '') this.appendChild(new FakeText(value));
    }

    appendChild<T extends FakeNode | FakeFragment>(node: T): T {
        if (node instanceof FakeFragment) {
            const moved = node.childNodes;
            node.childNodes = [];
            for (const child of moved) this.appendChild(child);
            return node;
        }
        const child = node as FakeNode;
        child.parentNode = this;
        this.childNodes.push(child);
        return node;
    }

    replaceChildren(...nodes: FakeNode[]): void {
        this.childNodes = [];
        for (const node of nodes) this.appendChild(node);
    }

    remove(): void {
        const parent = this.parentNode;
        if (!parent) return;
        parent.childNodes = parent.childNodes.filter(n => n !== this);
        this.parentNode = null;
    }

    setAttribute(name: string, value: string): void { this.attributes[name] = String(value); }

    getAttribute(name: string): string | null { return this.attributes[name] ?? null; }

    /// The inline order editor puts the caret in its input the moment the cell
    /// opens. Nothing here observes focus, so both are accepted and ignored.
    focus(): void { }

    select(): void { }

    blur(): void { this.dispatchEvent({ type: 'blur', target: this }); }

    /// Descendant selectors only ("a b c"), each part a compound simple selector.
    querySelectorAll(selector: string): FakeElement[] {
        let level: FakeElement[] = [this];
        for (const part of selector.trim().split(/\s+/)) {
            const next: FakeElement[] = [];
            for (const root of level) {
                const walk = (el: FakeElement) => {
                    for (const child of el.childNodes) {
                        if (child.nodeType !== 1) continue;
                        const element = child as FakeElement;
                        if (matchesSimple(element, part)) next.push(element);
                        walk(element);
                    }
                };
                walk(root);
            }
            level = next;
        }
        return level;
    }

    querySelector(selector: string): FakeElement | null { return this.querySelectorAll(selector)[0] || null; }

    closest(selector: string): FakeElement | null {
        let el: FakeElement | null = this;
        while (el) {
            if (el.nodeType === 1 && matchesSimple(el, selector)) return el;
            el = el.parentNode;
        }
        return null;
    }

    addEventListener(type: string, handler: FakeListener): void {
        if (!this._listeners.has(type)) this._listeners.set(type, []);
        this._listeners.get(type)!.push(handler);
    }

    /// Bubbles up the tree until something stops it — the favourite star relies
    /// on stopPropagation to keep a click off the row underneath it.
    dispatchEvent(event: FakeEvent): void {
        let stopped = false;
        event.stopPropagation = () => { stopped = true; };
        event.preventDefault = event.preventDefault || (() => { });
        let el: FakeElement | null = this;
        while (el) {
            for (const handler of el.listenersFor(event.type)) handler(event);
            if (stopped) return;
            el = el.parentNode;
        }
    }

    listenersFor(type: string): FakeListener[] {
        return this._listeners.get(type) || [];
    }
}

/// One detached element, for a test that needs a parent to create a panel into.
export function el(tag: string, className?: string): FakeElement {
    const node = new FakeElement(tag);
    if (className) node.className = className;
    return node;
}

/// Hand a fake where a real DOM type is expected. These two casts are the only
/// place the pretence is spelled out, and keeping them to one place is what
/// makes it checkable: a control that started using a member the fake lacks
/// fails in a test rather than in a browser.
export function asDom(node: FakeElement): HTMLElement {
    return node as unknown as HTMLElement;
}

/// Read a real DOM type the package handed back as the fake it really is.
export function asFake(node: unknown): FakeElement {
    return node as FakeElement;
}

/// Install the fake as the process-wide `document`.
///
/// `getElementById` answers null for everything on purpose: a control that
/// still went looking for a <template> in the page could not get past its
/// `create`, so the tests prove the markup really moved into the control rather
/// than assuming it.
export function installFakeDom(): void {
    (globalThis as Record<string, unknown>).document = {
        createElement: (tag: string) => new FakeElement(tag),
        createTextNode: (text: string) => new FakeText(text),
        createDocumentFragment: () => new FakeFragment(),
        getElementById: () => null,
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener: () => { },
        body: { appendChild: () => { } },
    };
}
