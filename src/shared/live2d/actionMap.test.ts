import { describe, it, expect } from 'vitest'
import { resolveAction, DEFAULT_ACTION_MAP, type ActionMap, type ActionTag } from './actionMap'

describe('DEFAULT_ACTION_MAP', () => {
  const allTags: ActionTag[] = ['idle', 'greet', 'talk', 'think', 'happy', 'react', 'receive']

  it('has an entry for every ActionTag (total table)', () => {
    for (const tag of allTags) {
      expect(DEFAULT_ACTION_MAP[tag]).toBeDefined()
      expect(typeof DEFAULT_ACTION_MAP[tag].motionGroup).toBe('string')
      expect(DEFAULT_ACTION_MAP[tag].motionGroup.length).toBeGreaterThan(0)
    }
  })

  it('maps priorities per the contract (idle->idle, greet/talk/think->normal, happy/react/receive->reaction)', () => {
    expect(DEFAULT_ACTION_MAP.idle.priority).toBe('idle')
    expect(DEFAULT_ACTION_MAP.greet.priority).toBe('normal')
    expect(DEFAULT_ACTION_MAP.talk.priority).toBe('normal')
    expect(DEFAULT_ACTION_MAP.think.priority).toBe('normal')
    expect(DEFAULT_ACTION_MAP.happy.priority).toBe('reaction')
    expect(DEFAULT_ACTION_MAP.react.priority).toBe('reaction')
    expect(DEFAULT_ACTION_MAP.receive.priority).toBe('reaction')
  })

  it('targets the bundled-model groups/expressions exactly', () => {
    expect(DEFAULT_ACTION_MAP.idle).toEqual({ motionGroup: 'Idle', priority: 'idle' })
    expect(DEFAULT_ACTION_MAP.greet).toEqual({
      motionGroup: 'Tap',
      expression: 'f00',
      priority: 'normal'
    })
    expect(DEFAULT_ACTION_MAP.talk).toEqual({
      motionGroup: 'Idle',
      expression: 'f01',
      priority: 'normal'
    })
    expect(DEFAULT_ACTION_MAP.think).toEqual({
      motionGroup: 'Idle',
      expression: 'f02',
      priority: 'normal'
    })
    expect(DEFAULT_ACTION_MAP.happy).toEqual({
      motionGroup: 'Tap',
      expression: 'f03',
      priority: 'reaction'
    })
    expect(DEFAULT_ACTION_MAP.react).toEqual({ motionGroup: 'Tap', priority: 'reaction' })
    expect(DEFAULT_ACTION_MAP.receive).toEqual({
      motionGroup: 'Tap',
      expression: 'f05',
      priority: 'reaction'
    })
  })

  it('resolves greet/react to the reconciled model names', () => {
    expect(resolveAction('greet').motionGroup).toBe('Tap')
    expect(resolveAction('greet').expression).toBe('f00')
    expect(resolveAction('react').expression).toBeUndefined()
  })
})

describe('resolveAction', () => {
  it('returns the DEFAULT_ACTION_MAP entry for each tag when no map is passed', () => {
    expect(resolveAction('idle')).toBe(DEFAULT_ACTION_MAP.idle)
    expect(resolveAction('greet')).toBe(DEFAULT_ACTION_MAP.greet)
    expect(resolveAction('receive')).toBe(DEFAULT_ACTION_MAP.receive)
  })

  it('returns the exact entry object (referential identity, no copy/mutation)', () => {
    expect(resolveAction('happy')).toBe(DEFAULT_ACTION_MAP.happy)
  })

  it('uses a custom map override when provided', () => {
    const custom: ActionMap = {
      ...DEFAULT_ACTION_MAP,
      greet: { motionGroup: 'Hello', motionIndex: 2, expression: 'X09', priority: 'reaction' }
    }
    expect(resolveAction('greet', custom)).toEqual({
      motionGroup: 'Hello',
      motionIndex: 2,
      expression: 'X09',
      priority: 'reaction'
    })
    // non-overridden tags still come from the custom map (which spreads the default)
    expect(resolveAction('idle', custom)).toBe(DEFAULT_ACTION_MAP.idle)
  })

  it('does not mutate the default map when a custom map is used', () => {
    const before = { ...DEFAULT_ACTION_MAP.greet }
    const custom: ActionMap = {
      ...DEFAULT_ACTION_MAP,
      greet: { motionGroup: 'Other', priority: 'normal' }
    }
    resolveAction('greet', custom)
    expect(DEFAULT_ACTION_MAP.greet).toEqual(before)
  })

  it('is total: never returns undefined for any valid ActionTag', () => {
    const allTags: ActionTag[] = ['idle', 'greet', 'talk', 'think', 'happy', 'react', 'receive']
    for (const tag of allTags) {
      expect(resolveAction(tag)).toBeDefined()
    }
  })
})
