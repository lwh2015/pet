// D:\aicode\pet\src\main\ipc.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { IPC } from '@shared/ipc'
import type { Settings } from '@shared/types'

// Mock electron's ipcMain so registerIpcHandlers' module-top import is a fake we
// can inspect. registerIpcHandlers has the single-arg (deps) signature; the
// electron seam is captured here rather than injected. The drag controller
// (built inside registerIpcHandlers via createDragController -> dragController.ts,
// which imports `screen` and the shared readDisplayBounds) needs a `screen` stub
// so onStart/onEnd can run when we fire the drag channels below.
const handlers = new Map<string, (...a: unknown[]) => unknown>()
const listeners = new Map<string, (...a: unknown[]) => void>()
const handle = vi.fn((channel: string, fn: (...a: unknown[]) => unknown) => {
  handlers.set(channel, fn)
})
const on = vi.fn((channel: string, fn: (...a: unknown[]) => void) => {
  listeners.set(channel, fn)
})
// vi.mock is hoisted above the module body and the factory dereferences `screen`
// directly, so the fake must be created inside vi.hoisted() to exist first.
const { screen } = vi.hoisted(() => {
  const DISPLAY = {
    id: 1,
    workArea: { x: 0, y: 0, width: 1920, height: 1040 }
  }
  return {
    screen: {
      getCursorScreenPoint: vi.fn(() => ({ x: 500, y: 400 })),
      getAllDisplays: vi.fn(() => [DISPLAY]),
      getPrimaryDisplay: vi.fn(() => DISPLAY)
    }
  }
})
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...a: unknown[]) => unknown) => handle(channel, fn),
    on: (channel: string, fn: (...a: unknown[]) => void) => on(channel, fn)
  },
  screen
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
    webContents: { send: vi.fn() },
    // Drag controller seams (onStart/onMove/onEnd) — start at 100,100.
    getPosition: vi.fn(() => [100, 100]),
    getSize: vi.fn(() => [300, 300]),
    setPosition: vi.fn(),
    setBounds: vi.fn()
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
  screen.getCursorScreenPoint.mockClear()
  screen.getAllDisplays.mockClear()
  screen.getPrimaryDisplay.mockClear()
  screen.getCursorScreenPoint.mockReturnValue({ x: 500, y: 400 })
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

  it('flushPersist actually persists the dragged position and broadcasts', () => {
    const store = makeFakeStore(BASE)
    const { deps, broadcastSettingsChanged } = makeDeps(store)
    const handles = registerIpcHandlers(deps)
    expect(typeof handles.flushPersist).toBe('function')

    // Simulate a drag: start (captures offset), then end (clamps + schedules
    // the debounced persist). The window sits at 100,100 size 300x300 inside the
    // single 1920x1040 work area, so the clamp leaves it unchanged.
    listeners.get(IPC.PET_DRAG_START)!({} /* IpcMainEvent */)
    listeners.get(IPC.PET_DRAG_END)!({} /* IpcMainEvent */)

    // Nothing persisted yet (still inside the 400ms debounce window).
    expect(store.set).not.toHaveBeenCalled()
    expect(broadcastSettingsChanged).not.toHaveBeenCalled()

    // Flushing the pending debounced write persists + broadcasts exactly once.
    handles.flushPersist()
    expect(store.set).toHaveBeenCalledTimes(1)
    expect(store.set).toHaveBeenCalledWith({
      petPosition: { x: 100, y: 100, width: 300, height: 300 }
    })
    expect(broadcastSettingsChanged).toHaveBeenCalledTimes(1)
  })

  it('flushPersist is a safe no-op when no drag is pending', () => {
    const store = makeFakeStore(BASE)
    const { deps, broadcastSettingsChanged } = makeDeps(store)
    const handles = registerIpcHandlers(deps)
    expect(() => handles.flushPersist()).not.toThrow()
    expect(store.set).not.toHaveBeenCalled()
    expect(broadcastSettingsChanged).not.toHaveBeenCalled()
  })

  it('registers on for the three drag channels', () => {
    const store = makeFakeStore(BASE)
    const { deps } = makeDeps(store)
    registerIpcHandlers(deps)
    expect(listeners.has(IPC.PET_DRAG_START)).toBe(true)
    expect(listeners.has(IPC.PET_DRAG_MOVE)).toBe(true)
    expect(listeners.has(IPC.PET_DRAG_END)).toBe(true)
  })

  it('a stray drag-end without a drag-start does not persist', () => {
    const store = makeFakeStore(BASE)
    const { deps, broadcastSettingsChanged } = makeDeps(store)
    const handles = registerIpcHandlers(deps)
    // No PET_DRAG_START first — onEnd must gate on the in-progress flag.
    listeners.get(IPC.PET_DRAG_END)!({} /* IpcMainEvent */)
    handles.flushPersist()
    expect(store.set).not.toHaveBeenCalled()
    expect(broadcastSettingsChanged).not.toHaveBeenCalled()
  })

  it('PET_SET_INTERACTIVE forwards a truthy payload to passthrough.setOverInteractive', () => {
    const store = makeFakeStore(BASE)
    const { deps } = makeDeps(store)
    registerIpcHandlers(deps)
    const listener = listeners.get(IPC.PET_SET_INTERACTIVE)!
    listener({}, { interactive: true })
    expect(deps.passthrough.setOverInteractive).toHaveBeenCalledWith(true)
  })

  it('PET_SET_INTERACTIVE forwards a falsy payload to passthrough.setOverInteractive', () => {
    const store = makeFakeStore(BASE)
    const { deps } = makeDeps(store)
    registerIpcHandlers(deps)
    const listener = listeners.get(IPC.PET_SET_INTERACTIVE)!
    listener({}, { interactive: false })
    expect(deps.passthrough.setOverInteractive).toHaveBeenCalledWith(false)
  })

  it('PET_SET_INTERACTIVE coerces a malformed payload to false (Boolean(undefined))', () => {
    const store = makeFakeStore(BASE)
    const { deps } = makeDeps(store)
    registerIpcHandlers(deps)
    const listener = listeners.get(IPC.PET_SET_INTERACTIVE)!
    // Missing/undefined payload must not throw and coerces to false.
    expect(() => listener({}, undefined)).not.toThrow()
    expect(deps.passthrough.setOverInteractive).toHaveBeenLastCalledWith(false)
    // A non-object payload also coerces defensively.
    listener({}, { nope: 1 })
    expect(deps.passthrough.setOverInteractive).toHaveBeenLastCalledWith(false)
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
