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
  it('exposes the settings + library surface', () => {
    const api = buildPanelApi(makeFakeIpc() as never)
    expect(Object.keys(api).sort()).toEqual([
      'getPathForFile',
      'getSettings',
      'library',
      'onLibraryChanged',
      'onSettingsChanged',
      'setSettings'
    ])
    expect(Object.keys(api.library).sort()).toEqual([
      'ingestPaths',
      'list',
      'open',
      'pick',
      'remove',
      'reveal'
    ])
  })

  it('getPathForFile delegates to the injected resolver (single File)', () => {
    const pathResolver = vi.fn((f: { name: string }) => `/p/${f.name}`)
    const api = buildPanelApi(makeFakeIpc() as never, pathResolver as never)
    expect(api.getPathForFile({ name: 'a' } as never)).toBe('/p/a')
  })

  it('library.list/remove/open/reveal/pick invoke their channels', async () => {
    const ipc = makeFakeIpc()
    const api = buildPanelApi(ipc as never)
    await api.library.list()
    await api.library.ingestPaths(['/a'])
    await api.library.remove(1)
    await api.library.open(2)
    await api.library.reveal(3)
    await api.library.pick()
    expect(ipc.invoke).toHaveBeenCalledWith(IPC.LIBRARY_LIST)
    expect(ipc.invoke).toHaveBeenCalledWith(IPC.LIBRARY_INGEST, ['/a'])
    expect(ipc.invoke).toHaveBeenCalledWith(IPC.LIBRARY_REMOVE, 1)
    expect(ipc.invoke).toHaveBeenCalledWith(IPC.LIBRARY_OPEN, 2)
    expect(ipc.invoke).toHaveBeenCalledWith(IPC.LIBRARY_REVEAL, 3)
    expect(ipc.invoke).toHaveBeenCalledWith(IPC.LIBRARY_PICK)
  })

  it('onLibraryChanged subscribes to IPC.LIBRARY_CHANGED and returns an unsubscribe', () => {
    const ipc = makeFakeIpc()
    const api = buildPanelApi(ipc as never)
    const cb = vi.fn()
    const off = api.onLibraryChanged(cb)
    expect(ipc.on.mock.calls[0][0]).toBe(IPC.LIBRARY_CHANGED)
    const handler = ipc.on.mock.calls[0][1] as () => void
    handler()
    expect(cb).toHaveBeenCalledTimes(1)
    off()
    expect(ipc.removeListener).toHaveBeenCalledWith(IPC.LIBRARY_CHANGED, expect.any(Function))
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
    const handler = ipc.on.mock.calls[0][1] as (e: unknown, payload: { settings: Settings }) => void
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
