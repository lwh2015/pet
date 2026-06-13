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
    invoke: vi.fn(function (this: void, channel: string, ...args: unknown[]): Promise<unknown> {
      // Explicit Promise<unknown> return type keeps the mock's resolved type
      // permissive so the verbatim mockResolvedValueOnce(SAMPLE) call sites
      // typecheck under tsconfig.node (which includes *.test.ts). Runtime
      // object is unchanged.
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
    const handler = ipc.on.mock.calls[0][1] as (e: unknown, payload: { settings: Settings }) => void
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
