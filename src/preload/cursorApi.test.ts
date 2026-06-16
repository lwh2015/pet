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
