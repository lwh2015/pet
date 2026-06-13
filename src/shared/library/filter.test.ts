import { describe, it, expect } from 'vitest'
import { filterFiles } from './filter'
import type { FileRecord } from '@shared/types'

function rec(p: Partial<FileRecord>): FileRecord {
  return {
    id: 1,
    sha256: 'a'.repeat(64),
    originalName: 'file.txt',
    ext: '.txt',
    mime: 'text/plain',
    sizeBytes: 10,
    ingestedAt: '2026-06-13T00:00:00.000Z',
    sourcePath: null,
    ...p
  }
}

describe('filterFiles', () => {
  const items = [
    rec({ id: 1, originalName: 'Vacation Budget.xlsx', ext: '.xlsx', mime: 'application/vnd.ms-excel' }),
    rec({ id: 2, originalName: 'notes.md', ext: '.md', mime: 'text/markdown' }),
    rec({ id: 3, originalName: 'photo.png', ext: '.png', mime: 'image/png' })
  ]

  it('returns all items for an empty/whitespace query', () => {
    expect(filterFiles(items, '')).toHaveLength(3)
    expect(filterFiles(items, '   ')).toHaveLength(3)
  })

  it('matches on name, case-insensitively', () => {
    expect(filterFiles(items, 'budget').map((f) => f.id)).toEqual([1])
  })

  it('matches on extension and mime', () => {
    expect(filterFiles(items, '.png').map((f) => f.id)).toEqual([3])
    expect(filterFiles(items, 'image').map((f) => f.id)).toEqual([3])
  })

  it('returns [] when nothing matches', () => {
    expect(filterFiles(items, 'zzzzz')).toEqual([])
  })
})
