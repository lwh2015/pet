# PixiJS 抛光铬「Z」桌宠形象 — 设计文档

- 日期：2026-06-16
- 状态：已确认，待编写实现计划
- 技术栈：Electron + React 19 + TypeScript（electron-vite），新增 `pixi.js` v8
- 取代：原 `docs/art/dragonbones-pet-art-spec.md`（DragonBones 外包美术路线）在本期的"宠物形象"职责；该文档暂作参考保留，不在本期改动。

## 1. 目标与范围

把当前的占位宠物（`PlaceholderPet.tsx`，CSS/SVG 蓝色圆脸）替换为一只 **PixiJS 纯代码绘制**的桌宠形象：

- 形象原型为**字母 Z**，做成一只有耳朵/短手/尾巴的 Q 版小动物（下称 **Z 小动物**）。
- **抛光铬 / 不锈钢**金属质感（渐变 + 高光，纯代码，无美术素材）。
- 一双"白眼底 + 可移动瞳孔"的眼睛，瞳孔**全屏跟随鼠标光标**。
- 首版动效：①瞳孔跟随、②待机呼吸 + 金属流光、③随机眨眼、④耳朵/尾巴摆动 + 点击挤压回弹。

**不在本期范围**：像素级精确剪影命中测试（沿用现有包围盒判定）；聊天/AI/文件等其他 MVP 模块；DragonBones/Live2D 运行时；表情状态机（馋/满足等换件）。

## 2. 已锁定的决策

| 项 | 决策 |
|---|---|
| 渲染引擎 | PixiJS v8（`pixi.js`），不使用 `@pixi/react` |
| 形象形态 | C 方案：Z 当身体 + 耳朵 + 短手 + 尾巴 + 眼睛 + 嘴 |
| 配色/材质 | 抛光铬 / 不锈钢（纵向渐变 + 顶部高光线 + 眼睛反光点） |
| 光标跟随范围 | 全屏跟随（主进程读全局光标 → IPC 推送渲染层） |
| 首版动效 | 瞳孔跟随 / 待机呼吸+流光 / 随机眨眼 / 耳尾摆+点击挤压 全做 |
| 命中/穿透 | 复用现有 DOM 包围盒判定，主进程穿透控制器零改动 |

## 3. 形象规格（代码绘制）

矢量几何，参照视觉确认稿（viewBox 200×200 的等价比例）：

- **body（Z 笔画）**：一条粗圆 stroke，路径 `上横 → 对角 → 下横`，圆角线帽/连接；填充用铬渐变 stroke，叠一条顶部高光线。
- **tail**：body 右下的一小段卷曲 stroke（暗钢色）。
- **ear_l / ear_r**：上横上方两只小三角（铬渐变 + 浅描边）。
- **arm_l / arm_r**：body 两侧的短 stroke。
- **face**（贴在上横的容器，可整体朝光标极轻微倾斜）：
  - **eye_white_l / eye_white_r**：白眼底（固定在 face 上）。
  - **pupil_l / pupil_r**：瞳孔，在对应白眼半径内移动，带一个小白色反光点。
  - **mouth**：一段微笑 stroke。

### 金属（铬）渲染

- 用 PixiJS v8 `FillGradient` 做纵向渐变：亮顶 → 中段高光带（接近纯白）→ 暗腹（深灰）。具体 API 以安装版本为准（实现细节留给计划/实现阶段）。
- 叠加顶部高光线（半透明白 stroke）+ 眼睛反光点，强化"反光"。
- 呼吸时让中段高光带的偏移缓慢滑动，制造"流光"。

## 4. 架构与文件

新增渲染模块目录 `src/renderer/src/pet/pixi/`：

- `buildScene.ts` —— 构建场景图，返回各部件节点引用 + 初始布局；不含 React、不含 ticker。
- `metal.ts` —— 铬渐变 / 高光辅助（构建 `FillGradient`、高光带偏移计算）。
- `petController.ts` —— 持有 `Application`，注册 ticker；每帧根据状态应用动画（呼吸、眨眼、摆动、瞳孔跟随、挤压）。暴露 `setCursor(localX, localY)`、`triggerSquash()`、`pause()/resume()`、`destroy()`。
- `eyeMath.ts` —— **纯函数**：给定光标向量与眼眶半径，算出夹取在眼内的瞳孔偏移（可单测）。
- `ChromeZPet.tsx` —— React 组件：`useEffect` 中 `await app.init()`、挂载 canvas 到 `.pet-body`、订阅 `window.petApi.onCursorMove`、把宠物点击/拖起接到 `triggerSquash`、卸载时 `destroy()`。

改动：

- `src/renderer/src/pet/PetApp.tsx`：`<PlaceholderPet/>` → `<ChromeZPet/>`。
- `PlaceholderPet.tsx`：保留作为降级回退（`ChromeZPet` 初始化失败时回退渲染）。

