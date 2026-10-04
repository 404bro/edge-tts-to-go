# edge-tts-to-go

[中文](README.zh-CN.md) | English

A Windows desktop app that reads text aloud with the online text-to-speech
service of Microsoft Edge, streaming the audio so playback starts almost
immediately. Built with Electron; it talks to the service directly and does
not need Python or the [edge-tts](https://github.com/rany2/edge-tts) package.

## Features

- **Streaming playback**: the text is split into sentence-based segments that
  are synthesized a few at a time, just ahead of what you are hearing.
- **Seek anywhere**: drag the progress bar into a part that has not been
  synthesized yet and synthesis continues from the estimated position (the
  matching proportion within the segment). Parts already synthesized are
  cached and play instantly.
- **Click any segment**: synthesized segments play at once; grey,
  not-yet-synthesized ones are synthesized first and stay grey until ready.
- **Download the whole result** as one MP3 or WAV file. Missing segments are
  synthesized (in parallel) before saving.
- Playback speed (pitch preserved, applied instantly) and speech rate
  (applied by the synthesizer; fixed while reading, change it after Stop).
- 300+ voices, filtered by language.
- Light / dark / system theme, Chinese / English interface.
- Settings and text are remembered between runs.

## Download

Build the portable `.exe` yourself (see below); it runs without
installation. Windows 10/11 only for now.

## Development

Requires [Node.js](https://nodejs.org/) 18 or newer.

```sh
npm install
npm start          # run the app
npm run smoke      # command-line check: list voices, synthesize to out.mp3
npm run dist       # build the portable .exe into dist/
```

### Project layout

```
src/main/main.js          Electron main process: window, IPC, settings, save dialog
src/main/engine.js        per-request segment scheduling and caching
src/main/i18n.js          main-process messages (dialogs, errors)
src/main/tts/             protocol: Sec-MS-GEC token, WebSocket synthesis, voice list,
                          sentence segmentation
src/preload/preload.js    the window.api bridge used by the page
src/renderer/             UI: index.html, styles.css, renderer.js (player),
                          i18n.js (UI strings), wav.js (WAV export)
scripts/smoke.js          protocol smoke test
```

### How it works

- **Protocol** (`src/main/tts/`): a minimal JavaScript port of the parts of
  edge-tts needed to get MP3 audio: the `Sec-MS-GEC` token (with clock skew
  correction on HTTP 403), one WebSocket per ≤4096-byte chunk of escaped SSML
  text, and the voice list. Output is 24 kHz 48 kbps mono MP3. It uses the
  `ws` package because WebSocket headers such as `Origin` and `User-Agent`
  must be set.
- **Scheduling** (`engine.js`): the page reports the segment it is playing;
  the engine keeps that segment and the next two synthesized. Seeking moves
  this window. Export synthesizes all missing segments with three parallel
  connections.
- **Playback** (`renderer.js`): received audio is kept per segment. A virtual
  timeline is built from exact lengths of synthesized segments (constant
  bitrate: bytes × 8 / 48000) and estimated lengths of the others. The audio
  element plays a MediaSource "chain" of consecutive segments; seeking
  outside it starts a new chain at the target segment.
- **Export**: MP3 segments are concatenated; for WAV they are decoded with
  Web Audio and written as 16-bit PCM.

## License

LGPL-3.0 — see [LICENSE](LICENSE) (and [COPYING](COPYING) for the GPLv3 text
it incorporates).

The protocol code in `src/main/tts/` is ported from
[edge-tts](https://github.com/rany2/edge-tts) (LGPLv3, by rany and
contributors), and the UI is based on its `examples/desktop_app`, so this
project uses the same license. It does not include or depend on the edge-tts
package.

## Disclaimer

This is an unofficial project, not affiliated with or endorsed by Microsoft.
It uses an undocumented online service that may change or stop working at any
time. Please respect Microsoft's terms of service.
