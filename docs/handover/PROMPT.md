
# 原始提示詞擷取

## 一句話原始版
> make the most realistic water scene possible in WebGPU with a floating camera

來源: VibingTalk 論壇作者自述: "I made a real-time ocean sim with Claude Code (Opus 5.5) What it does: a single 61 KB HTML file that shows a sunset ocean in your browser using WebGPU. Features an FFT wave simulation, whitecaps, a realistic sky with clouds, and sun glitter."

## 完整版 (作者在 README)
> I built this with Claude Code (Opus 5.5). I asked for the most realistic water it could produce, in WebGPU, with a floating camera, and left the architecture and implementation to it. It checked its own work by rendering screenshots in headless Chrome and having separate critic subagents review them, so it was not grading its own output.

## 可複用 Prompt Template (給 Claude Code)
```
Build a real-time ocean renderer written from scratch on WebGPU, with no engine or rendering library.
- Single HTML file, target 61KB minified
- Tessendorf FFT ocean, 6 cascades 256x256, patch sizes 1103m down to 0.26m
- Spectrum: fetch-limited JONSWAP wind sea + Donelan-Banner directional spreading + narrow long-crested swell, capillary dispersion, choppy displacement
- Mesh: CDLOD quadtree 17 levels, vertices 6.25cm near camera, 160km far, continuous morphing
- Shading: LEAN mapping for slope moments, anisotropic Gaussian sun glitter with Smith masking + solar disc size, environment cube map reflection rebuilt every frame, turbid blue-green body, subsurface glow, wind-gust ripples
- Foam: Jacobian fold detection, two camera-centred world-space maps (128m + 1km), decay + downwind drift + streaks, procedural bubble texture
- Sky: Hillaire atmosphere (transmittance, multi-scattering, sky-view LUT + aerosol haze), 2 cloud layers (broken low cumulus + fibrous altostratus) with self-shadowing, silver linings, multiple scattering, edge AA via screen-space derivatives
- Post: HDR 4x MSAA, 8-level bloom, AgX tone mapping, white balance shift, dithering
- Camera: free floating, stays above displaced water, WASD + mouse, H settings panel
- Build: single file, no external assets, minified version strips WGSL comments + whitespace, JS minified with esbuild
- Workflow: render screenshots in headless Chrome, separate critic subagents review for visual defects
```

## 關鍵技巧
- 讓 AI 自評缺陷: 截圖 + critic subagent，避免自我評分盲點
- 雲的迭代: 作者提到主要 feedback 在雲，從 volumetric 改為 flat layers 再修 edge aliasing
