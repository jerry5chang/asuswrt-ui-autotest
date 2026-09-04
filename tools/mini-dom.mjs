/**
 * A DOM small enough to have no dependencies and real enough to test the EAA
 * suites against HTML fixtures.
 *
 * The suites are DOM-shaped: "does this input have a label", "is this div in
 * the tab order", "what is behind this text". Asserting that with a
 * selector-keyed stub means writing the answer into the fixture, which tests
 * nothing. So this parses an HTML string into a tree and implements the parts
 * the suites actually use: selector matching, `closest`, computed style with
 * inheritance, geometry, focus and event bubbling.
 *
 * Deliberately not a browser. What it does *not* do, it throws on, so a suite
 * that starts relying on something new fails loudly instead of silently
 * getting `undefined`:
 *   - no layout: geometry comes from `data-rect="x,y,w,h"` on the fixture
 *   - no cascade: styles come from `style="…"`, plus inheritance for the
 *     properties that inherit, plus per-tag defaults
 *   - no CSS parsing beyond inline declarations
 *
 * Fixture conventions:
 *   data-rect="0,0,120,24"   getBoundingClientRect for this element
 *   style="color: rgb(…)"    inline style, read by getComputedStyle
 */

const VOID_TAGS = new Set([
    'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
    'param', 'source', 'track', 'wbr',
]);

/** Properties that inherit, so a fixture can set colour once on a parent. */
const INHERITED = new Set([
    'color', 'font-size', 'font-weight', 'font-family', 'line-height', 'visibility',
    'cursor', 'text-align', 'letter-spacing', 'word-spacing',
]);

const TAG_DEFAULTS = {
    DIV: { display: 'block' },
    P: { display: 'block' },
    BODY: { display: 'block' },
    HTML: { display: 'block' },
    TABLE: { display: 'table' },
    TR: { display: 'table-row' },
    TD: { display: 'table-cell' },
    TH: { display: 'table-cell' },
    UL: { display: 'block' },
    LI: { display: 'list-item' },
    FORM: { display: 'block' },
    H1: { display: 'block', 'font-size': '32px', 'font-weight': '700' },
    H2: { display: 'block', 'font-size': '24px', 'font-weight': '700' },
    H3: { display: 'block', 'font-size': '19px', 'font-weight': '700' },
    BUTTON: { cursor: 'pointer' },
    A: { cursor: 'pointer' },
    LABEL: { display: 'inline' },
    SPAN: { display: 'inline' },
    IMG: { display: 'inline' },
    INPUT: { display: 'inline-block' },
    SELECT: { display: 'inline-block' },
    SVG: { display: 'inline' },
};

const BASE_STYLE = {
    display: 'inline',
    visibility: 'visible',
    opacity: '1',
    color: 'rgb(0, 0, 0)',
    'background-color': 'rgba(0, 0, 0, 0)',
    'background-image': 'none',
    'font-size': '16px',
    'font-weight': '400',
    cursor: 'auto',
    outline: 'none',
    'outline-width': '0px',
    'box-shadow': 'none',
    'border-color': 'rgb(0, 0, 0)',
    'border-width': '0px',
    'white-space': 'normal',
    overflow: 'visible',
};

const CAMEL = (prop) => prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

class TextNode {
    constructor(text) {
        this.nodeType = 3;
        this.nodeValue = text;
        this.parentElement = null;
    }
    get textContent() {
        return this.nodeValue;
    }
}

class Element {
    constructor(tagName, doc) {
        this.nodeType = 1;
        this.tagName = tagName.toUpperCase();
        this.ownerDocument = doc;
        this.attributes = new Map();
        this.childNodes = [];
        this.parentElement = null;
        this._listeners = {};
        /** Set by focus(); read through document.activeElement. */
        this._focused = false;
    }

    /* --- tree --- */

    get children() {
        return this.childNodes.filter((n) => n.nodeType === 1);
    }

    appendChild(node) {
        node.parentElement = this;
        this.childNodes.push(node);
        return node;
    }

