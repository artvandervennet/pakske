import { describe, expect, it } from 'vitest'
import { createUser, findUserByEmail, sessionBelongsTo, updateDisplayName } from '../server/domain/users'
import { addUser, codeOf, makeDb } from './helpers'

describe('accounts', () => {
  it('stores a new account and finds it by email', () => {
    const db = makeDb()
    const user = addUser(db, 'art')
    expect(findUserByEmail(db, 'art@example.test')?.id).toBe(user.id)
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
