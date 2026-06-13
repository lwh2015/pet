# Desktop Pet — Plan 1: Foundation & Desktop Shell — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the cross-platform desktop-pet shell — a transparent, always-on-top, frameless window rendering a *placeholder* pet that is click-through everywhere except over itself, draggable with a persisted (display-clamped) position, controlled by a tray menu, and able to open a separate normal panel window — on electron-vite + React + TypeScript, with all decision logic unit-tested.

**Architecture:** A two-window Electron app — a transparent **PetWindow** and an opaque **PanelWindow** — with a strict main/preload/renderer split (`contextIsolation: true`, no `nodeIntegration`, per-window preloads via `contextBridge`). All decision logic (settings merge, position clamping, the passthrough state machine, the tray-menu model, debounce) lives in electron-free **pure modules under `src/shared`** and is TDD'd with vitest; Electron window/tray/IPC glue is kept thin and **manually verified**. Cross-task integration points (window registry, IPC handler registration, the preload `petApi`/`panelApi` surfaces, the `index.ts` bootstrap) follow the single canonical contract in *"Canonical integration contract"* below.

**Tech Stack:** Electron (~v30+), electron-vite 5 (Vite 7), React 19, TypeScript 5.9, vitest 4, electron-builder. **Out of scope for this plan** (later plans): Live2D/PixiJS, SQLite/file ingestion, AI/chat.

---

## Plan series

This is **Plan 1 of 4** for the desktop-pet MVP. Each plan produces working, testable software and has its own spec→plan→implement cycle.

- **Plan 1 (this) — Foundation & Desktop Shell:** runnable transparent/topmost/click-through draggable placeholder pet + tray + panel window + tested pure logic.
- **Plan 2 — Live2D rendering & action system:** replace the placeholder with PixiJS v7 + `pixi-live2d-display-advanced` (free sample model), an `ActionController` mapping action tags → motions/expressions, cursor-follow, and random idle micro-actions.
- **Plan 3 — Storage & file ingestion:** `better-sqlite3` + a vault directory; drag-drop ingest, dedup by hash, a file library in the panel (the `files` table reserves `status`/`extracted_text` for later text extraction).
- **Plan 4 — Chat with mock provider:** an `LLMProvider` interface + a streaming `MockProvider`, a chat bubble in the pet window, action linkage via `actionTag`, and persisted history — designed so a real cloud/agent provider drops in without touching the UI.

## Execution order & task dependencies

Tasks below are printed **in execution order**. Task **IDs reflect their authoring group** (1.x scaffold, 2.x shared logic, 3.x pet window, 4.x passthrough, 5.x drag/restore, 6.x tray/panel/bootstrap, 7.x integration glue), **not** their sequence — base glue (vite multi-window config, window registry, IPC base, preloads, panel route) is interleaved ahead of the feature tasks that extend it. Execute strictly top-to-bottom:

`1.1 → 1.2 → 1.3 → 1.4 → 1.5 → 1.6 → 1.7 → 7.2 → 2.1 → 2.2 → 2.3 → 5.1 → 4.1 → 6.1 → 4.2 → 2.4 → 4.3 → 5.2 → 7.1 → 3.1 → 6.2 → 7.7 → 7.3 → 7.4 → 7.5 → 4.4 → 5.3 → 5.4 → 7.6 → 3.2 → 4.5 → 4.6 → 6.3 → 6.4`

---

## Scaffold notes

SCAFFOLD COMMAND (run once, in the existing repo D:\aicode\pet which already has .git, README.md, docs/). Use '.' to scaffold into the current directory; npm REQUIRES the `--` separator before flags (R1 pitfall):

  npm create @quick-start/electron@latest . -- --template react-ts

If the CLI refuses a non-empty dir, scaffold into a temp subdir and move src/ + config files up, preserving the existing .git and docs/. Then install the mutually-compatible pinned set (R2 — latest-everything does NOT co-install; vite must be ^7, the only major both electron-vite@5 and vitest@4 accept):

  npm install
  npm i -D vitest@^4 @vitest/coverage-v8@^4
  (template already pins electron-vite ^5 / vite ^7 / react 19 / typescript 5.9 — keep them; do NOT bump vite to 8.)

GENERATED STRUCTURE (react-ts) and how THIS CONTRACT maps onto it:
  - src/main/index.ts          -> kept as main entry; expanded per fileStructure (split into windows/, tray.ts, passthrough.ts, ipc.ts, settingsStore.ts, dragController.ts, displayWatcher.ts under src/main/).
  - src/preload/index.ts       -> becomes the PET preload (exposes window.petApi). ADD src/preload/panel.ts for the panel preload (window.panelApi). Two distinct rollup input keys (index, panel) — never share one key (R1 pitfall).
  - src/preload/index.d.ts     -> augmented to declare window.petApi + window.panelApi typed from src/shared.
  - src/renderer/index.html    -> the PET window HTML (transparent). ADD src/renderer/panel.html as the second renderer entry (its <script> points at /src/panel/main.tsx).
  - src/renderer/src/...       -> reorganized into src/renderer/src/pet/** and src/renderer/src/panel/**; delete the scaffold App.tsx / components/Versions.tsx demo.
  - NEW top-level: src/shared/** (all pure logic + tests) — NOT generated by the scaffold; created by Plan 1.
  - NEW top-level: vitest.config.ts — SEPARATE from electron.vite.config.ts (vitest never reads electron.vite.config.ts, R2). environment:'node', globals:true, include ['src/shared/**/*.{test,spec}.ts','src/main/**/*.{test,spec}.ts'], exclude out/**.

ELECTRON.VITE.CONFIG.TS modifications (from the verbatim scaffold base, R1 multi-window pattern):
  - preload.build.rollupOptions.input = { index: 'src/preload/index.ts', panel: 'src/preload/panel.ts' }
  - renderer.build.rollupOptions.input = { index: 'src/renderer/index.html', panel: 'src/renderer/panel.html' }
  - renderer.build.isolatedEntries = true (fewer shared chunks across the two HTML entries)
  - resolve.alias add '@shared' -> resolve('src/shared') alongside existing '@renderer'.

RUNTIME / BUILD FACTS that constrain the code (do not drift):
  - CommonJS by default (NO "type":"module"): main/preload freely use __dirname + join(__dirname, '../preload/index.js'); package.json "main" stays ./out/main/index.js. Do NOT migrate to ESM in Plan 1.
  - webPreferences for BOTH windows: contextIsolation:true, nodeIntegration:false, sandbox:false (so @electron-toolkit/preload + our preload work), backgroundThrottling:false (smooth pet).
  - Pet window load: dev -> mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL); prod -> loadFile(join(__dirname,'../renderer/index.html')).
  - Panel window load: dev -> loadURL(`${process.env.ELECTRON_RENDERER_URL}/panel.html`); prod -> loadFile(join(__dirname,'../renderer/panel.html')). Each window points webPreferences.preload at its own built preload (../preload/index.js vs ../preload/panel.js).
  - Pet window constructor (R3/R5): frame:false, transparent:true, backgroundColor:'#00000000', resizable:false, hasShadow:false, roundedCorners:false, skipTaskbar:true, focusable:false, show:false; after ready-to-show -> win.show(); win.setAlwaysOnTop(true,'screen-saver'); on mac win.setVisibleOnAllWorkspaces(true,{visibleOnFullScreen:true}).
  - mac accessory: app.setActivationPolicy('accessory') after whenReady; set electron-builder mac.extendInfo.LSUIElement=1 in electron-builder.yml for no-flash startup.
  - Single-instance lock at the very top of src/main/index.ts before creating windows (R5).

RUN COMMANDS: dev = `npm run dev` (electron-vite dev, HMR); unit tests = `npx vitest run` (NEVER bare `npx vitest` — that starts watch mode and hangs, R2); single file = `npx vitest run src/shared/passthrough.test.ts`.

## File structure (created by this plan)

- `src/shared/types.ts` — Single source of truth for domain types: Settings, PetPosition, DisplayBounds, PassthroughMode union, TrayMenuModel/TrayMenuItem, IpcRenderToMain/IpcMainToRender payload shapes. Electron-free, importable by main + preload + renderer + tests.
- `src/shared/ipc.ts` — Canonical IPC channel name constants (IPC object) + RendererApi interface (the contextBridge surface). Electron-free string constants only; no runtime electron import.
- `src/shared/settings.ts` — DEFAULT_SETTINGS constant + pure mergeSettings(defaults, partial) and validateSettings helper. No fs, no electron.
- `src/shared/passthrough.ts` — Pure passthrough state machine: resolveIgnoreMouse(mode, overInteractive) -> boolean. No electron.
- `src/shared/position.ts` — Pure geometry: clampPositionToDisplays(pos, displays) -> PetPosition, plus pickDisplayForPosition helper. No electron, takes DisplayBounds[] as plain data.
- `src/shared/trayMenu.ts` — Pure buildTrayMenuModel(state) -> TrayMenuModel — declarative menu description (labels, ids, checked flags) the main process maps to Menu.buildFromTemplate. No electron.
- `src/shared/debounce.ts` — Pure debounce<T>(fn, waitMs) factory with cancel/flush; used by persist-position logic and unit-testable with fake timers. No electron.
- `src/shared/types.test.ts` — Type-level/sanity tests guarding the union literals and that DEFAULT_SETTINGS satisfies Settings (optional; vitest).
- `src/shared/settings.test.ts` — TDD unit tests for mergeSettings (defaults-merge, deep merge of position, ignores unknown keys, clamps invalid mode).
- `src/shared/passthrough.test.ts` — TDD unit tests for resolveIgnoreMouse across all 3 modes x overInteractive true/false.
- `src/shared/position.test.ts` — TDD unit tests for clampPositionToDisplays (on-screen, off-screen right/left/top/bottom, monitor removed, multi-display pick).
- `src/shared/trayMenu.test.ts` — TDD unit tests for buildTrayMenuModel (checked radio reflects mode, visibility label reflects shown state, stable item ids).
- `src/shared/debounce.test.ts` — TDD unit tests for debounce using vi.useFakeTimers (coalesces calls, last-args win, cancel, flush).
- `src/main/index.ts` — Main entry: single-instance lock, app.whenReady, platform accessory policy (mac), create pet+panel windows, init tray + passthrough + settings + ipc, app lifecycle (window-all-closed/activate). Glue — manual-verified.
- `src/main/windows/petWindow.ts` — createPetWindow(): transparent/frameless/alwaysOnTop('screen-saver')/skipTaskbar pet window factory + loadPetRenderer; restores clamped saved position. Glue.
- `src/main/windows/panelWindow.ts` — createPanelWindow()/showPanelWindow(): normal opaque panel BrowserWindow loading panel.html, created hidden, reused if already open. Glue.
- `src/main/windows/windowManager.ts` — Module-scope refs + getters (getPetWindow/getPanelWindow) and togglePetVisibility/resetInteraction helpers so tray/ipc/passthrough share window handles without circular imports. Glue.
- `src/main/tray.ts` — createTray(): builds Tray (keeps module ref), wires platform-aware click/right-click, rebuilds context menu from buildTrayMenuModel(state) on state change. Glue.
- `src/main/passthrough.ts` — PassthroughController: holds current PassthroughMode, applies resolveIgnoreMouse() result via win.setIgnoreMouseEvents(ignore, {forward:true}); exposes setMode/setOverInteractive/reset. Thin electron wrapper around pure logic.
- `src/main/settingsStore.ts` — Hand-rolled JSON settings store over fs + app.getPath('userData'): load() (merge with DEFAULT_SETTINGS via mergeSettings), save(settings) atomic write, get/set. Lazy electron access for testability.
- `src/main/ipc.ts` — registerIpcHandlers(): ipcMain.handle/on for every IPC channel constant, delegating to settingsStore/passthrough/windowManager/drag. Glue.
- `src/main/dragController.ts` — Manual-drag handlers (drag:start/move/end) using screen.getCursorScreenPoint() + win.setPosition with fixed offset; on end, clamp + debounced-persist position. Glue + uses pure debounce/clamp.
- `src/main/displayWatcher.ts` — Subscribes to screen 'display-removed'/'display-metrics-changed', re-clamps pet window into connected displays via clampPositionToDisplays. Glue.
- `src/preload/index.ts` — Pet-window preload: contextBridge.exposeInMainWorld('petApi', RendererApi impl) wrapping ipcRenderer over IPC channel constants (setInteractive, drag, getSettings/setSettings, openPanel).
- `src/preload/panel.ts` — Panel-window preload: contextBridge.exposeInMainWorld('panelApi', ...) exposing getSettings/setSettings/onSettingsChanged only (no passthrough/drag).
- `src/preload/index.d.ts` — Global Window augmentation declaring window.petApi and window.panelApi typed via RendererApi from shared, so renderer typechecks.
- `src/renderer/index.html` — Pet-window HTML entry (transparent body) loading /src/pet/main.tsx. Scaffold-renamed default index.html.
- `src/renderer/panel.html` — Panel-window HTML entry (opaque) loading /src/panel/main.tsx. Second renderer entry.
- `src/renderer/src/pet/main.tsx` — React mount for the pet route into #root of index.html.
- `src/renderer/src/pet/PetApp.tsx` — Pet root component: renders placeholder pet, wires global mousemove hit-test -> usePassthrough hook -> window.petApi.setInteractive; wires drag handle to window.petApi.drag.*.
- `src/renderer/src/pet/PlaceholderPet.tsx` — Simple CSS/SVG pet div (NOT Live2D) marked as the interactive/drag region; decorative areas pointer-events:none.
- `src/renderer/src/pet/usePassthrough.ts` — React hook running the mousemove alpha/DOM hit-test, debouncing the leave transition, and calling window.petApi.setInteractive only on state change.
- `src/renderer/src/pet/pet.css` — Transparent html/body, pointer-events:none decorative layers, .pet-body interactive styling for the pet route.
- `src/renderer/src/panel/main.tsx` — React mount for the panel route into #root of panel.html.
- `src/renderer/src/panel/PanelApp.tsx` — Panel placeholder React route (opaque) showing a Settings stub reading window.panelApi.getSettings(); empty shell for Plans 3/4.
- `src/renderer/src/panel/panel.css` — Opaque panel styling for the panel route.
- `electron.vite.config.ts` — electron-vite config: multi renderer inputs (index.html + panel.html) + multi preload inputs (index.ts + panel.ts), isolatedEntries:true, @renderer + @shared aliases, react plugin. Scaffold-modified.
- `vitest.config.ts` — Separate vitest config (environment:node, globals:true) with include scoped to src/shared and src/main test files, @shared alias mirrored. New file, not from scaffold.

---

## Canonical shared contract (obey exactly)

Every task below conforms to these definitions. Do not invent alternative names.

### Shared types — `src/shared/types.ts` (single source of truth)

```ts
// ============================================================================
// src/shared/types.ts
// Single source of truth for Plan 1 domain types. ELECTRON-FREE.
// Importable by main, preload, renderer, and vitest without loading electron.
// ============================================================================

/**
 * Window position + size in screen DIP coordinates (matches Electron getBounds).
 * width/height are persisted so restore is robust even if defaults change.
 */
export interface PetPosition {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Plain data view of an Electron Display's usable area.
 * Passed into pure clamping logic so position.ts never imports electron.
 */
export interface DisplayBounds {
  id: number
  /** Usable area excluding taskbar/dock/menubar (Electron Display.workArea). */
  workArea: { x: number; y: number; width: number; height: number }
}

/**
 * Mouse-passthrough lock mode, chosen from the tray.
 *  - 'auto'                : renderer hit-test drives interactivity (default).
 *  - 'locked-interactive'  : window is always interactive (never click-through).
 *  - 'locked-passthrough'  : window is always click-through (ignores the pet).
 */
export type PassthroughMode =
  | 'auto'
  | 'locked-interactive'
  | 'locked-passthrough'

export const PASSTHROUGH_MODES: readonly PassthroughMode[] = [
  'auto',
  'locked-interactive',
  'locked-passthrough'
] as const

/**
 * User-facing settings persisted to userData/settings.json.
 * Keep flat + JSON-serializable. No functions, no Date objects.
 */
export interface Settings {
  /** Schema version for forward-compatible migrations. */
  version: number
  /** Last known pet-window bounds, restored (clamped) on launch. */
  petPosition: PetPosition
  /** Current passthrough lock mode. */
  passthroughMode: PassthroughMode
  /** Whether the pet window is shown (toggled from tray). */
  petVisible: boolean
}

// ---------------------------------------------------------------------------
// Tray menu model (pure, declarative). The main process maps this to
// Electron's Menu.buildFromTemplate; the builder itself stays electron-free
// and unit-testable.
// ---------------------------------------------------------------------------

/** Stable identifiers for tray menu actions (used as the click contract). */
export type TrayItemId =
  | 'toggle-visibility'
  | 'mode-auto'
  | 'mode-locked-interactive'
  | 'mode-locked-passthrough'
  | 'reset-interaction'
  | 'open-panel'
  | 'quit'

export interface TrayMenuItem {
  /** undefined id => separator. */
  id?: TrayItemId
  type: 'normal' | 'radio' | 'separator'
  label?: string
  /** For radio items: whether currently selected. */
  checked?: boolean
  enabled?: boolean
}

export type TrayMenuModel = TrayMenuItem[]

/** Input snapshot the tray menu is rendered from. */
export interface TrayMenuState {
  mode: PassthroughMode
  petVisible: boolean
}

// ---------------------------------------------------------------------------
// IPC payload shapes (the typed wire contract). Channel NAME constants live in
// src/shared/ipc.ts; these are the payload/response types referenced by both
// the preload bridge and the main-process handlers.
// ---------------------------------------------------------------------------

export interface SetInteractivePayload {
  interactive: boolean
}

export interface SettingsChangedPayload {
  settings: Settings
}

export interface PassthroughModeChangedPayload {
  mode: PassthroughMode
}
```

### Settings schema

```ts
// ============================================================================
// src/shared/settings.ts
// DEFAULT_SETTINGS + pure merge/validate logic. ELECTRON-FREE, FS-FREE.
// ============================================================================
import {
  type Settings,
  type PassthroughMode,
  type PetPosition,
  PASSTHROUGH_MODES
} from './types'

/** Bumped only when the persisted Settings shape changes incompatibly. */
export const SETTINGS_VERSION = 1

/** Default pet-window bounds used on first launch (centered later by main). */
export const DEFAULT_PET_POSITION: PetPosition = {
  x: 100,
  y: 100,
  width: 300,
  height: 300
}

export const DEFAULT_SETTINGS: Settings = {
  version: SETTINGS_VERSION,
  petPosition: { ...DEFAULT_PET_POSITION },
  passthroughMode: 'auto',
  petVisible: true
}

function isPassthroughMode(value: unknown): value is PassthroughMode {
  return (
    typeof value === 'string' &&
    (PASSTHROUGH_MODES as readonly string[]).includes(value)
  )
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * Deep-merge a partial (e.g. parsed JSON from disk, or an IPC patch) onto a
 * known-good defaults object. Unknown keys are ignored; invalid values fall
 * back to the default for that field. Always returns a complete, valid
 * Settings — never throws. Pure (no I/O).
 */
export function mergeSettings(
  defaults: Settings,
  partial: Partial<Settings> | null | undefined
): Settings {
  const src = partial ?? {}

  const petPosition: PetPosition = { ...defaults.petPosition }
  const p = src.petPosition
  if (p && typeof p === 'object') {
    if (isFiniteNumber(p.x)) petPosition.x = p.x
    if (isFiniteNumber(p.y)) petPosition.y = p.y
    if (isFiniteNumber(p.width) && p.width > 0) petPosition.width = p.width
    if (isFiniteNumber(p.height) && p.height > 0) petPosition.height = p.height
  }

  return {
    version: defaults.version,
    petPosition,
    passthroughMode: isPassthroughMode(src.passthroughMode)
      ? src.passthroughMode
      : defaults.passthroughMode,
    petVisible:
      typeof src.petVisible === 'boolean'
        ? src.petVisible
        : defaults.petVisible
  }
}
```

### IPC channels

| Channel | Direction | Payload | Description |
|---|---|---|---|
| `pet:setInteractive` | renderer->main | { interactive: boolean } | Pet renderer's hit-test result. interactive=true means cursor is over a solid pet pixel/UI -> main applies setIgnoreMouseEvents(false); false -> setIgnoreMouseEvents(true,{forward:true}). Honored only when current PassthroughMode is 'auto' (resolveIgnoreMouse gates it). Fire-and-forget (ipcRenderer.send / ipcMain.on). |
| `pet:drag-start` | renderer->main | void | Pet drag gesture began (mousedown past threshold on drag handle). Main records fixed cursor->window offset via screen.getCursorScreenPoint(). send/on. |
| `pet:drag-move` | renderer->main | void | Pet drag in progress (mousemove while dragging). Main reads cursor point and calls win.setPosition with the stored offset. send/on. |
| `pet:drag-end` | renderer->main | void | Pet drag ended (mouseup). Main clears drag offset, clamps window into connected displays, and debounce-persists the new PetPosition to settings. send/on. |
| `pet:open-panel` | renderer->main | void | Request to open/show the opaque panel window (also invokable from tray). Main calls showPanelWindow(). send/on. |
| `settings:get` | renderer->main | request: void -> response: Settings | Read full merged settings. Request/response via ipcRenderer.invoke / ipcMain.handle; returns the current Settings object. |
| `settings:set` | renderer->main | request: Partial<Settings> -> response: Settings | Patch settings (deep-merged via mergeSettings), persist to disk, broadcast settings:changed, and return the resulting full Settings. invoke/handle. |
| `settings:changed` | main->renderer | { settings: Settings } | Broadcast to all windows whenever settings are persisted (from settings:set, drag-persist, or tray mode change) so any open window stays in sync. webContents.send / ipcRenderer.on. |
| `pet:passthrough-mode-changed` | main->renderer | { mode: PassthroughMode } | Notifies the pet renderer when the manual lock mode changes (via tray) so the hit-test loop can pause/resume reporting. webContents.send / ipcRenderer.on. |

### Canonical pure-logic function signatures (TDD these)

- `export function resolveIgnoreMouse(mode: PassthroughMode, overInteractive: boolean): boolean` (src/shared/passthrough.ts) — Pure passthrough state machine. Returns the `ignore` boolean to feed win.setIgnoreMouseEvents(ignore, {forward:true}). Rules: mode==='locked-interactive' -> false (always interactive, never ignore); mode==='locked-passthrough' -> true (always click-through); mode==='auto' -> ignore = !overInteractive (interactive only when cursor over a solid pet pixel/UI). No electron, no side effects.
- `export function clampPositionToDisplays(pos: PetPosition, displays: DisplayBounds[]): PetPosition` (src/shared/position.ts) — Returns a PetPosition guaranteed fully visible within the workArea of one connected display. Picks the display whose workArea most overlaps pos (via pickDisplayForPosition); if none overlap (monitor unplugged / off-screen) picks displays[0] (caller passes primary first). Clamps x into [wa.x, wa.x+wa.width-width] and y into [wa.y, wa.y+wa.height-height]; if width/height exceed the workArea they are shrunk to fit. width/height otherwise preserved. Throws if displays is empty. Pure.
- `export function pickDisplayForPosition(pos: PetPosition, displays: DisplayBounds[]): DisplayBounds` (src/shared/position.ts) — Helper used by clampPositionToDisplays. Returns the DisplayBounds with the largest rectangular overlap area against pos; ties and zero-overlap resolve to displays[0]. Pure; no electron.
- `export function mergeSettings(defaults: Settings, partial: Partial<Settings> | null | undefined): Settings` (src/shared/settings.ts) — Deep-merges a partial (disk JSON or IPC patch) onto defaults. Ignores unknown keys, coerces invalid fields back to the default (invalid passthroughMode -> default; non-finite/negative position fields -> default; non-boolean petVisible -> default). Returns a complete valid Settings, never throws. Pure, no I/O. (Source delivered in settingsSchemaTS.)
- `export function buildTrayMenuModel(state: TrayMenuState): TrayMenuModel` (src/shared/trayMenu.ts) — Pure declarative tray model the main process feeds to Menu.buildFromTemplate. Produces, in order: toggle-visibility (label 'Hide Pet' when state.petVisible else 'Show Pet'), separator, three radio items mode-auto / mode-locked-interactive / mode-locked-passthrough with checked === (id maps to state.mode), reset-interaction (normal), separator, open-panel (normal), separator, quit (normal). Item ids are stable (TrayItemId) so click handlers bind by id. No electron.
- `export function debounce<A extends unknown[]>(fn: (...args: A) => void, waitMs: number): { (...args: A): void; cancel(): void; flush(): void }` (src/shared/debounce.ts) — Pure trailing-edge debounce factory used for persist-position. Returns a callable that delays fn until waitMs elapse since the last call (last args win); .cancel() drops a pending call, .flush() invokes a pending call immediately with the last args. Uses setTimeout/clearTimeout only (unit-test with vi.useFakeTimers). No electron.
- `export function createPassthroughController(getWindow: () => Electron.BrowserWindow | null): { setMode(mode: PassthroughMode): void; setOverInteractive(over: boolean): void; apply(): void; reset(): void; getMode(): PassthroughMode }` (src/main/passthrough.ts) — Thin electron wrapper around resolveIgnoreMouse. Holds current mode + overInteractive flag; apply() computes resolveIgnoreMouse(mode, over) and calls win.setIgnoreMouseEvents(ignore, ignore ? { forward: true } : undefined). reset() forces overInteractive=false and re-applies (the tray 'reset interaction'). Glue — tested manually; logic delegated to the pure helper.
- `export function createSettingsStore(userDataDir: string): { load(): Settings; get(): Settings; set(patch: Partial<Settings>): Settings; getFilePath(): string }` (src/main/settingsStore.ts) — Hand-rolled JSON store (fs only, electron passed as a path string so it is unit-testable without electron). load() reads userDataDir/settings.json, JSON.parses, runs mergeSettings(DEFAULT_SETTINGS, parsed) (returns DEFAULT_SETTINGS on missing/corrupt file); set() merges patch, writes atomically (tmp file + rename), caches, and returns the new Settings. Pure-ish: only fs + the injected dir, no direct app.getPath import.

### Naming rules

CASING:
  - Files: camelCase for modules (petWindow.ts, settingsStore.ts, dragController.ts, usePassthrough.ts); PascalCase for React components (PetApp.tsx, PlaceholderPet.tsx, PanelApp.tsx). HTML entries lower-case (index.html, panel.html).
  - Types/interfaces/enums: PascalCase (Settings, PetPosition, PassthroughMode, TrayMenuModel). Type unions are string-literal unions, NOT TS enums, except where a const array (PASSTHROUGH_MODES) is needed for runtime validation.
  - Constants: SCREAMING_SNAKE_CASE (DEFAULT_SETTINGS, SETTINGS_VERSION, DEFAULT_PET_POSITION, PASSTHROUGH_MODES). The IPC channel-name container is `IPC` (an `as const` object), not an enum.
  - Functions: camelCase verbs (resolveIgnoreMouse, clampPositionToDisplays, mergeSettings, buildTrayMenuModel, debounce, createSettingsStore, createPetWindow). Factories that create stateful controllers/windows are prefixed `create*`.

