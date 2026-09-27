(function () {
  'use strict';

  var API = 'https://lrclib.net/api';
  var LS = 'ha-lyrics:v1:';
  var LS_IDX = LS + 'index';
  var CACHE_MAX = 500;
  var TTL_OK = 180 * 864e5;
  var TTL_MISS = 864e5;
  var TICK = 200;
  var SWIPE_PX = 42;
  var READ_PACE = 4.5;
  var LRC_RE = /\[(\d{1,3}):([0-5]?\d)(?:[.:](\d{1,3}))?\]/g;
  var DIACRITICS = /[\u0300-\u036f]/g;
  var NOISE = /\((?:[^)]*(?:remaster|version|edit|mix|mono|stereo|live|bonus|deluxe|explicit|clean|radio|album|single|expanded|anniversary|reissue|take\s*\d|part\s*\d)[^)]*)\)|\[[^\]]*\]|\{[^}]*\}/gi;
  var FEAT = /\s*[-–—(]?\s*(?:feat|ft|featuring|with)\b.*$/i;

  function squash(v) {
    return String(v == null ? '' : v)
      .toLowerCase()
      .normalize('NFD')
      .replace(DIACRITICS, '')
      .replace(NOISE, ' ')
      .replace(FEAT, '')
      .replace(/['’`]/g, '')
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function splitPlain(src) {
    return String(src || '')
      .split(/\r?\n/)
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return s && !/^\[[\d:.]+\]$/.test(s); });
  }

  function parseLrc(src) {
    var out = [];
    if (!src) return out;
    var lines = String(src).split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var raw = lines[i];
      LRC_RE.lastIndex = 0;
      var times = [];
      var text = '';
      var cursor = 0;
      var m;
      while ((m = LRC_RE.exec(raw)) !== null) {
        times.push(Number(m[1]) * 60 + Number(m[2]) + (m[3] ? Number('0.' + m[3]) : 0));
        text += raw.slice(cursor, m.index);
        cursor = m.index + m[0].length;
      }
      if (!times.length) continue;
      text = (text + raw.slice(cursor)).replace(/\s+/g, ' ').trim();
      if (!text) continue;
      for (var j = 0; j < times.length; j++) out.push({ t: times[j], text: text });
    }
    out.sort(function (a, b) { return a.t - b.t; });
    return out;
  }

  function fillGaps(stamps, n) {
    var known = [];
    for (var i = 0; i < n; i++) if (stamps[i] != null) known.push(i);
    if (known.length < 2) {
      for (var a = 0; a < n; a++) if (stamps[a] == null) stamps[a] = a * READ_PACE;
      return stamps;
    }
    var sum = 0;
    var cnt = 0;
    for (var k = 1; k < known.length; k++) {
      sum += (stamps[known[k]] - stamps[known[k - 1]]) / (known[k] - known[k - 1]);
      cnt++;
    }
    var step = Math.min(10, Math.max(1.5, sum / cnt));
    for (var f = known[0] + 1; f < n; f++) if (stamps[f] == null) stamps[f] = stamps[f - 1] + step;
    for (var b = known[0] - 1; b >= 0; b--) if (stamps[b] == null) stamps[b] = Math.max(0, stamps[b + 1] - step);
    return stamps;
  }

  function transferTimings(plain, keys, candidates) {
    var donor = null;
    var donorHits = 0;
    for (var i = 0; i < candidates.length; i++) {
      var c = candidates[i];
      if (!c || !c.syncedLyrics) continue;
      var syn = parseLrc(c.syncedLyrics);
      if (syn.length < 4) continue;
      var hits = 0;
      for (var j = 0; j < syn.length; j++) if (keys.has(squash(syn[j].text))) hits++;
      if (hits > donorHits) { donorHits = hits; donor = syn; }
    }
    if (!donor || donorHits < 4) return null;
    var stamps = new Array(plain.length).fill(null);
    var cursor = 0;
    var hits2 = 0;
    for (var d = 0; d < donor.length; d++) {
      var key = squash(donor[d].text);
      if (!key) continue;
      var found = -1;
      var stop = Math.min(plain.length, cursor + 6);
      for (var p = cursor; p < stop; p++) {
        if (squash(plain[p]) === key) { found = p; break; }
      }
      if (found < 0) continue;
      stamps[found] = donor[d].t;
      cursor = found + 1;
      hits2++;
    }
    if (hits2 < Math.max(3, plain.length * 0.3)) return null;
    return fillGaps(stamps, plain.length);
  }

  function rank(rec, want) {
    var t = squash(rec.trackName || rec.name || '');
    var a = squash(rec.artistName || '');
    var al = squash(rec.albumName || '');
    var wt = squash(want.title);
    var wa = squash(want.artist);
    var wal = squash(want.album);
    var s = 0;
    if (t && t === wt) s += 100;
    else if (t && wt && (t.indexOf(wt) >= 0 || wt.indexOf(t) >= 0)) s += 45;
    if (a && wa) {
      if (a === wa) s += 50;
      else if (a.indexOf(wa) >= 0 || wa.indexOf(a) >= 0) s += 20;
    }
    if (al && wal && al === wal) s += 25;
    if (want.duration > 0 && rec.duration > 0) s += Math.max(0, 30 - Math.abs(rec.duration - want.duration) * 2);
    return s;
  }

  function readIdx() {
    try { return JSON.parse(localStorage.getItem(LS_IDX) || '[]'); } catch (e) { return []; }
  }

  function cacheGet(key) {
    var raw;
    try { raw = localStorage.getItem(LS + key); } catch (e) { return undefined; }
    if (!raw) return undefined;
    var rec;
    try { rec = JSON.parse(raw); } catch (e) { return undefined; }
    var ttl = rec.d ? TTL_OK : TTL_MISS;
    if (Date.now() - (rec.a || 0) > ttl) return undefined;
    return rec;
  }

  function cacheSet(key, data) {
    try { localStorage.setItem(LS + key, JSON.stringify({ a: Date.now(), d: data || null })); } catch (e) { }
    var idx = readIdx().filter(function (k) { return k !== key; });
    idx.unshift(key);
    while (idx.length > CACHE_MAX) {
      try { localStorage.removeItem(LS + idx.pop()); } catch (e) { }
    }
    try { localStorage.setItem(LS_IDX, JSON.stringify(idx)); } catch (e) { }
  }

  function offsetGet(key) {
    try { return Number(localStorage.getItem(LS + 'off:' + key)) || 0; } catch (e) { return 0; }
  }

  function offsetSet(key, v) {
    try {
      if (v) localStorage.setItem(LS + 'off:' + key, String(v));
      else localStorage.removeItem(LS + 'off:' + key);
    } catch (e) { }
  }

  function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  function getJson(path, params) {
    var clean = {};
    if (params) {
      for (var key in params) {
        var val = params[key];
        if (val !== undefined && val !== null && val !== '') clean[key] = val;
      }
    }
    var qs = new URLSearchParams(clean).toString();
    var url = API + path + (qs ? '?' + qs : '');
    return new Promise(function (resolve) {
      var attempt = 0;
      function run() {
        attempt++;
        var ctl = new AbortController();
        var timer = setTimeout(function () { ctl.abort(); }, 9000);
        fetch(url, { signal: ctl.signal, headers: { Accept: 'application/json' } })
          .then(function (res) {
            if (res.status === 404) return resolve({ miss: true });
            if (res.status === 429) {
              var ra = Number(res.headers.get('Retry-After'));
              return sleep(Math.min(4000, (Number.isFinite(ra) && ra > 0 ? ra : 1.5) * 1000)).then(run);
            }
            if (!res.ok) return resolve(null);
            return res.json().then(function (j) { resolve({ data: j }); });
          })
          .catch(function () {
            if (attempt < 2) return sleep(400).then(run);
            resolve(null);
          })
          .then(function () { clearTimeout(timer); }, function () { clearTimeout(timer); });
      }
      run();
    });
  }

  function fetchLyrics(want) {
    var title = String(want.title || '').trim();
    if (!title) return Promise.resolve(null);

    return getJson('/get', {
      track_name: title,
      artist_name: want.artist || undefined,
      album_name: want.album || undefined,
      duration: want.duration > 0 ? String(Math.round(want.duration)) : undefined
    }).then(function (r1) {
      if (r1 && r1.data) return [r1.data];
      return getJson('/search', { track_name: title, artist_name: want.artist || undefined })
        .then(function (r2) {
          if (r2 && Array.isArray(r2.data) && r2.data.length) return r2.data;
          var q = ((want.artist || '') + ' ' + title).trim();
          return getJson('/search', { q: q }).then(function (r3) {
            return r3 && Array.isArray(r3.data) ? r3.data : [];
          });
        });
    }).then(function (list) {
      var usable = list.filter(function (r) { return r && !r.instrumental && (r.syncedLyrics || r.plainLyrics); });
      if (!usable.length) {
        var inst = list.find(function (r) { return r && r.instrumental; });
        return inst ? { kind: 'instrumental', lines: [] } : null;
      }
      usable.sort(function (a, b) { return rank(b, want) - rank(a, want); });
      var best = usable[0];
      if (best.syncedLyrics) {
        var syn = parseLrc(best.syncedLyrics);
        if (syn.length) return { kind: 'synced', lines: syn, source: 'lrclib' };
      }
      var plain = splitPlain(best.plainLyrics);
      if (!plain.length) return null;
      var keys = new Set(plain.map(squash).filter(Boolean));
      var stamps = transferTimings(plain, keys, usable);
      if (stamps) {
        return { kind: 'static', lines: plain.map(function (text, i) { return { t: stamps[i], text: text }; }), source: 'lrclib' };
      }
      return {
        kind: 'static',
        lines: plain.map(function (text, i) { return { t: i * READ_PACE, text: text }; }),
        source: 'lrclib'
      };
    });
  }

  var STYLE = [
    ':host{display:block}',
    '*{box-sizing:border-box}',
    'ha-card{display:block;box-shadow:none;border-radius:12px;padding:12px 16px 8px;overflow:hidden;background:var(--ha-card-background,var(--card-background-color,#1c1c1e))}',
    ':host{--ha-lyrics-primary:var(--primary-text-color,#e1e1e1);--ha-lyrics-secondary:var(--secondary-text-color,#9b9b9b);--ha-lyrics-accent:var(--primary-color,#03a9f4)}',
    '.head{display:flex;align-items:flex-start;gap:8px;min-height:34px}',
    '.who{flex:1;min-width:0}',
    '.title{font-size:15px;font-weight:600;color:var(--ha-lyrics-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.sub{font-size:12px;color:var(--ha-lyrics-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px}',
    '.dots{display:flex;gap:5px;align-items:center;padding-top:5px;flex:none}',
    '.dot{width:6px;height:6px;border-radius:50%;background:var(--disabled-text-color,#9a9a9a);opacity:.45;cursor:pointer;transition:opacity .15s,width .15s}',
    '.dot.on{opacity:1;background:var(--ha-lyrics-accent);width:16px;border-radius:3px}',
    '.vp{margin:2px -16px 0;overflow:hidden;touch-action:pan-y}',
    '.pane{padding:0 16px;transition:transform .22s cubic-bezier(.4,0,.2,1),opacity .22s;will-change:transform}',
    '.vp.drag .pane{transition:none}',
    '.stage{position:relative;overflow-y:auto;overflow-x:hidden;scrollbar-width:none;-webkit-mask-image:linear-gradient(180deg,transparent 0,#000 22%,#000 78%,transparent 100%);mask-image:linear-gradient(180deg,transparent 0,#000 22%,#000 78%,transparent 100%)}',
    '.stage::-webkit-scrollbar{display:none}',
    '.lines{min-height:100%}',
    '.l{color:var(--ha-lyrics-secondary);opacity:.32;transition:opacity .25s,color .25s,transform .25s;text-align:center;padding:2px 4px;transform:scale(.97)}',
    '.l.on{color:var(--ha-lyrics-primary);opacity:1;font-weight:600;transform:scale(1)}',
    '.l.msg{opacity:.6;font-style:italic}',
    '.foot{display:flex;align-items:center;gap:10px;margin-top:6px}',
    '.prog{flex:1;height:3px;border-radius:2px;background:var(--divider-color,rgba(127,127,127,.25));overflow:hidden}',
    '.prog i{display:block;height:100%;background:var(--ha-lyrics-accent);border-radius:2px;transition:width .3s linear}',
    '.ctl{display:flex;align-items:center;gap:2px;flex:none}',
    '.ctl[hidden]{display:none}',
    '.mini{all:unset;cursor:pointer;font-size:12px;line-height:1;padding:4px 5px;border-radius:6px;color:var(--ha-lyrics-secondary);min-width:22px;text-align:center;user-select:none;-webkit-tap-highlight-color:transparent}',
    '.mini:hover{background:var(--secondary-background-color,#8883);color:var(--ha-lyrics-primary)}',
    '.offv{font-size:11px;color:var(--ha-lyrics-secondary);min-width:34px;text-align:center;font-variant-numeric:tabular-nums}'
  ].join('');

  var MARKUP = [
    '<ha-card>',
    '  <div class="head">',
    '    <div class="who"><div class="title"></div><div class="sub"></div></div>',
    '    <div class="dots"></div>',
    '  </div>',
    '  <div class="vp"><div class="pane">',
    '    <div class="stage"><div class="lines"></div></div>',
    '  </div></div>',
    '  <div class="foot">',
    '    <div class="prog"><i></i></div>',
    '    <div class="ctl" hidden>',
    '      <button class="mini" data-act="off-" title="Nudge earlier">&#8722;</button>',
    '      <span class="offv">0s</span>',
    '      <button class="mini" data-act="off+" title="Nudge later">+</button>',
    '      <button class="mini" data-act="reset" title="Reset offset">&#8634;</button>',
    '      <button class="mini" data-act="reload" title="Refetch lyrics">&#10227;</button>',
    '    </div>',
    '  </div>',
    '</ha-card>'
  ].join('\n');

  class HaLyricsCard extends HTMLElement {
    constructor() {
      super();
      this.idx = 0;
      this.config = null;
      this.drag = null;
    }

    set hass(h) {
      this._hass = h;
      if (this.config) this._render();
    }

    get hass() {
      return this._hass;
    }

    connectedCallback() {
    if (!this.root) {
      this.root = this.attachShadow({ mode: 'open' });
      this.root.innerHTML = '<style>' + STYLE + '</style>' + MARKUP;
      this.el = {
        title: this.root.querySelector('.title'),
        sub: this.root.querySelector('.sub'),
        dots: this.root.querySelector('.dots'),
        vp: this.root.querySelector('.vp'),
        pane: this.root.querySelector('.pane'),
        stage: this.root.querySelector('.stage'),
        lines: this.root.querySelector('.lines'),
        prog: this.root.querySelector('.prog'),
        bar: this.root.querySelector('.prog i'),
        ctl: this.root.querySelector('.ctl'),
        offv: this.root.querySelector('.offv')
      };
      this._onClick = this._onClick.bind(this);
      this._onHold = this._onHold.bind(this);
      this._onWheel = this._onWheel.bind(this);
      this._onDown = this._onDown.bind(this);
      this._onMove = this._onMove.bind(this);
      this._onUp = this._onUp.bind(this);
      this._tick = this._tick.bind(this);
      this.el.ctl.addEventListener('click', this._onClick);
      this.el.ctl.addEventListener('pointerdown', this._onHold);
      this.el.offv.addEventListener('wheel', this._onWheel, { passive: false });
      this.el.vp.addEventListener('pointerdown', this._onDown);
      this.el.vp.addEventListener('pointermove', this._onMove);
      this.el.vp.addEventListener('pointerup', this._onUp);
      this.el.vp.addEventListener('pointercancel', this._onUp);
    }
    if (!this.timer) this.timer = setInterval(this._tick, TICK);
    this._applyMetrics();
    if (this.config) {
      this._renderLines(true);
      this._render();
    }
  }

  disconnectedCallback() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  setConfig(cfg) {
    this.config = Object.assign({
      entities: [],
      max_lines: 7,
      font_size: 28,
      line_height: 38,
      smooth: true,
      show_progress: true
    }, cfg || {});
    if (!this.el) return;
    this._applyMetrics();
    this._renderLines(true);
    if (this._hass) this._render();
  }

  getCardSize() {
    var lines = this.config ? this.config.max_lines : 7;
    return Math.max(2, Math.ceil(lines / 2) + 1);
  }

  getStubConfig() {
    var ids = Object.keys((this._hass && this._hass.states) || {}).filter(function (i) {
      return i.indexOf('media_player.') === 0;
    });
    return { type: 'custom:ha-lyrics-card', entities: ids.length ? [ids[0]] : [] };
  }

  _applyMetrics() {
    if (!this.config || !this.el) return;
    this.el.stage.style.height = (this.config.max_lines * this.config.line_height) + 'px';
    this.el.lines.style.fontSize = this.config.font_size + 'px';
    this.el.lines.style.lineHeight = this.config.line_height + 'px';
    this.el.prog.hidden = this.config.show_progress === false;
  }

  _collect(states) {
    var pool = this.config.entities && this.config.entities.length ? this.config.entities : null;
    var groups = new Map();
    var order = [];
    var ids = Object.keys(states || {});
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      if (id.indexOf('media_player.') !== 0) continue;
      if (pool && pool.indexOf(id) < 0) continue;
      var s = states[id];
      if (!s || s.state !== 'playing') continue;
      var a = s.attributes || {};
      var title = String(a.media_title || '').trim();
      if (!title) continue;
      var gk = squash(a.media_artist) + '|' + squash(title);
      var g = groups.get(gk);
      if (!g) {
        g = {
          k: gk,
          title: title,
          artist: a.media_artist || '',
          album: a.media_album || '',
          duration: Number(a.media_duration) || 0,
          entity: id,
          also: []
        };
        groups.set(gk, g);
        order.push(g);
      }
      if (!g.duration && a.media_duration) g.duration = Number(a.media_duration) || 0;
      if (g.also.indexOf(id) < 0) g.also.push(id);
    }
    if (this._keys) {
      var prev = this._keys;
      order.sort(function (x, y) {
        var a = prev.indexOf(x.k);
        var b = prev.indexOf(y.k);
        return (a < 0 ? 999 : a) - (b < 0 ? 999 : b);
      });
    }
    this._keys = order.map(function (g) { return g.k; });
    this._tracks = order;
    if (this.idx >= order.length) this.idx = 0;
    return order;
  }

  _render() {
    if (!this.el || !this._hass) return;
    var order = this._collect(this._hass.states);
    var track = order[this.idx] || null;    var gk = track ? track.k : null;
    if (gk !== this.loadedKey) {
      this.loadedKey = gk;
      this._load(track);
    }
    this._head(order, track);
    this._update(false);
  }

  _setText(el, text) {
    if (el.textContent !== text) el.textContent = text;
  }

  _head(order, track) {
    var e = this.el;
    if (!track) {
      this._setText(e.title, 'Lyrics');
      var any = 0;
      var s = this._hass.states || {};
      for (var id in s) { if (id.indexOf('media_player.') === 0) { any++; } }
      this._setText(e.sub, any ? 'Nothing playing' : 'No media players found');
      if (this._dots !== 0) { e.dots.textContent = ''; this._dots = 0; }
      e.dots.style.display = 'none';
      e.ctl.hidden = true;
      return;
    }
    var states = this._hass.states || {};
    var friendly = (states[track.entity] || {}).attributes;
    friendly = (friendly && friendly.friendly_name) || track.entity;
    this._setText(e.title, track.title);
    var bits = [];
    if (track.artist) bits.push(track.artist);
    if (track.also.length > 1) bits.push(friendly + ' +' + (track.also.length - 1));
    else bits.push(friendly);
    this._setText(e.sub, bits.join(' \u00b7 '));
    var sig = this._keys.join(',') + '|' + this.idx;
    if (sig !== this._dots) {
      e.dots.textContent = '';
      for (var i = 0; i < order.length; i++) {
        var d = document.createElement('div');
        d.className = 'dot' + (i === this.idx ? ' on' : '');
        d.dataset.i = String(i);
        e.dots.appendChild(d);
      }
      this._dots = sig;
    }
    e.dots.style.display = order.length < 2 ? 'none' : '';
    e.ctl.hidden = !(this.data && this.data.kind === 'static');
  }

  _load(track, force) {
    if (!track) {
      this.data = null;
      this.msg = '';
      this._renderLines(true);
      return;
    }
    var self = this;
    var key = track.k;
    var rec = force ? undefined : cacheGet(key);
    if (rec) {
      this.data = rec.d;
      this.msg = rec.d ? '' : 'No lyrics found';
      this.offset = offsetGet(key);
      this._renderLines(true);
      this._syncOffset();
      this._anchor();
      this._update(true);
      return;
    }
    this.data = null;
    this.msg = 'Fetching lyrics\u2026';
    this.offset = 0;
    this._renderLines(true);
    this._anchor();
    this._update(true);
    fetchLyrics({
      title: track.title,
      artist: track.artist,
      album: track.album,
      duration: track.duration
    }).then(function (data) {
      cacheSet(key, data);
      if (self.loadedKey !== key || !self._hass) return;
      self.data = data;
      self.msg = data ? '' : 'No lyrics found';
      self.offset = offsetGet(key);
      self._renderLines(true);
      self._syncOffset();
      self._render();
      self._update(true);
    });
  }

  _renderLines() {
    var box = this.el.lines;
    box.textContent = '';
    this.lineEls = [];
    this.active = -1;
    this._scrollTarget = null;
    this._barPct = -1;
    var d = this.data;
    if (!d || !d.lines || !d.lines.length) {
      var text = d && d.kind === 'instrumental' ? '\u266a  Instrumental' : (this.msg || 'Nothing playing');
      var m = document.createElement('div');
      m.className = 'l msg';
      m.textContent = text;
      box.appendChild(m);
      this.lineEls = [m];
      return;
    }
    var frag = document.createDocumentFragment();
    for (var i = 0; i < d.lines.length; i++) {
      var el = document.createElement('div');
      el.className = 'l';
      el.textContent = d.lines[i].text;
      frag.appendChild(el);
      this.lineEls.push(el);
    }
    box.appendChild(frag);
  }

  _anchor() {
    var track = this._track();
    if (!track) { this.anchor = null; return; }
    var s = (this._hass.states || {})[track.entity];
    if (!s) { this.anchor = null; return; }
    var p = Number(s.attributes && s.attributes.media_position);
    if (!Number.isFinite(p)) p = 0;
    this.anchor = { pos: p, raw: p, at: Date.now(), playing: s.state === 'playing' };
  }

  _track() {
    return this._tracks ? (this._tracks[this.idx] || null) : null;
  }

  _position() {
    var track = this._track();
    if (!track) return 0;
    var s = (this._hass.states || {})[track.entity];
    if (!s) return 0;
    var a = s.attributes || {};
    var p = Number(a.media_position);
    if (Number.isFinite(p)) {
      if (!this.anchor || Math.abs(p - this.anchor.raw) > 0.5) {
        this.anchor = { pos: p, raw: p, at: Date.now(), playing: s.state === 'playing' };
      }
    }
    var an = this.anchor;
    var pos = an ? an.pos : 0;
    if (an && an.playing && s.state === 'playing') pos += (Date.now() - an.at) / 1000;
    var dur = Number(a.media_duration) || track.duration || 0;
    if (dur > 0 && pos > dur + 1.5) pos = 0;
    if (pos < 0) pos = 0;
    return pos;
  }

  _update(force) {
    if (!this.data || !this.data.lines || !this.lineEls || !this.lineEls.length) return;
    var raw = this._position();
    var pos = raw + (this.data.kind === 'static' ? (this.offset || 0) : 0);
    var lines = this.data.lines;
    var idx = 0;
    while (idx + 1 < lines.length && lines[idx + 1].t <= pos) idx++;
    if (idx !== this.active || force) {
      var els = this.lineEls;
      for (var i = 0; i < els.length; i++) {
        els[i].className = 'l' + (i === idx ? ' on' : '');
      }
      this.active = idx;
      this._scrollTo(els[idx]);
    }
    var track = this._track();
    var dur = track ? (Number(track.duration) || 0) : 0;
    if (dur > 0) {
      var pct = Math.round(Math.max(0, Math.min(100, (raw / dur) * 100)) * 2) / 2;
      if (pct !== this._barPct) {
        this._barPct = pct;
        this.el.bar.style.width = pct + '%';
      }
    }
  }

  _scrollTo(el) {
    if (!el) return;
    var stage = this.el.stage;
    var top = Math.max(0, el.offsetTop - stage.clientHeight / 2 + el.offsetHeight / 2);
    if (this._scrollTarget != null && Math.abs(this._scrollTarget - top) < 1.5) return;
    this._scrollTarget = top;
    var smooth = this.config.smooth !== false &&
      typeof window.matchMedia === 'function' &&
      (!window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    stage.scrollTo({ top: top, behavior: smooth ? 'smooth' : 'auto' });
  }

  _tick() {
    if (!this._hass) return;
    var track = this._track();
    if (!track) return;
    this._update(false);
  }

  _syncOffset() {
    var v = this.offset || 0;
    this.el.offv.textContent = (v > 0 ? '+' : '') + v + 's';
  }

  _nudge(d) {
    var track = this._track();
    if (!track) return;
    var v = Math.max(-120, Math.min(120, (this.offset || 0) + d));
    this.offset = v;
    offsetSet(track.k, v);
    this._syncOffset();
    this._update(true);
  }

  _onClick(ev) {
    if (this._held && Date.now() - this._held < 500) { this._held = 0; return; }
    var b = ev.target.closest ? ev.target.closest('[data-act]') : null;
    if (b) {
      var act = b.dataset.act;
      if (act === 'off-') this._nudge(-1);
      else if (act === 'off+') this._nudge(1);
      else if (act === 'reset') { this.offset = 0; var t = this._track(); if (t) offsetSet(t.k, 0); this._syncOffset(); this._update(true); }
      else if (act === 'reload') {
        var tr = this._track();
        if (tr) this._load(tr, true);
      }
      return;
    }
    var dot = ev.target.closest ? ev.target.closest('.dot') : null;
    if (dot) this._go(Number(dot.dataset.i));
  }

  _onHold(ev) {
    var b = ev.target.closest ? ev.target.closest('[data-act]') : null;
    if (!b) return;
    var act = b.dataset.act;
    if (act !== 'off-' && act !== 'off+') return;
    var step = act === 'off+' ? 1 : -1;
    var delay = 380;
    var hold = setTimeout(function tick() {
      this._held = Date.now();
      this._nudge(step);
      delay = 110;
      hold = setTimeout(tick.bind(this), delay);
    }.bind(this), delay);
    var stop = function () {
      clearTimeout(hold);
      document.removeEventListener('pointerup', stop);
    };
    document.addEventListener('pointerup', stop);
  }

  _onWheel(ev) {
    ev.preventDefault();
    this._nudge(ev.deltaY < 0 ? 1 : -1);
  }

  _onDown(ev) {
    if (ev.button != null && ev.button !== 0) return;
    if (ev.target.closest && ev.target.closest('[data-act],.dot')) return;
    this.drag = { x: ev.clientX, y: ev.clientY, t: Date.now(), dx: 0, live: false, id: ev.pointerId };
  }

  _onMove(ev) {
    var d = this.drag;
    if (!d || d.id !== ev.pointerId) return;
    var dx = ev.clientX - d.x;
    var dy = ev.clientY - d.y;
    if (!d.live) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      if (Math.abs(dx) <= Math.abs(dy)) { this.drag = null; return; }
      d.live = true;
      this.el.vp.classList.add('drag');
    }
    d.dx = dx;
    this.el.pane.style.transform = 'translateX(' + (dx * 0.65) + 'px)';
  }

  _onUp(ev) {
    var d = this.drag;
    this.drag = null;
    this.el.vp.classList.remove('drag');
    this.el.pane.style.transform = '';
    if (!d) return;
    if (!d.live) {
      if (Date.now() - d.t < 400) this._next(ev.clientX < d.x ? 1 : -1);
      return;
    }
    if (Math.abs(d.dx) > SWIPE_PX) this._go(this.idx + (d.dx < 0 ? 1 : -1));
  }

  _next(dir) {
    if (!this._keys || this._keys.length < 2) return;
    this._go(this.idx + dir);
  }

  _go(i) {
    var n = this._keys ? this._keys.length : 0;
    if (n < 2) return;
    var next = ((i % n) + n) % n;
    if (next === this.idx) return;
    var dir = i > this.idx ? 1 : -1;
    var self = this;
    this.el.pane.style.transition = 'none';
    this.el.pane.style.transform = 'translateX(' + (dir * -26) + 'px)';
    this.el.pane.style.opacity = '0';
    this.idx = next;
    this._render();
    requestAnimationFrame(function () {
      self.el.pane.style.transition = '';
      self.el.pane.style.transform = 'translateX(' + (dir * 26) + 'px)';
      self.el.pane.style.opacity = '1';
      requestAnimationFrame(function () {
        self.el.pane.style.transform = '';
      });
    });
  }
  }

  window.customCards = window.customCards || [];
  window.customCards.push({
    type: 'ha-lyrics-card',
    name: 'Lyrics Card',
    description: 'Synced lyrics for whatever is playing, from any media player.',
    preview: false
  });

  window.HaLyricsCard = HaLyricsCard;
  if (!customElements.get('ha-lyrics-card')) {
    customElements.define('ha-lyrics-card', HaLyricsCard);
  }
})();