    removeChild(node) {
        const i = this.childNodes.indexOf(node);
        if (i !== -1) this.childNodes.splice(i, 1);
        node.parentElement = null;
        return node;
    }

    get previousElementSibling() {
        if (!this.parentElement) return null;
        const sibs = this.parentElement.children;
        return sibs[sibs.indexOf(this) - 1] || null;
    }

    get nextElementSibling() {
        if (!this.parentElement) return null;
        const sibs = this.parentElement.children;
        return sibs[sibs.indexOf(this) + 1] || null;
    }

    get textContent() {
        return this.childNodes.map((n) => n.textContent).join('');
    }

    set textContent(value) {
        this.childNodes = [];
        this.appendChild(new TextNode(String(value)));
    }

    get innerText() {
        return this.textContent;
    }

    get innerHTML() {
        return this.childNodes.map(serialise).join('');
    }

    get outerHTML() {
        return serialise(this);
    }

    contains(other) {
        for (let n = other; n; n = n.parentElement) if (n === this) return true;
        return false;
    }

    /* --- attributes --- */

    getAttribute(name) {
        const v = this.attributes.get(name.toLowerCase());
        return v === undefined ? null : v;
    }
    setAttribute(name, value) {
        this.attributes.set(name.toLowerCase(), String(value));
    }
    removeAttribute(name) {
        this.attributes.delete(name.toLowerCase());
    }
    hasAttribute(name) {
        return this.attributes.has(name.toLowerCase());
    }
    getAttributeNames() {
        return [...this.attributes.keys()];
    }

    get id() {
        return this.getAttribute('id') || '';
    }
    get className() {
        return this.getAttribute('class') || '';
    }
    set className(v) {
        this.setAttribute('class', v);
    }
    get classList() {
        const self = this;
        return {
            contains: (c) => self.className.split(/\s+/).includes(c),
            add(c) {
                if (!this.contains(c)) self.className = (self.className + ' ' + c).trim();
            },
            remove(c) {
                self.className = self.className
                    .split(/\s+/)
                    .filter((x) => x && x !== c)
                    .join(' ');
            },
        };
    }
    get type() {
        return this.getAttribute('type') || (this.tagName === 'INPUT' ? 'text' : '');
    }
    get value() {
        const v = this.getAttribute('value');
        return v === null ? this._value || '' : v;
    }
    set value(v) {
        this._value = String(v);
    }
    get checked() {
        return this._checked === undefined ? this.hasAttribute('checked') : this._checked;
    }
    set checked(v) {
        this._checked = !!v;
    }
    get disabled() {
        return this.hasAttribute('disabled');
    }
    get href() {
        return this.getAttribute('href') || '';
    }
    get isContentEditable() {
        return this.getAttribute('contenteditable') === 'true';
    }
    get hidden() {
        return this.hasAttribute('hidden');
    }
    set hidden(v) {
        if (v) this.setAttribute('hidden', '');
        else this.removeAttribute('hidden');
    }

    /* --- selectors --- */

    matches(selector) {
        return selectorMatches(this, selector);
    }

    closest(selector) {
        for (let n = this; n && n.nodeType === 1; n = n.parentElement) {
            if (selectorMatches(n, selector)) return n;
        }
        return null;
    }

    querySelector(selector) {
        return this.querySelectorAll(selector)[0] || null;
    }

    querySelectorAll(selector) {
        const all = [];
        collect(this, all);
        return all.filter((el) => selectorMatches(el, selector, this));
    }

    getElementsByTagName(tag) {
        const want = tag.toUpperCase();
        const all = [];
        collect(this, all);
        return want === '*' ? all : all.filter((el) => el.tagName === want);
    }

    /* --- geometry, driven by data-rect --- */

    getBoundingClientRect() {
        const spec = this.getAttribute('data-rect');
        const [x, y, w, h] = spec ? spec.split(',').map(Number) : [0, 0, 100, 20];
        return { x, y, left: x, top: y, width: w, height: h, right: x + w, bottom: y + h };
    }