IPC CHANNEL CONVENTION (mandatory — every channel name is a constant in src/shared/ipc.ts, NEVER a string literal at a call site):
  - Format: `domain:verb-or-noun`, lower-kebab after the colon. domains in Plan 1: `pet`, `settings`.
  - Commands (renderer->main): imperative verb -> `pet:setInteractive`, `pet:open-panel`, `pet:drag-start`, `pet:drag-move`, `pet:drag-end`, `settings:get`, `settings:set`. (Spec's canonical names `pet:setInteractive`, `pet:setPosition`, `settings:get`, `settings:set` are honored; drag is split into start/move/end instead of a single setPosition for the manual-drag pattern.)
  - Events (main->renderer broadcasts): past-tense/noun -> `settings:changed`, `pet:passthrough-mode-changed`.
  - Request/response channels use ipcRenderer.invoke + ipcMain.handle (settings:get, settings:set). Fire-and-forget use ipcRenderer.send + ipcMain.on (pet:* commands). Broadcasts use webContents.send + ipcRenderer.on.
  - The IPC constant KEY mirrors the channel: IPC.PET_SET_INTERACTIVE = 'pet:setInteractive', IPC.SETTINGS_GET = 'settings:get', IPC.SETTINGS_CHANGED = 'settings:changed', etc. (SCREAMING_SNAKE key, kebab/colon value.)

CONTEXTBRIDGE SURFACE:
  - Pet window exposes exactly `window.petApi` (RendererApi subset: setInteractive, drag.start/move/end, openPanel, getSettings, setSettings, onSettingsChanged, onPassthroughModeChanged).
  - Panel window exposes exactly `window.panelApi` (getSettings, setSettings, onSettingsChanged). Do NOT reuse the scaffold's generic `window.api`/`window.electron` names for our methods — keep them but add the typed petApi/panelApi.
  - Renderer code calls window.petApi.* / window.panelApi.*; it must NEVER import 'electron' or reference ipcRenderer directly.

PURITY RULE (enforced so vitest stays electron-free, R2):
  - Everything in src/shared/** MUST NOT import 'electron' (only Node built-ins + own modules). All TDD'd helpers live there.
  - src/main/** modules that must touch electron do so LAZILY (inside functions) and receive dependencies as params (e.g. settingsStore takes userDataDir:string, passthrough controller takes a getWindow() callback) so unit-testable seams exist without mocking electron.

ALIASES: '@shared' -> src/shared (used by main, preload, renderer, AND vitest); '@renderer' -> src/renderer/src (renderer only). Import shared types via '@shared/types', helpers via '@shared/passthrough' etc.; never deep-import across the main/renderer boundary.

OUT OF SCOPE (do not create files/types/channels for): Live2D/pixi, SQLite/better-sqlite3, file ingest/vault, AI/chat/mock provider, conversations/messages. No `chat:*`, `files:*`, or `action:*` channels in Plan 1.

### Canonical integration contract (resolves cross-task seams)

These decisions reconcile the window registry, IPC registration, preload surfaces, the display watcher, and `index.ts` bootstrap ownership so the tasks compose without conflict:

Authored D:/aicode/pet/.recon/integration-contract.md and D:/aicode/pet/.recon/order.json. Canonical decisions:

1. createPetWindow(settings: Settings): BrowserWindow — takes the loaded Settings object directly (NOT a store/source/deps bag). Restores clamped saved position inline via screen-derived DisplayBounds, calls setPetWindow(win) to register into windowManager, and gates win.show() on ready-to-show to settings.petVisible (show only if true). 3.1 owns the factory; 7.1 inserts setPetWindow; 5.4 exports restorePetPosition but must NOT change the signature.

2. Display watcher: ONE name startDisplayWatcher(getWindow) => disposer (5.4). initDisplayWatcher() is dropped; 6.4 calls startDisplayWatcher(getPetWindow).

3. Getter ownership: getPetWindow AND getPanelWindow live ONLY in windowManager.ts (7.1). panelWindow.ts (6.2) drops its local ref + local getPanelWindow, calls setPanelWindow(win), and showPanelWindow() reads getPanelWindow() from windowManager. Nothing imports getPanelWindow from panelWindow.ts. windowManager API: setPetWindow/getPetWindow/setPanelWindow/getPanelWindow/togglePetVisibility(visible):boolean/resetInteraction()/__resetWindowManagerForTests(); getters null-guard isDestroyed().

4. Bootstrap ownership: 6.4 is the SOLE editor of src/main/index.ts whenReady/bootstrap. The contract pins the EXACT bootstrap: single-instance lock -> bootstrap() -> whenReady: createSettingsStore+load, createPetWindow(settings), createPassthroughController(getPetWindow)+setMode+apply (resting click-through+forward), broadcastSettingsChanged helper, registerIpcHandlers(deps) captured as ipcHandles, startDisplayWatcher(getPetWindow), broadcastPassthroughMode, createTray(handlers), before-quit -> ipcHandles.flushPersist()+stopDisplayWatcher, window-all-closed no-op. 3.1/4.4/5.4 must NOT edit index.ts. 5.4 only EXPORTS restorePetPosition + startDisplayWatcher.

5. registerIpcHandlers(deps: IpcDeps): IpcHandles — ONE single-arg shape. IpcDeps = { settingsStore, passthrough, showPanelWindow, getPetWindow, broadcastSettingsChanged, getAllWindows }. Returns { flushPersist }. 7.7 authors base (settings:get/set + settings:changed broadcast + pet:open-panel) and returns a flushPersist placeholder; 4.4 ADDS only the pet:setInteractive on-handler; 5.3 builds the drag controller + persist sink, adds the three drag on-handlers, and wires the REAL flushPersist into the return. Drag flush belongs to the drag controller (createDragController(...).flushPersist), called by 6.4 on before-quit — not a separate ipc concern. 7.7's test is rewritten to the single-arg (deps) form mocking electron's ipcMain.

6. Surfaces: RendererApi (full: setInteractive, drag.start/move/end, openPanel, getSettings, setSettings, onSettingsChanged, onPassthroughModeChanged), PanelApi (getSettings/setSettings/onSettingsChanged only) — both authored ONCE in shared/ipc.ts by 4.2. Canonical callback shapes: onSettingsChanged forwards UNWRAPPED Settings (preload unwraps payload.settings); onPassthroughModeChanged forwards the {mode} payload. 4.2's draft (cb taking SettingsChangedPayload) is overridden to (settings: Settings). petApi base in 7.3 (getSettings/setSettings/openPanel/onSettingsChanged); 4.4 adds setInteractive/onPassthroughModeChanged; 5.3 adds drag. panelApi base is 7.4; index.d.ts (7.5) declares window.petApi: RendererApi + window.panelApi: PanelApi.

7. electron.vite.config.ts (multi-window inputs + isolatedEntries + @shared alias) owned solely by 7.2; no other task duplicates it.

Order rationale: scaffold chain 1.1-1.7 first (each depends on prior); 7.2 vite config early as base build glue; shared pure logic next with 2.1 types before all type consumers (2.2/2.3/5.1/4.1/6.1/4.2); main pure-ish controllers 2.4(settingsStore)/4.3(passthrough) after their pure deps; 5.2 position-restore regression test after 2.3; window factories 3.1(pet)->6.2(panel)->7.1(windowManager modifies both); ipc/preload base 7.7->7.3 then extensions 4.4->5.3 then 5.4(displayWatcher/restore); preload typing 7.4/7.5 and panel renderer 7.6; pet renderer 3.2/4.5 and verify 4.6; tray 6.3; 6.4 bootstrap integrator last (depends on every factory/controller/ipc/watcher/tray).

> **Ordering correction applied in this document:** `windowManager.ts` (Task 7.1) is sequenced **before** the window factories it serves (Task 3.1 pet, Task 6.2 panel) — see the execution-order list above. Those factories import `setPetWindow`/`setPanelWindow`/`getPanelWindow` from an already-authored `windowManager.ts`; there is no separate retrofit step. (The architect summary above describes the seam, not the sequence.)

---

## Tasks

### Task 1.1: Scaffold electron-vite react-ts project into the existing repo (via temp subdir)

**Files:**
- Create: `D:\aicode\pet\package.json` (scaffold output, moved up from temp subdir)
- Create: `D:\aicode\pet\electron.vite.config.ts` (scaffold output)
- Create: `D:\aicode\pet\tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json` (scaffold output)
- Create: `D:\aicode\pet\src\main\index.ts`, `src\preload\index.ts`, `src\preload\index.d.ts`, `src\renderer\index.html`, `src\renderer\src\main.tsx`, `src\renderer\src\App.tsx` (scaffold output)
- Create: `D:\aicode\pet\.vscode\`, `build\`, `resources\`, `electron-builder.yml`, `eslint.config.mjs`, `.editorconfig`, `.gitignore`, `.prettierignore`, `.prettierrc.yaml` (scaffold output)
- Preserve (never overwritten): `D:\aicode\pet\.git`, `D:\aicode\pet\README.md`, `D:\aicode\pet\docs\`

> WHY a temp subdir and NOT `.`: The `@quick-start/electron` CLI (alex8088/quick-start) calls `emptyDir(root)` whenever the target dir is non-empty and the user confirms (or `--skip` is passed). `emptyDir` does `fs.readdirSync(dir)` and recursively deletes EVERY entry with NO exclusion list — it would wipe `.git/`, `README.md`, and `docs/`. In a non-interactive (no-TTY) automation context the confirm prompt also hangs the step. The ONLY safe + unattended path is to scaffold into a fresh EMPTY subdir (where `canSafelyOverwrite()` is true, so no prompt and no `emptyDir`), then move the generated files up with `mv -n` (which never clobbers the preserved entries). Do NOT scaffold into `.` and do NOT pass `--skip` against the live repo.

- [ ] **Step 1: Pre-flight — assert the Node engine floor for the vite7 + vitest4 set.** vite 7 requires node `^20.19 || >=22.12`; vitest 4 (added in Task 1.2) requires node `^20 || ^22 || >=24` (R2). If Node is below `20.19` the install/typecheck/test all fail later with engine errors. Run:
```bash
node -v
```
Expected: prints a version `>= v20.19.0` (ideally `>= v22.12.0`). If it prints anything lower, STOP and upgrade Node before continuing — do not proceed to the scaffold.

- [ ] **Step 2: Confirm the repo state before scaffolding.** Run this exact command and confirm `.git`, `README.md`, and `docs` exist and that there is no `src/` or `package.json` yet:
```bash
ls -la /d/aicode/pet
```
Expected: a listing containing `.git/`, `README.md`, and `docs/` and NO `src/` or `package.json`. (An existing `.omc/` may also be present; it is preserved like the others.)

- [ ] **Step 3: Scaffold into a fresh EMPTY temp subdir (the only safe path).** Scaffolding into `.__scaffold` (which does not yet exist) makes `canSafelyOverwrite()` true, so the CLI emits NO "Remove existing files and continue?" confirm prompt — it runs unattended and never touches `.git`/`README.md`/`docs/`. npm REQUIRES the `--` separator before flags (R1 pitfall). Run exactly:
```bash
cd /d/aicode/pet && npm create @quick-start/electron@latest .__scaffold -- --template react-ts
```
Expected: it creates `/d/aicode/pet/.__scaffold/` containing `package.json`, `electron.vite.config.ts`, `tsconfig*.json`, `electron-builder.yml`, `eslint.config.mjs`, `.vscode/`, `build/`, `resources/`, `src/main`, `src/preload`, `src/renderer`, and the dotfiles (`.editorconfig`, `.gitignore`, `.prettierignore`, `.prettierrc.yaml`). No prompt, no error, and the top-level `.git`/`README.md`/`docs/` are untouched.

- [ ] **Step 4: Verify what the scaffold actually produced in the temp dir.** List ALL entries (including dotfiles) so the move in Step 5 is complete:
```bash
ls -la /d/aicode/pet/.__scaffold
```
Expected: the entries are exactly `.editorconfig`, `.gitignore`, `.prettierignore`, `.prettierrc.yaml`, `.vscode`, `README.md`, `build`, `electron-builder.yml`, `electron.vite.config.ts`, `eslint.config.mjs`, `package.json`, `resources`, `src`, `tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json`. (No `.npmrc`, no `package-lock.json`, no `node_modules` — install has NOT run yet; that is Task 1.2.)

- [ ] **Step 5: Move ALL generated entries up one level WITHOUT clobbering preserved files.** First remove the scaffold's own `README.md` from the temp dir so it cannot overwrite the repo's README (we keep the existing one), then move everything else with dotglob enabled. `mv -n` (no-clobber) is a second safety net — it refuses to overwrite any existing target. Run:
```bash
rm -f /d/aicode/pet/.__scaffold/README.md && \
  ( shopt -s dotglob nullglob && mv -n /d/aicode/pet/.__scaffold/* /d/aicode/pet/ )
```
Expected: no output and no error. The glob (with `dotglob`) moves dotfiles like `.vscode/`, `.gitignore`, `.editorconfig`, `.prettierignore`, `.prettierrc.yaml` as well as the regular dirs/files. Nothing is left behind because we matched every entry; the repo's `.git/`, `README.md`, and `docs/` are NOT clobbered (no source named those after the README removal, and `mv -n` would refuse anyway).

- [ ] **Step 6: Verify the temp dir is empty, then remove it.** Confirm nothing was silently left behind BEFORE deleting (this is the check that would have caught a missed `.vscode`):
```bash
ls -A /d/aicode/pet/.__scaffold
```
Expected: prints NOTHING (empty). If anything prints, move it up manually with `mv -n /d/aicode/pet/.__scaffold/<name> /d/aicode/pet/` and re-check before continuing. Once empty, remove the temp dir:
```bash
rm -rf /d/aicode/pet/.__scaffold
```
Expected: `/d/aicode/pet/.__scaffold` no longer exists.

- [ ] **Step 7: Verify the generated structure exists at top level.** Run:
```bash
ls /d/aicode/pet/src/main/index.ts /d/aicode/pet/src/preload/index.ts /d/aicode/pet/src/preload/index.d.ts /d/aicode/pet/src/renderer/index.html /d/aicode/pet/electron.vite.config.ts /d/aicode/pet/package.json /d/aicode/pet/.vscode
```
Expected: all seven paths print with no "No such file" error (`.vscode` lists its contents — `extensions.json`/`launch.json`/`settings.json`). The preserved `.git/`, `README.md`, `docs/` are still present.

- [ ] **Step 8: Verify package.json has CommonJS defaults (no ESM migration).** Confirm `"main": "./out/main/index.js"` is present and there is NO `"type": "module"` field:
```bash
grep -n '"main"' /d/aicode/pet/package.json && grep -c '"type": "module"' /d/aicode/pet/package.json
```
Expected: the `"main"` line prints `"main": "./out/main/index.js",` and the second grep prints `0` (zero — no `type:module`, so main/preload stay CommonJS per scaffoldNotes runtime facts).

- [ ] **Step 9: Commit the raw scaffold.** Exact commands:
```bash
cd /d/aicode/pet && git add -A && git commit -m "$(cat <<'EOF'
chore: scaffold electron-vite react-ts project

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```
Expected: a commit is created listing the scaffolded files (including `.vscode/`); `git status` is clean afterward.

---

### Task 1.2: Install dependencies with the pinned, mutually-compatible version set

**Files:**
- Modify: `D:\aicode\pet\package.json` (devDependencies — add `vitest`, `@vitest/coverage-v8`; keep template pins)
- Create: `D:\aicode\pet\node_modules\` (install output)
- Create/Modify: `D:\aicode\pet\package-lock.json` (install output — first produced HERE, not by the scaffold)

- [ ] **Step 1: Install the template's pinned dependency set.** This installs electron-vite ^5 / vite ^7 / react 19 / typescript 5.9 exactly as pinned by the template (R1). The scaffold's own pinned set co-installs cleanly (no `--` needed; this is a plain install). Run:
```bash
cd /d/aicode/pet && npm install
```
Expected: completes without ERESOLVE errors; `node_modules/` and a NEW `package-lock.json` are created. (The `postinstall` runs `electron-builder install-app-deps`; it may print rebuild output — that is normal.) NOTE: the active registry here is npmmirror; if a transient registry/network error occurs, re-run `npm install` — it is idempotent.

- [ ] **Step 2: Add vitest and the coverage provider, pinned to ^4.** vite must stay ^7 — the only major both electron-vite@5 and vitest@4 accept (R2). Do NOT bump vite to 8. Run:
```bash
cd /d/aicode/pet && npm i -D vitest@^4 @vitest/coverage-v8@^4
```
Expected: installs vitest 4.x and a matching `@vitest/coverage-v8` 4.x; no ERESOLVE peer-dependency error about vite.

- [ ] **Step 3: Verify the resolved versions are mutually compatible.** Run:
```bash
cd /d/aicode/pet && npm ls vite electron-vite vitest @vitest/coverage-v8
```
Expected: a single `vite@7.x` (NOT 8.x), `electron-vite@5.x`, `vitest@4.x`, and `@vitest/coverage-v8@4.x` whose minor matches vitest. No "invalid"/"unmet peer" markers, and crucially only ONE vite copy in the tree.

- [ ] **Step 4: Commit the dependency changes.** Exact commands:
```bash
cd /d/aicode/pet && git add package.json package-lock.json && git commit -m "$(cat <<'EOF'
chore: pin deps (vite ^7, electron-vite ^5) and add vitest ^4

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```
Expected: a commit containing only `package.json` and `package-lock.json` (node_modules is gitignored by the scaffold's `.gitignore`).

---

### Task 1.3: Verify `npm run dev` launches a window (manual)

**Files:**
- Verify only (no source changes): `D:\aicode\pet\src\main\index.ts`, `src\renderer\index.html`

- [ ] **Step 1: Manual verification — launch the dev app.** Run the dev command (it starts the Vite dev server + Electron with HMR; it stays running until you quit it):
```bash
cd /d/aicode/pet && npm run dev
```
Then perform these numbered on-screen checks:
1. A terminal banner appears for `electron-vite` showing the dev server URL (the `ELECTRON_RENDERER_URL`, e.g. `http://localhost:5173`), and lines indicating `main`, `preload`, and `renderer` built.
2. An Electron desktop window opens (the scaffold's default React demo window — it shows the "Powered by electron-vite" / Versions demo content). EXPECTED: the window renders without a blank white error page and without a red error overlay.
3. The terminal shows NO uncaught main-process exception and NO "Failed to load" renderer error.
4. Quit the app by pressing `Ctrl+C` in the terminal (or closing the window on the platform). EXPECTED: the process exits and returns you to the shell prompt.

- [ ] **Step 2: Record the dev-server base URL for later window-load code.** Note from Step 1's banner the exact `ELECTRON_RENDERER_URL` value printed; later panel-window load uses `${ELECTRON_RENDERER_URL}/panel.html`. No file change in this step — this is a verification checkpoint only. (No commit; nothing changed on disk.)

---

### Task 1.4: Prune the scaffold demo to a clean baseline

**Files:**
- Modify: `D:\aicode\pet\src\renderer\src\App.tsx` (replace demo body with minimal placeholder)
- Delete: `D:\aicode\pet\src\renderer\src\components\Versions.tsx`
- Delete: `D:\aicode\pet\src\renderer\src\components\` (directory, if now empty)
- Delete: `D:\aicode\pet\src\renderer\src\assets\electron.svg`, `D:\aicode\pet\src\renderer\src\assets\wavy-lines.svg` (orphaned demo art)
- Modify: `D:\aicode\pet\src\renderer\src\assets\main.css` (strip demo body/logo styles; keep the file so `main.tsx`'s `import './assets/main.css'` still resolves)
- Verify-only: `D:\aicode\pet\src\renderer\src\main.tsx` (keep its `import './assets/main.css'` — do NOT remove it), `src\main\index.ts`, `src\preload\index.ts`, `src\preload\index.d.ts` (kept as-is in this group; reorganized in later groups)

> WHY also touch assets/main.css: deleting `Versions.tsx` and rewriting `App.tsx` orphans the demo art (`electron.svg`, `wavy-lines.svg`) and leaves demo body/`#root`/logo rules in `main.css`. `main.tsx` still does `import './assets/main.css'`, so the cascade survives and would fight the pet/panel CSS added in later groups. We delete the orphaned SVGs and reduce `main.css` to a minimal neutral baseline now, while KEEPING the `main.css` file and its import intact so nothing fails to resolve.

- [ ] **Step 1: Delete the demo `Versions.tsx` component.** Run:
```bash
rm -f /d/aicode/pet/src/renderer/src/components/Versions.tsx
```
Then remove the `components/` directory if it is now empty:
```bash
rmdir /d/aicode/pet/src/renderer/src/components 2>/dev/null; true
```
Expected: `Versions.tsx` no longer exists; `components/` is gone if it held nothing else.

- [ ] **Step 2: Delete the orphaned demo SVG assets.** These were only referenced by the demo `App.tsx`/`Versions.tsx`; nothing imports them after pruning. Run:
```bash
rm -f /d/aicode/pet/src/renderer/src/assets/electron.svg /d/aicode/pet/src/renderer/src/assets/wavy-lines.svg
```
Expected: both SVG files no longer exist.

- [ ] **Step 3: Replace `App.tsx` with a minimal placeholder so nothing imports the deleted demo.** Overwrite `D:\aicode\pet\src\renderer\src\App.tsx` with EXACTLY:
```tsx
function App(): React.JSX.Element {
  return <div className="baseline-placeholder">pet baseline</div>
}

export default App
```

- [ ] **Step 4: Reduce `main.css` to a neutral baseline (keep the file + its import).** Overwrite `D:\aicode\pet\src\renderer\src\assets\main.css` with EXACTLY this minimal content (removes all demo body/logo/`#root` flex-center/`@media` rules, keeps a tiny neutral reset so `main.tsx`'s `import './assets/main.css'` still resolves and renders nothing fancy):
```css
:root {
  font-family: system-ui, -apple-system, sans-serif;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
}

.baseline-placeholder {
  padding: 16px;
  font: 14px/1.4 system-ui, sans-serif;
}
```

- [ ] **Step 5: Verify no dangling reference to the deleted demo remains.** Check both the `Versions` component and the two deleted SVGs are no longer referenced anywhere in `src/`:
```bash
grep -rn -e "Versions" -e "electron.svg" -e "wavy-lines.svg" /d/aicode/pet/src || echo "NO_REFERENCES"
```
Expected: prints `NO_REFERENCES` (the demo import and both SVG imports are fully removed). If any line prints, remove that import/usage before continuing. NOTE: `main.tsx`'s `import './assets/main.css'` is intentionally retained and is NOT matched by this grep — that is correct.

- [ ] **Step 6: Typecheck the pruned renderer to confirm the baseline still compiles.** Run the template's web typecheck:
```bash
cd /d/aicode/pet && npm run typecheck:web
```
Expected: exits 0 with no TS errors (no missing-module error for `Versions`, `electron.svg`, or `wavy-lines.svg`).

- [ ] **Step 7: Commit the pruned baseline.** Exact commands:
```bash
cd /d/aicode/pet && git add -A && git commit -m "$(cat <<'EOF'
chore: prune scaffold demo to clean baseline

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```
Expected: a commit removing `Versions.tsx` + the two demo SVGs, simplifying `App.tsx` and `main.css`; `git status` clean.

---

### Task 1.5: Create the src/shared folder and wire the `@shared` tsconfig path

**Files:**
- Create: `D:\aicode\pet\src\shared\.gitkeep` (lock the folder into git until real modules land in a later group)
- Modify: `D:\aicode\pet\tsconfig.node.json` (add `@shared/*` path mapping + `src/shared/**/*` include; this config covers main/preload/shared)
- Modify: `D:\aicode\pet\tsconfig.web.json` (add `@shared/*` path mapping + `src/shared/**/*` include so the renderer can import shared types)

> NOTE on the composite-include overlap: `src/shared/**/*` is intentionally compiled by BOTH `tsconfig.node.json` and `tsconfig.web.json`. Both set `composite: true` and are referenced by the root solution `tsconfig.json`, so listing the same files in two referenced projects could normally trigger TS6307-style overlap warnings under a solution build (`tsc -b`). This is BENIGN here ONLY because the scaffold's `typecheck:node`/`typecheck:web` scripts run `tsc --noEmit -p <cfg> --composite false` — the `--composite false` flag disables the project-reference emit/overlap check, so no warning fires. Do NOT switch these scripts to `tsc -b`. If a solution build is ever introduced later, scope `src/shared` to ONE project (node) and have the web project consume it via the `@shared` path mapping + a project reference instead of re-including the files.

- [ ] **Step 1: Create the `src/shared` folder and lock it with a placeholder.** This folder is NOT generated by the scaffold; it holds all pure, electron-free logic (per fileStructure). Create the placeholder:
```bash
mkdir -p /d/aicode/pet/src/shared && touch /d/aicode/pet/src/shared/.gitkeep
```
Expected: `D:\aicode\pet\src\shared\.gitkeep` exists.

- [ ] **Step 2: Inspect the two tsconfig files to find the existing `compilerOptions` / `paths` and `include` shape.** Read both so the path edits match the real structure (and so the real `include` arrays are preserved, NOT overwritten):
```bash
cat /d/aicode/pet/tsconfig.node.json
cat /d/aicode/pet/tsconfig.web.json
```
Expected: each is a small JSON extending `@electron-toolkit/tsconfig/...`. Note whether a `compilerOptions.paths` block and a `baseUrl` already exist, and record the EXACT `include` globs present (e.g. `tsconfig.web.json` typically lists `src/renderer/src/env.d.ts`, `src/renderer/src/**/*`, `src/renderer/src/**/*.tsx`, `src/preload/*.d.ts`). You will APPEND `src/shared/**/*` to whichever array is present — never replace the list.

- [ ] **Step 3: Add the `@shared/*` path mapping to `tsconfig.node.json` (main + preload + shared).** In `D:\aicode\pet\tsconfig.node.json`, inside `compilerOptions`, add a `baseUrl` (if absent) and the `paths` entry. The resulting `compilerOptions` MUST contain exactly these two keys (merge with any existing keys, do not delete them):
```json
"baseUrl": ".",
"paths": {
  "@shared/*": ["src/shared/*"]
}
```
Also ensure its `include` array contains `"src/shared/**/*"` so shared modules typecheck under the node project. APPEND `src/shared/**/*` to the existing array (keep every entry the scaffold listed, e.g. `electron.vite.config.*`, `src/main/**/*`, `src/preload/**/*`, and any `*.d.ts` globs). For example, if the scaffold's array is `["electron.vite.config.*", "src/main/**/*", "src/preload/**/*"]`, the result MUST be:
```json
"include": ["electron.vite.config.*", "src/main/**/*", "src/preload/**/*", "src/shared/**/*"]
```
(Use the ACTUAL entries you saw in Step 2 — this is illustrative. Do NOT drop any pre-existing entry.)

- [ ] **Step 4: Add the `@shared/*` path mapping to `tsconfig.web.json` (renderer).** In `D:\aicode\pet\tsconfig.web.json`, inside `compilerOptions`, add (merging with existing keys, preserving the existing `@renderer/*` mapping if present):
```json
"baseUrl": ".",
"paths": {
  "@renderer/*": ["src/renderer/src/*"],
  "@shared/*": ["src/shared/*"]
}
```
If a `@renderer/*` mapping already exists in this file, keep it and ADD the `@shared/*` line alongside it (do not drop `@renderer/*`). Then APPEND `src/shared/**/*` to the EXISTING `include` array — do NOT collapse it to two entries. The scaffold's real `tsconfig.web.json` include has four entries; the result MUST preserve all of them PLUS the new one:
```json
"include": [
  "src/renderer/src/env.d.ts",
  "src/renderer/src/**/*",
  "src/renderer/src/**/*.tsx",
  "src/preload/*.d.ts",
  "src/shared/**/*"
]
```
CRITICAL: do NOT drop `"src/preload/*.d.ts"` — that glob is what makes `window.petApi`/`window.panelApi` typecheck in the renderer in later groups. (Match the actual entries you saw in Step 2; the four renderer/preload entries above are the verified scaffold defaults.)

- [ ] **Step 5: Verify both tsconfigs still parse and typecheck cleanly.** Run the full typecheck (node + web passes; each uses `--composite false`, so the shared-include overlap is benign):
```bash
cd /d/aicode/pet && npm run typecheck
```
Expected: exits 0 with no errors and NO TS6307 "file is matched by include of multiple projects" warning (the `--composite false` flag in the scripts suppresses the overlap check). The `@shared` mapping resolving to an empty folder is fine — nothing imports it yet; this step only proves the JSON is valid and the path config does not break either tsc pass.

- [ ] **Step 6: Commit the shared-folder + path wiring.** Exact commands:
```bash
cd /d/aicode/pet && git add -A && git commit -m "$(cat <<'EOF'
chore: add src/shared folder and @shared tsconfig path

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```
Expected: a commit adding `src/shared/.gitkeep` and modifying both tsconfig files; `git status` clean.

---

### Task 1.6: Add and configure vitest, proven by one trivial passing test (TDD)

**Files:**
- Create: `D:\aicode\pet\vitest.config.ts` (separate from electron.vite.config.ts — vitest never reads electron.vite.config.ts, R2)
- Modify: `D:\aicode\pet\package.json` (add `test`, `test:watch`, `test:cov` scripts)
- Create: `D:\aicode\pet\src\shared\smoke.test.ts` (the trivial passing test)
- Create: `D:\aicode\pet\src\shared\smoke.ts` (the trivial module under test)

- [ ] **Step 1: Write the failing test FIRST.** Create `D:\aicode\pet\src\shared\smoke.test.ts` with EXACTLY this content (it imports `smoke.ts`, which does not exist yet, so the run fails to resolve the module):
```ts
import { describe, it, expect } from 'vitest'
import { smoke } from './smoke'

describe('smoke', () => {
  it('returns the fixed sentinel string proving vitest runs', () => {
    expect(smoke()).toBe('ok')
  })
})
```

- [ ] **Step 2: Create the vitest config so the test can be discovered.** Create `D:\aicode\pet\vitest.config.ts` with EXACTLY this content (environment node, globals true, include scoped to shared + main test files, exclude out/, mirror the `@shared` alias — per scaffoldNotes/R2):
```ts
import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: [
      'src/shared/**/*.{test,spec}.ts',
      'src/main/**/*.{test,spec}.ts'
    ],
    exclude: ['**/node_modules/**', 'out/**', 'dist/**']
  },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared')
    }
  }
})
```

- [ ] **Step 3: Run the test and confirm it FAILS (red).** Use the `run` subcommand so vitest does ONE pass and exits (never bare `npx vitest`, which starts watch mode and hangs — R2). Run:
```bash
cd /d/aicode/pet && npx vitest run src/shared/smoke.test.ts
```
Expected: FAIL. vitest reports it cannot resolve `./smoke` (an error like `Failed to resolve import "./smoke"` / `Cannot find module './smoke'`), the file is marked FAIL, and the process exits non-zero (exit code 1).

- [ ] **Step 4: Write the minimal implementation to make it pass.** Create `D:\aicode\pet\src\shared\smoke.ts` with EXACTLY this content (pure, electron-free per the purity rule):
```ts
/**
 * Trivial sentinel used only to prove the vitest toolchain runs.
 * Replaced/removed once real src/shared modules exist.
 */
export function smoke(): string {
  return 'ok'
}
```

- [ ] **Step 5: Run the test and confirm it PASSES (green).** Run the exact same command:
```bash
cd /d/aicode/pet && npx vitest run src/shared/smoke.test.ts
```
Expected: PASS. Output shows `✓ src/shared/smoke.test.ts (1 test)`, then a summary `Test Files  1 passed (1)` and `Tests  1 passed (1)`, and the process exits 0.

- [ ] **Step 6: Add the test scripts to package.json.** In `D:\aicode\pet\package.json`, inside the `"scripts"` object, add these three entries (merge alongside the existing `dev`/`build`/`typecheck` scripts; do not remove any):
```json
"test": "vitest run",
"test:watch": "vitest",
"test:cov": "vitest run --coverage"
```

- [ ] **Step 7: Verify the `npm test` script runs the whole suite green.** Run the package script (NOT bare `vitest`):
```bash
cd /d/aicode/pet && npm test
```
Expected: vitest does a single non-watch run, discovers `src/shared/smoke.test.ts`, prints `Test Files  1 passed (1)` / `Tests  1 passed (1)`, and exits 0.

- [ ] **Step 8: Commit the vitest setup and the passing smoke test.** Exact commands:
```bash
cd /d/aicode/pet && git add -A && git commit -m "$(cat <<'EOF'
test: add vitest config + scripts with a passing smoke test

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```
Expected: a commit adding `vitest.config.ts`, `src/shared/smoke.ts`, `src/shared/smoke.test.ts`, and the three `test*` scripts in `package.json`; `git status` clean.

---

### Task 1.7: Lock the contract folder structure with placeholder entries

**Files:**
- Create: `D:\aicode\pet\src\main\windows\.gitkeep` (locks `src/main/windows/` for petWindow/panelWindow/windowManager in later groups)
- Create: `D:\aicode\pet\src\renderer\src\pet\.gitkeep` (locks the pet route folder)
- Create: `D:\aicode\pet\src\renderer\src\panel\.gitkeep` (locks the panel route folder)
- Verify-only: `D:\aicode\pet\src\shared\` (already created in Task 1.5/1.6), `src\preload\` (scaffold), `src\main\` (scaffold)

- [ ] **Step 1: Create the empty contract subfolders that later groups fill, locking each with a placeholder.** These folders come from `fileStructure` (`src/main/windows/**`, `src/renderer/src/pet/**`, `src/renderer/src/panel/**`) and must exist now so the structure is fixed; this group does NOT implement any window, route, preload, or IPC code. Run:
```bash
mkdir -p /d/aicode/pet/src/main/windows /d/aicode/pet/src/renderer/src/pet /d/aicode/pet/src/renderer/src/panel && \
  touch /d/aicode/pet/src/main/windows/.gitkeep \
        /d/aicode/pet/src/renderer/src/pet/.gitkeep \
        /d/aicode/pet/src/renderer/src/panel/.gitkeep
```
Expected: the three `.gitkeep` files exist under the three new folders.

- [ ] **Step 2: Verify the full Plan-1 top-level structure is in place.** Confirm every structural directory now exists (created here or by earlier tasks/scaffold):
```bash
ls -d /d/aicode/pet/src/main /d/aicode/pet/src/main/windows /d/aicode/pet/src/preload /d/aicode/pet/src/renderer /d/aicode/pet/src/renderer/src /d/aicode/pet/src/renderer/src/pet /d/aicode/pet/src/renderer/src/panel /d/aicode/pet/src/shared
```
Expected: all eight directories print with no "No such file or directory" error.

- [ ] **Step 3: Re-run the test suite to confirm the new empty folders did not break discovery.** The vitest `include` globs (`src/shared/**`, `src/main/**`) now span the new `src/main/windows` folder, which holds only a `.gitkeep` (no `.test.ts`). Run:
```bash
cd /d/aicode/pet && npm test
```
Expected: still `Test Files  1 passed (1)` / `Tests  1 passed (1)`, exit 0 (vitest ignores non-test files; the lone smoke test still runs and passes).

- [ ] **Step 4: Commit the locked folder structure.** Exact commands:
```bash
cd /d/aicode/pet && git add -A && git commit -m "$(cat <<'EOF'
chore: lock contract folder structure with placeholders

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```
Expected: a commit adding the three `.gitkeep` files; `git status` clean. The repo is now runnable (`npm run dev`), test-green (`npm test`), and structurally locked — with no windows, routes, preload bridges, or IPC implemented yet (those belong to later task groups).

---

Confirmed: the repo has only README.md and no source code yet, matching the plan's premise. I have everything needed. Here is the complete corrected markdown for task group 2.

---

The repo is empty of code (no `src/` yet), which matches the research. Task Group 1 handles scaffolding; my group creates `src/shared/**` and `src/main/settingsStore.ts`. I have everything I need to write the tasks.

> **Shell note for ALL commit steps in this group:** the commit commands use multiple `-m` flags (`git commit -m '<subject>' -m '<trailer>'`) which behave identically in PowerShell and in the Bash tool (POSIX sh), so they are shell-agnostic. Do NOT rewrite them as `"$(cat <<'EOF' ... EOF)"` heredocs — that bash-only syntax is invalid in this environment's primary PowerShell shell. The `npx vitest run ...` commands are also shell-agnostic.

---

### Task 7.2: Modify electron.vite.config.ts for multi-window (panel preload + panel.html inputs, isolatedEntries, @shared alias)

**Files:**
- Modify: `D:\aicode\pet\electron.vite.config.ts` (scaffold base: single preload input, single renderer input, `@renderer` alias only)

This is build-config glue (cannot be meaningfully unit-tested); we verify by building and asserting the panel artifacts exist.

- [ ] **Step 1: Read the current scaffold config to anchor the edits**

Command:

```
npx --yes cat-cli@latest electron.vite.config.ts || sed -n '1,200p' electron.vite.config.ts
```

Expected: the verbatim `@quick-start/electron` react-ts config, roughly:

```ts
import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react()]
  }
})
```

- [ ] **Step 2: Replace the whole config with the multi-window version (full file, no placeholders)**

Overwrite `D:\aicode\pet\electron.vite.config.ts` with exactly:

```ts
import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    },
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    },
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        // Two DISTINCT input keys -> out/preload/index.js + out/preload/panel.js.
        // Never share one key across the two preloads.
        input: {
          index: resolve('src/preload/index.ts'),
          panel: resolve('src/preload/panel.ts')
        }
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react()],
    build: {
      // Fewer shared chunks across the two HTML entries.
      isolatedEntries: true,
      rollupOptions: {
        // Two HTML entries -> out/renderer/index.html + out/renderer/panel.html.
        input: {
          index: resolve('src/renderer/index.html'),
          panel: resolve('src/renderer/panel.html')
        }
      }
    }
  }
})
```

- [ ] **Step 3: Type-check the config and the project so far**

Command:

```
npx tsc --noEmit -p tsconfig.node.json
```

Expected: exits with code 0 and no output (the config is well-typed; `isolatedEntries` is a valid electron-vite renderer build option).

- [ ] **Step 4: Manual verification — confirm the config is consumed without runtime error**

This config's correctness is fully exercised by Task 7.3's build (which produces panel.html + panel.js) and by panelWindow.ts loading them. Here, just confirm electron-vite parses the config:

1. Run: `npx electron-vite build --outDir out`
2. EXPECTED: the build STARTS and prints `main`, `preload`, and `renderer` build phases without a config-parse error such as `Invalid input` or `Cannot find module`. If `src/preload/panel.ts` or `src/renderer/panel.html` do not exist yet (Tasks 7.4/7.5 create them), the build will fail at the bundling step with a clear `Could not resolve entry module "src/preload/panel.ts"` — that is the EXPECTED state until those files exist, and it confirms the config now references the panel inputs. After Tasks 7.4 and 7.5 land, this same command must succeed (verified in Task 7.4 Step 9).

- [ ] **Step 5: Commit**

```
git add electron.vite.config.ts && git commit -m "$(cat <<'EOF'
build: multi-window electron-vite config (panel preload + panel.html inputs, isolatedEntries, @shared alias)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2.1: Create the shared types module (electron-free single source of truth)

**Files:**
- Create: `D:\aicode\pet\src\shared\types.ts`
- Test: `D:\aicode\pet\src\shared\types.test.ts`

This module is pure type/const declarations (no logic to TDD), but a sanity test guards the union literals and that `DEFAULT_SETTINGS` will satisfy `Settings`. Write the file from the canonical contract verbatim, then a guard test.

- [ ] **Step 1: Create `src/shared/types.ts` exactly from the contract**

  Paste the canonical contract verbatim:

  ```ts
  // ============================================================================
  // src/shared/types.ts
  // Single source of truth for Plan 1 domain types. ELECTRON-FREE.
  // Importable by main, preload, renderer, and vitest without loading electron.
  // ============================================================================

  /**
   * Window position + size in screen DIP coordinates (matches Electron getBounds).
   * width/height are persisted so restore is robust even if defaults change.
   */
  export interface PetPosition {
    x: number
    y: number
    width: number
    height: number
  }

  /**
   * Plain data view of an Electron Display's usable area.
   * Passed into pure clamping logic so position.ts never imports electron.
   */
  export interface DisplayBounds {
    id: number
    /** Usable area excluding taskbar/dock/menubar (Electron Display.workArea). */
    workArea: { x: number; y: number; width: number; height: number }
  }

  /**
   * Mouse-passthrough lock mode, chosen from the tray.
   *  - 'auto'                : renderer hit-test drives interactivity (default).
   *  - 'locked-interactive'  : window is always interactive (never click-through).
   *  - 'locked-passthrough'  : window is always click-through (ignores the pet).
   */
  export type PassthroughMode =
    | 'auto'
    | 'locked-interactive'
    | 'locked-passthrough'

  export const PASSTHROUGH_MODES: readonly PassthroughMode[] = [
    'auto',
    'locked-interactive',
    'locked-passthrough'
  ] as const

  /**
   * User-facing settings persisted to userData/settings.json.
   * Keep flat + JSON-serializable. No functions, no Date objects.
   */
  export interface Settings {
    /** Schema version for forward-compatible migrations. */
    version: number
    /** Last known pet-window bounds, restored (clamped) on launch. */
    petPosition: PetPosition
    /** Current passthrough lock mode. */
    passthroughMode: PassthroughMode
    /** Whether the pet window is shown (toggled from tray). */
    petVisible: boolean
  }

  // ---------------------------------------------------------------------------
  // Tray menu model (pure, declarative). The main process maps this to
  // Electron's Menu.buildFromTemplate; the builder itself stays electron-free
  // and unit-testable.
  // ---------------------------------------------------------------------------

  /** Stable identifiers for tray menu actions (used as the click contract). */
  export type TrayItemId =
    | 'toggle-visibility'
    | 'mode-auto'
    | 'mode-locked-interactive'
    | 'mode-locked-passthrough'
    | 'reset-interaction'
    | 'open-panel'
    | 'quit'

  export interface TrayMenuItem {
    /** undefined id => separator. */
    id?: TrayItemId
    type: 'normal' | 'radio' | 'separator'
    label?: string
    /** For radio items: whether currently selected. */
    checked?: boolean
    enabled?: boolean
  }

  export type TrayMenuModel = TrayMenuItem[]

  /** Input snapshot the tray menu is rendered from. */
  export interface TrayMenuState {
    mode: PassthroughMode
    petVisible: boolean
  }

  // ---------------------------------------------------------------------------
  // IPC payload shapes (the typed wire contract). Channel NAME constants live in
  // src/shared/ipc.ts; these are the payload/response types referenced by both
  // the preload bridge and the main-process handlers.
  // ---------------------------------------------------------------------------

  export interface SetInteractivePayload {
    interactive: boolean
  }

  export interface SettingsChangedPayload {
    settings: Settings
  }

  export interface PassthroughModeChangedPayload {
    mode: PassthroughMode
  }
  ```

- [ ] **Step 2: Write the guard test `src/shared/types.test.ts`**

  This test asserts the runtime `PASSTHROUGH_MODES` array contents and shape, and uses a typed object literal (`const s: Settings = ...`) so the literal is structurally type-checked at compile time, with runtime assertions on a couple of fields. Full test code:

  ```ts
  import { describe, it, expect } from 'vitest'
  import {
    PASSTHROUGH_MODES,
    type PassthroughMode,
    type Settings,
    type TrayItemId
  } from './types'

  describe('shared/types', () => {
    it('PASSTHROUGH_MODES contains exactly the three modes in order', () => {
      expect(PASSTHROUGH_MODES).toEqual([
        'auto',
        'locked-interactive',
        'locked-passthrough'
      ])
    })

    it('PASSTHROUGH_MODES has no extra members', () => {
      expect(PASSTHROUGH_MODES).toHaveLength(3)
    })

    it('a value typed as PassthroughMode is one of the runtime modes', () => {
      const mode: PassthroughMode = 'auto'
      expect((PASSTHROUGH_MODES as readonly string[]).includes(mode)).toBe(true)
    })

    it('Settings is structurally constructable (compile + runtime guard)', () => {
      const s: Settings = {
        version: 1,
        petPosition: { x: 0, y: 0, width: 300, height: 300 },
        passthroughMode: 'auto',
        petVisible: true
      }
      expect(s.petPosition.width).toBe(300)
      expect(s.passthroughMode).toBe('auto')
    })

    it('every TrayItemId literal is a non-empty string', () => {
      const ids: TrayItemId[] = [
        'toggle-visibility',
        'mode-auto',
        'mode-locked-interactive',
        'mode-locked-passthrough',
        'reset-interaction',
        'open-panel',
        'quit'
      ]
      for (const id of ids) expect(id.length).toBeGreaterThan(0)
    })
  })
  ```

  Note: the `const s: Settings = {...}` literal is checked purely at compile time (TypeScript verifies the shape); the runtime `expect()`s only assert two field values. There is no `satisfies` operator here — a plain type annotation is the structural guard.

- [ ] **Step 3: Run the guard test — expect PASS**

  Command:

  ```
  npx vitest run src/shared/types.test.ts
  ```

  Expected output (default reporter), process exits 0:

  ```
   ✓ src/shared/types.test.ts (5 tests) ...ms
     Test Files  1 passed (1)
          Tests  5 passed (5)
  ```

  (This is a guard, not TDD, so it passes immediately. If it fails, the types file diverged from the contract — fix `types.ts`, do not edit the test.)

- [ ] **Step 4: Commit**

  Run via PowerShell or the Bash tool (the multiple-`-m` form works in both):

  ```
  git add src/shared/types.ts src/shared/types.test.ts
  git commit -m "Add shared domain types (Settings, PassthroughMode, TrayMenu, IPC payloads)" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 2.2: TDD `mergeSettings` + `DEFAULT_SETTINGS` (pure, fs-free, electron-free)

**Files:**
- Create: `D:\aicode\pet\src\shared\settings.ts`
- Test: `D:\aicode\pet\src\shared\settings.test.ts`

> **Re `validateSettings`:** the CONTRACT fileStructure prose mentions a `validateSettings` helper, but the canonical `settingsSchemaTS` source (pasted verbatim in Step 3 below) and the canonical Pure-logic function-signature list do NOT include a `validateSettings` export. The canonical source is authoritative, so this task intentionally does NOT implement `validateSettings`: `mergeSettings` already validates every field inline (invalid `passthroughMode` → default, non-finite/non-positive position fields → default, non-boolean `petVisible` → default), so a separate validator would be redundant. No code, test, or other Plan 1 module references `validateSettings`, so its absence breaks nothing. Do not add it.

- [ ] **Step 1: Write the failing test `src/shared/settings.test.ts` (full code)**

  ```ts
  import { describe, it, expect } from 'vitest'
  import {
    DEFAULT_SETTINGS,
    DEFAULT_PET_POSITION,
    SETTINGS_VERSION,
    mergeSettings
  } from './settings'
  import type { Settings } from './types'

  describe('DEFAULT_SETTINGS', () => {
    it('is a complete valid Settings with version, position, mode, visible', () => {
      expect(DEFAULT_SETTINGS.version).toBe(SETTINGS_VERSION)
      expect(DEFAULT_SETTINGS.passthroughMode).toBe('auto')
      expect(DEFAULT_SETTINGS.petVisible).toBe(true)
      expect(DEFAULT_SETTINGS.petPosition).toEqual(DEFAULT_PET_POSITION)
    })

    it('petPosition is a copy, not the same reference as DEFAULT_PET_POSITION', () => {
      expect(DEFAULT_SETTINGS.petPosition).not.toBe(DEFAULT_PET_POSITION)
    })
  })

  describe('mergeSettings', () => {
    it('returns a full defaults clone when partial is null', () => {
      expect(mergeSettings(DEFAULT_SETTINGS, null)).toEqual(DEFAULT_SETTINGS)
    })

    it('returns a full defaults clone when partial is undefined', () => {
      expect(mergeSettings(DEFAULT_SETTINGS, undefined)).toEqual(DEFAULT_SETTINGS)
    })

    it('returns a full defaults clone when partial is an empty object', () => {
      expect(mergeSettings(DEFAULT_SETTINGS, {})).toEqual(DEFAULT_SETTINGS)
    })

    it('does not mutate the defaults object', () => {
      const frozen = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as Settings
      mergeSettings(DEFAULT_SETTINGS, { petVisible: false })
      expect(DEFAULT_SETTINGS).toEqual(frozen)
    })

    it('overrides petVisible when a boolean is supplied', () => {
      expect(mergeSettings(DEFAULT_SETTINGS, { petVisible: false }).petVisible).toBe(false)
    })

    it('ignores a non-boolean petVisible and keeps the default', () => {
      const result = mergeSettings(DEFAULT_SETTINGS, {
        petVisible: 'yes' as unknown as boolean
      })
      expect(result.petVisible).toBe(true)
    })

    it('accepts a valid passthroughMode', () => {
      expect(
        mergeSettings(DEFAULT_SETTINGS, { passthroughMode: 'locked-passthrough' })
          .passthroughMode
      ).toBe('locked-passthrough')
    })

    it('clamps an invalid passthroughMode back to the default', () => {
      const result = mergeSettings(DEFAULT_SETTINGS, {
        passthroughMode: 'bogus' as unknown as Settings['passthroughMode']
      })
      expect(result.passthroughMode).toBe('auto')
    })

    it('deep-merges a partial petPosition (x/y override, width/height kept)', () => {
      const result = mergeSettings(DEFAULT_SETTINGS, {
        petPosition: { x: 500, y: 600 } as Settings['petPosition']
      })
      expect(result.petPosition).toEqual({
        x: 500,
        y: 600,
        width: DEFAULT_PET_POSITION.width,
        height: DEFAULT_PET_POSITION.height
      })
    })

    it('rejects non-finite position numbers and keeps the default for that field', () => {
      const result = mergeSettings(DEFAULT_SETTINGS, {
        petPosition: {
          x: NaN,
          y: Infinity,
          width: 400,
          height: 400
        } as Settings['petPosition']
      })
      expect(result.petPosition.x).toBe(DEFAULT_PET_POSITION.x)
      expect(result.petPosition.y).toBe(DEFAULT_PET_POSITION.y)
      expect(result.petPosition.width).toBe(400)
      expect(result.petPosition.height).toBe(400)
    })

    it('rejects zero/negative width and height, keeping defaults for those fields', () => {
      const result = mergeSettings(DEFAULT_SETTINGS, {
        petPosition: {
          x: 10,
          y: 20,
          width: 0,
          height: -50
        } as Settings['petPosition']
      })
      expect(result.petPosition.x).toBe(10)
      expect(result.petPosition.y).toBe(20)
      expect(result.petPosition.width).toBe(DEFAULT_PET_POSITION.width)
      expect(result.petPosition.height).toBe(DEFAULT_PET_POSITION.height)
    })

    it('ignores unknown keys entirely', () => {
      const result = mergeSettings(DEFAULT_SETTINGS, {
        somethingUnknown: 42,
        petVisible: false
      } as unknown as Partial<Settings>)
      expect(result).toEqual({ ...DEFAULT_SETTINGS, petVisible: false })
      expect((result as Record<string, unknown>).somethingUnknown).toBeUndefined()
    })

    it('preserves defaults.version even if partial supplies a different version', () => {
      const result = mergeSettings(DEFAULT_SETTINGS, {
        version: 999 as Settings['version']
      })
      expect(result.version).toBe(DEFAULT_SETTINGS.version)
    })
  })
  ```

- [ ] **Step 2: Run the test — expect FAIL (module not found)**

  Command:

  ```
  npx vitest run src/shared/settings.test.ts
  ```

  Expected FAIL — the import cannot resolve because `settings.ts` does not exist yet:

  ```
   FAIL  src/shared/settings.test.ts [ src/shared/settings.test.ts ]
  Error: Failed to load url ./settings (resolved id: .../src/shared/settings) ... Does the file exist?
     Test Files  1 failed (1)
  ```

  Process exits non-zero.

- [ ] **Step 3: Write the minimal implementation `src/shared/settings.ts` exactly from the contract**

  Paste the canonical `settingsSchemaTS` verbatim (no `validateSettings` — see the note at the top of this task):

  ```ts
  // ============================================================================
  // src/shared/settings.ts
  // DEFAULT_SETTINGS + pure merge/validate logic. ELECTRON-FREE, FS-FREE.
  // ============================================================================
  import {
    type Settings,
    type PassthroughMode,
    type PetPosition,
    PASSTHROUGH_MODES
  } from './types'

  /** Bumped only when the persisted Settings shape changes incompatibly. */
  export const SETTINGS_VERSION = 1

  /** Default pet-window bounds used on first launch (centered later by main). */
  export const DEFAULT_PET_POSITION: PetPosition = {
    x: 100,
    y: 100,
    width: 300,
    height: 300
  }

  export const DEFAULT_SETTINGS: Settings = {
    version: SETTINGS_VERSION,
    petPosition: { ...DEFAULT_PET_POSITION },
    passthroughMode: 'auto',
    petVisible: true
  }

  function isPassthroughMode(value: unknown): value is PassthroughMode {
    return (
      typeof value === 'string' &&
      (PASSTHROUGH_MODES as readonly string[]).includes(value)
    )
  }

  function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value)
  }

  /**
   * Deep-merge a partial (e.g. parsed JSON from disk, or an IPC patch) onto a
   * known-good defaults object. Unknown keys are ignored; invalid values fall
   * back to the default for that field. Always returns a complete, valid
   * Settings — never throws. Pure (no I/O).
   */
  export function mergeSettings(
    defaults: Settings,
    partial: Partial<Settings> | null | undefined
  ): Settings {
    const src = partial ?? {}

    const petPosition: PetPosition = { ...defaults.petPosition }
    const p = src.petPosition
    if (p && typeof p === 'object') {
      if (isFiniteNumber(p.x)) petPosition.x = p.x
      if (isFiniteNumber(p.y)) petPosition.y = p.y
      if (isFiniteNumber(p.width) && p.width > 0) petPosition.width = p.width
      if (isFiniteNumber(p.height) && p.height > 0) petPosition.height = p.height
    }

    return {
      version: defaults.version,
      petPosition,
      passthroughMode: isPassthroughMode(src.passthroughMode)
        ? src.passthroughMode
        : defaults.passthroughMode,
      petVisible:
        typeof src.petVisible === 'boolean'
          ? src.petVisible
          : defaults.petVisible
    }
  }
  ```

- [ ] **Step 4: Run the test — expect PASS**

  Command:

  ```
  npx vitest run src/shared/settings.test.ts
  ```

  Expected output, process exits 0:

  ```
   ✓ src/shared/settings.test.ts (15 tests) ...ms
     Test Files  1 passed (1)
          Tests  15 passed (15)
  ```

- [ ] **Step 5: Commit**

  Run via PowerShell or the Bash tool (the multiple-`-m` form works in both):

  ```
  git add src/shared/settings.ts src/shared/settings.test.ts
  git commit -m "Add DEFAULT_SETTINGS and pure mergeSettings with TDD coverage" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 2.3: TDD `clampPositionToDisplays` + `pickDisplayForPosition` (pure geometry, electron-free)

**Files:**
- Create: `D:\aicode\pet\src\shared\position.ts`
- Test: `D:\aicode\pet\src\shared\position.test.ts`

This test file contains exactly **14** `it()` blocks: 4 under `pickDisplayForPosition` (mostly-overlap, larger-overlap straddle, zero-overlap fallback, tie) and 10 under `clampPositionToDisplays` (throws-on-empty, on-screen unchanged, right edge, left edge, top edge, bottom edge, monitor-removed re-home, multi-display secondary, shrink width, shrink height). The expected PASS line therefore reads `14 tests` / `14 passed (14)`.

- [ ] **Step 1: Write the failing test `src/shared/position.test.ts` (full code)**

  ```ts
  import { describe, it, expect } from 'vitest'
  import { clampPositionToDisplays, pickDisplayForPosition } from './position'
  import type { DisplayBounds, PetPosition } from './types'

  // Primary display: 1920x1080 at origin (workArea height 1040 leaves a taskbar).
  const primary: DisplayBounds = {
    id: 1,
    workArea: { x: 0, y: 0, width: 1920, height: 1040 }
  }
  // Secondary display to the right: 1280x1024 starting at x=1920.
  const secondary: DisplayBounds = {
    id: 2,
    workArea: { x: 1920, y: 0, width: 1280, height: 1024 }
  }

  const pos = (
    x: number,
    y: number,
    width = 300,
    height = 300
  ): PetPosition => ({ x, y, width, height })

  describe('pickDisplayForPosition', () => {
    it('picks the display the window mostly overlaps', () => {
      const p = pos(2000, 100) // fully inside secondary
      expect(pickDisplayForPosition(p, [primary, secondary]).id).toBe(2)
    })

    it('picks the display with the larger overlap when straddling two', () => {
      // window x=1820..2120 (width 300): 100px on primary, 200px on secondary
      const p = pos(1820, 100)
      expect(pickDisplayForPosition(p, [primary, secondary]).id).toBe(2)
    })

    it('falls back to displays[0] when there is zero overlap', () => {
      const p = pos(5000, 5000) // off all displays
      expect(pickDisplayForPosition(p, [primary, secondary]).id).toBe(1)
    })

    it('resolves a tie to displays[0]', () => {
      // x=1770..2070 width 300: 150px on primary, 150px on secondary -> tie -> displays[0]
      const p = pos(1770, 100)
      expect(pickDisplayForPosition(p, [primary, secondary]).id).toBe(1)
    })
  })

  describe('clampPositionToDisplays', () => {
    it('throws when displays is empty', () => {
      expect(() => clampPositionToDisplays(pos(0, 0), [])).toThrow()
    })

    it('leaves a fully on-screen position unchanged', () => {
      const p = pos(100, 100)
      expect(clampPositionToDisplays(p, [primary])).toEqual(p)
    })

    it('clamps a window hanging off the right edge back inside', () => {
      // x=1800 width 300 -> right edge 2100 > 1920; clamp x to 1920-300 = 1620
      const result = clampPositionToDisplays(pos(1800, 100), [primary])
      expect(result.x).toBe(1620)
      expect(result.y).toBe(100)
      expect(result.width).toBe(300)
      expect(result.height).toBe(300)
    })

    it('clamps a window hanging off the left edge to workArea.x', () => {
      const result = clampPositionToDisplays(pos(-50, 100), [primary])
      expect(result.x).toBe(0)
    })

    it('clamps a window hanging off the top edge to workArea.y', () => {
      const result = clampPositionToDisplays(pos(100, -80), [primary])
      expect(result.y).toBe(0)
    })

    it('clamps a window hanging off the bottom edge back inside', () => {
      // y=900 height 300 -> bottom 1200 > 1040; clamp y to 1040-300 = 740
      const result = clampPositionToDisplays(pos(100, 900), [primary])
      expect(result.y).toBe(740)
    })

    it('re-homes an off-screen window onto displays[0] (monitor removed)', () => {
      // Saved on a now-removed monitor at x=2500; only primary remains.
      const result = clampPositionToDisplays(pos(2500, 100), [primary])
      expect(result.x).toBeGreaterThanOrEqual(0)
      expect(result.x).toBeLessThanOrEqual(1920 - 300)
      expect(result.y).toBe(100)
    })

    it('clamps onto the chosen secondary display in a multi-display setup', () => {
      // mostly on secondary but hanging off its right edge
      const result = clampPositionToDisplays(pos(3100, 100), [primary, secondary])
      // secondary right limit: 1920 + 1280 - 300 = 2900
      expect(result.x).toBe(2900)
      expect(result.y).toBe(100)
    })

    it('shrinks width to fit when it exceeds the chosen workArea', () => {
      const result = clampPositionToDisplays(pos(0, 0, 5000, 300), [primary])
      expect(result.width).toBe(1920)
      expect(result.x).toBe(0)
    })

    it('shrinks height to fit when it exceeds the chosen workArea', () => {
      const result = clampPositionToDisplays(pos(0, 0, 300, 5000), [primary])
      expect(result.height).toBe(1040)
      expect(result.y).toBe(0)
    })
  })
  ```

- [ ] **Step 2: Run the test — expect FAIL (module not found)**

  Command:

  ```
  npx vitest run src/shared/position.test.ts
  ```

  Expected FAIL — `position.ts` does not exist:

  ```
   FAIL  src/shared/position.test.ts [ src/shared/position.test.ts ]
  Error: Failed to load url ./position (resolved id: .../src/shared/position) ... Does the file exist?
     Test Files  1 failed (1)
  ```

  Process exits non-zero.

- [ ] **Step 3: Write the minimal implementation `src/shared/position.ts` (full code, signatures per contract)**

  ```ts
  // ============================================================================
  // src/shared/position.ts
  // Pure geometry: clamp a pet window into connected display work areas.
  // ELECTRON-FREE. Takes DisplayBounds[] as plain data.
  // ============================================================================
  import type { DisplayBounds, PetPosition } from './types'

  interface Rect {
    x: number
    y: number
    width: number
    height: number
  }

  /** Area of the rectangular intersection of two rects (0 if disjoint). */
  function overlapArea(a: Rect, b: Rect): number {
    const left = Math.max(a.x, b.x)
    const right = Math.min(a.x + a.width, b.x + b.width)
    const top = Math.max(a.y, b.y)
    const bottom = Math.min(a.y + a.height, b.y + b.height)
    const w = right - left
    const h = bottom - top
    if (w <= 0 || h <= 0) return 0
    return w * h
  }

  /**
   * Returns the DisplayBounds whose workArea has the largest rectangular overlap
   * with pos. Ties and zero-overlap resolve to displays[0]. Pure.
   */
  export function pickDisplayForPosition(
    pos: PetPosition,
    displays: DisplayBounds[]
  ): DisplayBounds {
    let best = displays[0]
    let bestArea = overlapArea(pos, displays[0].workArea)
    for (let i = 1; i < displays.length; i++) {
      const area = overlapArea(pos, displays[i].workArea)
      if (area > bestArea) {
        best = displays[i]
        bestArea = area
      }
    }
    return best
  }

  /**
   * Returns a PetPosition guaranteed fully visible within the workArea of one
   * connected display. Picks the most-overlapping display (displays[0] if none
   * overlap), shrinks width/height to fit if they exceed the workArea, then
   * clamps x/y so the whole window sits inside. Throws if displays is empty.
   * Pure.
   */
  export function clampPositionToDisplays(
    pos: PetPosition,
    displays: DisplayBounds[]
  ): PetPosition {
    if (displays.length === 0) {
      throw new Error('clampPositionToDisplays: displays must not be empty')
    }

    const wa = pickDisplayForPosition(pos, displays).workArea

    const width = Math.min(pos.width, wa.width)
    const height = Math.min(pos.height, wa.height)

    const maxX = wa.x + wa.width - width
    const maxY = wa.y + wa.height - height

    const x = Math.min(Math.max(pos.x, wa.x), maxX)
    const y = Math.min(Math.max(pos.y, wa.y), maxY)

    return { x, y, width, height }
  }
  ```

- [ ] **Step 4: Run the test — expect PASS**

  Command:

  ```
  npx vitest run src/shared/position.test.ts
  ```

  Expected output, process exits 0:

  ```
   ✓ src/shared/position.test.ts (14 tests) ...ms
     Test Files  1 passed (1)
          Tests  14 passed (14)
  ```

- [ ] **Step 5: Commit**

  Run via PowerShell or the Bash tool (the multiple-`-m` form works in both):

  ```
  git add src/shared/position.ts src/shared/position.test.ts
  git commit -m "Add pure clampPositionToDisplays and pickDisplayForPosition with TDD" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 5.1: TDD the pure `debounce` helper used to persist position

**Files:**
- Create: `D:\aicode\pet\src\shared\debounce.ts`
- Test: `D:\aicode\pet\src\shared\debounce.test.ts`

- [ ] **Step 1: Write the failing test for `debounce`**

  Create `D:\aicode\pet\src\shared\debounce.test.ts` with the full test code below. It uses `vi.useFakeTimers()` so no real time elapses.

  ```ts
  import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
  import { debounce } from './debounce'

  describe('debounce', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.restoreAllMocks()
      vi.useRealTimers()
    })

    it('does not call fn before waitMs elapses', () => {
      const fn = vi.fn()
      const d = debounce(fn, 200)
      d()
      expect(fn).not.toHaveBeenCalled()
      vi.advanceTimersByTime(199)
      expect(fn).not.toHaveBeenCalled()
    })

    it('calls fn exactly once after waitMs elapses (trailing edge)', () => {
      const fn = vi.fn()
      const d = debounce(fn, 200)
      d()
      vi.advanceTimersByTime(200)
      expect(fn).toHaveBeenCalledTimes(1)
    })

    it('coalesces rapid calls into a single trailing call', () => {
      const fn = vi.fn()
      const d = debounce(fn, 200)
      d()
      vi.advanceTimersByTime(50)
      d()
      vi.advanceTimersByTime(50)
      d()
      vi.advanceTimersByTime(199)
      expect(fn).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1)
      expect(fn).toHaveBeenCalledTimes(1)
    })

    it('invokes fn with the LAST args (last call wins)', () => {
      const fn = vi.fn<(a: number, b: string) => void>()
      const d = debounce(fn, 100)
      d(1, 'a')
      d(2, 'b')
      d(3, 'c')
      vi.advanceTimersByTime(100)
      expect(fn).toHaveBeenCalledTimes(1)
      expect(fn).toHaveBeenCalledWith(3, 'c')
    })

    it('cancel() drops a pending call', () => {
      const fn = vi.fn()
      const d = debounce(fn, 100)
      d()
      d.cancel()
      vi.advanceTimersByTime(100)
      expect(fn).not.toHaveBeenCalled()
    })

    it('flush() invokes a pending call immediately with the last args', () => {
      const fn = vi.fn<(a: number) => void>()
      const d = debounce(fn, 100)
      d(7)
      d(9)
      d.flush()
      expect(fn).toHaveBeenCalledTimes(1)
      expect(fn).toHaveBeenCalledWith(9)
      // flushing consumes the pending call: no second invocation on timer
      vi.advanceTimersByTime(100)
      expect(fn).toHaveBeenCalledTimes(1)
    })

    it('flush() with no pending call does nothing', () => {
      const fn = vi.fn()
      const d = debounce(fn, 100)
      d.flush()
      expect(fn).not.toHaveBeenCalled()
    })

    it('cancel() with no pending call is a no-op', () => {
      const fn = vi.fn()
      const d = debounce(fn, 100)
      expect(() => d.cancel()).not.toThrow()
      vi.advanceTimersByTime(100)
      expect(fn).not.toHaveBeenCalled()
    })

    it('re-arms after firing (a later call schedules a fresh trailing call)', () => {
      const fn = vi.fn()
      const d = debounce(fn, 100)
      d()
      vi.advanceTimersByTime(100)
      expect(fn).toHaveBeenCalledTimes(1)
      d()
      vi.advanceTimersByTime(100)
      expect(fn).toHaveBeenCalledTimes(2)
    })
  })
  ```

- [ ] **Step 2: Run the test and confirm it FAILS**

  Command:
  ```
  npx vitest run src/shared/debounce.test.ts
  ```

  Expected: the run FAILS at module resolution because `./debounce` does not export anything yet. Expected error message contains:
  ```
  Failed to resolve import "./debounce" from "src/shared/debounce.test.ts"
  ```
  (or `No "debounce" export is defined on the "./debounce" module`). Tests do not pass.

- [ ] **Step 3: Write the minimal implementation of `debounce`**

  Create `D:\aicode\pet\src\shared\debounce.ts` with the full code below. Electron-free, uses only `setTimeout`/`clearTimeout`. Trailing-edge, last-args-win, with `cancel`/`flush`.

  ```ts
  // ============================================================================
  // src/shared/debounce.ts
  // Pure trailing-edge debounce factory. ELECTRON-FREE.
  // Used by the persist-position logic in src/main/dragController.ts and
  // unit-tested with vi.useFakeTimers().
  // ============================================================================

  /**
   * A debounced wrapper around `fn`. Calling it delays `fn` until `waitMs`
   * milliseconds elapse since the most recent call (the last args win).
   *  - cancel(): drop any pending call without invoking fn.
   *  - flush():  if a call is pending, invoke fn immediately with the last args.
   * Trailing-edge only. Pure (setTimeout/clearTimeout only).
   */
  export function debounce<A extends unknown[]>(
    fn: (...args: A) => void,
    waitMs: number
  ): { (...args: A): void; cancel(): void; flush(): void } {
    let timer: ReturnType<typeof setTimeout> | null = null
    let pendingArgs: A | null = null

    const debounced = (...args: A): void => {
      pendingArgs = args
      if (timer !== null) {
        clearTimeout(timer)
      }
      timer = setTimeout(() => {
        timer = null
        const callArgs = pendingArgs as A
        pendingArgs = null
        fn(...callArgs)
      }, waitMs)
    }

    debounced.cancel = (): void => {
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
      pendingArgs = null
    }

    debounced.flush = (): void => {
      if (timer === null) {
        return
      }
      clearTimeout(timer)
      timer = null
      const callArgs = pendingArgs as A
      pendingArgs = null
      fn(...callArgs)
    }

    return debounced
  }
  ```

- [ ] **Step 4: Run the test and confirm it PASSES**

  Command:
  ```
  npx vitest run src/shared/debounce.test.ts
  ```

  Expected output includes:
  ```
  ✓ src/shared/debounce.test.ts (9 tests)
  Test Files  1 passed (1)
       Tests  9 passed (9)
  ```

- [ ] **Step 5: Commit**

  Command:
  ```
  git add src/shared/debounce.ts src/shared/debounce.test.ts && git commit -m "Add pure debounce helper for position persistence (TDD)"
  ```

---

### Task 4.1: TDD the pure `resolveIgnoreMouse` passthrough state machine

**Files:**
- Create: `D:\aicode\pet\src\shared\passthrough.ts`
- Test: `D:\aicode\pet\src\shared\passthrough.test.ts`

- [ ] **Step 1: Write the failing test file**

  Create `D:\aicode\pet\src\shared\passthrough.test.ts` with the full test covering all three `PassthroughMode` branches against both `overInteractive` values:

  ```ts
  import { describe, it, expect } from 'vitest'
  import { resolveIgnoreMouse } from './passthrough'
  import { PASSTHROUGH_MODES, type PassthroughMode } from './types'

  describe('resolveIgnoreMouse', () => {
    describe("mode 'locked-interactive'", () => {
      it('returns false (never ignore) when cursor is over interactive', () => {
        expect(resolveIgnoreMouse('locked-interactive', true)).toBe(false)
      })
      it('returns false (never ignore) when cursor is NOT over interactive', () => {
        expect(resolveIgnoreMouse('locked-interactive', false)).toBe(false)
      })
    })

    describe("mode 'locked-passthrough'", () => {
      it('returns true (always ignore) when cursor is over interactive', () => {
        expect(resolveIgnoreMouse('locked-passthrough', true)).toBe(true)
      })
      it('returns true (always ignore) when cursor is NOT over interactive', () => {
        expect(resolveIgnoreMouse('locked-passthrough', false)).toBe(true)
      })
    })

    describe("mode 'auto'", () => {
      it('returns false (interactive) when cursor IS over interactive', () => {
        expect(resolveIgnoreMouse('auto', true)).toBe(false)
      })
      it('returns true (click-through) when cursor is NOT over interactive', () => {
        expect(resolveIgnoreMouse('auto', false)).toBe(true)
      })
    })

    it('covers every PassthroughMode literal without throwing', () => {
      for (const mode of PASSTHROUGH_MODES) {
        const m: PassthroughMode = mode
        expect(typeof resolveIgnoreMouse(m, true)).toBe('boolean')
        expect(typeof resolveIgnoreMouse(m, false)).toBe('boolean')
      }
    })
  })
  ```

- [ ] **Step 2: Run the test and confirm it FAILS**

  Command:
  ```
  npx vitest run src/shared/passthrough.test.ts
  ```
  Expected: the run FAILS to collect with an error like `Failed to resolve import "./passthrough"` / `Cannot find module './passthrough'` (the implementation file does not exist yet). No tests pass.

- [ ] **Step 3: Write the minimal implementation**

  Create `D:\aicode\pet\src\shared\passthrough.ts`:

  ```ts
  // ============================================================================
  // src/shared/passthrough.ts
  // Pure passthrough state machine. ELECTRON-FREE, no side effects.
  // ============================================================================
  import { type PassthroughMode } from './types'

  /**
   * Decide the `ignore` boolean to feed
   * win.setIgnoreMouseEvents(ignore, { forward: true }).
   *
   *  - 'locked-interactive' -> false : window always interactive, never click-through.
   *  - 'locked-passthrough' -> true  : window always click-through (ignores the pet).
   *  - 'auto'               -> ignore = !overInteractive : interactive only when the
   *                            cursor is over a solid pet pixel / interactive UI.
   *
   * Pure: no electron, no I/O, no mutation.
   */
  export function resolveIgnoreMouse(
    mode: PassthroughMode,
    overInteractive: boolean
  ): boolean {
    switch (mode) {
      case 'locked-interactive':
        return false
      case 'locked-passthrough':
        return true
      case 'auto':
        return !overInteractive
      default: {
        // Exhaustiveness guard: if PassthroughMode gains a member this errors at
        // compile time. At runtime fall back to the safest interactive state.
        const _exhaustive: never = mode
        void _exhaustive
        return false
      }
    }
  }
  ```

- [ ] **Step 4: Run the test and confirm it PASSES**

  Command:
  ```
  npx vitest run src/shared/passthrough.test.ts
  ```
  Expected: `Test Files  1 passed (1)` and `Tests  7 passed (7)`. Exit code 0.

- [ ] **Step 5: Commit**

  ```
  git add src/shared/passthrough.ts src/shared/passthrough.test.ts
  git commit -m "feat(shared): add pure resolveIgnoreMouse passthrough state machine

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 6.1: TDD the pure `buildTrayMenuModel(state)` builder

**Files:**
- Create: `D:\aicode\pet\src\shared\trayMenu.ts`
- Test: `D:\aicode\pet\src\shared\trayMenu.test.ts`
- (Depends on, already created by an earlier group) `D:\aicode\pet\src\shared\types.ts` — uses `TrayMenuModel`, `TrayMenuItem`, `TrayMenuState`, `TrayItemId`, `PassthroughMode`.

- [ ] **Step 1: Write the failing test file**

  Write `D:\aicode\pet\src\shared\trayMenu.test.ts` with this exact content:

  ```ts
  import { describe, it, expect } from 'vitest'
  import { buildTrayMenuModel } from './trayMenu'
  import type { TrayMenuState, TrayItemId } from './types'

  function idsOf(model: ReturnType<typeof buildTrayMenuModel>): (TrayItemId | undefined)[] {
    return model.map((item) => item.id)
  }

  describe('buildTrayMenuModel', () => {
    const baseAuto: TrayMenuState = { mode: 'auto', petVisible: true }

    it('produces items in the canonical order with separators', () => {
      const model = buildTrayMenuModel(baseAuto)
      expect(idsOf(model)).toEqual([
        'toggle-visibility',
        undefined, // separator
        'mode-auto',
        'mode-locked-interactive',
        'mode-locked-passthrough',
        'reset-interaction',
        undefined, // separator
        'open-panel',
        undefined, // separator
        'quit'
      ])
    })

    it('labels toggle-visibility "Hide Pet" when the pet is visible', () => {
      const model = buildTrayMenuModel({ mode: 'auto', petVisible: true })
      const toggle = model.find((i) => i.id === 'toggle-visibility')
      expect(toggle?.label).toBe('Hide Pet')
      expect(toggle?.type).toBe('normal')
    })

    it('labels toggle-visibility "Show Pet" when the pet is hidden', () => {
      const model = buildTrayMenuModel({ mode: 'auto', petVisible: false })
      const toggle = model.find((i) => i.id === 'toggle-visibility')
      expect(toggle?.label).toBe('Show Pet')
    })

    it('marks the three mode items as radio type', () => {
      const model = buildTrayMenuModel(baseAuto)
      for (const id of ['mode-auto', 'mode-locked-interactive', 'mode-locked-passthrough'] as const) {
        const item = model.find((i) => i.id === id)
        expect(item?.type).toBe('radio')
      }
    })

    it('checks exactly the mode item matching state.mode (auto)', () => {
      const model = buildTrayMenuModel({ mode: 'auto', petVisible: true })
      expect(model.find((i) => i.id === 'mode-auto')?.checked).toBe(true)
      expect(model.find((i) => i.id === 'mode-locked-interactive')?.checked).toBe(false)
      expect(model.find((i) => i.id === 'mode-locked-passthrough')?.checked).toBe(false)
    })

    it('checks exactly the mode item matching state.mode (locked-passthrough)', () => {
      const model = buildTrayMenuModel({ mode: 'locked-passthrough', petVisible: true })
      expect(model.find((i) => i.id === 'mode-auto')?.checked).toBe(false)
      expect(model.find((i) => i.id === 'mode-locked-interactive')?.checked).toBe(false)
      expect(model.find((i) => i.id === 'mode-locked-passthrough')?.checked).toBe(true)
    })

    it('checks exactly the mode item matching state.mode (locked-interactive)', () => {
      const model = buildTrayMenuModel({ mode: 'locked-interactive', petVisible: false })
      expect(model.find((i) => i.id === 'mode-auto')?.checked).toBe(false)
      expect(model.find((i) => i.id === 'mode-locked-interactive')?.checked).toBe(true)
      expect(model.find((i) => i.id === 'mode-locked-passthrough')?.checked).toBe(false)
    })

    it('gives reset-interaction, open-panel and quit normal type and stable labels', () => {
      const model = buildTrayMenuModel(baseAuto)
      expect(model.find((i) => i.id === 'reset-interaction')).toMatchObject({
        type: 'normal',
        label: 'Reset Interaction'
      })
      expect(model.find((i) => i.id === 'open-panel')).toMatchObject({
        type: 'normal',
        label: 'Open Panel'
      })
      expect(model.find((i) => i.id === 'quit')).toMatchObject({
        type: 'normal',
        label: 'Quit'
      })
    })

    it('gives every separator type "separator" and no id', () => {
      const model = buildTrayMenuModel(baseAuto)
      const separators = model.filter((i) => i.type === 'separator')
      expect(separators).toHaveLength(3)
      for (const sep of separators) {
        expect(sep.id).toBeUndefined()
      }
    })

    it('labels the three mode radios with human-readable text', () => {
      const model = buildTrayMenuModel(baseAuto)
      expect(model.find((i) => i.id === 'mode-auto')?.label).toBe('Auto (hit-test)')
      expect(model.find((i) => i.id === 'mode-locked-interactive')?.label).toBe('Always Interactive')
      expect(model.find((i) => i.id === 'mode-locked-passthrough')?.label).toBe('Always Click-through')
    })
  })
  ```

- [ ] **Step 2: Run the test and confirm it FAILS**

  Precondition: `src/shared/types.ts` (exporting `TrayMenuState`, `TrayItemId`, `TrayMenuModel`, `TrayMenuItem`, `PassthroughMode`) MUST already exist from the earlier group. The ONLY missing module on this run is `./trayMenu`, hence the failure is specifically `Cannot find module './trayMenu'` (NOT a failure resolving `./types`). If you instead see an error about `./types`, stop and create `src/shared/types.ts` from the earlier group before continuing — this step's signal is only valid when `./trayMenu` is the sole missing import.

  Command:
  ```
  npx vitest run src/shared/trayMenu.test.ts
  ```
  Expected: the run FAILS at module resolution with a message like `Error: Failed to load url ./trayMenu` or `Cannot find module './trayMenu'` (the file does not exist yet). No tests pass.

- [ ] **Step 3: Write the minimal implementation**

  Write `D:\aicode\pet\src\shared\trayMenu.ts` with this exact content:

  ```ts
  // ============================================================================
  // src/shared/trayMenu.ts
  // Pure, declarative tray-menu model builder. ELECTRON-FREE.
  // The main process maps the returned TrayMenuModel to Menu.buildFromTemplate;
  // this builder stays electron-free and unit-testable.
  // ============================================================================
  import type {
    TrayMenuModel,
    TrayMenuItem,
    TrayMenuState,
    PassthroughMode
  } from './types'

  function separator(): TrayMenuItem {
    return { type: 'separator' }
  }

  function modeRadio(
    id: Extract<
      TrayMenuItem['id'],
      'mode-auto' | 'mode-locked-interactive' | 'mode-locked-passthrough'
    >,
    label: string,
    mode: PassthroughMode,
    current: PassthroughMode
  ): TrayMenuItem {
    return { id, type: 'radio', label, checked: mode === current }
  }

  /**
   * Build the declarative tray menu model for the given app state.
   * Order (stable, click handlers bind by id):
   *   toggle-visibility, ─, mode-auto, mode-locked-interactive,
   *   mode-locked-passthrough, reset-interaction, ─, open-panel, ─, quit
   * Pure: no electron, no side effects.
   */
  export function buildTrayMenuModel(state: TrayMenuState): TrayMenuModel {
    return [
      {
        id: 'toggle-visibility',
        type: 'normal',
        label: state.petVisible ? 'Hide Pet' : 'Show Pet'
      },
      separator(),
      modeRadio('mode-auto', 'Auto (hit-test)', 'auto', state.mode),
      modeRadio(
        'mode-locked-interactive',
        'Always Interactive',
        'locked-interactive',
        state.mode
      ),
      modeRadio(
        'mode-locked-passthrough',
        'Always Click-through',
        'locked-passthrough',
        state.mode
      ),
      { id: 'reset-interaction', type: 'normal', label: 'Reset Interaction' },
      separator(),
      { id: 'open-panel', type: 'normal', label: 'Open Panel' },
      separator(),
      { id: 'quit', type: 'normal', label: 'Quit' }
    ]
  }
  ```

- [ ] **Step 4: Run the test and confirm it PASSES**

  Command:
  ```
  npx vitest run src/shared/trayMenu.test.ts
  ```
  Expected: all tests pass, e.g. `Test Files  1 passed (1)` and `Tests  10 passed (10)`. Exit code 0.

- [ ] **Step 5: Commit**

  Command:
  ```
  git add src/shared/trayMenu.ts src/shared/trayMenu.test.ts && git commit -m "feat(shared): pure buildTrayMenuModel tray menu builder (TDD)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 4.2: Author the canonical `src/shared/ipc.ts` (IPC channel constants + `RendererApi` + `PanelApi`)

**Files:**
- Create: `D:\aicode\pet\src\shared\ipc.ts` (the SINGLE base author of the full `@shared/ipc` surface: the `IPC` channel-name constants, `IpcChannel`/`Unsubscribe` aliases, the `RendererApi` pet-window contextBridge interface, and the `PanelApi` panel-window contextBridge interface). No other task re-authors this file; extenders (4.4, 5.3) only consume it.

- [ ] **Step 1: Create `src/shared/ipc.ts` with the full canonical surface**

  This task is the BASE author of `src/shared/ipc.ts` — write the file in full, exactly once. Do NOT add conditional "if a prior group already created it" branches: no earlier task touches this file, and later tasks (4.4 adds `setInteractive`/`onPassthroughModeChanged` usage in the preload, 5.3 adds `drag.*` usage) consume this surface rather than re-author it.

  Create `D:\aicode\pet\src\shared\ipc.ts` with exactly this content:

  ```ts
  // ============================================================================
  // src/shared/ipc.ts
  // Canonical IPC channel name constants + the contextBridge surfaces.
  // ELECTRON-FREE: string constants and interfaces only (no runtime electron).
  // Pet window exposes RendererApi as window.petApi; panel window exposes the
  // strict PanelApi subset as window.panelApi.
  // ============================================================================
  import {
    type Settings,
    type PassthroughModeChangedPayload
  } from './types'

  export const IPC = {
    PET_SET_INTERACTIVE: 'pet:setInteractive',
    PET_DRAG_START: 'pet:drag-start',
    PET_DRAG_MOVE: 'pet:drag-move',
    PET_DRAG_END: 'pet:drag-end',
    PET_OPEN_PANEL: 'pet:open-panel',
    PET_PASSTHROUGH_MODE_CHANGED: 'pet:passthrough-mode-changed',
    SETTINGS_GET: 'settings:get',
    SETTINGS_SET: 'settings:set',
    SETTINGS_CHANGED: 'settings:changed'
  } as const

  export type IpcChannel = (typeof IPC)[keyof typeof IPC]

  /** Unsubscribe function returned by every on*() listener registration. */
  export type Unsubscribe = () => void

  /**
   * The exact surface exposed on the pet window as window.petApi.
   * Renderer code calls these; it must NEVER import 'electron' directly.
   * onSettingsChanged forwards the UNWRAPPED Settings (the preload unwraps
   * the { settings } broadcast payload before invoking cb).
   */
  export interface RendererApi {
    /** Report the hit-test result (cursor over a solid pet pixel / UI). */
    setInteractive(interactive: boolean): void
    drag: {
      start(): void
      move(): void
      end(): void
    }
    openPanel(): void
    getSettings(): Promise<Settings>
    setSettings(patch: Partial<Settings>): Promise<Settings>
    onSettingsChanged(cb: (settings: Settings) => void): Unsubscribe
    onPassthroughModeChanged(
      cb: (payload: PassthroughModeChangedPayload) => void
    ): Unsubscribe
  }

  /**
   * The strict panel-window subset exposed as window.panelApi.
   * NO drag, NO passthrough, NO openPanel. Same unwrapped onSettingsChanged
   * shape as RendererApi.
   */
  export interface PanelApi {
    getSettings(): Promise<Settings>
    setSettings(patch: Partial<Settings>): Promise<Settings>
    onSettingsChanged(cb: (settings: Settings) => void): Unsubscribe
  }
  ```

- [ ] **Step 2: Confirm `src/shared/ipc.ts` actually typechecks (do NOT rely on tsconfig.node.json)**

  `src/shared/ipc.ts` has no importer in the node/main project at this point (the `@shared/passthrough` controller comes in Task 4.3, the `@shared/ipc` importer in Task 4.4). Because `tsc -p <config>` only checks files in that config's `include` plus their import graph, and the scaffold's `tsconfig.node.json` `include` is `electron.vite.config.*` + `src/main/**` + `src/preload/**` and does NOT list `src/shared/**`, running `tsc -p tsconfig.node.json` here would NOT type-check `ipc.ts` at all and would pass vacuously. Instead, type-check the file directly via the vitest typecheck path (the `vitest.config.ts` `include` covers `src/shared/**`, and its `@shared` alias mirrors the tsconfig), using a one-off config that explicitly includes only this file:

  Command:
  ```
  npx tsc --noEmit --strict --esModuleInterop --moduleResolution bundler --module esnext --target es2022 src/shared/ipc.ts src/shared/types.ts
  ```
  Expected: exit code 0 with NO diagnostics. (`types.ts` is passed alongside because `ipc.ts` imports its types; `--moduleResolution bundler` lets the relative `./types` import resolve without `.js` extensions, matching the electron-vite/vitest resolver. No `@shared/*` alias is needed here because `ipc.ts` only uses the relative `./types` import.)

  If you prefer a config-driven check, first confirm `src/shared/**` is in the active project: run `npx tsc --noEmit -p tsconfig.web.json`, whose scaffold `include` covers `src/renderer/**` and (with the `@shared` path alias) pulls `src/shared/ipc.ts` into the graph once a renderer file imports it — but since no renderer file imports `ipc.ts` yet at Task 4.2 either, the explicit single-file command above is the authoritative check for THIS task. Expected: exit code 0.

- [ ] **Step 3: Commit**

  ```
  git add src/shared/ipc.ts
  git commit -m "feat(shared): author canonical IPC channels, RendererApi, and PanelApi

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 2.4: Implement the hand-rolled JSON `SettingsStore` over fs (electron path injected) with a tmp-dir test

**Files:**
- Create: `D:\aicode\pet\src\main\settingsStore.ts`
- Test: `D:\aicode\pet\src\main\settingsStore.test.ts`

The store keeps file I/O thin and delegates merge/validation to `mergeSettings`. It receives `userDataDir` as a string param (NOT `app.getPath`) so the test imports it WITHOUT loading electron. Per the contract this lives at `src/main/settingsStore.ts` and the vitest `include` glob covers `src/main/**/*.{test,spec}.ts`.

> **Important — `set()` lazily loads once to avoid clobbering disk:** `set()` deep-merges its patch onto the *current loaded state*. To guarantee that calling `set()` before `load()` cannot silently overwrite an existing on-disk `settings.json` (e.g. a previously-saved `petPosition`), the store tracks a `loaded` flag and performs a one-time `load()` on the first `set()` if `load()` was never called. This makes the store correct regardless of glue call order; `src/main/index.ts` should still call `store.load()` at startup, but correctness no longer depends on it. A dedicated regression test (below) locks this behavior in. This test file has exactly **12** `it()` blocks.

- [ ] **Step 0: Precondition — confirm the `@shared` alias exists in `vitest.config.ts` (Task Group 1 deliverable)**

  This test imports `DEFAULT_SETTINGS` from `@shared/settings`, and `settingsStore.ts` imports from `@shared/settings` / `@shared/types`. Those bare-specifier imports only resolve if Task Group 1 has already added the `@shared` alias to `vitest.config.ts`. Verify it is present BEFORE running the test so the Step 2 failure is the deterministic `./settingsStore` module-not-found (and not an `@shared` resolution error):

  Command (Bash tool, POSIX sh):

  ```
  grep -n "@shared" vitest.config.ts
  ```

  Expected: at least one line showing the alias mapping, e.g.:

  ```
  12:      '@shared': resolve(__dirname, 'src/shared'),
  ```

  If `vitest.config.ts` does not exist or the `@shared` line is absent, STOP — Task Group 1's vitest config (which owns `resolve.alias['@shared'] -> resolve(__dirname,'src/shared')`) is not in place yet. Do not proceed; the failing-test step below assumes the alias resolves. Coordinate with Task Group 1 first. Do not add the alias here — it is not this group's deliverable.

- [ ] **Step 1: Write the failing test `src/main/settingsStore.test.ts` (full code, electron-free, real tmp dir)**

  ```ts
  import { describe, it, expect, beforeEach, afterEach } from 'vitest'
  import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
  import { tmpdir } from 'node:os'
  import { join } from 'node:path'
  import { createSettingsStore } from './settingsStore'
  import { DEFAULT_SETTINGS } from '@shared/settings'

  // NOTE: this test imports NO electron. createSettingsStore takes userDataDir
  // as a plain string, so the file I/O is exercised against a real tmp dir.

  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pet-settings-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  describe('createSettingsStore', () => {
    it('getFilePath returns <userDataDir>/settings.json', () => {
      const store = createSettingsStore(dir)
      expect(store.getFilePath()).toBe(join(dir, 'settings.json'))
    })

    it('load returns DEFAULT_SETTINGS when the file does not exist', () => {
      const store = createSettingsStore(dir)
      expect(store.load()).toEqual(DEFAULT_SETTINGS)
    })

    it('load returns DEFAULT_SETTINGS when the file is corrupt JSON', () => {
      writeFileSync(join(dir, 'settings.json'), '{ this is : not json', 'utf8')
      const store = createSettingsStore(dir)
      expect(store.load()).toEqual(DEFAULT_SETTINGS)
    })

    it('load merges a partial on-disk file onto defaults', () => {
      writeFileSync(
        join(dir, 'settings.json'),
        JSON.stringify({ petVisible: false, passthroughMode: 'locked-passthrough' }),
        'utf8'
      )
      const store = createSettingsStore(dir)
      const loaded = store.load()
      expect(loaded.petVisible).toBe(false)
      expect(loaded.passthroughMode).toBe('locked-passthrough')
      expect(loaded.petPosition).toEqual(DEFAULT_SETTINGS.petPosition)
    })

    it('load coerces invalid on-disk values back to defaults', () => {
      writeFileSync(
        join(dir, 'settings.json'),
        JSON.stringify({ passthroughMode: 'bogus', petVisible: 'nope' }),
        'utf8'
      )
      const store = createSettingsStore(dir)
      const loaded = store.load()
      expect(loaded.passthroughMode).toBe('auto')
      expect(loaded.petVisible).toBe(true)
    })

    it('get returns DEFAULT_SETTINGS before any load/set', () => {
      const store = createSettingsStore(dir)
      expect(store.get()).toEqual(DEFAULT_SETTINGS)
    })

    it('set merges a patch, writes the file, and returns the new full Settings', () => {
      const store = createSettingsStore(dir)
      const result = store.set({ petVisible: false })
      expect(result.petVisible).toBe(false)
      expect(existsSync(join(dir, 'settings.json'))).toBe(true)
      const onDisk = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))
      expect(onDisk.petVisible).toBe(false)
    })

    it('set updates the cache so a subsequent get reflects the patch', () => {
      const store = createSettingsStore(dir)
      store.set({ passthroughMode: 'locked-interactive' })
      expect(store.get().passthroughMode).toBe('locked-interactive')
    })

    it('set deep-merges petPosition without losing untouched fields', () => {
      const store = createSettingsStore(dir)
      const result = store.set({
        petPosition: {
          x: 42,
          y: 84,
          width: DEFAULT_SETTINGS.petPosition.width,
          height: DEFAULT_SETTINGS.petPosition.height
        }
      })
      expect(result.petPosition.x).toBe(42)
      expect(result.petPosition.y).toBe(84)
      expect(result.petPosition.width).toBe(DEFAULT_SETTINGS.petPosition.width)
    })

    it('set called before load() preserves existing on-disk settings (no clobber)', () => {
      // A previous run saved a custom petPosition to disk.
      writeFileSync(
        join(dir, 'settings.json'),
        JSON.stringify({
          version: DEFAULT_SETTINGS.version,
          petPosition: { x: 777, y: 888, width: 320, height: 320 },
          passthroughMode: 'locked-interactive',
          petVisible: true
        }),
        'utf8'
      )
      // Fresh store; we call set() WITHOUT calling load() first.
      const store = createSettingsStore(dir)
      const result = store.set({ petVisible: false })
      // The patch is applied...
      expect(result.petVisible).toBe(false)
      // ...but the previously-saved fields are preserved, not reset to defaults.
      expect(result.petPosition).toEqual({ x: 777, y: 888, width: 320, height: 320 })
      expect(result.passthroughMode).toBe('locked-interactive')
      // And the same is true on disk.
      const onDisk = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))
      expect(onDisk.petPosition).toEqual({ x: 777, y: 888, width: 320, height: 320 })
      expect(onDisk.passthroughMode).toBe('locked-interactive')
      expect(onDisk.petVisible).toBe(false)
    })

    it('persisted file survives a fresh store instance (load reads it back)', () => {
      const store1 = createSettingsStore(dir)
      store1.set({ petVisible: false })
      const store2 = createSettingsStore(dir)
      expect(store2.load().petVisible).toBe(false)
    })

    it('does not leave a .tmp file behind after an atomic write', () => {
      const store = createSettingsStore(dir)
      store.set({ petVisible: false })
      expect(existsSync(join(dir, 'settings.json.tmp'))).toBe(false)
    })
  })
  ```

- [ ] **Step 2: Run the test — expect FAIL (module not found)**

  Command:

  ```
  npx vitest run src/main/settingsStore.test.ts
  ```

  Because Step 0 already confirmed the `@shared` alias resolves, the deterministic failure is the missing `settingsStore.ts` module:

  ```
   FAIL  src/main/settingsStore.test.ts [ src/main/settingsStore.test.ts ]
  Error: Failed to load url ./settingsStore (resolved id: .../src/main/settingsStore) ... Does the file exist?
     Test Files  1 failed (1)
  ```

  Process exits non-zero.

  Contingency: if you instead see `Cannot find module '@shared/settings'` or `Failed to resolve import "@shared/settings"`, the Step 0 precondition was skipped or regressed — the `@shared` alias is missing from `vitest.config.ts` (a Task Group 1 deliverable). Go back to Step 0 and confirm `resolve.alias['@shared'] -> resolve(__dirname,'src/shared')` before continuing. Do not "fix" it by editing this group's files.

- [ ] **Step 3: Write the minimal implementation `src/main/settingsStore.ts` (full code)**

  Lazy/no electron import — `userDataDir` is injected. File I/O stays thin; merge/validation is delegated to `mergeSettings`. Atomic write = write to `settings.json.tmp` then `renameSync`. A `loaded` flag makes `set()` perform a one-time `load()` if `load()` was never called, so an early `set()` cannot clobber existing on-disk settings.

  ```ts
  // ============================================================================
  // src/main/settingsStore.ts
  // Hand-rolled JSON settings store over fs. Does NOT import electron:
  // the userData directory is injected as a string so it is unit-testable.
  // File I/O is thin; all merge/validation is delegated to mergeSettings.
  // ============================================================================
  import { readFileSync, writeFileSync, renameSync } from 'node:fs'
  import { join } from 'node:path'
  import { DEFAULT_SETTINGS, mergeSettings } from '@shared/settings'
  import type { Settings } from '@shared/types'

  const SETTINGS_FILENAME = 'settings.json'

  export interface SettingsStore {
    load(): Settings
    get(): Settings
    set(patch: Partial<Settings>): Settings
    getFilePath(): string
  }

  /**
   * Creates a JSON-file settings store rooted at userDataDir.
   *  - load()  : read+parse the file, mergeSettings(DEFAULT_SETTINGS, parsed);
   *              returns DEFAULT_SETTINGS on missing/corrupt file. Caches result
   *              and marks the store as loaded.
   *  - get()   : return the in-memory cache (DEFAULT_SETTINGS until load/set).
   *  - set()   : if load() has never run, lazily load() once first (so an early
   *              set() merges onto the existing on-disk state instead of onto
   *              bare defaults and clobbering it); then merge patch onto the
   *              current cache, atomically write to disk, update the cache, and
   *              return the new full Settings.
   *  - getFilePath(): absolute path of the settings file.
   */
  export function createSettingsStore(userDataDir: string): SettingsStore {
    const filePath = join(userDataDir, SETTINGS_FILENAME)
    const tmpPath = filePath + '.tmp'
    let cache: Settings = mergeSettings(DEFAULT_SETTINGS, null)
    let loaded = false

    function writeAtomic(settings: Settings): void {
      const json = JSON.stringify(settings, null, 2)
      writeFileSync(tmpPath, json, 'utf8')
      renameSync(tmpPath, filePath)
    }

    function load(): Settings {
      let parsed: unknown = null
      try {
        const raw = readFileSync(filePath, 'utf8')
        parsed = JSON.parse(raw)
      } catch {
        parsed = null
      }
      cache = mergeSettings(DEFAULT_SETTINGS, parsed as Partial<Settings> | null)
      loaded = true
      return cache
    }

    function get(): Settings {
      return cache
    }

    function set(patch: Partial<Settings>): Settings {
      // One-time lazy load so an early set() does not overwrite existing
      // on-disk settings with defaults+patch.
      if (!loaded) {
        load()
      }
      cache = mergeSettings(cache, patch)
      writeAtomic(cache)
      return cache
    }

    function getFilePath(): string {
      return filePath
    }

    return { load, get, set, getFilePath }
  }
  ```

- [ ] **Step 4: Run the test — expect PASS**

  Command:

  ```
  npx vitest run src/main/settingsStore.test.ts
  ```

  Expected output, process exits 0:

  ```
   ✓ src/main/settingsStore.test.ts (12 tests) ...ms
     Test Files  1 passed (1)
          Tests  12 passed (12)
  ```

- [ ] **Step 5: Run the full shared+main suite to confirm nothing regressed**

  Command:

  ```
  npx vitest run
  ```

  Expected (the four files from this group; counts: 5 + 15 + 14 + 12 = 46):

  ```
   ✓ src/shared/types.test.ts (5 tests)
   ✓ src/shared/settings.test.ts (15 tests)
   ✓ src/shared/position.test.ts (14 tests)
   ✓ src/main/settingsStore.test.ts (12 tests)
     Test Files  4 passed (4)
          Tests  46 passed (46)
  ```

  Process exits 0. (Other groups' test files may also appear if already committed — that is fine as long as the summary line shows 0 failed. If so, the `Test Files` / `Tests` totals will be higher than `4` / `46`; only this group's four files and their per-file counts must match.)

- [ ] **Step 6: Commit**

  Run via PowerShell or the Bash tool (the multiple-`-m` form works in both):

  ```
  git add src/main/settingsStore.ts src/main/settingsStore.test.ts
  git commit -m "Add hand-rolled JSON SettingsStore over fs with injected userData path" -m "Atomic tmp-file write, delegates merge/validation to mergeSettings, lazy one-time load on first set() so an early set() never clobbers existing on-disk settings; tested against a real tmp dir without importing electron." -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

