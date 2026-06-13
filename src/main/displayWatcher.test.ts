// ============================================================================
// src/main/displayWatcher.test.ts
// ============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---- Mock the electron `screen` module so we can capture listeners. --------
type Listener = (...args: unknown[]) => void
// vi.mock is hoisted above the module body, so the fake it references must be
// created inside vi.hoisted() to exist before the mock factory runs.
const { listeners, fakeScreen } = vi.hoisted(() => {
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
  return { listeners, fakeScreen }
})

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