    getClientRects() {
        const r = this.getBoundingClientRect();
        return r.width === 0 && r.height === 0 ? [] : [r];
    }

    get offsetWidth() {
        return this.getBoundingClientRect().width;
    }
    get offsetHeight() {
        return this.getBoundingClientRect().height;
    }
    get offsetParent() {
        const cs = this.ownerDocument.defaultView.getComputedStyle(this);
        if (cs.display === 'none') return null;
        return this.parentElement || null;
    }
    get scrollWidth() {
        return Number(this.getAttribute('data-scroll-width') || this.offsetWidth);
    }
    get clientWidth() {
        return Number(this.getAttribute('data-client-width') || this.offsetWidth);
    }

    /* --- focus and events --- */

    focus() {
        const doc = this.ownerDocument;
        if (doc._active) doc._active._focused = false;
        this._focused = true;
        doc._active = this;
        this.dispatchEvent({ type: 'focus', target: this });
    }

    blur() {
        this._focused = false;
        if (this.ownerDocument._active === this) this.ownerDocument._active = this.ownerDocument.body;
    }

    click() {
        this.dispatchEvent({ type: 'click', target: this });
        const inline = this.getAttribute('onclick');
        if (inline && this.ownerDocument._onclickHandlers.has(inline)) {
            this.ownerDocument._onclickHandlers.get(inline)(this);
        }
    }

    addEventListener(type, fn) {
        (this._listeners[type] = this._listeners[type] || []).push(fn);
    }

    removeEventListener(type, fn) {
        const list = this._listeners[type] || [];
        const i = list.indexOf(fn);
        if (i !== -1) list.splice(i, 1);
    }

    dispatchEvent(event) {
        event.target = event.target || this;
        let stopped = false;
        event.stopPropagation = () => {
            stopped = true;
        };
        event.preventDefault = () => {
            event.defaultPrevented = true;
        };
        for (let n = this; n && !stopped; n = n.parentElement) {
            event.currentTarget = n;
            for (const fn of (n._listeners[event.type] || []).slice()) fn.call(n, event);
        }
        return !event.defaultPrevented;
    }
}

function collect(root, out) {
    for (const child of root.childNodes) {
        if (child.nodeType !== 1) continue;
        out.push(child);
        collect(child, out);
    }
}

function serialise(node) {
    if (node.nodeType === 3) return node.nodeValue;
    const tag = node.tagName.toLowerCase();
    const attrs = [...node.attributes.entries()]
        .map(([k, v]) => (v === '' ? ` ${k}` : ` ${k}="${v}"`))
        .join('');
    if (VOID_TAGS.has(tag)) return `<${tag}${attrs}>`;
    return `<${tag}${attrs}>${node.childNodes.map(serialise).join('')}</${tag}>`;
}

/* -------------------------------------------------------------- selectors */

/**
 * Supported: comma lists, descendant and `>` combinators, and compound simple
 * selectors of tag / #id / .class / [attr] / [attr=v] / [attr^=v] / [attr*=v]
 * / :not(simple). Anything else throws, rather than silently matching nothing.
 */
function selectorMatches(el, selector, scope) {
    return String(selector)
        .split(',')
        .some((part) => matchComplex(el, part.trim(), scope));
}

function matchComplex(el, selector, scope) {
    const tokens = selector.split(/\s*(>)\s*|\s+/).filter(Boolean);
    let node = el;
    let i = tokens.length - 1;
    if (!matchSimple(node, tokens[i])) return false;
    i--;
    let mustBeParent = false;
    while (i >= 0) {
        const token = tokens[i];
        if (token === '>') {
            mustBeParent = true;
            i--;
            continue;
        }
        let ancestor = node.parentElement;
        if (mustBeParent) {
            if (!ancestor || !matchSimple(ancestor, token)) return false;
            node = ancestor;
        } else {
            let found = null;
            for (let n = ancestor; n && n.nodeType === 1; n = n.parentElement) {
                if (matchSimple(n, token)) {
                    found = n;
                    break;
                }
            }
            if (!found) return false;
            node = found;
        }
        mustBeParent = false;
        i--;
    }
    return !scope || scope.contains(el);
}

