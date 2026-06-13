// ============================================================================
// src/shared/debounce.ts
// Pure trailing-edge debounce factory. ELECTRON-FREE.
// Used by the persist-position logic in src/main/dragController.ts and
// unit-tested with vi.useFakeTimers().
// ============================================================================

/**
 * A debounced wrapper around `fn`. Calling it delays `fn` until `waitMs`
 * milliseconds elapse since the most recent call (the last args win).
 *  - cancel(): drop any pending call without invoking fn.
 *  - flush():  if a call is pending, invoke fn immediately with the last args.
 * Trailing-edge only. Pure (setTimeout/clearTimeout only).
 */
export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  waitMs: number
): { (...args: A): void; cancel(): void; flush(): void } {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pendingArgs: A | null = null

  const debounced = (...args: A): void => {
    pendingArgs = args
    if (timer !== null) {
      clearTimeout(timer)
    }
    timer = setTimeout(() => {
      timer = null
      const callArgs = pendingArgs as A
      pendingArgs = null
      fn(...callArgs)
    }, waitMs)
  }

  debounced.cancel = (): void => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    pendingArgs = null
  }

  debounced.flush = (): void => {
    if (timer === null) {
      return
    }
    clearTimeout(timer)
    timer = null
    const callArgs = pendingArgs as A
    pendingArgs = null
    fn(...callArgs)
  }

  return debounced
}
