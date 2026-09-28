'use strict';
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'ha-lyrics-card.js'), 'utf8');

global.window = { customCards: [] };
global.customElements = { get: () => false, define: () => {} };
global.HTMLElement = class {};
global.localStorage = (() => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k)
  };
})();

eval(src.replace(
  'window.customCards = window.customCards',
  'window.__x={fetchLyrics:fetchLyrics};\n  window.customCards = window.customCards'
));
const fetchLyrics = global.window.__x.fetchLyrics;

function report(label, data, wantKind) {
  if (!data) { console.log('  ' + (wantKind === null ? 'ok  ' : 'FAIL') + ' ' + label + ' -> null'); return; }
  const n = data.lines ? data.lines.length : 0;
  const first = data.lines && data.lines[0] ? data.lines[0] : null;
  console.log(`  ${data.kind === wantKind ? 'ok  ' : 'FAIL'} ${label} -> kind=${data.kind} lines=${n} src=${data.source || '-'}`);
  if (first) console.log(`       t0=${first.t.toFixed(2)} "${first.text}"`);
  if (data.kind === 'synced') {
    const mono = data.lines.every((l, i) => i === 0 || l.t >= data.lines[i - 1].t);
    console.log(`       monotonic=${mono} lastT=${data.lines[n - 1].t.toFixed(1)}`);
  }
}

(async () => {
  console.log('\nlive lrclib');

  report('Radiohead - Creep',
    await fetchLyrics({ title: 'Creep', artist: 'Radiohead', album: 'Pablo Honey', duration: 239 }),
    'synced');

  await new Promise((r) => setTimeout(r, 1200));

  report('Daft Punk feat. sample (mismatched metadata)',
    await fetchLyrics({ title: 'Get Lucky feat. Pharrell Williams & Nile Rodgers', artist: 'Daft Punk', album: '', duration: 248 }),
    'synced');

  await new Promise((r) => setTimeout(r, 1200));

  report('TV/music-video style title (cleaned for search)',
    await fetchLyrics({ title: 'Creep (Official Video)', artist: 'Radiohead - Topic', album: '', duration: 0 }),
    'synced');

  await new Promise((r) => setTimeout(r, 1200));

  report('obscure nonsense track (expect no lyrics)',
    await fetchLyrics({ title: 'zzqx nonexistent tune 4471', artist: 'nobody at all', album: '', duration: 200 }),
    null);

  process.exit(0);
})();
