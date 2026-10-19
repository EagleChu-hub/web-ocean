
# CLAUDE.md - Web-Ocean 專案指令

This file provides guidance to Claude Code when working with this repository.

## 專案概述
- 來源: https://github.com/Noniv/web-ocean (703 stars, MIT)
- 核心: 單檔 61KB HTML, WebGPU, 無引擎, FFT 海洋模擬, 日落天空
- Demo: https://ocean-noniv.vercel.app/ , https://files.catbox.moe/17sdfi.html
- 原始 Prompt: "make the most realistic water scene possible in WebGPU with a floating camera" (Opus 5.5, 30min)

## 快速開始
```bash
# 1. 取得真實原始碼 (本包沙盒無外網，需在此執行)
node tools/fetch_real_source.mjs
# 輸出到 ./real_src/

# 2. 還原到可編輯版
cp -r real_src/* web-ocean-modular/
cd web-ocean-modular
npm install
npm start  # http://localhost:8080/

# 3. 修改後重新打包
npm run build  # 產生 ocean.html (102KB) + ocean.min.html (61KB)
```

## 檔案結構
- `index.html` - Page shell, HUD, settings panel styles
- `js/main.js` - Device setup, resources, camera, per-frame loop, 預分配 typed arrays 避免 GC
- `js/wgsl/common.js` - Uniforms, CASCADE 6x256, patch sizes 1103m..0.26m, LEAN mapping
- `js/wgsl/sim.js` - Tessendorf FFT, JONSWAP + Donelan-Banner, choppy displacement, Jacobian foam maps 128m+1km
- `js/wgsl/sky.js` - Hillaire atmosphere (transmittance, multi-scattering LUT, sky-view LUT), 2 cloud layers
- `js/wgsl/ocean.js` - CDLOD quadtree 17 levels (6.25cm near, 160km far), anisotropic glitter, cube map reflection
- `js/wgsl/post.js` - HDR 4x MSAA, 8-level bloom, AgX tone mapping, white balance, dither
- `build.mjs` - Builds ocean.html and ocean.min.html (strips WGSL comments + esbuild minify)
- `server.mjs` - Tiny static server

## 關鍵參數 (在 js/wgsl/* 和 URL 參數)
- URL: ?w=2560&h=1440&cam=x,y,z,yawDeg,pitchDeg&fov=deg&windSpeed=12&swellHs=2&sunElev=8&ui=0
- Controls: Click canvas 捕捉滑鼠, WASD, Space/E Q/C 上下, Shift 5x速, 滾輪改速, H 設定面板
- 可調: windSpeed, swellHs, choppiness, turbidity, foam, sunElev, haze, clouds, exposure, bloom
- 相機保持在 displaced water 上方，避免穿模

## 效能基準
- 2560x1440 RTX 5070 Ti: 6-8ms GPU time
- 已知限制: Far water darker than horizon, turbid coastal tuning, open ocean only, clouds flat layers

## 修訂任務
詳見 TASKS.md, 優先級:
1. 還原真實原始碼並確認可跑
2. 模組化重構: .wgsl 檔案 + wgsl-preprocessor
3. WebGL2 fallback + 手機降級 (3 cascades)
4. 功能: shoreline SDF, 船隻 (Havelock pressure field), volumetric clouds, 錄影
5. 台灣日落預設: sunElev 5, turbidity 0.4, windSpeed 6

## 開發規範
- 保持 single file 可用性: ocean.html 需 file:// 可開
- 壓縮後目標 61KB
- 使用 WGSL, 非 GLSL
- 避免外部 textures/models, procedural 為主
- 每個 PR 跑 npm run build 確認兩個檔案都產生

## 類似專案參考 (可抄)
- Aureliengmz/clearwater: shallow water + caustics
- JesusGalindez/threejs-ocean-simulator-skills: 含 5 個 agent skills 解釋參數
- WebTide / nff747/ocean-fft-wgsl: 最乾淨的 FFT 實作

## 測試
- Chrome 需 WebGPU, 筆電強制獨顯
- 檢查: ?debug 顯示 FPS, ?t=5 freeze time, ?view=caus 看 caustics
- 參考: https://toji.github.io/webgpu-test/ 檢測 WebGPU 支援
