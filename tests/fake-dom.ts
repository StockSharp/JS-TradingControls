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
    /// Where the pointer was. A control that draws its own pixels hit-tests
    /// them against these rather than against an element under the cursor,
    /// so a fake without them cannot exercise a chart's hover at all.
    clientX?: number;
    clientY?: number;
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

/// The slice of `CSSStyleDeclaration` the controls touch.
///
/// `setProperty` is the member that has to be real: a control measures a
/// proportion from the data it just painted — a level's share of the visible
/// depth, a bid/ask split — and hands it to the stylesheet as a custom property
/// rather than as a width, so the widths and colours stay in CSS. Reading one
/// back is how a test checks the arithmetic without a layout engine.
export class FakeStyle {
    [key: string]: unknown;

    readonly properties: Record<string, string> = {};

    setProperty(name: string, value: string): void { this.properties[name] = String(value); }

    getPropertyValue(name: string): string { return this.properties[name] ?? ''; }
}

/// One recorded drawing call, with the style that was in force when it was
/// made.
///
/// A canvas has no DOM to inspect afterwards, so a fake that merely swallowed
/// the calls would test nothing. Recording them — and, above all, the colours
/// they carried — is what lets a test prove a control paints in the palette its
/// HOST answered with rather than in literals of its own. The shapes are
/// checked against arithmetic in `orderbook-depth.test.ts` instead.
export interface CanvasCall {
    op: string;
    args: number[];
    fillStyle: string;
    strokeStyle: string;
    globalAlpha: number;
    /// Present on `fillText` only — the string that was drawn.
    text?: string;
}

/// The box an element occupies. There is no layout here, so a test that needs
/// one states it (`FakeElement.setRect`); everything else measures zero, which
/// is the honest answer for a node nobody sized.
export interface DOMRectLike {
    left: number;
    top: number;
    width: number;
    height: number;
}

export class FakeCanvasContext {
    readonly calls: CanvasCall[] = [];
    fillStyle = '';
    strokeStyle = '';
    lineWidth = 0;
    lineJoin = '';
    globalAlpha = 1;
    font = '';
    textAlign = '';
    textBaseline = '';

    clearRect(x: number, y: number, width: number, height: number): void { this._record('clearRect', [x, y, width, height]); }

    fillRect(x: number, y: number, width: number, height: number): void { this._record('fillRect', [x, y, width, height]); }

    beginPath(): void { this._record('beginPath', []); }

    closePath(): void { this._record('closePath', []); }

    moveTo(x: number, y: number): void { this._record('moveTo', [x, y]); }

    lineTo(x: number, y: number): void { this._record('lineTo', [x, y]); }

    fill(): void { this._record('fill', []); }

    stroke(): void { this._record('stroke', []); }

    arc(x: number, y: number, radius: number, start: number, end: number): void {
        this._record('arc', [x, y, radius, start, end]);
    }

    fillText(text: string, x: number, y: number): void {
        this._record('fillText', [x, y], text);
    }

