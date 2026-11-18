import { describe, expect, it } from 'vitest'
import { changePassword, linkGoogle, logIn, logInWithGoogle, register, signInMethods, unlinkGoogle } from '../server/domain/accounts'
import { createUser, findUserByEmail, findUserById } from '../server/domain/users'
import { fakeIdentity, googleCredential } from './fake-identity'
import { addUser, makeDb } from './helpers'

// A password from before Firebase, as the local table held it. Checked by a stand-in for scrypt.
const legacyCheck = async (hash: string, password: string) => hash === `hash:${password}`

async function rejection(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise
    return undefined
  }
  catch (error) {
    return (error as { code?: string }).code
  }
}

describe('making an account', () => {
  it('makes it at Firebase and here, tied by its Firebase id', async () => {
    const db = makeDb()
    const { identity, accounts } = fakeIdentity()
    const { user, login } = await register(db, identity, { email: 'art@example.test', displayName: 'Art', password: 'correct horse' })
    expect(accounts).toHaveLength(1)
    expect(user).toMatchObject({ email: 'art@example.test', displayName: 'Art', firebaseUid: login.uid, passwordHash: null })
  })

  it('refuses an address that has an account, here or at Firebase', async () => {
    const db = makeDb()
    const { identity } = fakeIdentity()
    addUser(db, 'art')
    expect(await rejection(register(db, identity, { email: 'art@example.test', displayName: 'A', password: 'correct horse' }))).toBe('email_taken')
    await identity.signUp('mom@example.test', 'x')
    expect(await rejection(register(db, identity, { email: 'mom@example.test', displayName: 'M', password: 'correct horse' }))).toBe('email_taken')
  })

  it('closes when the account limit is reached, before asking Firebase', async () => {
    const db = makeDb()
    const { identity, accounts } = fakeIdentity()
    addUser(db, 'art')
    expect(await rejection(register(db, identity, { email: 'b@example.test', displayName: 'B', password: 'correct horse' }, { maxUsers: 1 }))).toBe('registration_closed')
    expect(accounts).toHaveLength(0)
  })
})

describe('logging in with a password', () => {
  it('finds the account by its Firebase id', async () => {
    const db = makeDb()
    const { identity } = fakeIdentity()
    const { user } = await register(db, identity, { email: 'art@example.test', displayName: 'Art', password: 'correct horse' })
    expect((await logIn(db, identity, 'art@example.test', 'correct horse', legacyCheck))?.user.id).toBe(user.id)
    expect(await logIn(db, identity, 'art@example.test', 'wrong', legacyCheck)).toBeNull()
    expect(await logIn(db, identity, 'nobody@example.test', 'correct horse', legacyCheck)).toBeNull()
  })

  it('moves an account from before Firebase over on its first login, with the same password', async () => {
    const db = makeDb()
    const { identity, accounts } = fakeIdentity()
    const art = createUser(db, { email: 'art@example.test', displayName: 'Art', passwordHash: 'hash:correct horse' })
    const result = await logIn(db, identity, 'art@example.test', 'correct horse', legacyCheck)
    expect(result?.user.id).toBe(art.id)
    expect(accounts).toMatchObject([{ email: 'art@example.test', password: 'correct horse' }])
    expect(findUserById(db, art.id)).toMatchObject({ firebaseUid: result!.login.uid, passwordHash: null })
    // From now on Firebase answers.
    expect((await logIn(db, identity, 'art@example.test', 'correct horse', legacyCheck))?.user.id).toBe(art.id)
  })

  it("doesn't move an account over with a wrong password", async () => {
    const db = makeDb()
    const { identity, accounts } = fakeIdentity()
    createUser(db, { email: 'art@example.test', displayName: 'Art', passwordHash: 'hash:correct horse' })
    expect(await logIn(db, identity, 'art@example.test', 'wrong', legacyCheck)).toBeNull()
    expect(accounts).toHaveLength(0)
  })
})

