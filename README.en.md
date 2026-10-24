# dsh-voice-studio-plugin

**[简体中文](README.md)** | English

A desktop character for DeepSeek Harness (DSH) that talks and sings.

It reads AI replies aloud, adds a tiny speaker button under every message, opens a voice panel from a right-click on the character, and downloads new voices from a built-in model market — **voice models, reference audio, and artwork are all configured through profile directories, so swapping characters requires zero code changes.**

> Most voice plugins hard-code one specific character. This plugin turns characters into configuration: drop a directory into `profiles/`, get a new character.

---

## Features

### Speaking (GPT-SoVITS / SAPI)

- **Try speaking**: type text in the panel and hear it immediately
- **Replay last**: re-reads whatever the model actually spoke last (speaker button, auto-read, or manual input)
- **Auto-read**: automatically speaks each completed AI reply (optional)
- **Text cleaning**: strips code blocks, tables, links, and Markdown symbols; long texts are synthesized in segments with a per-turn character cap
- **Voice cache**: identical text (with identical parameters) returns instantly; 100 MB cap with automatic eviction
- **Duration-glitch defense**: output that wildly exceeds the estimated duration for its text (stretched speech) is retried automatically; long trailing silence is trimmed; corrupted cache entries are re-synthesized on replay
- **Tunable parameters**: 8 sliders — volume, speed, temperature, topK, topP, repetition penalty, inter-sentence pause, idle cooldown
- **Warm-up & VRAM management**: the warm-up switch truly controls VRAM — GPT-SoVITS has no `/unload`, so turning warm-up off terminates the service process and frees VRAM; idle cooldown unloads automatically
- **SAPI fallback**: the built-in "System Voice" character uses Windows SAPI — zero dependencies, works out of the box

### Singing (Seed-VC)

- Source song dropdown (reads the server-side song library) → one-click conversion → auto playback
- Conversion queue: one song at a time, auto-advances, cancellable
- Backing handling (keep/remove), vocal gain, backing gain, and diffusion steps are adjustable
- Model preload switch (off calls `/unload` to free VRAM)

### Desktop Widget (Character)

- 16 animated sprites (14 idle + 2 speaking), random idle rotation
- Switches to "voice" sprites while speaking/singing, back to idle afterwards
- Free dragging; no edge snapping on release — only when the window is resized
- 5 rapid left-clicks swap the sprite; right-click opens the panel; hideable and flippable
- Ellipse bubble: light guidance next to the character during warm-up/errors; details live in the panel

### Message Speaker Button

- Injects a speak button under every AI message (DSH slot `conversation.chat.assistant-actions`)
- Click to read that message; breathing animation while speaking
- Never affects message layout, and failures never break the chat

### Model Market

- 50 voice models categorized by origin (Games 26 / Anime 16 / Virtual Streamers & Singers 7 / System 1)
- Download (resumable) / cancel / uninstall / progress display; real sizes are written back after download
- Models without reference audio carry a "reference audio required" badge
- The catalog only lists sources and hosts no weights; downloads go directly from your machine to the source site

### Settings Page

DSH Settings (avatar at bottom-left) → "Voice" section: Speaking / Singing / Model Market / Appearance tabs. Every switch and slider lives here, and everything keeps working when the widget is hidden.

---

## Requirements

| Dependency | Notes |
| --- | --- |
| Windows | SAPI fallback and windowless `pythonw` launching depend on Windows |
| DSH | `>=0.1.7-rc.1 <0.3.0-0` (`engines.dsh`) |
| GPT-SoVITS (optional) | `api_v2.py` server; NVIDIA GPU recommended |
| Seed-VC (optional) | singing conversion server; API below |
| Mic / internet | not required; all services use the loopback interface only |

It works without any Python services: the built-in "System Voice" character (Windows SAPI) has zero dependencies.

---

## Installation

Local development (`link:` to the source directory; restart DSH after changes):

```bash
dsh plugin --profile <your-profile> add link:C:/path/to/dsh-voice-studio-plugin
```

Once published to npm:

```bash
dsh plugin --profile <your-profile> add dsh-voice-studio-plugin
```

Enable it in DSH Settings → Voice after installing.

---

## Configuring a Character

Copy `profiles/_template/` to `profiles/<character-id>/` and edit `profile.json`:

