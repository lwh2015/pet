# 桌宠 Plan 2 — Live2D 渲染与动作系统 设计文档

- 日期：2026-06-13
- 状态：已确认，待编写实现计划
- 前置：Plan 1（Foundation & Desktop Shell）已完成并合入流程中（PR #1）
- 技术栈：在现有 electron-vite + React + TypeScript 之上引入 pixi.js v7 + pixi-live2d-display-advanced + Cubism Core

## 1. 目标与范围

把 Plan 1 的占位宠物替换成一个会动、会反应的 **Live2D 形象**：

- 渲染一个官方免费示例 Live2D 模型（可热换），铺满透明的宠物窗。
- **ActionController**：语义动作标签（idle / greet / talk / think / happy / react / receive）→ motion + expression。
- **光标跟随**（眼睛/头）、**随机 idle 微动作**、**点击/轻拍触发反应**、**文件拖入触发 `receive` 反应**（纯视觉，不入库）。
- 用 **Alpha 轮廓命中**替换 Plan 1 基于 DOM 元素的穿透命中测试。

### 明确不做（YAGNI / 留到后续）

- **lipsync 口型**：无音频，推到 Plan 4（TTS）。
- **模型市场 / 切换 UI**：Plan 2 只接一个模型（路径走配置即可热换）。
- **文件入库/存储**：Plan 2 只播 `receive` 动画；真正的复制进 vault + SQLite 元数据是 **Plan 3**，届时复用 `playAction('receive')`。
- 主进程窗口/穿透/拖动/IPC 契约**基本不动**（见 §6）。

## 2. 技术栈与资源

- **pixi.js v7** + **pixi-live2d-display-advanced**（支持 Cubism 2.1 / 3 / 4；与 pixi v7 配套，避开 v8 fork 的不稳定）。
- **Cubism Core 运行时** `live2dcubismcore.min.js`：作为本地静态脚本，由宠物入口 `src/renderer/index.html` 用 `<script src>` 引入（它在 `window.Live2DCubismCore` 挂全局，pixi-live2d-display-advanced 依赖它）。本地脚本符合现有 CSP `script-src 'self'`。
- **严格 CSP 必须配 `@pixi/unsafe-eval`**（实现时踩到的坑，已修复）：pixi v7 渲染器用 `new Function()` 生成着色器，在 `script-src 'self'`（无 `'unsafe-eval'`）下会抛 "Current environment does not allow unsafe-eval"，导致 `Live2DModel.from` 失败、回退到占位形象。解决：装 `@pixi/unsafe-eval`（版本对齐 `pixi.js`），在创建任何 `PIXI.Application` 之前 `import '@pixi/unsafe-eval'`（7.1.0 起 import 即自安装，无需调用已废弃的 `install()`）以改写 eval 路径——既能渲染又保持严格 CSP，不放开 `unsafe-eval`。
- 模型资源放 `resources/live2d/<model>/`（`electron-builder.yml` 的 `asarUnpack: resources/**` 已覆盖；如需进 `extraResources` 再补）。**模型路径与名称走配置常量**，换模型不改组件代码。
- 版本以实现阶段的研究为准（pixi v7.x、pixi-live2d-display-advanced 最新、Cubism Core 官方）。

## 3. 渲染层组件结构

全部在 `src/renderer/src/pet/` 内（主进程不参与渲染）：

- `Live2DStage.tsx`（glue）：创建透明 `PIXI.Application`（`backgroundAlpha: 0`），等待 Cubism Core 就绪，加载并挂载模型，启动 ticker；暴露 `app`/`model`/`canvas` 句柄。`html/body/#root` 全透明。
- `useLive2DModel.ts`（hook）：模型加载/释放生命周期，加载失败回退到占位 + 控制台报错（不崩溃）。
- `ActionController.ts`：`playAction(tag)` → 映射到 motion 组 + expression，带优先级（高优先动作不被 idle 打断）；含 idle 循环与 cursor-follow 每帧更新器。
- `usePassthrough.ts`（**改造现有文件**）：命中测试由"DOM e.target"换为"**采样画布 alpha**"；对 main 的 `setInteractive(bool)` 契约、enter 立即/leave 防抖、锁定模式挂起、拖拽中挂起等逻辑全部保留。
- `PetApp.tsx`（**改造现有文件**）：组合 `Live2DStage` + `usePassthrough` + 拖拽/轻拍 + 文件拖入；`PlaceholderPet.tsx` 退场（删除或保留为加载失败回退）。

### 可单测的纯逻辑（抽出，TDD）

- 动作映射：`actionTag → { motionGroup, motionIndex?, expression? }`（含 `talk/think` 注册占位）。
- idle 调度：给定上次动作时间/随机源 → 下一个 idle 动作与延时（注入随机源，确定性可测）。
- 光标→参数映射：光标相对模型中心的偏移 → 角度/眼球参数（数学纯函数）。
- **client→GL 像素坐标换算**：`(clientX, clientY, rect, devicePixelRatio, canvasHeight)` → GL 读取坐标（含 **Y 翻转**），命中阈值判定。

