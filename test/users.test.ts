import { describe, expect, it } from 'vitest'
import { createUser, findUserByEmail, updateProfile } from '../server/domain/users'
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
    const again = () => createUser(db, { email: 'art@example.test', username: 'other', displayName: 'Other', passwordHash: 'x' })
    expect(codeOf(again)).toBe('email_taken')
  })

  it('refuses a second account with the same username', () => {
    const db = makeDb()
    addUser(db, 'art')
    const again = () => createUser(db, { email: 'new@example.test', username: 'art', displayName: 'Other', passwordHash: 'x' })
    expect(codeOf(again)).toBe('username_taken')
  })

  it('refuses a username that is also a route of the site', () => {
    const db = makeDb()
    const reserved = () => createUser(db, { email: 'a@example.test', username: 'settings', displayName: 'A', passwordHash: 'x' })
    expect(codeOf(reserved)).toBe('username_taken')
  })

  it('closes registration when the account limit is reached', () => {
    const db = makeDb()
    addUser(db, 'art')
    const overLimit = () => createUser(db, { email: 'b@example.test', username: 'bee', displayName: 'B', passwordHash: 'x' }, { maxUsers: 1 })
    expect(codeOf(overLimit)).toBe('registration_closed')
  })

  it('changes the name and the list intro', () => {
    const db = makeDb()
    const user = addUser(db, 'art')
    updateProfile(db, user.id, { displayName: 'Art V.', listIntro: 'Maat 43' })
    expect(findUserByEmail(db, 'art@example.test')).toMatchObject({ displayName: 'Art V.', listIntro: 'Maat 43' })
  })
})
