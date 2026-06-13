import { describe, it, expect } from 'vitest'
import { LIVE2D_MODEL, CUBISM_CORE_SRC, ALPHA_HIT_THRESHOLD } from './modelConfig'
import { DEFAULT_ALPHA_THRESHOLD } from './hitMath'
import { DEFAULT_ACTION_MAP } from './actionMap'

describe('LIVE2D_MODEL', () => {
  it('uses one relative modelUrl with NO leading slash (dev + packaged share it)', () => {
    expect(LIVE2D_MODEL.modelUrl.startsWith('/')).toBe(false)
    expect(LIVE2D_MODEL.modelUrl).toBe('models/haru/haru.model3.json')
  })

  it('centers on the model anchor (0.5, 0.5)', () => {
    expect(LIVE2D_MODEL.anchor).toEqual({ x: 0.5, y: 0.5 })
  })

  it('has a fitScale in (0,1] so the model breathes inside the window', () => {
    expect(LIVE2D_MODEL.fitScale).toBeGreaterThan(0)
    expect(LIVE2D_MODEL.fitScale).toBeLessThanOrEqual(1)
  })

  it('names the idle motion group consistently with the default action map', () => {
    expect(LIVE2D_MODEL.idleMotionGroup).toBe('Idle')
    expect(LIVE2D_MODEL.actionMap.idle.motionGroup).toBe(LIVE2D_MODEL.idleMotionGroup)
  })

  it('wires the default action map by reference', () => {
    expect(LIVE2D_MODEL.actionMap).toBe(DEFAULT_ACTION_MAP)
  })
})

describe('CUBISM_CORE_SRC', () => {
  it('is a RELATIVE path (./) so it resolves in dev and packaged file://', () => {
    expect(CUBISM_CORE_SRC).toBe('./live2dcubismcore.min.js')
    expect(CUBISM_CORE_SRC.startsWith('/')).toBe(false)
  })
})

describe('ALPHA_HIT_THRESHOLD', () => {
  it('is re-exported from hitMath, not a second literal (single source of truth)', () => {
    expect(ALPHA_HIT_THRESHOLD).toBe(DEFAULT_ALPHA_THRESHOLD)
  })
})
