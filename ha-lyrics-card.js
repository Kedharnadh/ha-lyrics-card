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
  var F_PAUSE = 2, F_SEEK = 4, F_VOLUME_SET = 16, F_VOLUME_MUTE = 32;
  var F_PREV = 64, F_NEXT = 128, F_TURN_ON = 256, F_TURN_OFF = 512, F_VOLUME_STEP = 2048;
  var LAYOUTS = ['focus', 'karaoke', 'compact', 'two_line', 'minimal'];
  var ALIGNS = { left: 'left', center: 'center', right: 'right' };

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

  function videoTitle(t) {
    return String(t || '')
      .replace(/\s*(?:\[|\()\s*(?:official\s+(?:lyric(?:s)?\s?video|video|audio)|lyric(?:s)?\s?video|audio|visualizer|hd|hq|4k|8k|1080p|720p|480p|explicit)[^)\]]*(?:\)|\])\s*$/i, '')
      .replace(/\s*[-–—|]\s*(?:official\s+(?:lyric(?:s| video)?|video|audio)|lyric(?:s| video)?|audio|visualizer)\s*$/i, '')
      .trim();
  }

  function videoArtist(a) {
    var s = String(a || '').trim();
    s = s.replace(/\s*[-–—]\s*(?:topic|vevo)\s*$/i, '').trim();
    if (/^(youtube|yt)$/i.test(s)) return '';
    return s;
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
    var title = videoTitle(want.title);
    var artist = videoArtist(want.artist);
    if (!title) title = String(want.title || '').trim();
    if (!title) return Promise.resolve(null);
    var want2 = {
      title: title,
      artist: artist || want.artist || '',
      album: want.album || '',
      duration: want.duration > 0 ? want.duration : 0
    };

    return getJson('/get', {
      track_name: title,
      artist_name: want2.artist || undefined,
      album_name: want2.album || undefined,
      duration: want2.duration > 0 ? String(Math.round(want2.duration)) : undefined
    }).then(function (r1) {
      if (r1 && r1.data) return [r1.data];
      return getJson('/search', { track_name: title, artist_name: want2.artist || undefined })
        .then(function (r2) {
          if (r2 && Array.isArray(r2.data) && r2.data.length) return r2.data;
          var q = ((want2.artist || '') + ' ' + title).trim();
          return getJson('/search', { q: q }).then(function (r3) {
            if (r3 && Array.isArray(r3.data) && r3.data.length) return r3.data;
            var q2 = title.replace(/\s*[-–—].+$/, '').trim();
            return q2 ? getJson('/search', { q: q2 }).then(function (r4) {
              return r4 && Array.isArray(r4.data) ? r4.data : [];
            }) : [];
          });
        });
    }).then(function (list) {
      var usable = list.filter(function (r) { return r && !r.instrumental && (r.syncedLyrics || r.plainLyrics); });
      if (!usable.length) {
        var inst = list.find(function (r) { return r && r.instrumental; });
        return inst ? { kind: 'instrumental', lines: [] } : null;
      }
      usable.sort(function (a, b) { return rank(b, want2) - rank(a, want2); });
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
        return { kind: 'synced', lines: plain.map(function (text, i) { return { t: stamps[i], text: text }; }), source: 'lrclib' };
      }
      return {
        kind: 'static',
        lines: plain.map(function (text, i) { return { t: i * READ_PACE, text: text }; }),
        source: 'lrclib'
      };
    });
  }

  var MA_PROVIDER_RE = /^[a-z0-9][a-z0-9_.-]*$/i;

  function maTrackRef(uri) {
    if (typeof uri !== 'string') return null;
    var u = uri.trim();
    if (!u) return null;
    var provider, type, itemId;
    if (u.indexOf('://') >= 0 && u.split('/').length >= 4) {
      var rest = u.split('://').slice(1).join('://');
      provider = u.split('://')[0];
      var seg = rest.split('/');
      type = seg[0];
      itemId = seg.slice(1).join('/');
    } else if (u.indexOf(':') >= 0 && u.split(':').length === 3) {
      var p2 = u.split(':');
      provider = p2[0];
      type = p2[1];
      itemId = p2[2];
    } else {
      return null;
    }
    if (type !== 'track') return null;
    if (!MA_PROVIDER_RE.test(provider)) return null;
    if (!itemId || /[\s]/.test(itemId)) return null;
    return { provider: provider, item_id: itemId, uri: u };
  }

  function maSocketUrl(raw) {
    var u = String(raw == null ? '' : raw).trim();
    if (!u) return '';
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) u = 'http://' + u.replace(/^\/+/, '');
    var url;
    try {
      url = new URL(u);
    } catch (e) {
      return '';
    }
    if (url.protocol === 'https:') url.protocol = 'wss:';
    else if (url.protocol === 'http:') url.protocol = 'ws:';
    else if (url.protocol !== 'ws:' && url.protocol !== 'wss:') return '';
    if (!url.port) url.port = '8095';
    var base = url.pathname.replace(/\/+$/, '');
    if (!/\/ws$/.test(base)) base += '/ws';
    url.pathname = base;
    url.search = '';
    url.hash = '';
    return url.toString();
  }

  function maCall(socketUrl, token, send, ms) {
    return new Promise(function (resolve, reject) {
      var ws;
      try {
        ws = new WebSocket(socketUrl);
      } catch (e) {
        reject(new Error('ma socket'));
        return;
      }
      var nextId = 0;
      var done = false;
      var timer = setTimeout(function () { finish(new Error('ma timeout')); }, ms);
      function finish(err, val) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try { ws.close(); } catch (e2) { }
        if (err) reject(err);
        else resolve(val);
      }
      function command(name, args) {
        nextId += 1;
        ws.send(JSON.stringify({ command: name, args: args, message_id: nextId }));
        return nextId;
      }
      ws.onopen = function () {
        try {
          command('auth', { token: token });
        } catch (e) {
          finish(new Error('ma send'));
        }
      };
      ws.onerror = function () { finish(new Error('ma socket')); };
      ws.onclose = function () { finish(new Error('ma closed')); };
      ws.onmessage = function (ev) {
        var msg;
        try {
          msg = JSON.parse(ev.data);
        } catch (e) {
          return;
        }
        if (!msg || typeof msg !== 'object') return;
        if (nextId === 1 && msg.message_id === 1) {
          if (msg.error_code || msg.error_message || msg.success === false) {
            finish(new Error('ma auth'));
            return;
          }
          try {
            command('metadata/get_track_lyrics', { track: send });
          } catch (e) {
            finish(new Error('ma send'));
          }
          return;
        }
        if (msg.message_id === 2) {
          if (msg.error_code || msg.error_message || msg.success === false) {
            finish(new Error('ma command'));
            return;
          }
          finish(null, msg.result);
        }
      };
    });
  }

  function fetchMaLyrics(ref, cfg) {
    var socketUrl = maSocketUrl(cfg.music_assistant_url);
    if (!socketUrl || !cfg.music_assistant_token || !ref) return Promise.resolve(null);
    var timeout = cfg.music_assistant_timeout * 1000;
    return maCall(
      socketUrl,
      cfg.music_assistant_token,
      {
        item_id: ref.item_id,
        provider: ref.provider,
        media_type: 'track',
        uri: ref.uri
      },
      timeout
    ).then(function (result) {
      var pair = Array.isArray(result) ? result : null;
      var plain = pair && typeof pair[0] === 'string' ? pair[0] : '';
      var lrc = pair && typeof pair[1] === 'string' ? pair[1] : '';
      var body = (lrc || plain || '').trim();
      if (!body) return null;
      var stamped = parseLrc(body);
      if (stamped.length) {
        return { kind: 'synced', lines: stamped, source: 'music_assistant' };
      }
      var texts = splitPlain(body);
      if (!texts.length) return null;
      return {
        kind: 'static',
        lines: texts.map(function (t, i) { return { t: i * READ_PACE, text: t }; }),
        source: 'music_assistant'
      };
    }).catch(function () {
      return null;
    });
  }

  var DEFAULTS = {
    entities: [],
    layout: 'focus',
    alignment: 'center',
    font_family: 'system-ui',
    font_size: 26,
    font_weight: 700,
    line_height: 38,
    max_lines: 7,
    card_height: '',
    height: 0,
    inactive_opacity: 0.35,
    active_scale: 1.12,
    show_previous: true,
    show_upcoming: true,
    sync_offset: 0,
    show_sync_slider: true,
    smooth: true,
    show_track_info: true,
    show_friendly_name: true,
    track_info_font_size: 13,
    header_font_size: 0,
    header_alignment: 'inherit',
    header_layout: 'combined',
    show_media_controls: true,
    media_controls_size: 30,
    media_icon_style: 'standard',
    show_progress: true,
    show_volume: true,
    show_mute: true,
    show_power: false,
    text_color: '',
    highlight_color: '',
    text_color_mode: 'auto',
    show_intro: true,
    intro_duration: 3,
    intro_font_size: 48,
    background_mode: 'artwork',
    background_opacity: 1,
    art_size: 42,
    show_album_art: true,
    artwork_blur: 14,
    artwork_opacity: 1,
    artwork_overlay_opacity: 0.4,
    contrast_mode: 'adaptive',
    backdrop_blur: 10,
    backdrop_opacity: 0.22,
    text_shadow: true,
    text_shadow_strength: 0.6,
    plain_lyrics_auto_scroll: true,
    static_scroll: true,
    static_font_size: 18,
    static_scroll_speed: 14,
    lyrics_source: 'lrclib',
    music_assistant_url: '',
    music_assistant_token: '',
    music_assistant_timeout: 8
  };

  function num(v, dflt, lo, hi) {
    var n = Number(v);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
  }

  function str(v) {
    return typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim();
  }

  function bool(v, dflt) {
    return v === undefined ? dflt : !!v;
  }

  function hex(v) {
    if (typeof v !== 'string') return '';
    v = v.trim();
    return /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v) ? v : '';
  }

  function cssLen(v) {
    var s = str(v);
    if (!s) return '';
    if (/^\d+(\.\d+)?(px|vh|vw|em|rem|%)?$/.test(s) && parseFloat(s) >= 0) return s;
    return '';
  }

  function cssSafe(v) {
    return String(v == null ? '' : v).replace(/[<>{};]/g, '');
  }

  function fontFamily(v) {
    return cssSafe(str(v)).replace(/[^a-zA-Z0-9 ,'\"-]/g, '');
  }

  function artUrl(a) {
    var keys = ['media_image_url', 'entity_picture', 'media_image', 'media_picture', 'media_artwork'];
    for (var i = 0; i < keys.length; i++) {
      var v = a && a[keys[i]];
      if (typeof v !== 'string') continue;
      v = v.trim();
      if (!v) continue;
      if (/^https?:\/\//i.test(v) || v.charAt(0) === '/') return v;
    }
    return '';
  }

  function fmt(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    var h = Math.floor(sec / 3600);
    var m = Math.floor(sec / 60) % 60;
    var s = sec % 60;
    var mm = String(m).padStart(h ? 2 : 1, '0');
    return (h ? h + ':' + String(m).padStart(2, '0') : mm) + ':' + String(s).padStart(2, '0');
  }

  function normalize(c) {
    var raw = c || {};
    c = Object.assign({}, DEFAULTS, raw);
    var ent = [];
    if (Array.isArray(c.entities)) ent = c.entities.slice();
    else if (typeof c.entities === 'string' && c.entities) ent = [c.entities];
    if (!ent.length && typeof c.entity === 'string' && c.entity) ent = [c.entity];
    c.entities = ent;
    c.layout = LAYOUTS.indexOf(c.layout) >= 0 ? c.layout : 'focus';
    c.alignment = ALIGNS[String(c.align != null ? c.align : c.alignment).toLowerCase()] ||
      ALIGNS[String(c.alignment).toLowerCase()] || 'center';
    c.font_family = fontFamily(c.font_family || 'system-ui');
    c.font_size = Math.round(num(c.font_size, 26, 8, 120));
    c.font_weight = Math.round(num(c.font_weight, 700, 100, 900));
    c.line_height = Math.round(num(c.line_height, 38, 12, 140));
    c.max_lines = Math.round(num(c.max_lines, 7, 1, 40));
    c.height = c.height ? Math.round(num(c.height, 0, 60, 1600)) : 0;
    c.card_height = cssLen(c.height > 0 ? '' : c.card_height);
    c.inactive_opacity = num(c.inactive_opacity, 0.35, 0, 1);
    c.active_scale = num(c.active_scale, 1.12, 1, 2.5);
    c.show_previous = bool(c.show_previous, true);
    c.show_upcoming = bool(c.show_upcoming, true);
    c.sync_offset = num(c.sync_offset, 0, -120, 120);
    c.show_sync_slider = bool(c.show_sync_slider, true);
    c.smooth = bool(c.smooth, true);
    c.show_track_info = bool(c.show_track_info, true);
    c.show_friendly_name = bool(c.show_friendly_name, true);
    c.show_header = bool(c.show_header, true);
    c.track_info_font_size = Math.round(num(c.track_info_font_size, 13, 8, 40));
    c.header_font_size = Math.round(num(c.header_font_size, 0, 0, 48));
    c.header_alignment = c.header_alignment === 'inherit' ? 'inherit' : ALIGNS[String(c.header_alignment).toLowerCase()] || 'inherit';
    c.header_layout = ['combined', 'split', 'split_reverse'].indexOf(c.header_layout) >= 0 ? c.header_layout : 'combined';
    c.show_media_controls = bool(c.show_media_controls, true);
    c.media_controls_size = Math.round(num(c.media_controls_size, 30, 24, 64));
    c.media_icon_style = ['standard', 'filled', 'minimal'].indexOf(c.media_icon_style) >= 0 ? c.media_icon_style : 'standard';
    c.show_progress = bool(c.show_progress_bar != null ? c.show_progress_bar : c.show_progress, true);
    c.progress_bar_height = Math.round(num(c.progress_bar_height, 5, 2, 16));
    c.progress_bar_color = cssSafe(c.progress_bar_color || 'var(--primary-color)');
    c.show_volume = bool(c.show_volume, true);
    c.show_mute = bool(c.show_mute, true);
    c.show_power = bool(c.show_power, false);
    c.text_color = hex(c.text_color);
    c.highlight_color = hex(c.highlight_color);
    c.text_color_mode = ['auto', 'theme', 'light', 'dark'].indexOf(c.text_color_mode) >= 0 ? c.text_color_mode : 'auto';
    c.show_intro = bool(c.show_intro, true);
    c.intro_duration = num(c.intro_duration, 3, 0, 60);
    c.intro_font_size = Math.round(num(c.intro_font_size, 48, 20, 120));
    c.background_mode = ['theme', 'artwork', 'transparent'].indexOf(c.background_mode) >= 0 ? c.background_mode : 'artwork';
    c.background_opacity = num(c.background_opacity, 1, 0, 1);
    c.show_album_art = bool(c.show_album_art, true);
    c.art_size = Math.round(num(c.art_size, 42, 0, 200));
    if (!('artwork_blur' in raw) && 'background_blur' in raw) c.artwork_blur = raw.background_blur;
    if (!('artwork_opacity' in raw) && 'background_dim' in raw) c.artwork_opacity = raw.background_dim;
    if (!('artwork_overlay_opacity' in raw) && 'background_veil' in raw) c.artwork_overlay_opacity = raw.background_veil;
    c.artwork_blur = Math.round(num(c.artwork_blur, 14, 0, 80));
    c.artwork_opacity = num(c.artwork_opacity, 1, 0, 1);
    c.artwork_overlay_opacity = num(c.artwork_overlay_opacity, 0.4, 0, 1);
    c.contrast_mode = c.contrast_mode === 'off' ? 'off' : 'adaptive';
    c.backdrop_blur = Math.round(num(c.backdrop_blur, 10, 0, 60));
    c.backdrop_opacity = num(c.backdrop_opacity, 0.22, 0, 0.9);
    c.text_shadow = bool(c.text_shadow, true);
    c.text_shadow_strength = num(c.text_shadow_strength, 0.6, 0, 1);
    c.plain_lyrics_auto_scroll = bool(c.plain_lyrics_auto_scroll, true);
    c.static_scroll = bool(c.static_scroll, true);
    c.static_font_size = Math.round(num(c.static_font_size, 18, 10, 48));
    c.static_scroll_speed = num(c.static_scroll_speed, 14, 4, 60);
    c.lyrics_source = c.lyrics_source === 'music_assistant' ? 'music_assistant' : 'lrclib';
    c.music_assistant_url = str(c.music_assistant_url);
    c.music_assistant_token = str(c.music_assistant_token);
    c.music_assistant_timeout = num(c.music_assistant_timeout, 8, 2, 30);
    return c;
  }

  var STYLE = [
    ':host{display:block}',
    '*{box-sizing:border-box}',
    'ha-card{position:relative;isolation:isolate;display:block;box-shadow:none;border-radius:14px;padding:10px 12px 8px;overflow:hidden;background:var(--ha-card-background,var(--card-background-color,#1c1c1e))}',
    ':host{--fb:26px;--lb:38px;--fw:700;--ff:system-ui;--al:center;--as:1.12;--io:.35;--npc-ts:none;--bg-blur:14px;--bg-dim:1;--bg-veil:.4;--bb:10px;--bo:.22;--art-size:42px;--static-size:18px;--th:13px;--seek-h:5px;--seek-c:var(--primary-color);--ctrl:30px;--ha-lyrics-primary:var(--primary-text-color,#e1e1e1);--ha-lyrics-secondary:var(--secondary-text-color,#9b9b9b);--ha-lyrics-accent:var(--primary-color,#03a9f4)}',
    '.bg{position:absolute;z-index:0;inset:calc(-1 * var(--bg-blur) - 16px);background-size:cover;background-position:center;filter:blur(var(--bg-blur));opacity:var(--bg-dim);pointer-events:none}',
    '.bg[hidden]{display:none}',
    'ha-card::after{content:"";position:absolute;z-index:0;inset:0;display:none;background:var(--ha-card-background,var(--card-background-color,#1c1c1e));opacity:var(--bg-veil);pointer-events:none}',
    'ha-card.has-bg::after{display:block}',
    'ha-card.has-bg.adapt::after{opacity:1;background:linear-gradient(rgba(0,0,0,var(--bo)),rgba(0,0,0,var(--bo)));backdrop-filter:blur(var(--bb)) brightness(.8);-webkit-backdrop-filter:blur(var(--bb)) brightness(.8)}',
    '.r{position:absolute;z-index:4;inset:0;display:none;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:24px;gap:6px;pointer-events:none}',
    '.r.on{display:flex}',
    '.r-t{font:700 48px/1.15 var(--ff);color:var(--ha-lyrics-primary,#e1e1e1)}',
    '.r-a{font:400 var(--th) var(--ff);color:var(--ha-lyrics-secondary,#9b9b9b)}',
    '.wrap{position:relative;z-index:2;display:flex;flex-direction:column;min-height:0}',
    'ha-card.fixed .wrap{height:100%}',
    '.head{display:flex;align-items:center;gap:10px;min-height:38px}',
    '.head[hidden]{display:none}',
    '.art{flex:none;width:var(--art-size);height:var(--art-size);border-radius:10px;overflow:hidden;background:var(--secondary-background-color,#8883)}',
    '.art[hidden]{display:none}',
    '.art img{display:block;width:100%;height:100%;object-fit:cover}',
    '.who{flex:1;min-width:0;transition:opacity .2s}',
    '.who.split,.who.split_reverse{display:flex;justify-content:space-between;gap:8px}',
    '.who.split_reverse .title{order:2;text-align:right}',
    '.title{font-size:calc(var(--th) + 2px);font-weight:600;color:var(--ha-lyrics-primary,#e1e1e1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.sub{font-size:var(--th);color:var(--ha-lyrics-secondary,#9b9b9b);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px}',
    '.dots{display:flex;gap:5px;align-items:center;flex:none}',
    '.dot{width:6px;height:6px;border-radius:50%;background:var(--disabled-text-color,#9a9a9a);opacity:.45;cursor:pointer;transition:opacity .15s,width .15s}',
    '.dot.on{opacity:1;background:var(--ha-lyrics-accent);width:16px;border-radius:3px}',
    '.controls{display:flex;align-items:center;justify-content:center;gap:6px;margin-top:6px}',
    '.controls[hidden]{display:none}',
    '.cb{all:unset;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;width:var(--ctrl);height:var(--ctrl);min-width:0;border-radius:8px;color:var(--ha-lyrics-primary,#e1e1e1);font-size:calc(var(--ctrl) * .72);line-height:1;user-select:none;-webkit-tap-highlight-color:transparent}',
    '.cb:hover{background:var(--secondary-background-color,#8883)}',
    '.cb:disabled{opacity:.28;cursor:default;background:none}',
    '.cb.playing{color:var(--ha-lyrics-accent)}',
    '.vol{flex:0 1 140px;display:flex;align-items:center;gap:6px;min-width:0;margin:0 4px;margin-left:auto}',
    '.vol[hidden]{display:none}',
    '.vol input[type=range]{flex:1;min-width:0;accent-color:var(--ha-lyrics-accent);height:20px;margin:0}',
    '.vol .vlab{font-size:12px;color:var(--ha-lyrics-secondary,#9b9b9b);min-width:32px;text-align:right;font-variant-numeric:tabular-nums}',
    '.vstep{all:unset;cursor:pointer;color:var(--ha-lyrics-primary,#e1e1e1);font-size:calc(var(--ctrl) * .6);padding:2px 10px;border-radius:6px}',
    '.vstep:hover{background:var(--secondary-background-color,#8883)}',
    '.seek{position:relative;display:flex;align-items:center;gap:8px;margin-top:8px}',
    '.seek[hidden]{display:none}',
    '.track{position:relative;flex:1;height:var(--seek-h);border-radius:99px;background:var(--divider-color,rgba(127,127,127,.3));cursor:pointer;overflow:hidden}',
    '.track i{display:block;height:100%;background:var(--seek-c);border-radius:99px;width:0}',
    '.tpos,.tdur{font-size:11px;color:var(--ha-lyrics-secondary,#9b9b9b);font-variant-numeric:tabular-nums;min-width:34px;text-align:center}',
    '.vp{margin:4px -12px 0;overflow:hidden;touch-action:pan-y}',
    '.pane{padding:0 12px;transition:transform .22s cubic-bezier(.4,0,.2,1),opacity .22s;will-change:transform}',
    '.vp.drag .pane{transition:none}',
    '.stage{position:relative;min-height:0;overflow-y:auto;overflow-x:hidden;scrollbar-width:none}',
    '.stage::-webkit-scrollbar{display:none}',
    '.stage.masked{-webkit-mask-image:linear-gradient(180deg,transparent 0,#000 22%,#000 78%,transparent 100%);mask-image:linear-gradient(180deg,transparent 0,#000 22%,#000 78%,transparent 100%)}',
    '.lines{min-height:100%}',
    '.lines.fixed{display:flex;flex-direction:column;justify-content:center}',
    '.lines.karaoke .l{line-height:calc(var(--lb) * 1.25)}',
    '.l{font:var(--fw) var(--fb)/var(--lb) var(--ff);color:var(--ha-lyrics-secondary,#9b9b9b);opacity:var(--io);padding:0 4px;border-radius:6px;text-shadow:var(--npc-ts,none);text-align:var(--al);transition:opacity .25s,color .25s,font-size .15s}',
    '.l.on{color:var(--ha-lyrics-primary,#e1e1e1);opacity:1;font-weight:var(--fw)}',
    '.l.next{opacity:.55}',
    '.l.msg{opacity:.6;font-style:italic;color:var(--ha-lyrics-secondary,#9b9b9b);text-align:center}',
    '.plain{color:var(--ha-lyrics-secondary,#9b9b9b);font-size:var(--static-size);line-height:1.6;text-align:var(--al);padding:4px;white-space:pre-wrap;opacity:.9;text-shadow:var(--npc-ts,none)}',
    '.foot{display:flex;align-items:center;gap:8px;margin-top:6px;min-height:22px}',
    '.status{flex:1;font-size:11px;color:var(--ha-lyrics-secondary,#9b9b9b);opacity:.75;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.sync{display:none;align-items:center;gap:6px;flex:none}',
    '.sync.open{display:flex}',
    '.sync input{width:96px;accent-color:var(--ha-lyrics-accent)}',
    '.sync button{all:unset;cursor:pointer;font-size:11px;color:var(--ha-lyrics-secondary,#9b9b9b);padding:2px 5px;border-radius:6px}',
    '.sync button:hover{background:var(--secondary-background-color,#8883);color:var(--ha-lyrics-primary,#e1e1e1)}',
    '.sync .sl{font-size:11px;color:var(--ha-lyrics-secondary,#9b9b9b)}',
    '.sync .sv{font-size:11px;color:var(--ha-lyrics-accent);min-width:38px;text-align:right;font-variant-numeric:tabular-nums}'
  ].join('');

  var MARKUP = [
    '<ha-card>',
    '  <div class="bg" hidden></div>',
    '  <div class="r"><div class="r-t"></div><div class="r-a"></div></div>',
'    <div class="wrap">',
    '    <div class="head">',
    '      <div class="art" hidden><img alt=""></div>',
    '      <div class="who"><div class="title"></div><div class="sub"></div></div>',
    '      <div class="dots"></div>',
    '    </div>',
    '    <div class="vp"><div class="pane">',
    '      <div class="stage"><div class="lines"></div></div>',
    '    </div></div>',
    '    <div class="foot">',
    '      <div class="status"></div>',
    '      <div class="sync">',
    '        <span class="sl">Sync</span>',
    '        <input type="range" min="-10" max="10" step="0.01">',
    '        <button data-c="syncreset" title="Reset offset">Reset</button>',
    '        <span class="sv"></span>',
    '      </div>',
    '    </div>',
    '    <div class="controls" hidden>',
    '      <button class="cb" data-c="mute" title="Mute"></button>',
    '      <button class="cb" data-c="prev" title="Previous"></button>',
    '      <button class="cb" data-c="toggle" title="Play/Pause"></button>',
    '      <button class="cb" data-c="next" title="Next"></button>',
    '      <div class="vol" hidden><input type="range" min="0" max="100" step="1"><span class="vlab"></span></div>',
    '      <button class="cb" data-c="power" title="Power"></button>',
    '    </div>',
    '    <div class="seek" hidden>',
    '      <span class="tpos"></span>',
    '      <div class="track"><i></i></div>',
    '      <span class="tdur"></span>',
    '    </div>',
    '  </div>',
    '</ha-card>'
  ].join('\n');

  function glyphs(style) {
    if (style === 'filled') return { prev: '\u23ee', play: '\u25b6', pause: '\u23f8', next: '\u23ed', power: '\u23fb' };
    if (style === 'minimal') return { prev: '\u00ab', play: '\u25ba', pause: '\u275a\u275a', next: '\u00bb', power: '\u23fb' };
    return { prev: '\u2778\u2778', play: '\u25b6', pause: '\u275a\u275a', next: '\u2779\u2779', power: '\u23fb' };
  }

  class HaLyricsCard extends HTMLElement {
    constructor() {
      super();
      this.idx = 0;
      this.config = null;
      this.drag = null;
      this.active = -1;
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
          card: this.root.querySelector('ha-card'),
          bg: this.root.querySelector('.bg'),
          art: this.root.querySelector('.art'),
          artImg: this.root.querySelector('.art img'),
          head: this.root.querySelector('.head'),
          who: this.root.querySelector('.who'),
          title: this.root.querySelector('.title'),
          sub: this.root.querySelector('.sub'),
          dots: this.root.querySelector('.dots'),
          splash: this.root.querySelector('.r'),
          splashT: this.root.querySelector('.r-t'),
          splashA: this.root.querySelector('.r-a'),
          controls: this.root.querySelector('.controls'),
          seek: this.root.querySelector('.seek'),
          tpos: this.root.querySelector('.tpos'),
          tdur: this.root.querySelector('.tdur'),
          track: this.root.querySelector('.track'),
          fill: this.root.querySelector('.track i'),
          vp: this.root.querySelector('.vp'),
          pane: this.root.querySelector('.pane'),
          stage: this.root.querySelector('.stage'),
          lines: this.root.querySelector('.lines'),
          status: this.root.querySelector('.status'),
          sync: this.root.querySelector('.sync'),
          syncIn: this.root.querySelector('.sync input'),
          syncVal: this.root.querySelector('.sv'),
          wrap: this.root.querySelector('.wrap')
        };
        var e = this.el;
        this._onClick = this._onClick.bind(this);
        this._onVol = this._onVol.bind(this);
        this._onSyncIn = this._onSyncIn.bind(this);
        this._onSeekDown = this._onSeekDown.bind(this);
        this._onSeekMove = this._onSeekMove.bind(this);
        this._onSeekUp = this._onSeekUp.bind(this);
        this._onDown = this._onDown.bind(this);
        this._onMove = this._onMove.bind(this);
        this._onUp = this._onUp.bind(this);
        this._tick = this._tick.bind(this);
        this._marqTouch = this._marqTouch.bind(this);
        e.card.addEventListener('click', this._onClick);
        e.card.addEventListener('pointerdown', this._onSeekDown);
        e.card.addEventListener('pointermove', this._onSeekMove);
        e.card.addEventListener('pointerup', this._onSeekUp);
        e.card.addEventListener('pointercancel', this._onSeekUp);
        e.controls.addEventListener('input', this._onVol);
        e.syncIn.addEventListener('input', this._onSyncIn);
        e.vp.addEventListener('pointerdown', this._onDown);
        e.vp.addEventListener('pointermove', this._onMove);
        e.vp.addEventListener('pointerup', this._onUp);
        e.vp.addEventListener('pointercancel', this._onUp);
        e.stage.addEventListener('wheel', this._marqTouch, { passive: true });
        e.stage.addEventListener('touchmove', this._marqTouch, { passive: true });
      }
      if (!this.timer) this.timer = setInterval(this._tick, TICK);
      this._metrics();
      if (this.config) {
        this._renderLines();
        this._render();
      }
    }

    disconnectedCallback() {
      if (this.timer) { clearInterval(this.timer); this.timer = null; }
      this._marqueeStop();
    }

    setConfig(cfg) {
      this.config = normalize(Object.assign({}, cfg || {}));
      if (!this.el) return;
      this._metrics();
      this._renderLines();
      if (this._hass) this._render();
    }

    static getConfigElement() {
      return document.createElement('ha-lyrics-card-editor');
    }

    getStubConfig() {
      var cfg = { type: 'custom:ha-lyrics-card', layout: 'focus', alignment: 'center', font_family: 'system-ui', font_size: 26, font_weight: 700 };
      var ids = Object.keys((this._hass && this._hass.states) || {}).filter(function (i) {
        return i.indexOf('media_player.') === 0;
      });
      if (ids.length) cfg.entities = [ids[0]];
      return cfg;
    }

    getCardSize() {
      if (!this.config) return 4;
      var c = this.config;
      var h = c.height > 0 ? c.height : c.max_lines * c.line_height + 90;
      return Math.max(2, Math.ceil(h / 50) + 1);
    }

    _metrics() {
      if (!this.config || !this.el) return;
      var c = this.config;
      var e = this.el;
      var fixedH = '';
      if (c.height > 0) fixedH = c.height + 'px';
      else if (c.card_height) fixedH = c.card_height;
      e.card.style.height = fixedH;
      e.card.classList.toggle('fixed', !!fixedH);
      e.card.classList.toggle('adapt', c.background_mode === 'artwork' && c.contrast_mode === 'adaptive');
      var st = this._stagePx();
      e.stage.style.height = st ? st + 'px' : '';
      e.lines.classList.toggle('fixed', this._isFixed() && !(this.data && this.data.kind === 'static'));
      e.lines.classList.toggle('karaoke', c.layout === 'karaoke');
      e.lines.classList.toggle('static', !!(this.data && this.data.kind === 'static'));
      e.stage.classList.toggle('masked', c.layout === 'focus' && !(this.data && this.data.kind === 'static') && !this._isFixed());
      var lh = this.data && this.data.kind === 'static' ? Math.round(c.static_font_size * 1.6) : c.line_height;
      var pad = 0;
      if (st && !this._isFixed()) pad = Math.max(0, Math.round((st - lh) / 2));
      e.lines.style.paddingTop = pad + 'px';
      e.lines.style.paddingBottom = pad + 'px';
      var s = this.style;
      s.setProperty('--fb', c.font_size + 'px');
      s.setProperty('--lb', c.line_height + 'px');
      s.setProperty('--fw', String(c.font_weight));
      s.setProperty('--ff', c.font_family);
      s.setProperty('--al', c.alignment);
      s.setProperty('--as', String(c.active_scale));
      s.setProperty('--io', String(c.inactive_opacity));
      s.setProperty('--bg-blur', c.artwork_blur + 'px');
      s.setProperty('--bg-dim', String(c.artwork_opacity));
      s.setProperty('--bg-veil', String(c.artwork_overlay_opacity));
      s.setProperty('--bb', c.backdrop_blur + 'px');
      s.setProperty('--bo', String(c.backdrop_opacity));
      s.setProperty('--art-size', c.art_size + 'px');
      s.setProperty('--static-size', c.static_font_size + 'px');
      s.setProperty('--th', (c.header_font_size > 0 ? c.header_font_size : c.track_info_font_size) + 'px');
      s.setProperty('--seek-h', c.progress_bar_height + 'px');
      s.setProperty('--seek-c', c.progress_bar_color);
      s.setProperty('--ctrl', c.media_controls_size + 'px');
      var ts = c.text_shadow ? '0 1px 2px rgba(0,0,0,' + c.text_shadow_strength + '), 0 0 8px rgba(0,0,0,' + (c.text_shadow_strength * 0.55).toFixed(3) + ')' : '';
      if (ts) s.setProperty('--npc-ts', ts);
      else s.removeProperty('--npc-ts');
      this._applyTextColor();
    }

    _stagePx() {
      if (!this.config) return 0;
      var c = this.config;
      if (c.height > 0 || c.card_height) return 0;
      if (this.data && this.data.kind === 'static') return c.max_lines * c.line_height;
      if (c.layout === 'compact' || c.layout === 'minimal') return c.line_height;
      if (c.layout === 'two_line') return c.line_height * 2;
      return c.max_lines * c.line_height;
    }

    _isFixed() {
      var c = this.config;
      return c && (c.layout === 'compact' || c.layout === 'two_line' || c.layout === 'minimal');
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
        if (!s || (s.state !== 'playing' && s.state !== 'paused')) continue;
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
            all: [],
            art: artUrl(a),
            ma: maTrackRef(a.media_content_id),
            playing: false
          };
          groups.set(gk, g);
          order.push(g);
        }
        if (!g.duration && a.media_duration) g.duration = Number(a.media_duration) || 0;
        if (!g.art) g.art = artUrl(a);
        if (!g.ma) g.ma = maTrackRef(a.media_content_id);
        if (s.state === 'playing') g.playing = true;
        g.all.push(id);
      }
      for (var j = 0; j < order.length; j++) {
        var grp = order[j];
        for (var k = 0; k < grp.all.length; k++) {
          if (states[grp.all[k]].state === 'playing') { grp.entity = grp.all[k]; break; }
        }
      }
      if (this._keys) {
        var prev = this._keys;
        order.sort(function (x, y) {
          if (x.playing !== y.playing) return x.playing ? -1 : 1;
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
      var track = order[this.idx] || null;
      var gk = track ? track.k : null;
      if (gk !== this.loadedKey) {
        this.loadedKey = gk;
        this._load(track);
      }
      this._head(order, track);
      this._controls();
      this._update(true);
    }

    _setText(el, text) {
      if (el.textContent !== text) el.textContent = text;
    }

    _art(track) {
      var e = this.el;
      var url = track && this.config.show_album_art ? (track.art || '') : '';
      if (url && url === this._artFail) url = '';
      if (url !== this._artUrl) {
        this._artUrl = url;
        if (url) {
          var self = this;
          e.artImg.onerror = function () {
            if (self._artUrl !== url) return;
            self._artFail = url;
            self._artUrl = null;
            self._art(track);
          };
          e.artImg.src = url;
          e.bg.style.backgroundImage = 'url("' + String(url).replace(/["\\()]/g, encodeURIComponent) + '")';
          if (this.config.text_color_mode === 'auto') this._analyseArtwork(url);
        } else {
          e.artImg.onerror = null;
          e.artImg.removeAttribute('src');
          e.bg.style.backgroundImage = '';
          this._artText = '';
        }
      }
      var on = !!url;
      e.art.hidden = !on;
      e.bg.hidden = !on;
      e.card.classList.toggle('has-bg', on);
      this._applyTextColor();
    }

    _analyseArtwork(url) {
      var self = this;
      this._artText = '';
      var img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = function () {
        try {
          var cnv = document.createElement('canvas');
          cnv.width = 1; cnv.height = 1;
          var ctx = cnv.getContext ? cnv.getContext('2d', { willReadFrequently: true }) : null;
          if (!ctx) return;
          ctx.drawImage(img, 0, 0, 1, 1);
          var d = ctx.getImageData(0, 0, 1, 1).data;
          var lum = (0.2126 * d[0] + 0.7152 * d[1] + 0.0722 * d[2]) / 255;
          self._artText = lum > 0.55 ? '#111111' : '#ffffff';
        } catch (e) { }
        self._applyTextColor();
      };
      img.onerror = function () {
        self._artText = '';
        self._applyTextColor();
      };
      img.src = url;
    }

    _applyTextColor() {
      if (!this.el) return;
      var c = this.config;
      var s = this.el.card.style;
      var prim = '';
      var sec = '';
      var mode = c.text_color_mode;
      if (mode === 'light') { prim = '#ffffff'; sec = 'rgba(255,255,255,.82)'; }
      else if (mode === 'dark') { prim = '#111111'; sec = '#3a3a3a'; }
      else if (mode === 'auto') {
        if (c.background_mode === 'artwork' && this._artUrl && this._artText) {
          if (this._artText === '#111111') { prim = '#111111'; sec = '#333333'; }
          else { prim = '#ffffff'; sec = 'rgba(255,255,255,.82)'; }
        }
      }
      if (c.highlight_color) prim = c.highlight_color;
      if (c.text_color) sec = c.text_color;
      if (prim) s.setProperty('--ha-lyrics-primary', prim);
      else s.removeProperty('--ha-lyrics-primary');
      if (sec) s.setProperty('--ha-lyrics-secondary', sec);
      else s.removeProperty('--ha-lyrics-secondary');
    }

    _head(order, track) {
      var e = this.el;
      var c = this.config;
      this._art(track);
      if (e.syncIn.value == null || Number(e.syncIn.value) !== this.offset) e.syncIn.value = String(this.offset || 0);
      var headerOn = !!(track && c.layout !== 'minimal' && c.show_header !== false);
      e.head.hidden = !headerOn;
      e.wrap.classList.toggle('intro-on', false);
      if (!track) {
        this._setText(e.title, 'Lyrics');
        var any = 0;
        var s = this._hass.states || {};
        for (var id in s) { if (id.indexOf('media_player.') === 0) { any++; } }
        this._setText(e.sub, any ? 'Nothing playing' : 'No media players found');
        this._setText(e.status, '');
        if (this._dots !== 0) { e.dots.textContent = ''; this._dots = 0; }
        e.dots.style.display = 'none';
        e.controls.hidden = true;
        e.seek.hidden = true;
        return;
      }
      this._setText(e.splashT, track.title);
      this._setText(e.splashA, track.artist || '');
      var states = this._hass.states || {};
      var friendly = (states[track.entity] || {}).attributes;
      friendly = (friendly && friendly.friendly_name) || track.entity;
      this._setText(e.title, track.title);
      if (c.header_layout === 'split') { e.who.classList.add('split'); e.who.classList.remove('split_reverse'); }
      else if (c.header_layout === 'split_reverse') { e.who.classList.add('split_reverse'); e.who.classList.remove('split'); }
      else { e.who.classList.remove('split'); e.who.classList.remove('split_reverse'); }
      e.who.hidden = !c.show_track_info;
      var bits = [];
      if (track.artist) bits.push(track.artist);
      if (c.show_friendly_name) {
        if (track.all.length > 1) bits.push(friendly + ' +' + (track.all.length - 1));
        else bits.push(friendly);
      }
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
      e.dots.style.display = c.layout === 'minimal' || order.length < 2 ? 'none' : '';
      var d = this.data;
      var st = '';
      if (!d) st = this.msg || '';
      else if (d.kind === 'instrumental') st = 'Instrumental';
      else if (d.kind === 'synced') {
        st = d.source === 'music_assistant' ? 'Music Assistant \u00b7 synced' : d.source === 'lrclib' ? 'LRCLIB \u00b7 synced' : 'synced';
      } else {
        st = d.source === 'music_assistant' ? 'Music Assistant \u00b7 lyrics' : 'LRCLIB \u00b7 lyrics';
      }
      this._setText(e.status, st);
    }

    _features(track) {
      if (!track) return 0;
      var s = (this._hass.states || {})[track.entity];
      return Number(s && s.attributes && s.attributes.supported_features) || 0;
    }

    _st(track) {
      return track ? (this._hass.states || {})[track.entity] : null;
    }

    _controls() {
      var e = this.el;
      var c = this.config;
      var track = this._track();
      if (!track || c.show_media_controls === false) {
        e.controls.hidden = true;
        e.seek.hidden = !(track && c.show_progress);
        return;
      }
      var st = this._st(track);
      var a = st && st.attributes || {};
      var f = this._features(track);
      var playing = st && st.state === 'playing';
      var isPaused = !!st && st.state === 'paused';
      var muted = !!a.is_volume_muted;
      var hasVol = a.volume_level != null;
      var vol = hasVol ? Math.round(Math.max(0, Math.min(1, Number(a.volume_level))) * 100) : -1;
      var volMode = (c.show_volume && (f & F_VOLUME_SET)) || (c.show_volume && hasVol) ? 'slider' : (c.show_volume && (f & F_VOLUME_STEP)) ? 'step' : '';
      var sig = [
        track.entity, f, c.media_icon_style, c.show_media_controls, c.show_volume, c.show_mute, c.show_power,
        c.show_progress, c.layout, c.media_controls_size,
        playing ? 'p' : isPaused ? 'z' : 'o', muted ? 'm' : '', volMode, vol
      ].join('|');
      if (sig === this._ctlSig) {
        this._paintControls(track, st, playing, muted, vol, volMode);
        return;
      }
      this._ctlSig = sig;
      var g = glyphs(c.media_icon_style);
      var html = '';
      if (c.show_mute && (f & F_VOLUME_MUTE)) {
        html += '<button class="cb" data-c="mute" title="Mute">' + (muted ? '\ud83d\udd07' : '\ud83d\udd0a') + '</button>';
      }
      html += '<button class="cb" data-c="prev" title="Previous"' + ((f & F_PREV) ? '' : ' disabled') + '>' + g.prev + '</button>';
      html += '<button class="cb' + (playing ? ' playing' : '') + '" data-c="toggle" title="Play/Pause">' + (playing ? g.pause : g.play) + '</button>';
      html += '<button class="cb" data-c="next" title="Next"' + ((f & F_NEXT) ? '' : ' disabled') + '>' + g.next + '</button>';
      if (volMode === 'slider') {
        html += '<div class="vol"><input type="range" min="0" max="100" step="1" value="' + Math.max(0, vol) + '"><span class="vlab">' + Math.max(0, vol) + '%</span></div>';
      } else if (volMode === 'step') {
        html += '<div class="vol"><button class="vstep" data-c="v-" title="Volume down">\u2212</button><button class="vstep" data-c="v+" title="Volume up">+</button></div>';
      } else {
        html += '<div class="vol" hidden></div>';
      }
      if (c.show_power && ((f & F_TURN_ON) || (f & F_TURN_OFF))) {
        html += '<button class="cb" data-c="power" title="Power">' + g.power + '</button>';
      }
      e.controls.hidden = false;
      e.controls.innerHTML = html;
      e.controls.style.setProperty('--ctrl', c.media_controls_size + 'px');
      e.seek.hidden = !c.show_progress;
      this._paintControls(track, st, playing, muted, vol, volMode);
      this._paintSeek(true);
    }

    _paintControls(track, st, playing, muted, vol, volMode) {
      var e = this.el;
      var g = glyphs(this.config.media_icon_style);
      var toggle = e.controls.querySelector('[data-c="toggle"]');
      if (toggle) {
        toggle.classList.toggle('playing', playing);
        toggle.textContent = playing ? g.pause : g.play;
      }
      if (volMode === 'slider' && vol >= 0) {
        var inp = e.controls.querySelector('.vol input');
        var lab = e.controls.querySelector('.vlab');
        var focused = false;
        try { focused = document.activeElement === inp; } catch (err) { }
        if (!focused && inp) inp.value = String(vol);
        if (lab) lab.textContent = vol + '%';
      }
      var mute = e.controls.querySelector('[data-c="mute"]');
      if (mute) mute.textContent = muted ? '\ud83d\udd07' : '\ud83d\udd0a';
    }

    _dur() {
      var track = this._track();
      if (!track) return 0;
      var a = this._st(track);
      var att = a && a.attributes || {};
      return Number(att.media_duration) || track.duration || 0;
    }

    _paintSeek(force) {
      var e = this.el;
      var track = this._track();
      if (!track || e.seek.hidden) {
        e.fill.style.width = '0%';
        return;
      }
      var dur = this._dur();
      var pos = this._scrub != null ? this._scrub : this._position();
      if (dur > 0) {
        var pct = Math.max(0, Math.min(1, pos / dur)) * 100;
        var w = pct.toFixed(1) + '%';
        if (e.fill.style.width !== w) e.fill.style.width = w;
      }
      var cur = fmt(pos);
      if (e.tpos.textContent !== cur) e.tpos.textContent = cur;
      var tot = dur > 0 ? fmt(dur) : '';
      if (e.tdur.textContent !== tot) e.tdur.textContent = tot;
    }

    _load(track, force) {
      if (!track) {
        this.data = null;
        this.msg = '';
        this._renderLines();
        return;
      }
      var self = this;
      var key = track.k;
      var cfg = this.config || {};
      var useMa = cfg.lyrics_source === 'music_assistant';
      var lkey = useMa ? key + '|ma' : key;
      var rec = force ? undefined : cacheGet(lkey);
      if (rec) {
        this.data = rec.d;
        this.msg = rec.d ? '' : 'No lyrics found';
        this.offset = offsetGet(key) || (cfg && cfg.sync_offset) || 0;
        this._renderLines();
        return;
      }
      this.data = null;
      this.msg = 'Fetching lyrics\u2026';
      this.offset = 0;
      this._renderLines();
      this._anchor();
      this._update(true);
      var request = useMa
        ? fetchMaLyrics(track.ma, cfg).then(function (d) { return d || fetchLyrics(track); })
        : fetchLyrics(track);
      request.then(function (data) {
        cacheSet(lkey, data);
        if (self.loadedKey !== key || !self._hass) return;
        self.data = data;
        self.msg = data ? '' : 'No lyrics found';
        self.offset = offsetGet(key);
        self._renderLines();
        self._render();
      });
    }

    _renderLines() {
      var box = this.el.lines;
      box.textContent = '';
      this.lineEls = [];
      this.active = -1;
      this._scrollTarget = null;
      var d = this.data;
      this._metrics();
      this._marqueeReset();
      this._marqueeStop();
      if (!d || !d.lines || !d.lines.length) {
        var text = d && d.kind === 'instrumental' ? '\u266a  Instrumental' : (this.msg || 'Nothing playing');
        var m = document.createElement('div');
        m.className = 'l msg';
        m.textContent = text;
        box.appendChild(m);
        this.lineEls = [m];
        return;
      }
      if (d.kind === 'static') {
        var p = document.createElement('div');
        p.className = 'plain';
        p.textContent = d.lines.map(function (l) { return l.text; }).join('\n');
        box.appendChild(p);
        return;
      }
      var lines = d.lines;
      for (var i = 0; i < lines.length; i++) {
        var el = document.createElement('div');
        el.className = 'l';
        el.textContent = lines[i].text;
        box.appendChild(el);
        this.lineEls.push(el);
      }
    }

    _window(lines, active) {
      var c = this.config;
      if (c.layout === 'compact' || c.layout === 'minimal') return { from: active, to: Math.min(lines.length, active + 1) };
      if (c.layout === 'two_line') return { from: active, to: Math.min(lines.length, active + 2) };
      var from = c.show_previous === false ? Math.max(0, active) : 0;
      var to = c.show_upcoming === false ? Math.min(lines.length, active + 1) : lines.length;
      return { from: from, to: to };
    }

    _renderWindow() {
      var lines = this.data.lines;
      var win = this._window(lines, this.active);
      var box = this.el.lines;
      box.textContent = '';
      this.lineEls = [];
      for (var i = win.from; i < win.to; i++) {
        var cls = 'l' + (i === this.active ? ' on' : '') +
          (this.config.layout === 'two_line' && i === this.active + 1 ? ' next' : '');
        var el = document.createElement('div');
        el.className = cls;
        el.textContent = lines[i].text;
        box.appendChild(el);
        this.lineEls.push(el);
      }
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
      if (this._scrub != null) return this._scrub;
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
      this._marqueeSync();
      this._paintSeek(false);
      this._paintIntro();
      var d = this.data;
      if (!d || d.kind !== 'synced' || !d.lines || !d.lines.length || !this.lineEls || !this.lineEls.length) return;
      var pos = this._position();
      if (this.data.kind === 'synced') pos += (this.offset || 0);
      var lines = d.lines;
      var idx = 0;
      while (idx + 1 < lines.length && lines[idx + 1].t <= pos) idx++;
      if (idx !== this.active || force) this._active(idx);
    }

    _active(idx) {
      var c = this.config;
      var els = this.lineEls;
      var lines = this.data.lines;
      this.active = idx;
      if (this._isFixed() || c.show_previous === false || c.show_upcoming === false) {
        this._renderWindow();
        if (this.lineEls[0]) this._fitActiveLine(this.lineEls[0]);
        return;
      }
      for (var i = 0; i < els.length; i++) {
        els[i].className = 'l' + (i === idx ? ' on' : '');
        els[i].style.fontSize = '';
      }
      if (els[idx]) this._fitActiveLine(els[idx]);
      this._scrollTo(els[idx]);
    }

    _fitActiveLine(el) {
      var c = this.config;
      var base = c.font_size;
      var target = Math.round(base * c.active_scale);
      el.style.fontSize = target + 'px';
      var maxW = el.parentElement ? el.parentElement.clientWidth : el.clientWidth;
      while (el.scrollWidth > maxW + 1 && target > 12) {
        target -= 1;
        el.style.fontSize = target + 'px';
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

    _paintIntro() {
      var e = this.el;
      var d = this.data;
      var track = this._track();
      var on = !!(this.config.show_intro && d && d.lines && d.lines.length && track);
      if (on) {
        var first = d.kind === 'synced' ? (d.lines[0].t || 0) : 0;
        var until = Math.max(this.config.intro_duration, first);
        on = this._position() < until;
      }
      if (on !== this._introOn) {
        this._introOn = on;
        e.splash.classList.toggle('on', on);
        e.wrap.classList.toggle('intro-on', on);
      }
    }

    _plainAuto() {
      var c = this.config;
      return !!(c && c.plain_lyrics_auto_scroll !== false && this._dur() > 0 && this.data && this.data.kind === 'static');
    }

    _driftOn() {
      var c = this.config;
      return !!(c && c.static_scroll && this.data && this.data.kind === 'static');
    }

    _reducedMotion() {
      return typeof window.matchMedia === 'function' &&
        !!window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    _marqueeSync() {
      var on = this._driftOn() && !this._reducedMotion() && !!this.el;
      if (on) this._marqueeStart();
      else this._marqueeStop();
    }

    _marqueeStart() {
      var self = this;
      this._raf = requestAnimationFrame(function () { self._marqueeStep(); });
    }

    _marqueeStop() {
      if (this._raf) { cancelAnimationFrame(this._raf); this._raf = 0; }
    }

    _marqueeReset() {
      if (!this._marq) return;
      this._marq.last = 0;
      this._marq.started = false;
      this._marq.hold = 0;
      this._marq.atEnd = false;
      this._marq.pos = 0;
      if (this.el && this.el.stage) this.el.stage.scrollTop = 0;
    }

    _marqueeStep(now) {
      var stage = this.el.stage;
      if (!stage) return;
      if (this._reducedMotion()) { this._raf = 0; return; }
      var max = stage.scrollHeight - stage.clientHeight;
      var ts = now != null ? now : Date.now();
      if (this._plainAuto()) {
        if (max > 1) {
          var dur = this._dur();
          var frac = dur > 0 ? Math.min(1, Math.max(0, this._position() / dur)) : 0;
          var target = frac * max;
          if (Math.abs(stage.scrollTop - target) > 0.5) stage.scrollTop = target;
        }
      } else {
        var m = this._marq;
        if (!m) m = this._marq = { last: 0, started: false, hold: 0, atEnd: false, until: 0, pos: 0 };
        if (!m.started) { m.started = true; m.last = ts; }
        var dt = Math.min(0.25, Math.max(0, (ts - m.last) / 1000));
        m.last = ts;
        if (max > 1) {
          var cfg = this.config;
          if (Date.now() < (m.until || 0)) {
            m.pos = stage.scrollTop;
          } else if (m.hold > 0) {
            m.hold -= dt;
            if (m.hold <= 0 && m.atEnd) {
              m.atEnd = false;
              m.pos = 0;
              stage.scrollTop = 0;
              m.hold = 1.4;
            }
          } else {
            m.pos = Math.min(max, m.pos + cfg.static_scroll_speed * dt);
            stage.scrollTop = m.pos;
            if (m.pos >= max - 0.5) { m.hold = 2.2; m.atEnd = true; }
          }
        }
      }
      if (this._driftOn() && !this._reducedMotion()) {
        var self = this;
        this._raf = requestAnimationFrame(function () { self._marqueeStep(); });
      } else {
        this._raf = 0;
      }
    }

    _tick() {
      if (!this._hass) return;
      var track = this._track();
      if (!track) return;
      this._update(false);
    }

    _offsetText(v) {
      v = Math.round(Number(v || 0) * 100) / 100;
      return (v > 0 ? '+' : '') + v.toFixed(2) + 's';
    }

    _setOffset(v) {
      v = Math.round(Math.max(-120, Math.min(120, Number(v) || 0)) * 100) / 100;
      if (this.offset === v) return;
      this.offset = v;
      var t = this._track();
      if (t) offsetSet(t.k, v);
      if (this._offsetText(v) !== this._offText) {
        this._offText = this._offsetText(v);
        if (this.el) this.el.syncVal.textContent = this._offText;
      }
      this._update(true);
    }

    _pokeSync() {
      var c = this.config;
      if (!c || c.show_sync_slider === false) return;
      var self = this;
      if (this.el) this.el.sync.classList.add('open');
      if (this._syncTimer) clearTimeout(this._syncTimer);
      this._syncTimer = setTimeout(function () {
        if (self.el) self.el.sync.classList.remove('open');
      }, 5000);
    }

    _callSvc(svc, extra) {
      var track = this._track();
      if (!track || !this._hass || !this._hass.callService) return;
      try {
        var data = Object.assign({ entity_id: track.entity }, extra || {});
        var p = this._hass.callService('media_player', svc, data);
        if (p && p.then) p.catch(function () { });
      } catch (e) { }
    }

    _onClick(ev) {
      var target = ev.target;
      if (!this._track()) return;
      var dot = target.closest ? target.closest('.dot') : null;
      if (dot) { this._go(Number(dot.dataset.i)); return; }
      var cb = target.closest ? target.closest('[data-c]') : null;
      if (!cb) return;
      var act = cb.dataset.c;
      var track = this._track();
      var st = this._st(track);
      switch (act) {
        case 'toggle': this._callSvc('media_play_pause'); break;
        case 'prev': this._callSvc('media_previous_track'); break;
        case 'next': this._callSvc('media_next_track'); break;
        case 'power': this._callSvc('toggle'); break;
        case 'mute':
          this._callSvc('volume_mute', { is_volume_muted: !(st && st.attributes && st.attributes.is_volume_muted) });
          break;
        case 'v-': this._callSvc('volume_down'); break;
        case 'v+': this._callSvc('volume_up'); break;
        case 'syncreset': this._setOffset(0); break;
      }
    }

    _onVol(ev) {
      var t = ev.target;
      if (!t.closest || String(t.tagName).toUpperCase() !== 'INPUT' || !t.closest('.vol')) return;
      var v = Math.max(0, Math.min(100, Math.round(Number(t.value)) || 0));
      var lab = t.closest('.vol').querySelector('.vlab');
      if (lab) lab.textContent = v + '%';
      var self = this;
      if (this._volTimer) clearTimeout(this._volTimer);
      this._volTimer = setTimeout(function () {
        self._callSvc('volume_set', { volume_level: v / 100 });
      }, 150);
    }

    _onSyncIn(ev) {
      var t = ev.target;
      if (!t.closest || !t.closest('.sync')) return;
      this._setOffset(Number(t.value));
    }

    _seekFrac(ev) {
      var track = this.el.track;
      var rect = track.getBoundingClientRect ? track.getBoundingClientRect() : { left: 0, width: 200 };
      var frac = (ev.clientX - rect.left) / (rect.width || 1);
      return Math.max(0, Math.min(1, frac));
    }

    _onSeekDown(ev) {
      if (ev.button != null && ev.button !== 0) return;
      if (!ev.target.closest || !ev.target.closest('.track')) return;
      if (ev.target.closest('[data-c]')) return;
      var dur = this._dur();
      this._scrub = dur * this._seekFrac(ev);
      this._paintSeek(true);
    }

    _onSeekMove(ev) {
      if (this._scrub == null) return;
      var dur = this._dur();
      this._scrub = dur * this._seekFrac(ev);
      this._paintSeek(true);
    }

    _onSeekUp(ev) {
      if (ev && ev.type === 'pointercancel') {
        this._scrub = null;
        return;
      }
      if (this._scrub == null) return;
      var dur = this._dur();
      var target = this._scrub;
      this._scrub = null;
      this.anchor = null;
      this._update(true);
      if (dur > 0 && target >= 0 && (this._features(this._track()) & F_SEEK)) {
        this._callSvc('media_seek', { seek_position: Math.round(target * 10) / 10 });
      }
      this._paintSeek(true);
    }

    _onDown(ev) {
      if (ev.button != null && ev.button !== 0) return;
      if (ev.target.closest) {
        if (ev.target.closest('.track') || ev.target.closest('.dot') || ev.target.closest('.controls') || ev.target.closest('.sync')) return;
      }
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
        if (Date.now() - d.t < 400) {
          this._next(ev.clientX < d.x ? 1 : -1);
          this._pokeSync();
        }
        return;
      }
      if (Math.abs(d.dx) > SWIPE_PX) this._go(this.idx + (d.dx < 0 ? 1 : -1));
    }

    _marqTouch() {
      if (this._marq) this._marq.until = Date.now() + 3200;
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

  class HaLyricsCardEditor extends HTMLElement {
    constructor() {
      super();
      this._config = null;
      this._hass = null;
      this._forms = [];
      this._sections = [
        ['Player', [
          { name: 'entity', selector: { entity: { domain: 'media_player' } } },
          { name: 'entities', selector: { entity: { domain: 'media_player', multiple: true } } }
        ]],
        ['Player and layout', [
          { name: 'layout', selector: { select: { mode: 'dropdown', options: [{ label: 'Focus - scrolling lyrics', value: 'focus' }, { label: 'Karaoke - spacious lyrics', value: 'karaoke' }, { label: 'Compact - active line only', value: 'compact' }, { label: 'Two line - active and next', value: 'two_line' }, { label: 'Minimal - active line only', value: 'minimal' }] } } },
          { name: 'card_height', selector: { text: { } } },
          { name: 'height', selector: { number: { min: 60, max: 1600, mode: 'box', unit_of_measurement: 'px' } } },
          { name: 'show_track_info', selector: { boolean: { } } },
          { name: 'show_friendly_name', selector: { boolean: { } } },
          { name: 'show_intro', selector: { boolean: { } } },
          { name: 'intro_duration', selector: { number: { min: 0, max: 30, step: 0.5, mode: 'box', unit_of_measurement: 's' } } },
          { name: 'intro_font_size', selector: { number: { min: 20, max: 120, step: 1, mode: 'box', unit_of_measurement: 'px' } } }
        ]],
        ['Media controls', [
          { name: 'show_media_controls', selector: { boolean: { } } },
          { name: 'media_controls_size', selector: { number: { min: 24, max: 64, step: 1, mode: 'box', unit_of_measurement: 'px' } } },
          { name: 'media_icon_style', selector: { select: { mode: 'dropdown', options: [{ label: 'Standard', value: 'standard' }, { label: 'Filled media icons', value: 'filled' }, { label: 'Minimal chevrons', value: 'minimal' }] } } },
          { name: 'show_volume', selector: { boolean: { } } },
          { name: 'show_mute', selector: { boolean: { } } },
          { name: 'show_power', selector: { boolean: { } } },
          { name: 'show_progress', selector: { boolean: { } } },
          { name: 'progress_bar_height', selector: { number: { min: 2, max: 16, step: 1, mode: 'box', unit_of_measurement: 'px' } } },
          { name: 'progress_bar_color', selector: { text: { } } }
        ]],
        ['Lyrics appearance', [
          { name: 'alignment', selector: { select: { mode: 'dropdown', options: [{ label: 'Left', value: 'left' }, { label: 'Centre', value: 'center' }, { label: 'Right', value: 'right' }] } } },
          { name: 'font_family', selector: { select: { mode: 'dropdown', custom_value: true, options: [{ label: 'System UI', value: 'system-ui' }, { label: 'Roboto', value: 'Roboto, sans-serif' }, { label: 'Inter', value: 'Inter, sans-serif' }, { label: 'Montserrat', value: 'Montserrat, sans-serif' }, { label: 'Poppins', value: 'Poppins, sans-serif' }, { label: 'Serif', value: 'serif' }, { label: 'Monospace', value: 'monospace' }] } } },
          { name: 'font_size', selector: { number: { min: 12, max: 120, step: 1, mode: 'box', unit_of_measurement: 'px' } } },
          { name: 'font_weight', selector: { number: { min: 100, max: 900, step: 100, mode: 'box' } } },
          { name: 'inactive_opacity', selector: { number: { min: 0, max: 1, step: 0.05, mode: 'box' } } },
          { name: 'active_scale', selector: { number: { min: 1, max: 2, step: 0.01, mode: 'box' } } },
          { name: 'show_previous', selector: { boolean: { } } },
          { name: 'show_upcoming', selector: { boolean: { } } },
          { name: 'plain_lyrics_auto_scroll', selector: { boolean: { } } },
          { name: 'static_font_size', selector: { number: { min: 10, max: 48, step: 1, mode: 'box', unit_of_measurement: 'px' } } }
        ]],
        ['Track header', [
          { name: 'header_font_size', selector: { number: { min: 8, max: 48, step: 1, mode: 'box', unit_of_measurement: 'px' } } },
          { name: 'header_alignment', selector: { select: { mode: 'dropdown', options: [{ label: 'Same as lyrics', value: 'inherit' }, { label: 'Left', value: 'left' }, { label: 'Centre', value: 'center' }, { label: 'Right', value: 'right' }] } } },
          { name: 'header_layout', selector: { select: { mode: 'dropdown', options: [{ label: 'Title and artist together', value: 'combined' }, { label: 'Title left, artist right', value: 'split' }, { label: 'Artist left, title right', value: 'split_reverse' }] } } }
        ]],
        ['Background and contrast', [
          { name: 'background_mode', selector: { select: { mode: 'dropdown', options: [{ label: 'Home Assistant theme', value: 'theme' }, { label: 'Album artwork', value: 'artwork' }, { label: 'No background (transparent)', value: 'transparent' }] } } },
          { name: 'background_opacity', selector: { number: { min: 0, max: 1, step: 0.01, mode: 'box' } } },
          { name: 'art_size', selector: { number: { min: 0, max: 200, step: 1, mode: 'box', unit_of_measurement: 'px' } } },
          { name: 'show_album_art', selector: { boolean: { } } },
          { name: 'artwork_blur', selector: { number: { min: 0, max: 40, step: 1, mode: 'box', unit_of_measurement: 'px' } } },
          { name: 'artwork_opacity', selector: { number: { min: 0, max: 1, step: 0.01, mode: 'box' } } },
          { name: 'artwork_overlay_opacity', selector: { number: { min: 0, max: 1, step: 0.01, mode: 'box' } } },
          { name: 'text_color_mode', selector: { select: { mode: 'dropdown', options: [{ label: 'Auto contrast from artwork', value: 'auto' }, { label: 'Home Assistant theme', value: 'theme' }, { label: 'Always light', value: 'light' }, { label: 'Always dark', value: 'dark' }] } } },
          { name: 'contrast_mode', selector: { select: { mode: 'dropdown', options: [{ label: 'Adaptive contrast', value: 'adaptive' }, { label: 'Off', value: 'off' }] } } },
          { name: 'backdrop_blur', selector: { number: { min: 0, max: 30, step: 1, mode: 'box', unit_of_measurement: 'px' } } },
          { name: 'backdrop_opacity', selector: { number: { min: 0, max: 0.8, step: 0.01, mode: 'box' } } },
          { name: 'text_shadow', selector: { boolean: { } } },
          { name: 'text_shadow_strength', selector: { number: { min: 0, max: 1, step: 0.05, mode: 'box' } } }
        ]],
        ['Sync', [
          { name: 'show_sync_slider', selector: { boolean: { } } },
          { name: 'sync_offset', selector: { number: { min: -10, max: 10, step: 0.01, mode: 'box', unit_of_measurement: 's' } } }
        ]],
        ['Lyrics source', [
          { name: 'lyrics_source', selector: { select: { mode: 'dropdown', options: [{ label: 'LRCLIB', value: 'lrclib' }, { label: 'Music Assistant first', value: 'music_assistant' }] } } },
          { name: 'music_assistant_url', selector: { text: { } } },
          { name: 'music_assistant_token', selector: { text: { type: 'password' } } },
          { name: 'music_assistant_timeout', selector: { number: { min: 2, max: 30, step: 1, mode: 'box', unit_of_measurement: 's' } } }
        ]]
      ];
    }

    setConfig(config) {
      this._config = Object.assign({}, config || {});
      this._build();
      this._sync();
    }

    set hass(hass) {
      this._hass = hass;
      this._build();
      this._sync();
    }

    _label(name) {
      return ({
        entity: 'Media player', entities: 'Media players', layout: 'Layout', card_height: 'Card height (e.g. 260px, 65vh)',
        height: 'Card height (px)', show_track_info: 'Show track title and artist', show_friendly_name: 'Show player name',
        show_intro: 'Show track intro before first lyric', intro_duration: 'Minimum intro duration', intro_font_size: 'Intro title size',
        show_media_controls: 'Show player controls', media_controls_size: 'Control button size', media_icon_style: 'Icon style',
        show_volume: 'Volume control', show_mute: 'Mute button', show_power: 'Power button',
        show_progress: 'Show progress / seek bar', progress_bar_height: 'Progress bar height', progress_bar_color: 'Progress bar colour (CSS)',
        alignment: 'Lyrics alignment', font_family: 'Lyrics font', font_size: 'Lyrics font size', font_weight: 'Lyrics font weight',
        inactive_opacity: 'Inactive lyric opacity', active_scale: 'Active lyric scale',
        show_previous: 'Show previous lyric lines', show_upcoming: 'Show upcoming lyric lines',
        plain_lyrics_auto_scroll: 'Auto-scroll plain lyrics with playback', static_font_size: 'Plain lyrics font size',
        header_font_size: 'Header font size', header_alignment: 'Header alignment', header_layout: 'Header layout',
        background_mode: 'Background source', background_opacity: 'Card background opacity', art_size: 'Album art size',
        show_album_art: 'Show album art', artwork_blur: 'Artwork blur', artwork_opacity: 'Artwork opacity',
        artwork_overlay_opacity: 'Artwork dark overlay', text_color_mode: 'Lyric colour', contrast_mode: 'Adaptive contrast',
        backdrop_blur: 'Contrast blur', backdrop_opacity: 'Contrast overlay opacity', text_shadow: 'Text drop shadows',
        text_shadow_strength: 'Text shadow strength', show_sync_slider: 'Show on-card sync slider', sync_offset: 'Starting sync offset',
        lyrics_source: 'Lyrics source', music_assistant_url: 'Music Assistant URL', music_assistant_token: 'Music Assistant token',
        music_assistant_timeout: 'Music Assistant timeout'
      })[name] || name;
    }

    _build() {
      if (this._forms.length) return;
      var style = document.createElement('style');
      style.textContent = '.editor-section{border-top:1px solid var(--divider-color);padding:14px 0 6px}.editor-section:first-child{border-top:0;padding-top:4px}.editor-section h3{margin:0 8px 7px;font-size:15px;font-weight:500;color:var(--primary-text-color)}ha-form{display:block;padding:0 4px}';
      this.appendChild(style);
      var self = this;
      this._sections.forEach(function (pair) {
        var title = pair[0], schema = pair[1];
        var section = document.createElement('section');
        section.className = 'editor-section';
        var heading = document.createElement('h3');
        heading.textContent = title;
        section.appendChild(heading);
        var form = document.createElement('ha-form');
        form.schema = schema;
        form.computeLabel = function (item) { return self._label(item.name); };
        form.addEventListener('value-changed', function (ev) {
          ev.stopPropagation();
          var config = Object.assign({}, self._config, ev.detail && ev.detail.value || {});
          self._config = config;
          self.dispatchEvent(new CustomEvent('config-changed', { detail: { config: config }, bubbles: true, composed: true }));
        });
        section.appendChild(form);
        self.appendChild(section);
        self._forms.push({ form: form, schema: schema });
      });
    }

    _sync() {
      this._forms.forEach(function (pair) {
        pair.form.hass = this._hass;
        pair.form.schema = pair.schema;
        pair.form.data = this._config || {};
      }, this);
    }
  }

  window.HaLyricsCard = HaLyricsCard;
  if (!customElements.get('ha-lyrics-card')) {
    customElements.define('ha-lyrics-card', HaLyricsCard);
  }
  if (!customElements.get('ha-lyrics-card-editor')) {
    customElements.define('ha-lyrics-card-editor', HaLyricsCardEditor);
  }
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: 'ha-lyrics-card',
    name: 'Now Playing & Lyrics',
    description: 'Player controls and synced lyrics for any media player.',
    preview: false
  });
})();