const SIMPLE = /^(\*|[a-zA-Z][\w-]*)?((?:[#.][\w-]+|\[[^\]]+\]|:not\([^)]+\))*)$/;

function matchSimple(el, token) {
    const m = SIMPLE.exec(token);
    if (!m) throw new Error(`mini-dom: unsupported selector "${token}"`);
    const [, tag, rest] = m;
    if (tag && tag !== '*' && el.tagName !== tag.toUpperCase()) return false;
    const pieces = rest ? rest.match(/[#.][\w-]+|\[[^\]]+\]|:not\([^)]+\)/g) || [] : [];
    for (const piece of pieces) {
        if (piece[0] === '#') {
            if (el.id !== piece.slice(1)) return false;
        } else if (piece[0] === '.') {
            if (!el.classList.contains(piece.slice(1))) return false;
        } else if (piece.startsWith(':not(')) {
            if (matchSimple(el, piece.slice(5, -1).trim())) return false;
        } else {
            const body = piece.slice(1, -1);
            const attrMatch = /^([\w-]+)(?:([~^*|$]?)=(?:"([^"]*)"|'([^']*)'|([^\]]*)))?$/.exec(body);
            if (!attrMatch) throw new Error(`mini-dom: unsupported attribute selector "${piece}"`);
            const [, name, op, dq, sq, bare] = attrMatch;
            const want = dq !== undefined ? dq : sq !== undefined ? sq : bare;
            const have = el.getAttribute(name);
            if (have === null) return false;
            if (want === undefined) continue;
            if (op === '^') {
                if (!have.startsWith(want)) return false;
            } else if (op === '*') {
                if (!have.includes(want)) return false;
            } else if (op === '~') {
                if (!have.split(/\s+/).includes(want)) return false;
            } else if (have !== want) {
                return false;
            }
        }
    }
    return true;
}

/* ----------------------------------------------------------------- parsing */

const TAG_RE = /<(\/?)([a-zA-Z][\w:-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s">]+))?)*)\s*(\/?)>/g;
const ATTR_RE = /([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s">]+)))?/g;

function parseAttrs(el, raw) {
    if (!raw) return;
    let m;
    ATTR_RE.lastIndex = 0;
    while ((m = ATTR_RE.exec(raw))) {
        const [, name, dq, sq, bare] = m;
        if (!name) continue;
        el.setAttribute(name, dq !== undefined ? dq : sq !== undefined ? sq : bare !== undefined ? bare : '');
    }
}

/** Parse an HTML fragment into a document whose body holds it. */
export function parseHtml(html) {
    const doc = makeDocument();
    const body = doc.body;
    let stack = [body];
    let last = 0;
    let m;
    TAG_RE.lastIndex = 0;
    const addText = (text) => {
        if (!text) return;
        if (/^\s*$/.test(text) && stack[stack.length - 1].childNodes.length === 0) return;
        stack[stack.length - 1].appendChild(new TextNode(text));
    };

    while ((m = TAG_RE.exec(html))) {
        addText(html.slice(last, m.index));
        last = m.index + m[0].length;
        const [, closing, tag, attrs, selfClose] = m;
        const name = tag.toLowerCase();
        if (closing) {
            for (let i = stack.length - 1; i > 0; i--) {
                if (stack[i].tagName === name.toUpperCase()) {
                    stack = stack.slice(0, i);
                    break;
                }
            }
            continue;
        }
        const el = new Element(name, doc);
        parseAttrs(el, attrs);
        stack[stack.length - 1].appendChild(el);
        if (!selfClose && !VOID_TAGS.has(name)) stack.push(el);
    }
    addText(html.slice(last));
    doc._index();
    return doc;
}

function makeDocument() {
    const doc = {
        nodeType: 9,
        _byId: new Map(),
        _onclickHandlers: new Map(),
    };
    const html = new Element('html', doc);
    const body = new Element('body', doc);
    html.appendChild(body);
    doc.documentElement = html;
    doc.body = body;
    doc._active = body;

    doc._index = () => {
        doc._byId = new Map();
        const all = [];
        collect(html, all);
        for (const el of all) if (el.id && !doc._byId.has(el.id)) doc._byId.set(el.id, el);
    };

    doc.getElementById = (id) => doc._byId.get(id) || null;
    doc.querySelector = (sel) => html.querySelector(sel);
    doc.querySelectorAll = (sel) => html.querySelectorAll(sel);
    doc.getElementsByTagName = (tag) => html.getElementsByTagName(tag);
    doc.createElement = (tag) => new Element(tag, doc);
    doc.createTextNode = (t) => new TextNode(t);
    doc.createTreeWalker = () => ({ nextNode: () => null });
    doc.addEventListener = (type, fn) => html.addEventListener(type, fn);
    doc.removeEventListener = (type, fn) => html.removeEventListener(type, fn);
    doc.dispatchEvent = (e) => html.dispatchEvent(e);
    Object.defineProperty(doc, 'activeElement', { get: () => doc._active });
    Object.defineProperty(doc, 'title', {
        get: () => doc._title || '',
        set: (v) => {
            doc._title = v;
        },
    });
    return doc;
}

/* ------------------------------------------------- computed style, faked */

function inlineStyles(el) {
    const out = {};
    const raw = el.getAttribute && el.getAttribute('style');
    if (!raw) return out;
    for (const decl of raw.split(';')) {
        const i = decl.indexOf(':');
        if (i === -1) continue;
        out[decl.slice(0, i).trim().toLowerCase()] = decl.slice(i + 1).trim();
    }
    return out;
}

/**
 * Enough of the cascade to answer the suites' questions: per-tag defaults,
 * inline declarations, and inheritance for the properties that inherit.
 */
export function computedStyleFor(el) {
    const chain = [];
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) chain.unshift(n);

    const style = { ...BASE_STYLE };
    for (const node of chain) {
        const isSelf = node === el;
        const tagDefaults = TAG_DEFAULTS[node.tagName] || {};
        const inline = inlineStyles(node);
        for (const [prop, value] of Object.entries({ ...tagDefaults, ...inline })) {
            if (isSelf || INHERITED.has(prop)) style[prop] = value;
        }
        if (!isSelf) continue;
    }
    if (el.hasAttribute && el.hasAttribute('hidden')) style.display = 'none';

    /*
     * There is no cascade here, so `:focus` rules cannot apply -- but "does
     * focusing this change anything visible" is exactly what one EAA check
     * asks. A fixture declares the focused appearance with
     * data-focus-style="outline: 2px solid blue", applied while this element
     * is the active element.
     */
    const focusStyle = el.getAttribute && el.getAttribute('data-focus-style');
    if (focusStyle && el.ownerDocument && el.ownerDocument.activeElement === el) {
        for (const decl of focusStyle.split(';')) {
            const i = decl.indexOf(':');
            if (i === -1) continue;
            style[decl.slice(0, i).trim().toLowerCase()] = decl.slice(i + 1).trim();
        }
    }

    // Expose both `font-size` and `fontSize`, like a real CSSStyleDeclaration.
    const out = { getPropertyValue: (p) => style[p] ?? '' };
    for (const [prop, value] of Object.entries(style)) {
        out[prop] = value;
        out[CAMEL(prop)] = value;
    }
    return out;
}

/** Wire a parsed document into a page sandbox as `document`/`getComputedStyle`. */
export function installDom(sandbox, html, { width = 1280, height = 800 } = {}) {
    const doc = parseHtml(html);
    doc.defaultView = sandbox;
    sandbox.document = doc;
    sandbox.getComputedStyle = (el) => computedStyleFor(el);
    sandbox.innerWidth = width;
    sandbox.innerHeight = height;
    sandbox.Element = Element;
    sandbox.Node = { ELEMENT_NODE: 1, TEXT_NODE: 3 };
    sandbox.KeyboardEvent = function (type, init) {
        return { type, ...init, bubbles: true };
    };
    return doc;
}

export { Element, TextNode };
