// ============================================================================
// src/main/libraryStore.ts
// File library: node:sqlite metadata DB + content-addressed file vault.
// Does NOT import electron — userDataDir is injected as a string so it is
// unit-testable (mirrors settingsStore.ts). shell/dialog live in the IPC layer.
// ============================================================================
import { DatabaseSync } from 'node:sqlite'
import { createHash, randomBytes } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import {
  mkdirSync,
  renameSync,
  statSync,
  existsSync,
  unlinkSync,
  copyFileSync,
  readdirSync
} from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { join, extname, basename, resolve as resolvePath, sep } from 'node:path'
import { extToMime } from '@shared/library/mime'
import type { FileRecord } from '@shared/types'

const DB_FILENAME = 'library.db'
const DEFAULT_MAX_BYTES = 1024 * 1024 * 1024 // 1 GiB

/** Raw SQLite row shape (snake_case). node:sqlite .get() returns a value castable
 *  to FileRow; .all() returns Record<string, SQLOutputValue>[] (cast through unknown). */
interface FileRow {
  id: number
  sha256: string
  original_name: string
  ext: string
  mime: string
  size_bytes: number
  ingested_at: string
  source_path: string | null
}

export interface LibraryStore {
  ingest(absPath: string): Promise<FileRecord>
  list(): FileRecord[]
  get(id: number): FileRecord | undefined
  remove(id: number): void
  /** Absolute path of the content-addressed blob, or undefined if no such id. */
  blobPathFor(id: number): string | undefined
  /** Copy the blob to userData/work/<id>/<originalName>; returns that path. */
  materializeForOpen(id: number): string | undefined
  getDbPath(): string
  dispose(): void
}

export interface LibraryStoreOptions {
  /** Reject ingests larger than this (bytes). Default 1 GiB. */
  maxBytes?: number
  /** Clock seam for deterministic tests. Default () => new Date(). */
  now?: () => Date
}