    /// The device-pixel scale a control applies to its backing store. Recorded
    /// rather than applied: nothing here rasterises, and what a test wants to
    /// know is that the control asked.
    setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
        this._record('setTransform', [a, b, c, d, e, f]);
    }

    /// Every call the control made whose name matches, in order.
    opsOf(op: string): CanvasCall[] { return this.calls.filter(call => call.op === op); }

    private _record(op: string, args: number[], text?: string): void {
        this.calls.push({
            op, args, text,
            fillStyle: this.fillStyle,
            strokeStyle: this.strokeStyle,
            globalAlpha: this.globalAlpha,
        });
    }
}

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
    style = new FakeStyle();
    // Set by the controls on the elements that have them; the fake stores them
    // the way the browser does, as plain properties.
    value = '';
    type = '';
    step = '';
    min = '';
    // The empty string is a real upper bound on a number input — it is how the
    // browser spells "none" — so a control clearing `max` sets this rather than
    // removing an attribute.
    max = '';
    checked = false;
    disabled = false;
    title = '';
    id = '';
    // Reading it is how a control forces a reflow before restarting an
    // animation. There is no layout here, so it is a number that exists.
    readonly offsetWidth = 0;
    readonly offsetHeight = 0;
    // A control that places something itself measures the box it is placing
    // into. Nothing here lays anything out, so the box is whatever a test says
    // it is — see `setRect`.
    offsetParent: FakeElement | null = null;
    // A <canvas> the control drew into: its backing store size, and the 2D
    // context it asked for.
    width = 0;
    height = 0;
    // The CSS box a canvas occupies. A control sizes its backing store from
    // this and the pixel ratio its host answered with, so a test that wants a
    // paint to happen sets them — at zero there is nothing to draw into and the
    // control correctly does nothing.
    clientWidth = 0;
    clientHeight = 0;

    private _rect: DOMRectLike = { left: 0, top: 0, width: 0, height: 0 };
    private _context: FakeCanvasContext | null = null;
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

    /// `hidden` is an attribute, not a property, wherever a control wants a
    /// stylesheet to be able to see it — so removing one has to be as real as
    /// setting one.
    removeAttribute(name: string): void { delete this.attributes[name]; }

    get firstChild(): FakeNode | null { return this.childNodes[0] ?? null; }

    get lastChild(): FakeNode | null { return this.childNodes[this.childNodes.length - 1] ?? null; }

    /// Insert before `reference`, or append when it is null — the tape prepends
    /// each new print rather than repainting, which is what keeps the flash
    /// animation running on the rows already on screen.
    insertBefore<T extends FakeNode>(node: T, reference: FakeNode | null): T {
        const at = reference ? this.childNodes.indexOf(reference) : -1;
        node.parentNode = this;
        if (at < 0) this.childNodes.push(node);
        else this.childNodes.splice(at, 0, node);
        return node;
    }

    removeChild<T extends FakeNode>(node: T): T {
        this.childNodes = this.childNodes.filter(n => n !== node);
        node.parentNode = null;
        return node;
    }

    /// State the box this element occupies. Nothing here lays anything out, so
    /// a control that measures — a canvas sizing its backing store, a tooltip
    /// clamping itself inside one — reads whatever a test put here.
    setRect(rect: DOMRectLike): void { this._rect = rect; }

    getBoundingClientRect(): DOMRectLike { return this._rect; }

    /// The 2D context of a canvas, which records what was drawn into it. One
    /// per element, kept across paints, so a test can read the whole sequence a
    /// control produced. Any other context kind answers null, the way a browser
    /// answers for a kind it does not implement.
    getContext(kind: string): FakeCanvasContext | null {
        if (kind !== '2d') return null;
        if (!this._context) this._context = new FakeCanvasContext();
        return this._context;
    }

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

/// Watchers a control created, so a test can fire one instead of resizing a
/// window that does not exist.
export const resizeObservers: FakeResizeObserver[] = [];

/// The slice of `ResizeObserver` a control uses: observe what it drew into, and
/// disconnect when it goes away. Nothing here measures, so the callback is held
/// for a test to call.
export class FakeResizeObserver {
    readonly observed: unknown[] = [];
    disconnected = false;

    constructor(readonly callback: () => void) {
        resizeObservers.push(this);
    }

    observe(target: unknown): void { this.observed.push(target); }

    disconnect(): void { this.disconnected = true; }
}

/// Install the fake as the process-wide `document`.
///
/// `getElementById` answers null for everything on purpose: a control that
/// still went looking for a <template> in the page could not get past its
/// `create`, so the tests prove the markup really moved into the control rather
/// than assuming it.
///
/// `devicePixelRatio` and `ResizeObserver` are here for the same reason as the
/// rest: a control that draws its own pixels has to size its backing store to
/// the display and repaint when its box changes, and a fake that lacked them
/// would push the control into a fallback path no browser ever takes.
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
    (globalThis as Record<string, unknown>).devicePixelRatio = 1;
    (globalThis as Record<string, unknown>).ResizeObserver = FakeResizeObserver;
    resizeObservers.length = 0;
}
