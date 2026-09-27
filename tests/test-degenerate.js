'use strict';
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'ha-lyrics-card.js'), 'utf8');

class El {
  constructor(tag) {
    this.tagName = tag; this.children = []; this.parentNode = null; this._txt = '';
    this.className = ''; this.style = {}; this.dataset = {}; this.scrollTop = 0;
    this.clientHeight = 0; this._hidden = false;
    const self = this;
    this.classList = {
      add: (c) => { if (!self._cls().includes(c)) self.className = (self.className + ' ' + c).trim(); },
      remove: (c) => { self.className = self._cls().filter((x) => x !== c).join(' '); }
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
  set innerHTML(v) { this.children = []; this._txt = ''; parseInto(this, v); }
  get offsetHeight() { return this._cls().includes('l') ? 38 : 0; }
  get offsetTop() {
    let t = 0, n = this.parentNode; if (!n) return 0;
    for (const c of n.children) { if (c === this) break; t += c.offsetHeight; }
    return t;
  }
  scrollTo(o) { this.scrollTop = Math.max(0, o.top); }
}
function parseInto(root, html) {
  const re = /<\/?([a-z0-9]+)([^>]*?)\/?>|([^<]+)/gi; const stack = [root]; let m;
  while ((m = re.exec(html)) !== null) {
    const top = stack[stack.length - 1];
    if (m[3] !== undefined) { const t = m[3].trim(); if (t && top.tagName !== 'style') top._txt += t; continue; }
    if (m[0][1] === '/') { if (stack.length > 1) stack.pop(); continue; }
    const cls = /class="([^"]*)"/.exec(m[2] || '');
    const el = new El(m[1]); if (cls) el.className = cls[1];
    top.appendChild(el); if (!m[0].endsWith('/>')) stack.push(el);
  }
}

const store = new Map();
global.HTMLElement = class { attachShadow() { const r = new El('shadow'); this.root = r; return r; } };
global.document = { createElement: (t) => new El(t), createDocumentFragment: () => new El('#frag') };
global.customElements = { get: () => false, define: (t, c) => { global.Card = c; } };
global.window = { customCards: [], matchMedia: () => ({ matches: false }) };
global.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
global.requestAnimationFrame = (fn) => setTimeout(fn, 0);
global.fetch = () => Promise.resolve({ status: 404, ok: false, headers: { get: () => null }, json: () => Promise.resolve({}) });

eval(src);

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  THROW ' + name + ' -> ' + e.constructor.name + ': ' + e.message); }
}

console.log('\ndegenerate / preview-like environments');

t('setConfig before connect (HA does this)', () => { new global.Card().setConfig({}); });

t('getStubConfig with no hass at all', () => {
  const c = new global.Card();
  const cfg = c.getStubConfig();
  if (!cfg || cfg.type !== 'custom:ha-lyrics-card') throw new Error('bad stub: ' + JSON.stringify(cfg));
});

t('getStubConfig with hass but no states key', () => {
  const c = new global.Card();
  c.hass = {};
  c.setConfig({});
  const cfg = c.getStubConfig();
  if (!cfg || cfg.type !== 'custom:ha-lyrics-card') throw new Error('bad stub');
});

t('hass = {} (no states key) then render', () => {
  const c = new global.Card();
  c.setConfig({});
  c.connectedCallback();
  c.hass = {};
  if (c.el.sub.textContent !== 'No media players found') throw new Error('got: ' + c.el.sub.textContent);
});

t('hass = {states:{}} then render', () => {
  const c = new global.Card();
  c.setConfig({});
  c.connectedCallback();
  c.hass = { states: {} };
  if (c.el.sub.textContent !== 'No media players found') throw new Error('got: ' + c.el.sub.textContent);
});

t('states present but no media_player domain', () => {
  const c = new global.Card();
  c.setConfig({});
  c.connectedCallback();
  c.hass = { states: { 'light.kitchen': { state: 'on', attributes: {} }, 'sensor.temp': { state: '20', attributes: {} } } };
  if (c.el.sub.textContent !== 'No media players found') throw new Error('got: ' + c.el.sub.textContent);
});

t('media_player exists but is idle', () => {
  const c = new global.Card();
  c.setConfig({});
  c.connectedCallback();
  c.hass = { states: { 'media_player.tv': { state: 'off', attributes: { media_title: 'Creep' } } } };
  if (c.el.sub.textContent !== 'Nothing playing') throw new Error('got: ' + c.el.sub.textContent);
});

t('no media_player at all says so explicitly', () => {
  const c = new global.Card();
  c.setConfig({});
  c.connectedCallback();
  c.hass = { states: { 'light.kitchen': { state: 'on', attributes: {} } } };
  if (c.el.sub.textContent !== 'No media players found') throw new Error('got: ' + c.el.sub.textContent);
});

t('media_player present but paused says Nothing playing', () => {
  const c = new global.Card();
  c.setConfig({});
  c.connectedCallback();
  c.hass = { states: { 'media_player.tv': { state: 'paused', attributes: { media_title: 'Creep' } } } };
  if (c.el.sub.textContent !== 'Nothing playing') throw new Error('got: ' + c.el.sub.textContent);
});

t('media_player playing but no media_title', () => {
  const c = new global.Card();
  c.setConfig({});
  c.connectedCallback();
  c.hass = { states: { 'media_player.radio': { state: 'playing', attributes: {} } } };
  if (c.el.sub.textContent !== 'Nothing playing') throw new Error('got: ' + c.el.sub.textContent);
});

t('setConfig twice (picker re-render)', () => {
  const c = new global.Card();
  c.setConfig({}); c.connectedCallback();
  c.hass = { states: {} };
  c.setConfig({ max_lines: 3 });
  if (c.el.stage.style.height !== '114px') throw new Error('height: ' + c.el.stage.style.height);
});

t('connect twice does not re-attach shadow', () => {
  const c = new global.Card();
  c.setConfig({});
  c.connectedCallback();
  const first = c.root;
  c.connectedCallback();
  if (c.root !== first) throw new Error('shadow re-attached');
});

t('entities: [] means ALL players, not none', () => {
  const c = new global.Card();
  c.setConfig({ entities: [] });
  c.connectedCallback();
  c.hass = { states: { 'media_player.tv': { state: 'playing', attributes: { media_title: 'Creep', media_artist: 'Radiohead', media_duration: 239, media_position: 5 } } } };
  if (c._keys.length !== 1) throw new Error('keys: ' + c._keys.length);
});

t('getCardSize before setConfig', () => {
  const s = new global.Card().getCardSize();
  if (!(s >= 2)) throw new Error('size: ' + s);
});

t('customCards metadata registered', () => {
  const e = (global.window.customCards || [])[0];
  if (!e || e.type !== 'ha-lyrics-card') throw new Error('not registered');
  if (typeof e.name !== 'string' || !e.name) throw new Error('no name');
});

console.log('\nresult: ' + pass + ' passed, ' + fail + ' threw\n');
process.exit(fail ? 1 : 0);
