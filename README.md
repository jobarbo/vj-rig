# VJ Rig

Venue-agnostic live visuals: mic-reactive shaders, MIDI Grid knobs, shader effects panel, and optional TouchDesigner MIDI clock over OSC.

## Quick start

```bash
git submodule update --init --recursive
npm install
npm start
```

Open [http://localhost:3301](http://localhost:3301).

Optional seed: `http://localhost:3301/?seed=my-show-seed`

## Keyboard

| Key | Action |
|-----|--------|
| `D` | Debug panel (FPS, audio) |
| `E` | Shader effects panel |
| `L` | Loop countdown |
| `C` | Toggle download controls |
| `G` | Symmetry debug |
| `M` | MIDI clock overlay (OSC) |

## MIDI Grid

Device name `"Grid"`. CC 32+ map to shader uniforms (see `setupMidiKnobs` in `public/sketch.js`).

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
