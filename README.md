# VJ Rig

Venue-agnostic live visuals: S-1–reactive shaders (MIDI + USB audio), shader effects panel, modular scenes, and optional TouchDesigner MIDI clock over OSC.

## Quick start

```bash
git submodule update --init --recursive
npm install
npm start
```

Open [http://localhost:3301](http://localhost:3301) in **Chrome or Edge** (Web MIDI). Saving files under `public/` reloads the page automatically.

Optional seed: `http://localhost:3301/?seed=my-show-seed`

## Keyboard

| Key | Action |
|-----|--------|
| `D` | Debug panel (FPS, audio) |
| `E` | Shader effects panel (+ MIDI learn on params) |
| `V` | Scene params panel (+ MIDI learn) |
| `L` | Loop countdown |
| `C` | Toggle download controls |
| `G` | Symmetry debug |
| `M` | MIDI clock overlay (OSC) |
| `0`–`9` | Scene select (buffered, e.g. `1` `2` → scene 12) |

## Roland S-1 (MIDI + USB audio)

Use the S-1 as a linked performance controller: turning Filter / LFO / ENV knobs drives both the synth and the shader FX.

**Setup**

1. USB-C to the computer; **AIRA LINK off**, then power-cycle the S-1 if ports don’t appear.
2. Set the S-1 MIDI channel to **3** (dashboard default).
3. Click the canvas once to unlock audio + MIDI permissions.

**Preset CC map** (MIDI channel 3) — see `public/midi/s1Midi.js`:

| CC | S-1 | Shader param |
|----|-----|----------------|
| 74 | Filter Cutoff | `pixelSort.threshold` |
| 71 | Filter Reso | `pixelSort.sortAmount` |
| 3 | LFO Rate | `symmetry.rotationSpeed` |
| 13 | LFO Pitch | `symmetry.rotationStartingAngle` (smoothed) |
| 73 | Env Attack | `pixelSort.invert` |
| 75 | Env Decay | `pixelSort.sampleCount` |
| 30 | Env Sustain | `symmetry.translationSpeedX/Y` |
| 72 | Env Release | `symmetry.timeMultiplier` |

**Learn** — press **learn** next to a param in panel **E** or **V**, then turn any CC. That binding overrides the preset for that CC and is stored in `localStorage` (`vjMidiLearns`).

**USB audio** — `audioKnob` prefers the S-1 USB interface (`setSource("s1")`). Panel **D** should show `receiving` when the S-1 is playing. Falls back to the default mic if the S-1 audio device isn’t found.

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
public/midi/      s1Midi.js, midiClockOsc.js
public/scene/     modular scene host
public/scenes/    scene folders
public/library/   generative-utils submodule
scripts/          osc-bridge.js, osc-test.js, dev-server.js
```

## Library submodule

[`jobarbo/generative-utils`](https://github.com/jobarbo/generative-utils) is pinned under `public/library`. `midiClockOsc.js` is vendored in `public/midi/` until that util lands on the library main branch.