### 场景图层级

```
root
└─ body
   ├─ tail
   ├─ ear_l / ear_r
   ├─ arm_l / arm_r
   └─ face
      ├─ eye_white_l / eye_white_r
      ├─ pupil_l / pupil_r
      └─ mouth
```

### 画布配置

- `Application.init({ backgroundAlpha: 0, antialias: true, resolution: window.devicePixelRatio, autoDensity: true })`。
- 画布尺寸取宠物包围盒（约 180×190，含呼吸/挤压余量），居中于 `.pet-body`。

## 5. 全屏光标跟随（主进程改动）

新增 `src/main/cursorTracker.ts`：

- `createCursorTracker(getPetWindow, send)`：`setInterval`（约 60fps）读 `screen.getCursorScreenPoint()`，减去 `petWin.getBounds()` 的 `{x,y}` 得到**窗口内局部坐标**，调用 `send(localPoint)`。
- 窗口隐藏/销毁/不可见时暂停轮询；显示时恢复（省 CPU）。坐标换算抽成纯函数以便单测（注入 `getBounds`、`getCursorScreenPoint`）。

IPC / API 增量：

- `src/shared/ipc.ts`：`IPC` 增加 `PET_CURSOR_MOVE: 'pet:cursor-move'`；`RendererApi` 增加 `onCursorMove(cb: (p: {x:number;y:number}) => void): Unsubscribe`。
- `src/preload/index.ts`：`buildPetApi` 增加 `onCursorMove`（`ipc.on(IPC.PET_CURSOR_MOVE, …)`，返回取消订阅）。
- 主进程 bootstrap：创建 `cursorTracker`，`send = (p) => petWin.webContents.send(IPC.PET_CURSOR_MOVE, p)`；随窗口显示/隐藏启停；退出时清理 interval。

渲染层映射：`ChromeZPet` 用 `canvas.getBoundingClientRect()` 得到脸中心在窗口内的坐标，瞳孔朝向 = 局部光标 − 脸中心；DPI 下 DIP≈CSS px，无需额外换算。

## 6. 动效（ticker 驱动）

| 动效 | 实现 |
|---|---|
| 瞳孔跟随 | `eyeMath` 夹取偏移；face 容器附带极轻微朝向倾斜 |
| 待机呼吸 + 流光 | body 正弦缩放 ±~2%；高光带偏移随同一相位滑动 |
| 随机眨眼 | 随机 3–7s 触发，眼组 scaleY 瞬时压扁 ~120ms 回弹 |
| 耳/尾摆 | 耳、尾错相位正弦微旋 |
| 点击挤压 | mousedown（命中宠物）触发 squash-stretch：scaleX↑/scaleY↓ 后缓动回弹 |

## 7. 命中 / 穿透 / 拖动（复用现状）

- PixiJS canvas 挂进 `.pet-body`（`pointer-events:auto`）。`usePassthrough` 的 DOM 包围盒命中测试**零改动**（与今天 SVG 行为一致：包围盒内即"在宠物上"）。
- 主进程 `passthrough.ts` 控制器**零改动**。
- 拖动：mousedown 仍从 `.pet-body` 冒泡到 `.pet-root` 的 `onMouseDown`，逻辑不动；额外在该 mousedown 上调用 `triggerSquash()`。

## 8. 错误处理 / 生命周期

- `app.init()` 失败 → 记录日志，渲染层回退到 `PlaceholderPet`（不崩溃、仍可拖动）。
- `ChromeZPet` 卸载：销毁 ticker + `Application`，移除 `onCursorMove` 订阅（HMR 安全，避免 WebGL 上下文泄漏）。
- 窗口隐藏时暂停 ticker 与光标轮询；显示时恢复。`backgroundThrottling:false` 已具备。

## 9. 测试（沿用"纯逻辑脱离 Electron/WebGL"）

- vitest 纯函数：
  - `eyeMath`：给定光标向量/眼眶半径 → 夹取后的瞳孔偏移（含越界夹取、零向量）。
  - cursorTracker 坐标换算：全局光标 + 窗口 bounds → 窗口局部坐标（注入桩）。
  - 眨眼/摆动若抽成纯计时 reducer 亦可测。
- WebGL 渲染不单测；逻辑尽量收进纯函数，渲染层保持薄。
- 现有穿透/拖动测试不受影响（机制未改）。

## 10. 依赖

- 新增 `pixi.js`（^8）至 `dependencies`。无其他新依赖（不引入 `@pixi/react`）。
- Electron 渲染层为 Chromium，WebGL 可用。

## 11. 待解决 / 后续

- 像素级精确剪影命中测试（更贴合 Z 形轮廓）——后续增强。
- 表情/状态换件（馋、满足、打招呼等）与 AI 动作联动（对应原设计 Plan 4）——后续。
- 光标轮询频率与 CPU 占用的实测调优（必要时降到 30fps 或事件化）。
