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
  const libraryStore = {
    list: vi.fn(() => [] as never[]),
    ingest: vi.fn(async (p: string) => ({
      id: 1,
      sha256: 'a'.repeat(64),
      originalName: p,
      ext: '.txt',
      mime: 'text/plain',
      sizeBytes: 3,
      ingestedAt: '2026-06-13T00:00:00.000Z',
      sourcePath: p
    })),
    remove: vi.fn(),
    blobPathFor: vi.fn((id: number) => `/vault/${id}`),
    materializeForOpen: vi.fn((id: number) => `/work/${id}/file.txt`)
  }
  const shell = { openPath: vi.fn(async () => ''), showItemInFolder: vi.fn() }
  const dialog = {
    showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] as string[] }))
  }
  const broadcastLibraryChanged = vi.fn()
  const deps: IpcDeps = {
    settingsStore: store as never,
    passthrough: makeFakePassthrough() as never,
    showPanelWindow,
    getPetWindow: () => win as never,
    broadcastSettingsChanged,
    getAllWindows: () => [win as never],
    libraryStore: libraryStore as never,
    shell: shell as never,
    dialog: dialog as never,
    broadcastLibraryChanged
  }
  return {
    deps,
    win,
    showPanelWindow,
    broadcastSettingsChanged,
    libraryStore,
    shell,
    dialog,
    broadcastLibraryChanged
  }
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

describe('registerIpcHandlers — library:*', () => {
  it('registers handle for all library channels', () => {
    const { deps } = makeDeps(makeFakeStore(BASE))
    registerIpcHandlers(deps)
    for (const ch of [
      IPC.LIBRARY_LIST,
      IPC.LIBRARY_INGEST,
      IPC.LIBRARY_REMOVE,
      IPC.LIBRARY_OPEN,
      IPC.LIBRARY_REVEAL,
      IPC.LIBRARY_PICK
    ]) {
      expect(handlers.has(ch)).toBe(true)
    }
  })

  it('LIBRARY_LIST returns the store listing', async () => {
    const { deps, libraryStore } = makeDeps(makeFakeStore(BASE))
    libraryStore.list.mockReturnValueOnce([{ id: 7 }] as never)
    registerIpcHandlers(deps)
    const result = await handlers.get(IPC.LIBRARY_LIST)!({})
    expect(result).toEqual([{ id: 7 }])
  })

  it('LIBRARY_INGEST maps each path to an ok result and broadcasts', async () => {
    const { deps, broadcastLibraryChanged } = makeDeps(makeFakeStore(BASE))
    registerIpcHandlers(deps)
    const result = (await handlers.get(IPC.LIBRARY_INGEST)!({}, ['/a.txt', '/b.txt'])) as Array<{
      ok: boolean
    }>
    expect(result).toHaveLength(2)
    expect(result.every((r) => r.ok)).toBe(true)
    expect(broadcastLibraryChanged).toHaveBeenCalledTimes(1)
  })

  it('LIBRARY_INGEST reports a failing path as { ok:false } and still broadcasts the ok ones', async () => {
    const { deps, libraryStore, broadcastLibraryChanged } = makeDeps(makeFakeStore(BASE))
    libraryStore.ingest
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ id: 2 } as never)
    registerIpcHandlers(deps)
    const result = (await handlers.get(IPC.LIBRARY_INGEST)!({}, ['/bad', '/good'])) as Array<{
      ok: boolean
      error?: string
    }>
    expect(result[0]).toMatchObject({ ok: false, error: 'boom' })
    expect(result[1]).toMatchObject({ ok: true })
    expect(broadcastLibraryChanged).toHaveBeenCalledTimes(1)
  })

  it('LIBRARY_INGEST does NOT broadcast when every path fails', async () => {
    const { deps, libraryStore, broadcastLibraryChanged } = makeDeps(makeFakeStore(BASE))
    libraryStore.ingest.mockRejectedValue(new Error('nope'))
    registerIpcHandlers(deps)
    await handlers.get(IPC.LIBRARY_INGEST)!({}, ['/x'])
    expect(broadcastLibraryChanged).not.toHaveBeenCalled()
  })

  it('LIBRARY_REMOVE removes and broadcasts', async () => {
    const { deps, libraryStore, broadcastLibraryChanged } = makeDeps(makeFakeStore(BASE))
    registerIpcHandlers(deps)
    await handlers.get(IPC.LIBRARY_REMOVE)!({}, 5)
    expect(libraryStore.remove).toHaveBeenCalledWith(5)
    expect(broadcastLibraryChanged).toHaveBeenCalledTimes(1)
  })

  it('LIBRARY_OPEN materializes then opens via shell', async () => {
    const { deps, libraryStore, shell } = makeDeps(makeFakeStore(BASE))
    registerIpcHandlers(deps)
    await handlers.get(IPC.LIBRARY_OPEN)!({}, 3)
    expect(libraryStore.materializeForOpen).toHaveBeenCalledWith(3)
    expect(shell.openPath).toHaveBeenCalledWith('/work/3/file.txt')
  })

  it('LIBRARY_REVEAL shows the blob in the folder', async () => {
    const { deps, shell } = makeDeps(makeFakeStore(BASE))
    registerIpcHandlers(deps)
    await handlers.get(IPC.LIBRARY_REVEAL)!({}, 4)
    expect(shell.showItemInFolder).toHaveBeenCalledWith('/vault/4')
  })

  it('LIBRARY_PICK returns [] when the dialog is canceled', async () => {
    const { deps } = makeDeps(makeFakeStore(BASE))
    registerIpcHandlers(deps)
    const result = await handlers.get(IPC.LIBRARY_PICK)!({})
    expect(result).toEqual([])
  })

  it('LIBRARY_PICK ingests the chosen paths', async () => {
    const { deps, dialog, broadcastLibraryChanged } = makeDeps(makeFakeStore(BASE))
    dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/picked.txt'] })
    registerIpcHandlers(deps)
    const result = (await handlers.get(IPC.LIBRARY_PICK)!({})) as Array<{ ok: boolean }>
    expect(result).toHaveLength(1)
    expect(result[0].ok).toBe(true)
    expect(broadcastLibraryChanged).toHaveBeenCalledTimes(1)
  })
})
