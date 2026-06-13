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