The Bash tool failed (this environment uses PowerShell primarily). The repo is empty anyway per the task context, so I don't need to inspect the scaffold. I have enough information from the contract's scaffoldNotes, which document the electron-vite react-ts scaffold's whenReady block including `electronApp.setAppUserModelId` and `optimizer.watchWindowShortcuts`. Let me produce the corrected markdown.

---

### Task 4.3: Implement `createPassthroughController` (electron glue around `resolveIgnoreMouse`)

**Files:**
- Create: `D:\aicode\pet\src\main\passthrough.ts`

- [ ] **Step 1: Write the controller implementation**

  Create `D:\aicode\pet\src\main\passthrough.ts`. This is a thin electron wrapper; all branching logic is delegated to the pure helper. `getWindow` is injected so there is no circular import and no eager electron access.

  ```ts
  // ============================================================================
  // src/main/passthrough.ts
  // PassthroughController: thin electron wrapper around resolveIgnoreMouse.
  // Holds current PassthroughMode + overInteractive flag; applies the result
  // via win.setIgnoreMouseEvents(ignore, ignore ? { forward: true } : undefined).
  // ============================================================================
  import type { BrowserWindow } from 'electron'
  import { type PassthroughMode } from '@shared/types'
  import { resolveIgnoreMouse } from '@shared/passthrough'

  export interface PassthroughController {
    setMode(mode: PassthroughMode): void
    setOverInteractive(over: boolean): void
    apply(): void
    reset(): void
    getMode(): PassthroughMode
  }

  export function createPassthroughController(
    getWindow: () => BrowserWindow | null
  ): PassthroughController {
    let mode: PassthroughMode = 'auto'
    let overInteractive = false
    // Mirror of the last applied `ignore` so we only call the native API on a
    // real state change (R4 pitfall: toggling every frame causes flicker / lost
    // clicks). `undefined` forces the first apply() to always push to the window.
    let lastIgnore: boolean | undefined = undefined

    function apply(): void {
      const win = getWindow()
      if (!win || win.isDestroyed()) return
      const ignore = resolveIgnoreMouse(mode, overInteractive)
      if (ignore === lastIgnore) return
      lastIgnore = ignore
      // forward only matters (and is only allowed to matter) when ignore===true.
      win.setIgnoreMouseEvents(ignore, ignore ? { forward: true } : undefined)
    }

    return {
      setMode(next: PassthroughMode): void {
        mode = next
        apply()
      },
      setOverInteractive(over: boolean): void {
        overInteractive = over
        apply()
      },
      apply,
      reset(): void {
        // Tray "reset interaction": force not-over and re-apply.
        overInteractive = false
        apply()
      },
      getMode(): PassthroughMode {
        return mode
      }
    }
  }
  ```