```json
{
  "id": "my-voice",
  "name": "My Character",
  "description": "A one-line intro shown in the panel and settings",
  "builtin": false,
  "assets": {
    "icon": "",
    "background": ""
  },
  "tts": {
    "engine": "gpt-sovits",
    "baseUrl": "http://127.0.0.1:9880",
    "refAudio": "D:/path/to/ref.wav",
    "promptText": "Write out the exact words spoken in the reference audio",
    "promptLang": "zh",
    "textLang": "zh",
    "sapiVoice": ""
  },
  "svc": {
    "baseUrl": "http://127.0.0.1:9890",
    "refAudio": "",
    "backing": "keep",
    "steps": 30
  },
  "modelFiles": { "gpt": "", "sovits": "" }
}
```

### Field Reference

| Field | Notes |
| --- | --- |
| `id` | unique character id, letters/digits/`_`/`-` only; directories starting with `_` are skipped (template) |
| `name` / `description` | shown in the panel and settings |
| `assets.icon` | avatar image; if empty, looks for `icon.<png/jpg/jpeg/webp/gif>` in the character's `assets/` dir, then falls back to the built-in `assets/whale.png` |
| `assets.background` | widget background; if empty, looks for `background.<webp/png/jpg>`, then falls back to the built-in `assets/background.webp` |
| `tts.engine` | `gpt-sovits` (default) or `sapi` (system voice; only `sapiVoice` needed) |
| `tts.baseUrl` | TTS service address; empty uses the global `ttsUrl` |
| `tts.refAudio` | **required for GPT-SoVITS**, absolute path to the reference audio (readable by the server) |
| `tts.promptText` | verbatim transcript of the reference audio; directly affects quality |
| `tts.sapiVoice` | SAPI system voice name; empty uses the default |
| `svc.baseUrl` | singing service address; empty means this character doesn't sing (or singing is globally off) |
| `svc.backing` | backing handling: `off` / `keep` / `discard` |
| `modelFiles.gpt` / `modelFiles.sovits` | absolute paths to fine-tuned weights; when set, they are pushed to the server before warm-up/synthesis (`/set_gpt_weights`, `/set_sovits_weights`); filled in automatically for market downloads |

Artwork can also be uploaded directly in the panel ("Edit character / background"), supporting png/jpg/jpeg/webp/gif.

---

## Global Configuration

Change these in DSH Settings → Voice (persisted to `user-config.json` in the plugin directory), or edit the file directly. Defaults:

| Key | Default | Notes |
| --- | --- | --- |
| `enabled` | `true` | master switch |
| `autoSpeak` | `false` | auto-read every AI reply |
| `volume` | `1` | volume 0~1 |
| `speed` | `1` | speed 0.5~2 |
| `profile` | `""` | current character id; empty uses the first one |
| `ttsUrl` | `http://127.0.0.1:9880` | global TTS address (used when the character has none) |
| `svcUrl` | `""` | global SVC address |
| `wakePort` | `9881` | wake port, 0 = off |
| `wakeEnabled` | `true` | wake port switch |
| `idleUnloadMs` | `300000` | idle cooldown (5 min), 0 = never |
| `ttsUnloadOnExit` / `svcUnloadOnExit` | `true` | unload models / kill processes on DSH exit |
| `svcEnabled` | `true` | singing master switch |
| `maxCharsPerTurn` | `1200` | per-turn character cap (100~8000) |
| `segmentChars` | `120` | characters per synthesis segment (40~500) |
| `temperature` | `0.7` | sampling temperature (0.05~2) |
| `topK` / `topP` | `10` / `0.9` | sampling range |
| `repetitionPenalty` | `1.35` | repetition penalty |
| `fragmentInterval` | `0.4` | inter-sentence pause (seconds) |
| `widgetSize` | `104` | character size (64~240 px) |
| `widgetFlip` / `widgetVisible` | `false` / `true` | flip horizontally / hide |
| `glassBlur` | `14` | glass blur strength (0~40) |
| `theme` / `accent` | `whale` / `""` | theme / accent color |
| `svcSteps` | `30` | singing diffusion steps (10~60) |
| `vocalGain` / `backingGain` | `1` / `0.9` | vocal/backing gain (0~1.5) |
| `pythonPath` | `""` | Python interpreter (for auto-launch; the venv `Scripts` dir or a full `pythonw.exe` path is recommended) |
| `ttsScript` / `ttsCwd` | `""` / `""` | GPT-SoVITS launch script / working dir (empty cwd = script dir) |
| `svcScript` / `svcCwd` | `""` / `""` | Seed-VC launch script / working dir (same) |

