# VJ Rig

Venue-agnostic live visuals: mic-reactive shaders, MIDI Grid knobs, shader effects panel, and optional TouchDesigner MIDI clock over OSC.

## Quick start

```bash
git submodule update --init --recursive
npm install
npm start
```

Open [http://localhost:3301](http://localhost:3301). Saving files under `public/` reloads the page automatically.

Optional seed: `http://localhost:3301/?seed=my-show-seed`

## Keyboard

| Key | Action |
|-----|--------|
| `0`–`9` | Scene switch (`1` = local, `2` = first remote, …) |
| `S` | Toggle scene label |
| `D` | Debug panel (FPS, audio) |
| `E` | Shader effects panel |
| `L` | Loop countdown |
| `C` | Toggle download controls |
| `G` | Symmetry debug |
| `M` | MIDI clock overlay (OSC) |

## Scenes

Local sketch + remote iframes. Edit [`public/scenes/scenes-config.js`](public/scenes/scenes-config.js) to add URLs.

Remote scenes with `shaders: true` (default) load through `/scene-proxy/…` so the host can capture their canvas into the local shader pipeline. Use `npm start` (custom dev-server). Set `shaders: false` for a raw iframe with no host FX.

| Control | Scene |
|---------|--------|
| `1` / MIDI CC40 | Local VJ Rig |
| `2` / MIDI CC41 | First remote (ex-lignis by default) |
| `3+` / CC42+ | Next entries in `SCENES` |

## MIDI Grid

Device name `"Grid"`. CC 32–39 map to shader uniforms (see `setupMidiKnobs` / `knob.js`). CC 40+ select scenes.

## Microphone

Audio maps energy → zoom / pixel-sort. Allow mic access when prompted.

## TouchDesigner OSC clock

Terminal 1:

```bash
cp .env.example .env   # set OSC_LOCAL_ADDRESS to your LAN IP if using multicast
npm run osc:bridge
```

Terminal 2: `npm start`

**TouchDesigner OSC Out (unicast):**

- Protocol: Messaging (UDP)
- Network Address: `127.0.0.1`
- Network Port: `1337`
- Local Port: leave empty (do not bind 1337)

Bridge fans out to `ws://localhost:3302`. Sketch connects automatically when `MIDI_CLOCK_CONFIG.ENABLED` is true.

Without TD, test the pipeline:

```bash
npm run osc:test
```

## Layout

```
public/           static sketch (p5 + shaders)
public/library/   generative-utils submodule
scripts/          osc-bridge.js, osc-test.js
```

## Library submodule

[`jobarbo/generative-utils`](https://github.com/jobarbo/generative-utils) is pinned under `public/library`. `midiClockOsc.js` is vendored in `public/midi/` until that util lands on the library main branch.
