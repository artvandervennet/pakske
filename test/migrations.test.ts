import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { count, eq } from 'drizzle-orm'
import { openDb } from '../server/db/client'
import { linkChanges, listOwners, lists, notes, purchases, users, wishes } from '../server/db/schema'
import { getListView } from '../server/domain/list-view'
import { LIST_TOKEN } from '../server/domain/tokens'
import { deleteUser } from '../server/domain/users'

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
    note: (wishId: number, userId: number, body: string) => {
      sql.prepare(`INSERT INTO notes (id, wish_id, user_id, body, created_at) VALUES (?, ?, ?, ?, ?)`).run(`note-${wishId}-${userId}`, wishId, userId, body, now)
    },
    /** The wish's one link, in the column it had while a wish had one. */
    link: (wishId: number, url: string) => {
      sql.prepare(`UPDATE wishes SET url = ? WHERE id = ?`).run(url, wishId)
    },
    /** Someone linked the wish and changed a field: what their link remembers, as JSON. */
    remembered: (wishId: number, userId: number, field: string, before: string) => {
      const linkId = id(sql.prepare(`INSERT INTO wish_links (wish_id, user_id, created_at) VALUES (?, ?, ?)`).run(wishId, userId, now))
      sql.prepare(`INSERT INTO link_changes (link_id, field, before) VALUES (?, ?, ?)`).run(linkId, field, before)
      return linkId
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

  it('moves a wish\'s one link, and what an undo remembers of it, to the list of links', () => {
    const before = oldDb(6)
    const art = before.user('art')
    const lot = before.user('lot')
    const mom = before.user('mom')
    const list = before.list(art, 'A'.repeat(22))
    const lamp = before.wish(art, list, 'Lamp')
    before.link(lamp, 'https://example.test/lamp?kleur=rood&maat=3')
    const book = before.wish(art, list, 'Boek')
    const vase = before.wish(art, list, 'Vaas')
    before.link(vase, 'https://example.test/vaas')
    // Lotte replaced the lamp's link, mom gave the book its first one, and Lotte renamed the vase.
    const hadLink = before.remembered(lamp, lot, 'url', JSON.stringify('https://example.test/"oude" lamp'))
    const hadNone = before.remembered(book, mom, 'url', 'null')
    const renamed = before.remembered(vase, lot, 'title', JSON.stringify('Pot'))
    before.close()

    const after = openDb(before.file)
    const urlsOf = (wishId: number) => after.select({ urls: wishes.urls }).from(wishes).where(eq(wishes.id, wishId)).get()!.urls
    expect(urlsOf(lamp)).toEqual(['https://example.test/lamp?kleur=rood&maat=3'])
    expect(urlsOf(book)).toBeNull()
    expect(urlsOf(vase)).toEqual(['https://example.test/vaas'])
    expect(after.$client.prepare(`SELECT name FROM pragma_table_info('wishes')`).all().map(column => (column as { name: string }).name)).not.toContain('url')

    const rememberedBy = (linkId: number) => after.select({ field: linkChanges.field, before: linkChanges.before }).from(linkChanges)
      .where(eq(linkChanges.linkId, linkId)).all().map(row => ({ field: row.field, before: JSON.parse(row.before) }))
    expect(rememberedBy(hadLink)).toEqual([{ field: 'urls', before: ['https://example.test/"oude" lamp'] }])
    expect(rememberedBy(hadNone)).toEqual([{ field: 'urls', before: [] }])
    expect(rememberedBy(renamed)).toEqual([{ field: 'title', before: 'Pot' }])
    // The wishes show their links to whoever opens the list.
    expect(getListView(after, 'A'.repeat(22), null)!.wishes.map(wish => wish.urls)).toEqual([
      ['https://example.test/lamp?kleur=rood&maat=3'], [], ['https://example.test/vaas'],
    ])
  })

  it('keeps every note when the notes table is rebuilt, and from then on a note outlives its writer', () => {
    // Before a note could stay behind: deleting an account deleted its notes.
    const before = oldDb(7)
    const art = before.user('art')
    const mom = before.user('mom')
    const lot = before.user('lot')
    const lamp = before.wish(art, before.list(art, 'A'.repeat(22)), 'Lamp')
    before.note(lamp, mom, 'Ik haal hem zaterdag.')
    before.note(lamp, lot, 'Ik doe mee.')
    before.close()

    const after = openDb(before.file)
    const written = () => after.select({ userId: notes.userId, body: notes.body }).from(notes).orderBy(notes.userId).all()
    expect(written()).toEqual([{ userId: mom, body: 'Ik haal hem zaterdag.' }, { userId: lot, body: 'Ik doe mee.' }])
    deleteUser(after, mom)
    expect(written()).toEqual([{ userId: null, body: 'Ik haal hem zaterdag.' }, { userId: lot, body: 'Ik doe mee.' }])
    expect(after.$client.pragma('foreign_key_check')).toEqual([])
  })
})
