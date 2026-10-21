# web-ocean

A real-time ocean renderer written from scratch on WebGPU, with no engine or rendering library. It draws a sunset sea with simulated waves, whitecaps, sun glitter, and a physically based sky with clouds. You fly around it with a free camera.

![Looking toward the sun from 2.4 m above the water](docs/front.jpg)

| 75 degrees off the sun, 2.4 m up | Looking toward the sun from 30 m up |
|---|---|
| ![](docs/side.jpg) | ![](docs/high.jpg) |

## Run it

You need a recent Chrome with WebGPU and a reasonably capable GPU. On a laptop, force Chrome onto the dedicated GPU in the Windows graphics settings, or it will fall back to the integrated one.

Open `ocean.html` directly in the browser. `ocean.min.html` is the same page minified. Both are self-contained and work from `file://`.

To run from source:

```
npm install
npm start        # serves http://localhost:8080/
```

After editing anything under `js/`, run `npm run build` to regenerate both bundles. The minified build strips WGSL comments and whitespace and minifies the JavaScript with esbuild.

## Controls

| Input | Action |
|---|---|
| Click the canvas | Capture the mouse (Esc releases it). Holding the right mouse button also works. |
| Mouse | Look around |
| W A S D | Move |
| Space or E / Q or C | Up / down |
| Shift | 5x speed |
| Mouse wheel | Change base speed |
| H | Settings panel: preset, wind, swell, choppiness, turbidity, foam, sun, haze, clouds, exposure, bloom, sound |
| M | Sound on / off |

On phones and tablets: drag with one finger to look around, tap once to start the sound. The 🔊 and ⚙ buttons in the corner toggle sound and the settings panel on every device.

### Presets, beach and sound

The page opens on the **Taiwan sunset** preset: you stand on the sand of a curved bay at sunset (sun 5° up, wind 6 m/s, clearer deep-blue water), with a headland on each side, coconut palms swaying along the beach, seagulls gliding overhead, little ghost crabs that dash sideways and run up the beach ahead of each wave and a lighthouse on a rocky islet in the bay whose lamp flashes as its beam sweeps round (more noticeable as the sun goes down). Close up, the sand has wind ripples, a line of washed-up seaweed, shells, starfish and pebbles, and two trails of footprints, a large one and a small one, leading down to the water. Near the beach the swell slows and bunches up as the water shoals (it travels at sqrt(g·depth)), steepens, breaks about where the depth is 1.3 times its height and rolls in as a foaming bore; the crests vary along the beach and come in sets. The swash runs up the sand as one sheet and drains back, leaving a mirror-like film of water that dries over a few seconds and a line of foam at the top of each run-up. Pick **Original** in the panel, or open with `?preset=original`, for the upstream open-ocean look; the **沙灘與景物** (beach) slider switches the cove on its own, and **離海距離** (`seaDist`, 3–40 m, default 6) sets how far up the sand you sit.

Sound starts with your first click, tap or key press (browsers block audio before that). It is synthesised live with Web Audio, so there are still no asset files: waves breaking on the beach timed to the swell period, the hiss of the backwash, wind that follows the wind slider, the odd seagull, and an optional ambient pad with soft bells. **Music → My music file** plays any local audio file on loop instead. `?sound=0` keeps the page silent.

### Photo textures

The sand, the shells, starfish and pebbles on it, the palm trees, the lighthouse, the ghost crabs and the mountains and coastline on the horizon come from AI-generated photos (made with ChatGPT/Gemini from prompts in this project). `tools/prepare_assets.py` makes the sand tileable, keys the green-screen palms, shells, lighthouse and horizon panoramas out, packs the shells into an atlas and writes `assets/*.webp` plus `js/assets.js`; `build.mjs` inlines them as data URLs, so `ocean.html` is still one file (about 1.7 MB now). The original source images are not in the repository.

### Nightfall and the breathing guide

**入夜程度** (`night`, 0–1) takes the scene from the sunset through dusk, when the stars come out and the lighthouse beam stands out, to a moonlit night; **自動入夜** lets it happen by itself over **入夜時間** minutes, and the **月光海灘** preset starts at night. **呼吸引導** (`breath=1`) shows a circle that grows for a 4 s in-breath and shrinks for a 6 s out-breath; the swell slows to a 10 s period so a wave rolls in with every in-breath and drains away with every out-breath, in the picture and in the sound.

### Phones and browsers without WebGPU

On phones the mesh is lighter and the render resolution starts at 75% with the pixel ratio capped at 2; on every device the resolution then adapts between 50% and 100% to hold the frame rate. The screen is kept awake while the page is open. Where WebGPU is not available the page shows a quiet sunset screen with a button that plays the soundscape on its own.

