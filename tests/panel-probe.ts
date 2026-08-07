// Reading a rendered panel back out.
//
// Every control renders a table, so the tests ask the same handful of questions
// of all of them: what the header says, what got painted, which row is which,
// and — the sweep that matters most after the move off Razor templates —
// whether anything in the tree carries an inline handler.
import type { FakeElement } from './fake-dom.js';

export function head(root: FakeElement): FakeElement {
    return root.querySelector('thead')!;
}

export function body(root: FakeElement): FakeElement {
    return root.querySelectorAll('tbody')[0]!;
}

/// The text of every cell of every painted row, pinned rows included.
export function painted(root: FakeElement): string[][] {
    return body(root).childNodes.map(tr => (tr as FakeElement).childNodes.map(td => td.textContent));
}

export function rowKeys(root: FakeElement): (string | undefined)[] {
    return body(root).childNodes.map(tr => (tr as FakeElement).dataset.rowKey);
}

export function headerCaptions(root: FakeElement): string[] {
    return (head(root).childNodes[0] as FakeElement).childNodes.map(th => th.textContent);
}

/// Every element below a node — how the "no inline handler survived the move"
/// sweep looks at the whole rendered panel rather than at the cells it expects.
export function allElements(node: FakeElement, acc: FakeElement[] = []): FakeElement[] {
    for (const child of node.childNodes) {
        if (child.nodeType !== 1) continue;
        acc.push(child as FakeElement);
        allElements(child as FakeElement, acc);
    }
    return acc;
}
