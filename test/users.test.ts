import { describe, expect, it } from 'vitest'
import { createUser, findUserByEmail, findUserById, linkGoogle, logInWithGoogle, sessionBelongsTo, unlinkGoogle, updateDisplayName } from '../server/domain/users'
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

  describe('logging in with Google', () => {
    const google = (extra: Partial<Parameters<typeof logInWithGoogle>[1]> = {}) =>
      ({ sub: 'g-123', email: 'Lotte@Gmail.com', emailVerified: true, name: 'Lotte Peeters', ...extra })

    it('makes an account without a password the first time, named as at Google', () => {
      const db = makeDb()
      const user = logInWithGoogle(db, google())
      expect(user).toMatchObject({ email: 'lotte@gmail.com', displayName: 'Lotte Peeters', passwordHash: null, googleSub: 'g-123' })
    })

    it('finds the same account the next time, even after the address at Google changed', () => {
      const db = makeDb()
      const first = logInWithGoogle(db, google())
      expect(logInWithGoogle(db, google({ email: 'lotte@other.test', name: 'L' })).id).toBe(first.id)
      expect(findUserById(db, first.id)?.displayName).toBe('Lotte Peeters')
    })

    it('names the account after the address when Google gives no name', () => {
      const db = makeDb()
      expect(logInWithGoogle(db, google({ name: '  ' })).displayName).toBe('lotte')
      expect(logInWithGoogle(makeDb(), google({ name: 'x'.repeat(80) })).displayName).toHaveLength(60)
    })

    it('refuses an address Google has not checked', () => {
      expect(codeOf(() => logInWithGoogle(makeDb(), google({ emailVerified: false })))).toBe('google_unverified')
    })

    it("doesn't step into an existing account with the same address: that needs its password first", () => {
      const db = makeDb()
      const art = addUser(db, 'art')
      expect(codeOf(() => logInWithGoogle(db, google({ email: 'art@example.test' })))).toBe('google_email_taken')
      expect(findUserById(db, art.id)?.googleSub).toBeNull()
    })

    it('counts toward the account limit', () => {
      const db = makeDb()
      addUser(db, 'art')
      expect(codeOf(() => logInWithGoogle(db, google(), { maxUsers: 1 }))).toBe('registration_closed')
    })

    it('logs into an account that linked Google from its settings', () => {
      const db = makeDb()
      const art = addUser(db, 'art')
      linkGoogle(db, art.id, 'g-123')
      expect(logInWithGoogle(db, google({ email: 'art.private@gmail.com' })).id).toBe(art.id)
    })
  })

  describe('linking Google to an account', () => {
    it('refuses a Google account that already belongs to another account', () => {
      const db = makeDb()
      const art = addUser(db, 'art')
      const mom = addUser(db, 'mom')
      linkGoogle(db, art.id, 'g-1')
      expect(codeOf(() => linkGoogle(db, mom.id, 'g-1'))).toBe('google_taken')
      linkGoogle(db, art.id, 'g-1')
      expect(findUserById(db, art.id)?.googleSub).toBe('g-1')
    })

    it('unlinks only when there is a password to log in with instead', () => {
      const db = makeDb()
      const art = addUser(db, 'art')
      linkGoogle(db, art.id, 'g-1')
      unlinkGoogle(db, art.id)
      expect(findUserById(db, art.id)?.googleSub).toBeNull()
      const lotte = logInWithGoogle(db, { sub: 'g-2', email: 'lotte@example.test', emailVerified: true, name: 'Lotte' })
      expect(codeOf(() => unlinkGoogle(db, lotte.id))).toBe('password_needed')
    })
  })
})
