import { describe, it, expect } from 'vitest'
import { nextIdleAction, DEFAULT_IDLE_CONFIG, type IdleSchedulerConfig } from './idleScheduler'
import type { ActionTag } from './actionMap'

const TAGS: readonly ActionTag[] = ['idle', 'happy', 'react'] as const

const cfg: IdleSchedulerConfig = {
  minDelayMs: 4000,
  maxDelayMs: 9000,
  tags: TAGS,
  avoidRepeat: true
}

describe('DEFAULT_IDLE_CONFIG', () => {
  it('has a valid delay window and at least one tag', () => {
    expect(DEFAULT_IDLE_CONFIG.minDelayMs).toBeGreaterThan(0)
    expect(DEFAULT_IDLE_CONFIG.maxDelayMs).toBeGreaterThanOrEqual(DEFAULT_IDLE_CONFIG.minDelayMs)
    expect(DEFAULT_IDLE_CONFIG.tags.length).toBeGreaterThan(0)
  })
})

describe('nextIdleAction — delay', () => {
  it('returns minDelayMs when random() (for delay) is 0', () => {
    // first random() call selects the tag, second drives the delay
    const seq = [0, 0]
    let i = 0
    const random = (): number => seq[i++]
    const { delayMs } = nextIdleAction({ random, now: 1000 }, cfg)
    expect(delayMs).toBe(4000)
  })

  it('returns a delay strictly below maxDelayMs as random()->~1 (half-open window)', () => {
    const seq = [0, 0.999999]
    let i = 0
    const random = (): number => seq[i++]
    const { delayMs } = nextIdleAction({ random, now: 0 }, cfg)
    expect(delayMs).toBeGreaterThanOrEqual(4000)
    expect(delayMs).toBeLessThan(9000)
  })

  it('keeps delay within [minDelayMs, maxDelayMs) for a mid-range random()', () => {
    const seq = [0.5, 0.5]
    let i = 0
    const random = (): number => seq[i++]
    const { delayMs } = nextIdleAction({ random, now: 0 }, cfg)
    expect(delayMs).toBe(4000 + Math.floor(0.5 * (9000 - 4000))) // 6500
  })
})

describe('nextIdleAction — tag selection', () => {
  it('selects the first tag when tag-random is 0', () => {
    const seq = [0, 0.5]
    let i = 0
    const random = (): number => seq[i++]
    expect(nextIdleAction({ random, now: 0 }, cfg).tag).toBe('idle')
  })

  it('selects the last tag when tag-random approaches 1', () => {
    const seq = [0.999999, 0.5]
    let i = 0
    const random = (): number => seq[i++]
    expect(nextIdleAction({ random, now: 0 }, cfg).tag).toBe('react')
  })

  it('is deterministic for a fixed random sequence', () => {
    const make = (): (() => number) => {
      const seq = [0.4, 0.7]
      let i = 0
      return (): number => seq[i++]
    }
    const a = nextIdleAction({ random: make(), now: 0 }, cfg)
    const b = nextIdleAction({ random: make(), now: 0 }, cfg)
    expect(a).toEqual(b)
  })
})

describe('nextIdleAction — avoidRepeat', () => {
  it('never returns lastTag when avoidRepeat is set and tags.length > 1', () => {
    // tag-random 0 would normally pick tags[0]==='idle'; lastTag 'idle' must be skipped
    const seq = [0, 0.5]
    let i = 0
    const random = (): number => seq[i++]
    const { tag } = nextIdleAction({ random, now: 0, lastTag: 'idle' }, cfg)
    expect(tag).not.toBe('idle')
  })

  it('still picks across the remaining tags deterministically when avoiding repeat', () => {
    // with 'happy' excluded, remaining = ['idle','react']; tag-random ~1 -> last remaining
    const seq = [0.999999, 0.5]
    let i = 0
    const random = (): number => seq[i++]
    const { tag } = nextIdleAction({ random, now: 0, lastTag: 'happy' }, cfg)
    expect(tag).toBe('react')
  })

  it('returns the only tag even if it equals lastTag when tags.length === 1', () => {
    const single: IdleSchedulerConfig = {
      minDelayMs: 1000,
      maxDelayMs: 2000,
      tags: ['idle'],
      avoidRepeat: true
    }
    const random = (): number => 0
    expect(nextIdleAction({ random, now: 0, lastTag: 'idle' }, single).tag).toBe('idle')
  })

  it('does not skip lastTag when avoidRepeat is false', () => {
    const noAvoid: IdleSchedulerConfig = { ...cfg, avoidRepeat: false }
    const seq = [0, 0.5]
    let i = 0
    const random = (): number => seq[i++]
    expect(nextIdleAction({ random, now: 0, lastTag: 'idle' }, noAvoid).tag).toBe('idle')
  })
})
