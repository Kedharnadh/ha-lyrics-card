# Lyrics Card for Home Assistant

A single-file Lovelace card that shows lyrics for whatever is playing on any
`media_player`, synced to playback. No custom integration, no dependencies, no
API key.

```
raw 27.4 KB   ·   gzip 8.1 KB
```

## Features

- **Any source.** Looks up `media_title` + `media_artist` + `media_album` on
  [LRCLIB](https://lrclib.net), a free, no-auth, CORS-open lyrics database.
  Falls back to `/api/search` when the exact match misses, so slightly wrong
  metadata (missing album, `feat.` suffixes, live versions) still resolves.
- **Synced when available.** Parses LRC timestamps and highlights the current
  line, scrolling it to centre.
- **Static when not.** If the best match has plain lyrics but no timestamps, it
  looks for a *different release of the same song* that does have them, matches
  the text line by line, and transfers the timings across. If that fails it
  paces the lines at a readable rate.
- **No duplicate lyrics.** Two devices playing the same track are grouped into
  one entry. The header shows `Living Room +1` to tell you it's shared.
- **Swipe when tracks differ.** Different tracks become dots in the header.
  Swipe the lyrics horizontally, tap the dots, or tap the card to cycle.
- **Instant.** No polling. It reads state HA already streams over the existing
  websocket and interpolates the play position with a local clock, so the
  highlight is smooth at 5 Hz without a single extra API call.
- **Cached.** Lyrics are stored in `localStorage` per browser (up to 500 tracks,
  180 days). "No lyrics found" is remembered for a day, so a missing track is
  never re-fetched.

## Installation (HACS)

1. Install [HACS](https://hacs.xyz/) if you haven't already.
2. Push this repository to GitHub as **`ha-lyrics-card`**. HACS matches the
   dashboard file to the repository name, and `hacs.json` pins it explicitly via
   `filename`, so the file name must stay `ha-lyrics-card.js`.
3. HACS → **Dashboard** → ⋮ → **Custom repositories** → add
   `https://github.com/Kedharnadh/ha-lyrics-card` with category **Dashboard**.
4. Search HACS for **Lyrics Card** → **Download**.
5. **Settings → Dashboards → Resources** and add, if HACS didn't already:

   | | |
   | --- | --- |
   | URL | `/hacsfiles/ha-lyrics-card/ha-lyrics-card.js` |
   | Type | **JavaScript module** |

6. Reload Lovelace (`Ctrl` + `F5` / hard refresh).

## Usage

```yaml
type: custom:ha-lyrics-card
```

It picks up every playing `media_player` automatically. You can also add it from
the card picker by searching for **Lyrics Card**.

### Options

| Option | Default | Description |
| --- | --- | --- |
| `entities` | all `media_player`s | Restrict to specific players |
| `max_lines` | `7` | Visible line height, in lines |
| `font_size` | `28` | Lyric font size in px |
| `line_height` | `38` | Line box height in px — raise this if lines wrap |
| `smooth` | `true` | Smooth scroll to the active line |
| `show_progress` | `true` | Thin progress bar under the lyrics |

```yaml
type: custom:ha-lyrics-card
entities:
  - media_player.spotify
  - media_player.living_room_tv
max_lines: 5
font_size: 32
line_height: 44
```

## Manual installation

Copy `ha-lyrics-card.js` into `config/www/`, add
`/local/ha-lyrics-card.js` as a **JavaScript module** resource, then use
`type: custom:ha-lyrics-card`.

## Nudging static lyrics

When timings are estimated rather than real, a small control row appears at the
bottom right: `−  +0s  +  ↺  ⟳`.

- `−` / `+` shift the lyrics by a second. Hold to repeat, or scroll over the
  number. Adjustments are remembered per track.
- `↺` resets the shift.
- `⟳` clears the cache and re-fetches, in case lyrics were added upstream.

## Development / CI

- `.github/workflows/hacs.yaml` runs [HACS validation](https://github.com/hacs/action)
  plus the test suite on every push and pull request.
- `.github/workflows/release.yaml` turns a tag (`v1.0.0`) into a GitHub Release.
  HACS tracks the default branch for updates, so tagging is only needed if you
  want a release page.
- Tests are plain Node scripts, no dependencies:

  ```
  node tests/test-logic.js   # LRC parsing, gap filling, timing transfer
  node tests/test-card.js    # grouping, dedupe, swipe, line sync (DOM shim)
  node tests/test-live.js    # end-to-end against the real LRCLIB API
  ```

## Notes

- Syncing depends on the media player reporting `media_position`. Players that
  only update it on track change still work, because the card extrapolates from
  its own clock and re-anchors whenever HA's value moves.
- Purely client-side, so lyrics are fetched from the browser's IP rather than
  your server's.
- Lyrics come from LRCLIB, a community-run database. Coverage is good for
  mainstream music and thin for library music or regional releases.

## Credits

Lyrics data provided by [LRCLIB](https://lrclib.net). This project is not
affiliated with LRCLIB or Home Assistant.

## License

MIT — see [LICENSE](LICENSE).
