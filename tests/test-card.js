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

  console.log('\nresult: ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