The camera keeps itself above the displaced water surface, so waves never pass through it.

URL parameters are handy for testing. `?w=2560&h=1440` forces the render resolution, `cam=x,y,z,yawDeg,pitchDeg` sets the camera, `fov=deg` sets the field of view, `ui=0` hides the HUD, and any settings key works too, for example `windSpeed=12&swellHs=2&sunElev=8`.

## How it works

### Waves

The sea is a Tessendorf FFT simulation with six cascades of 256 by 256 samples. The patches range from 1103 m down to 0.26 m, so wavelengths run from about a kilometre to a few millimetres. The smallest cascade produces the sharp sun sparkles near the camera.

The spectrum is a fetch-limited JONSWAP wind sea with Donelan-Banner directional spreading, plus a narrow long-crested swell. Dispersion includes the capillary term, and choppy horizontal displacement sharpens the crests. The inverse FFTs are radix-2 compute shaders working in workgroup memory.

The surface mesh is a CDLOD quadtree with 17 levels. Vertices are 6.25 cm apart near the camera and the mesh reaches 160 km, with continuous vertex morphing between levels.

### Shading

- Mip-mapped first and second moments of the wave slopes (LEAN mapping) give the right anisotropic roughness at every distance. The sun glitter widens with distance and the far sea settles into a sheen without aliasing. Screen-space slope derivatives add specular anti-aliasing.
- Sun glitter uses an anisotropic Gaussian slope distribution with Smith masking and the size of the solar disc.
- The sky reflection comes from an environment cube map rebuilt every frame, with roughness-filtered mips. At grazing angles the reflection direction is tilted to account for which wave facets the viewer can actually see.
- The water body is turbid blue-green, lit by the whole sky hemisphere. Backlit crests get a subsurface glow, and wind-gust patches modulate the short ripples.
- Whitecaps start where the total surface Jacobian folds. Foam is stored in two camera-centred world-space maps (128 m and 1 km wide), decays over time, drifts downwind, and breaks into streaks as it ages. A procedural bubble texture gives it its structure.

### Sky

The atmosphere follows Hillaire's approach, with transmittance, multiple-scattering, and sky-view lookup tables plus aerosol haze. There are two cloud layers, a broken low cumulus and a fibrous altostratus deck. Each is shaded with self-shadowing toward the sun, lit rims, silver linings when backlit, and direction-dependent multiple scattering.

Cloud noise octaves are filtered by pixel footprint, and silhouettes are anti-aliased analytically: the screen-space derivative of each layer's edge function sets the width of its opacity edge. Cloud transmittance along the sun direction dims the sunlight that reaches the water, and aerial perspective is applied over the sea.

### Post-processing

The scene renders in HDR with 4x MSAA. Post-processing adds an 8-level bloom, AgX tone mapping, a slight white balance shift, and dithering.

## Performance

At 2560 by 1440 on an RTX 5070 Ti, the GPU takes about 6 to 8 ms per frame, measured while other programs were also using the GPU. The HUD shows FPS and GPU time when the browser supports `timestamp-query`.

The per-frame code reuses preallocated typed arrays and descriptors, so the garbage collector has almost nothing to do. The only recurring allocations are the objects WebGPU itself requires, such as the swap-chain view and command buffers.

## Known limitations

- Far water is still somewhat darker than the bright horizon sky above it.
- The water is tuned toward turbid coastal water. The "Water turbidity" slider gives darker, bluer deep water when turned down.
- The scene is open ocean only. There is no shoreline, surf, or objects in the water.
- Clouds are two flat layers, not volumetric.

## How it was made

I built this with Claude Code (Opus 5.5). I asked for the most realistic water it could produce, in WebGPU, with a floating camera, and left the architecture and implementation to it. It checked its own work by rendering screenshots in headless Chrome and having separate critic subagents review them, so it was not grading its own output. I gave feedback along the way, mainly on the clouds, which led to replacing the volumetric clouds with the flat layers and later fixing their edge aliasing.

## Repository layout

| Path | Contents |
|---|---|
| `index.html` | Page shell, HUD, and settings panel styles |
| `js/main.js` | Device setup, resources, camera, per-frame loop |
| `js/wgsl/` | Shaders as JavaScript modules: `sim.js` (waves and foam), `sky.js` (atmosphere and clouds), `ocean.js` (surface and sky pass), `post.js` (bloom and tone mapping), `common.js` (shared structs) |
| `server.mjs` | Tiny static server for development |
| `build.mjs` | Builds `ocean.html` and `ocean.min.html` |
| `docs/` | README images |

## License

MIT. See [LICENSE](LICENSE).