---

## Service Integration

The plugin embeds no models; it only calls local HTTP services. **Services may start before the plugin**: the plugin probes ports at startup and before every use, and reuses anything already running instead of launching duplicates.

### TTS (GPT-SoVITS `api_v2.py`)

Requests `GET /tts` with query parameters:

| Parameter | Value |
| --- | --- |
| `text` / `text_lang` | text to speak / language (from the character) |
| `ref_audio_path` / `prompt_text` / `prompt_lang` | the character's reference audio and transcript |
| `media_type` / `streaming_mode` | `wav` / `false` |
| `temperature` / `top_k` / `top_p` / `repetition_penalty` / `fragment_interval` / `speed_factor` | sampling parameters from global config |

Optional `GET /vram`: returns `{ vramMb }` for the status page (falls back to a delta estimate when absent).

**Warm-up semantics** (`api_v2` has no `/warm` or `/unload`):

- Warm-up = one ultra-short test synthesis to trigger lazy model loading
- Turning warm-up off = find the process by port and terminate it, actually freeing VRAM
- Idle cooldown expiry: SVC calls `/unload`; TTS only clears its warm flag (process stays, instant next time)

### SVC (Seed-VC `svc_server.py`)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/health` | `{ ready, busy, loading, vramMb, ... }` |
| GET | `/library` | song library `{ dir, items: [{name, bytes}] }` |
| POST | `/sing` | conversion; body below |
| GET | `/audio/<file>` | fetch the resulting wav |
| GET | `/warm` / `/unload` | preload / unload the model |

`POST /sing` body:

```json
{
  "source": "file name in the song library",
  "steps": 30,
  "backing": "keep",
  "vocalGain": 1,
  "backingGain": 0.9,
  "ref": "optional absolute path to reference timbre"
}
```

Three `backing` modes: `off` converts the whole mix (muddy for sources with backing) / `keep` separates vocals, converts them, and remixes the original backing / `discard` outputs vocals only (good for voice messages). Conversion is heavy: a 30-second song takes roughly 15~60 seconds on a consumer GPU, and only one job runs at a time.

### Auto-launching Services (configurable)

When TTS / SVC are offline, the plugin tries to launch them (windowless `pythonw`, detached, 512 KB log rotation, 90 s readiness wait, launch lock against double-starts). Launching needs five deployment paths (in `user-config.json`, or via the `/config` API):

```json
{
  "pythonPath": "D:/gpt-sovits/venv/Scripts",
  "ttsScript": "D:/gpt-sovits/api_v2.py",
  "ttsCwd": "D:/gpt-sovits",
  "svcScript": "D:/seed-vc/svc_server.py",
  "svcCwd": "D:/seed-vc"
}
```

- `pythonPath` accepts the venv `Scripts` directory (auto-prefers `pythonw.exe`), a `python.exe` (auto-swapped to the sibling `pythonw.exe`), or a full `pythonw.exe` path
- Empty `ttsCwd` / `svcCwd` defaults to the corresponding script's directory
- All five empty by default = no auto-launch; only already-running services are detected and reused. When deploying for others, either pre-start the services or have them fill in their own paths

---

## Wake Port (External Program Interface)

