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
  'window.__x={squash:squash,parseLrc:parseLrc,fillGaps:fillGaps,transferTimings:transferTimings,rank:rank,splitPlain:splitPlain,videoTitle:videoTitle,videoArtist:videoArtist};\n  window.customCards = window.customCards'
));

const X = global.window.__x;

let pass = 0;
let fail = 0;
function eq(name, got, want) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n       got  ' + g + '\n       want ' + w); }
}
function near(name, got, want, tol) {
  if (Math.abs(got - want) <= tol) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n       got  ' + got + '\n       want ' + want + ' +-' + tol); }
}

console.log('\nsquash');
eq('diacritics', X.squash('Beyoncé'), 'beyonce');
eq('remaster tag', X.squash('Creep (Remastered 2011)'), 'creep');
eq('feat', X.squash('Song feat. Someone'), 'song');
eq('bracket', X.squash('Song [Live]'), 'song');
eq('punct', X.squash("Don't Stop Me Now!"), 'dont stop me now');
eq('empty', X.squash(undefined), '');

console.log('\nparseLrc');
const lrc = `[00:19.16] When you were here before
[00:24.09] Couldn't look you in the eye
[01:02.50] second
[00:05.00] earlier line out of order`;
const parsed = X.parseLrc(lrc);
eq('sorted count', parsed.length, 4);
eq('first t', parsed[0].t, 5);
eq('second t', parsed[1].t, 19.16);
eq('text clean', parsed[2].text, "Couldn't look you in the eye");
eq('min t', parsed[3].t, 62.5);

const multi = X.parseLrc(`[00:10.00][00:20.00] repeated hook`);
eq('multi stamp count', multi.length, 2);
eq('multi stamp times', multi.map(l => l.t), [10, 20]);
eq('no stamp ignored', X.parseLrc('just text\n[00:01.00] ok').length, 1);
eq('empty line ignored', X.parseLrc('[00:01.00] a\n[00:02.00]\n[00:03.00] b').length, 2);

console.log('\nfillGaps');
eq('all null -> paced', X.fillGaps([null, null, null], 3), [0, 4.5, 9]);
eq('lead + tail gaps', X.fillGaps([null, 30, 34, 38, null, null], 6), [26, 30, 34, 38, 42, 46]);
eq('single anchor -> paced', X.fillGaps([null, null, 10, null], 4), [0, 4.5, 10, 13.5]);
eq('no gaps untouched', X.fillGaps([1, 2, 3], 3), [1, 2, 3]);
eq('leading never negative', X.fillGaps([null, null, 0.5, 4], 4), [0, 0, 0.5, 4]);

console.log('\ntransferTimings');
const plain = ['When you were here before', "Couldn't look you in the eye", 'Youre just like an angel', 'Your skin makes me cry', 'You float like a feather', 'In a beautiful world', 'I wish I was special'];
const keys = new Set(plain.map(X.squash));
const donorSame = {
  syncedLyrics: `[00:19.16] When you were here before
[00:24.09] Couldn't look you in the eye
[00:29.24] Youre just like an angel
[00:34.49] Your skin makes me cry
[00:39.77] You float like a feather
[00:45.02] In a beautiful world
[00:50.30] I wish I was special`
};
const t1 = X.transferTimings(plain, keys, [donorSame]);
eq('exact transfer t0', t1[0], 19.16);
eq('exact transfer t6', t1[6], 50.30);
eq('exact transfer len', t1.length, 7);

const donorNoisy = {
  syncedLyrics: `[00:19.16] When you were here before
[00:29.24] Youre just like an angel
[00:39.77] You float like a feather
[00:50.30] I wish I was special`
};
const t2 = X.transferTimings(plain, keys, [donorNoisy]);
eq('anchored line kept', t2[2], 29.24);
eq('anchored line kept 2', t2[4], 39.77);
near('skipped line interpolated', t2[1], 24.35, 0.05);
near('skipped line interpolated 2', t2[3], 34.43, 0.1);
eq('all lines stamped', t2.every(function (v) { return v != null; }), true);

const donorUnrelated = { syncedLyrics: '[00:01.00] totally\n[00:02.00] different\n[00:03.00] words\n[00:04.00] here\n[00:05.00] ok' };
eq('unrelated donor rejected', X.transferTimings(plain, keys, [donorUnrelated]), null);
eq('empty candidates rejected', X.transferTimings(plain, keys, []), null);

console.log('\nrank');
const want = { title: 'Creep', artist: 'Radiohead', album: 'Pablo Honey', duration: 239 };
eq('exact best', X.rank({ trackName: 'Creep', artistName: 'Radiohead', albumName: 'Pablo Honey', duration: 239 }, want) >
   X.rank({ trackName: 'Creep (Live)', artistName: 'Someone', albumName: 'X', duration: 500 }, want), true);
eq('duration mismatch penalised', X.rank({ trackName: 'Creep', artistName: 'Radiohead', duration: 400 }, want) <
   X.rank({ trackName: 'Creep', artistName: 'Radiohead', duration: 240 }, want), true);

console.log('\nsplitPlain');
eq('filters stamps', X.splitPlain('[00:01.00]\nreal line\n\n[00:02.00]\nanother'), ['real line', 'another']);
eq('trims', X.splitPlain('  a  \n  b '), ['a', 'b']);

console.log('\nvideoTitle / videoArtist');
eq('official video', X.videoTitle('Song Name (Official Video)'), 'Song Name');
eq('official audio', X.videoTitle('Song Name (Official Audio)'), 'Song Name');
eq('lyric video', X.videoTitle('Song Name (Official Lyric Video)'), 'Song Name');
eq('square bracket', X.videoTitle('Song Name [Official Lyric Video]'), 'Song Name');
eq('dash suffix', X.videoTitle('Song Name - Official Audio'), 'Song Name');
eq('bare audio suffix', X.videoTitle('Song Name (Audio)'), 'Song Name');
eq('explicit tag', X.videoTitle('Song Name (Explicit)'), 'Song Name');
eq('no tag untouched', X.videoTitle('Song Name'), 'Song Name');
eq('topic artist dropped', X.videoArtist('Artist - Topic'), 'Artist');
eq('vevo artist dropped', X.videoArtist('Artist - Vevo'), 'Artist');
eq('youtube alone dropped', X.videoArtist('YouTube'), '');
eq('yt alone dropped', X.videoArtist('yt'), '');
eq('channel kept', X.videoArtist('Some Channel'), 'Some Channel');

console.log('\nresult: ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
