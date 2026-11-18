import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { databaseFile } from '../server/db/file'

const dirs: string[] = []
function dataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'data-'))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('the database file', () => {
  it('is pakske.db in the data folder', () => {
    const dir = dataDir()
    expect(databaseFile(dir)).toBe(join(dir, 'pakske.db'))
  })

  it('takes over a database from when the site was called wishlist, journal and all', () => {
    const dir = dataDir()
    for (const end of ['', '-wal', '-shm']) writeFileSync(join(dir, `wishlist.db${end}`), `old${end}`)

    expect(databaseFile(dir)).toBe(join(dir, 'pakske.db'))

    for (const end of ['', '-wal', '-shm']) {
      expect(readFileSync(join(dir, `pakske.db${end}`), 'utf8')).toBe(`old${end}`)
      expect(existsSync(join(dir, `wishlist.db${end}`))).toBe(false)
    }
  })

  it('leaves an old file alone once pakske.db exists', () => {
    const dir = dataDir()
    writeFileSync(join(dir, 'pakske.db'), 'new')
    writeFileSync(join(dir, 'wishlist.db'), 'old')

    databaseFile(dir)

    expect(readFileSync(join(dir, 'pakske.db'), 'utf8')).toBe('new')
    expect(readFileSync(join(dir, 'wishlist.db'), 'utf8')).toBe('old')
  })

  it('moves a journal only together with its database', () => {
    const dir = dataDir()
    writeFileSync(join(dir, 'wishlist.db-wal'), 'stray')

    databaseFile(dir)

    expect(existsSync(join(dir, 'pakske.db-wal'))).toBe(false)
  })
})