TCP `127.0.0.1:9881`, one command per line and one reply per command (TCP instead of HTTP because the DSH web service is authenticated and external processes can't get a token):

```
ping            -> ok / err
wake or tts     -> ensure TTS is up and warmed (ok immediately if already running)
sing or svc     -> ensure SVC is up and preloaded
```

Bots such as qq-bridge can use this to spin up voice services before speaking.

---

## Debug HTTP API (developers)

Routes are mounted on the DSH web server (prefix `/voice-studio`, same port as DSH, directly reachable from the browser). Common ones:

| Path | Method | Notes |
| --- | --- | --- |
| `/status` | GET | overall status: services, VRAM, queues, current character |
| `/config` | GET / POST | read / write global config (POST sends a partial patch) |
| `/speak` | POST | `{text}` enqueues synthesis; empty text = replay the last spoken content |
| `/poll` | GET | fetch synthesized audio (base64; consumed on read) |
| `/clear` | POST | clear the speech queue (stop button) |
| `/tts-warm` | POST | toggle TTS warm-up (on = launch + warm, off = kill process) |
| `/svc-toggle` | POST | toggle SVC preload (on = warm, off = unload) |
| `/sing` | POST | `{source, steps, backing, ...}` enqueues conversion |
| `/songs` | GET | song library |
| `/market` and `/market/download|progress|cancel|clear|uninstall` | GET/POST | model market and download management |
| `/probe` | GET | check SAPI / TTS / SVC availability |
| `/moods` / `/mood?name=` | GET | sprite list / single sprite (Range supported) |
| `/asset?name=` / `/icon?name=` | GET | character assets / built-in icons |
| `/upload` | POST | upload artwork/background (base64 data URL, ≤8 MB) |
| `/clientlog` | POST | frontend log reporting |
| `/open-folder?which=` | POST | open song library / character directory |

---

## Project Structure

```
dsh-voice-studio-plugin/
├── index.js               plugin entry (backend): 23 HTTP routes, session listener,
│                          wake port, idle cooldown, exit cleanup
├── client.js              settings page + speaker button (DSH slots, separate script)
├── client/
│   ├── main.js            character widget (Shadow DOM): sprites, bubble, panel, dragging
│   ├── panel.css          panel styles
│   └── src/               api / dom / store / controls / player / dropdown
│       └── pages/         speak / sing / market / look pages
├── src/
│   ├── config.js          config normalization + character scanning (skips _ dirs)
│   ├── text.js            text cleaning / segmentation / truncation
│   ├── audio.js           WAV duration parsing + tail-silence trimming (duration-glitch defense)
│   ├── market/index.js    market catalog / downloads (Range resume) / uninstall
│   ├── services/proc.js   process launching (pythonw, detached, log rotation, concurrency lock)
│   ├── services/vram.js   VRAM reading (self-reported first, baseline-delta fallback)
│   ├── tts/client.js      GPT-SoVITS client (/tts, /vram, /set_*_weights; warm-up = short synthesis)
│   ├── tts/sapi.js        Windows SAPI
│   └── svc/client.js      Seed-VC client
├── profiles/
│   ├── builtin/           built-in system voice (SAPI, zero deps)
│   ├── _template/         character template (copy it for new characters)
│   └── <your-character>/  profile.json + assets/ + models/
├── market/index.json      catalog of 50 models
├── assets/                whale.png, background.webp, moods/ (16 sprites), bubbles/
├── locale/                plugin-manager title/description (en / zh)
├── icon.webp              plugin icon (the "megaphone" speaking sprite)
└── cordis.patch.yml       DSH config injection
```

Runtime artifacts: `user-config.json` (user config), `cache/` (voice cache, 100 MB cap), `debug.log` / `tts-server.log` / `svc-server.log` (logs, 512 KB rotation), `.vram-baseline.json` (VRAM baseline).

---

## Development Notes

- `link:` installs do **not** hot-reload: restart DSH to pick up changes
- Run `node --check` over all changed JS; check brace balance after editing `panel.css`
- The two frontend scripts (`client.js` and `client/main.js`) share no modules; their only channel is `window.__DSH_VOICE_STUDIO__`
- Historical pitfalls and hard constraints live in `.rewrite/PITFALLS.md` (Shadow DOM, dropdowns, process launching, etc. — each rule traces to a real bug)

---

## Known Limitations

- Fine-tuned weight loading relies on api_v2's `/set_gpt_weights` / `/set_sovits_weights`; the first warm-up/synthesis after a plugin restart re-pushes the weights (a few extra seconds) so the right character's weights are always loaded regardless of the server's defaults
- Characters without `modelFiles` run zero-shot: timbre follows `refAudio` + `promptText`, lower fidelity than fine-tuned weights
- All services are restricted to the loopback interface (prevents chat content from leaving the machine)
- VRAM estimation depends on self-reporting; the whole-card delta fallback under WDDM cannot attribute per-process
- Reference audio must be a local absolute path readable by the server
- Singing conversion output is not cleaned automatically; manage the server's output directory yourself
- Market-downloaded models land in the plugin's `profiles/` directory; reinstalling/upgrading via npm wipes it — back up as needed
- Market models come from third parties (HuggingFace / ModelScope etc.); licenses are noted where known, but voice rights may involve character copyright — evaluate your own usage

---

## License

Code is MIT. Each voice model carries its own license (noted in market entries); this repository hosts no weight files.