export function createLibraryStore(
  userDataDir: string,
  options: LibraryStoreOptions = {}
): LibraryStore {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  const now = options.now ?? ((): Date => new Date())

  const dbPath = join(userDataDir, DB_FILENAME)
  const vaultDir = join(userDataDir, 'vault')
  const blobsDir = join(vaultDir, 'blobs')
  const tmpDir = join(vaultDir, 'tmp')
  const workDir = join(userDataDir, 'work')

  mkdirSync(blobsDir, { recursive: true })
  mkdirSync(tmpDir, { recursive: true })
  sweepTmp()

  const db = new DatabaseSync(dbPath)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      id            INTEGER PRIMARY KEY,
      sha256        TEXT    NOT NULL,
      original_name TEXT    NOT NULL,
      ext           TEXT    NOT NULL DEFAULT '',
      mime          TEXT    NOT NULL DEFAULT '',
      size_bytes    INTEGER NOT NULL,
      ingested_at   TEXT    NOT NULL,
      source_path   TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_files_sha256 ON files(sha256);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_files_sha_name ON files(sha256, original_name);
  `)
  db.exec('PRAGMA user_version = 1') // schema v1; future migrations read+bump this here

  function sweepTmp(): void {
    if (!existsSync(tmpDir)) return
    for (const name of readdirSync(tmpDir)) {
      if (name.endsWith('.part')) safeUnlink(join(tmpDir, name))
    }
  }

  function safeUnlink(p: string): void {
    try {
      if (existsSync(p)) unlinkSync(p)
    } catch {
      /* best-effort cleanup */
    }
  }

  function blobPathForHash(hash: string): string {
    return join(blobsDir, hash.slice(0, 2), hash.slice(2, 4), hash)
  }

  function rowToRecord(row: FileRow): FileRecord {
    return {
      id: row.id,
      sha256: row.sha256,
      originalName: row.original_name,
      ext: row.ext,
      mime: row.mime,
      sizeBytes: row.size_bytes,
      ingestedAt: row.ingested_at,
      sourcePath: row.source_path
    }
  }

  async function ingest(absPath: string): Promise<FileRecord> {
    if (typeof absPath !== 'string' || absPath.length === 0 || absPath.includes('\0')) {
      throw new Error('invalid path')
    }
    const resolved = resolvePath(absPath)
    const st = statSync(resolved) // throws ENOENT for a missing source
    if (!st.isFile()) throw new Error('not a regular file')
    if (st.size > maxBytes) throw new Error(`file too large (${st.size} > ${maxBytes})`)

    // Single read: copy into tmp while updating the sha256 (constant memory).
    const tmpPath = join(tmpDir, `${randomBytes(8).toString('hex')}.part`)
    const hash = createHash('sha256')
    try {
      await pipeline(
        createReadStream(resolved),
        async function* tee(source) {
          for await (const chunk of source) {
            hash.update(chunk as Buffer)
            yield chunk
          }
        },
        createWriteStream(tmpPath)
      )
    } catch (err) {
      safeUnlink(tmpPath)
      throw err
    }

    const sha256 = hash.digest('hex')
    const destPath = blobPathForHash(sha256)
    // Defense-in-depth (spec §7): destPath is hash-derived so traversal is
    // structurally impossible, but assert containment within the vault.
    if (!destPath.startsWith(blobsDir + sep)) {
      safeUnlink(tmpPath)
      throw new Error('destination escapes vault')
    }
    if (existsSync(destPath)) {
      safeUnlink(tmpPath) // dedup: identical bytes already stored
    } else {
      mkdirSync(join(blobsDir, sha256.slice(0, 2), sha256.slice(2, 4)), { recursive: true })
      renameSync(tmpPath, destPath) // atomic (same volume)
    }

    const originalName = basename(resolved)
    const ext = extname(originalName).toLowerCase()
    const mime = extToMime(ext)
    const ingestedAt = now().toISOString()

    db.prepare(
      `INSERT OR IGNORE INTO files
         (sha256, original_name, ext, mime, size_bytes, ingested_at, source_path)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(sha256, originalName, ext, mime, st.size, ingestedAt, resolved)

    const row = db
      .prepare('SELECT * FROM files WHERE sha256 = ? AND original_name = ? ORDER BY id LIMIT 1')
      .get(sha256, originalName) as FileRow | undefined
    if (!row) throw new Error('ingest failed to persist row')
    return rowToRecord(row)
  }

  function list(): FileRecord[] {
    const rows = db.prepare('SELECT * FROM files ORDER BY id DESC').all() as unknown as FileRow[]
    return rows.map(rowToRecord)
  }

  function get(id: number): FileRecord | undefined {
    const row = db.prepare('SELECT * FROM files WHERE id = ?').get(id) as FileRow | undefined
    return row ? rowToRecord(row) : undefined
  }

  function remove(id: number): void {
    const row = db.prepare('SELECT sha256 FROM files WHERE id = ?').get(id) as
      | Pick<FileRow, 'sha256'>
      | undefined
    if (!row) return
    db.prepare('DELETE FROM files WHERE id = ?').run(id)
    const ref = db.prepare('SELECT COUNT(*) AS n FROM files WHERE sha256 = ?').get(row.sha256) as {
      n: number
    }
    if (ref.n === 0) safeUnlink(blobPathForHash(row.sha256))
  }

  function blobPathFor(id: number): string | undefined {
    const rec = get(id)
    return rec ? blobPathForHash(rec.sha256) : undefined
  }

  function materializeForOpen(id: number): string | undefined {
    const rec = get(id)
    if (!rec) return undefined
    const blob = blobPathForHash(rec.sha256)
    if (!existsSync(blob)) return undefined
    const outDir = join(workDir, String(id))
    mkdirSync(outDir, { recursive: true })
    const outPath = join(outDir, rec.originalName)
    copyFileSync(blob, outPath)
    return outPath
  }

  function getDbPath(): string {
    return dbPath
  }

  function dispose(): void {
    db.close()
  }

  return { ingest, list, get, remove, blobPathFor, materializeForOpen, getDbPath, dispose }
}
