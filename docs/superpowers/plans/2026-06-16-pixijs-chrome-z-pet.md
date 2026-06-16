# PixiJS 抛光铬「Z」桌宠 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 PixiJS v8 纯代码绘制一只「抛光铬字母 Z 小动物」桌宠替换现有占位形象，瞳孔全屏跟随鼠标，并有呼吸/眨眼/耳尾摆/点击挤压动效。

**Architecture:** 渲染层用 `pixi.js` 直接建场景图（部件各为 Container/Graphics），封装进 React 组件 `ChromeZPet`；纯逻辑（瞳孔偏移、坐标换算、光标轮询）抽成可单测的纯函数/注入式模块。全屏光标跟随由主进程新增 `cursorTracker` 定时读全局光标→经新 IPC `pet:cursor-move` 推给渲染层。命中/穿透/拖动复用现有机制，零改动。

**Tech Stack:** Electron 39 + React 19 + TypeScript（electron-vite）、`pixi.js` ^8、vitest。

---

## 设计依据

来自 spec：`docs/superpowers/specs/2026-06-16-pixijs-chrome-z-pet-design.md`。

形象几何取自已确认的视觉稿（坐标系 200×200，本计划画布用 200×210 容纳阴影/动画余量），关键坐标：

| 部件 | 几何（画布 200×210 坐标） |
|---|---|
| body（Z 笔画） | 折线 `(58,62)→(142,62)→(58,138)→(142,138)`，圆角，金属 stroke 宽 31，下垫暗色 rim 宽 37 |
| arms | `(48,98) Q(31,104)(29,120)` 与 `(152,98) Q(169,104)(171,120)`，宽 11 |
| tail | `(150,132) Q(178,134)(176,110)`，暗钢 stroke 宽 9，置于 body 之后 |
| ear_l / ear_r | 多边形 `[72,46,79,26,93,41]` / `[114,42,125,24,134,43]`，金属填充 + 细描边 |
| eye_white_l / eye_white_r | 圆心 `(86,62)` / `(118,62)`，半径 12，色 `eyeWhite` |
| pupil_l / pupil_r | 半径 5.5，基位=眼心，最大行程 `12 - 5.5 = 6.5`；带 `(-2,-2,r2)` 白色反光点 |
| mouth | `(93,76) Q(102,83)(111,76)`，墨色 stroke 宽 3 |
| highlight | `(64,56)→(136,56)` 白色 stroke 宽 5，alpha 随呼吸脉动（金属流光的简化实现） |

## File Structure

新建（渲染层）`src/renderer/src/pet/pixi/`：
- `eyeMath.ts` —— 纯函数：瞳孔在眼眶内的夹取偏移。
- `metal.ts` —— 铬色常量 + `makeChromeGradient()`（**唯一**用到易变的 `FillGradient` API，集中于此便于按安装版本调整）。
- `buildScene.ts` —— 构建场景图，返回各可动部件引用与几何常量。
- `petController.ts` —— 持有 `Application` + ticker；应用所有动画；暴露命令式接口。

新建（渲染层组件）：
- `src/renderer/src/pet/ChromeZPet.tsx` —— React 组件，挂载/销毁 PixiJS，接 IPC 光标、点击挤压，初始化失败回退 `PlaceholderPet`。

新建（共享）：
- `src/shared/cursorTransform.ts` —— 纯函数：全局光标→窗口局部坐标。

新建（主进程）：
- `src/main/cursorTracker.ts` —— 注入式定时器，仅在宠物窗可见时推送窗口局部光标。

修改：
- `src/shared/ipc.ts` —— 加 `PET_CURSOR_MOVE` 通道、`CursorPoint` 类型、`RendererApi.onCursorMove`。
- `src/preload/index.ts` —— `buildPetApi` 加 `onCursorMove`。
- `src/main/index.ts` —— bootstrap 接入 `cursorTracker`（创建、start、before-quit stop）。
- `src/renderer/src/pet/PetApp.tsx` —— `<PlaceholderPet/>` → `<ChromeZPet/>`。
- `package.json` —— 加 `pixi.js`。

测试（co-located `*.test.ts`，vitest）：
- `eyeMath.test.ts`、`cursorTransform.test.ts`、`cursorTracker.test.ts`、`cursorApi.test.ts`（preload onCursorMove）、`metal.test.ts`（纯 sheen 计算）。

---

## Task 1: 安装 pixi.js 依赖

**Files:**
- Modify: `package.json`（由 npm 写入）

- [ ] **Step 1: 安装**

Run: `npm install pixi.js@^8`
Expected: `package.json` 的 `dependencies` 新增 `"pixi.js": "^8.x"`，无安装报错。

- [ ] **Step 2: 验证类型可解析**

Run: `npm run typecheck`
Expected: PASS（无新错误；尚未 import pixi，本步只确认安装未破坏构建）。

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "build(pet): add pixi.js v8 dependency"
```

---

## Task 2: eyeMath 纯函数（TDD）

**Files:**
- Create: `src/renderer/src/pet/pixi/eyeMath.ts`
- Test: `src/renderer/src/pet/pixi/eyeMath.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// src/renderer/src/pet/pixi/eyeMath.test.ts
import { describe, it, expect } from 'vitest'
import { pupilOffset } from './eyeMath'

