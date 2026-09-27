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
    this.scrollTop = 0; this.clientHeight = 0; this.scrollHeight = 0; this._hidden = false;
    this._handlers = {};
    this.addEventListener = function (type, fn) {
      (self._handlers[type] = self._handlers[type] || []).push(fn);
    };
    this.removeEventListener = function (type, fn) {
      if (!self._handlers[type]) return;
      self._handlers[type] = self._handlers[type].filter((f) => f !== fn);
    };
    this.dispatchEvent = function (ev) {
      const l = self._handlers[ev && ev.type] || [];
      for (let i = 0; i < l.length; i++) l[i](ev);
      return true;
    };
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
  global.window = { customCards: [], matchMedia: () => ({ matches: global.__reducedMotion === true }) };
  global.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k)
  };
  // requestAnimationFrame.
//
// Frames are queued and drained on a later turn so async continuations still
// work, but the clock is virtual (__frameTime) and the queue is budgeted.
// Both matter: the unsynced-lyrics marquee re-queues a frame from inside its
// own callback, and against a real clock that would spin forever and hang the
// test process. A real browser stops firing rAF for a background tab, so
// spending the budget and dropping the queue is a faithful stand-in, not a
// fudge. Tests opt in to more frames with __resetFrames(n) and drive the clock
// with __advanceFrames(ms).
let _frameId = 0;
let _budget = 40;
let _queue = [];
let _scheduled = false;

function _flushFrames() {
  if (_budget-- <= 0) { _queue = []; return; }
  const batch = _queue;
  _queue = [];
  for (let i = 0; i < batch.length; i++) { global.__frames++; batch[i].fn(global.__frameTime); }
  if (_queue.length) setTimeout(_flushFrames, 0);
}

global.__frameTime = 0;
global.__frames = 0;
global.__resetFrames = function (n) { _budget = n == null ? 40 : n; _queue = []; global.__frames = 0; };
global.__advanceFrames = function (ms) {
  global.__frameTime += ms;
  return new Promise(function (r) { setTimeout(r, 0); });
};

global.requestAnimationFrame = function (fn) {
  const id = ++_frameId;
  _queue.push({ id: id, fn: fn });
  if (!_scheduled) {
    _scheduled = true;
    setTimeout(function () { _scheduled = false; _flushFrames(); }, 0);
  }
  return id;
};
global.cancelAnimationFrame = function (id) {
  _queue = _queue.filter(function (f) { return f.id !== id; });
};
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