describe('logging in with Google', () => {
  it('makes an account the first time, named as at Google, and finds it after', async () => {
    const db = makeDb()
    const { identity } = fakeIdentity()
    const first = await logInWithGoogle(db, identity, googleCredential('g-1', 'lotte@gmail.test'))
    expect(first.user).toMatchObject({ email: 'lotte@gmail.test', displayName: 'Lotte Peeters', googleSub: 'g-1', passwordHash: null })
    const again = await logInWithGoogle(db, identity, googleCredential('g-1', 'lotte@gmail.test'))
    expect(again.user.id).toBe(first.user.id)
  })

  it('asks for the password of an account at Firebase with that address', async () => {
    const db = makeDb()
    const { identity, accounts } = fakeIdentity()
    await register(db, identity, { email: 'art@example.test', displayName: 'Art', password: 'correct horse' })
    accounts[0]!.emailVerified = true
    expect(await rejection(logInWithGoogle(db, identity, googleCredential('g-art', 'art@example.test')))).toBe('google_email_taken')
  })

  it("lands in the same account when Firebase lets Google take over an address that wasn't confirmed", async () => {
    const db = makeDb()
    const { identity } = fakeIdentity()
    const { user } = await register(db, identity, { email: 'art@example.test', displayName: 'Art', password: 'correct horse' })
    const result = await logInWithGoogle(db, identity, googleCredential('g-art', 'art@example.test'))
    expect(result.user).toMatchObject({ id: user.id, displayName: 'Art', googleSub: 'g-art' })
  })

  it("doesn't step into an account from before Firebase: its password moves it over first", async () => {
    const db = makeDb()
    const { identity, accounts } = fakeIdentity()
    const art = createUser(db, { email: 'art@example.test', displayName: 'Art', passwordHash: 'hash:correct horse' })
    expect(await rejection(logInWithGoogle(db, identity, googleCredential('g-art', 'Art@Example.test')))).toBe('google_email_taken')
    expect(findUserById(db, art.id)?.firebaseUid).toBeNull()
    // Firebase didn't get an account for the address either, so the password can still move there.
    expect(accounts).toHaveLength(0)
    expect((await logIn(db, identity, 'art@example.test', 'correct horse', legacyCheck))?.user.id).toBe(art.id)
  })

  it('counts toward the account limit', async () => {
    const db = makeDb()
    const { identity } = fakeIdentity()
    addUser(db, 'art')
    expect(await rejection(logInWithGoogle(db, identity, googleCredential('g-1', 'lotte@gmail.test'), { maxUsers: 1 }))).toBe('registration_closed')
  })
})

describe('Google in Settings', () => {
  async function artWithPassword() {
    const db = makeDb()
    const fake = fakeIdentity()
    const { user, login } = await register(db, fake.identity, { email: 'art@example.test', displayName: 'Art', password: 'correct horse' })
    return { db, ...fake, user, login }
  }

  it('links Google, after which Google logs into this account', async () => {
    const { db, identity, user, login } = await artWithPassword()
    await linkGoogle(db, identity, user.id, login.refreshToken, googleCredential('g-art', 'art.private@gmail.test'))
    expect(findUserById(db, user.id)?.googleSub).toBe('g-art')
    expect((await logInWithGoogle(db, identity, googleCredential('g-art', 'art.private@gmail.test'))).user.id).toBe(user.id)
    expect(await signInMethods(db, identity, findUserById(db, user.id)!, login.refreshToken)).toEqual({ hasPassword: true, google: true })
  })

  it('refuses a Google account that belongs to another account', async () => {
    const { db, identity, user, login } = await artWithPassword()
    await logInWithGoogle(db, identity, googleCredential('g-1', 'lotte@gmail.test'))
    expect(await rejection(linkGoogle(db, identity, user.id, login.refreshToken, googleCredential('g-1', 'lotte@gmail.test')))).toBe('google_taken')
  })

  it('asks to log in again when the login cookie is from before Firebase', async () => {
    const { db, identity, user } = await artWithPassword()
    expect(await rejection(linkGoogle(db, identity, user.id, undefined, googleCredential('g-art', 'a@gmail.test')))).toBe('reauth_needed')
  })

  it('unlinks only when there is a password to log in with instead', async () => {
    const { db, identity, user, login } = await artWithPassword()
    await linkGoogle(db, identity, user.id, login.refreshToken, googleCredential('g-art', 'a@gmail.test'))
    await unlinkGoogle(db, identity, user.id, login.refreshToken)
    expect(findUserById(db, user.id)?.googleSub).toBeNull()

    const lotte = await logInWithGoogle(db, identity, googleCredential('g-1', 'lotte@gmail.test'))
    expect(await rejection(unlinkGoogle(db, identity, lotte.user.id, lotte.login.refreshToken))).toBe('password_needed')
    expect(await signInMethods(db, identity, lotte.user, lotte.login.refreshToken)).toEqual({ hasPassword: false, google: true })
  })
})

describe('changing the password', () => {
  it('checks the current one at Firebase and sets the new one there', async () => {
    const db = makeDb()
    const { identity } = fakeIdentity()
    const { user } = await register(db, identity, { email: 'art@example.test', displayName: 'Art', password: 'correct horse' })
    expect(await rejection(changePassword(db, identity, user, 'wrong', 'battery staple', legacyCheck))).toBe('wrong_password')
    await changePassword(db, identity, user, 'correct horse', 'battery staple', legacyCheck)
    expect(await logIn(db, identity, 'art@example.test', 'battery staple', legacyCheck)).not.toBeNull()
  })

  it('moves an account from before Firebase over on the way', async () => {
    const db = makeDb()
    const { identity } = fakeIdentity()
    const art = createUser(db, { email: 'art@example.test', displayName: 'Art', passwordHash: 'hash:correct horse' })
    await changePassword(db, identity, art, 'correct horse', 'battery staple', legacyCheck)
    expect(findUserByEmail(db, 'art@example.test')?.passwordHash).toBeNull()
    expect(await logIn(db, identity, 'art@example.test', 'battery staple', legacyCheck)).not.toBeNull()
  })
})
