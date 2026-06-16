// src/main/cursorTracker.test.ts
import { describe, it, expect, vi } from 'vitest'
import { createCursorTracker } from './cursorTracker'

function fakeWindow(opts: {
  visible?: boolean
  destroyed?: boolean
  bounds?: { x: number; y: number; width: number; height: number }
}) {
  return {
    isVisible: () => opts.visible ?? true,
    isDestroyed: () => opts.destroyed ?? false,
    getBounds: () => opts.bounds ?? { x: 100, y: 50, width: 200, height: 210 }
  }
}

describe('createCursorTracker', () => {
  it('sends the window-local cursor on each tick while visible, deduping identical points', () => {
    let tick = (): void => {}
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
    let tick = (): void => {}
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
