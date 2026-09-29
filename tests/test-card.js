'use strict';
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'ha-lyrics-card.js'), 'utf8');

let pass = 0;
let fail = 0;
function eq(name, got, want) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n       got  ' + g + '\n       want ' + w); }
}

const { El, install } = require('./dom-shim');
const cache = install();

eval(src);

const F = {
  PAUSE: 2, SEEK: 4, VOLUME_SET: 16, VOLUME_MUTE: 32, PREV: 64, NEXT: 128,
  TURN_ON: 256, TURN_OFF: 512, VOLUME_STEP: 2048
};

const CREEP = {
  id: 1, trackName: 'Creep', artistName: 'Radiohead', albumName: 'Pablo Honey',
  duration: 239, instrumental: false,
  plainLyrics: 'When you were here before\nCouldnt look you in the eye\nYoure just like an angel\nYour skin makes me cry',
  syncedLyrics: '[00:19.16] When you were here before\n[00:24.09] Couldnt look you in the eye\n[00:29.24] Youre just like an angel\n[00:34.49] Your skin makes me cry'
};
const GETLUCKY = {
  id: 2, trackName: 'Get Lucky', artistName: 'Daft Punk', albumName: 'Random Access Memories',
  duration: 248, instrumental: false, plainLyrics: '',
  syncedLyrics: '[00:15.24] Like the legend of the phoenix\n[00:21.00] All ends with beginnings\n[00:27.10] Keep on going dont stop'
};
const INSTRU = { id: 3, trackName: 'Weightless', artistName: 'Marconi Union', duration: 480, instrumental: true };

function fakeFetch(table) {
  return (url) => {
    const dec = decodeURIComponent(String(url).replace(/\+/g, ' '));
    const hit = table.find((r) => Object.keys(r[0]).every((k) => dec.includes(r[0][k])));
    const body = hit ? JSON.stringify(hit[1]) : '[]';
    const status = hit ? 200 : 404;
    return Promise.resolve({
      status,
      ok: status < 400,
      headers: { get: () => null },
      json: () => Promise.resolve(JSON.parse(body))
    });
  };
}

function mkState(o) {
  return { state: o.state || 'playing', attributes: o };
}
function player(entity, title, artist, album, duration, position, state) {
  return mkState({
    friendly_name: entity.split('.')[1].replace(/_/g, ' '),
    media_title: title, media_artist: artist, media_album: album,
    media_duration: duration, media_position: position,
    ...(state ? { state } : {})
  });
}
function hass(states, callService) {
  return { states: states || {}, callService: callService || (() => {}) };
}

function makeCard(cfg, table) {
  global.fetch = fakeFetch(table);
  const c = new global.Card();
  c.setConfig(cfg);
  c.connectedCallback();
  return c;
}

const flush = () => new Promise((r) => setTimeout(r, 30));

function findBtn(c, act) {
  let found = null;
  c.el.controls._walk((n) => { if (!found && n._matches('[data-c="' + act + '"]')) found = n; });
  return found;
}
function findVolInput(c) {
  let el = null;
  c.el.controls._walk((n) => { if (!el && n.tagName === 'input') el = n; });
  return el;
}

