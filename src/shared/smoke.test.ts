import { describe, it, expect } from 'vitest'
import { smoke } from './smoke'

describe('smoke', () => {
  it('returns the fixed sentinel string proving vitest runs', () => {
    expect(smoke()).toBe('ok')
  })
})