- [ ] **Step 2: Confirm it compiles**

  Command:
  ```
  npx tsc --noEmit -p tsconfig.node.json
  ```
  Expected: no errors for `src/main/passthrough.ts` (exit code 0). This file IS covered by `tsconfig.node.json` (its `include` lists `src/main/**`), and it imports `@shared/types` + `@shared/passthrough`, so the alias and the pure helper are pulled into the graph and genuinely checked. The `@shared/*` aliases must resolve via the tsconfig paths added during scaffold; if `@shared` is unresolved, the alias was not wired — that is a scaffold/config task, not this one.

- [ ] **Step 3: Commit**

  ```
  git add src/main/passthrough.ts
  git commit -m "feat(main): add PassthroughController wrapping resolveIgnoreMouse

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 5.2: Add a restore-on-launch regression-guard test for `clampPositionToDisplays`

**Files:**
- Test: `D:\aicode\pet\src\shared\position.restore.test.ts`

> Ownership note: `clampPositionToDisplays` and `pickDisplayForPosition` live in `src/shared/position.ts` and are OWNED by an earlier task group (per the contract's `fileStructure` + pure-function signatures). This task does NOT define, modify, or re-paste those functions. It adds an independent test file that pins down the exact restore-on-launch scenarios Group 5 depends on (saved position fully off-screen, on a removed monitor, partially off the bottom/right, on a secondary display, oversized-window shrink, empty-displays throw). Because the owning group already implements the contract, **Step 1's test is expected to PASS immediately** — this is a regression guard, NOT a failing-first TDD cycle. If it does NOT pass, that means the earlier group's implementation diverges from the contract; in that case file the discrepancy against the owning task group (see Step 3) rather than redefining the geometry here.

- [ ] **Step 1: Write the restore regression-guard test**

  Create `D:\aicode\pet\src\shared\position.restore.test.ts` with the full code below. The `DisplayBounds[]` arrays are synthetic; `displays[0]` is always the "primary" the clamp falls back to. This test imports the earlier group's `clampPositionToDisplays` — it does not redefine it.

  ```ts
  import { describe, it, expect } from 'vitest'
  import { clampPositionToDisplays } from './position'
  import type { PetPosition, DisplayBounds } from './types'

  // Synthetic single primary display: 1920x1080, taskbar 40px at bottom.
  const PRIMARY: DisplayBounds = {
    id: 1,
    workArea: { x: 0, y: 0, width: 1920, height: 1040 }
  }

  // Synthetic secondary display to the right: 1280x1024, full work area.
  const SECONDARY: DisplayBounds = {
    id: 2,
    workArea: { x: 1920, y: 0, width: 1280, height: 1024 }
  }

  const SIZE = { width: 300, height: 300 }

  describe('clampPositionToDisplays — restore-on-launch path', () => {
    it('leaves a fully on-screen saved position unchanged', () => {
      const saved: PetPosition = { x: 200, y: 200, ...SIZE }
      const out = clampPositionToDisplays(saved, [PRIMARY])
      expect(out).toEqual({ x: 200, y: 200, width: 300, height: 300 })
    })

    it('pulls a position that is off the RIGHT edge back on-screen', () => {
      const saved: PetPosition = { x: 5000, y: 100, ...SIZE }
      const out = clampPositionToDisplays(saved, [PRIMARY])
      // max x = workArea.x + workArea.width - width = 0 + 1920 - 300 = 1620
      expect(out.x).toBe(1620)
      expect(out.y).toBe(100)
      expect(out.width).toBe(300)
      expect(out.height).toBe(300)
    })

    it('pulls a position that is off the LEFT edge back on-screen', () => {
      const saved: PetPosition = { x: -500, y: 100, ...SIZE }
      const out = clampPositionToDisplays(saved, [PRIMARY])
      // min x = workArea.x = 0
      expect(out.x).toBe(0)
      expect(out.y).toBe(100)
    })

    it('pulls a position that is off the TOP edge back on-screen', () => {
      const saved: PetPosition = { x: 100, y: -500, ...SIZE }
      const out = clampPositionToDisplays(saved, [PRIMARY])
      expect(out.x).toBe(100)
      expect(out.y).toBe(0)
    })

    it('pulls a position off the BOTTOM (under taskbar) into the work area', () => {
      const saved: PetPosition = { x: 100, y: 5000, ...SIZE }
      const out = clampPositionToDisplays(saved, [PRIMARY])
      // max y = workArea.y + workArea.height - height = 0 + 1040 - 300 = 740
      expect(out.y).toBe(740)
      expect(out.x).toBe(100)
    })

    it('falls back to the primary (displays[0]) when the saved monitor was unplugged', () => {
      // Saved deep on the secondary monitor, but only PRIMARY is connected now.
      const saved: PetPosition = { x: 2400, y: 500, ...SIZE }
      const out = clampPositionToDisplays(saved, [PRIMARY])
      // No overlap with PRIMARY => clamp into PRIMARY's work area.
      expect(out.x).toBe(1620) // 1920 - 300
      expect(out.y).toBe(500)
    })

    it('keeps a position that lives on the secondary display on that display', () => {
      const saved: PetPosition = { x: 2000, y: 100, ...SIZE }
      const out = clampPositionToDisplays(saved, [PRIMARY, SECONDARY])
      // Overlaps SECONDARY (x:1920..3200); within its work area already.
      expect(out.x).toBe(2000)
      expect(out.y).toBe(100)
    })

    it('shrinks a window larger than the work area to fit', () => {
      const saved: PetPosition = { x: 0, y: 0, width: 5000, height: 5000 }
      const out = clampPositionToDisplays(saved, [PRIMARY])
      expect(out.width).toBe(1920)
      expect(out.height).toBe(1040)
      expect(out.x).toBe(0)
      expect(out.y).toBe(0)
    })

    it('throws when no displays are provided', () => {
      const saved: PetPosition = { x: 0, y: 0, ...SIZE }
      expect(() => clampPositionToDisplays(saved, [])).toThrow()
    })
  })
  ```

- [ ] **Step 2: Run the regression-guard test and confirm it PASSES**

  Command:
  ```
  npx vitest run src/shared/position.restore.test.ts
  ```

  Expected (the owning group already implements the contract — overlap-pick with `displays[0]` fallback, clamp into `workArea`, shrink-to-fit, throw on empty), ALL 9 tests PASS:
  ```
  ✓ src/shared/position.restore.test.ts (9 tests)
  Test Files  1 passed (1)
       Tests  9 passed (9)
  ```

- [ ] **Step 3: If a case FAILS, file it against the owning group (do NOT redefine `position.ts`)**

  If any assertion FAILS, vitest prints the `expected`/`received` for that case (e.g. `expected 1620 received 5000`). This proves the earlier group's `clampPositionToDisplays` diverges from the canonical contract. Do NOT edit or re-paste `position.ts` here — that would create a second authoritative definition of geometry this group does not own. Instead:
  1. Record the exact failing case and the printed `expected`/`received` values.
  2. Raise it as a defect against the task group that owns `src/shared/position.ts` (the pure-geometry group), citing the contract signature for `clampPositionToDisplays` (overlap-pick, `displays[0]` fallback, clamp into `workArea`, shrink-to-fit, throw on empty).
  3. Leave `position.restore.test.ts` committed and failing as the regression marker until that group fixes the implementation; do not skip or weaken the assertion to make it green.

  In the normal case (Step 2 all-green) this step is a no-op.

- [ ] **Step 4: Commit**

  Command:
  ```
  git add src/shared/position.restore.test.ts && git commit -m "Guard restore-on-launch clamp path with synthetic-display regression test"
  ```

---

### Task 7.1: Author windowManager.ts (module-scope window refs + helpers) and register windows on creation

**Files:**
- Create: `D:\aicode\pet\src\main\windows\windowManager.ts`
- Modify: `D:\aicode\pet\src\main\windows\petWindow.ts` (createPetWindow — call setPetWindow after construction)
- Modify: `D:\aicode\pet\src\main\windows\panelWindow.ts` (createPanelWindow — call setPanelWindow after construction)
- Test: `D:\aicode\pet\src\main\windows\windowManager.test.ts`

- [ ] **Step 1: Write the failing test for windowManager pure-ish ref/toggle logic**

This module touches `BrowserWindow` only via the objects callers pass in; it never imports electron. We unit-test it with a fake window object that records `show`/`hide`/`setIgnoreMouseEvents` calls. Write the full test file:

```ts
// D:\aicode\pet\src\main\windows\windowManager.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  setPetWindow,
  getPetWindow,
  setPanelWindow,
  getPanelWindow,
  togglePetVisibility,
  resetInteraction,
  __resetWindowManagerForTests
} from './windowManager'

