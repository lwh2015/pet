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
