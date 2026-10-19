
# 架構拆解 - ocean.min.html -> 模組版

## Repository layout (官方)
| Path | Contents |
|------|----------|
| index.html | Page shell, HUD, and settings panel styles |
| js/main.js | Device setup, resources, camera, per-frame loop |
| js/wgsl/common.js | shared structs |
| js/wgsl/sim.js | waves and foam |
| js/wgsl/sky.js | atmosphere and clouds |
| js/wgsl/ocean.js | surface and sky pass |
| js/wgsl/post.js | bloom and tone mapping |
| server.mjs | Tiny static server |
| build.mjs | Builds ocean.html and ocean.min.html |

## Build 流程
1. index.html 載入 js/main.js (ES module)
2. main.js import 5 個 wgsl 模組 (其實是 JS 字串)
3. build.mjs 把全部 inline 成 ocean.html (102KB)
4. esbuild minify + 去除 WGSL 註解/空白 -> ocean.min.html (61KB)

## 各模組職責 (根據 README)

### js/main.js
- requestAdapter, requestDevice
- canvas context configure
- 預分配 typed arrays, descriptors，避免 GC
- 相機: 位置保持在 displaced water 上方
- Per-frame: sim -> sky cubemap -> ocean surface -> post
- HUD: FPS + GPU time (timestamp-query)

### js/wgsl/common.js
- Uniforms: time, windSpeed, swellHs, sunElev, choppiness, turbidity
- Constants: CASCADE_COUNT=6, SIZE=256
- Patch sizes: 1103, 368, 122, 40, 5, 0.26 (m)
- LEAN mapping helpers

### js/wgsl/sim.js
- 6 cascades FFT, radix-2 compute shaders, workgroup memory
- JONSWAP + Donelan-Banner + swell
- Jacobian -> foam maps
- Wind gust patches modulate short ripples

### js/wgsl/sky.js
- Hillaire 3 LUTs
- Cloud noise octaves filtered by pixel footprint
- Analytic edge AA

### js/wgsl/ocean.js
- CDLOD quadtree
- Anisotropic glitter, reflection tilt at grazing
- Water body shading

### js/wgsl/post.js
- 8-level bloom
- AgX, white balance, dither

## 效能
- 2560x1440 RTX 5070 Ti: 6-8ms GPU time
- GC 幾乎零分配 (除了 WebGPU swap-chain view)

## 已知限制
- Far water darker than horizon
- Turbid coastal water tuning (turbidity slider可調深藍)
- Open ocean only, no shoreline
- Clouds 2 flat layers, not volumetric