interface FakeWin {
  destroyed: boolean
  shown: boolean
  isDestroyed(): boolean
  show(): void
  hide(): void
  setIgnoreMouseEvents(ignore: boolean, opts?: { forward: boolean }): void
  ignoreCalls: Array<{ ignore: boolean; opts?: { forward: boolean } }>
}

function makeFakeWin(): FakeWin {
  return {
    destroyed: false,
    shown: false,
    isDestroyed() {
      return this.destroyed
    },
    show() {
      this.shown = true
    },
    hide() {
      this.shown = false
    },
    ignoreCalls: [],
    setIgnoreMouseEvents(ignore, opts) {
      this.ignoreCalls.push({ ignore, opts })
    }
  }
}

describe('windowManager', () => {
  beforeEach(() => {
    __resetWindowManagerForTests()
  })

  it('returns null before any window is registered', () => {
    expect(getPetWindow()).toBeNull()
    expect(getPanelWindow()).toBeNull()
  })

  it('stores and returns the registered pet window', () => {
    const win = makeFakeWin()
    setPetWindow(win as unknown as Electron.BrowserWindow)
    expect(getPetWindow()).toBe(win)
  })

  it('stores and returns the registered panel window', () => {
    const win = makeFakeWin()
    setPanelWindow(win as unknown as Electron.BrowserWindow)
    expect(getPanelWindow()).toBe(win)
  })

  it('getPetWindow returns null when the stored window is destroyed', () => {
    const win = makeFakeWin()
    setPetWindow(win as unknown as Electron.BrowserWindow)
    win.destroyed = true
    expect(getPetWindow()).toBeNull()
  })

  it('togglePetVisibility(true) shows the pet window and returns true', () => {
    const win = makeFakeWin()
    setPetWindow(win as unknown as Electron.BrowserWindow)
    const result = togglePetVisibility(true)
    expect(win.shown).toBe(true)
    expect(result).toBe(true)
  })

  it('togglePetVisibility(false) hides the pet window and returns false', () => {
    const win = makeFakeWin()
    win.shown = true
    setPetWindow(win as unknown as Electron.BrowserWindow)
    const result = togglePetVisibility(false)
    expect(win.shown).toBe(false)
    expect(result).toBe(false)
  })

  it('togglePetVisibility is a no-op returning the requested value when no window', () => {
    expect(togglePetVisibility(true)).toBe(true)
    expect(togglePetVisibility(false)).toBe(false)
  })

  it('resetInteraction calls setIgnoreMouseEvents(true,{forward:true}) on the pet window', () => {
    const win = makeFakeWin()
    setPetWindow(win as unknown as Electron.BrowserWindow)
    resetInteraction()
    expect(win.ignoreCalls).toEqual([{ ignore: true, opts: { forward: true } }])
  })

  it('resetInteraction is a safe no-op when no pet window', () => {
    expect(() => resetInteraction()).not.toThrow()
  })
})
```

- [ ] **Step 2: Run the test, expect it to FAIL (module does not exist yet)**

Command:

```
npx vitest run src/main/windows/windowManager.test.ts
```

Expected output contains a failure resolving the import, e.g.:

```
Error: Failed to load url ./windowManager (resolved id: .../src/main/windows/windowManager.ts). Does the file exist?
```

(All 9 tests fail because the module cannot be imported.)

- [ ] **Step 3: Write the windowManager.ts implementation**

```ts
// D:\aicode\pet\src\main\windows\windowManager.ts
// Module-scope window references + accessor/helper functions shared by
// tray / ipc / passthrough / dragController without circular imports.
// Electron is referenced only as a TYPE (Electron.BrowserWindow); no runtime
// import of 'electron', so this stays importable in main without side effects.

let petWindow: Electron.BrowserWindow | null = null
let panelWindow: Electron.BrowserWindow | null = null

function isAlive(win: Electron.BrowserWindow | null): win is Electron.BrowserWindow {
  return win !== null && !win.isDestroyed()
}

/** Register the pet window. Called by createPetWindow() after construction. */
export function setPetWindow(win: Electron.BrowserWindow): void {
  petWindow = win
}

/** Returns the live pet window, or null if absent/destroyed. */
export function getPetWindow(): Electron.BrowserWindow | null {
  return isAlive(petWindow) ? petWindow : null
}

/** Register the panel window. Called by createPanelWindow() after construction. */
export function setPanelWindow(win: Electron.BrowserWindow): void {
  panelWindow = win
}

/** Returns the live panel window, or null if absent/destroyed. */
export function getPanelWindow(): Electron.BrowserWindow | null {
  return isAlive(panelWindow) ? panelWindow : null
}

/**
 * Show/hide the pet window. Returns the resulting visibility (the requested
 * value) so callers (tray) can persist petVisible to settings. No-op (still
 * returns `visible`) when the pet window is absent.
 */
export function togglePetVisibility(visible: boolean): boolean {
  const win = getPetWindow()
  if (win) {
    if (visible) win.show()
    else win.hide()
  }
  return visible
}

/**
 * Force the pet window back to click-through (ignore mouse, forward events).
 * Used by the tray 'Reset interaction' action. Safe no-op when no pet window.
 */
export function resetInteraction(): void {
  const win = getPetWindow()
  if (win) {
    win.setIgnoreMouseEvents(true, { forward: true })
  }
}

/** TEST-ONLY: clears the module-scope refs between unit tests. */
export function __resetWindowManagerForTests(): void {
  petWindow = null
  panelWindow = null
}
```

- [ ] **Step 4: Run the test, expect it to PASS**

Command:

```
npx vitest run src/main/windows/windowManager.test.ts
```

Expected output contains:

```
 Test Files  1 passed (1)
      Tests  9 passed (9)
```

- [ ] **Step 5: Register the pet window into windowManager inside createPetWindow**

In `D:\aicode\pet\src\main\windows\petWindow.ts`, add the import near the top (alongside the existing imports):

```ts
import { setPetWindow } from './windowManager'
```

Then, inside `createPetWindow()`, immediately after the `BrowserWindow` instance is constructed (the line `const win = new BrowserWindow({ ... })`) and before the `return win`, insert:

```ts
  // Register so tray/ipc/passthrough/drag can reach this window without
  // circular imports. createPetWindow(settings) registers the ref here.
  setPetWindow(win)
```

- [ ] **Step 6: Register the panel window into windowManager inside createPanelWindow**

In `D:\aicode\pet\src\main\windows\panelWindow.ts`, add the import near the top:

```ts
import { setPanelWindow } from './windowManager'
```

Then, inside `createPanelWindow()`, immediately after the `BrowserWindow` instance is constructed (`const win = new BrowserWindow({ ... })`) and before any `return`, insert:

```ts
  // Register so showPanelWindow()/ipc can reuse the existing panel window.
  setPanelWindow(win)
```

- [ ] **Step 7: Run the full main test suite to confirm nothing regressed**

Command:

```
npx vitest run src/main
```

Expected output contains:

```
 Test Files  1 passed (1)
      Tests  9 passed (9)
```

(Only windowManager.test.ts runs here; petWindow.ts / panelWindow.ts are electron-glue with no unit tests, so they are not executed by vitest.)

- [ ] **Step 8: Commit**

```
git add src/main/windows/windowManager.ts src/main/windows/windowManager.test.ts src/main/windows/petWindow.ts src/main/windows/panelWindow.ts && git commit -m "$(cat <<'EOF'
feat(main): add windowManager refs + register pet/panel windows on creation

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3.1: `createPetWindow()` main-process factory (Electron glue)

**Files:**
- Create: `D:\aicode\pet\src\main\windows\petWindow.ts`
- Test: (none — this is a glue task verified by manual checks in Task 3.3 Step 6 and by the `tsc` type-check in Step 2)

> Window construction is **glue** per the canonical fileStructure (`src/main/windows/petWindow.ts`), so the transparent/frameless/overlay constructor options are inlined directly in `createPetWindow()` and verified by the manual checks in Task 3.3 Step 6 — there is no separate pure `petWindowOptions` module (none exists in the contract's `src/shared/**` enumeration).
>
> **Ownership (integration-contract §0, §1, §4):** Task 3.1 authors `src/main/windows/petWindow.ts` ONLY. It does NOT edit `src/main/index.ts` — Task 6.4 is the SOLE owner of the `whenReady`/`bootstrap` block and is the canonical caller of `createPetWindow(settings)`. The factory takes the **loaded `Settings` object directly** (NOT a store, NOT a `deps` bag, NOT a `PetSettingsSource` seam), registers itself into `windowManager` via `setPetWindow(win)`, and honors `settings.petVisible` when deciding whether to show on first paint. The `setPetWindow` symbol is authored by Task 7.1 in `src/main/windows/windowManager.ts`; this task only inserts the `setPetWindow(win)` call site.
>
> **Cross-group dependency (must be satisfied by the scaffold/alias task group before this task runs):** the scaffold group must add `"@shared/*": ["src/shared/*"]` to the `compilerOptions.paths` of BOTH `tsconfig.node.json` and the base `tsconfig.json`, in addition to the `electron.vite.config.ts` / `vitest.config.ts` aliases named in scaffoldNotes. `npx tsc --noEmit -p tsconfig.node.json` (Step 2) resolves aliases from tsconfig `paths`, not from `electron.vite.config.ts`, so without this the `@shared` imports will not typecheck. (Note: this task imports `@shared/types` for the `DisplayBounds`/`PetPosition`/`Settings` types and `@shared/position` for `clampPositionToDisplays`; both import paths must resolve.)

- [ ] **Step 1: Write `createPetWindow()`**

  Create `D:\aicode\pet\src\main\windows\petWindow.ts` with the complete contents below. The transparent/frameless/always-on-top constructor options (Research R3) are written inline. The pure `clampPositionToDisplays` helper is used to **restore the clamped saved position** from the passed-in `Settings` (required by the contract's `petWindow.ts` fileStructure entry). The window registers itself into `windowManager` via `setPetWindow(win)` immediately after construction so tray/ipc/passthrough/drag can reach it without circular imports. The window is shown on `ready-to-show` **only when `settings.petVisible` is true** (persisted-visibility honored). `setAlwaysOnTop(true, 'screen-saver')` and the macOS `setVisibleOnAllWorkspaces` are applied imperatively after creation. `webPreferences.preload` points at the built pet preload (`../preload/index.js`). The renderer loads dev `loadURL` / prod `loadFile` per the runtime/build facts, each with a `.catch` so a transient dev-server failure does not surface as an unhandledRejection. CommonJS, so `__dirname` + `join(...)` are used directly — do NOT migrate to ESM.

  ```ts
  // src/main/windows/petWindow.ts  — BASE authored by 3.1; setPetWindow added by 7.1.
  // createPetWindow(): transparent, frameless, always-on-top pet window factory. GLUE.
  import { BrowserWindow, screen } from 'electron'
  import { join } from 'node:path'
  import { clampPositionToDisplays } from '@shared/position'
  import type { DisplayBounds, PetPosition, Settings } from '@shared/types'
  import { setPetWindow } from './windowManager'

  /** Map connected Electron displays to plain DisplayBounds (primary first). */
  function readDisplayBounds(): DisplayBounds[] {
    const primary = screen.getPrimaryDisplay()
    const all = screen.getAllDisplays()
    // Ensure the primary display is first (clampPositionToDisplays falls back to
    // displays[0] when nothing overlaps).
    const ordered = [primary, ...all.filter((d) => d.id !== primary.id)]
    return ordered.map((d) => ({
      id: d.id,
      workArea: {
        x: d.workArea.x,
        y: d.workArea.y,
        width: d.workArea.width,
        height: d.workArea.height
      }
    }))
  }

  /**
   * Create the transparent/frameless always-on-top pet window from the loaded
   * Settings. Restores the clamped saved position, registers the window into
   * windowManager, and shows it on ready-to-show ONLY when settings.petVisible.
   * Must be called after app.whenReady() (touches `screen`). Returns the window.
   */
  export function createPetWindow(settings: Settings): BrowserWindow {
    const saved: PetPosition = settings.petPosition
    const clamped: PetPosition = clampPositionToDisplays(saved, readDisplayBounds())

    const win = new BrowserWindow({
      x: clamped.x,
      y: clamped.y,
      width: clamped.width,
      height: clamped.height,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      hasShadow: false,
      roundedCorners: false,
      skipTaskbar: true,
      focusable: false,
      show: false,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        backgroundThrottling: false
      }
    })

    // Register so tray/ipc/passthrough/drag reach this window without circular imports.
    setPetWindow(win)

    // Honor persisted visibility: show on first paint ONLY if petVisible is true.
    // (Showing only on ready-to-show avoids a white/opaque flash on a transparent
    // window — Research R3.)
    win.once('ready-to-show', () => {
      if (settings.petVisible) win.show()
    })

    // Highest documented stacking level: above the taskbar/Dock and other
    // always-on-top windows (Research R3).
    win.setAlwaysOnTop(true, 'screen-saver')

    // macOS: follow across Spaces and stay over other apps' fullscreen windows.
    if (process.platform === 'darwin') {
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    }

    // Load the pet renderer route: dev uses the HMR server URL, prod the built
    // index.html (CommonJS __dirname is available — do not migrate to ESM).
    // Load returns a Promise; tolerate transient failures for this glue shell.
    if (process.env.ELECTRON_RENDERER_URL) {
      win
        .loadURL(process.env.ELECTRON_RENDERER_URL)
        .catch((err) => console.error('pet renderer load failed', err))
    } else {
      win
        .loadFile(join(__dirname, '../renderer/index.html'))
        .catch((err) => console.error('pet renderer load failed', err))
    }

    return win
  }
  ```

- [ ] **Step 2: Sanity-check that the main bundle type-checks**

  Run exactly:

  ```
  npx tsc --noEmit -p tsconfig.node.json
  ```

  Expected: no output and exit code 0. The scaffold's `tsconfig.node.json` covers `src/main`/`src/preload`, and the `@shared` path alias resolves **because the scaffold/alias task group added `"@shared/*": ["src/shared/*"]` to `tsconfig.node.json` and the base `tsconfig.json` paths** (the documented cross-group dependency at the top of this task). If `@shared` is unresolved, that scaffold prerequisite was not completed — fix it in the scaffold task group; do not work around it by changing the import.

  > This task introduces an import of `setPetWindow` from `./windowManager` (authored by Task 7.1). If Task 7.1 has not yet landed, this `tsc` step will report that `'./windowManager'` has no exported member `setPetWindow` (or that the module cannot be found). That is expected ordering: Task 3.1's factory depends on Task 7.1's windowManager base. Land 7.1 (or its `setPetWindow` export) before expecting a clean exit 0 here; do NOT inline a local window ref to work around it — the single getter/setter home is `windowManager.ts` per integration-contract §3.

- [ ] **Step 3: Commit**

  Run exactly:

  ```
  git add src/main/windows/petWindow.ts && git commit -m "feat(pet-window): createPetWindow factory (settings-driven, registers into windowManager)"
  ```

---

### Task 6.2: Implement `createPanelWindow()` / `showPanelWindow()` (create-or-focus)

**Files:**
- Create: `D:\aicode\pet\src\main\windows\panelWindow.ts`
- Depends on (authored by task 7.1, not edited here): `D:\aicode\pet\src\main\windows\windowManager.ts` — provides `setPanelWindow(win)` and `getPanelWindow()`. This task does NOT author or modify `windowManager.ts`; it imports `setPanelWindow` / `getPanelWindow` from it. The panel ref lives ONLY in `windowManager.ts` (no module-scope ref in `panelWindow.ts`).

This is Electron GLUE (cannot be unit-tested); full implementation + manual verification follow.

- [ ] **Step 1: Write the panel window factory**

  Write `D:\aicode\pet\src\main\windows\panelWindow.ts` with this exact content:

  ```ts
  // ============================================================================
  // src/main/windows/panelWindow.ts
  // Normal, opaque, resizable panel window. Loads the panel React route.
  // create-or-focus: showPanelWindow() reuses an existing window if open,
  // otherwise creates one. The single panel ref is owned by windowManager
  // (setPanelWindow / getPanelWindow) — this module keeps NO local ref.
  // GLUE — manually verified.
  // ============================================================================
  import { BrowserWindow } from 'electron'
  import { join } from 'node:path'
  import { setPanelWindow, getPanelWindow } from './windowManager'

  /**
   * Create the panel BrowserWindow (hidden until ready-to-show).
   * Normal opaque resizable window — NOT transparent/frameless.
   * Registers itself into windowManager via setPanelWindow(win).
   */
  export function createPanelWindow(): BrowserWindow {
    const win = new BrowserWindow({
      width: 800,
      height: 600,
      minWidth: 480,
      minHeight: 360,
      show: false,
      resizable: true,
      title: 'Pet Panel',
      backgroundColor: '#ffffff',
      webPreferences: {
        preload: join(__dirname, '../preload/panel.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        backgroundThrottling: false
      }
    })

    win.once('ready-to-show', () => {
      win.show()
      win.focus()
    })

    // Load the second renderer entry (panel.html).
    if (process.env.ELECTRON_RENDERER_URL) {
      void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/panel.html`)
    } else {
      void win.loadFile(join(__dirname, '../renderer/panel.html'))
    }

    // Register the single panel ref in windowManager. No local module ref and no
    // 'closed' handler: getPanelWindow() already returns null for a destroyed
    // window via its isDestroyed() guard.
    setPanelWindow(win)
    return win
  }

  /**
   * create-or-focus: open the panel if it does not exist, otherwise restore +
   * focus the existing one. Called from the tray ('open-panel') and from the
   * pet:open-panel IPC command. Reads the live ref from windowManager.
   */
  export function showPanelWindow(): BrowserWindow {
    const existing = getPanelWindow()
    if (existing && !existing.isDestroyed()) {
      if (existing.isMinimized()) existing.restore()
      if (!existing.isVisible()) existing.show()
      existing.focus()
      return existing
    }
    return createPanelWindow()
  }
  ```

- [ ] **Step 2: Type-check the new file**

  Command:
  ```
  npx tsc --noEmit -p tsconfig.node.json
  ```
  Expected: no errors referencing `src/main/windows/panelWindow.ts`. (If the scaffold uses a different main tsconfig name, run `npx tsc --noEmit` and confirm `panelWindow.ts` reports no errors.)

- [ ] **Step 3: Commit**

  Command:
  ```
  git add src/main/windows/panelWindow.ts && git commit -m "feat(main): create-or-focus panel window loading panel route

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 7.7: Author src/main/ipc.ts base — registerIpcHandlers (settings:get/set + settings:changed broadcast + pet:open-panel)

**Files:**
- Create: `D:\aicode\pet\src\main\ipc.ts`
- Test: `D:\aicode\pet\src\main\ipc.test.ts`

`registerIpcHandlers` touches `ipcMain` (electron). Per the integration contract (§5), it has the canonical SINGLE-ARG signature `registerIpcHandlers(deps: IpcDeps): IpcHandles`. `ipcMain` is NOT injected as a separate first arg — it is imported from `electron` at the module top, and the test mocks it via `vi.mock('electron', ...)`. The handler behavior (persist + broadcast + return) is exercised through the injected `deps` seams. The function returns `{ flushPersist }`; 7.7's base returns `{ flushPersist: () => {} }` as a placeholder that task 5.3 later replaces with the real `() => dragController.flushPersist()`. Later groups (4.4 adds `pet:setInteractive`; 5.3 adds the three drag handlers + the real flush) ADD their `ipcMain.on` registrations INSIDE this same function. The canonical `IpcDeps` already includes `passthrough`, `getPetWindow`, and `broadcastSettingsChanged` (the broadcast is owned by 6.4's bootstrap and injected here, not built locally) so the extenders do not re-author the deps shape.

- [ ] **Step 1: Write the failing test for registerIpcHandlers behavior**

```ts
// D:\aicode\pet\src\main\ipc.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { IPC } from '@shared/ipc'
import type { Settings } from '@shared/types'

// Mock electron's ipcMain so registerIpcHandlers' module-top import is a fake we
// can inspect. registerIpcHandlers has the single-arg (deps) signature; the
// electron seam is captured here rather than injected.
const handlers = new Map<string, (...a: unknown[]) => unknown>()
const listeners = new Map<string, (...a: unknown[]) => void>()
const handle = vi.fn((channel: string, fn: (...a: unknown[]) => unknown) => {
  handlers.set(channel, fn)
})
const on = vi.fn((channel: string, fn: (...a: unknown[]) => void) => {
  listeners.set(channel, fn)
})
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...a: unknown[]) => unknown) =>
      handle(channel, fn),
    on: (channel: string, fn: (...a: unknown[]) => void) => on(channel, fn)
  }
}))

// Import AFTER vi.mock so the mocked electron is in effect.
import { registerIpcHandlers, type IpcDeps } from './ipc'

const BASE: Settings = {
  version: 1,
  petPosition: { x: 0, y: 0, width: 300, height: 300 },
  passthroughMode: 'auto',
  petVisible: true
}

function makeFakeStore(initial: Settings) {
  let current = initial
  return {
    get: vi.fn(() => current),
    set: vi.fn((patch: Partial<Settings>) => {
      current = { ...current, ...patch }
      return current
    })
  }
}

function makeFakePassthrough() {
  return {
    setMode: vi.fn(),
    getMode: vi.fn(() => 'auto' as const),
    setOverInteractive: vi.fn(),
    apply: vi.fn(),
    reset: vi.fn()
  }
}

function makeFakeWindow() {
  return {
    isDestroyed: () => false,
    webContents: { send: vi.fn() }
  }
}

function makeDeps(store: ReturnType<typeof makeFakeStore>) {
  const win = makeFakeWindow()
  const showPanelWindow = vi.fn()
  const broadcastSettingsChanged = vi.fn()
  const deps: IpcDeps = {
    settingsStore: store as never,
    passthrough: makeFakePassthrough() as never,
    showPanelWindow,
    getPetWindow: () => win as never,
    broadcastSettingsChanged,
    getAllWindows: () => [win as never]
  }
  return { deps, win, showPanelWindow, broadcastSettingsChanged }
}

beforeEach(() => {
  handlers.clear()
  listeners.clear()
  handle.mockClear()
  on.mockClear()
})

describe('registerIpcHandlers', () => {
  it('registers handle for SETTINGS_GET and SETTINGS_SET', () => {
    const store = makeFakeStore(BASE)
    const { deps } = makeDeps(store)
    registerIpcHandlers(deps)
    expect(handlers.has(IPC.SETTINGS_GET)).toBe(true)
    expect(handlers.has(IPC.SETTINGS_SET)).toBe(true)
  })

  it('registers on for PET_OPEN_PANEL', () => {
    const store = makeFakeStore(BASE)
    const { deps } = makeDeps(store)
    registerIpcHandlers(deps)
    expect(listeners.has(IPC.PET_OPEN_PANEL)).toBe(true)
  })

  it('returns a placeholder flushPersist that is a no-op', () => {
    const store = makeFakeStore(BASE)
    const { deps } = makeDeps(store)
    const handles = registerIpcHandlers(deps)
    expect(typeof handles.flushPersist).toBe('function')
    expect(() => handles.flushPersist()).not.toThrow()
  })

  it('SETTINGS_GET handler returns the current settings', async () => {
    const store = makeFakeStore(BASE)
    const { deps } = makeDeps(store)
    registerIpcHandlers(deps)
    const handler = handlers.get(IPC.SETTINGS_GET)!
    const result = await handler({} /* IpcMainInvokeEvent */)
    expect(result).toEqual(BASE)
    expect(store.get).toHaveBeenCalled()
  })

  it('SETTINGS_SET persists the patch and returns the new settings', async () => {
    const store = makeFakeStore(BASE)
    const { deps } = makeDeps(store)
    registerIpcHandlers(deps)
    const handler = handlers.get(IPC.SETTINGS_SET)!
    const result = (await handler({}, { petVisible: false })) as Settings
    expect(store.set).toHaveBeenCalledWith({ petVisible: false })
    expect(result.petVisible).toBe(false)
  })

  it('SETTINGS_SET calls broadcastSettingsChanged after persisting', async () => {
    const store = makeFakeStore(BASE)
    const { deps, broadcastSettingsChanged } = makeDeps(store)
    registerIpcHandlers(deps)
    const handler = handlers.get(IPC.SETTINGS_SET)!
    await handler({}, { petVisible: false })
    expect(broadcastSettingsChanged).toHaveBeenCalledTimes(1)
  })

  it('PET_OPEN_PANEL listener calls showPanelWindow', () => {
    const store = makeFakeStore(BASE)
    const { deps, showPanelWindow } = makeDeps(store)
    registerIpcHandlers(deps)
    const listener = listeners.get(IPC.PET_OPEN_PANEL)!
    listener({} /* IpcMainEvent */)
    expect(showPanelWindow).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run the test, expect it to FAIL (ipc.ts does not exist)**

Command:

```
npx vitest run src/main/ipc.test.ts
```

Expected output contains:

```
Error: Failed to load url ./ipc (resolved id: .../src/main/ipc.ts). Does the file exist?
```

- [ ] **Step 3: Write src/main/ipc.ts (full file)**

```ts
// D:\aicode\pet\src\main\ipc.ts
// registerIpcHandlers(): wires ipcMain handlers/listeners for the Plan 1 base IPC
// channels (settings:get/set + settings:changed broadcast + pet:open-panel),
// delegating to injected seams (deps) so the handler logic is unit-testable.
// `ipcMain` is imported from electron at module top (the test mocks 'electron');
// the single-arg (deps) signature is canonical per the integration contract.
// Later groups ADD their registrations INSIDE this same function: 4.4 adds the
// pet:setInteractive handler, and 5.3 builds the drag controller + persist sink,
// registers the three drag handlers, and replaces the returned flushPersist
// placeholder with the real () => dragController.flushPersist().
import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type { Settings } from '@shared/types'

/**
 * The dependencies registerIpcHandlers needs, injected so the handler logic
 * (persist + broadcast + return) can be tested with fakes. This is the canonical
 * IpcDeps shape: 4.4 consumes `passthrough` and 5.3 consumes `getPetWindow` +
 * `settingsStore` + `broadcastSettingsChanged`; none of them re-author this shape.
 */
export interface IpcDeps {
  /** The settings store (createSettingsStore result). */
  settingsStore: {
    get(): Settings
    set(patch: Partial<Settings>): Settings
  }
  /** Passthrough controller (consumed by 4.4's pet:setInteractive handler). */
  passthrough: import('./passthrough').PassthroughController
  /** Shows/creates the opaque panel window (from panelWindow.ts). */
  showPanelWindow: () => void
  /** Live pet-window getter (drag controller built by 5.3 + broadcast). */
  getPetWindow: () => Electron.BrowserWindow | null
  /** Broadcast full Settings to every live window (destroyed-safe; owned by 6.4). */
  broadcastSettingsChanged: () => void
  /** All live windows to broadcast settings:changed to (may contain nulls). */
  getAllWindows: () => Array<Electron.BrowserWindow | null>
}

/**
 * Handles returned to the bootstrap (6.4). `flushPersist` flushes the pending
 * debounced drag-persist write on before-quit. 7.7's base returns a no-op
 * placeholder; 5.3 replaces it with the real drag-controller flush.
 */
export interface IpcHandles {
  /** Flush the pending debounced drag-persist write (called on before-quit). */
  flushPersist: () => void
}

/**
 * Register the Plan 1 base IPC handlers and return the IpcHandles. `ipcMain` is
 * the real Electron import at runtime (mocked in tests). Call once at startup.
 */
export function registerIpcHandlers(deps: IpcDeps): IpcHandles {
  // settings:get -> current merged Settings (request/response).
  ipcMain.handle(IPC.SETTINGS_GET, () => {
    return deps.settingsStore.get()
  })

  // settings:set -> merge+persist patch, broadcast, return new Settings.
  ipcMain.handle(IPC.SETTINGS_SET, (_event, ...args: unknown[]) => {
    const patch = (args[0] ?? {}) as Partial<Settings>
    const next = deps.settingsStore.set(patch)
    deps.broadcastSettingsChanged()
    return next
  })

  // pet:open-panel -> show/create the opaque panel window (fire-and-forget).
  ipcMain.on(IPC.PET_OPEN_PANEL, () => {
    deps.showPanelWindow()
  })

  // Placeholder flush; 5.3 replaces this with () => dragController.flushPersist().
  return { flushPersist: () => {} }
}
```

- [ ] **Step 4: Run the test, expect it to PASS**

Command:

```
npx vitest run src/main/ipc.test.ts
```

Expected output contains:

```
 Test Files  1 passed (1)
      Tests  7 passed (7)
```

- [ ] **Step 5: Run the full main + preload suites to confirm no regression across the gap-fill work**

Command:

```
npx vitest run src/main src/preload
```

Expected output contains:

```
 Test Files  4 passed (4)
      Tests  26 passed (26)
```

(windowManager 9 + ipc 7 from src/main; index preload 5 + panel preload 5 from src/preload.)

- [ ] **Step 6: Commit**

```
git add src/main/ipc.ts src/main/ipc.test.ts && git commit -m "$(cat <<'EOF'
feat(main): registerIpcHandlers base (settings:get/set + settings:changed broadcast + pet:open-panel)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7.3: Author the base pet preload (window.petApi) — getSettings/setSettings/onSettingsChanged/openPanel

**Files:**
- Modify (replace): `D:\aicode\pet\src\preload\index.ts` (scaffold base exposes generic `window.api`/`window.electron`)
- Test: `D:\aicode\pet\src\preload\index.test.ts`

The preload references `ipcRenderer` (electron), so we unit-test the petApi-building logic by injecting a fake `ipcRenderer` into an exported pure factory `buildPetApi(ipcRenderer)`. The thin `contextBridge.exposeInMainWorld('petApi', buildPetApi(ipcRenderer))` line stays glue (verified at runtime in Task 7.5's manual checks).

- [ ] **Step 1: Write the failing test for buildPetApi against a fake ipcRenderer**

```ts
// D:\aicode\pet\src\preload\index.test.ts
import { describe, it, expect, vi } from 'vitest'
import { buildPetApi } from './index'
import { IPC } from '@shared/ipc'
import type { Settings } from '@shared/types'

function makeFakeIpc() {
  return {
    invokeCalls: [] as Array<{ channel: string; args: unknown[] }>,
    sendCalls: [] as Array<{ channel: string; args: unknown[] }>,
    onCalls: [] as Array<{ channel: string }>,
    removeCalls: [] as Array<{ channel: string }>,
    invoke: vi.fn(function (this: void, channel: string, ...args: unknown[]) {
      return Promise.resolve({ channel, args })
    }),
    send: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn()
  }
}

const SAMPLE: Settings = {
  version: 1,
  petPosition: { x: 10, y: 20, width: 300, height: 300 },
  passthroughMode: 'auto',
  petVisible: true
}

describe('buildPetApi', () => {
  it('getSettings invokes IPC.SETTINGS_GET', async () => {
    const ipc = makeFakeIpc()
    ipc.invoke.mockResolvedValueOnce(SAMPLE)
    const api = buildPetApi(ipc as never)
    const result = await api.getSettings()
    expect(ipc.invoke).toHaveBeenCalledWith(IPC.SETTINGS_GET)
    expect(result).toEqual(SAMPLE)
  })

  it('setSettings invokes IPC.SETTINGS_SET with the patch', async () => {
    const ipc = makeFakeIpc()
    ipc.invoke.mockResolvedValueOnce(SAMPLE)
    const api = buildPetApi(ipc as never)
    const patch = { petVisible: false }
    const result = await api.setSettings(patch)
    expect(ipc.invoke).toHaveBeenCalledWith(IPC.SETTINGS_SET, patch)
    expect(result).toEqual(SAMPLE)
  })

  it('openPanel sends IPC.PET_OPEN_PANEL fire-and-forget', () => {
    const ipc = makeFakeIpc()
    const api = buildPetApi(ipc as never)
    api.openPanel()
    expect(ipc.send).toHaveBeenCalledWith(IPC.PET_OPEN_PANEL)
  })

  it('onSettingsChanged subscribes to IPC.SETTINGS_CHANGED and forwards the payload', () => {
    const ipc = makeFakeIpc()
    const api = buildPetApi(ipc as never)
    const received: Settings[] = []
    api.onSettingsChanged((s) => received.push(s))
    expect(ipc.on).toHaveBeenCalledTimes(1)
    expect(ipc.on.mock.calls[0][0]).toBe(IPC.SETTINGS_CHANGED)
    // Simulate main broadcasting the event (event arg, then payload).
    const handler = ipc.on.mock.calls[0][1] as (
      e: unknown,
      payload: { settings: Settings }
    ) => void
    handler({}, { settings: SAMPLE })
    expect(received).toEqual([SAMPLE])
  })

  it('onSettingsChanged returns an unsubscribe that removes the listener', () => {
    const ipc = makeFakeIpc()
    const api = buildPetApi(ipc as never)
    const off = api.onSettingsChanged(() => {})
    off()
    expect(ipc.removeListener).toHaveBeenCalledTimes(1)
    expect(ipc.removeListener.mock.calls[0][0]).toBe(IPC.SETTINGS_CHANGED)
  })
})
```

- [ ] **Step 2: Add the preload test files to the vitest include glob**

The CONTRACT's vitest include is `['src/shared/**/*.{test,spec}.ts','src/main/**/*.{test,spec}.ts']`, which excludes `src/preload`. Add the preload glob so this test (and Task 7.4's) is picked up. In `D:\aicode\pet\vitest.config.ts`, change the `include` array from:

