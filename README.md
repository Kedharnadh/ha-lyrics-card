# Now Playing & Lyrics Card

A single-file Lovelace card that shows what's playing and its lyrics — synced to
playback — with media controls built in. It replaces the common two-card setup
(a "now playing" card plus a lyrics card) with one card that autodetects any
`media_player` on the dashboard. No custom integration, no dependencies, no
API key.

```
raw 82.1 KB   ·   gzip ~21 KB
```

![Lyrics card: synced lyrics on the left, static lyrics with manual offset controls on the right](docs/card.png)

## Features

- **Any source, any player.** Picks up every `media_player` in `playing` or
  `paused` state with a `media_title` — you don't even have to configure an
  entity. Looks up `media_title` + `media_artist` + `media_album` on
  [LRCLIB](https://lrclib.net), a free, no-auth, CORS-open lyrics database.
  Falls back to `/api/search` when the exact match misses, so slightly wrong
  metadata (missing album, `feat.` suffixes, live versions) still resolves.
- **YouTube-style titles.** Cast and Google TV devices report titles like
  `Creep (Official Video)`. Those suffixes are stripped before the lookup so the
  actual song still gets found.
- **Synced when available.** Parses LRC timestamps and highlights the current
  line, scrolling it to centre.
- **Static when not.** If the best match has plain lyrics but no timestamps, it
  looks for a *different release of the same song* that does have them, matches
  the text line by line, and transfers the timings across. If that fails it
  paces the lines at a readable rate.
- **Media controls, gated by what the player supports.** Play/pause, next,
  previous, mute, a volume slider (debounced), and an optional power button.
  Buttons only appear when the player's `supported_features` say they work —
  the volume slider becomes `+`/`−` buttons for players that only support
  stepping.
- **Seek.** A progress bar under the lyrics; drag anywhere on it to jump and it
  issues `media_seek`.
- **No duplicate lyrics.** Two devices playing the same track are grouped into
  one entry. The header shows `Living Room +1` to tell you it's shared.
- **Swipe when tracks differ.** Different tracks become dots in the header.
  Swipe left/right to switch, or tap the card.
- **Instant.** No polling. It reads state HA already streams over the existing
  websocket and interpolates the play position with a local clock, so the
  highlight is smooth at 5 Hz without a single extra API call.
- **Cached.** Lyrics are stored in `localStorage` per browser (up to 500 tracks,
  180 days). "No lyrics found" is remembered for a day, so a missing track is
  never re-fetched.
- **Album art and blurred backdrop.** If the player reports a picture, it becomes
  the card's background, blurred and dimmed behind a veil so the lyrics stay
  readable. Adaptive contrast picks a light or dark text colour off the artwork
  automatically.
- **Make it yours.** Five layouts, header styles, card height, fonts, colours,
  art size, blur and dimming are all configurable — see [Options](#options).

## Installation (HACS)

1. Install [HACS](https://hacs.xyz/) if you haven't already.
2. Push this repository to GitHub as **`ha-lyrics-card`**. HACS matches the
   dashboard file to the repository name, and `hacs.json` pins it explicitly via
   `filename`, so the file name must stay `ha-lyrics-card.js`.
3. HACS → **Dashboard** → ⋮ → **Custom repositories** → add
   `https://github.com/Kedharnadh/ha-lyrics-card` with category **Dashboard**.
4. Search HACS for **Now Playing & Lyrics Card** → **Download**.
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

That's it. It picks up every playing or paused `media_player` automatically and
shows a "nothing playing" state when there's nothing to show. You can add it
from the card picker by searching for **Now Playing & Lyrics Card**.

### Options

| Option | Default | Description |
| --- | --- | --- |
| `entity` / `entities` | all `media_player`s | Restrict to specific players |
| `layout` | `focus` | `focus`, `two_line`, `compact`, `minimal` or `karaoke` |
| `max_lines` | `7` | Visible lyric lines |
| `font_size` | `26` | Lyric font size in px |
| `font_family` | `system-ui` | Lyric font family |
| `font_weight` | `700` | Lyric font weight |
| `line_height` | `38` | Line box height in px — raise this if lines wrap |
| `card_height` | auto | Card height, e.g. `260px`, `65vh` |
| `height` | auto | Numeric card height in px (60–1600). Overrides `max_lines` |
| `align` / `alignment` | `center` | Lyric alignment: `left`, `center` or `right` |
| `active_scale` | `1.12` | Scale of the active lyric line |
| `inactive_opacity` | `0.35` | Opacity of non-active lines |
| `smooth` | `true` | Smooth scroll to the active line |
| `show_intro` | `true` | Show a track-info splash before the first lyric |
| `intro_duration` | `3` | Minimum intro length in seconds |
| `intro_font_size` | `48` | Intro splash font size in px |
| `show_sync_slider` | `true` | On-card sync offset slider |
| `sync_offset` | `0` | Starting sync offset in seconds (clamped ±120) |
| `show_track_info` | `true` | Show track title/artist in the header |
| `show_friendly_name` | `true` | Prefix the header with the player name |
| `show_header` | `true` | Show the track header at all |
| `header_layout` | `combined` | `combined`, `split` or `split_reverse` |
| `header_font_size` | `0` | Header font size (0 = inherit) |
| `header_alignment` | `inherit` | Header text alignment |
| `track_info_font_size` | `13` | Title/artist subtitle size in px |
| `show_media_controls` | `true` | Show the player control buttons |
| `media_controls_size` | `30` | Control button size in px |
| `show_volume` | `true` | Volume slider (or `+`/`−` when unsupported) |
| `show_mute` | `true` | Mute button |
| `show_power` | `false` | Power (toggle) button |
| `show_progress` | `true` | Progress bar with seek support |
| `background_mode` | `artwork` | `artwork`, `theme` or `transparent` |
| `background_opacity` | `1` | Card backdrop opacity (0–1) |
| `show_album_art` | `true` | Show album art in the header |
| `art_size` | `42` | Album art size in px (0–200) |
| `artwork_blur` | `14` | Backdrop blur in px (0–80) |
| `artwork_opacity` | `1` | How strongly the art shows through (0–1) |
| `artwork_overlay_opacity` | `0.4` | Dark wash over the art (0–1) |
| `backdrop_blur` | `10` | Additional backdrop blur in px |
| `backdrop_opacity` | `0.22` | Additional backdrop opacity (0–1) |
| `contrast_mode` | `adaptive` | `adaptive` picks text colour from the artwork, `off` disables |
| `text_color_mode` | `auto` | `auto`, `theme`, `light` or `dark` |
| `text_color` | theme | Lyric colour as `#rgb` or `#rrggbb` |
| `highlight_color` | theme | Active-lyric colour as `#rgb` or `#rrggbb` |
| `text_shadow` | `true` | Outline/shadow under the lyrics |
| `text_shadow_strength` | `0.6` | Text shadow strength |
| `plain_lyrics_auto_scroll` | `true` | Auto-scroll plain lyrics with playback position |
| `static_font_size` | `18` | Font size for plain lyrics in px (10–48) |
| `static_scroll` | `true` | Drift plain lyrics up slowly when nothing else knows the timing |
| `static_scroll_speed` | `14` | Drift speed in px per second (4–60) |
| `lyrics_source` | `lrclib` | `lrclib`, or `music_assistant` to try MA first |
| `music_assistant_url` | — | MA server, e.g. `http://ma.local:8095` |
| `music_assistant_token` | — | MA long-lived access token |
| `music_assistant_timeout` | `8` | Seconds to wait for MA before falling back (2–30) |

Legacy names `background_blur`/`background_dim`/`background_veil` (and `align`,
`show_progress`) still work as aliases for `artwork_blur`/`artwork_opacity`/
`artwork_overlay_opacity`. Out-of-range numbers are clamped rather than
rejected, and an unparseable colour falls back to your theme.

Album art is read from whichever of `entity_picture`, `media_image_url`,
`media_image`, `media_picture` or `media_artwork` the player provides. Only
`http(s)` and root-relative URLs are used, so a hostile entity can't smuggle a
`javascript:` or `data:` URL into the card.

### Layouts

- `focus` — one large active line, surrounding lines see-through.
- `two_line` — the active line and the next one both full opacity.
- `compact` — smaller active line, tighter spacing.
- `minimal` — lyrics only, no header.
- `karaoke` — shows three lines with the next line emphasised.

`height` / `card_height` set a fixed card height and are clamped; otherwise the
card sizes itself from `max_lines × line_height`.

### Media controls

Controls appear in the header and are gated by the player's
`supported_features`, so a Chromecast with volume buttons but no seek won't show
a broken slider. Volume input is debounced (150 ms) before `volume_set` is sent,
so dragging the slider doesn't spam the bus. Mute and power mirror the current
device state.

```yaml
type: custom:ha-lyrics-card
entity: media_player.spotify
show_power: true
```

### Keeping a track in sync

When a track's lyrics are a few seconds off, use the on-card `Sync` toolbar:
the `−`/`+` buttons adjust the offset in 0.5 s steps, with the slider for
fine-tuning (enable the toolbar with `show_sync_slider`); or set `sync_offset`
once in YAML. Offsets are remembered per track in `localStorage`; `Reset`
clears them. The offset counts towards the local clock used to pick the active
line, so it stays smooth.

```yaml
type: custom:ha-lyrics-card
sync_offset: -1.5
```

### Unsynced lyrics

Plenty of tracks have plain lyrics with no timings. By default the card
auto-scrolls them with playback when the player reports a duration
(`plain_lyrics_auto_scroll`), and drifts the block upward at
`static_scroll_speed` px per second otherwise, resting on the last line before
looping.

- Scrolling by hand parks it for a few seconds so you can actually read a line.
- `prefers-reduced-motion` is honoured: no drift, the block sits centred and you
  scroll it yourself.
- Synced lyrics are untouched — they keep the large active line and scroll to it.
- The `−`/`+` nudge still works. It shifts the estimate of which line is "now",
  which matters when the timings were borrowed from a different release of the
  same song.

Set `static_scroll: false` to get the old behaviour back: estimated timings with
a large centred highlight.

```yaml
type: custom:ha-lyrics-card
entities:
  - media_player.spotify
  - media_player.living_room_tv
layout: two_line
card_height: 320px
font_size: 30
line_height: 42
```

### A themed, left-aligned card

```yaml
type: custom:ha-lyrics-card
card_height: 320px
align: left
font_size: 30
text_color: "#f2e9dc"
highlight_color: "#ffb703"
art_size: 56
artwork_blur: 26
artwork_overlay_opacity: 0.55
show_friendly_name: false
```

If the blurred artwork ever fights with the lyrics, raise
`artwork_overlay_opacity` towards `1` (or drop `artwork_opacity` to `0`) to push
it further back.

## Lyrics from Music Assistant (optional)

Music Assistant resolves its own synced lyrics and will ask the track's own
provider first (Bandcamp, OpenSubsonic/Navidrome, and others) before falling back
to LRCLIB or Genius. Point the card at it and MA is tried before LRCLIB:

```yaml
type: custom:ha-lyrics-card
lyrics_source: music_assistant
music_assistant_url: http://ma.local:8095
music_assistant_token: !secret ma_lyrics_token
```

To get a token: in Music Assistant go to **Settings → Users → your user → Access
tokens → Add token**. It needs the *Library read* scope. Use the user token, not
the Home Assistant system token — MA rejects the latter on its normal web server.

Everything degrades to LRCLIB automatically, so this is safe to leave on: if MA
is unreachable, the token is wrong, the track is not a Music Assistant item, or
MA has no lyrics, the card falls back to LRCLIB for that track. MA and LRCLIB
results are cached separately, so enabling it never discards lyrics you already
had.

**Please read this before enabling it.** Home Assistant exposes nothing useful
here, which is why the card talks to MA directly:

- The MA `media_player` entity has no lyrics attribute, and the
  `music_assistant` integration registers no websocket commands.
- The `music_assistant.get_queue` action exists, but its response deliberately
  omits lyrics.

So the card speaks MA's own websocket API (`metadata/get_track_lyrics`) directly.
That is an internal MA command with no Home Assistant integration surface and no
deprecation path — it could change in a future MA release. It is opt-in for that
reason, and the LRCLIB path remains the default.

Also worth knowing:

- Only tracks that are actual Music Assistant items work, identified from the
  `provider://media_type/item_id` URI HA puts in `media_content_id`. A plain
  stream URL or a non-MA player just uses LRCLIB.
- Spotify and YouTube Music do **not** supply lyrics to Music Assistant, so
  tracks from those services still resolve through MA's fallback providers —
  which usually means the same LRCLIB data the card would have fetched anyway.
  The extra coverage MA adds is mainly Genius and self-hosted OpenSubsonic.
- Your MA server must be reachable from the browser, and `wss://` is used
  automatically when the URL is `https://`.

## Manual installation

Copy `ha-lyrics-card.js` into `config/www/`, add
`/local/ha-lyrics-card.js` as a **JavaScript module** resource, then use
`type: custom:ha-lyrics-card`.

## Development / CI

- `.github/workflows/hacs.yaml` runs [HACS validation](https://github.com/hacs/action)
  plus the test suite on every push and pull request.
- `.github/workflows/release.yaml` turns a tag (`v1.1.0`) into a GitHub Release.
  HACS tracks the default branch for updates, so tagging is only needed if you
  want a release page.
- Tests are plain Node scripts, no dependencies:

  ```
  node --check ha-lyrics-card.js
  node tests/test-logic.js      # LRC parsing, gap filling, timing transfer
  node tests/test-card.js       # grouping, dedupe, swipe, line sync, controls, options
  node tests/test-degenerate.js # empty/degenerate hass, HA preview behaviour
  node tests/test-live.js       # end-to-end against the real LRCLIB API
  ```

  `tests/dom-shim.js` is the shared miniature DOM used by the two card suites.

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