describe('pupilOffset', () => {
  it('returns zero when cursor is exactly at the eye center', () => {
    expect(pupilOffset(0, 0, 6.5)).toEqual({ x: 0, y: 0 })
  })

  it('clamps travel to maxTravel when the cursor is far away', () => {
    const o = pupilOffset(1000, 0, 6.5)
    expect(o.x).toBeCloseTo(6.5, 5)
    expect(o.y).toBeCloseTo(0, 5)
  })

  it('eases (less than max) when the cursor is near, within the gain radius', () => {
    // gain default 220; dist 110 -> half of maxTravel
    const o = pupilOffset(110, 0, 6.5)
    expect(o.x).toBeCloseTo(3.25, 5)
    expect(o.y).toBeCloseTo(0, 5)
  })

  it('keeps the offset magnitude <= maxTravel on a diagonal', () => {
    const o = pupilOffset(300, 400, 6.5) // dist 500 > gain -> clamped
    expect(Math.hypot(o.x, o.y)).toBeCloseTo(6.5, 5)
    expect(o.y).toBeGreaterThan(o.x) // points more downward than rightward
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/renderer/src/pet/pixi/eyeMath.test.ts`
Expected: FAIL（`pupilOffset` 未定义）。

- [ ] **Step 3: 实现**

```ts
// src/renderer/src/pet/pixi/eyeMath.ts
export interface Vec2 {
  x: number
  y: number
}

/**
 * Clamp the pupil so it stays inside the eye-white and eases toward the rim.
 * @param toCursorX cursor X minus eye-center X, in scene px
 * @param toCursorY cursor Y minus eye-center Y, in scene px
 * @param maxTravel max distance (px) the pupil center may leave the eye center
 * @param gain cursor distance (px) that maps to FULL travel; nearer => softer
 */
export function pupilOffset(
  toCursorX: number,
  toCursorY: number,
  maxTravel: number,
  gain = 220
): Vec2 {
  const dist = Math.hypot(toCursorX, toCursorY)
  if (dist === 0) return { x: 0, y: 0 }
  const travel = Math.min(maxTravel, (dist / gain) * maxTravel)
  const k = travel / dist
  return { x: toCursorX * k, y: toCursorY * k }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/renderer/src/pet/pixi/eyeMath.test.ts`
Expected: PASS（4 passed）。

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/pet/pixi/eyeMath.ts src/renderer/src/pet/pixi/eyeMath.test.ts
git commit -m "feat(pet): pupil-offset eye-tracking math"
```

---

## Task 3: cursorTransform 共享纯函数（TDD）

**Files:**
- Create: `src/shared/cursorTransform.ts`
- Test: `src/shared/cursorTransform.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// src/shared/cursorTransform.test.ts
import { describe, it, expect } from 'vitest'
import { toWindowLocal } from './cursorTransform'

describe('toWindowLocal', () => {
  it('subtracts the window top-left from the global cursor point', () => {
    expect(toWindowLocal({ x: 500, y: 300 }, { x: 100, y: 50, width: 200, height: 210 })).toEqual({
      x: 400,
      y: 250
    })
  })

  it('yields negatives when the cursor is left/above the window', () => {
    expect(toWindowLocal({ x: 10, y: 5 }, { x: 100, y: 50, width: 200, height: 210 })).toEqual({
      x: -90,
      y: -45
    })
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/shared/cursorTransform.test.ts`
Expected: FAIL（`toWindowLocal` 未定义）。

- [ ] **Step 3: 实现**

```ts
// src/shared/cursorTransform.ts
// Pure geometry: global screen cursor -> pet-window-local coordinates.
// ELECTRON-FREE.
export interface Point {
  x: number
  y: number
}

export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

/** Cursor point relative to the window's top-left corner. */
export function toWindowLocal(cursor: Point, bounds: Bounds): Point {
  return { x: cursor.x - bounds.x, y: cursor.y - bounds.y }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/shared/cursorTransform.test.ts`
Expected: PASS（2 passed）。

- [ ] **Step 5: Commit**

```bash
git add src/shared/cursorTransform.ts src/shared/cursorTransform.test.ts
git commit -m "feat(shared): global->window-local cursor transform"
```

---

## Task 4: cursorTracker 主进程（TDD，注入式）

**Files:**
- Create: `src/main/cursorTracker.ts`
- Test: `src/main/cursorTracker.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// src/main/cursorTracker.test.ts
import { describe, it, expect, vi } from 'vitest'
import { createCursorTracker } from './cursorTracker'

function fakeWindow(opts: { visible?: boolean; destroyed?: boolean; bounds?: { x: number; y: number; width: number; height: number } }) {
  return {
    isVisible: () => opts.visible ?? true,
    isDestroyed: () => opts.destroyed ?? false,
    getBounds: () => opts.bounds ?? { x: 100, y: 50, width: 200, height: 210 }
  }
}

describe('createCursorTracker', () => {
  it('sends the window-local cursor on each tick while visible, deduping identical points', () => {
    let tick = () => {}
    const send = vi.fn()
    let cursor = { x: 500, y: 300 }
    const t = createCursorTracker({
      getPetWindow: () => fakeWindow({}),
      getCursorScreenPoint: () => cursor,
      send,
      setIntervalFn: (fn) => {
        tick = fn
        return 1 as unknown as ReturnType<typeof setInterval>
      },
      clearIntervalFn: () => {}
    })
    t.start()
    tick()
    expect(send).toHaveBeenCalledWith({ x: 400, y: 250 })
    tick() // identical point -> no second send
    expect(send).toHaveBeenCalledTimes(1)
    cursor = { x: 520, y: 300 }
    tick()
    expect(send).toHaveBeenCalledTimes(2)
    expect(send).toHaveBeenLastCalledWith({ x: 420, y: 250 })
  })

  it('does not send when the window is hidden or destroyed or absent', () => {
    let tick = () => {}
    const send = vi.fn()
    const t = createCursorTracker({
      getPetWindow: () => fakeWindow({ visible: false }),
      getCursorScreenPoint: () => ({ x: 1, y: 1 }),
      send,
      setIntervalFn: (fn) => {
        tick = fn
        return 1 as unknown as ReturnType<typeof setInterval>
      },
      clearIntervalFn: () => {}
    })
    t.start()
    tick()
    expect(send).not.toHaveBeenCalled()
  })

  it('stop() clears the interval and is start-idempotent', () => {
    const clearIntervalFn = vi.fn()
    const setIntervalFn = vi.fn(() => 7 as unknown as ReturnType<typeof setInterval>)
    const t = createCursorTracker({
      getPetWindow: () => null,
      getCursorScreenPoint: () => ({ x: 0, y: 0 }),
      send: vi.fn(),
      setIntervalFn,
      clearIntervalFn
    })
    t.start()
    t.start() // idempotent
    expect(setIntervalFn).toHaveBeenCalledTimes(1)
    t.stop()
    expect(clearIntervalFn).toHaveBeenCalledWith(7)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/main/cursorTracker.test.ts`
Expected: FAIL（`createCursorTracker` 未定义）。

- [ ] **Step 3: 实现**

```ts
// src/main/cursorTracker.ts
// Polls the global cursor and pushes pet-window-local coordinates to the
// renderer ONLY while the pet window is visible. All side-effecting deps are
// injected so the tick logic is unit-testable without electron.
import { toWindowLocal, type Point, type Bounds } from '@shared/cursorTransform'

interface TrackableWindow {
  isVisible(): boolean
  isDestroyed(): boolean
  getBounds(): Bounds
}

export interface CursorTrackerDeps {
  getPetWindow: () => TrackableWindow | null
  getCursorScreenPoint: () => Point
  send: (local: Point) => void
  intervalMs?: number
  setIntervalFn?: (fn: () => void, ms: number) => ReturnType<typeof setInterval>
  clearIntervalFn?: (handle: ReturnType<typeof setInterval>) => void
}

export interface CursorTracker {
  start(): void
  stop(): void
}

export function createCursorTracker(deps: CursorTrackerDeps): CursorTracker {
  const intervalMs = deps.intervalMs ?? 16
  const setI = deps.setIntervalFn ?? setInterval
  const clearI = deps.clearIntervalFn ?? clearInterval
  let handle: ReturnType<typeof setInterval> | null = null
  let last: Point | null = null

  function tick(): void {
    const win = deps.getPetWindow()
    if (!win || win.isDestroyed() || !win.isVisible()) return
    const local = toWindowLocal(deps.getCursorScreenPoint(), win.getBounds())
    if (last && last.x === local.x && last.y === local.y) return
    last = local
    deps.send(local)
  }

  return {
    start(): void {
      if (handle === null) handle = setI(tick, intervalMs)
    },
    stop(): void {
      if (handle !== null) {
        clearI(handle)
        handle = null
      }
    }
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/main/cursorTracker.test.ts`
Expected: PASS（3 passed）。

- [ ] **Step 5: Commit**

```bash
git add src/main/cursorTracker.ts src/main/cursorTracker.test.ts
git commit -m "feat(main): visibility-gated global cursor tracker"
```

---

## Task 5: IPC 通道 + preload onCursorMove（TDD）

**Files:**
- Modify: `src/shared/ipc.ts`
- Modify: `src/preload/index.ts`
- Test: `src/preload/cursorApi.test.ts`

- [ ] **Step 1: 改 ipc.ts —— 加通道、类型、接口成员**

`IPC` 对象内加一行（在 `PET_PASSTHROUGH_MODE_CHANGED` 之后）：

```ts
  PET_CURSOR_MOVE: 'pet:cursor-move',
```

文件内（`Unsubscribe` 定义之后）加类型：

```ts
/** Pet-window-local cursor coordinates pushed from main each tick. */
export interface CursorPoint {
  x: number
  y: number
}
```

`RendererApi` 接口内加成员（在 `onPassthroughModeChanged` 之后）：

```ts
  /** Subscribe to pet-window-local cursor updates (whole-screen eye tracking). */
  onCursorMove(cb: (p: CursorPoint) => void): Unsubscribe
```

- [ ] **Step 2: 写失败测试**

```ts
// src/preload/cursorApi.test.ts
import { describe, it, expect, vi } from 'vitest'
import { buildPetApi } from './index'
import { IPC } from '@shared/ipc'

function fakeIpc() {
  const listeners: Record<string, ((...a: unknown[]) => void)[]> = {}
  return {
    on: vi.fn((ch: string, l: (...a: unknown[]) => void) => {
      ;(listeners[ch] ??= []).push(l)
    }),
    removeListener: vi.fn((ch: string, l: (...a: unknown[]) => void) => {
      listeners[ch] = (listeners[ch] ?? []).filter((x) => x !== l)
    }),
    send: vi.fn(),
    invoke: vi.fn(),
    emit: (ch: string, ...args: unknown[]) => (listeners[ch] ?? []).forEach((l) => l({}, ...args)),
    listenerCount: (ch: string) => (listeners[ch] ?? []).length
  }
}

describe('petApi.onCursorMove', () => {
  it('registers a pet:cursor-move listener and forwards the unwrapped point', () => {
    const ipc = fakeIpc()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = buildPetApi(ipc as any)
    const cb = vi.fn()
    const unsub = api.onCursorMove(cb)
    expect(ipc.on).toHaveBeenCalledWith(IPC.PET_CURSOR_MOVE, expect.any(Function))
    ipc.emit(IPC.PET_CURSOR_MOVE, { x: 12, y: 34 })
    expect(cb).toHaveBeenCalledWith({ x: 12, y: 34 })
    unsub()
    expect(ipc.listenerCount(IPC.PET_CURSOR_MOVE)).toBe(0)
  })
})
```

- [ ] **Step 3: 跑测试确认失败**

Run: `npx vitest run src/preload/cursorApi.test.ts`
Expected: FAIL（`onCursorMove` 不存在于 petApi）。

- [ ] **Step 4: 改 preload index.ts —— buildPetApi 加 onCursorMove**

在 `buildPetApi` 返回对象内、`drag` 块之后加（并确保从 `@shared/ipc` 导入 `CursorPoint`）：

```ts
    onCursorMove: (cb: (p: CursorPoint) => void): Unsubscribe => {
      const l = (_e: unknown, p: CursorPoint): void => cb(p)
      ipc.on(IPC.PET_CURSOR_MOVE, l)
      return () => ipc.removeListener(IPC.PET_CURSOR_MOVE, l)
    }
```

import 行改为：

```ts
import { IPC, type RendererApi, type Unsubscribe, type CursorPoint } from '@shared/ipc'
```

- [ ] **Step 5: 跑测试确认通过 + 全量类型检查**

Run: `npx vitest run src/preload/cursorApi.test.ts && npm run typecheck`
Expected: PASS（1 passed）；typecheck 无错误。

- [ ] **Step 6: Commit**

```bash
git add src/shared/ipc.ts src/preload/index.ts src/preload/cursorApi.test.ts
git commit -m "feat(ipc): pet:cursor-move channel + petApi.onCursorMove"
```

---

## Task 6: metal.ts 铬色辅助（隔离 FillGradient）

**Files:**
- Create: `src/renderer/src/pet/pixi/metal.ts`
- Test: `src/renderer/src/pet/pixi/metal.test.ts`

> 说明：`FillGradient` 是 PixiJS v8 中相对易变的 API，**全部集中在本文件**，其余代码只消费 `makeChromeGradient()` 的返回值。若安装的 pixi 版本构造签名不同（如对象式 `new FillGradient({ type, start, end, colorStops })`），**只需改本文件的 `makeChromeGradient`**。下方用 v8 文档化的定位式构造 + `addColorStop`。

- [ ] **Step 1: 写失败测试（纯 sheen 计算）**

```ts
// src/renderer/src/pet/pixi/metal.test.ts
import { describe, it, expect } from 'vitest'
import { sheenAlpha } from './metal'

describe('sheenAlpha', () => {
  it('oscillates within [0.45, 0.7] over time', () => {
    const samples = [0, 0.4, 0.8, 1.2, 1.6, 2.0, 2.4].map((t) => sheenAlpha(t))
    for (const a of samples) {
      expect(a).toBeGreaterThanOrEqual(0.45 - 1e-9)
      expect(a).toBeLessThanOrEqual(0.7 + 1e-9)
    }
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/renderer/src/pet/pixi/metal.test.ts`
Expected: FAIL（`sheenAlpha` 未定义）。

- [ ] **Step 3: 实现**

```ts
// src/renderer/src/pet/pixi/metal.ts
// Polished-chrome palette + gradient/sheen helpers. The ONLY place that touches
// PixiJS FillGradient (version-volatile) — adjust here if the installed pixi's
// FillGradient signature differs.
import { FillGradient } from 'pixi.js'

export const CHROME = {
  rim: 0x23272e, // dark outline under the metal stroke
  edge: 0x2c3038, // thin edge stroke on ears
  dark: 0x5b6670, // tail / deep accents
  eyeWhite: 0xf3f6fa,
  ink: 0x1b1e24 // pupils / mouth
} as const

/**
 * Vertical polished-chrome gradient spanning the pet's body height. Bright top,
 * a hot near-white sheen band in the middle, dark belly — the classic chrome
 * "horizon reflection" look. Coordinates are in scene space (canvas 200x210).
 */
export function makeChromeGradient(topY = 24, bottomY = 150): FillGradient {
  const g = new FillGradient(100, topY, 100, bottomY)
  g.addColorStop(0.0, 0xeef2f7)
  g.addColorStop(0.38, 0xaab3c0)
  g.addColorStop(0.5, 0xffffff)
  g.addColorStop(0.58, 0x6c7480)
  g.addColorStop(1.0, 0x3a3f48)
  return g
}

/** Breathing-synced highlight alpha (the simplified "metal sheen flow"). */
export function sheenAlpha(t: number): number {
  return 0.45 + 0.25 * (0.5 + 0.5 * Math.sin(t * 2.2))
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/renderer/src/pet/pixi/metal.test.ts`
Expected: PASS（1 passed）。

> 注：`makeChromeGradient` 返回 PixiJS 对象，不单测；在 Task 10 运行 app 时目视确认金属效果。若运行时报 `FillGradient` 构造/`addColorStop` 不存在，按本文件顶部说明改造（对象式构造），其余文件不动。

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/pet/pixi/metal.ts src/renderer/src/pet/pixi/metal.test.ts
git commit -m "feat(pet): chrome palette + gradient/sheen helpers"
```

---

## Task 7: buildScene.ts 场景图

**Files:**
- Create: `src/renderer/src/pet/pixi/buildScene.ts`

> 纯渲染几何，无单测；Task 10 运行 app 目视验证。本步只需类型检查通过。

- [ ] **Step 1: 实现 buildScene**

```ts
// src/renderer/src/pet/pixi/buildScene.ts
// Builds the chrome-Z pet scene graph. Coordinates are scene-space (200x210).
// Each animatable part is its own Container whose pivot == position == its
// rotation/scale center, so children may be drawn in absolute scene coords
// while the container still transforms around the intended anchor.
import { Container, Graphics } from 'pixi.js'
import { CHROME, makeChromeGradient } from './metal'

export const SCENE_W = 200
export const SCENE_H = 210
export const EYE_L = { x: 86, y: 62, r: 12 }
export const EYE_R = { x: 118, y: 62, r: 12 }
export const PUPIL_R = 5.5
export const PUPIL_MAX_TRAVEL = EYE_L.r - PUPIL_R // 6.5
export const FACE_CENTER_X = 100

export interface PetParts {
  root: Container
  bodyGroup: Container
  earL: Container
  earR: Container
  tail: Container
  face: Container
  eyes: Container
  pupilL: Container
  pupilR: Container
  highlight: Graphics
}

function anchored(x: number, y: number): Container {
  const c = new Container()
  c.pivot.set(x, y)
  c.position.set(x, y)
  return c
}

export function buildScene(): PetParts {
  const root = new Container()

  // bodyGroup: breathing scales around the bottom-center (100,138).
  const bodyGroup = anchored(100, 138)
  root.addChild(bodyGroup)

  const grad = makeChromeGradient()

  // tail behind everything (sway around its root 150,132).
  const tail = anchored(150, 132)
  tail.addChild(
    new Graphics()
      .moveTo(150, 132)
      .quadraticCurveTo(178, 134, 176, 110)
      .stroke({ width: 9, color: CHROME.dark, cap: 'round' })
  )
  bodyGroup.addChild(tail)

  // ears (sway).
  const earL = anchored(82, 44)
  earL.addChild(
    new Graphics().poly([72, 46, 79, 26, 93, 41]).fill(grad).stroke({ width: 2, color: CHROME.edge, join: 'round' })
  )
  const earR = anchored(124, 43)
  earR.addChild(
    new Graphics().poly([114, 42, 125, 24, 134, 43]).fill(grad).stroke({ width: 2, color: CHROME.edge, join: 'round' })
  )
  bodyGroup.addChild(earL, earR)

  // dark rim under the metal Z stroke.
  bodyGroup.addChild(
    new Graphics()
      .moveTo(58, 62)
      .lineTo(142, 62)
      .lineTo(58, 138)
      .lineTo(142, 138)
      .stroke({ width: 37, color: CHROME.rim, cap: 'round', join: 'round' })
  )
  // arms (static).
  bodyGroup.addChild(
    new Graphics()
      .moveTo(48, 98)
      .quadraticCurveTo(31, 104, 29, 120)
      .stroke({ width: 11, color: grad, cap: 'round' })
      .moveTo(152, 98)
      .quadraticCurveTo(169, 104, 171, 120)
      .stroke({ width: 11, color: grad, cap: 'round' })
  )
  // metal Z body.
  bodyGroup.addChild(
    new Graphics()
      .moveTo(58, 62)
      .lineTo(142, 62)
      .lineTo(58, 138)
      .lineTo(142, 138)
      .stroke({ width: 31, color: grad, cap: 'round', join: 'round' })
  )
  // top highlight line (sheen).
  const highlight = new Graphics()
    .moveTo(64, 56)
    .lineTo(136, 56)
    .stroke({ width: 5, color: 0xffffff, cap: 'round' })
  highlight.alpha = 0.6
  bodyGroup.addChild(highlight)

  // face: tilts slightly toward cursor; pivot at face center.
  const face = anchored(FACE_CENTER_X, 64)
  // eyes sub-group: blink scales this Y around the eye line (y=62).
  const eyes = anchored(FACE_CENTER_X, 62)
  eyes.addChild(new Graphics().circle(EYE_L.x, EYE_L.y, EYE_L.r).fill(CHROME.eyeWhite))
  eyes.addChild(new Graphics().circle(EYE_R.x, EYE_R.y, EYE_R.r).fill(CHROME.eyeWhite))
  const pupilL = new Container()
  pupilL.position.set(EYE_L.x, EYE_L.y)
  pupilL.addChild(new Graphics().circle(0, 0, PUPIL_R).fill(CHROME.ink))
  pupilL.addChild(new Graphics().circle(-2, -2, 2).fill(0xffffff))
  const pupilR = new Container()
  pupilR.position.set(EYE_R.x, EYE_R.y)
  pupilR.addChild(new Graphics().circle(0, 0, PUPIL_R).fill(CHROME.ink))
  pupilR.addChild(new Graphics().circle(-2, -2, 2).fill(0xffffff))
  eyes.addChild(pupilL, pupilR)
  // mouth (static, part of face).
  const mouth = new Graphics()
    .moveTo(93, 76)
    .quadraticCurveTo(102, 83, 111, 76)
    .stroke({ width: 3, color: CHROME.ink, cap: 'round' })
  face.addChild(eyes, mouth)
  bodyGroup.addChild(face)

  return { root, bodyGroup, earL, earR, tail, face, eyes, pupilL, pupilR, highlight }
}
```

- [ ] **Step 2: 类型检查**

Run: `npm run typecheck:web`
Expected: PASS（无错误）。若 `stroke({cap:'round'})` 的字面量类型报错，按 pixi 类型用 `'round' as const` 或从 pixi 导入对应枚举。

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/pet/pixi/buildScene.ts
git commit -m "feat(pet): chrome-Z pet scene graph"
```

---

## Task 8: petController.ts（Application + 动画）

**Files:**
- Create: `src/renderer/src/pet/pixi/petController.ts`

> 含 WebGL/ticker，不单测；逻辑已抽到 eyeMath/metal。Task 10 运行验证。

- [ ] **Step 1: 实现 petController**

```ts
// src/renderer/src/pet/pixi/petController.ts
// Owns the PixiJS Application + ticker and applies all pet animations.
// Imperative API consumed by the React wrapper. Eye-tracking input is in
// SCENE coordinates (the wrapper converts window-local px -> scene px).
import { Application } from 'pixi.js'
import { buildScene, EYE_L, EYE_R, PUPIL_MAX_TRAVEL, FACE_CENTER_X, SCENE_W, SCENE_H, type PetParts } from './buildScene'
import { pupilOffset } from './eyeMath'
import { sheenAlpha } from './metal'

export interface PetController {
  canvas: HTMLCanvasElement
  setCursorScene(x: number, y: number): void
  triggerSquash(): void
  pause(): void
  resume(): void
  destroy(): void
}

export async function createPetController(): Promise<PetController> {
  const app = new Application()
  await app.init({
    width: SCENE_W,
    height: SCENE_H,
    backgroundAlpha: 0,
    antialias: true,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true
  })

  const parts: PetParts = buildScene()
  app.stage.addChild(parts.root)

  let elapsed = 0
  let cursor: { x: number; y: number } | null = null
  let nextBlinkAt = randBlinkDelay()
  let blinkT = -1 // -1 idle; otherwise seconds into the blink
  let squashT = -1 // -1 idle; otherwise seconds into the squash

  function randBlinkDelay(): number {
    return 3 + Math.random() * 4 // 3..7 s
  }

  app.ticker.add((ticker) => {
    const dt = ticker.deltaTime / 60 // ~seconds at 60fps
    elapsed += dt

    // Breathing (scale around bottom-center).
    const breathe = Math.sin(elapsed * 2.2)
    let sx = 1 - breathe * 0.015
    let sy = 1 + breathe * 0.02

    // Squash on click/drag: quick scaleX up / scaleY down, decaying.
    if (squashT >= 0) {
      squashT += dt
      const k = Math.max(0, 1 - squashT / 0.35)
      const pulse = Math.sin(squashT * 22) * k
      sx += pulse * 0.12
      sy -= pulse * 0.12
      if (squashT > 0.35) squashT = -1
    }
    parts.bodyGroup.scale.set(sx, sy)

    // Sheen + ears/tail sway.
    parts.highlight.alpha = sheenAlpha(elapsed)
    parts.earL.rotation = Math.sin(elapsed * 1.6) * 0.08
    parts.earR.rotation = Math.sin(elapsed * 1.6 + 0.6) * 0.08
    parts.tail.rotation = Math.sin(elapsed * 1.3) * 0.12

    // Pupil follow + face tilt toward cursor.
    if (cursor) {
      const oL = pupilOffset(cursor.x - EYE_L.x, cursor.y - EYE_L.y, PUPIL_MAX_TRAVEL)
      parts.pupilL.position.set(EYE_L.x + oL.x, EYE_L.y + oL.y)
      const oR = pupilOffset(cursor.x - EYE_R.x, cursor.y - EYE_R.y, PUPIL_MAX_TRAVEL)
      parts.pupilR.position.set(EYE_R.x + oR.x, EYE_R.y + oR.y)
      parts.face.rotation = clamp((cursor.x - FACE_CENTER_X) / 1500, -0.06, 0.06)
    }

    // Blink.
    if (blinkT < 0 && elapsed >= nextBlinkAt) blinkT = 0
    if (blinkT >= 0) {
      blinkT += dt
      const half = 0.06
      const k = blinkT < half ? 1 - blinkT / half : (blinkT - half) / half
      parts.eyes.scale.y = Math.max(0.1, k)
      if (blinkT > half * 2) {
        blinkT = -1
        parts.eyes.scale.y = 1
        nextBlinkAt = elapsed + randBlinkDelay()
      }
    }
  })

  return {
    canvas: app.canvas,
    setCursorScene(x: number, y: number): void {
      cursor = { x, y }
    },
    triggerSquash(): void {
      squashT = 0
    },
    pause(): void {
      app.ticker.stop()
    },
    resume(): void {
      app.ticker.start()
    },
    destroy(): void {
      app.destroy({ removeView: true }, { children: true, texture: true, textureSource: true })
    }
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}
```

- [ ] **Step 2: 类型检查**

Run: `npm run typecheck:web`
Expected: PASS。

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/pet/pixi/petController.ts
git commit -m "feat(pet): pixi pet controller (breathing/blink/sway/follow/squash)"
```

---

## Task 9: ChromeZPet.tsx（React 集成）

**Files:**
- Create: `src/renderer/src/pet/ChromeZPet.tsx`

> 集成层，无单测；Task 10 运行验证。

- [ ] **Step 1: 实现 ChromeZPet**

```tsx
// src/renderer/src/pet/ChromeZPet.tsx
// Mounts the PixiJS chrome-Z pet inside the interactive .pet-body region.
// - Subscribes to whole-screen cursor updates (window.petApi.onCursorMove),
//   converts window-local px -> canvas/scene px via getBoundingClientRect.
// - Triggers a squash on pointerdown (independent of the drag gesture).
// - Falls back to <PlaceholderPet/> if the WebGL Application fails to init.
import React, { useEffect, useRef, useState } from 'react'
import { createPetController, type PetController } from './pixi/petController'
import { PlaceholderPet } from './PlaceholderPet'

export function ChromeZPet(): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let controller: PetController | null = null
    let unsub: (() => void) | null = null
    let disposed = false

    createPetController()
      .then((c) => {
        if (disposed) {
          c.destroy()
          return
        }
        controller = c
        const host = hostRef.current
        if (!host) return
        host.appendChild(c.canvas)

        unsub = window.petApi.onCursorMove((p) => {
          const rect = c.canvas.getBoundingClientRect()
          // window-local px (relative to window top-left) == viewport px here.
          c.setCursorScene(p.x - rect.left, p.y - rect.top)
        })
      })
      .catch((err) => {
        console.error('ChromeZPet init failed; falling back to placeholder', err)
        if (!disposed) setFailed(true)
      })

    return () => {
      disposed = true
      unsub?.()
      controller?.destroy()
    }
  }, [])

  if (failed) return <PlaceholderPet />

  return (
    <div className="pet-stage">
      <div
        className="pet-body"
        ref={hostRef}
        role="img"
        aria-label="Chrome Z pet"
        onPointerDown={() => {
          // squash feedback; drag is handled by PetApp's bubbled mousedown.
        }}
      />
    </div>
  )
}
```

> 注：`onPointerDown` 里要触发挤压，但 controller 在闭包外。改为用 ref 暴露 controller：

- [ ] **Step 2: 用 ref 暴露 controller 供 pointerdown 触发挤压**

把组件内的 controller 存进 ref，并在 `onPointerDown` 调用：

```tsx
  const controllerRef = useRef<PetController | null>(null)
  // ...在 .then 里：controller = c; controllerRef.current = c
  // ...在 cleanup 里：controllerRef.current = null
  // ...JSX：
  onPointerDown={() => controllerRef.current?.triggerSquash()}
```

最终 `useEffect` 内把 `controller` 的赋值同时写入 `controllerRef.current`，cleanup 置空。

- [ ] **Step 3: 类型检查 + lint**

Run: `npm run typecheck:web && npm run lint`
Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/pet/ChromeZPet.tsx
git commit -m "feat(pet): ChromeZPet React wrapper with cursor + squash + fallback"
```

---

## Task 10: 接线 PetApp + 主进程 bootstrap + 运行验证

**Files:**
- Modify: `src/renderer/src/pet/PetApp.tsx`
- Modify: `src/main/index.ts`

- [ ] **Step 1: PetApp 换用 ChromeZPet**

`import { PlaceholderPet } from './PlaceholderPet'` 改为 `import { ChromeZPet } from './ChromeZPet'`；
渲染处 `<PlaceholderPet />` 改为 `<ChromeZPet />`。其余（usePassthrough、drag 手势、setPetDragging）保持不变。

- [ ] **Step 2: 主进程接入 cursorTracker**

`src/main/index.ts` 顶部 import 增加：

```ts
import { app, screen } from 'electron'
import { createCursorTracker } from './cursorTracker'
```
（把现有 `import { app } from 'electron'` 合并为 `import { app, screen } from 'electron'`。）

在 bootstrap 内、`createPetWindow(settings)` 之后加入：

```ts
    // Whole-screen eye tracking: poll global cursor -> push window-local point.
    const cursorTracker = createCursorTracker({
      getPetWindow,
      getCursorScreenPoint: () => screen.getCursorScreenPoint(),
      send: (local) => getPetWindow()?.webContents.send(IPC.PET_CURSOR_MOVE, local)
    })
    cursorTracker.start()
```

把 `before-quit` 处理器改为先停轮询：

```ts
    app.on('before-quit', () => {
      cursorTracker.stop()
      ipcHandles.flushPersist()
      stopDisplayWatcher()
    })
```

- [ ] **Step 3: 全量校验**

Run: `npm run typecheck && npm run lint && npm test`
Expected: 三者全 PASS（新单测 + 既有测试，机制未改动故穿透/拖动测试不受影响）。

- [ ] **Step 4: 运行 app 目视验证**

Run: `npm run dev`
Expected（逐项确认）：
- 桌面出现抛光铬质感的「Z 小动物」，有耳朵/短手/尾巴/嘴/双眼，白底+反光点。
- 鼠标在**屏幕任意处**移动 → 两眼瞳孔朝光标方向移动、脸极轻微侧倾。
- 待机时整体轻微呼吸缩放、顶部高光脉动、耳朵/尾巴轻摆，随机眨眼。
- 点击宠物 → 一次挤压回弹。
- 拖动宠物可移动（命中包围盒）、其余区域点击穿透到桌面，托盘"重置交互/锁定"仍有效。
- 关闭 app 无报错；控制台无 WebGL 上下文泄漏告警。

> 若 `FillGradient` 在运行时报错，按 Task 6 顶部说明仅改 `metal.ts` 的 `makeChromeGradient`。若瞳孔朝向有偏移，核对 `ChromeZPet` 的 `getBoundingClientRect` 映射与 canvas 未被 CSS 拉伸（场景 200×210 应与显示 CSS 像素 1:1）。

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/pet/PetApp.tsx src/main/index.ts
git commit -m "feat(pet): wire ChromeZPet + whole-screen cursor tracking into the app"
```

---

## Self-Review（计划自查记录）

- **Spec 覆盖**：§3 形象→Task 7；§3 金属→Task 6；§4 架构/文件→Task 6-9；§5 全屏跟随→Task 3/4/5/10；§6 动效→Task 8（瞳孔/呼吸+流光/眨眼/耳尾摆+挤压全覆盖）；§7 命中穿透→Task 10（复用、未改）；§8 错误/生命周期→Task 9（init 失败回退 + destroy）/Task 4（可见性门控）/Task 10（before-quit stop）；§9 测试→Task 2/3/4/5/6；§10 依赖→Task 1。无遗漏。
- **占位扫描**：无 TODO/“稍后实现”；易变的 `FillGradient` 给了具体代码 + 单点改造说明（非占位）。
- **类型一致性**：`PetController`、`PetParts`、`CursorPoint`、`toWindowLocal`、`pupilOffset`、`makeChromeGradient/sheenAlpha`、`createCursorTracker` 在定义与消费处签名一致；`EYE_L/EYE_R/PUPIL_MAX_TRAVEL/FACE_CENTER_X/SCENE_W/SCENE_H` 由 buildScene 导出、petController 消费。
- **已知风险**：`FillGradient` 构造签名随 pixi 小版本可能不同（已隔离）；`stroke` 选项字面量类型（已给修法）；坐标映射依赖 canvas 不被 CSS 拉伸（已在验证步标注）。
