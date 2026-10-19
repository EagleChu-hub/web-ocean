# CLAUDE.md

給 Claude Code 的專案說明。使用者偏好繁體中文溝通。

## 專案概述
- 這是 [Noniv/web-ocean](https://github.com/Noniv/web-ocean)（MIT）的延伸專案：從零寫成的 WebGPU 即時海洋渲染器，無引擎，FFT 波浪、白浪、太陽閃光、物理日落天空。
- 原作者著作權見 `LICENSE`，延伸修改需保留。
- `upstream` remote 指向原作，可用 `git fetch upstream` 追蹤原作更新。
- 另一個 AI 的交接檔放在 `docs/handover/`（原始版 CLAUDE 指令為 `CLAUDE.original.md`）。

## 常用指令
```bash
npm install
npm start        # http://localhost:8080/
npm run build    # 重新產生 ocean.html (~100 KB) 與 ocean.min.html (~61 KB)
```
修改 `js/` 下任何檔案後都要 `npm run build`，並確認兩個 bundle 都有產生、可從 `file://` 直接開。

## 檔案結構
- `index.html` — 頁面外殼、HUD、設定面板樣式
- `js/main.js` — 裝置初始化、資源、相機、每幀迴圈
- `js/audio.js` — Web Audio 合成音景（海浪、風、環境音樂、自選音樂檔），讀取 `P` 即時跟著參數變化
- `js/wgsl/common.js` — 共用 struct、常數、LEAN mapping
- `js/wgsl/sim.js` — FFT 波浪模擬與泡沫
- `js/wgsl/sky.js` — 大氣與雲
- `js/wgsl/ocean.js` — 海面與天空 pass
- `js/wgsl/post.js` — bloom 與 tone mapping
- `build.mjs` — 打包成單檔 ocean.html / ocean.min.html
- `server.mjs` — 小型靜態伺服器

操作方式、URL 參數、技術細節請以 `README.md` 為準。

## 修訂任務（來自交接檔 docs/handover/TASKS.md）
1. ~~還原真實原始碼並確認可跑~~ ✅ 已直接以原作為基底，build 可重現與原作相同的 bundle
2. 模組化重構：WGSL 改為 `.wgsl` 檔 + 預處理器管理共用 struct
3. 相容性：WebGL2 fallback、手機降級（3 cascades）、依 GPU time 動態解析度
4. 功能：海岸線 SDF、船隻、天氣、錄影輸出
   - ✅ 台灣日落預設（sunElev 5, turbidity 0.4, windSpeed 6），`main.js` 的 `PRESETS`，開頁預設載入
   - ✅ 背景音效／音樂（`js/audio.js`），M 鍵切換
5. 文件與部署（Vercel）

## 開發規範
- 維持單檔可用：`ocean.html` 必須能從 `file://` 直接開
- 壓縮版原為 61 KB，加入音效後約 66 KB；新增功能盡量精簡
- 雲端容器的 Chromium 可用 SwiftShader 跑 WebGPU（`--enable-unsafe-webgpu --use-webgpu-adapter=swiftshader`），能測 UI 與錯誤，但 `?shot=` 截圖讀回會 device lost（原作同樣），畫面需本機確認
- 使用 WGSL，不用 GLSL；以程序生成為主，避免外部貼圖與模型
- 需要 Chrome/Edge 的 WebGPU；雲端容器沒有 GPU，視覺驗證需在本機進行

## 交接檔的已知誤差
- `docs/handover/HANDOVER.md` 寫的作者名稱與 `LICENSE` 不符，以 `LICENSE` 為準。
- 交接包內的 `web-ocean-modular/` 只有空的 placeholder shader，已由原作真實原始碼取代，未收進本 repo。
