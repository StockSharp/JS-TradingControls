// Element construction for controls that build their own DOM.
//
// A control that clones a <template> out of the page it happens to live on
// cannot render anywhere else, so the markup has to move into the control. It
// then has to stay readable as markup, which four lines of createElement /
// className / setAttribute / appendChild per element does not.
//
// Nothing here has an import, touches a global or knows what a trading control
// is — it is a spelling of `document.createElement`, and the shape of the call
// mirrors the shape of the tag it replaces:
//
//   <div class="panel-header"><span>Positions</span></div>
//   makeElement('div', 'panel-header', {}, [makeElement('span', '', {}, ['Positions'])])

/// One element. `className` may be empty and `attrs` may be empty — both are
/// then left off entirely, so the result matches markup that never carried
/// them. Children are appended in order; a string child becomes a text node.
export function makeElement(
    tag: string,
    className: string,
    attrs: Record<string, string>,
    children: Array<Node | string>,
): HTMLElement {
    const element = document.createElement(tag);
    if (className) element.className = className;
    for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, value);
    for (const child of children)
        element.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    return element;
}

/// A Bootstrap icon glyph — `<i class="bi bi-x"></i>`. Every icon in a control's
/// panel chrome is one of these, always with the `bi` base class.
export function makeIcon(iconClass: string): HTMLElement {
    return makeElement('i', `bi ${iconClass}`, {}, []);
}

/// An icon button from the panel chrome: one glyph, and the same text as both
/// tooltip and accessible name. `className` carries the full class list
/// because the buttons differ by more than one modifier
/// (`bt-icon-btn bt-icon-cancel panel-close-btn`).
export function makeIconButton(
    className: string,
    label: string,
    iconClass: string,
    attrs: Record<string, string>,
): HTMLButtonElement {
    return makeElement('button', className, { title: label, 'aria-label': label, ...attrs },
        [makeIcon(iconClass)]) as HTMLButtonElement;
}

/// The panel root every control builds: `.terminal-panel` plus the control's own
/// modifier class, carrying the region role and its accessible name.
///
/// The structure is a contract in two directions and both are load-bearing. A
/// host stylesheet targets these class names, and a docking host may lift
/// `.panel-header`'s children into its own tab strip, which needs
/// `.terminal-panel` to be the root's only element child.
export function makePanelRoot(modifierClass: string, label: string, children: Array<Node | string>): HTMLElement {
    return makeElement('div', `terminal-panel ${modifierClass}`, { role: 'region', 'aria-label': label }, children);
}

/// A unique element id for one control instance. Time plus a random tail: the
/// time alone collides when a host restores a saved layout, which creates every
/// panel inside one millisecond.
export function makePanelId(type: string): string {
    return `panel-${type}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1000).toString(36)}`;
}