```ts
    include: ['src/shared/**/*.{test,spec}.ts', 'src/main/**/*.{test,spec}.ts'],
```

to:

```ts
    include: [
      'src/shared/**/*.{test,spec}.ts',
      'src/main/**/*.{test,spec}.ts',
      'src/preload/**/*.{test,spec}.ts'
    ],
```

- [ ] **Step 3: Run the test, expect it to FAIL (buildPetApi not exported yet)**

Command:

```
npx vitest run src/preload/index.test.ts
```

Expected output contains:

```
Error: [vitest] No "buildPetApi" export is defined on the "./index" mock
```

or (if the scaffold index.ts has no such symbol):

```
SyntaxError: The requested module './index' does not provide an export named 'buildPetApi'
```

- [ ] **Step 4: Replace src/preload/index.ts with the petApi base implementation (full file)**

Overwrite `D:\aicode\pet\src\preload\index.ts` with exactly:

```ts
// Pet-window preload. Exposes window.petApi (the RendererApi surface) wrapping
// ipcRenderer over the IPC channel-name constants. Later groups EXTEND this
// object (setInteractive, drag.*, onPassthroughModeChanged); this is the base.
import { contextBridge, ipcRenderer, type IpcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { IPC } from '@shared/ipc'
import type { Settings, SettingsChangedPayload } from '@shared/types'

/**
 * Pure factory for the petApi surface. Takes ipcRenderer as a parameter so the
 * wiring is unit-testable without electron. Later groups add members here.
 */
export function buildPetApi(ipc: IpcRenderer) {
  return {
    getSettings(): Promise<Settings> {
      return ipc.invoke(IPC.SETTINGS_GET)
    },
    setSettings(patch: Partial<Settings>): Promise<Settings> {
      return ipc.invoke(IPC.SETTINGS_SET, patch)
    },
    openPanel(): void {
      ipc.send(IPC.PET_OPEN_PANEL)
    },
    onSettingsChanged(cb: (settings: Settings) => void): () => void {
      const listener = (_e: unknown, payload: SettingsChangedPayload): void =>
        cb(payload.settings)
      ipc.on(IPC.SETTINGS_CHANGED, listener)
      return () => ipc.removeListener(IPC.SETTINGS_CHANGED, listener)
    }
  }
}

const petApi = buildPetApi(ipcRenderer)

// contextIsolation:true -> expose via contextBridge.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('petApi', petApi)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define on window when isolation is off)
  window.electron = electronAPI
  // @ts-ignore
  window.petApi = petApi
}
```

- [ ] **Step 5: Run the test, expect it to PASS**

Command:

```
npx vitest run src/preload/index.test.ts
```

Expected output contains:

```
 Test Files  1 passed (1)
      Tests  5 passed (5)
```

- [ ] **Step 6: Commit**

```
git add src/preload/index.ts src/preload/index.test.ts vitest.config.ts && git commit -m "$(cat <<'EOF'
feat(preload): expose window.petApi base (getSettings/setSettings/onSettingsChanged/openPanel)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7.4: Author the panel preload (window.panelApi) — getSettings/setSettings/onSettingsChanged

**Files:**
- Create: `D:\aicode\pet\src\preload\panel.ts`
- Test: `D:\aicode\pet\src\preload\panel.test.ts`

The panel preload exposes a strict subset (no drag, no passthrough, no openPanel). Same injected-ipcRenderer test pattern.

- [ ] **Step 1: Write the failing test for buildPanelApi**

```ts
// D:\aicode\pet\src\preload\panel.test.ts
import { describe, it, expect, vi } from 'vitest'
import { buildPanelApi } from './panel'
import { IPC } from '@shared/ipc'
import type { Settings } from '@shared/types'

function makeFakeIpc() {
  return {
    invoke: vi.fn(),
    send: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn()
  }
}

const SAMPLE: Settings = {
  version: 1,
  petPosition: { x: 0, y: 0, width: 300, height: 300 },
  passthroughMode: 'locked-interactive',
  petVisible: true
}

describe('buildPanelApi', () => {
  it('exposes ONLY getSettings, setSettings, onSettingsChanged', () => {
    const api = buildPanelApi(makeFakeIpc() as never)
    expect(Object.keys(api).sort()).toEqual([
      'getSettings',
      'onSettingsChanged',
      'setSettings'
    ])
  })

  it('getSettings invokes IPC.SETTINGS_GET', async () => {
    const ipc = makeFakeIpc()
    ipc.invoke.mockResolvedValueOnce(SAMPLE)
    const api = buildPanelApi(ipc as never)
    const result = await api.getSettings()
    expect(ipc.invoke).toHaveBeenCalledWith(IPC.SETTINGS_GET)
    expect(result).toEqual(SAMPLE)
  })

  it('setSettings invokes IPC.SETTINGS_SET with the patch', async () => {
    const ipc = makeFakeIpc()
    ipc.invoke.mockResolvedValueOnce(SAMPLE)
    const api = buildPanelApi(ipc as never)
    const patch = { passthroughMode: 'auto' as const }
    const result = await api.setSettings(patch)
    expect(ipc.invoke).toHaveBeenCalledWith(IPC.SETTINGS_SET, patch)
    expect(result).toEqual(SAMPLE)
  })

  it('onSettingsChanged subscribes to IPC.SETTINGS_CHANGED and forwards settings', () => {
    const ipc = makeFakeIpc()
    const api = buildPanelApi(ipc as never)
    const received: Settings[] = []
    api.onSettingsChanged((s) => received.push(s))
    expect(ipc.on.mock.calls[0][0]).toBe(IPC.SETTINGS_CHANGED)
    const handler = ipc.on.mock.calls[0][1] as (
      e: unknown,
      payload: { settings: Settings }
    ) => void
    handler({}, { settings: SAMPLE })
    expect(received).toEqual([SAMPLE])
  })

  it('onSettingsChanged returns an unsubscribe removing the listener', () => {
    const ipc = makeFakeIpc()
    const api = buildPanelApi(ipc as never)
    const off = api.onSettingsChanged(() => {})
    off()
    expect(ipc.removeListener).toHaveBeenCalledTimes(1)
    expect(ipc.removeListener.mock.calls[0][0]).toBe(IPC.SETTINGS_CHANGED)
  })
})
```

- [ ] **Step 2: Run the test, expect it to FAIL (panel preload does not exist)**

Command:

```
npx vitest run src/preload/panel.test.ts
```

Expected output contains:

```
Error: Failed to load url ./panel (resolved id: .../src/preload/panel.ts). Does the file exist?
```

- [ ] **Step 3: Write src/preload/panel.ts (full file)**

```ts
// D:\aicode\pet\src\preload\panel.ts
// Panel-window preload. Exposes window.panelApi: a STRICT subset of the
// renderer surface (read/write settings + subscribe). No drag, no passthrough,
// no openPanel — the panel never controls the pet directly.
import { contextBridge, ipcRenderer, type IpcRenderer } from 'electron'
import { IPC } from '@shared/ipc'
import type { Settings, SettingsChangedPayload } from '@shared/types'

/** Pure factory for the panelApi surface (injected ipcRenderer for testing). */
export function buildPanelApi(ipc: IpcRenderer) {
  return {
    getSettings(): Promise<Settings> {
      return ipc.invoke(IPC.SETTINGS_GET)
    },
    setSettings(patch: Partial<Settings>): Promise<Settings> {
      return ipc.invoke(IPC.SETTINGS_SET, patch)
    },
    onSettingsChanged(cb: (settings: Settings) => void): () => void {
      const listener = (_e: unknown, payload: SettingsChangedPayload): void =>
        cb(payload.settings)
      ipc.on(IPC.SETTINGS_CHANGED, listener)
      return () => ipc.removeListener(IPC.SETTINGS_CHANGED, listener)
    }
  }
}

const panelApi = buildPanelApi(ipcRenderer)

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('panelApi', panelApi)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define on window when isolation is off)
  window.panelApi = panelApi
}
```

- [ ] **Step 4: Run the test, expect it to PASS**

Command:

```
npx vitest run src/preload/panel.test.ts
```

Expected output contains:

```
 Test Files  1 passed (1)
      Tests  5 passed (5)
```

- [ ] **Step 5: Run the full preload suite to confirm both preloads pass together**

Command:

```
npx vitest run src/preload
```

Expected output contains:

```
 Test Files  2 passed (2)
      Tests  10 passed (10)
```

- [ ] **Step 6: Commit**

```
git add src/preload/panel.ts src/preload/panel.test.ts && git commit -m "$(cat <<'EOF'
feat(preload): add panel preload exposing window.panelApi (settings-only subset)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7.5: Augment src/preload/index.d.ts — declare window.petApi and window.panelApi

**Files:**
- Modify (replace): `D:\aicode\pet\src\preload\index.d.ts` (scaffold declares only `window.electron`/`window.api`)

Pure typing glue. Verified by `tsc --noEmit`, not vitest.

- [ ] **Step 1: Confirm RendererApi exists in @shared/ipc and capture its members**

Command:

```
npx --yes grep-cli@latest "RendererApi" src/shared/ipc.ts || sed -n '1,200p' src/shared/ipc.ts
```

Expected: `src/shared/ipc.ts` exports an `interface RendererApi` (the full pet surface) and the `IPC` constant object. If `RendererApi` is not yet present in ipc.ts, it MUST be (per CONTRACT fileStructure: "src/shared/ipc.ts — ... + RendererApi interface (the contextBridge surface)"). This task assumes it exists; it only references the type.

- [ ] **Step 2: Replace src/preload/index.d.ts with the augmented declarations (full file)**

Overwrite `D:\aicode\pet\src\preload\index.d.ts` with exactly:

```ts
// Global Window augmentation for the typed contextBridge surfaces.
// Pet window exposes window.petApi; panel window exposes window.panelApi.
// Both are typed from the single source of truth in src/shared.
import type { ElectronAPI } from '@electron-toolkit/preload'
import type { RendererApi, PanelApi } from '@shared/ipc'

// PanelApi (the panel-window contextBridge surface — a strict subset of the pet
// surface: read/write settings + subscribe to settings:changed) has its single
// source of truth in src/shared/ipc.ts (authored by Task 4.2). It is imported
// here, never re-declared, so window.panelApi stays one type.

declare global {
  interface Window {
    electron: ElectronAPI
    petApi: RendererApi
    panelApi: PanelApi
  }
}

export {}
```

- [ ] **Step 3: Type-check the whole project (renderer + preload) against the new globals**

Command:

```
npx tsc --noEmit -p tsconfig.web.json
```

