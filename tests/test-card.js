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
function hass(states) { return { states }; }

function makeCard(cfg, table) {
  global.fetch = fakeFetch(table);
  const c = new global.Card();
  c.setConfig(cfg);
  c.connectedCallback();
  return c;
}

const flush = () => new Promise((r) => setTimeout(r, 30));

(async () => {
  console.log('\ngrouping / dedupe');

  let c = makeCard({}, [[{ track_name: 'Creep' }, CREEP]]);
  c.hass = hass({
    'media_player.spotify': player('media_player.spotify', 'Creep', 'Radiohead', 'Pablo Honey', 239, 20),
    'media_player.tv': player('media_player.tv', 'Creep', 'Radiohead', 'Pablo Honey', 239, 21)
  });
  await flush();

  eq('same song on 2 players -> 1 group', c._keys.length, 1);
  eq('dedupe recorded both entities', c._tracks[0].also.length, 2);
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

  console.log('\ninstrumental + not found');
  c = makeCard({}, [[{ track_name: 'Weightless' }, INSTRU]]);
  c.hass = hass({ 'media_player.radio': player('media_player.radio', 'Weightless', 'Marconi Union', '', 480, 10) });
  await flush();
  eq('instrumental shown', c.el.lines.textContent, '\u266a  Instrumental');
  eq('offset controls hidden for instrumental', c.el.ctl.hidden, true);

  c = makeCard({}, []);
  c.hass = hass({ 'media_player.radio': player('media_player.radio', 'zz unknown tune 991', 'nobody', '', 200, 5) });
  await flush();
  eq('no lyrics message', c.el.lines.textContent, 'No lyrics found');

  c.hass = hass({ 'media_player.radio': player('media_player.radio', 'zz unknown tune 991', 'nobody', '', 200, 5, 'paused') });
  await flush();
  eq('idle when nothing playing', c.el.sub.textContent, 'Nothing playing');
  eq('idle title', c.el.title.textContent, 'Lyrics');

  console.log('\nstatic mode offset');
  cache.clear();
  c = makeCard({}, [[{ track_name: 'Creep' }, Object.assign({}, CREEP, { syncedLyrics: '' })]]);
  c.hass = hass({ 'media_player.spotify': player('media_player.spotify', 'Creep', 'Radiohead', 'Pablo Honey', 239, 2) });
  await flush();
  eq('static kind', c.data.kind, 'static');
  eq('offset controls shown', c.el.ctl.hidden, false);
  eq('static first line at 0', c.lineEls[c.active].textContent, 'When you were here before');
  c._nudge(5);
  eq('nudge applied', c.el.offv.textContent, '+5s');
  c._nudge(-8);
  eq('negative nudge', c.el.offv.textContent, '-3s');

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

  console.log('\nlayout options');
  cache.clear();
  c = makeCard({ max_lines: 7, line_height: 38 }, [[{ track_name: 'Creep' }, CREEP]]);
  c.hass = hass({ 'media_player.spotify': player('media_player.spotify', 'Creep', 'Radiohead', 'Pablo Honey', 239, 20) });
  await flush();
  eq('stage height from max_lines', c.el.stage.style.height, '266px');
  eq('lines padded so line 1 can centre', c.el.lines.style.paddingTop, '114px');
  eq('bottom padding matches', c.el.lines.style.paddingBottom, '114px');
  eq('default align', c.el.lines.style.textAlign, 'center');

  c = makeCard({ height: 420 }, [[{ track_name: 'Creep' }, CREEP]]);
  c.hass = hass({ 'media_player.spotify': player('media_player.spotify', 'Creep', 'Radiohead', 'Pablo Honey', 239, 20) });
  await flush();
  eq('explicit height wins over max_lines', c.el.stage.style.height, '420px');
  eq('padding follows explicit height', c.el.lines.style.paddingTop, '191px');
  eq('getCardSize follows height', c.getCardSize(), 10);

  c = makeCard({ align: 'left' }, [[{ track_name: 'Creep' }, CREEP]]);
  c.hass = hass({ 'media_player.spotify': player('media_player.spotify', 'Creep', 'Radiohead', 'Pablo Honey', 239, 20) });
  await flush();
  eq('align left', c.el.lines.style.textAlign, 'left');
  eq('nonsense align falls back to center', makeCard({ align: 'sideways' }).config.align, 'center');

  console.log('\nheader / text options');
  c = makeCard({ show_header: false }, [[{ track_name: 'Creep' }, CREEP]]);
  c.hass = hass({ 'media_player.spotify': player('media_player.spotify', 'Creep', 'Radiohead', 'Pablo Honey', 239, 20) });
  await flush();
  eq('show_header false hides header', c.el.head.hidden, true);

  c = makeCard({ show_friendly_name: false }, [[{ track_name: 'Creep' }, CREEP]]);
  c.hass = hass({ 'media_player.spotify': player('media_player.spotify', 'Creep', 'Radiohead', 'Pablo Honey', 239, 20) });
  await flush();
  eq('artist only, no friendly name', c.el.sub.textContent, 'Radiohead');

  console.log('\nbackground tuning');
  c = makeCard({ background_blur: 30, background_dim: 0.2, background_veil: 0.8, art_size: 64 },
    [[{ track_name: 'Creep' }, CREEP]]);
  c.hass = hass({ 'media_player.spotify': player('media_player.spotify', 'Creep', 'Radiohead', 'Pablo Honey', 239, 20) });
  await flush();
  eq('blur var', c.style.getPropertyValue('--bg-blur'), '30px');
  eq('dim var', c.style.getPropertyValue('--bg-dim'), '0.2');
  eq('veil var', c.style.getPropertyValue('--bg-veil'), '0.8');
  eq('art size var', c.style.getPropertyValue('--art-size'), '64px');

  eq('blur clamped to max', makeCard({ background_blur: 9999 }).config.background_blur, 80);
  eq('dim clamped to 0..1', makeCard({ background_dim: 5 }).config.background_dim, 1);
  eq('font_size clamped', makeCard({ font_size: 9999 }).config.font_size, 120);
  eq('font_size floor', makeCard({ font_size: -5 }).config.font_size, 8);
  eq('bad numeric falls back to default', makeCard({ font_size: 'big' }).config.font_size, 28);
  eq('entities coerced to array', makeCard({ entities: 'media_player.tv' }).config.entities.length, 0);

  console.log('\ncolours');
  c = makeCard({ text_color: '#ff0000', highlight_color: '#00ff00' }, [[{ track_name: 'Creep' }, CREEP]]);
  c.hass = hass({ 'media_player.spotify': player('media_player.spotify', 'Creep', 'Radiohead', 'Pablo Honey', 239, 20) });
  await flush();
  eq('text_color applied', c.style.getPropertyValue('--ha-lyrics-secondary'), '#ff0000');
  eq('highlight_color applied', c.style.getPropertyValue('--ha-lyrics-primary'), '#00ff00');
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

  console.log('\nmusic assistant lyrics source');

  const MA_SYNCED = '[00:11.20] Hello from Music Assistant\n[00:16.40] Second line here';
  const MA_PLAIN = 'Plain line one\nPlain line two';

  function maPlayer(uri) {
    const st = player('media_player.ma_kitchen', 'Creep', 'Radiohead', 'Pablo Honey', 239, 20);
    if (uri !== undefined) st.attributes.media_content_id = uri;
    return st;
  }

  // Build a card whose only lyric source is MA, returning the card plus the
  // sockets MA was asked to open.
  function maCard(cfg, handler, uri) {
    global.__maSockets = [];
    global.__maHandler = handler;
    // Every case below plays the same track, and the card caches per
    // track+source, so start each one with a cold cache.
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

  // The MA path adds a socket open, two command round trips and (on fallback) a
  // fetch, so give it a longer settle than the plain LRCLIB cases.
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

  // ---------------------------------------------------------------------------
  // Unsynced lyrics: uniform small type, drifting slowly upward.
  // ---------------------------------------------------------------------------
  console.log('\nmarquee: unsynced lyrics');

  const PLAIN = {
    id: 9, trackName: 'Pale', artistName: 'Sneaker Pimps', albumName: 'Bloodsport',
    duration: 244, instrumental: false,
    plainLyrics: 'You are the finest thing I have ever seen\nI love you when you sleep\nYou are the finest thing\nAnd you are always here'
  };
  const plainTable = [[{ track_name: 'Pale' }, PLAIN]];
  const plainState = () => hass({
    'media_player.pale': player('media_player.pale', 'Pale', 'Sneaker Pimps', 'Bloodsport', 244, 0)
  });

  // The fake stage has no layout, so give it a scrollable box to work against.
  const sizeStage = (card, viewH, contentH) => {
    card.el.stage.clientHeight = viewH;
    card.el.stage.scrollHeight = contentH;
  };
  // Drive the motion with explicit timestamps instead of leaning on the shared
  // rAF queue: every earlier card in this file still owns a live loop, so the
  // queue starves and the card's 0.25s per-frame clamp (which stops a
  // backgrounded tab teleporting the block) then eats most of the elapsed time.
  // The rAF wiring itself is covered separately by the start/stop checks.
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
  // Same, but leaves hold/until alone so the card's own rests and the loop-back
  // are observable instead of being reset every frame.
  const stepRaw = (card, dtMs) => {
    const m = card._marq;
    m.started = true; m.last = _t;
    _t += dtMs;
    card._marqueeStep(_t);
  };
  const runRaw = (card, seconds) => {
    for (let i = 0; i < Math.round(seconds * 60); i++) stepRaw(card, 1000 / 60);
  };

  global.__resetFrames(4000);
  let sc = makeCard({}, plainTable);
  sc.hass = plainState();
  await flush();
  eq('unsynced lyrics are static kind', sc.data.kind, 'static');
  eq('lines get the static class', /(^|\s)static(\s|$)/.test(sc.el.lines.className), true);
  eq('marquee active for unsynced', sc._isMarquee(), true);
  eq('default static font size', sc.config.static_font_size, 18);
  eq('default static scroll speed', sc.config.static_scroll_speed, 14);
  eq('static scroll on by default', sc.config.static_scroll, true);
  eq('css var published', sc.style.getPropertyValue('--static-size'), '18px');
  // Padding is measured against the small marquee line box, not the big one.
  const stageH = (cfg) => (cfg.height > 0 ? cfg.height : cfg.max_lines * cfg.line_height);
  eq('padding measured against small line box', parseInt(sc.el.lines.style.paddingTop, 10),
    Math.max(0, Math.round((stageH(sc.config) - Math.round(18 * 1.6)) / 2)));

  // Drift: 14px/s for one second should move the stage ~14px.
  sizeStage(sc, 200, 1000);
  await run(sc, 1);
  eq('drifts at the configured speed', Math.round(sc.el.stage.scrollTop), 14);

  // Big jumps are clamped so a backgrounded tab does not teleport the block.
  sc._marq.hold = 0;
  sc._marq.until = 0;
  sc._marq.pos = 0;
  sc.el.stage.scrollTop = 0;
  step(sc, 2000);
  eq('a stalled tab resumes slowly instead of jumping', sc.el.stage.scrollTop, 3.5);

  // Reaching the end rests, then loops back to the top. Crank the speed so the
  // wrap happens in a few seconds of virtual time, and let the loop do the work
  // - setting scrollTop by hand would not catch a missing reset.
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

  // Sub-pixel drift must still accumulate. The offset is tracked in JS, not
  // read back from the element, because scroll offsets snap to whole device
  // pixels: 14px/s is 0.23px per 60Hz frame, so a read-modify-write would sit
  // at 0 forever. The fake element here rounds like a real one.
  let snap = makeCard({}, plainTable);
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

  // _scrollTo must not drag the block back to the (estimated) active line.
  const scrollCalls = [];
  const realScroll = sc.el.stage.scrollTo;
  sc.el.stage.scrollTo = function (o) { scrollCalls.push(o); return realScroll.call(this, o); };
  sc._update(true);
  eq('no snap-to-line scroll while drifting', scrollCalls.length, 0);
  sc.el.stage.scrollTo = realScroll;

  // A manual scroll parks it. step() clears the interaction window, so drive
  // these frames directly to leave `until` alone.
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
  // Once the window lapses it must carry on from where the reader left it,
  // not snap back to the old position.
  sc._marq.until = Date.now() - 1;
  const resumeFrom = sc.el.stage.scrollTop;
  sc._marq.started = true;
  sc._marq.last = _t;
  sc._marq.hold = 0;
  _t += 1000;
  sc._marqueeStep(_t);
  eq('resumes from the parked position', sc.el.stage.scrollTop, resumeFrom + 3.5);
  sc._marq.until = 0;

  // Opting out restores the centred highlight scroll.
  let noScroll = makeCard({ static_scroll: false }, plainTable);
  noScroll.hass = plainState();
  await flush();
  eq('static class dropped when disabled', /(^|\s)static(\s|$)/.test(noScroll.el.lines.className), false);
  eq('marquee inactive when disabled', noScroll._isMarquee(), false);
  eq('padding back to the big line box', parseInt(noScroll.el.lines.style.paddingTop, 10),
    Math.max(0, Math.round((stageH(noScroll.config) - noScroll.config.line_height) / 2)));
  sizeStage(noScroll, 200, 1000);
  noScroll.el.stage.scrollTop = 0;
  let centred = false;
  noScroll.el.stage.scrollTo = function () { centred = true; };
  noScroll._update(true);
  eq('disabled marquee centres the active line', centred, true);
  // Synced lyrics must keep the karaoke behaviour.
  let sy = makeCard({}, [[{ track_name: 'Creep' }, CREEP]]);
  sy.hass = hass({
    'media_player.spotify': player('media_player.spotify', 'Creep', 'Radiohead', 'Pablo Honey', 239, 20)
  });
  await flush();
  eq('synced lyrics are synced kind', sy.data.kind, 'synced');
  eq('no static class on synced lyrics', /(^|\s)static(\s|$)/.test(sy.el.lines.className), false);
  eq('marquee never runs on synced lyrics', sy._isMarquee(), false);

  // Reduced motion: leave the block centred and let the reader scroll.
  global.__reducedMotion = true;
  let rm = makeCard({}, plainTable);
  rm.hass = plainState();
  await flush();
  sizeStage(rm, 200, 1000);
  for (let i = 0; i < 120; i++) rm._marqueeStep((_t += 1000 / 60));
  eq('reduced motion disables the drift', rm.el.stage.scrollTop, 0);
  eq('no frame armed under reduced motion', (rm._marq && rm._marq.raf) || 0, 0);
  global.__reducedMotion = false;

  // Custom sizing, and the clamps.
  let tuned = makeCard({ static_font_size: 26, static_scroll_speed: 40 }, plainTable);
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

  // Teardown must not leave a rAF loop running.
  tuned.disconnectedCallback();
  eq('disconnect cancels the frame', tuned._marq.raf, 0);
  tuned.connectedCallback();
  tuned.disconnectedCallback();
  global.__resetFrames();

  console.log('\nresult: ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
