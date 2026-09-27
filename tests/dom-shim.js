'use strict';
// Minimal DOM shim shared by the card test suites: custom elements, shadow
// roots, class/style/attribute plumbing and a forgiving HTML parser.

function camel(s) { return String(s).replace(/-([a-z])/g, (_, c) => c.toUpperCase()); }

class Style {
  constructor() { Object.defineProperty(this, '_v', { value: new Map(), enumerable: false }); }
  setProperty(k, v) { this._v.set(k, String(v)); this[camel(k)] = String(v); }
  removeProperty(k) { this._v.delete(k); delete this[camel(k)]; }
  getPropertyValue(k) { const v = this._v.get(k); return v === undefined ? '' : v; }
}

class El {
  constructor(tag) {
    this.tagName = tag; this.children = []; this.parentNode = null; this._txt = '';
    this.className = ''; this.style = new Style(); this.dataset = {};
    this.scrollTop = 0; this.clientHeight = 0; this._hidden = false;
    const self = this;
    this.classList = {
      add: (c) => { if (!self._cls().includes(c)) self.className = (self.className + ' ' + c).trim(); },
      remove: (c) => { self.className = self._cls().filter((x) => x !== c).join(' '); },
      toggle: (c, force) => {
        const on = force === undefined ? !self._cls().includes(c) : !!force;
        if (on) self.classList.add(c); else self.classList.remove(c);
        return on;
      },
      contains: (c) => self._cls().includes(c)
    };
  }
  _cls() { return String(this.className).split(/\s+/).filter(Boolean); }
  get hidden() { return this._hidden; }
  set hidden(v) { this._hidden = !!v; }
  get textContent() { return this._txt + this.children.map((c) => c.textContent).join(''); }
  set textContent(v) { this._txt = String(v); this.children = []; }
  appendChild(c) { c.parentNode = this; this.children.push(c); this._txt = ''; return c; }
  _walk(fn) { for (const c of this.children) if (c instanceof El) { fn(c); c._walk(fn); } }
  _matches(sel) {
    if (sel[0] === '.') return this._cls().includes(sel.slice(1));
    if (sel[0] === '[') return sel.includes('data-act') ? this.dataset.act !== undefined : true;
    return this.tagName === sel;
  }
  querySelector(sel) {
    const parts = sel.trim().split(/\s+/); let found = null;
    this._walk((c) => { if (!found && c._matches(parts[parts.length - 1])) found = c; });
    return found;
  }
  closest(sel) { let n = this; while (n) { if (n._matches && n._matches(sel)) return n; n = n.parentNode; } return null; }
  addEventListener() {}
  setAttribute(n, v) { if (n === 'src') this.src = v; }
  getAttribute(n) { return n === 'src' ? this.src : undefined; }
  removeAttribute(n) { if (n === 'src') delete this.src; }
  set innerHTML(v) { this.children = []; this._txt = ''; parseInto(this, v); }
  get offsetHeight() { return this._cls().includes('l') ? 38 : 0; }
  get offsetTop() {
    let t = 0; const n = this.parentNode; if (!n) return 0;
    for (const c of n.children) { if (c === this) break; t += c.offsetHeight; }
    return t;
  }
  scrollTo(o) { this.scrollTop = Math.max(0, o.top); }
}

const VOID = new Set(['img', 'br', 'hr', 'input', 'meta', 'link', 'source']);

function parseInto(root, html) {
  const re = /<\/?([a-z0-9-]+)([^>]*?)\/?>|([^<]+)/gi;
  const stack = [root];
  let m;
  while ((m = re.exec(html)) !== null) {
    const top = stack[stack.length - 1];
    if (m[3] !== undefined) { const t = m[3].trim(); if (t && top.tagName !== 'style') top._txt += t; continue; }
    if (m[0][1] === '/') { if (stack.length > 1) stack.pop(); continue; }
    const cls = /class="([^"]*)"/.exec(m[2] || '');
    const el = new El(m[1]);
    if (cls) el.className = cls[1];
    top.appendChild(el);
    if (!m[0].endsWith('/>') && !VOID.has(m[1].toLowerCase())) stack.push(el);
  }
}

// Installs the globals the card expects. Returns the localStorage backing map.
function install() {
  const store = new Map();
  global.HTMLElement = class {
    constructor() { this.style = new Style(); }
    attachShadow() { const r = new El('shadow'); this.root = r; return r; }
  };
  global.document = {
    createElement: (t) => new El(t),
    createDocumentFragment: () => new El('#frag')
  };
  global.customElements = { get: () => false, define: (t, c) => { global.Card = c; } };
  global.window = { customCards: [], matchMedia: () => ({ matches: false }) };
  global.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k)
  };
  global.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  // WebSocket stand-in for the Music Assistant path. A test sets
  // global.__maHandler = (msg) => reply, where reply is the object to send back
  // (return undefined to stay silent, e.g. to simulate a dropped connection).
  // Every socket built is pushed to global.__maSockets for assertions.
  global.__maSockets = [];
  global.WebSocket = class {
    constructor(url) {
      this.url = url;
      this.closed = false;
      this.sent = [];
      global.__maSockets.push(this);
      setTimeout(() => { if (!this.closed && this.onopen) this.onopen(); }, 0);
    }
    send(raw) {
      let msg;
      try { msg = JSON.parse(raw); } catch (e) { return; }
      this.sent.push(msg);
      const reply = global.__maHandler ? global.__maHandler(msg, this) : undefined;
      if (reply === undefined) return;
      setTimeout(() => {
        if (this.closed || !this.onmessage) return;
        this.onmessage({ data: JSON.stringify(reply) });
      }, 0);
    }
    close() {
      if (this.closed) return;
      this.closed = true;
      if (this.onclose) this.onclose();
    }
  };
  return store;
}

module.exports = { El, Style, parseInto, install };