Expected: exits with code 0 and no output. (PanelApp.tsx's `window.panelApi.getSettings()` and PetApp.tsx's `window.petApi.*` now resolve against the declared globals. If `RendererApi` lacks a member a later group's renderer calls, tsc reports it here — that is a CONTRACT-conformance signal, not a defect in this task.)

- [ ] **Step 4: Manual verification — confirm no `any`-typed window access remains**

1. Run: `npx --yes grep-cli@latest "window.petApi" src/renderer/src/pet/PetApp.tsx` — EXPECTED: at least one match, and Step 3's `tsc` passed, proving the access is typed (not `any`).
2. Run: `npx --yes grep-cli@latest "window.panelApi" src/renderer/src/panel/PanelApp.tsx` — EXPECTED: at least one match, typed via `PanelApi`.

(If PanelApp.tsx / PetApp.tsx do not exist yet, Step 3 still passes on the .d.ts alone; the typed-access checks become meaningful once Tasks 7.6 and the renderer groups land. Re-run after Task 7.6.)

- [ ] **Step 5: Commit**

```
git add src/preload/index.d.ts && git commit -m "$(cat <<'EOF'
feat(preload): declare typed window.petApi (RendererApi) and window.panelApi (PanelApi)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4.4: Wire `setInteractive` into the pet preload and register the main-side IPC handler

**Files:**
- Modify: `D:\aicode\pet\src\preload\index.ts` (add `setInteractive` and `onPassthroughModeChanged` members to the `buildPetApi` object authored by 7.3 — append only, do not re-author the base factory or the `contextBridge.exposeInMainWorld` glue)
- Modify: `D:\aicode\pet\src\main\ipc.ts` (add ONLY the `ipcMain.on(IPC.PET_SET_INTERACTIVE, ...)` handler line inside the existing `registerIpcHandlers` authored by 7.7 — do not redefine `IpcDeps`, `passthrough` is already canonical)

- [ ] **Step 1: Add `setInteractive` + `onPassthroughModeChanged` to the pet preload `buildPetApi`**

  The pet preload (`D:\aicode\pet\src\preload\index.ts`) is authored by an earlier group (7.3) as a `buildPetApi(ipc: IpcRenderer): RendererApi` factory that returns the full pet contextBridge surface and is exposed via `contextBridge.exposeInMainWorld('petApi', buildPetApi(ipcRenderer))`. Task 4.4 only APPENDS two members to the object that `buildPetApi` returns — `setInteractive` and `onPassthroughModeChanged`. Do NOT re-author the base members (`getSettings`, `setSettings`, `openPanel`, `onSettingsChanged`), do NOT touch the `contextBridge.exposeInMainWorld` glue line, and do NOT add the `drag` object (that belongs to group 5.3).

  Inside the object literal returned by `buildPetApi`, add these two members alongside the existing base members:

  ```ts
    // --- 4.4 adds ---
    setInteractive: (interactive: boolean): void => {
      ipc.send(IPC.PET_SET_INTERACTIVE, { interactive })
    },
    onPassthroughModeChanged: (
      cb: (payload: PassthroughModeChangedPayload) => void
    ): Unsubscribe => {
      const l = (_e: unknown, p: PassthroughModeChangedPayload): void => cb(p)
      ipc.on(IPC.PET_PASSTHROUGH_MODE_CHANGED, l)
      return () => ipc.removeListener(IPC.PET_PASSTHROUGH_MODE_CHANGED, l)
    },
  ```

  Note the parameter name is `ipc` (the `IpcRenderer` argument of `buildPetApi`), not the bare `ipcRenderer` module import — match the surrounding base members which already call `ipc.invoke(...)` / `ipc.send(...)` / `ipc.on(...)`.

  Ensure the file's top-of-module imports include the symbols these two members reference (add any that the 7.3 base left out — `IPC`, `Unsubscribe`, and `PassthroughModeChangedPayload`; `SettingsChangedPayload` is already imported by the 7.3 base for `onSettingsChanged`). Do NOT remove imports the base already has:

  ```ts
  import { IPC, type Unsubscribe } from '@shared/ipc'
  import type { PassthroughModeChangedPayload } from '@shared/types'
  ```

- [ ] **Step 2: Add the main-side `pet:setInteractive` handler to `registerIpcHandlers`**

  The IPC base (`D:\aicode\pet\src\main\ipc.ts`) is authored by an earlier group (7.7) with the canonical single-arg signature `registerIpcHandlers(deps: IpcDeps): IpcHandles`, where `IpcDeps` ALREADY declares `passthrough: import('./passthrough').PassthroughController`. Task 4.4 must NOT redefine `IpcDeps`, must NOT change the function signature or return type, and must NOT re-author the base handlers (`settings:get`, `settings:set` + broadcast, `pet:open-panel`) or the `{ flushPersist }` return.

  Add EXACTLY one handler registration inside the existing `registerIpcHandlers` function body, alongside the base handlers (before the `return` of `IpcHandles`):

  ```ts
    // pet:setInteractive — fire-and-forget hit-test result from the pet renderer.
    // Gated by resolveIgnoreMouse inside the controller: honored only in 'auto'.
    ipcMain.on(IPC.PET_SET_INTERACTIVE, (_e, payload) =>
      deps.passthrough.setOverInteractive(Boolean(payload?.interactive))
    )
  ```

  `ipcMain` is already imported at the top of `ipc.ts` by the 7.7 base (`import { ipcMain } from 'electron'`) and `IPC` is already imported from `@shared/ipc`; add neither again. Do NOT add `SetInteractivePayload` typing on the handler parameter — `Boolean(payload?.interactive)` is intentionally defensive and the canonical contract uses the untyped `(_e, payload)` form.

- [ ] **Step 3: Confirm the whole project compiles**

  Command:
  ```
  npx tsc --noEmit -p tsconfig.node.json && npx tsc --noEmit -p tsconfig.web.json
  ```
  Expected: exit code 0, no errors in `src/preload/index.ts` or `src/main/ipc.ts`.

- [ ] **Step 4: Commit**

  ```
  git add src/preload/index.ts src/main/ipc.ts
  git commit -m "feat: wire pet:setInteractive IPC into PassthroughController + passthrough-mode preload bridge

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 5.3: Implement the manual-drag controller (Electron glue) with debounced persist + clamp on end

**Files:**
- Create: `D:\aicode\pet\src\main\dragController.ts`
- Modify: `D:\aicode\pet\src\main\ipc.ts` (EXTEND the 7.7-authored `registerIpcHandlers(deps)` in place: build the drag controller + persist sink, register `pet:drag-start` / `pet:drag-move` / `pet:drag-end`, and replace 7.7's placeholder `flushPersist` in the returned `IpcHandles` with the real controller flush)
- Create: `D:\aicode\pet\src\renderer\src\pet\dragState.ts`
- Modify: `D:\aicode\pet\src\preload\index.ts` (EXTEND the 7.3-authored `buildPetApi(ipc)` by adding the `drag` object — do NOT re-author the base or the `exposeInMainWorld` glue)
- Modify: `D:\aicode\pet\src\renderer\src\pet\PetApp.tsx` (wire the drag handle gesture on the pet body; pin the window interactive for the whole gesture)

> Note on technique (per research R5 + R3 conflict with passthrough): we use MANUAL drag — `mousedown` on the pet, track `mousemove`, and `win.setPosition` in main — NOT `-webkit-app-region: drag`. A `-webkit-app-region: drag` region ignores ALL pointer events, so it (a) swallows the pet's own clicks and (b) is fundamentally incompatible with the dynamic `setIgnoreMouseEvents(true,{forward:true})` mouse-passthrough this plan uses. Manual drag coexists with passthrough and the tray, and lets a sub-threshold gesture still register as a click. The fixed cursor->window offset is captured once at `drag-start` via `screen.getCursorScreenPoint()` to avoid frame-to-frame drift.
>
> CRITICAL passthrough-during-drag rule: `setIgnoreMouseEvents(true,{forward:true})` only forwards `mousemove`, NOT `mouseup`. In `auto` mode the hit-test (`usePassthrough`, owned by another group) can flip the window to click-through mid-drag the instant the cursor leaves a solid pet pixel; the renderer would then stop receiving `mouseup`, `drag-end` would never fire, and the next drag would reuse a stale offset (the window keeps following the cursor). To prevent this, the renderer PINS the window interactive for the entire gesture: on `mousedown` it calls `window.petApi.setInteractive(true)` AND sets a module-scoped `isPetDragging` flag (exported from a tiny shared renderer module this group owns) that `usePassthrough` MUST honor by skipping its hit-test while the flag is true; on `mouseup` it restores normal hit-testing. This holds `setIgnoreMouseEvents(false)` for the whole drag so `mouseup` always reaches the renderer.
>
> Ownership note (per integration contract §§5, 7 and the ownership map): `src/main/ipc.ts` is BASE-authored by task 7.7 (`registerIpcHandlers(deps: IpcDeps): IpcHandles` — single `deps` arg, settings:get/set + pet:open-panel, returning a `{ flushPersist: () => {} }` placeholder). `src/preload/index.ts` is BASE-authored by task 7.3 (`buildPetApi(ipc)` with getSettings/setSettings/openPanel/onSettingsChanged) and extended by 4.4 (setInteractive/onPassthroughModeChanged). This task (5.3) ONLY extends those two files in place — it never re-authors their base, never re-declares `IpcDeps`/`IpcHandles`, never imports `getPetWindow` directly (it uses the injected `deps.getPetWindow`), and never edits `src/main/index.ts` (task 6.4 solely owns the bootstrap, including calling `ipcHandles.flushPersist()` on `before-quit`).

- [ ] **Step 1: Create the drag controller**

  Create `D:\aicode\pet\src\main\dragController.ts` with the full code below. It receives its electron seams as callbacks/params (a `getWindow()` and a `persistPosition` sink) so the pure pieces stay testable. Uses the pure `debounce` and `clampPositionToDisplays`. The `persistPosition` sink is the only place that writes/broadcasts; the controller itself never broadcasts, so the quit-time flush path can persist without touching any (possibly destroyed) `webContents`.

  ```ts
  // ============================================================================
  // src/main/dragController.ts
  // Manual-drag glue for the transparent pet window. Coexists with mouse
  // passthrough (we deliberately avoid -webkit-app-region: drag — see plan note).
  // On drag-end the new bounds are clamped into connected displays and the
  // position is debounce-persisted to settings via the injected persistPosition
  // sink. The controller never broadcasts itself; persist+broadcast policy lives
  // in the sink (see ipc.ts), so flushPersist() at quit time stays safe.
  // ============================================================================
  import { screen, type BrowserWindow, type Display } from 'electron'
  import { clampPositionToDisplays } from '@shared/position'
  import { debounce } from '@shared/debounce'
  import type { PetPosition, DisplayBounds } from '@shared/types'

  /** Persist debounce window (ms) — coalesces the end-of-drag write. */
  const PERSIST_DEBOUNCE_MS = 400

  function toDisplayBounds(displays: Display[]): DisplayBounds[] {
    return displays.map((d) => ({
      id: d.id,
      workArea: {
        x: d.workArea.x,
        y: d.workArea.y,
        width: d.workArea.width,
        height: d.workArea.height
      }
    }))
  }

  export interface DragController {
    onStart(): void
    onMove(): void
    onEnd(): void
    /** Flush any pending debounced persist (e.g. before quit). */
    flushPersist(): void
  }

  /**
   * Creates the manual-drag controller.
   * @param getWindow       returns the live pet BrowserWindow (or null).
   * @param persistPosition called with the final clamped PetPosition to save.
   */
  export function createDragController(
    getWindow: () => BrowserWindow | null,
    persistPosition: (pos: PetPosition) => void
  ): DragController {
    // Fixed cursor->window offset captured at drag-start; null when not dragging.
    let offset: { dx: number; dy: number } | null = null

    const debouncedPersist = debounce((pos: PetPosition) => {
      persistPosition(pos)
    }, PERSIST_DEBOUNCE_MS)

    const onStart = (): void => {
      const win = getWindow()
      if (!win || win.isDestroyed()) return
      const cursor = screen.getCursorScreenPoint()
      const [wx, wy] = win.getPosition()
      offset = { dx: cursor.x - wx, dy: cursor.y - wy }
    }

    const onMove = (): void => {
      if (!offset) return
      const win = getWindow()
      if (!win || win.isDestroyed()) return
      const cursor = screen.getCursorScreenPoint()
      win.setPosition(cursor.x - offset.dx, cursor.y - offset.dy)
    }

    const onEnd = (): void => {
      offset = null
      const win = getWindow()
      if (!win || win.isDestroyed()) return
      const [x, y] = win.getPosition()
      const [width, height] = win.getSize()
      const displays = toDisplayBounds(screen.getAllDisplays())
      const clamped = clampPositionToDisplays({ x, y, width, height }, displays)
      if (clamped.x !== x || clamped.y !== y) {
        win.setPosition(clamped.x, clamped.y)
      }
      debouncedPersist(clamped)
    }

    const flushPersist = (): void => {
      debouncedPersist.flush()
    }

    return { onStart, onMove, onEnd, flushPersist }
  }
  ```

- [ ] **Step 2: Extend `registerIpcHandlers` in `ipc.ts` with the drag handlers + real flush**

  In `D:\aicode\pet\src\main\ipc.ts`, EXTEND the existing 7.7-authored `registerIpcHandlers(deps: IpcDeps): IpcHandles` IN PLACE. Do NOT re-declare `IpcDeps`/`IpcHandles`, do NOT add a fallback `broadcastSettingsChanged`, and do NOT import `getPetWindow` from `./windows/windowManager` — the live getter and the destroyed-safe broadcaster are injected via `deps` (`deps.getPetWindow`, `deps.broadcastSettingsChanged`), per integration contract §5. `ipcMain` and `IPC` are already imported by the 7.7 base; add ONLY the `createDragController` import.

  Inside the function body, construct the controller with the persist sink (the canonical §5 sink: `deps.settingsStore.set({ petPosition: pos })` then `deps.broadcastSettingsChanged()` — both already destroyed-safe), register the three fire-and-forget drag channels using the `IPC.*` constants (never string literals), and REPLACE 7.7's placeholder `flushPersist` in the returned `IpcHandles` with the real `() => dragController.flushPersist()`.

  Add this import alongside the 7.7 base imports:

  ```ts
  // 5.3 adds:
  import { createDragController } from './dragController'
  ```

  Inside `registerIpcHandlers(deps)`, AFTER the 7.7 base registrations (settings:get/set, pet:open-panel) and the 4.4 `pet:setInteractive` handler, add:

  ```ts
  // --- 5.3: manual-drag controller + channels ---
  // Persist sink (canonical, contract §5/§7): write the clamped position to disk,
  // then broadcast full Settings to every live window via the injected, destroyed-
  // safe broadcaster. The controller never broadcasts itself, so the quit-time
  // flush path can persist even after windows are destroyed.
  const dragController = createDragController(deps.getPetWindow, (pos) => {
    deps.settingsStore.set({ petPosition: pos })
    deps.broadcastSettingsChanged()
  })

  ipcMain.on(IPC.PET_DRAG_START, () => dragController.onStart())
  ipcMain.on(IPC.PET_DRAG_MOVE, () => dragController.onMove())
  ipcMain.on(IPC.PET_DRAG_END, () => dragController.onEnd())
  ```

  Then REPLACE the 7.7 placeholder return. The 7.7 base ends with `return { flushPersist: () => {} }`; change that single returned object's `flushPersist` to the real controller flush so it satisfies the canonical `IpcHandles` shape (contract §5):

  ```ts
  // Was (7.7 placeholder): return { flushPersist: () => {} }
  return { flushPersist: () => dragController.flushPersist() }
  ```

  Note on the quit path: 6.4's bootstrap captures `const ipcHandles = registerIpcHandlers(deps)` and calls `ipcHandles.flushPersist()` on `before-quit`. That runs `debouncedPersist.flush()`, which invokes the same sink above. At quit time, if every window is already destroyed, `deps.settingsStore.set` still writes the file (disk persist is the only thing that matters at quit) and the destroyed-safe `deps.broadcastSettingsChanged()` simply sends to nothing — no throw, clean shutdown. (5.3 does NOT touch `src/main/index.ts`; 6.4 solely owns the bootstrap wiring.)

- [ ] **Step 3: Create the renderer-local drag-state flag**

  Create `D:\aicode\pet\src\renderer\src\pet\dragState.ts` — a tiny module-scoped flag this group owns so the gesture can suppress the auto-mode hit-test for the WHOLE drag (preventing the mid-drag click-through flip that would strand `mouseup`):

  ```ts
  // ============================================================================
  // src/renderer/src/pet/dragState.ts
  // Renderer-local flag shared between PetApp's drag gesture and usePassthrough.
  // While true, usePassthrough MUST skip its hit-test so the window stays
  // interactive (setIgnoreMouseEvents(false)) for the entire drag — otherwise
  // an auto-mode passthrough flip would forward mousemove but NOT mouseup,
  // stranding the drag and leaving a stale offset in the main process.
  // ============================================================================

  let dragging = false

  /** True while a pet drag gesture is in progress. */
  export function isPetDragging(): boolean {
    return dragging
  }

  /** Set by PetApp on mousedown/mouseup around the drag gesture. */
  export function setPetDragging(value: boolean): void {
    dragging = value
  }
  ```

  Contract for the hit-test owner (`usePassthrough`, owned by another group): at the top of its `mousemove` hit-test handler it MUST early-return when `isPetDragging()` is true (i.e. `if (isPetDragging()) return`), so it never calls `window.petApi.setInteractive(false)` mid-drag. Surface this as a one-line requirement to that group; it is the only coupling.

- [ ] **Step 4: Add `drag.*` to `buildPetApi` in the preload**

  In `D:\aicode\pet\src\preload\index.ts`, EXTEND the existing 7.3-authored `buildPetApi(ipc)` by adding the `drag` object to the returned `RendererApi`. Do NOT re-author the 7.3 base members (getSettings/setSettings/openPanel/onSettingsChanged), the 4.4 additions (setInteractive/onPassthroughModeChanged), or the `contextBridge.exposeInMainWorld('petApi', petApi)` glue. `IPC` is already imported by the 7.3 base from `@shared/ipc`. Use the injected `ipc` (the `IpcRenderer` passed to `buildPetApi`) and the `IPC.*` constants — never string literals.

  Inside the object returned by `buildPetApi(ipc)`, alongside the existing members, add:

  ```ts
    // --- 5.3 adds ---
    drag: {
      start: () => ipc.send(IPC.PET_DRAG_START),
      move: () => ipc.send(IPC.PET_DRAG_MOVE),
      end: () => ipc.send(IPC.PET_DRAG_END)
    }
  ```

  This matches the canonical `RendererApi.drag` shape (`{ start(): void; move(): void; end(): void }`) from integration contract §6.

- [ ] **Step 5: Wire the drag gesture in `PetApp.tsx` and pin the window interactive during the gesture**

  In `D:\aicode\pet\src\renderer\src\pet\PetApp.tsx`, attach the manual-drag gesture to the pet body element. A 4px threshold distinguishes a click from a drag (so taps still register as clicks for later plans). On mousedown we set the shared dragging flag and force the window interactive via `window.petApi.setInteractive(true)`; on mouseup we clear the flag and let the hit-test resume. Use `screenX/screenY` for the threshold; the actual position math happens in main via `getCursorScreenPoint`.

  ```tsx
  import { useEffect, useRef } from 'react'
  import { setPetDragging } from './dragState'

  // Inside PetApp, with a ref on the draggable pet body:
  const dragState = useRef<{ x: number; y: number; dragging: boolean } | null>(
    null
  )
  const DRAG_THRESHOLD = 4

  const handlePetMouseDown = (e: React.MouseEvent): void => {
    if (e.button !== 0) return // left button only
    dragState.current = { x: e.screenX, y: e.screenY, dragging: false }
    // Pin the window interactive for the WHOLE gesture so the auto-mode
    // hit-test can't flip it to click-through and steal the upcoming mouseup.
    setPetDragging(true)
    window.petApi.setInteractive(true)
    window.petApi.drag.start()
  }

  useEffect(() => {
    const handleMove = (e: MouseEvent): void => {
      const s = dragState.current
      if (!s) return
      if (
        !s.dragging &&
        Math.hypot(e.screenX - s.x, e.screenY - s.y) > DRAG_THRESHOLD
      ) {
        s.dragging = true
      }
      if (s.dragging) {
        window.petApi.drag.move()
      }
    }
    const handleUp = (): void => {
      const s = dragState.current
      if (!s) return
      window.petApi.drag.end()
      // s.dragging === false here means it was a click, not a drag.
      dragState.current = null
      // Release the interactive pin; usePassthrough resumes hit-testing and
      // will re-apply the correct interactive/passthrough state on next move.
      setPetDragging(false)
    }
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [])

  // ...attach onMouseDown={handlePetMouseDown} to the <PlaceholderPet /> wrapper
  // (the .pet-body interactive region, not the decorative pointer-events:none layer).
  ```

- [ ] **Step 6: Manual verification**

  Run the app:
  ```
  npm run dev
  ```

  Verify on-screen, in order:
  1. The transparent pet appears (placeholder). Move the cursor over the solid pet body — it becomes interactive (cursor does not click through). This confirms drag does not break passthrough (the whole reason we avoided `-webkit-app-region: drag`).
  2. Press and hold the LEFT mouse button on the pet body and move the mouse. The pet window follows the cursor 1:1 with no jitter and no drift, including when you drag the cursor briefly off the window's original area.
  3. PASSTHROUGH-FLIP REGRESSION CHECK (the load-bearing one): with passthrough mode in `auto`, press and hold on the pet body, then drag FAST so the cursor moves well OUTSIDE the solid pet pixels (e.g. whip it across the empty/transparent part of the window and beyond), then RELEASE the button while the cursor is over a transparent/empty area. Expected: the window keeps following until release, `mouseup` is honored, and the pet STOPS exactly where you release it. It must NOT keep following the cursor after release (a stuck window after release means the interactive pin in Step 5 failed and the hit-test flipped the window to click-through mid-drag, stranding `mouseup`).
  4. Drag the pet across to a second monitor (if available); it tracks correctly across the monitor boundary (uses global `getCursorScreenPoint`, not clientX/Y).
  5. Release the mouse on a normal drag. The pet stays where you dropped it. A single quick click (press+release without moving past ~4px) does NOT move the pet — it is treated as a click, and hit-test interactivity resumes normally afterward (cursor over the body is still interactive, off it is click-through).
  6. Drag the pet so part of it would go off the right/bottom edge and release. On release it is pulled back fully on-screen, above the taskbar (clamped to `workArea`).

  Expected: all 6 behaviors hold exactly as described. Drag is smooth, position survives release, the auto-mode passthrough flip cannot strand a drag, and off-edge drops snap back inside the work area.

- [ ] **Step 7: Commit**

  Command:
  ```
  git add src/main/dragController.ts src/main/ipc.ts src/renderer/src/pet/dragState.ts src/preload/index.ts src/renderer/src/pet/PetApp.tsx && git commit -m "Add manual drag-to-reposition with clamp, debounced persist, and interactive pin during gesture"
  ```

---

### Task 5.4: Restore saved position (clamped) on launch + re-clamp on display changes

**Files:**
- Modify: `D:\aicode\pet\src\main\windows\petWindow.ts` (add the `restorePetPosition` named export so `displayWatcher`/tests reuse the same clamp path — base factory authored by 3.1)
- Create: `D:\aicode\pet\src\main\displayWatcher.ts` (re-clamp on `display-removed` / `display-metrics-changed`)
- Test: `D:\aicode\pet\src\main\displayWatcher.test.ts` (re-clamp fires on display events; disposer detaches listeners)

> Note: restore uses the SAME pure `clampPositionToDisplays` as drag-end (single source of truth), fed `screen.getAllDisplays()` mapped to `DisplayBounds`. The `screen` module is only touched after `app.whenReady()` per research R5.
>
> Ownership (per integration contract §0, §1, §2, §4, §9): `petWindow.ts`'s `createPetWindow(settings: Settings)` BASE is authored by Task 3.1 and already does the launch clamp inline. Task 5.4 ONLY adds the `restorePetPosition` named export to that file (it does NOT change `createPetWindow`'s signature, does NOT add a `deps`/store bag, and does NOT add a second `ready-to-show` listener). Task 5.4 authors `displayWatcher.ts` with the canonical name `startDisplayWatcher(getWindow)` returning a disposer. Task 5.4 does NOT edit `src/main/index.ts` — Task 6.4 is the SOLE owner of the bootstrap and is the one that calls `startDisplayWatcher(getPetWindow)` and flushes pending persist on `before-quit`.

- [ ] **Step 1: Add the `restorePetPosition` named export to `petWindow.ts`**

  The pet window factory `createPetWindow(settings: Settings)` is authored by Task 3.1 and already performs the launch-time clamp inline (single window-creation site). Task 5.4's ONLY change to `D:\aicode\pet\src\main\windows\petWindow.ts` is to ADD the `restorePetPosition` named export so the display watcher and tests can reuse the exact same clamp path. Do NOT change `createPetWindow`'s `settings: Settings` parameter, do NOT add a `deps`/store bag, and do NOT add a second `ready-to-show` listener.

  Append the following to `D:\aicode\pet\src\main\windows\petWindow.ts`. The file already imports `screen` and `BrowserWindow` from `'electron'` and `clampPositionToDisplays` from `'@shared/position'`; add the `Display` named type to the existing `'electron'` import and `PetPosition` / `DisplayBounds` to the existing `'@shared/types'` import if not already present:

  ```ts
  import { screen, type BrowserWindow, type Display } from 'electron'
  import { clampPositionToDisplays } from '@shared/position'
  import type { PetPosition, DisplayBounds } from '@shared/types'

  function toDisplayBounds(displays: Display[]): DisplayBounds[] {
    return displays.map((d) => ({
      id: d.id,
      workArea: {
        x: d.workArea.x,
        y: d.workArea.y,
        width: d.workArea.width,
        height: d.workArea.height
      }
    }))
  }

  /**
   * Restores the saved pet-window bounds, clamped to currently-connected
   * displays so an off-screen / removed-monitor position is pulled on-screen.
   * Exported so the display watcher and tests reuse the same clamp path as the
   * launch restore that createPetWindow performs inline.
   * Must be called AFTER app is ready (uses the screen module).
   */
  export function restorePetPosition(
    win: BrowserWindow,
    saved: PetPosition
  ): void {
    const displays = toDisplayBounds(screen.getAllDisplays())
    const clamped = clampPositionToDisplays(saved, displays)
    win.setBounds({
      x: clamped.x,
      y: clamped.y,
      width: clamped.width,
      height: clamped.height
    })
  }
  ```

  Note: `createPetWindow` already clamps the saved `settings.petPosition` inline at construction time and gates `win.show()` on `settings.petVisible` (authored by Task 3.1) — do NOT add a separate `restorePetPosition(win, ...)` call inside `createPetWindow`. This export exists purely so the watcher and the test below can drive the identical clamp path.

- [ ] **Step 2: Write the failing test for the display watcher**

  Create `D:\aicode\pet\src\main\displayWatcher.test.ts` with the full code below. It mocks `electron`'s `screen` so the test can capture the registered listeners, invoke them, and assert the pet window is re-clamped. It also asserts the returned disposer removes both listeners.

  ```ts
  // ============================================================================
  // src/main/displayWatcher.test.ts
  // ============================================================================
  import { describe, it, expect, vi, beforeEach } from 'vitest'

  // ---- Mock the electron `screen` module so we can capture listeners. --------
  type Listener = (...args: unknown[]) => void
  const listeners = new Map<string, Listener[]>()

  const fakeScreen = {
    on: vi.fn((event: string, cb: Listener) => {
      const arr = listeners.get(event) ?? []
      arr.push(cb)
      listeners.set(event, arr)
    }),
    removeListener: vi.fn((event: string, cb: Listener) => {
      const arr = listeners.get(event) ?? []
      listeners.set(
        event,
        arr.filter((l) => l !== cb)
      )
    }),
    getAllDisplays: vi.fn(() => [
      {
        id: 1,
        workArea: { x: 0, y: 0, width: 1920, height: 1040 }
      }
    ])
  }

  vi.mock('electron', () => ({
    screen: fakeScreen
  }))

  // Import AFTER vi.mock so the mock is in place.
  import { startDisplayWatcher } from './displayWatcher'

  function emit(event: string, ...args: unknown[]): void {
    for (const l of listeners.get(event) ?? []) l(...args)
  }

  function makeWindow(
    pos: [number, number],
    size: [number, number]
  ): {
    win: { getPosition: () => number[]; getSize: () => number[]; isDestroyed: () => boolean; setBounds: ReturnType<typeof vi.fn> }
  } {
    const win = {
      getPosition: () => pos,
      getSize: () => size,
      isDestroyed: () => false,
      setBounds: vi.fn()
    }
    return { win }
  }

  describe('startDisplayWatcher', () => {
    beforeEach(() => {
      listeners.clear()
      vi.clearAllMocks()
      fakeScreen.getAllDisplays.mockReturnValue([
        { id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1040 } }
      ])
    })

    it('re-clamps an off-screen window when a display is removed', () => {
      // Window sitting far off-screen (e.g. on a now-removed monitor).
      const { win } = makeWindow([99999, 99999], [300, 300])
      startDisplayWatcher(() => win as never)

      emit('display-removed')

      expect(win.setBounds).toHaveBeenCalledTimes(1)
      const bounds = win.setBounds.mock.calls[0][0] as {
        x: number
        y: number
        width: number
        height: number
      }
      // Must be pulled back inside the single 1920x1040 work area.
      expect(bounds.x).toBeLessThanOrEqual(1920 - 300)
      expect(bounds.y).toBeLessThanOrEqual(1040 - 300)
      expect(bounds.width).toBe(300)
      expect(bounds.height).toBe(300)
    })

    it('re-clamps on display-metrics-changed when bounds/workArea changed', () => {
      const { win } = makeWindow([99999, 99999], [300, 300])
      startDisplayWatcher(() => win as never)

      emit('display-metrics-changed', {}, { id: 1 }, ['workArea'])

      expect(win.setBounds).toHaveBeenCalledTimes(1)
    })

    it('ignores display-metrics-changed when only unrelated metrics changed', () => {
      const { win } = makeWindow([99999, 99999], [300, 300])
      startDisplayWatcher(() => win as never)

      emit('display-metrics-changed', {}, { id: 1 }, ['rotation'])

      expect(win.setBounds).not.toHaveBeenCalled()
    })

    it('does nothing when the already-on-screen window is unchanged', () => {
      const { win } = makeWindow([10, 10], [300, 300])
      startDisplayWatcher(() => win as never)

      emit('display-removed')

      expect(win.setBounds).not.toHaveBeenCalled()
    })

    it('does nothing when there is no live window', () => {
      startDisplayWatcher(() => null)
      expect(() => emit('display-removed')).not.toThrow()
    })

    it('disposer removes both listeners', () => {
      const { win } = makeWindow([10, 10], [300, 300])
      const dispose = startDisplayWatcher(() => win as never)

      dispose()

      expect(fakeScreen.removeListener).toHaveBeenCalledWith(
        'display-removed',
        expect.any(Function)
      )
      expect(fakeScreen.removeListener).toHaveBeenCalledWith(
        'display-metrics-changed',
        expect.any(Function)
      )
      expect(listeners.get('display-removed') ?? []).toHaveLength(0)
      expect(listeners.get('display-metrics-changed') ?? []).toHaveLength(0)
    })
  })
  ```

- [ ] **Step 3: Run the test and watch it FAIL**

  Command:
  ```
  npx vitest run src/main/displayWatcher.test.ts
  ```

  Expected: FAIL. Because `src/main/displayWatcher.ts` does not exist yet, Vitest reports a module-resolution / import error such as:
  ```
  Error: Failed to load url ./displayWatcher (resolved id: ./displayWatcher) ... Does the file exist?
  ```
  (No tests pass; the suite errors out on the missing import.)

- [ ] **Step 4: Create the display watcher (minimal implementation)**

  Create `D:\aicode\pet\src\main\displayWatcher.ts` with the full code below. It subscribes to `display-removed` and `display-metrics-changed`, and re-clamps the pet window's current bounds into the connected displays using the same pure helper. Returns a disposer that detaches the listeners. The metrics handler types its event parameter via the `Event` type from the single `'electron'` import and the display arg via the named `Display` export.

  ```ts
  // ============================================================================
  // src/main/displayWatcher.ts
  // Re-clamps the pet window into connected displays when the display
  // configuration changes (monitor unplugged / resolution / workArea change),
  // so a previously valid position can't end up off-screen. Uses the SAME pure
  // clampPositionToDisplays as launch-restore and drag-end.
  // ============================================================================
  import { screen, type BrowserWindow, type Display, type Event } from 'electron'
  import { clampPositionToDisplays } from '@shared/position'
  import type { DisplayBounds } from '@shared/types'

  function toDisplayBounds(displays: Display[]): DisplayBounds[] {
    return displays.map((d) => ({
      id: d.id,
      workArea: {
        x: d.workArea.x,
        y: d.workArea.y,
        width: d.workArea.width,
        height: d.workArea.height
      }
    }))
  }

  function reclamp(getWindow: () => BrowserWindow | null): void {
    const win = getWindow()
    if (!win || win.isDestroyed()) return
    const [x, y] = win.getPosition()
    const [width, height] = win.getSize()
    const displays = toDisplayBounds(screen.getAllDisplays())
    const clamped = clampPositionToDisplays({ x, y, width, height }, displays)
    if (
      clamped.x !== x ||
      clamped.y !== y ||
      clamped.width !== width ||
      clamped.height !== height
    ) {
      win.setBounds({
        x: clamped.x,
        y: clamped.y,
        width: clamped.width,
        height: clamped.height
      })
    }
  }

  /**
   * Subscribes to display changes and re-clamps the pet window.
   * Canonical name + signature per integration contract §2:
   * startDisplayWatcher(getWindow) returning a disposer.
   * 6.4's bootstrap calls startDisplayWatcher(getPetWindow).
   * Must be called AFTER app.whenReady(). Returns a disposer.
   */
  export function startDisplayWatcher(
    getWindow: () => BrowserWindow | null
  ): () => void {
    const onRemoved = (): void => reclamp(getWindow)
    const onMetrics = (
      _event: Event,
      _display: Display,
      changedMetrics: string[]
    ): void => {
      if (
        changedMetrics.includes('bounds') ||
        changedMetrics.includes('workArea')
      ) {
        reclamp(getWindow)
      }
    }

    screen.on('display-removed', onRemoved)
    screen.on('display-metrics-changed', onMetrics)

    return () => {
      screen.removeListener('display-removed', onRemoved)
      screen.removeListener('display-metrics-changed', onMetrics)
    }
  }
  ```

- [ ] **Step 5: Run the test and watch it PASS**

  Command:
  ```
  npx vitest run src/main/displayWatcher.test.ts
  ```

  Expected: PASS. All 6 tests in `startDisplayWatcher` green:
  ```
   ✓ src/main/displayWatcher.test.ts (6)
     ✓ startDisplayWatcher (6)
       ✓ re-clamps an off-screen window when a display is removed
       ✓ re-clamps on display-metrics-changed when bounds/workArea changed
       ✓ ignores display-metrics-changed when only unrelated metrics changed
       ✓ does nothing when the already-on-screen window is unchanged
       ✓ does nothing when there is no live window
       ✓ disposer removes both listeners

   Test Files  1 passed (1)
        Tests  6 passed (6)
  ```

- [ ] **Step 6: Manual verification**

  > Wiring note: Task 6.4's bootstrap is the SOLE owner of `src/main/index.ts` and is responsible for calling `startDisplayWatcher(getPetWindow)`, capturing `ipcHandles = registerIpcHandlers(deps)`, and calling `ipcHandles.flushPersist()` + the watcher disposer on `before-quit`. Task 5.4 itself does NOT edit `index.ts`. The manual checks below assume Task 6.4's bootstrap is already wired (it is, per the integration contract §4).

  Restart-survival check:
  1. Run `npm run dev`. Drag the pet to a clearly distinct spot (e.g. lower-right quadrant) and release.
  2. Fully quit the app (tray -> Quit, or stop and re-run `npm run dev`). Relaunch.
  3. Expected: the pet reappears at the spot you left it, NOT at the default `{x:100,y:100}`. Position survived the restart.

  Drag-then-immediate-quit check (exercises the `before-quit` flush wired by 6.4):
  4. Run `npm run dev`. Drag the pet to a new distinct spot and, WITHIN the 400ms debounce window, immediately quit via tray -> Quit (do this quickly so the debounced write has not yet fired on its own timer).
  5. Relaunch `npm run dev`. Expected: the pet is at the spot from step 4, proving `ipcHandles.flushPersist()` flushed the pending write at quit rather than losing it.

  Off-screen-recovery check (exercises the inline launch clamp in `createPetWindow` + `restorePetPosition`'s shared clamp path):
  6. Quit the app. Open the settings file and set an off-screen `petPosition`. The path is `userData/settings.json`; on Windows `%APPDATA%\<app>\settings.json`. Edit `petPosition` to `{ "x": 99999, "y": 99999, "width": 300, "height": 300 }` and save.
  7. Relaunch `npm run dev`.
  8. Expected: the pet appears fully on-screen (pulled back into the primary display's work area, above the taskbar), NOT at 99999,99999 (which would be invisible). This proves the launch restore clamps a saved off-screen position.

  Visibility check (exercises `settings.petVisible` honored by `createPetWindow`):
  9. Quit the app. In the same `settings.json`, set `"petVisible": false` and save. Relaunch `npm run dev`.
  10. Expected: NO pet window appears on screen on launch (the window is created but not shown because `createPetWindow` gates `win.show()` on `settings.petVisible`). Toggle it back via tray -> Show, or restore `"petVisible": true` and relaunch, and the pet reappears.

  Live display-change check (if a second monitor is available — exercises `startDisplayWatcher`):
  11. With the pet sitting on a secondary monitor, disconnect that monitor (or disable it in display settings).
  12. Expected: the pet jumps back onto a still-connected display's work area within a moment (driven by `display-removed` / `display-metrics-changed`), rather than vanishing onto the removed monitor.

- [ ] **Step 7: Commit**

  Command:
  ```
  git add src/main/windows/petWindow.ts src/main/displayWatcher.ts src/main/displayWatcher.test.ts && git commit -m "Restore clamped pet position on launch (shared clamp export) + re-clamp on display changes"
  ```

---

### Task 7.6: Create the panel renderer route — panel.html, panel/main.tsx, PanelApp.tsx, panel.css

**Files:**
- Create: `D:\aicode\pet\src\renderer\panel.html`
- Create: `D:\aicode\pet\src\renderer\src\panel\main.tsx`
- Create: `D:\aicode\pet\src\renderer\src\panel\PanelApp.tsx`
- Create: `D:\aicode\pet\src\renderer\src\panel\panel.css`

Renderer glue (React mount + electron preload boundary) — no unit test; verified by build + a manual on-screen check.

- [ ] **Step 1: Create the panel HTML entry**

`D:\aicode\pet\src\renderer\panel.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'"
    />
    <title>Pet Panel</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/panel/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: Create the panel CSS (opaque)**

`D:\aicode\pet\src\renderer\src\panel\panel.css`:

```css
:root {
  color-scheme: light dark;
}

html,
body {
  margin: 0;
  padding: 0;
  height: 100%;
  /* Opaque panel — the OPPOSITE of the transparent pet window. */
  background: #1e1e24;
  color: #e8e8ea;
  font-family:
    system-ui,
    -apple-system,
    'Segoe UI',
    sans-serif;
  font-size: 14px;
}

#root {
  height: 100%;
}

.panel {
  box-sizing: border-box;
  padding: 16px 20px;
}

.panel h1 {
  margin: 0 0 12px;
  font-size: 16px;
  font-weight: 600;
}

.panel__status {
  opacity: 0.7;
}

.panel__settings {
  margin: 12px 0 0;
  padding: 12px;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 6px;
  white-space: pre-wrap;
  font-family: ui-monospace, 'Cascadia Code', monospace;
  font-size: 12px;
}
```

- [ ] **Step 3: Create the PanelApp component reading window.panelApi.getSettings()**

`D:\aicode\pet\src\renderer\src\panel\PanelApp.tsx`:

```tsx
import { useEffect, useState } from 'react'
import type { Settings } from '@shared/types'

/**
 * Panel placeholder route (opaque). Reads the current Settings via
 * window.panelApi.getSettings() and stays in sync via onSettingsChanged.
 * Empty shell for Plans 3/4 — only proves the panel preload + IPC are wired.
 */
export function PanelApp(): React.JSX.Element {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let unsubscribe: (() => void) | undefined
    window.panelApi
      .getSettings()
      .then((s) => setSettings(s))
      .catch((e: unknown) => setError(String(e)))
    unsubscribe = window.panelApi.onSettingsChanged((s) => setSettings(s))
    return () => {
      if (unsubscribe) unsubscribe()
    }
  }, [])

  return (
    <div className="panel">
      <h1>Pet Panel</h1>
      {error ? (
        <p className="panel__status">Failed to load settings: {error}</p>
      ) : settings ? (
        <>
          <p className="panel__status">Settings loaded.</p>
          <pre className="panel__settings">
            {JSON.stringify(settings, null, 2)}
          </pre>
        </>
      ) : (
        <p className="panel__status">Loading settings…</p>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Create the panel React mount**

`D:\aicode\pet\src\renderer\src\panel\main.tsx`:

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { PanelApp } from './PanelApp'
import './panel.css'

const container = document.getElementById('root')
if (!container) {
  throw new Error('Panel root element #root not found in panel.html')
}

createRoot(container).render(
  <StrictMode>
    <PanelApp />
  </StrictMode>
)
```

- [ ] **Step 5: Type-check the renderer (panel route + the index.d.ts globals)**

Command:

```
npx tsc --noEmit -p tsconfig.web.json
```

Expected: exits with code 0 and no output. (`window.panelApi.getSettings()` resolves to `Promise<Settings>` via the `PanelApi` global from Task 7.5; `Settings` imports from `@shared/types`.)

- [ ] **Step 6: Build to confirm BOTH renderer entries and BOTH preloads emit**

Command:

```
npx electron-vite build --outDir out
```

Expected: build SUCCEEDS (exit 0) and prints lines for both renderer chunks and both preloads. Then assert the panel artifacts exist:

```
test -f out/renderer/panel.html && test -f out/renderer/index.html && test -f out/preload/panel.js && test -f out/preload/index.js && echo "ALL_PANEL_ARTIFACTS_PRESENT"
```

Expected output:

```
ALL_PANEL_ARTIFACTS_PRESENT
```

- [ ] **Step 7: Manual verification — panel route renders the settings stub**

1. Run `npm run dev`.
2. Once the pet window is up, trigger the panel: right-click the tray icon and choose "Open Panel" (or, from the pet renderer devtools console, run `window.petApi.openPanel()`).
3. EXPECTED: a separate, OPAQUE (dark `#1e1e24`) window titled "Pet Panel" appears (NOT transparent, NOT click-through).
4. EXPECTED: it shows the heading "Pet Panel", the text "Settings loaded.", and a monospace JSON block containing `"version": 1`, `"passthroughMode": "auto"`, `"petVisible": true`, and a `"petPosition"` object. This proves `window.panelApi.getSettings()` reached the main `settings:get` handler and returned real Settings.
5. EXPECTED: closing and re-opening the panel reuses one window (no duplicate panel windows stack up).

- [ ] **Step 8: Commit**

```
git add src/renderer/panel.html src/renderer/src/panel/main.tsx src/renderer/src/panel/PanelApp.tsx src/renderer/src/panel/panel.css && git commit -m "$(cat <<'EOF'
feat(renderer): add opaque panel route (panel.html, PanelApp settings stub via window.panelApi)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3.2: Placeholder pet React route on a transparent body (renderer)

**Files:**
- Create: `D:\aicode\pet\src\renderer\src\pet\PlaceholderPet.tsx`
- Modify: `D:\aicode\pet\src\renderer\src\pet\PetApp.tsx` (render `<PlaceholderPet />`; file is the scaffold-renamed pet root — if absent, create it as shown)
- Modify: `D:\aicode\pet\src\renderer\src\pet\pet.css` (transparent html/body + centered pet styles; create if absent)
- Modify: `D:\aicode\pet\src\renderer\index.html` (ensure body has no opaque background and loads `/src/pet/main.tsx`)

- [ ] **Step 1: Write the placeholder pet component**

  Create `D:\aicode\pet\src\renderer\src\pet\PlaceholderPet.tsx` with the complete contents below. It is a simple centered CSS/SVG element (NOT Live2D). The decorative stage wrapper is `pointer-events:none`; only the visible `.pet-body` circle is interactive (forward-compatible with the Plan 1 hit-test, but here it is just a visible placeholder).

  ```tsx
  // src/renderer/src/pet/PlaceholderPet.tsx
  // Simple centered CSS/SVG placeholder pet (NOT Live2D). The .pet-body is the
  // visible interactive region; the surrounding stage is click-through.
  import React from 'react'

  export function PlaceholderPet(): React.JSX.Element {
    return (
      <div className="pet-stage">
        <div className="pet-body" role="img" aria-label="Placeholder pet">
          <svg width="120" height="120" viewBox="0 0 120 120">
            <circle cx="60" cy="60" r="56" fill="#7aa2f7" stroke="#3b5bdb" strokeWidth="4" />
            <circle cx="44" cy="52" r="9" fill="#ffffff" />
            <circle cx="76" cy="52" r="9" fill="#ffffff" />
            <circle cx="44" cy="54" r="4" fill="#1a1a1a" />
            <circle cx="76" cy="54" r="4" fill="#1a1a1a" />
            <path d="M44 80 Q60 94 76 80" fill="none" stroke="#1a1a1a" strokeWidth="4" strokeLinecap="round" />
          </svg>
        </div>
      </div>
    )
  }
  ```

- [ ] **Step 2: Render the placeholder from the pet root component**

  Open `D:\aicode\pet\src\renderer\src\pet\PetApp.tsx`. Replace its entire contents with the complete file below (this removes any leftover scaffold demo markup and renders only the placeholder pet). If the file does not exist yet, create it with these contents.

  ```tsx
  // src/renderer/src/pet/PetApp.tsx
  // Pet root component for Plan 1 Group 3: renders the placeholder pet only.
  // (Hit-test/passthrough/drag wiring is added by other task groups.)
  import React from 'react'
  import { PlaceholderPet } from './PlaceholderPet'

  export function PetApp(): React.JSX.Element {
    return <PlaceholderPet />
  }
  ```

- [ ] **Step 3: Write the transparent pet stylesheet**

  Open `D:\aicode\pet\src\renderer\src\pet\pet.css` (create if absent) and set its entire contents to the complete file below. The html/body/#root are fully transparent (no opaque background anywhere), the stage fills the window and is click-through, and the pet is centered.

  ```css
  /* src/renderer/src/pet/pet.css */
  /* Fully transparent pet window: no opaque background on html/body/#root. */
  html,
  body,
  #root {
    margin: 0;
    padding: 0;
    width: 100%;
    height: 100%;
    background: transparent;
    overflow: hidden;
  }

  /* Stage fills the window and is click-through; only .pet-body is solid. */
  .pet-stage {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    background: transparent;
  }

  .pet-body {
    pointer-events: auto;
    user-select: none;
    line-height: 0;
  }
  ```

- [ ] **Step 4: Confirm the pet `main.tsx` mounts `PetApp` and imports the stylesheet**

  Open `D:\aicode\pet\src\renderer\src\pet\main.tsx`. Ensure its entire contents match the complete file below (this is the React mount into `#root` of `index.html`; create the file if the scaffold task group has not already produced it).

  ```tsx
  // src/renderer/src/pet/main.tsx
  import React from 'react'
  import ReactDOM from 'react-dom/client'
  import { PetApp } from './PetApp'
  import './pet.css'

  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <PetApp />
    </React.StrictMode>
  )
  ```

- [ ] **Step 5: Ensure `index.html` is transparent and loads the pet entry**

  Open `D:\aicode\pet\src\renderer\index.html`. Ensure it contains a `<div id="root"></div>` and a module script pointing at the pet entry, and that no opaque background is set inline. Its `<body>` block should read exactly:

  ```html
  <body>
    <div id="root"></div>
    <script type="module" src="/src/pet/main.tsx"></script>
  </body>
  ```

  Remove any scaffold inline `style`/`background` on `<html>`/`<body>` and any leftover demo markup. Do NOT add a `<link>` to a global stylesheet that sets a background.

- [ ] **Step 6: Manual verification (run the app)**

  Run exactly:

  ```
  npm run dev
  ```

  Then confirm each check on screen:

  1. A window appears containing the blue smiley placeholder pet centered in it. EXPECTED: the round blue pet with two white eyes and a smile is visible.
  2. The area around the pet is fully see-through — you can see the desktop/other apps through the window's corners, with NO white/grey/black rectangle or border around the pet. EXPECTED: only the pet pixels are visible; everything else is transparent.
  3. The window has no title bar, no border, and no OS frame. EXPECTED: frameless — no minimize/maximize/close buttons, no draggable title bar chrome.
  4. Bring another application to the foreground (e.g. click a browser/Explorer window so it has focus). EXPECTED: the pet stays visible and floats ABOVE that window (always-on-top, from `setAlwaysOnTop(true, 'screen-saver')` in `petWindow.ts`, Task 3.1).
  5. (Windows) Check the taskbar; (macOS) check the Dock/app switcher. EXPECTED: the pet window does NOT appear as a taskbar button (skipTaskbar).
  6. There is no white flash at launch before the pet appears. EXPECTED: the window paints transparent-then-pet, never a solid white frame first (`show:false` + `ready-to-show` -> `show()` in `petWindow.ts`, Task 3.1).
  7. The pet window opens at its restored position. EXPECTED: with the interim `DEFAULT_SETTINGS` source the window appears near the default `x:100, y:100` at `300x300`, fully on-screen (clamped); it never opens partially or fully off the visible desktop.

  If check 2 fails (opaque rectangle visible), the most likely cause is an opaque `background` left on `html`/`body`/`#root` in `pet.css` or `index.html` from the scaffold — fix that, not the window options. If check 4 fails on macOS over a fullscreen app, confirm `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })` is present in `petWindow.ts` (Task 3.1).

- [ ] **Step 7: Commit**

  Run exactly:

  ```
  git add src/renderer/src/pet/PlaceholderPet.tsx src/renderer/src/pet/PetApp.tsx src/renderer/src/pet/main.tsx src/renderer/src/pet/pet.css src/renderer/index.html && git commit -m "feat(pet-window): transparent placeholder pet renderer route"
  ```

---

Based on the four issues and the contract, here is the complete corrected markdown for Task Group 4. I've fixed: (4.1) unchanged — it was correct; (4.2) the vacuous typecheck command; (4.4 Step 1) the ambient `Electron.IpcRendererEvent` reference; (4.4 Step 3) the dead `once('ready-to-show')` listener; and (4.5 Step 2) the React-19 `JSX.Element` annotation.

---

### Task 4.5: Build the renderer hit-test loop (`usePassthrough`) and wire it into `PetApp`

**Files:**
- Create: `D:\aicode\pet\src\renderer\src\pet\usePassthrough.ts`
- Modify: `D:\aicode\pet\src\renderer\src\pet\PetApp.tsx` (mount the hook)
- Modify: `D:\aicode\pet\src\renderer\src\pet\pet.css` (transparent root + `pointer-events:none` decorative layers, `.pet-body` interactive)

- [ ] **Step 1: Write the `usePassthrough` hook**

  Create `D:\aicode\pet\src\renderer\src\pet\usePassthrough.ts`. It runs a global `mousemove` hit-test (which keeps firing because the window is `ignore=true` + `forward:true`), debounces the leave transition to kill edge flicker (R4), only reports on an ACTUAL state change, and pauses reporting while a manual lock mode is active.

  ```ts
  import { useEffect, useRef } from 'react'
  import type { PassthroughMode } from '@shared/types'

  /**
   * Cheap DOM hit-test: pointer-events:none is set on every decorative layer,
   * so the only elements that can become the mousemove target are interactive
   * ones (.pet-body and real UI). The <html> element is the exception that is
   * still targetable over empty space (R4), so target === documentElement means
   * "over transparent background" -> not interactive.
   */
  function isOverInteractive(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) return false
    if (target === document.documentElement) return false
    if (target === document.body) return false
    return true
  }

  const LEAVE_DEBOUNCE_MS = 120

  /**
   * Runs the passthrough hit-test loop. Reports enter/leave to main via
   * window.petApi.setInteractive ONLY when the boolean state changes. While the
   * passthrough mode is a manual lock (not 'auto') reporting is suspended,
   * because main ignores hit-test input in those modes anyway (resolveIgnoreMouse
   * gates it) — suspending avoids churn.
   */
  export function usePassthrough(): void {
    // Mirror of last-reported interactivity so we never re-send the same value.
    const lastReported = useRef<boolean | null>(null)
    const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
    const modeRef = useRef<PassthroughMode>('auto')

    useEffect(() => {
      function report(interactive: boolean): void {
        if (lastReported.current === interactive) return
        lastReported.current = interactive
        window.petApi.setInteractive(interactive)
      }

      function clearLeaveTimer(): void {
        if (leaveTimer.current !== null) {
          clearTimeout(leaveTimer.current)
          leaveTimer.current = null
        }
      }

      function onMouseMove(e: MouseEvent): void {
        // Suspend hit-test reporting under a manual lock mode.
        if (modeRef.current !== 'auto') return

        const over = isOverInteractive(e.target)
        if (over) {
          // Enter is immediate; cancel any pending leave.
          clearLeaveTimer()
          report(true)
        } else if (leaveTimer.current === null) {
          // Debounce the leave so an anti-aliased edge doesn't chatter (R4).
          leaveTimer.current = setTimeout(() => {
            leaveTimer.current = null
            report(false)
          }, LEAVE_DEBOUNCE_MS)
        }
      }

      const unsubscribeMode = window.petApi.onPassthroughModeChanged(
        ({ mode }) => {
          modeRef.current = mode
          if (mode !== 'auto') {
            // Entering a lock mode: cancel any pending leave; main owns state now.
            clearLeaveTimer()
            lastReported.current = null
          }
        }
      )

      window.addEventListener('mousemove', onMouseMove)

      return () => {
        window.removeEventListener('mousemove', onMouseMove)
        clearLeaveTimer()
        unsubscribeMode()
      }
    }, [])
  }
  ```

- [ ] **Step 2: Mount the hook in `PetApp`**

  In `D:\aicode\pet\src\renderer\src\pet\PetApp.tsx`, call the hook at the top of the component (merge with the existing placeholder-pet / drag rendering from earlier groups). Do NOT annotate the return type as the bare global `JSX.Element`: the contract pins React 19 (`@types/react@19`), which REMOVED the global `JSX` namespace in favor of `React.JSX`, and the default electron-vite react-ts tsconfig adds no global JSX shim — so a bare `JSX.Element` annotation fails Step 4's `tsc -p tsconfig.web.json` with `Cannot find namespace 'JSX'`. Omit the explicit return type and let TS infer it:

  ```tsx
  import { usePassthrough } from './usePassthrough'
  import { PlaceholderPet } from './PlaceholderPet'
  import './pet.css'

  export function PetApp() {
    usePassthrough()
    return (
      <div className="pet-root">
        <PlaceholderPet />
      </div>
    )
  }
  ```

  If `PetApp.tsx` already renders the placeholder + drag handle from an earlier group, only ADD the `usePassthrough` import and the `usePassthrough()` call as the first statement in the component body; do not remove existing markup. If the existing component carries an explicit `: JSX.Element` annotation, change it to either no annotation (inferred, preferred) or `: React.JSX.Element` (with a `import type React from 'react'`) so it typechecks under `@types/react@19`.

- [ ] **Step 3: Ensure pet.css makes decorative layers non-interactive**

  In `D:\aicode\pet\src\renderer\src\pet\pet.css`, ensure these rules exist (the hit-test correctness depends on them — decorative layers MUST be `pointer-events:none`, only the pet body interactive):

  ```css
  html,
  body,
  #root {
    margin: 0;
    height: 100%;
    background: transparent;
  }

  /* The root wrapper is decorative/empty space: must NOT capture the cursor,
     so over-empty-space the mousemove target stays <html> (R4). */
  .pet-root {
    width: 100vw;
    height: 100vh;
    pointer-events: none;
  }

  /* The solid pet body is the interactive region the hit-test detects. */
  .pet-body {
    pointer-events: auto;
  }
  ```

  If `pet.css` already defines `.pet-body`/`.pet-root` from an earlier group, only ensure the `pointer-events: none` on `.pet-root` and `pointer-events: auto` on `.pet-body` are present.

- [ ] **Step 4: Confirm the renderer typechecks**

  Command:
  ```
  npx tsc --noEmit -p tsconfig.web.json
  ```
  Expected: exit code 0, no errors in `usePassthrough.ts` or `PetApp.tsx` (in particular, NO `Cannot find namespace 'JSX'` from `PetApp.tsx`, since the return type is inferred). (`window.petApi` must be typed via the `src/preload/index.d.ts` augmentation from an earlier group; if `window.petApi` is `any`/unknown, that augmentation is missing — a preload-typing task, not this one.)

- [ ] **Step 5: Commit**

  ```
  git add src/renderer/src/pet/usePassthrough.ts src/renderer/src/pet/PetApp.tsx src/renderer/src/pet/pet.css
  git commit -m "feat(renderer): add usePassthrough hit-test loop reporting setInteractive on change

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 4.6: Manual verification of end-to-end passthrough + lock modes

**Files:**
- (none created/modified — verification only; relies on `src/main/index.ts`, `src/main/passthrough.ts`, `src/main/ipc.ts`, `src/preload/index.ts`, `src/renderer/src/pet/usePassthrough.ts`)

- [ ] **Step 1: Launch the app in dev mode**

  Command:
  ```
  npm run dev
  ```
  Expected: electron-vite starts, the transparent frameless pet window appears on the desktop showing the placeholder pet, always-on-top, with no taskbar entry.

- [ ] **Step 2: Manual verification — resting click-through is applied at startup (regression guard for the once('ready-to-show') fix)**

  Immediately after launch, with the tray mode at the default `auto` and WITHOUT first hovering the pet body:
  1. Click on a TRANSPARENT area of the pet window (empty space around the placeholder pet) right away.
     - EXPECTED: the very first click on empty space passes THROUGH to the desktop app behind. This confirms `passthrough.apply()` ran unconditionally at wiring time (not gated on a dead late `once('ready-to-show')` listener) so the resting `ignore=true`+`forward:true` state is active from the start.

- [ ] **Step 3: Manual verification — click-through over empty space (auto mode)**

  With the tray mode at the default `auto`:
  1. Move the cursor over a TRANSPARENT area of the pet window (empty space around the placeholder pet). Click there.
     - EXPECTED: the click lands on whatever desktop app is BEHIND the pet window (e.g. clicking a desktop icon selects it, clicking a window behind focuses it). The pet window does NOT receive or block the click.
  2. Move the cursor onto the solid `.pet-body` of the placeholder pet. The cursor is now over the interactive region.
     - EXPECTED: while hovering the pet body, clicking interacts with the pet window itself (it does NOT pass through to the app behind). The pet body is "solid" to the mouse.
  3. Move the cursor off the pet body back onto empty space; wait ~150ms.
     - EXPECTED: after the short debounce the window returns to click-through; clicking empty space again passes through to the desktop.

- [ ] **Step 4: Manual verification — `locked-passthrough` mode**

  From the tray menu, select mode `locked-passthrough` (radio item `mode-locked-passthrough`).
  1. Hover DIRECTLY over the solid pet body and click.
     - EXPECTED: the click passes THROUGH to the app behind even while over the pet — the window is always click-through in this mode. Hovering the pet no longer makes it interactive.

- [ ] **Step 5: Manual verification — `locked-interactive` mode**

  From the tray menu, select mode `locked-interactive` (radio item `mode-locked-interactive`).
  1. Move the cursor over EMPTY/transparent space inside the pet window bounds and click.
     - EXPECTED: the click is captured by the pet window (does NOT pass through to the desktop), even over transparent space — the window is always interactive in this mode.

- [ ] **Step 6: Manual verification — `reset-interaction` and return to `auto`**

  1. Select tray mode `auto` again, then trigger the tray `reset-interaction` item.
     - EXPECTED: the window returns to the resting click-through state (clicking empty space passes through to the desktop). Hovering the pet body once more makes it interactive (enter is immediate, leave debounced), confirming the `pet:passthrough-mode-changed` event resumed the renderer hit-test loop and `resolveIgnoreMouse` is driving state from hit-test reports again.

- [ ] **Step 7: Commit a verification note (no code change)**

  If steps 2–6 all behave as described, record the manual pass with an empty commit:
  ```
  git commit --allow-empty -m "test(manual): verify passthrough state machine + lock modes pass through correctly

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

I have the writing-plans format in mind. Now let me produce the corrected markdown for Task Group 5, applying all the fixes. Let me reason through the key changes:

1. **Task 5.2 fix**: Rename to a regression-guard test (not TDD), state Step 1 is expected to PASS, drop the full-function paste, and not redefine position.ts.
2. **Task 5.3 Step 1 fix**: Guard the persist sink against destroyed webContents; the persist path shouldn't broadcast when flushing at quit (separate the persist-only path).
3. **Task 5.3 Step 2 fix**: Concrete code for both branches, import BrowserWindow, and `return { flushDragPersist: () => dragController.flushPersist() }`.
4. **Task 5.3 Step 4 fix**: Pause the hit-test during drag (drag-start suppresses passthrough), and document the passthrough-flip risk in Step 5.
5. **Task 5.4 Step 1 fix**: Use `Settings` import in real code.
6. **Task 5.4 Step 2 fix**: Consistent event typing in displayWatcher.
7. **Task 5.4 Step 3 fix**: Capture `ipcHandles = registerIpcHandlers(deps)` and call `ipcHandles.flushDragPersist()` concretely.

A subtle design point on the drag/passthrough fix: the cleanest approach is to have the drag handlers in `PetApp.tsx` toggle a global flag that `usePassthrough` reads to skip the hit-test, AND force the window interactive on drag-start by calling `window.petApi.setInteractive(true)`. I'll wire both: drag-start forces interactive and pauses the hit-test; drag-end resumes. I need to keep this within Task Group 5's scope (it owns the drag wiring in PetApp.tsx; `usePassthrough` is owned by another group, so I'll have PetApp set a module-level flag and call setInteractive, and document that usePassthrough must honor the flag — but to stay self-contained I'll make PetApp the sole owner of the pause via a shared ref it also passes, OR more safely just force-interactive via main keeping the window interactive between drag-start and drag-end, which is fully within my main-process drag controller).

The safest within-scope fix: have the **main-process drag controller** force the window interactive on drag-start and not let passthrough flip it until drag-end. The passthrough controller already exists (another group). My drag controller can call `setInteractive`-equivalent by holding a "dragging" flag in the passthrough controller. But the contract's `createDragController` signature only takes `getWindow` and `persistPosition`. I can extend the renderer side instead, which I own (PetApp.tsx). I'll have PetApp call `window.petApi.setInteractive(true)` on drag-start and set a module-scoped `isDragging` flag that `usePassthrough` honors, plus stop emitting setInteractive during drag. Since `usePassthrough` is owned by another group, I'll expose the flag via a tiny shared module that PetApp owns and document the one-line contract for usePassthrough. To keep fully self-contained and not create undefined cross-references, I'll make PetApp directly add `window` mousemove guarding so that during drag, PetApp calls `setInteractive(true)` continuously is wasteful — instead PetApp sets interactive once at start, suppresses any setInteractive(false) by setting the shared dragging flag, and restores at end.

Let me write the corrected markdown now.

Here is the complete corrected markdown for Task Group 5:

> The repo hasn't been scaffolded yet (no `src/shared` or `src/main` files). My task group depends on pure helpers (`debounce`, `clampPositionToDisplays`, `pickDisplayForPosition`) and the settings store, which are produced by earlier task groups in this same plan and are the canonical owners of `src/shared/debounce.ts`, `src/shared/position.ts`, and `src/main/settingsStore.ts`. I write my tasks assuming those exist per the contract. My group OWNS only: `src/shared/debounce.ts` + its test (the persist-position debounce is genuinely my dependency, so I TDD it here), `src/main/dragController.ts`, `src/main/displayWatcher.ts`, a regression-guard test for the restore-clamp path, and the drag/restore wiring in `ipc.ts` / `petWindow.ts` / `preload/index.ts` / `PetApp.tsx` / `index.ts`. I do NOT redefine `position.ts` or `settingsStore.ts`.

---

### Task 6.3: Implement `createTray()` wiring `buildTrayMenuModel` to a live Electron Tray

**Files:**
- Create: `D:\aicode\pet\src\main\tray.ts`
- Create (icon placeholders): `D:\aicode\pet\resources\trayTemplate.png` (macOS template) and `D:\aicode\pet\resources\tray.ico` (genuine Windows ICO container)
- Modify (electron-builder packaging): `D:\aicode\pet\electron-builder.yml` — add `extraResources` so the tray icons ship in the packaged app (so the `app.isPackaged` branch of `resolveIconPath()` is not dead).
- (Depends on, already created by earlier groups) `D:\aicode\pet\src\main\windows\windowManager.ts` (`getPetWindow`, `togglePetVisibility`, `resetInteraction`), `D:\aicode\pet\src\main\passthrough.ts` (`createPassthroughController` instance accessors), `D:\aicode\pet\src\main\settingsStore.ts`, and Task 6.2's `showPanelWindow`.

This is Electron GLUE; full implementation + manual verification follow.

- [ ] **Step 1: Add placeholder tray icons (real PNG template + GENUINE ICO container)**

  CRITICAL (R5): the Windows icon MUST be a real ICO container, NOT PNG bytes written into a `.ico` filename. `nativeImage.createFromPath()` of a `.ico` file that actually holds raw PNG bytes returns an EMPTY `NativeImage` on Windows, and `new Tray(emptyImage)` throws `Failed to load image from path` or yields an invisible tray. The base64 below for `tray.ico` is a genuine ICO container (header type=1, one 16x16 entry, an embedded 32-bit PNG at offset 22 — first 4 bytes `00 00 01 00`). The base64 for `trayTemplate.png` is a real 16x16 RGBA PNG (magic `89504e47`) used as the macOS template image.

  Run this exact command (writes both files with the correct, distinct byte streams):
  ```
  mkdir -p resources && node -e "const fs=require('fs'); const pngB64='iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAALElEQVR4nGP4//8/AyWYIs34DMAFCBpALKCNAaSCUQNoYcDApwOqJGX650YA/y14snPL9uYAAAAASUVORK5CYII='; const icoB64='AAABAAEAEBAAAAEAIABlAAAAFgAAAIlQTkcNChoKAAAADUlIRFIAAAAQAAAAEAgGAAAAH/P/YQAAACxJREFUeJxj+P//PwMlmCLN+AzABQgaQCygjQGkglEDaGHAwKcDqiRl+udGAP8teLJzy/bmAAAAAElFTkSuQmCC'; fs.writeFileSync('resources/trayTemplate.png', Buffer.from(pngB64,'base64')); fs.writeFileSync('resources/tray.ico', Buffer.from(icoB64,'base64'));"
  ```
  Verify both files exist with non-zero size AND the correct container magic:
  ```
  ls -l resources/trayTemplate.png resources/tray.ico && node -e "const fs=require('fs'); const png=fs.readFileSync('resources/trayTemplate.png'); const ico=fs.readFileSync('resources/tray.ico'); console.log('png magic', png.subarray(0,4).toString('hex'), '(expect 89504e47)'); console.log('ico header', ico.subarray(0,4).toString('hex'), '(expect 00000100)', 'type', ico.readUInt16LE(2), 'count', ico.readUInt16LE(4));"
  ```
  Expected output:
  ```
  png magic 89504e47 (expect 89504e47)
  ico header 00000100 (expect 00000100) type 1 count 1
  ```
  If `ico header` is NOT `00000100` (e.g. it shows `89504e47`), you wrote PNG bytes into the `.ico` — STOP and re-run the write command above. These placeholders may later be replaced by a designed multi-size `.ico` / `.png`, but they must already be a real ICO container and a real PNG so the tray loads on Windows.

- [ ] **Step 2: Write the tray module (with empty-image guard + correct dev/prod resource paths)**

  Write `D:\aicode\pet\src\main\tray.ts` with this exact content:

  ```ts
  // ============================================================================
  // src/main/tray.ts
  // createTray(): builds the Electron Tray, keeps a module-scope ref (or it is
  // GC'd and disappears), and rebuilds its context menu from the pure
  // buildTrayMenuModel(state) whenever app state changes. GLUE — verified manually.
  // ============================================================================
  import { app, Tray, Menu, nativeImage, type NativeImage, type MenuItemConstructorOptions } from 'electron'
  import { join } from 'node:path'
  import { buildTrayMenuModel } from '@shared/trayMenu'
  import type { TrayMenuState, TrayItemId, PassthroughMode } from '@shared/types'

  // Keep a module-scope ref — losing it lets the GC destroy the tray icon.
  let tray: Tray | null = null

  /** Callbacks the tray invokes; wired by the caller (index.ts) to the real
   *  window/passthrough/settings glue so this module stays dependency-light. */
  export interface TrayHandlers {
    getState(): TrayMenuState
    onToggleVisibility(): void
    onSetMode(mode: PassthroughMode): void
    onResetInteraction(): void
    onOpenPanel(): void
    onQuit(): void
  }

  function resolveIconPath(): string {
    const file = process.platform === 'darwin' ? 'trayTemplate.png' : 'tray.ico'
    // Dev: resources live at <root>/resources (two levels up from out/main).
    // Prod: shipped via electron-builder extraResources -> <resourcesPath>/resources/<file>.
    if (app.isPackaged) {
      return join(process.resourcesPath, 'resources', file)
    }
    return join(__dirname, '../../resources', file)
  }

  /**
   * Load the tray icon, guarding against an empty NativeImage (which on Windows
   * makes new Tray() throw or produce an invisible icon). Falls back to a known
   * 1x1 opaque image so new Tray never receives an empty image.
   */
  function loadTrayImage(): NativeImage {
    const img = nativeImage.createFromPath(resolveIconPath())
    if (!img.isEmpty()) {
      return img
    }
    // Known-valid fallback: a 16x16 white square data URL so the tray is never
    // empty even if the bundled icon failed to load.
    const fallback = nativeImage.createFromDataURL(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAHElEQVR42mNkYPhfz0BkYBxVSFNAFY1QwUEFADj4Bf2gB1k4AAAAAElFTkSuQmCC'
    )
    return fallback
  }

  function idToMode(id: TrayItemId): PassthroughMode | null {
    switch (id) {
      case 'mode-auto':
        return 'auto'
      case 'mode-locked-interactive':
        return 'locked-interactive'
      case 'mode-locked-passthrough':
        return 'locked-passthrough'
      default:
        return null
    }
  }

  function buildElectronMenu(handlers: TrayHandlers): Menu {
    const model = buildTrayMenuModel(handlers.getState())
    const template: MenuItemConstructorOptions[] = model.map((item) => {
      if (item.type === 'separator') {
        return { type: 'separator' }
      }
      const id = item.id as TrayItemId
      return {
        label: item.label,
        type: item.type,
        checked: item.checked,
        enabled: item.enabled ?? true,
        click: () => {
          switch (id) {
            case 'toggle-visibility':
              handlers.onToggleVisibility()
              break
            case 'reset-interaction':
              handlers.onResetInteraction()
              break
            case 'open-panel':
              handlers.onOpenPanel()
              break
            case 'quit':
              handlers.onQuit()
              break
            default: {
              const mode = idToMode(id)
              if (mode) handlers.onSetMode(mode)
            }
          }
          // State changed -> rebuild so labels/radios reflect the new state.
          refreshTrayMenu(handlers)
        }
      }
    })
    return Menu.buildFromTemplate(template)
  }

  /** Rebuild and re-apply the context menu from current state. */
  export function refreshTrayMenu(handlers: TrayHandlers): void {
    if (!tray) return
    const menu = buildElectronMenu(handlers)
    if (process.platform === 'darwin') {
      // On macOS we DON'T setContextMenu (it would hijack left-click); we pop it
      // up on right-click instead and keep a reference for that.
      tray.removeAllListeners('right-click')
      tray.on('right-click', () => tray?.popUpContextMenu(menu))
      // Left click also opens the menu for discoverability on mac.
      tray.removeAllListeners('click')
      tray.on('click', () => tray?.popUpContextMenu(menu))
    } else {
      tray.setContextMenu(menu)
    }
  }

  /**
   * Create the Tray after app.whenReady(). Returns the Tray and wires its
   * menu from buildTrayMenuModel. Keep the returned value alive (this module
   * already holds a ref).
   */
  export function createTray(handlers: TrayHandlers): Tray {
    const icon = loadTrayImage()
    if (process.platform === 'darwin') {
      icon.setTemplateImage(true)
    }
    tray = new Tray(icon)
    tray.setToolTip('Desktop Pet')

    if (process.platform !== 'darwin') {
      // Windows: left-click opens the panel; right-click shows the menu.
      tray.on('click', () => handlers.onOpenPanel())
    }

    refreshTrayMenu(handlers)
    return tray
  }

  export function getTray(): Tray | null {
    return tray
  }

  export function destroyTray(): void {
    tray?.destroy()
    tray = null
  }
  ```

- [ ] **Step 3: Add the tray icons to the packaged build (electron-builder extraResources)**

  Open `D:\aicode\pet\electron-builder.yml` (created by the scaffold/earlier packaging task). Add the following top-level `extraResources` entry so `resources/tray*.png` and `resources/tray*.ico` are copied into the packaged app under `<resourcesPath>/resources/` (matching the `app.isPackaged` branch of `resolveIconPath()` above). If an `extraResources:` key already exists, append the entry rather than duplicating the key:

  ```yaml
  extraResources:
    - from: resources
      to: resources
      filter:
        - 'tray*.png'
        - 'tray*.ico'
  ```

  Verify the YAML parses and contains the entry:
  ```
  node -e "const fs=require('fs'); const y=fs.readFileSync('electron-builder.yml','utf8'); if(!/extraResources/.test(y)) throw new Error('extraResources not found'); console.log('extraResources present');"
  ```
  Expected: `extraResources present`. (Dev runs use the `__dirname/../../resources` branch and do not depend on this; this step only un-deadens the packaged-build branch. If full packaged-icon wiring is intentionally deferred, leave this step but note the prod branch stays unverified until a packaging task runs `electron-builder`.)

- [ ] **Step 4: Type-check the tray module**

  Command:
  ```
  npx tsc --noEmit -p tsconfig.node.json
  ```
  Expected: no errors referencing `src/main/tray.ts`. (`@shared` alias must already resolve in the main tsconfig per the contract; if it errors on `@shared/*`, confirm the alias/paths were added by the scaffold-config task before proceeding.)

- [ ] **Step 5: Commit**

  Command:
  ```
  git add src/main/tray.ts resources/trayTemplate.png resources/tray.ico electron-builder.yml && git commit -m "feat(main): create tray wiring buildTrayMenuModel to electron Tray

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 6.4: Author the sole `src/main/index.ts` bootstrap (single-instance lock, macOS accessory policy, full whenReady wiring)

**Files:**
- Modify: `D:\aicode\pet\src\main\index.ts` (top of file: replace the import block and add the single-instance lock before any window creation; body: author the single `bootstrap()` + `app.whenReady().then(...)` that wires settings store, pet window, passthrough controller, IPC, display watcher, tray, broadcasts, and quit flush). 6.4 is the SOLE editor of this bootstrap block — no other task edits it.

This is Electron GLUE; full implementation + manual verification follow. Every binding referenced below is authored by an earlier task module (`createPetWindow` by 3.1, `createPanelWindow`/`showPanelWindow` by 6.2, `createSettingsStore`, `createPassthroughController`, `registerIpcHandlers` by 7.7, `startDisplayWatcher` by 5.4, `windowManager` getters by 7.1, `createTray` by this group). 6.4 only imports and wires them — it does NOT re-author any of those base files.

- [ ] **Step 1: Read the current main entry to anchor the edits**

  Command:
  ```
  cat src/main/index.ts
  ```
  Expected: you see the scaffold/earlier-group `index.ts`. Note the exact existing import block and any `app.whenReady()` usage so the full replacement below supersedes it. Confirm these earlier-task symbols already exist as importable exports: `createSettingsStore` (`./settingsStore`), `createPassthroughController` (`./passthrough`), `createPetWindow` (`./windows/petWindow`), `createPanelWindow`/`showPanelWindow` (`./windows/panelWindow`), `registerIpcHandlers` (`./ipc`), `getPetWindow` / `getPanelWindow` / `togglePetVisibility` (`./windows/windowManager`), and `startDisplayWatcher` (`./displayWatcher`). Both window getters live ONLY in `./windows/windowManager` — do NOT import `getPanelWindow` from `./windows/panelWindow`.

- [ ] **Step 2: Replace the import block at the top of `index.ts`**

  Replace the existing import block at the top of `src/main/index.ts` with EXACTLY this block. Both `getPetWindow` and `getPanelWindow` come from `./windows/windowManager` (the sole getter home); `showPanelWindow` comes from `./windows/panelWindow`; `startDisplayWatcher` (NOT `initDisplayWatcher`) comes from `./displayWatcher`:

  ```ts
  import { app } from 'electron'
  import { IPC } from '@shared/ipc'
  import type { PassthroughMode, PassthroughModeChangedPayload } from '@shared/types'
  import { getPetWindow, getPanelWindow, togglePetVisibility } from './windows/windowManager'
  import { showPanelWindow } from './windows/panelWindow'
  import { createPetWindow } from './windows/petWindow'
  import { createSettingsStore } from './settingsStore'
  import { createPassthroughController } from './passthrough'
  import { registerIpcHandlers } from './ipc'
  import { startDisplayWatcher } from './displayWatcher'
  import { createTray, type TrayHandlers } from './tray'
  ```

- [ ] **Step 3: Add the single-instance lock immediately after the imports**

  Immediately after the import block from Step 2, insert this block. It replaces any existing top-level `app.whenReady()` call so bootstrap runs only inside the lock branch. The `second-instance` handler surfaces EXISTING UI only — it must NOT create a panel from scratch (opening a never-opened panel on a second launch is a surprising side effect). Both getters are imported from `./windows/windowManager`:

  ```ts
  // --- Single-instance lock (before any window creation, R5) --------------------
  const gotTheLock = app.requestSingleInstanceLock()
  if (!gotTheLock) {
    app.quit()
  } else {
    app.on('second-instance', () => {
      const pet = getPetWindow()
      if (pet && !pet.isDestroyed()) {
        if (!pet.isVisible()) pet.show()
        pet.focus()
      }
      const panel = getPanelWindow()
      if (panel && !panel.isDestroyed()) {
        if (panel.isMinimized()) panel.restore()
        panel.show()
        panel.focus()
      }
    })
    bootstrap()
  }
  ```

- [ ] **Step 4: Author the single `bootstrap()` function (the whenReady wiring)**

  Add this `bootstrap()` definition below the lock block. This is the SOLE owner of the whenReady body: it loads settings, creates the pet window (the factory restores the clamped position, registers its ref, and honors `settings.petVisible`), creates the passthrough controller and applies its resting state, registers IPC and captures the returned `flushPersist` handle, starts the display watcher and captures its disposer, wires the tray, and flushes drag-persist + stops the watcher on `before-quit`. Ordering is load-bearing. Do NOT add a late `ready-to-show` listener for passthrough (the factory owns first-paint visibility; `passthrough.apply()` is valid pre-show). Every binding below is live and in scope:

  ```ts
  function bootstrap(): void {
    app.whenReady().then(() => {
      // macOS: pure accessory (no Dock). Pairs with LSUIElement for no-flash start.
      if (process.platform === 'darwin') {
        app.setActivationPolicy('accessory')
      }

      // 1) Settings store + load.
      const settingsStore = createSettingsStore(app.getPath('userData'))
      let settings = settingsStore.load()

      // 2) Pet window (factory restores clamped position, registers ref, honors petVisible).
      createPetWindow(settings)

      // 3) Passthrough controller bound to the live pet window; init from settings.
      const passthrough = createPassthroughController(getPetWindow)
      passthrough.setMode(settings.passthroughMode)
      // Resting state: in 'auto' with overInteractive=false -> ignore=true+forward.
      // Apply unconditionally (valid pre-show; do NOT add a late ready-to-show here).
      passthrough.apply()

      // 4) Broadcast helper: full Settings to every live window (destroyed-safe).
      const broadcastSettingsChanged = (): void => {
        const payload = { settings: settingsStore.get() }
        for (const w of [getPetWindow(), getPanelWindow()]) {
          if (w && !w.isDestroyed()) w.webContents.send(IPC.SETTINGS_CHANGED, payload)
        }
      }

      // 5) IPC: base (settings:get/set, pet:open-panel) + extensions (setInteractive, drag).
      //    Returns { flushPersist } (the drag-controller flush handle). One deps shape.
      const ipcHandles = registerIpcHandlers({
        settingsStore,
        passthrough,
        showPanelWindow,
        getPetWindow,
        broadcastSettingsChanged,
        getAllWindows: () => [getPetWindow(), getPanelWindow()]
      })

      // 6) Display watcher (re-clamp on monitor changes). Returns a disposer.
      const stopDisplayWatcher = startDisplayWatcher(getPetWindow)

      // 7) Passthrough-mode broadcast to the pet renderer (always via IPC constant).
      const broadcastPassthroughMode = (mode: PassthroughMode): void => {
        getPetWindow()?.webContents.send(IPC.PET_PASSTHROUGH_MODE_CHANGED, {
          mode
        } satisfies PassthroughModeChangedPayload)
      }

      // 8) Tray.
      const handlers: TrayHandlers = {
        getState: () => ({ mode: passthrough.getMode(), petVisible: settings.petVisible }),
        onToggleVisibility: () => {
          settings = settingsStore.set({ petVisible: !settings.petVisible })
          togglePetVisibility(settings.petVisible)
          broadcastSettingsChanged()
        },
        onSetMode: (mode) => {
          passthrough.setMode(mode)
          passthrough.apply()
          settings = settingsStore.set({ passthroughMode: mode })
          broadcastSettingsChanged()
          broadcastPassthroughMode(mode)
        },
        onResetInteraction: () => passthrough.reset(),
        onOpenPanel: () => showPanelWindow(),
        onQuit: () => app.quit()
      }
      createTray(handlers)

      // 9) Flush pending drag-persist on quit, then stop the watcher.
      app.on('before-quit', () => {
        ipcHandles.flushPersist()
        stopDisplayWatcher()
      })

      app.on('activate', () => {
        if (!getPetWindow()) createPetWindow(settings)
      })
    })

    app.on('window-all-closed', () => {
      // Overlay/tray app: do NOT quit when the panel closes. Quit only via tray.
    })
  }
  ```

  Notes for the implementer wiring this:
  - `settings` is declared with `let` (not `const`) so the tray handlers can reassign it after `settingsStore.set(...)`, and so `app.on('activate')` re-creates the pet window from the latest `settings`.
  - `createPetWindow(settings)` is passed the loaded `Settings` object directly (not a store, not a deps bag). The factory does the launch clamp, calls `setPetWindow(win)`, and shows the window on first paint ONLY when `settings.petVisible` — the bootstrap does NOT gate visibility itself.
  - Both `getPetWindow` and `getPanelWindow` are imported from `./windows/windowManager` — never from `panelWindow.ts`.
  - `registerIpcHandlers` is called with the single canonical deps object and its return is captured as `ipcHandles`; `ipcHandles.flushPersist()` is invoked on `before-quit`. The base handlers (settings get/set, pet:open-panel) plus the 4.4 `pet:setInteractive` and 5.3 drag handlers are all registered inside that one call — 6.4 does NOT register IPC handlers itself.
  - The passthrough-mode broadcast uses the `IPC.PET_PASSTHROUGH_MODE_CHANGED` constant from `@shared/ipc`, NEVER the `'pet:passthrough-mode-changed'` string literal at the call site.

- [ ] **Step 5: Type-check the whole main process**

  Command:
  ```
  npx tsc --noEmit -p tsconfig.node.json
  ```
  Expected: no errors. Because every binding in `bootstrap()` is imported in Step 2 and declared active in Step 4, there should be NO `Cannot find name` errors for `settings`, `settingsStore`, `passthrough`, `togglePetVisibility`, `getPetWindow`, `getPanelWindow`, `IPC`, `startDisplayWatcher`, `registerIpcHandlers`, or `showPanelWindow`. If one appears, confirm the corresponding import from Step 2 is present and the binding is declared (not commented) in `bootstrap()`.

- [ ] **Step 6: Build to confirm main/preload/renderer compile**

  Command:
  ```
  npm run build
  ```
  Expected: electron-vite builds `out/main/index.js`, `out/preload/index.js`, `out/preload/panel.js`, `out/renderer/index.html`, `out/renderer/panel.html` with no errors. (If `npm run build` is not defined by the scaffold, use `npx electron-vite build`.)

- [ ] **Step 7: Manual verification (run the app)**

  Command:
  ```
  npm run dev
  ```
  Then perform these on-screen checks:

  1. **Pet window honors persisted visibility.** EXPECT: on a fresh launch (default `petVisible: true`) the transparent pet window appears at its restored, on-screen position. If you previously hid the pet via the tray (`petVisible: false` persisted) and relaunch, EXPECT the pet does NOT appear on startup until you toggle it back on from the tray.
  2. **Tray icon appears.** A tray/menu-bar icon shows up. EXPECT: exactly one icon present; it is the actual icon (not blank/missing) and does not vanish after a few seconds (confirms both the genuine ICO loads on Windows and the module-scope ref prevents GC). On Windows specifically: the app does NOT crash at startup with `Failed to load image from path` (confirms `tray.ico` is a real ICO container, not PNG bytes).
  3. **Tray menu opens with correct items.** Right-click the tray (Windows) / left- or right-click (macOS). EXPECT a menu in this order: `Hide Pet`, a separator, three radio items `Auto (hit-test)` / `Always Interactive` / `Always Click-through` with the radio dot on `Auto (hit-test)`, `Reset Interaction`, separator, `Open Panel`, separator, `Quit`.
  4. **Toggle visibility label flips.** Click `Hide Pet`. EXPECT the pet window disappears. Reopen the tray menu. EXPECT the first item now reads `Show Pet`. Click it. EXPECT the pet reappears and the label reverts to `Hide Pet`.
  5. **Mode radio updates.** Click `Always Click-through`. Reopen the menu. EXPECT the radio dot is now on `Always Click-through` (not `Auto`). The pet should ignore all clicks (cursor passes through). Click `Auto (hit-test)` to restore.
  6. **Reset Interaction is harmless.** Click `Reset Interaction`. EXPECT no crash; the pet becomes click-through until you hover its body again (auto mode re-engages on hover).
  7. **Open Panel -> normal window.** Click `Open Panel` (Windows: also try left-clicking the tray icon). EXPECT a NORMAL opaque, resizable window titled "Pet Panel" opens showing the placeholder panel route (white background, not transparent, has a title bar, is resizable by dragging an edge).
  8. **Create-or-focus.** With the panel already open, click `Open Panel` again. EXPECT NO second window is created; the existing panel is focused/brought to front. Minimize the panel, click `Open Panel`. EXPECT it restores.
  9. **Single instance (surfaces ONLY existing UI).** With the app running, in a second terminal run `npm run dev` again (or launch the built binary a second time). EXPECT the second instance exits immediately (no second tray icon, no duplicate pet). The pet window is focused/shown. If a panel was ALREADY open, it is restored/focused; if NO panel was open, NO panel is created by the second launch (the `second-instance` handler only surfaces an existing panel).
  10. **Settings broadcast reaches open windows.** With the panel open, toggle visibility or change mode from the tray. EXPECT the panel's live settings view reflects the new `petVisible`/`passthroughMode` without reopening the panel (confirms `broadcastSettingsChanged()` fires on `settings:changed`).
  11. **macOS no Dock icon (macOS only).** EXPECT no icon in the macOS Dock at any point — only the menu-bar tray icon. The pet and panel windows still appear and are clickable. (On Windows this check is N/A; instead confirm the pet window is absent from the taskbar — `skipTaskbar` — while the panel window IS allowed on the taskbar.)
  12. **Quit flushes and exits.** Drag the pet to a new position, then immediately click `Quit`. EXPECT the entire app exits: tray icon disappears, pet and panel windows close, the `npm run dev` process terminates. Relaunch with `npm run dev`. EXPECT the pet restores at the dragged position (confirms `ipcHandles.flushPersist()` persisted the pending debounced write on `before-quit`).

  If any check fails, fix the glue (do NOT alter the pure `buildTrayMenuModel` contract and do NOT edit any base file authored by another task) and re-run before committing.

- [ ] **Step 8: Commit**

  Command:
  ```
  git add src/main/index.ts && git commit -m "feat(main): sole index.ts bootstrap — single-instance lock, mac accessory policy, full whenReady wiring

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

## Definition of done (Plan 1)

- `npm run dev` launches a transparent, frameless, always-on-top window showing the placeholder pet; no taskbar entry (Windows) / no dock icon (macOS).
- Clicks pass through to the desktop everywhere **except** over the pet; the three passthrough modes (`auto` / `locked-interactive` / `locked-passthrough`) behave per `resolveIgnoreMouse`, and "reset interaction" recovers from any stuck state.
- The pet is draggable; its position survives a restart and is pulled back on-screen when the saved position is off any connected display.
- The tray menu shows/hides the pet, cycles passthrough mode, opens the panel, resets interaction, and quits; only one instance runs.
- The panel opens as a normal opaque, resizable window.
- `npx vitest run` is green: pure logic (`mergeSettings`, `clampPositionToDisplays`, `resolveIgnoreMouse`, `buildTrayMenuModel`, `debounce`, `SettingsStore`, `registerIpcHandlers`) is covered.