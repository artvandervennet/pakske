import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { count, eq } from 'drizzle-orm'
import { openDb } from '../server/db/client'
import { listOwners, purchases, users } from '../server/db/schema'
import { setPurchase } from '../server/domain/purchases'
import { addList, addWishTo } from './helpers'

const all = resolve('server/db/migrations')
const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** A copy of the migrations up to and including `last`, as an older version of the site had them. */
function migrationsUpTo(last: number): string {
  const dir = mkdtempSync(join(tmpdir(), 'migrations-'))
  dirs.push(dir)
  cpSync(all, dir, { recursive: true })
  const journalFile = join(dir, 'meta/_journal.json')
  const journal = JSON.parse(readFileSync(journalFile, 'utf8'))
  journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx <= last)
  writeFileSync(journalFile, JSON.stringify(journal))
  return dir
}

describe('upgrading a database that has data in it', () => {
  it('keeps every account, list and purchase when the accounts table is rebuilt', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'db-')), 'pakske.db')
    dirs.push(file.replace(/\/pakske\.db$/, ''))
    // Before Google login: the accounts table as it was.
    const before = openDb(file, migrationsUpTo(3))
    // Written by hand: the code of today would also fill in columns the old table doesn't have.
    const addOldUser = (name: string) => ({ id: Number(before.$client.prepare(
      `INSERT INTO users (email, display_name, password_hash, created_at) VALUES (?, ?, 'not-a-real-hash', ?)`,
    ).run(`${name}@example.test`, name, Date.now()).lastInsertRowid) })
    const art = addOldUser('art')
    const mom = addOldUser('mom')
    const token = addList(before, art.id)
    const wish = addWishTo(before, art.id, token, 'Lamp')
    setPurchase(before, token, wish.id, mom.id, 1)
    before.$client.close()

    const after = openDb(file)
    expect(after.select({ n: count() }).from(users).get()!.n).toBe(2)
    expect(after.select({ n: count() }).from(listOwners).where(eq(listOwners.userId, art.id)).get()!.n).toBe(1)
    expect(after.select({ n: count() }).from(purchases).get()!.n).toBe(1)
    expect(after.select().from(users).where(eq(users.id, art.id)).get()).toMatchObject({ passwordHash: 'not-a-real-hash', googleSub: null })
    expect(after.$client.pragma('foreign_keys', { simple: true })).toBe(1)
  })
})
