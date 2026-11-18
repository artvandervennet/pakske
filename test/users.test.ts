import { describe, expect, it } from 'vitest'
import { lists } from '../server/db/schema'
import { listMyLists } from '../server/domain/lists'
import { createUser, findUserByEmail, localeOfPath, sessionBelongsTo, updateDisplayName } from '../server/domain/users'
import { addUser, codeOf, makeDb } from './helpers'

const listTitles = (db: ReturnType<typeof makeDb>, userId: number) => listMyLists(db, userId).lists.map(list => list.title)

describe('accounts', () => {
  it('stores a new account and finds it by email', () => {
    const db = makeDb()
    const user = addUser(db, 'art')
    expect(findUserByEmail(db, 'art@example.test')?.id).toBe(user.id)
  })

  it('starts every account with one list, named in the language it was made in', () => {
    const db = makeDb()
    const art = createUser(db, { email: 'art@example.test', displayName: 'Art', passwordHash: null })
    expect(listTitles(db, art.id)).toEqual(['Verlanglijst'])
    const sis = createUser(db, { email: 'sis@example.test', displayName: 'Sis', passwordHash: null }, { locale: 'en' })
    expect(listTitles(db, sis.id)).toEqual(['Wishlist'])
  })

  it('makes no list when the account is refused', () => {
    const db = makeDb()
    createUser(db, { email: 'art@example.test', displayName: 'Art', passwordHash: null })
    expect(codeOf(() => createUser(db, { email: 'art@example.test', displayName: 'Other', passwordHash: 'x' }))).toBe('email_taken')
    expect(codeOf(() => createUser(db, { email: 'b@example.test', displayName: 'B', passwordHash: 'x' }, { maxUsers: 1 }))).toBe('registration_closed')
    expect(db.select().from(lists).all()).toHaveLength(1)
  })

  it('reads the language of a page from its path: English under /en, Dutch everywhere else', () => {
    for (const path of ['/en', '/en/', '/en/register', '/en?next=%2F', '/en/login?next=/l/abc#wish-3']) expect(localeOfPath(path), path).toBe('en')
    for (const path of ['/', '/login', '/register?next=/en', '/envelop', '/l/en']) expect(localeOfPath(path), path).toBe('nl')
  })

  it('refuses a second account with the same email', () => {
    const db = makeDb()
    addUser(db, 'art')
    const again = () => createUser(db, { email: 'art@example.test', displayName: 'Other', passwordHash: 'x' })
    expect(codeOf(again)).toBe('email_taken')
  })

  it('closes registration when the account limit is reached', () => {
    const db = makeDb()
    addUser(db, 'art')
    const overLimit = () => createUser(db, { email: 'b@example.test', displayName: 'B', passwordHash: 'x' }, { maxUsers: 1 })
    expect(codeOf(overLimit)).toBe('registration_closed')
  })

  describe('whether a login cookie still belongs to an account', () => {
    const account = { id: 7, createdAt: new Date(1_700_000_000_000) }

    it('does when the id and the moment the account was made both match', () => {
      expect(sessionBelongsTo({ id: 7, createdAt: 1_700_000_000_000 }, account)).toBe(true)
    })

    it('does not when the id was given to a newer account, say after a restore', () => {
      expect(sessionBelongsTo({ id: 7, createdAt: 1_600_000_000_000 }, account)).toBe(false)
    })

    it('does not when the account is gone', () => {
      expect(sessionBelongsTo({ id: 7, createdAt: 1_700_000_000_000 }, undefined)).toBe(false)
    })

    it('does not for a cookie made before the moment was stored in it', () => {
      expect(sessionBelongsTo({ id: 7 }, account)).toBe(false)
    })
  })

  it('changes the display name', () => {
    const db = makeDb()
    const user = addUser(db, 'art')
    updateDisplayName(db, user.id, 'Art V.')
    expect(findUserByEmail(db, 'art@example.test')?.displayName).toBe('Art V.')
  })
})
