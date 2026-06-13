import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { createLibraryStore } from './libraryStore'

// Imports NO electron. Exercises the real node:sqlite DB + vault on a tmp dir.

let dir: string
let srcDir: string

function writeSource(name: string, content: string): string {
  const p = join(srcDir, name)
  writeFileSync(p, content, 'utf8')
  return p
}

function sha256Of(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

function shardPath(root: string, hash: string): string {
  return join(root, 'vault', 'blobs', hash.slice(0, 2), hash.slice(2, 4), hash)
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pet-library-'))
  srcDir = mkdtempSync(join(tmpdir(), 'pet-src-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  rmSync(srcDir, { recursive: true, force: true })
})

describe('createLibraryStore', () => {
  it('getDbPath returns <userDataDir>/library.db and creates the vault dirs', () => {
    const store = createLibraryStore(dir)
    expect(store.getDbPath()).toBe(join(dir, 'library.db'))
    expect(existsSync(join(dir, 'vault', 'blobs'))).toBe(true)
    expect(existsSync(join(dir, 'vault', 'tmp'))).toBe(true)
    store.dispose()
  })

  it('stamps PRAGMA user_version = 1 for future migrations', () => {
    const store = createLibraryStore(dir)
    store.dispose()
    const db = new DatabaseSync(join(dir, 'library.db'))
    const row = db.prepare('PRAGMA user_version').get() as { user_version: number }
    expect(row.user_version).toBe(1)
    db.close()
  })

  it('ingest hashes, copies to the content-addressed blob, and returns the record', async () => {
    const store = createLibraryStore(dir)
    const src = writeSource('hello.txt', 'hello world')
    const rec = await store.ingest(src)
    const hash = sha256Of('hello world')

    expect(rec.sha256).toBe(hash)
    expect(rec.originalName).toBe('hello.txt')
    expect(rec.ext).toBe('.txt')
    expect(rec.mime).toBe('text/plain')
    expect(rec.sizeBytes).toBe(Buffer.byteLength('hello world'))
    expect(rec.sourcePath).toBe(src)
    expect(typeof rec.ingestedAt).toBe('string')
    expect(Number.isNaN(Date.parse(rec.ingestedAt))).toBe(false)
    expect(existsSync(shardPath(dir, hash))).toBe(true)
    store.dispose()
  })

  it('list returns ingested records (newest first)', async () => {
    const store = createLibraryStore(dir)
    await store.ingest(writeSource('a.txt', 'aaa'))
    await store.ingest(writeSource('b.txt', 'bbb'))
    const all = store.list()
    expect(all.map((r) => r.originalName)).toEqual(['b.txt', 'a.txt'])
    store.dispose()
  })

  it('dedupes identical content at the blob layer (one blob, write-once)', async () => {
    const store = createLibraryStore(dir)
    await store.ingest(writeSource('first.txt', 'same'))
    await store.ingest(writeSource('second.txt', 'same')) // same content, different name
    const hash = sha256Of('same')
    const leafDir = join(dir, 'vault', 'blobs', hash.slice(0, 2), hash.slice(2, 4))
    expect(readdirSync(leafDir)).toEqual([hash]) // exactly one blob
    expect(store.list()).toHaveLength(2) // two display rows
    store.dispose()
  })

  it('skips a duplicate row only when same content AND same name', async () => {
    const store = createLibraryStore(dir)
    const a = await store.ingest(writeSource('dup.txt', 'x'))
    const b = await store.ingest(writeSource('dup.txt', 'x')) // identical name+content
    expect(b.id).toBe(a.id) // same row returned, not a new one
    expect(store.list()).toHaveLength(1)
    store.dispose()
  })

  it('leaves no .part temp behind after a successful ingest', async () => {
    const store = createLibraryStore(dir)
    await store.ingest(writeSource('c.txt', 'ccc'))
    expect(readdirSync(join(dir, 'vault', 'tmp'))).toEqual([])
    store.dispose()
  })

  it('rejects a missing source, a directory, and an oversize file', async () => {
    const store = createLibraryStore(dir, { maxBytes: 4 })
    await expect(store.ingest(join(srcDir, 'nope.txt'))).rejects.toThrow()
    mkdirSync(join(srcDir, 'adir'))
    await expect(store.ingest(join(srcDir, 'adir'))).rejects.toThrow()
    await expect(store.ingest(writeSource('big.txt', 'too many bytes'))).rejects.toThrow(
      /too large/i
    )
    expect(store.list()).toHaveLength(0)
    store.dispose()
  })

  it('remove deletes the row and reclaims the blob when it was the last reference', async () => {
    const store = createLibraryStore(dir)
    const a = await store.ingest(writeSource('one.txt', 'shared'))
    const b = await store.ingest(writeSource('two.txt', 'shared')) // shares the blob
    const hash = a.sha256
    store.remove(a.id)
    expect(existsSync(shardPath(dir, hash))).toBe(true) // b still references it
    store.remove(b.id)
    expect(existsSync(shardPath(dir, hash))).toBe(false) // last reference gone
    expect(store.list()).toHaveLength(0)
    store.dispose()
  })

  it('blobPathFor returns the on-disk blob path; materializeForOpen yields a named copy', async () => {
    const store = createLibraryStore(dir)
    const rec = await store.ingest(writeSource('doc.txt', 'content'))
    expect(store.blobPathFor(rec.id)).toBe(shardPath(dir, rec.sha256))
    const opened = store.materializeForOpen(rec.id)!
    expect(opened.endsWith('doc.txt')).toBe(true)
    expect(existsSync(opened)).toBe(true)
    store.dispose()
  })

  it('sweeps stale *.part temps on construction', () => {
    mkdirSync(join(dir, 'vault', 'tmp'), { recursive: true })
    writeFileSync(join(dir, 'vault', 'tmp', 'orphan.part'), 'junk')
    const store = createLibraryStore(dir)
    expect(existsSync(join(dir, 'vault', 'tmp', 'orphan.part'))).toBe(false)
    store.dispose()
  })

  it('persists across store instances (data survives reopen)', async () => {
    const store1 = createLibraryStore(dir)
    await store1.ingest(writeSource('persist.txt', 'keep'))
    store1.dispose()
    const store2 = createLibraryStore(dir)
    expect(store2.list().map((r) => r.originalName)).toEqual(['persist.txt'])
    store2.dispose()
  })
})