(async () => {
  console.log('\ngrouping / dedupe');

  let c = makeCard({}, [[{ track_name: 'Creep' }, CREEP]]);
  c.hass = hass({
    'media_player.spotify': player('media_player.spotify', 'Creep', 'Radiohead', 'Pablo Honey', 239, 20),
    'media_player.tv': player('media_player.tv', 'Creep', 'Radiohead', 'Pablo Honey', 239, 21)
  });
  await flush();

  eq('same song on 2 players -> 1 group', c._keys.length, 1);
  eq('dedupe recorded both entities', c._tracks[0].all.length, 2);
  eq('dots hidden for single track', c.el.dots.style.display, 'none');
  eq('header shows +1', c.el.sub.textContent, 'Radiohead \u00b7 spotify +1');
  eq('4 lines rendered', c.lineEls.length, 4);

  console.log('\nline sync');
  eq('active line at t=20', c.lineEls[c.active].textContent, 'When you were here before');
  c.hass = hass({ 'media_player.spotify': player('media_player.spotify', 'Creep', 'Radiohead', 'Pablo Honey', 239, 30) });
  eq('active line at t=30', c.lineEls[c.active].textContent, 'Youre just like an angel');
  const allLines = []; c.el.lines._walk((n) => allLines.push(n));
  eq('only one .on class', allLines.filter((n) => String(n.className).includes('on')).length, 1);
  eq('scrolled to active', c.el.stage.scrollTop > 0, true);

  console.log('\nposition interpolation');
  const p0 = c._position();
  await new Promise((r) => setTimeout(r, 260));
  const p1 = c._position();
  eq('clock advances between updates', p1 - p0 > 0.15 && p1 - p0 < 0.5, true);
  c.hass = hass({ 'media_player.spotify': player('media_player.spotify', 'Creep', 'Radiohead', 'Pablo Honey', 239, 30, 'paused') });
  const a = c._position();
  await new Promise((r) => setTimeout(r, 200));
  eq('frozen while paused', Math.abs(c._position() - a) < 0.01, true);

  console.log('\nmultiple tracks / swipe');
  c = makeCard({}, [
    [{ track_name: 'Creep' }, CREEP],
    [{ track_name: 'Get Lucky' }, GETLUCKY]
  ]);
  c.hass = hass({
    'media_player.spotify': player('media_player.spotify', 'Creep', 'Radiohead', 'Pablo Honey', 239, 20),
    'media_player.tv': player('media_player.tv', 'Get Lucky', 'Daft Punk', 'Random Access Memories', 248, 30)
  });
  await flush();

  eq('two distinct songs -> 2 groups', c._keys.length, 2);
  eq('dots visible', c.el.dots.style.display, '');
  eq('2 dots drawn', c.el.dots.children.length, 2);
  eq('dot 0 active', c.el.dots.children[0].className, 'dot on');
  eq('starts on first track', c._tracks[c.idx].title, 'Creep');

  c.el.pane.dispatchEvent = () => {};
  c._onDown({ button: 0, clientX: 200, clientY: 100, pointerId: 1, target: c.el.lines });
  c._onMove({ clientX: 60, clientY: 102, pointerId: 1 });
  eq('drag applies transform', c.el.pane.style.transform, 'translateX(-91px)');
  c._onUp({ clientX: 40, clientY: 102, pointerId: 1 });
  eq('swipe advanced index', c.idx, 1);
  eq('now on Get Lucky', c._tracks[c.idx].title, 'Get Lucky');
  await new Promise((r) => setTimeout(r, 60));
  eq('transform cleared', c.el.pane.style.transform, '');
  eq('Get Lucky lines', c.lineEls.length, 3);

  c._onDown({ button: 0, clientX: 60, clientY: 100, pointerId: 2, target: c.el.lines });
  c._onMove({ clientX: 200, clientY: 101, pointerId: 2 });
  c._onUp({ clientX: 220, clientY: 101, pointerId: 2 });
  eq('swipe back', c.idx, 0);

  console.log('\nvertical scroll does not switch track');
  c._onDown({ button: 0, clientX: 200, clientY: 100, pointerId: 3, target: c.el.lines });
  c._onMove({ clientX: 203, clientY: 160, pointerId: 3 });
  c._onUp({ clientX: 203, clientY: 170, pointerId: 3 });
  eq('index unchanged on vertical drag', c.idx, 0);

  console.log('\ntap advances');
  c._onDown({ button: 0, clientX: 200, clientY: 100, pointerId: 4, target: c.el.lines });
  c._onUp({ clientX: 200, clientY: 100, pointerId: 4 });
  eq('tap -> next track', c.idx, 1);

  console.log('\nintro splash');
  c = makeCard({}, [[{ track_name: 'Creep' }, CREEP]]);
  c.hass = hass({ 'media_player.spotify': player('media_player.spotify', 'Creep', 'Radiohead', 'Pablo Honey', 239, 2) });
  await flush();
  eq('intro splash shows before first line', c.el.splash.classList.contains('on'), true);
  eq('wrap gets intro class', c.el.wrap.classList.contains('intro-on'), true);
  c.hass = hass({ 'media_player.spotify': player('media_player.spotify', 'Creep', 'Radiohead', 'Pablo Honey', 239, 25) });
  await flush();
  eq('intro clears after first line', c.el.splash.classList.contains('on'), false);
  c = makeCard({ show_intro: false }, [[{ track_name: 'Creep' }, CREEP]]);
  c.hass = hass({ 'media_player.spotify': player('media_player.spotify', 'Creep', 'Radiohead', 'Pablo Honey', 239, 0) });
  await flush();
  eq('show_intro false hides splash', c.el.splash.classList.contains('on'), false);

  console.log('\ninstrumental + not found');
  c = makeCard({}, [[{ track_name: 'Weightless' }, INSTRU]]);
  c.hass = hass({ 'media_player.radio': player('media_player.radio', 'Weightless', 'Marconi Union', '', 480, 10) });
  await flush();
  eq('instrumental shown', c.el.lines.textContent, '\u266a  Instrumental');
  eq('instrumental status noted', c.el.status.textContent, 'Instrumental');

  c = makeCard({}, []);
  c.hass = hass({ 'media_player.radio': player('media_player.radio', 'zz unknown tune 991', 'nobody', '', 200, 5) });
  await flush();
  eq('no lyrics message', c.el.lines.textContent, 'No lyrics found');

  console.log('\npaused player stays on screen');
  c.hass = hass({ 'media_player.radio': player('media_player.radio', 'zz unknown tune 991', 'nobody', '', 200, 5, 'paused') });
  await flush();
  eq('paused player still collected', c._tracks.length, 1);
  eq('paused player page shown', c.el.title.textContent, 'zz unknown tune 991');

  console.log('\nplain (unsynced) lyrics');

  const PLAIN = {
    id: 9, trackName: 'Pale', artistName: 'Sneaker Pimps', albumName: 'Bloodsport',
    duration: 244, instrumental: false,
    plainLyrics: 'You are the finest thing I have ever seen\nI love you when you sleep\nYou are the finest thing\nAnd you are always here'
  };
  const plainTable = [[{ track_name: 'Pale' }, PLAIN]];
  const plainState = (pos, state) => hass({
    'media_player.pale': player('media_player.pale', 'Pale', 'Sneaker Pimps', 'Bloodsport', 244, pos || 0, state)
  });
  const sizeStage = (card, viewH, contentH) => {
    card.el.stage.clientHeight = viewH;
    card.el.stage.scrollHeight = contentH;
  };

  global.__resetFrames(4000);
  let sc = makeCard({}, plainTable);
  sc.hass = plainState();
  await flush();
  eq('plain lyrics are static kind', sc.data.kind, 'static');
  eq('lines get the static class', /(^|\s)static(\s|$)/.test(sc.el.lines.className), true);
  eq('plain block rendered', !!sc.el.lines.querySelector('.plain'), true);
  eq('plain auto-scroll on by default', sc._plainAuto(), true);
  eq('default static font size', sc.config.static_font_size, 18);
  eq('default static scroll speed', sc.config.static_scroll_speed, 14);
  eq('static scroll on by default', sc.config.static_scroll, true);
  eq('css var published', sc.style.getPropertyValue('--static-size'), '18px');
  eq('padding measured against small line box', parseInt(sc.el.lines.style.paddingTop, 10),
    Math.max(0, Math.round((7 * 38 - Math.round(18 * 1.6)) / 2)));

  // Plain lyrics scroll to match playback position when durations are known.
  sizeStage(sc, 200, 1000);
  sc.el.stage.scrollTop = 0;
  sc.hass = plainState(122, 'paused');
  await sc._update();
  sc._marqueeStep(100000);
  eq('plain auto-scroll maps position to scroll', Math.round(sc.el.stage.scrollTop), 400);
  sc.hass = plainState(61, 'paused');
  sc._marqueeStep(101000);
  eq('plain auto-scroll tracks half position', Math.round(sc.el.stage.scrollTop), 200);

  console.log('\nmarquee: plain lyrics with auto-scroll off');
  sc = makeCard({ plain_lyrics_auto_scroll: false }, plainTable);
  sc.hass = plainState();
  await flush();
  eq('plain auto-scroll disabled', sc._plainAuto(), false);
  eq('marquee drift armed', sc._driftOn(), true);
  sizeStage(sc, 200, 1000);

  let _t = 100000;
  const step = (card, dtMs) => {
    const m = card._marq;
    m.started = true; m.last = _t; m.hold = 0; m.until = 0;
    _t += dtMs;
    card._marqueeStep(_t);
  };
  const run = (card, seconds) => {
    for (let i = 0; i < Math.round(seconds * 60); i++) step(card, 1000 / 60);
  };
  const stepRaw = (card, dtMs) => {
    const m = card._marq;
    m.started = true; m.last = _t;
    _t += dtMs;
    card._marqueeStep(_t);
  };
  const runRaw = (card, seconds) => {
    for (let i = 0; i < Math.round(seconds * 60); i++) stepRaw(card, 1000 / 60);
  };

  await run(sc, 1);
  eq('drifts at the configured speed', Math.round(sc.el.stage.scrollTop), 14);

  // Big jumps are clamped so a backgrounded tab does not teleport the block.
  sc._marq.hold = 0;
  sc._marq.until = 0;
  sc._marq.pos = 0;
  sc.el.stage.scrollTop = 0;
  step(sc, 2000);
  eq('a stalled tab resumes slowly instead of jumping', sc.el.stage.scrollTop, 3.5);

  // Reaching the end rests, then loops back to the top.
  sc.config.static_scroll_speed = 200;
  sc._marq.started = false;
  sc._marq.hold = 0;
  sc._marq.until = 0;
  sc._marq.pos = 0;
  sc.el.stage.scrollTop = 0;
  runRaw(sc, 4.2);
  eq('reaches the end of the content', sc.el.stage.scrollTop, 800);
  eq('hold armed at the end', sc._marq.hold > 0, true);
  runRaw(sc, 1);
  eq('still resting on the last line', sc.el.stage.scrollTop, 800);
  runRaw(sc, 1.5);
  eq('loops back to the top', sc.el.stage.scrollTop, 0);
  eq('lingers before drifting off again', sc._marq.hold > 0, true);
  sc.config.static_scroll_speed = 14;

  // Sub-pixel drift must still accumulate (offset tracked in JS, like a real
  // browser snapping scroll offsets to whole device pixels).
  let snap = makeCard({ plain_lyrics_auto_scroll: false }, plainTable);
  snap.hass = plainState();
  await flush();
  sizeStage(snap, 200, 1000);
  Object.defineProperty(snap.el.stage, 'scrollTop', {
    get() { return Math.round(this._v || 0); },
    set(v) { this._v = v; },
    configurable: true
  });
  for (let i = 0; i < 60; i++) step(snap, 1000 / 60);
  eq('sub-pixel drift accumulates past zero', Math.round(snap.el.stage.scrollTop), 14);
  snap.disconnectedCallback();

  // _scrollTo must not drag the block back to an active line.
  const scrollCalls = [];
  const realScroll = sc.el.stage.scrollTo;
  sc.el.stage.scrollTo = function (o) { scrollCalls.push(o); return realScroll.call(this, o); };
  sc._update(true);
  eq('no snap-to-line scroll while drifting', scrollCalls.length, 0);
  sc.el.stage.scrollTo = realScroll;

  // A manual scroll parks it until the interaction window lapses.
  sc._marq.hold = 0;
  sc._marq.until = 0;
  sc._marq.started = true;
  sc._marq.last = _t;
  sc.el.stage.scrollTop = 100;
  sc.el.stage.dispatchEvent({ type: 'wheel' });
  eq('interaction window recorded', sc._marq.until > 0, true);
  for (let i = 0; i < 120; i++) {
    sc._marq.started = true; sc._marq.last = _t; sc._marq.hold = 0;
    _t += 1000 / 60;
    sc._marqueeStep(_t);
  }
  eq('manual scroll pauses the drift', sc.el.stage.scrollTop, 100);
  sc._marq.until = Date.now() - 1;
  const resumeFrom = sc.el.stage.scrollTop;
  sc._marq.started = true;
  sc._marq.last = _t;
  sc._marq.hold = 0;
  _t += 1000;
  sc._marqueeStep(_t);
  eq('resumes from the parked position', sc.el.stage.scrollTop, resumeFrom + 3.5);
  sc._marq.until = 0;

  // Opting out of the drift stops all automatic scrolling.
  let noScroll = makeCard({ static_scroll: false }, plainTable);
  noScroll.hass = plainState();
  await flush();
  eq('drift off when static_scroll false', noScroll._driftOn(), false);
  noScroll._marqueeStop();
  noScroll._marqueeSync();
  eq('no frame armed when disabled', noScroll._raf || 0, 0);

  // Synced lyrics must never drift.
  let sy = makeCard({}, [[{ track_name: 'Creep' }, CREEP]]);
  sy.hass = hass({
    'media_player.spotify': player('media_player.spotify', 'Creep', 'Radiohead', 'Pablo Honey', 239, 20)
  });
  await flush();
  eq('synced lyrics are synced kind', sy.data.kind, 'synced');
  eq('no static class on synced lyrics', /(^|\s)static(\s|$)/.test(sy.el.lines.className), false);
  eq('marquee never runs on synced lyrics', sy._driftOn(), false);

  // Reduced motion: leave the block centred and let the reader scroll.
  global.__reducedMotion = true;
  let rm = makeCard({ plain_lyrics_auto_scroll: false }, plainTable);
  rm.hass = plainState();
  await flush();
  sizeStage(rm, 200, 1000);
  for (let i = 0; i < 120; i++) rm._marqueeStep((_t += 1000 / 60));
  eq('reduced motion disables the drift', rm.el.stage.scrollTop, 0);
  eq('no frame armed under reduced motion', rm._raf || 0, 0);
  global.__reducedMotion = false;

  // Custom sizing, and the clamps.
  let tuned = makeCard({ static_font_size: 26, static_scroll_speed: 40, plain_lyrics_auto_scroll: false }, plainTable);
  tuned.hass = plainState();
  await flush();
  eq('custom static size honoured', tuned.style.getPropertyValue('--static-size'), '26px');
  sizeStage(tuned, 200, 4000);
  await run(tuned, 1);
  eq('custom speed honoured', Math.round(tuned.el.stage.scrollTop), 40);
  eq('font size clamped high', makeCard({ static_font_size: 999 }, []).config.static_font_size, 48);
  eq('font size clamped low', makeCard({ static_font_size: 1 }, []).config.static_font_size, 10);
  eq('speed clamped high', makeCard({ static_scroll_speed: 5000 }, []).config.static_scroll_speed, 60);
  eq('speed clamped low', makeCard({ static_scroll_speed: 0 }, []).config.static_scroll_speed, 4);

  tuned.disconnectedCallback();
  eq('disconnect cancels the frame', tuned._raf, 0);
  tuned.connectedCallback();
  tuned.disconnectedCallback();
  global.__resetFrames();

  console.log('\nentity allowlist');
  c = makeCard({ entities: ['media_player.tv'] }, [
    [{ track_name: 'Creep' }, CREEP],
    [{ track_name: 'Get Lucky' }, GETLUCKY]
  ]);
  c.hass = hass({
    'media_player.spotify': player('media_player.spotify', 'Creep', 'Radiohead', 'Pablo Honey', 239, 20),
    'media_player.tv': player('media_player.tv', 'Get Lucky', 'Daft Punk', 'RAM', 248, 30)
  });
  await flush();
  eq('only allowlisted player', c._keys.length, 1);
  eq('allowlisted track', c._tracks[0].title, 'Get Lucky');

  c = makeCard({ entities: 'media_player.spotify' }, [[{ track_name: 'Creep' }, CREEP]]);
  c.hass = hass({
    'media_player.spotify': player('media_player.spotify', 'Creep', 'Radiohead', 'Pablo Honey', 239, 20)
  });
  await flush();
  eq('entities as single string works', c._keys.length, 1);

  console.log('\nlayout options');
  cache.clear();
  c = makeCard({ max_lines: 7, line_height: 38 }, [[{ track_name: 'Creep' }, CREEP]]);
  c.hass = hass({ 'media_player.spotify': player('media_player.spotify', 'Creep', 'Radiohead', 'Pablo Honey', 239, 20) });
  await flush();
  eq('stage height from max_lines', c.el.stage.style.height, '266px');
  eq('lines padded so line 1 can centre', c.el.lines.style.paddingTop, '114px');
  eq('bottom padding matches', c.el.lines.style.paddingBottom, '114px');
  eq('default align var', c.style.getPropertyValue('--al'), 'center');

  c = makeCard({ height: 420 }, [[{ track_name: 'Creep' }, CREEP]]);
  c.hass = hass({ 'media_player.spotify': player('media_player.spotify', 'Creep', 'Radiohead', 'Pablo Honey', 239, 20) });
  await flush();
  eq('explicit height fixes the card', c.el.card.style.height, '420px');
  eq('fixed class applied', c.el.card.classList.contains('fixed'), true);
  eq('getCardSize follows height', c.getCardSize(), 10);

  c = makeCard({ card_height: '300px' }, [[{ track_name: 'Creep' }, CREEP]]);
  c.hass = hass({ 'media_player.spotify': player('media_player.spotify', 'Creep', 'Radiohead', 'Pablo Honey', 239, 20) });
  await flush();
  eq('card_height accepted as css string', c.el.card.style.height, '300px');

  c = makeCard({ align: 'left' }, [[{ track_name: 'Creep' }, CREEP]]);
  c.hass = hass({ 'media_player.spotify': player('media_player.spotify', 'Creep', 'Radiohead', 'Pablo Honey', 239, 20) });
  await flush();
  eq('align alias maps to alignment', c.config.alignment, 'left');
  eq('alignment var applied', c.style.getPropertyValue('--al'), 'left');
  eq('nonsense align falls back to center', makeCard({ align: 'sideways' }).config.alignment, 'center');

  console.log('\nfixed layouts');
  cache.clear();
  c = makeCard({ layout: 'two_line' }, [[{ track_name: 'Creep' }, CREEP]]);
  c.hass = hass({ 'media_player.spotify': player('media_player.spotify', 'Creep', 'Radiohead', 'Pablo Honey', 239, 30) });
  await flush();
  eq('two_line shows active + next', c.lineEls.length, 2);
  eq('two_line window begins active', c.lineEls[0].textContent, 'Youre just like an angel');
  eq('two_line next marked', /(^|\s)next(\s|$)/.test(c.lineEls[1].className), true);
  eq('two_line stage wraps 2 lines', c.el.stage.style.height, '76px');
  eq('fixed layout class', c.el.lines.classList.contains('fixed'), true);

  c = makeCard({ layout: 'compact' }, [[{ track_name: 'Creep' }, CREEP]]);
  c.hass = hass({ 'media_player.spotify': player('media_player.spotify', 'Creep', 'Radiohead', 'Pablo Honey', 239, 30) });
  await flush();
  eq('compact shows one line', c.lineEls.length, 1);
  eq('compact active line', c.lineEls[0].textContent, 'Youre just like an angel');

  c = makeCard({ layout: 'minimal' }, [[{ track_name: 'Creep' }, CREEP]]);
  c.hass = hass({ 'media_player.spotify': player('media_player.spotify', 'Creep', 'Radiohead', 'Pablo Honey', 239, 30) });
  await flush();
  eq('minimal hides header', c.el.head.hidden, true);
  eq('minimal hides dots', c.el.dots.style.display, 'none');

  c = makeCard({ layout: 'karaoke' }, [[{ track_name: 'Creep' }, CREEP]]);
  c.hass = hass({ 'media_player.spotify': player('media_player.spotify', 'Creep', 'Radiohead', 'Pablo Honey', 239, 30) });
  await flush();
  eq('karaoke class applied', c.el.lines.classList.contains('karaoke'), true);
  eq('karaoke header kept', c.el.head.hidden, false);

  console.log('\nheader / text options');
  c = makeCard({ show_header: false }, [[{ track_name: 'Creep' }, CREEP]]);
  c.hass = hass({ 'media_player.spotify': player('media_player.spotify', 'Creep', 'Radiohead', 'Pablo Honey', 239, 20) });
  await flush();
  eq('show_header false hides header', c.el.head.hidden, true);

  c = makeCard({ show_friendly_name: false }, [[{ track_name: 'Creep' }, CREEP]]);
  c.hass = hass({ 'media_player.spotify': player('media_player.spotify', 'Creep', 'Radiohead', 'Pablo Honey', 239, 20) });
  await flush();
  eq('artist only, no friendly name', c.el.sub.textContent, 'Radiohead');

  c = makeCard({ show_track_info: false }, [[{ track_name: 'Creep' }, CREEP]]);
  c.hass = hass({ 'media_player.spotify': player('media_player.spotify', 'Creep', 'Radiohead', 'Pablo Honey', 239, 20) });
  await flush();
  eq('show_track_info false hides info row', c.el.who.hidden, true);

  console.log('\nbackground tuning (legacy aliases)');
  c = makeCard({ background_blur: 30, background_dim: 0.2, background_veil: 0.8, art_size: 64 },
    [[{ track_name: 'Creep' }, CREEP]]);
  c.hass = hass({ 'media_player.spotify': player('media_player.spotify', 'Creep', 'Radiohead', 'Pablo Honey', 239, 20) });
  await flush();
  eq('legacy blur maps to artwork_blur', c.config.artwork_blur, 30);
  eq('blur var', c.style.getPropertyValue('--bg-blur'), '30px');
  eq('dim var', c.style.getPropertyValue('--bg-dim'), '0.2');
  eq('veil var', c.style.getPropertyValue('--bg-veil'), '0.8');
  eq('art size var', c.style.getPropertyValue('--art-size'), '64px');

  console.log('\nclamps');
  eq('blur clamped to max', makeCard({ background_blur: 9999 }).config.artwork_blur, 80);
  eq('dim clamped to 0..1', makeCard({ background_dim: 5 }).config.artwork_opacity, 1);
  eq('font_size clamped', makeCard({ font_size: 9999 }).config.font_size, 120);
  eq('font_size floor', makeCard({ font_size: -5 }).config.font_size, 8);
  eq('bad numeric falls back to default', makeCard({ font_size: 'big' }).config.font_size, 26);
  eq('entities coerced to array', JSON.stringify(makeCard({ entities: 'media_player.tv' }).config.entities),
    JSON.stringify(['media_player.tv']));

  console.log('\ncolours');
  c = makeCard({ text_color: '#ff0000', highlight_color: '#00ff00' }, [[{ track_name: 'Creep' }, CREEP]]);
  c.hass = hass({ 'media_player.spotify': player('media_player.spotify', 'Creep', 'Radiohead', 'Pablo Honey', 239, 20) });
  await flush();
  eq('text_color applied', c.el.card.style.getPropertyValue('--ha-lyrics-secondary'), '#ff0000');
  eq('highlight_color applied', c.el.card.style.getPropertyValue('--ha-lyrics-primary'), '#00ff00');
  eq('invalid hex ignored', makeCard({ text_color: 'red; background:url(x)' }).config.text_color, '');
  eq('valid 3-digit hex kept', makeCard({ text_color: '#abc' }).config.text_color, '#abc');

  console.log('\nalbum art');
  const withArt = (cfg) => {
    const card = makeCard(cfg || {}, [[{ track_name: 'Creep' }, CREEP]]);
    const st = player('media_player.spotify', 'Creep', 'Radiohead', 'Pablo Honey', 239, 20);
    st.attributes.entity_picture = '/api/media_player_proxy/x/cover.jpg';
    card.hass = hass({ 'media_player.spotify': st });
    return card;
  };
  c = withArt();
  await flush();
  eq('art visible when picture present', c.el.art.hidden, false);
  eq('art src set', c.el.artImg.src, '/api/media_player_proxy/x/cover.jpg');
  eq('blurred bg set', c.el.bg.style.backgroundImage.indexOf('cover.jpg') > -1, true);
  eq('bg layer unhidden', c.el.bg.hidden, false);
  eq('ha-card gets has-bg', c.el.card.classList.contains('has-bg'), true);

  c = withArt({ show_album_art: false });
  await flush();
  eq('show_album_art false hides art', c.el.art.hidden, true);
  eq('show_album_art false hides bg', c.el.bg.hidden, true);
  eq('has-bg cleared', c.el.card.classList.contains('has-bg'), false);

  c = makeCard({}, [[{ track_name: 'Creep' }, CREEP]]);
  c.hass = hass({ 'media_player.spotify': player('media_player.spotify', 'Creep', 'Radiohead', 'Pablo Honey', 239, 20) });
  await flush();
  eq('no picture -> no art', c.el.art.hidden, true);

  const jsArt = (url) => {
    const card = makeCard({}, [[{ track_name: 'Creep' }, CREEP]]);
    const st = player('media_player.spotify', 'Creep', 'Radiohead', 'Pablo Honey', 239, 20);
    st.attributes.entity_picture = url;
    card.hass = hass({ 'media_player.spotify': st });
    return card._tracks[0].art;
  };
  eq('javascript: art url rejected', jsArt('javascript:alert(1)'), '');
  eq('data: art url rejected', jsArt('data:text/html,<script>'), '');
  eq('relative art url accepted', jsArt('/local/cover.png'), '/local/cover.png');
  eq('https art url accepted', jsArt('https://i.example/c.jpg'), 'https://i.example/c.jpg');

  console.log('\nplayer controls');

  const ctrlState = (p, extra) => {
    const st = player('media_player.spotify', 'Creep', 'Radiohead', 'Pablo Honey', 239, 20);
    st.attributes.volume_level = 0.7;
    st.attributes.is_volume_muted = false;
    st.attributes.supported_features = F.PAUSE | F.SEEK | F.VOLUME_SET | F.VOLUME_MUTE | F.PREV | F.NEXT | F.TURN_ON | F.TURN_OFF;
    Object.assign(st.attributes, extra || {});
    return st;
  };

  let calls = [];
  const cs = (dom, svc, data) => calls.push({ svc, data });
  c = makeCard({ show_power: true }, [[{ track_name: 'Creep' }, CREEP]]);
  c.hass = hass({ 'media_player.spotify': ctrlState() }, cs);
  await flush();

  eq('toggle button present', !!findBtn(c, 'toggle'), true);
  eq('mute button present', !!findBtn(c, 'mute'), true);
  eq('volume slider present', !!findVolInput(c), true);
  eq('volume label present', c.el.controls.querySelector('.vlab').textContent, '70%');

  c._onClick({ target: findBtn(c, 'toggle') });
  eq('toggle calls media_play_pause', calls[calls.length - 1].svc, 'media_play_pause');
  eq('toggle targets the current entity', calls[calls.length - 1].data.entity_id, 'media_player.spotify');

  c._onClick({ target: findBtn(c, 'next') });
  eq('next calls media_next_track', calls[calls.length - 1].svc, 'media_next_track');
  c._onClick({ target: findBtn(c, 'prev') });
  eq('prev calls media_previous_track', calls[calls.length - 1].svc, 'media_previous_track');
  c._onClick({ target: findBtn(c, 'power') });
  eq('power calls toggle', calls[calls.length - 1].svc, 'toggle');
  c._onClick({ target: findBtn(c, 'mute') });
  eq('mute calls volume_mute', calls[calls.length - 1].svc, 'volume_mute');
  eq('mute payload toggles to muted', calls[calls.length - 1].data, {
    entity_id: 'media_player.spotify', is_volume_muted: true
  });

  const volInp = findVolInput(c);
  volInp.value = '55';
  c._onVol({ target: volInp });
  eq('volume label updates while dragging', c.el.controls.querySelector('.vlab').textContent, '55%');
  await new Promise((r) => setTimeout(r, 250));
  eq('volume_set debounced', calls[calls.length - 1].svc, 'volume_set');
  eq('volume_set payload', calls[calls.length - 1].data, {
    entity_id: 'media_player.spotify', volume_level: 0.55
  });

  console.log('\nseek');
  c.el.track.getBoundingClientRect = () => ({ left: 0, width: 200 });
  c._onSeekDown({ button: 0, clientX: 40, target: c.el.track });
  c._onSeekMove({ clientX: 80 });
  eq('scrub shows on the progress bar', c.el.fill.style.width, '40.0%');
  eq('scrub time label', c.el.tpos.textContent, '1:35');
  c._onSeekUp({});
  eq('seek releases media_seek', calls[calls.length - 1].svc, 'media_seek');
  eq('seek payload', calls[calls.length - 1].data, {
    entity_id: 'media_player.spotify', seek_position: 95.6
  });

  console.log('\nfeature gating');
  c = makeCard({}, [[{ track_name: 'Creep' }, CREEP]]);
  c.hass = hass({
    'media_player.spotify': (() => {
      const st = ctrlState();
      st.attributes.is_volume_muted = true;
      return st;
    })()
  }, cs);
  await flush();
  c._onClick({ target: findBtn(c, 'mute') });
  eq('muted player un-mutes', calls[calls.length - 1].data.is_volume_muted, false);

  c = makeCard({}, [[{ track_name: 'Creep' }, CREEP]]);
  c.hass = hass({
    'media_player.spotify': (() => {
      const st = ctrlState();
      delete st.attributes.volume_level;
      st.attributes.supported_features = F.VOLUME_STEP;
      return st;
    })()
  });
  await flush();
  eq('step buttons shown without volume_level', !!findBtn(c, 'v+') && !!findBtn(c, 'v-'), true);
  c._onClick({ target: findBtn(c, 'v+') });

  c = makeCard({}, [[{ track_name: 'Creep' }, CREEP]]);
  c.hass = hass({
    'media_player.spotify': (() => {
      const st = ctrlState();
      delete st.attributes.volume_level;
      st.attributes.supported_features = 0;
      return st;
    })()
  });
  await flush();
  eq('no volume ui without features/level', !findVolInput(c) && !findBtn(c, 'v+'), true);

  console.log('\nseek feature gate');
  calls = [];
  c = makeCard({}, [[{ track_name: 'Creep' }, CREEP]]);
  c.hass = hass({
    'media_player.spotify': (() => {
      const st = ctrlState();
      st.attributes.supported_features = F.PAUSE | F.VOLUME_SET;
      return st;
    })()
  }, cs);
  await flush();
  c.el.track.getBoundingClientRect = () => ({ left: 0, width: 200 });
  c._onSeekDown({ button: 0, clientX: 100, target: c.el.track });
  c._onSeekUp({});
  eq('no seek service without F_SEEK', calls.some((x) => x.svc === 'media_seek'), false);

  console.log('\nsync offset / slider');
  global.localStorage.removeItem('ha-lyrics:v1:off:radiohead|creep');
  c = makeCard({}, [[{ track_name: 'Creep' }, CREEP]]);
  c.hass = hass({ 'media_player.spotify': player('media_player.spotify', 'Creep', 'Radiohead', 'Pablo Honey', 239, 20) });
  await flush();
  eq('slider reflects zero offset', c.el.syncIn.value, '0');

  c.el.syncIn.value = '5';
  c._onSyncIn({ target: c.el.syncIn });
  eq('offset stored', c.offset, 5);
  eq('offset label', c.el.syncVal.textContent, '+5.00s');
  eq('offset applies to the active line', c.lineEls[c.active].textContent, 'Couldnt look you in the eye');
  eq('offset persisted', global.localStorage.getItem('ha-lyrics:v1:off:radiohead|creep'), '5');

  let resetBtn = null;
  c.el.sync._walk((n) => { if (!resetBtn && n._matches('[data-c="syncreset"]')) resetBtn = n; });
  c._onClick({ target: resetBtn });
  eq('syncreset zeroes offset', c.offset, 0);

  let plus = null, minus = null;
  c.el.sync._walk((n) => {
    if (!plus && n._matches('[data-c="sync+"]')) plus = n;
    if (!minus && n._matches('[data-c="sync-"]')) minus = n;
  });
  c._onClick({ target: minus });
  eq('sync- steps -0.5s', c.offset, -0.5);
  c._onClick({ target: plus });
  c._onClick({ target: plus });
  eq('sync+ steps +1.0s from -0.5', c.offset, 0.5);
  eq('offset label after nudge', c.el.syncVal.textContent, '+0.50s');
  eq('offset persisted after nudge', global.localStorage.getItem('ha-lyrics:v1:off:radiohead|creep'), '0.5');
  c._onClick({ target: resetBtn });
  eq('nudged offset still resettable', c.offset, 0);

  c = makeCard({ sync_offset: 2 }, [[{ track_name: 'Creep' }, CREEP]]);
  c.hass = hass({ 'media_player.spotify': player('media_player.spotify', 'Creep', 'Radiohead', 'Pablo Honey', 239, 20) });
  await flush();
  eq('sync_offset seeds when nothing stored', c.offset, 2);
  eq('sync_offset clamped', makeCard({ sync_offset: 999 }, []).config.sync_offset, 120);

  console.log('\nmusic assistant lyrics source');

  const MA_SYNCED = '[00:11.20] Hello from Music Assistant\n[00:16.40] Second line here';
  const MA_PLAIN = 'Plain line one\nPlain line two';

  function maPlayer(uri) {
    const st = player('media_player.ma_kitchen', 'Creep', 'Radiohead', 'Pablo Honey', 239, 20);
    if (uri !== undefined) st.attributes.media_content_id = uri;
    return st;
  }

  function maCard(cfg, handler, uri) {
    global.__maSockets = [];
    global.__maHandler = handler;
    cache.clear();
    const card = makeCard(
      { lyrics_source: 'music_assistant', music_assistant_url: 'http://ma.local:8095', music_assistant_token: 'tok', ...cfg },
      [[{ track_name: 'Creep' }, CREEP]]
    );
    card.hass = hass({ 'media_player.ma_kitchen': maPlayer(uri) });
    return card;
  }

  const okHandler = (payload) => (msg) => {
    if (msg.command === 'auth') return { message_id: msg.message_id, result: { username: 'me' } };
    return { message_id: msg.message_id, result: payload };
  };

  const settle = () => new Promise((r) => setTimeout(r, 250));

  let m = maCard({}, okHandler([MA_PLAIN, MA_SYNCED]), 'library://track/12345');
  await settle();
  eq('ma lyrics used when source is music_assistant', m.data && m.data.source, 'music_assistant');
  eq('ma synced lines parsed', m.data && m.data.kind, 'synced');
  eq('ma first line', m.data && m.data.lines[0].text, 'Hello from Music Assistant');
  eq('ma opened exactly one socket', global.__maSockets.length, 1);
  eq('ma socket url', global.__maSockets[0].url, 'ws://ma.local:8095/ws');
  const cmds = global.__maSockets[0].sent.map((s) => s.command);
  eq('ma auths before the command', cmds, ['auth', 'metadata/get_track_lyrics']);
  eq('ma track payload', global.__maSockets[0].sent[1].args.track, {
    item_id: '12345', provider: 'library', media_type: 'track', uri: 'library://track/12345'
  });

  m = maCard({}, okHandler([MA_PLAIN, '']), 'library://track/12345');
  await settle();
  eq('ma plain-only lyrics become static', m.data && m.data.kind, 'static');
  eq('ma plain line paced', m.data && m.data.lines[0].text, 'Plain line one');

  m = maCard({}, okHandler([null, null]), 'library://track/12345');
  await settle();
  eq('ma empty falls back to lrclib', m.data && m.data.source, 'lrclib');

  m = maCard({}, (msg) => (msg.command === 'auth'
    ? { message_id: msg.message_id, error_code: 'invalid_token', error_message: 'nope' }
    : { message_id: msg.message_id, result: [MA_PLAIN, MA_SYNCED] }), 'library://track/12345');
  await settle();
  eq('ma auth error falls back to lrclib', m.data && m.data.source, 'lrclib');

  m = maCard({ music_assistant_timeout: 2 }, () => undefined, 'library://track/12345');
  await new Promise((r) => setTimeout(r, 2800));
  eq('ma blackholed socket times out into lrclib', m.data && m.data.source, 'lrclib');

  m = maCard({}, (msg, sock) => { if (msg.command === 'auth') sock.close(); }, 'library://track/12345');
  await settle();
  eq('ma dropped socket falls back to lrclib', m.data && m.data.source, 'lrclib');

  m = maCard({}, okHandler([MA_PLAIN, MA_SYNCED]), 'https://stream.example/song.mp3');
  await settle();
  eq('non-ma uri skips the socket entirely', global.__maSockets.length, 0);
  eq('non-ma uri falls back to lrclib', m.data && m.data.source, 'lrclib');

  m = maCard({ music_assistant_token: '' }, okHandler([MA_PLAIN, MA_SYNCED]), 'library://track/12345');
  await settle();
  eq('missing token skips the socket', global.__maSockets.length, 0);
  eq('missing token falls back to lrclib', m.data && m.data.source, 'lrclib');

  m = maCard({}, okHandler([MA_PLAIN, MA_SYNCED]), 'spotify:track:4cOdK2wGLETKBW3PvgPWqT');
  await settle();
  eq('new-style ma uri accepted', m.data && m.data.source, 'music_assistant');
  eq('new-style provider parsed', global.__maSockets[0].sent[1].args.track.provider, 'spotify');
  eq('new-style item id parsed', global.__maSockets[0].sent[1].args.track.item_id, '4cOdK2wGLETKBW3PvgPWqT');

  global.__maHandler = undefined;

  console.log('\nconfig: lyrics source');
  const src = (v) => makeCard({ lyrics_source: v }, [[{ track_name: 'Creep' }, CREEP]]).config.lyrics_source;
  eq('default source is lrclib', src(undefined), 'lrclib');
  eq('nonsense source falls back to lrclib', src('spotify'), 'lrclib');
  eq('music_assistant kept', src('music_assistant'), 'music_assistant');
  eq('timeout clamped', makeCard({ music_assistant_timeout: 999 }, []).config.music_assistant_timeout, 30);
  eq('url trimmed', makeCard({ music_assistant_url: '  http://ma:8095  ' }, []).config.music_assistant_url, 'http://ma:8095');

  console.log('\ncontrols survive a playback blip');
  // Regression: the controls were hidden whenever there was no track, but the
  // control signature was not reset, so a player coming back with an unchanged
  // signature re-entered the cached path and never un-hid them.
  cache.clear();
  c = makeCard({}, [[{ track_name: 'Creep' }, CREEP]]);
  const blip = (state) => hass({
    'media_player.spotify': player('media_player.spotify', 'Creep', 'Radiohead', 'Pablo Honey', 239, 30, state)
  });
  c.hass = blip('playing');
  await flush();
  eq('controls visible while playing', c.el.controls.hidden, false);
  eq('seek bar visible while playing', c.el.seek.hidden, false);
  const sig = c._ctlSig;
  c.hass = blip('off');
  await flush();
  eq('controls hidden with nothing playing', c.el.controls.hidden, true);
  eq('signature cleared while stopped', c._ctlSig, null);
  c.hass = blip('playing');
  await flush();
  eq('same signature as before the blip', c._ctlSig, sig);
  eq('controls visible again after the blip', c.el.controls.hidden, false);
  eq('seek bar visible again after the blip', c.el.seek.hidden, false);
  eq('toggle button rebuilt', !!findBtn(c, 'toggle'), true);

  console.log('\ncontrols show whenever something is playing');
  const untitledCalls = [];
  c = makeCard({}, [[{ track_name: 'Creep' }, CREEP]]);
  c.hass = hass({
    'media_player.radio': mkState({ friendly_name: 'Kitchen', supported_features: F.PAUSE | F.VOLUME_SET, volume_level: 0.3 })
  }, (dom, svc, data) => untitledCalls.push({ svc, data }));
  await flush();
  eq('untitled player is collected', c._keys.length, 1);
  eq('untitled player keeps its controls', c.el.controls.hidden, false);
  eq('untitled player toggle present', !!findBtn(c, 'toggle'), true);
  c._onClick({ target: findBtn(c, 'toggle') });
  eq('untitled player still drives the entity', untitledCalls[untitledCalls.length - 1].svc, 'media_play_pause');
  eq('untitled player entity id', untitledCalls[untitledCalls.length - 1].data.entity_id, 'media_player.radio');
  eq('untitled player status explains itself', c.el.status.textContent, 'Playing');
  c.hass = hass({
    'media_player.radio': mkState({ friendly_name: 'Kitchen', state: 'paused', supported_features: F.PAUSE, volume_level: 0.3 })
  });
  await flush();
  eq('untitled paused still shows controls', c.el.controls.hidden, false);
  eq('untitled paused status', c.el.status.textContent, 'Paused');
  eq('untitled paused track count', c._keys.length, 1);

  // Two players on the same untitled stream stay separate pages.
  c = makeCard({}, []);
  c.hass = hass({
    'media_player.a': mkState({ friendly_name: 'Same', supported_features: F.PAUSE }),
    'media_player.b': mkState({ friendly_name: 'Same', supported_features: F.PAUSE })
  });
  await flush();
  eq('untitled players are not merged', c._keys.length, 2);
  eq('dots offered for both', c.el.dots.style.display, '');

  console.log('\nno lyrics -> controls stay');
  cache.clear();
  c = makeCard({}, []);
  c.hass = hass({ 'media_player.radio': player('media_player.radio', 'zz unknown tune 991', 'nobody', '', 200, 5) });
  await flush();
  eq('miss reported', c.el.status.textContent, 'No lyrics found');
  eq('controls visible with no lyrics', c.el.controls.hidden, false);
  eq('seek visible with no lyrics', c.el.seek.hidden, false);
  eq('toggle usable with no lyrics', !!findBtn(c, 'toggle'), true);

  c = makeCard({}, [[{ track_name: 'Weightless' }, INSTRU]]);
  c.hass = hass({ 'media_player.radio': player('media_player.radio', 'Weightless', 'Marconi Union', '', 480, 10) });
  await flush();
  eq('controls visible for instrumental', c.el.controls.hidden, false);

  c = makeCard({}, [[{ track_name: 'Pale' }, PLAIN]]);
  c.hass = plainState(61);
  await flush();
  eq('unsynced lyrics keep their controls', c.el.controls.hidden, false);
  eq('unsynced lyrics keep the seek bar', c.el.seek.hidden, false);

  console.log('\nshow_lyrics option');
  eq('show_lyrics defaults to on', makeCard({}, []).config.show_lyrics, true);
  eq('show_lyrics off is honoured', makeCard({ show_lyrics: false }, []).config.show_lyrics, false);

  cache.clear();
  c = makeCard({ show_lyrics: false }, [[{ track_name: 'Creep' }, CREEP]]);
  let hits = 0;
  global.fetch = (url) => { hits++; return fakeFetch([[{ track_name: 'Creep' }, CREEP]])(url); };
  c.hass = hass({ 'media_player.spotify': player('media_player.spotify', 'Creep', 'Radiohead', 'Pablo Honey', 239, 20) });
  await flush();
  eq('lyrics are never fetched when hidden', hits, 0);
  eq('no lyric lines rendered', c._lyricsOn(), false);
  eq('status explains the hidden lyrics', c.el.status.textContent, 'Lyrics hidden');
  eq('stage shows the message, not lines', c.el.lines.textContent, 'Lyrics hidden');
  eq('controls still shown with lyrics off', c.el.controls.hidden, false);
  eq('progress bar still shown with lyrics off', c.el.seek.hidden, false);
  eq('intro splash suppressed with lyrics off', c.el.splash.classList.contains('on'), false);
  eq('no drift with lyrics off', c._driftOn(), false);

  // Turning it back on re-fetches and repaints the lyrics.
  c.setConfig({ show_lyrics: true });
  await flush();
  await flush();
  eq('lyrics return when re-enabled', c._lyricsOn(), true);
  eq('lyric lines rendered again', c.lineEls.length, 4);

  console.log('\nalbum art takes over when there are no lyrics');
  const artCard = (cfg, table, title) => {
    cache.clear();
    const card = makeCard(cfg || {}, table);
    const st = player('media_player.spotify', title, 'Radiohead', 'Pablo Honey', 239, 20);
    st.attributes.entity_picture = '/api/media_player_proxy/x/cover.jpg';
    st.attributes.supported_features = F.PAUSE;
    card.hass = hass({ 'media_player.spotify': st });
    return card;
  };
  const heroBox = (card) => {
    const e = card.el.hero;
    return { hidden: e.hidden, src: e.src, on: card.el.card.classList.contains('artmode') };
  };

  c = artCard({}, [[{ track_name: 'Creep' }, CREEP]], 'Creep');
  await flush();
  eq('synced lyrics -> no art takeover', heroBox(c).on, false);
  eq('synced lyrics -> art element hidden', heroBox(c).hidden, true);
  eq('synced lyrics keep the blurred backdrop', c.el.bg.hidden, false);
  eq('synced lyrics keep has-bg', c.el.card.classList.contains('has-bg'), true);

  c = artCard({}, [], 'zz unknown tune 991');
  await flush();
  eq('no lyrics -> art takes over', heroBox(c).on, true);
  eq('no lyrics -> art element shown', heroBox(c).hidden, false);
  eq('no lyrics -> art element has the cover', heroBox(c).src, '/api/media_player_proxy/x/cover.jpg');
  eq('no lyrics -> backdrop no longer blurred', c.el.bg.hidden, true);
  eq('no lyrics -> has-bg dropped', c.el.card.classList.contains('has-bg'), false);
  eq('no lyrics -> header thumb still shown', c.el.art.hidden, false);
  eq('no lyrics -> controls still shown', c.el.controls.hidden, false);
  eq('no lyrics -> auto contrast not taken from the art',
    c.el.card.style.getPropertyValue('--ha-lyrics-primary'), '');

  c = artCard({}, [[{ track_name: 'Weightless' }, INSTRU]], 'Weightless');
  await flush();
  eq('instrumental -> art takes over', heroBox(c).on, true);

  c = artCard({}, [[{ track_name: 'Pale' }, PLAIN]], 'Pale');
  await flush();
  eq('unsynced lyrics still render as text', heroBox(c).on, false);
  eq('unsynced lyrics keep the backdrop', c.el.bg.hidden, false);

  c = artCard({ show_lyrics: false }, [[{ track_name: 'Creep' }, CREEP]], 'Creep');
  await flush();
  eq('lyrics hidden -> art takes over', heroBox(c).on, true);
  eq('lyrics hidden -> backdrop unblurred', c.el.bg.hidden, true);

  // No artwork at all: the message text is all we have, so it stays visible.
  cache.clear();
  c = makeCard({}, []);
  c.hass = hass({ 'media_player.radio': player('media_player.radio', 'zz unknown tune 991', 'nobody', '', 200, 5) });
  await flush();
  eq('no art and no lyrics -> no takeover', c._heroOn(), false);
  eq('no art and no lyrics -> message visible', c.el.lines.textContent, 'No lyrics found');
  eq('no art and no lyrics -> controls shown', c.el.controls.hidden, false);

  // A broken image URL must not leave a broken hero on screen.
  cache.clear();
  c = makeCard({}, []);
  const stBroken = player('media_player.radio', 'zz unknown tune 991', 'nobody', '', 200, 5);
  stBroken.attributes.entity_picture = '/local/missing.png';
  c.hass = hass({ 'media_player.radio': stBroken });
  await flush();
  eq('broken art starts the takeover', c.el.hero.hidden, false);
  c.el.hero.onerror();
  eq('broken art falls back to the message', c.el.hero.hidden, true);
  eq('broken art message shown', c.el.lines.textContent, 'No lyrics found');
  eq('broken art drops has-bg', c.el.card.classList.contains('has-bg'), false);
  eq('broken art keeps controls', c.el.controls.hidden, false);

  console.log('\nart mode with a fixed card height');
  // A fixed height collapses the stage, so the takeover must fill the leftover
  // space rather than size itself from the (display:none) lyric lines.
  c = artCard({ height: 300 }, [], 'zz unknown tune 991');
  await flush();
  eq('fixed height -> art mode on', heroBox(c).on, true);
  eq('fixed height -> card carries the fixed height', c.el.card.style.height, '300px');
  // The shim reports clientHeight 0, so maxHeight stays 0px here; the real
  // sizing comes from the .artmode CSS rules, asserted in a browser run.
  eq('fixed height -> art max-height is set from the stage', c.el.hero.style.maxHeight, '0px');
  eq('fixed height -> art is the on-screen element', c.el.hero.hidden, false);
  eq('fixed height -> controls still shown', c.el.controls.hidden, false);

  c = artCard({ height: 300 }, [[{ track_name: 'Creep' }, CREEP]], 'Creep');
  await flush();
  eq('fixed height + lyrics -> no takeover', heroBox(c).on, false);
  eq('fixed height + lyrics -> art element hidden', heroBox(c).hidden, true);
  eq('fixed height + lyrics -> backdrop stays', c.el.bg.hidden, false);

  console.log('\nresult: ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();