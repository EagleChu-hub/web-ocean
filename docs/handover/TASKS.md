
# 給 Claude Code 的修訂任務清單

## 目標
把 61KB 單檔版變成可維護、可擴充的產品級專案

## Task 1: 還原真實原始碼
- 執行 node tools/fetch_real_source.mjs
- 把 real_src/* 覆蓋到 js/wgsl/*.js
- 確認 npm start 可跑，Chrome WebGPU 無錯誤

## Task 2: 模組化重構
- 把 WGSL 字串改為真 .wgsl 檔案 + import via `?raw` 或 fetch
- 使用 wesl 或 wgsl-preprocessor 管理共用 struct
- build.mjs 改為 vite 或 esbuild plugin

## Task 3: 效能與相容性
- 加入 WebGL2 fallback (參考 abyssal-ocean/webgpu 自動 fallback)
- 手機檢測: iOS 無 WebGPU 時降級為 Gerstner waves
- 動態解析度: 根據 GPU time 自動調 50%-100%

## Task 4: 功能擴充 (選)
- [ ] 海岸線: SDF beach + depth-based color
- [ ] 船隻: procedural yacht (參考 yate-procedural skill)
- [ ] 天氣: rain, storm, moonlit night
- [ ] 錄影: 匯出 32秒影片 (原本 Threads 影片)
- [ ] 參數預設: 台灣日落 (sunElev 5, turbidity 0.4, windSpeed 6)

## Task 5: 文件
- 產生 ARCHITECTURE.md 圖表
- 錄製 demo 影片
- 發布到 Vercel: ocean-noniv.vercel.app 類似部署

## 驗收標準
- [ ] ocean.html 102KB, ocean.min.html 61KB 仍可產生
- [ ] 可在 Chrome 開 file:// 跑
- [ ] H 面板所有參數可調
- [ ] FPS HUD 顯示
