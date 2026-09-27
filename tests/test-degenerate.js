'use strict';
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'ha-lyrics-card.js'), 'utf8');

const { El, install } = require('./dom-shim');
const store = install();
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