## 4. Alpha 轮廓命中（核心集成点）

- 宠物窗全透明、Live2D 画布铺满。判定"光标是否在宠物身上"：mousemove（节流 ~30–60ms）时 `gl.readPixels(gx, gy, 1, 1)` 读光标处单像素 alpha，`alpha > 阈值`（如 10/255）即"在身上"。
- 坐标换算需处理 `devicePixelRatio` 与 GL 左下原点的 **Y 翻转**（纯函数，见 §3）。1 像素 readPixels 在节流频率下开销可接受；隐藏时停采样。
- **拖拽与轻拍统一门控在 alpha 命中**：
  - 在模型不透明区按下 → 移动超过阈值 = 拖动（沿用 Plan 1 的 `petApi.drag.*`）；原地松开 = 轻拍 → `playAction('react'|'happy')`。
  - 空白（透明）区按下 → 穿透到桌面（Plan 1 行为不变）。
- `usePassthrough` 的 `isOverInteractive` 从 DOM 判定改为 alpha 采样，其余对接 main 的逻辑不变。

## 5. ActionController：标签 → 表现 + 触发源

- 标签集：`idle / greet / talk / think / happy / react / receive`。`talk/think` 为 Plan 4 AI 预留（注册映射但 Plan 2 不触发）。
- 每个标签映射到模型的 motion 组（+ 可选 expression），带优先级：idle < 普通动作 < 反应。播放中的高优先动作不被 idle 打断。
- **Plan 2 触发源（本地事件；AI 驱动留到 Plan 4）**：
  - 应用/模型就绪 → `greet`。
  - 轻拍宠物 → `react` 或 `happy`。
  - idle 定时器 → 随机 `idle` 微动作（眨眼/卖萌/轻晃）。
  - **文件拖入宠物 → `receive`**（纯视觉反馈）。
- **光标跟随**：每帧把头/眼角度参数按光标偏移设置；空闲时叠加，播放高优先 motion 时让位避免打架。

## 6. 与 Plan 1 的衔接 / 改动面

- 改动集中在 `src/renderer/src/pet/`：新增 Live2D 组件与 ActionController，改造 `usePassthrough`/`PetApp`，移除/降级 `PlaceholderPet`。
- **主进程不动**：透明窗、置顶、穿透控制、拖动、托盘、IPC 契约（`setInteractive`/`drag.*`/settings 广播）全部沿用。
- **文件拖入**：Plan 2 在渲染层用 HTML5 drag-drop 检测被拖入的文件（拿到路径即可），仅触发 `receive` 动画；**不新增主进程逻辑、不存储**。真正的入库在 Plan 3 接入并复用 `playAction('receive')`（必要时 Plan 3 再加 `pet:file-dropped` 一类 IPC，Plan 2 不引入）。
- 构建：`electron.vite.config.ts` 可能需让渲染层把 `live2dcubismcore.min.js`/模型当静态资源处理；保持单一 `client` 共享 chunk（Plan 1 已移除 isolatedEntries）。

## 7. 性能与健壮性

- 宠物隐藏（托盘 Hide）时暂停 ticker / idle / 渲染 / 命中采样，显示时恢复。
- 节流 `readPixels`；可对 ticker 限帧（如 60fps 上限）。
- Cubism Core 或模型加载失败 → 回退到占位元素 + `console.error`，应用不崩；穿透/托盘仍可用（始终可经托盘恢复/退出）。
- idle 频率设下限，避免动作刷屏。

## 8. 测试策略

- **单元（vitest，纯函数）**：动作映射、idle 随机调度、光标→参数映射、client→GL 坐标换算与命中阈值。
- **glue / 人工验收**：pixi 启动、模型渲染显形、光标跟随、命中（点身上可交互、空白穿透）、轻拍反应、文件拖入 `receive`、隐藏暂停。沿用 Plan 1 的人工验收清单形式新增 Plan 2 段。

## 9. 待解决 / 分发阶段事项

- 官方示例 Live2D 模型的分发许可确认（开发可用；正式分发需复核 sample license 或换可商用模型）。
- Cubism Core 运行时的引入与许可（官方免费，随包分发的合规性）。
- 大资源（模型贴图/motion）打包与 asar 解包路径（dev vs packaged）。

## 10. MVP 范围与后续路线（在总路线中的位置）

- 本计划 = **Plan 2 of 4**。完成后宠物"活"起来：有形象、会跟随、会反应、能被喂（视觉）。
- **Plan 3**：better-sqlite3 + vault 文件入库（拖入真正存储 + 面板文件库），复用 `receive` 动作。
- **Plan 4**：mock→真 AI 对话 + 流式 + 动作联动（AI 发 `actionTag` 驱动 ActionController，`talk/think` 启用）+ 历史持久化。
