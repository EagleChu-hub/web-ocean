
# Web-Ocean 專案交接檔 - 給 Claude Code

## 對話脈絡
- User 在台北，分享 Threads 連結 https://www.threads.com/share/BAi8iTxtgG/ (來源 @freeourdays 轉貼 Noniv/web-ocean)
- 任務1: 擷取提示詞 + 找類似既有專案
- 任務2: 把 ocean.min.html 61KB 單檔拆解成可編輯模組版
- 任務3: 產生完整交接檔 + shader 原始碼，交給 Claude Code 修訂

## 原始專案
- Repo: https://github.com/Noniv/web-ocean
- Stars: 703 (截至 2026-10-18), MIT License
- 作者: Mo Elgharaikhy / Noniv
- 特性: Real-time WebGPU ocean renderer written from scratch, no engine. FFT waves, whitecaps, sun glitter, physically based sunset sky with clouds, free camera. Built with Claude Code (Opus 5.5). Opens from a single 61 KB HTML file in Chrome.
- Demo: https://ocean-noniv.vercel.app/ , https://files.catbox.moe/17sdfi.html
- Build: ocean.html 102KB, ocean.min.html 61KB, file:// 可直接開

## 已完成工作
1. 已建立 /mnt/data/web-ocean-modular 模組化結構 (index.html + js/main.js + js/wgsl/*.js + build.mjs + server.mjs)
2. 已建立互動拆解瀏覽器 artifact: container:///mnt/data/ocean_modular_explorer_agentic_artifact_1_4512cbabb704.html
3. 已整理類似專案: Aureliengmz/clearwater, JesusGalindez/threejs-ocean-simulator-skills, Popov72/OceanDemo, WebTide, nff747/ocean-fft-wgsl

## 交接給 Claude Code 的目標
- 取得真實 shader 原始碼 (本機沙盒無外網，無法直接 fetch raw.githubusercontent，需由 Claude Code 在本機執行 fetch)
- 將 placeholder WGSL 替換為可編譯的真實 WGSL
- 根據需求修訂: 例如加入海岸線、船隻、效能優化、手機 WebGPU fallback、參數 UI

## 快速開始 (給 Claude Code 執行)
```bash
git clone https://github.com/Noniv/web-ocean.git
cd web-ocean
npm install
npm start  # http://localhost:8080/

# 或使用本交接包的自動抓取腳本
node tools/fetch_real_source.mjs
```

## 注意
- WebGPU 僅 Chrome/Edge 113+ 支援，筆電需強制獨顯
- 控制: Click canvas 捕捉滑鼠, WASD 移動, Space/E Q/C 上下, Shift 5x速, 滾輪改速, H 設定面板
- URL 參數: ?w=2560&h=1440&cam=x,y,z,yawDeg,pitchDeg&fov=deg&windSpeed=12&swellHs=2&sunElev=8
