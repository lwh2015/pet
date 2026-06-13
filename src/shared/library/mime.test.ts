import { describe, it, expect } from 'vitest'
import { extToMime } from './mime'

describe('extToMime', () => {
  it('maps common known extensions', () => {
    expect(extToMime('.png')).toBe('image/png')
    expect(extToMime('.pdf')).toBe('application/pdf')
    expect(extToMime('.txt')).toBe('text/plain')
    expect(extToMime('.docx')).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    )
  })

  it('is case-insensitive', () => {
    expect(extToMime('.PNG')).toBe('image/png')
  })

  it('falls back to application/octet-stream for unknown or empty', () => {
    expect(extToMime('.zzz')).toBe('application/octet-stream')
    expect(extToMime('')).toBe('application/octet-stream')
  })
})
