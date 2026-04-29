// Tiny DOM helpers used by the renderers. Vanilla — no framework, no JSX.

type Attrs = Record<string, string | boolean | number | null | undefined>;
type Child = HTMLElement | string | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = String(v);
    else if (k === 'html') node.innerHTML = String(v);
    else if (k.startsWith('on') && typeof v === 'function') {
      // (Type-system gymnastics avoided by funnelling listeners through .addEventListener.)
      throw new Error(`Use addEventListener, not on${k.slice(2)} in attrs`);
    } else node.setAttribute(k, String(v));
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (typeof c === 'string') node.appendChild(document.createTextNode(c));
    else node.appendChild(c);
  }
  return node;
}

export function $(id: string): HTMLElement {
  const e = document.getElementById(id);
  if (!e) throw new Error(`Element #${id} not found`);
  return e;
}

export function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function show(node: HTMLElement, visible: boolean): void {
  if (visible) node.removeAttribute('hidden');
  else node.setAttribute('hidden', '');
}

/** Build a cluster of pill-style buttons. Toggles a `selected` value. */
export function pillRow<T extends string>(
  options: readonly T[],
  selected: T | null,
  onChange: (value: T) => void,
  cls = 'chip',
): HTMLElement {
  const wrap = el('div', { class: 'pill-row' });
  for (const opt of options) {
    const btn = el('button', {
      type: 'button',
      class: `${cls}${selected === opt ? ' selected' : ''}`,
      'data-val': opt,
    }, opt);
    btn.addEventListener('click', () => onChange(opt));
    wrap.appendChild(btn);
  }
  return wrap;
}
