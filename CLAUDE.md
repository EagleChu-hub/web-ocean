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
npm run build    # 重新產生 ocean.html 與 ocean.min.html（含內嵌照片材質，各約 1.3 MB）
```
修改 `js/` 下任何檔案後都要 `npm run build`，並確認兩個 bundle 都有產生、可從 `file://` 直接開。

## 檔案結構
- `index.html` — 頁面外殼、HUD、設定面板樣式
- `js/main.js` — 裝置初始化、資源、相機、每幀迴圈
- `js/audio.js` — Web Audio 合成音景（拍岸浪、退潮沙沙聲、風、海鷗、環境音樂、自選音樂檔），讀取 `P` 即時跟著參數變化
- `js/wgsl/land.js` — 沙灘地形 `terrainH`/`shoreZ`（海面、相機高度探測、地形共用）、沙灘細節（沙紋、海草線、貝殼、海星、卵石、一大一小腳印）、岬角、椰子樹（照片 billboard，面向鏡頭、依位置翻轉朝中間傾斜、alpha-to-coverage）、燈塔（旋轉光束用加法混合，畫在天空之後）、小螃蟹、海鷗
- `js/wgsl/common.js` — 共用 struct、常數、LEAN mapping
- `js/wgsl/sim.js` — FFT 波浪模擬與泡沫
- `js/wgsl/sky.js` — 大氣與雲
- `js/wgsl/ocean.js` — 海面與天空 pass
- `js/wgsl/post.js` — bloom 與 tone mapping
- `js/assets.js` — 照片材質的路徑與量測資料（由 `tools/prepare_assets.py` 產生，勿手改）
- `assets/*.webp` — 照片材質：沙（乾/濕）、貝殼圖集、4 棵椰子樹（使用者用 GPT/Gemini 生成，綠幕去背）
- `tools/prepare_assets.py` — 處理原圖：沙做無縫、綠幕去背、貝殼切圖打包、椰子樹對齊樹根。原圖不進 repo，要換圖就重跑此腳本
- `build.mjs` — 打包成單檔 ocean.html / ocean.min.html（把 assets/*.webp 內嵌成 data URL）
- `server.mjs` — 小型靜態伺服器

操作方式、URL 參數、技術細節請以 `README.md` 為準。

## 修訂任務（來自交接檔 docs/handover/TASKS.md）
1. ~~還原真實原始碼並確認可跑~~ ✅ 已直接以原作為基底，build 可重現與原作相同的 bundle
2. 模組化重構：WGSL 改為 `.wgsl` 檔 + 預處理器管理共用 struct
3. 相容性：WebGL2 fallback、手機降級（3 cascades）、依 GPU time 動態解析度
4. 功能：海岸線 SDF、船隻、天氣、錄影輸出
   - ✅ 台灣日落預設（sunElev 5, turbidity 0.4, windSpeed 6），`main.js` 的 `PRESETS`，開頁預設載入
   - ✅ 背景音效／音樂（`js/audio.js`），M 鍵切換
   - ✅ 沙灘海灣、岬角、椰子樹、貝殼海星、腳印、燈塔、小螃蟹、海鷗（`P.beach`），淺水區浪變小、沖刷、碎浪線
   - 外部模型評估過（OpenGameArt/Quaternius 的 CC0 棕櫚樹為 .blend/.fbx，且容器連不到那些網站），為維持單檔與程序生成，改用自寫 WGSL
   - ✅ 手機：觸控看四周、🔊⚙ 按鈕、較輕網格、動態解析度、螢幕常亮；無 WebGPU 時只播聲音
5. 文件與部署（Vercel）

## 開發規範
- 維持單檔可用：`ocean.html` 必須能從 `file://` 直接開
- 壓縮版原為 61 KB；程式部分約 92 KB，另含約 1.2 MB 照片材質（使用者選擇以真實感優先）。新增功能盡量精簡
- 雲端容器可以截到 WebGPU 畫面，但要用 headed Chromium + xvfb：`xvfb-run -a` 搭配 `headless: false` 與 `--enable-unsafe-webgpu --use-webgpu-adapter=swiftshader --no-sandbox --disable-gpu-sandbox --enable-features=Vulkan --use-vulkan=swiftshader --disable-gpu-watchdog`，在 `GPUQueue.submit` 後立刻 `canvas.toDataURL()`。很慢（640x360 約 4 分鐘出圖）。太陽高時截圖會偏白過曝，用 `sunElev=1.5&exposure=0.6` 顏色較接近真實，且軟體渲染的顏色、亮度不一定等於真實 GPU，最後仍需本機確認。headless 模式下裝置會立刻 lost
- 使用 WGSL，不用 GLSL；以程序生成為主。照片材質只用於程序做不像的東西（沙、貝殼、椰子樹），一律放 assets/ 並經 prepare_assets.py 處理
- 需要 Chrome/Edge 的 WebGPU；雲端容器沒有 GPU，視覺驗證需在本機進行

## 交接檔的已知誤差
- `docs/handover/HANDOVER.md` 寫的作者名稱與 `LICENSE` 不符，以 `LICENSE` 為準。
- 交接包內的 `web-ocean-modular/` 只有空的 placeholder shader，已由原作真實原始碼取代，未收進本 repo。
