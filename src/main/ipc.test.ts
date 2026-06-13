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
