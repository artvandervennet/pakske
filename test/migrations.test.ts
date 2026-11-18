import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { count, eq } from 'drizzle-orm'
import { openDb } from '../server/db/client'
import { listOwners, lists, purchases, users } from '../server/db/schema'
import { getListView } from '../server/domain/list-view'
import { LIST_TOKEN } from '../server/domain/tokens'

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

/** A database file that an older version of the site made, with migrations up to and including `last`. */
function oldDb(last: number) {
  const file = join(mkdtempSync(join(tmpdir(), 'db-')), 'pakske.db')
  dirs.push(file.replace(/\/pakske\.db$/, ''))
  const db = openDb(file, migrationsUpTo(last))
  // Rows are written by hand: the code of today would also fill in columns an old table doesn't have.
  const sql = db.$client
  const now = Date.now()
  const id = (result: { lastInsertRowid: number | bigint }) => Number(result.lastInsertRowid)
  return {
    file,
    close: () => sql.close(),
    user: (name: string) => id(sql.prepare(
      `INSERT INTO users (email, display_name, password_hash, created_at) VALUES (?, ?, 'not-a-real-hash', ?)`,
    ).run(`${name}@example.test`, name, now)),
    list: (userId: number, token: string) => {
      const listId = id(sql.prepare(`INSERT INTO lists (token, title, created_at) VALUES (?, 'Lijst', ?)`).run(token, now))
      sql.prepare(`INSERT INTO list_owners (list_id, user_id, added_at) VALUES (?, ?, ?)`).run(listId, userId, now)
      return listId
    },
    wish: (userId: number, listId: number, title: string) => {
      const wishId = id(sql.prepare(`INSERT INTO wishes (title, created_at, updated_at) VALUES (?, ?, ?)`).run(title, now, now))
      sql.prepare(`INSERT INTO wish_owners (wish_id, user_id, added_at) VALUES (?, ?, ?)`).run(wishId, userId, now)
      sql.prepare(`INSERT INTO list_wishes (list_id, wish_id, added_at) VALUES (?, ?, ?)`).run(listId, wishId, now)
      return wishId
    },
    purchase: (wishId: number, userId: number) => {
      sql.prepare(`INSERT INTO purchases (wish_id, user_id, quantity, created_at, updated_at) VALUES (?, ?, 1, ?, ?)`).run(wishId, userId, now, now)
    },
  }
}

describe('upgrading a database that has data in it', () => {
  it('keeps every account, list and purchase when the accounts table is rebuilt', () => {
    // Before Google login: the accounts table as it was.
    const before = oldDb(3)
    const art = before.user('art')
    const mom = before.user('mom')
    const wish = before.wish(art, before.list(art, 'A'.repeat(22)), 'Lamp')
    before.purchase(wish, mom)
    before.close()

    const after = openDb(before.file)
    expect(after.select({ n: count() }).from(users).get()!.n).toBe(2)
    expect(after.select({ n: count() }).from(listOwners).where(eq(listOwners.userId, art)).get()!.n).toBe(1)
    expect(after.select({ n: count() }).from(purchases).get()!.n).toBe(1)
    expect(after.select().from(users).where(eq(users.id, art)).get()).toMatchObject({ passwordHash: 'not-a-real-hash', googleSub: null })
    expect(after.$client.pragma('foreign_keys', { simple: true })).toBe(1)
  })

  it('gives an account that owns no list its first one, and leaves the others as they were', () => {
    const before = oldDb(5)
    const art = before.user('art')
    const mom = before.user('mom')
    before.list(art, 'A'.repeat(22))
    before.close()

    const after = openDb(before.file)
    const listsOf = (userId: number) => after.select({ token: lists.token, title: lists.title }).from(listOwners)
      .innerJoin(lists, eq(lists.id, listOwners.listId)).where(eq(listOwners.userId, userId)).all()
    expect(listsOf(art)).toEqual([{ token: 'A'.repeat(22), title: 'Lijst' }])
    const [first, ...more] = listsOf(mom)
    expect(more).toEqual([])
    expect(first!.title).toBe('Verlanglijst')
    expect(first!.token).toMatch(LIST_TOKEN)
    // The list works like any other: its owner can open it.
    expect(getListView(after, first!.token, mom)).toMatchObject({ viewerOwnsList: true, wishes: [] })
  })
})
