
# Shader 原始碼說明 (真實原始碼需 git clone 取得)

由於本沙盒無外網，無法直接 fetch raw.githubusercontent.com，以下是根據 README 和類似專案整理的真實結構，Claude Code 請執行 tools/fetch_real_source.mjs 取得完整 WGSL。

## 取得方式 (給 Claude Code)
```bash
node tools/fetch_real_source.mjs
# 會從 https://raw.githubusercontent.com/Noniv/web-ocean/main/js/... 抓取
# 輸出到 ./real_src/
```

## 各 WGSL 模組預期內容

### common.js 應包含
```wgsl
struct Camera { pos: vec3f, yaw: f32, pitch: f32, ... }
struct Sun { dir: vec3f, color: vec3f, intensity: f32 }
struct Uniforms { time, windSpeed, swellHs, choppiness, turbidity, sunElev, ... }
const CASCADE_COUNT: u32 = 6u;
const CASCADE_SIZES: array<f32, 6> = array(1103.0, 368.0, 122.0, 40.0, 5.0, 0.26);
fn leanMapping(slope: vec2f) -> ...
fn smithMasking(...)
```

### sim.js 應包含
- Phillips spectrum / JONSWAP
- H0 texture packing
- FFT: bit-reversal, butterfly
- Horizontal displacement (choppy)
- Jacobian calculation
- Foam map update compute shader

### sky.js 應包含
- Transmittance LUT generation
- Multi-scattering LUT
- Sky-view LUT
- Cloud SDF + noise (fbm)
- Silver lining + self-shadowing

### ocean.js 應包含
- CDLOD vertex generation
- Height sampling from FFT textures
- Fresnel exact, LEAN roughness
- Sun glitter: anisotropic Gaussian with solar disc
- Cube map reflection

### post.js 應包含
- Downsample pyramid for bloom
- AgX: https://iolite-engine.com/blog_posts/minimal_agx_implementation
- Tone mapping + dither (blue noise)

## 參考實作 (類似專案可抄)
- clearwater: WebGL2 shallow water + caustics (Evan Wallace refracted-grid)
- threejs-ocean-simulator-skills: 有 agent skills 解釋每個參數的經驗值
- WebTide: GPU-based FFT + Phillips spectrum, BabylonJS 版最乾淨
- ocean-fft-wgsl npm: OceanSimulator class, gridSize 256, patchLength 250, windSpeed 14

## 建議修訂方向
1. 加入 shoreline SDF + surf foam
2. Volumetric clouds 替換 flat layers (用 raymarching)
3. 手機版: 降級為 3 cascades + WebGL2 fallback
4. 船隻浮力: Havelock pressure field (參考 threejs-ocean-simulator)
