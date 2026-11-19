import { describe, expect, it } from 'vitest'
import { changePassword, followMailLink, linkGoogle, logIn, logInWithGoogle, register, renameAtFirebase, requestEmailChange, signInMethods, unlinkGoogle } from '../server/domain/accounts'
import { listMyLists } from '../server/domain/lists'
import { createUser, findUserByEmail, findUserById, updateDisplayName } from '../server/domain/users'
import { fakeIdentity, googleCredential } from './fake-identity'
import { addUser, makeDb } from './helpers'

// A password from before Firebase, as the local table held it. Checked by a stand-in for scrypt.
const legacyCheck = async (hash: string, password: string) => hash === `hash:${password}`

const listTitles = (db: ReturnType<typeof makeDb>, userId: number) => listMyLists(db, userId).lists.map(list => list.title)

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

  it('gives the new account one list, named in the language of the page', async () => {
    const db = makeDb()
    const { identity } = fakeIdentity()
    const art = await register(db, identity, { email: 'art@example.test', displayName: 'Art', password: 'correct horse' })
    expect(listTitles(db, art.user.id)).toEqual(['Verlanglijst'])
    const sis = await register(db, identity, { email: 'sis@example.test', displayName: 'Sis', password: 'correct horse', locale: 'en' })
    expect(listTitles(db, sis.user.id)).toEqual(['Wishlist'])
    // Logging in afterwards finds the account and makes nothing more.
    await logIn(db, identity, 'art@example.test', 'correct horse', legacyCheck)
    expect(listTitles(db, art.user.id)).toEqual(['Verlanglijst'])
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

  it('makes the account here, with its list, when only the half at Firebase exists', async () => {
    const db = makeDb()
    const { identity } = fakeIdentity()
    await identity.signUp('art@example.test', 'correct horse')
    const result = await logIn(db, identity, 'art@example.test', 'correct horse', legacyCheck)
    expect(result?.user).toMatchObject({ email: 'art@example.test', displayName: 'art' })
    expect(listTitles(db, result!.user.id)).toEqual(['Verlanglijst'])
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

  it('gives a new account one list, in the language of the page it came from', async () => {
    const db = makeDb()
    const { identity } = fakeIdentity()
    const lotte = await logInWithGoogle(db, identity, googleCredential('g-1', 'lotte@gmail.test'))
    await logInWithGoogle(db, identity, googleCredential('g-1', 'lotte@gmail.test'))
    expect(listTitles(db, lotte.user.id)).toEqual(['Verlanglijst'])
    const tom = await logInWithGoogle(db, identity, googleCredential('g-2', 'tom@gmail.test'), { locale: 'en' })
    expect(listTitles(db, tom.user.id)).toEqual(['Wishlist'])
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
    expect(await signInMethods(db, identity, findUserById(db, user.id)!, login.refreshToken)).toEqual({ email: 'art@example.test', hasPassword: true, google: true })
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
    expect(await signInMethods(db, identity, lotte.user, lotte.login.refreshToken)).toEqual({ email: 'lotte@gmail.test', hasPassword: false, google: true })
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

describe('changing the address', () => {
  async function art() {
    const db = makeDb()
    const fake = fakeIdentity()
    const { user, login } = await register(db, fake.identity, { email: 'art@example.test', displayName: 'Art', password: 'correct horse' })
    const change = (email: string, currentPassword?: string, refreshToken: string | undefined = login.refreshToken) =>
      requestEmailChange(db, fake.identity, findUserById(db, user.id)!, refreshToken, { email, currentPassword, locale: 'nl', continueUrl: 'http://localhost/login' }, legacyCheck)
    return { db, ...fake, user, login, change }
  }

  it('has Firebase mail the new address, and changes nothing until the link in it is clicked', async () => {
    const { db, changes, user, change } = await art()
    await change('art@new.test', 'correct horse')
    expect(changes).toEqual([{ uid: user.firebaseUid, email: 'art@new.test', locale: 'nl', continueUrl: 'http://localhost/login' }])
    expect(findUserById(db, user.id)?.email).toBe('art@example.test')
  })

  it('takes the new address over at the first login with it', async () => {
    const { db, identity, confirm, user, change } = await art()
    await change('art@new.test', 'correct horse')
    confirm('art@new.test')
    expect(await logIn(db, identity, 'art@example.test', 'correct horse', legacyCheck)).toBeNull()
    const result = await logIn(db, identity, 'art@new.test', 'correct horse', legacyCheck)
    expect(result?.user).toMatchObject({ id: user.id, email: 'art@new.test' })
    expect(findUserById(db, user.id)?.email).toBe('art@new.test')
    expect(findUserByEmail(db, 'art@example.test')).toBeUndefined()
  })

  it('refuses the address of another account here, before Firebase hears of it', async () => {
    const { db, changes, change } = await art()
    addUser(db, 'mom')
    expect(await rejection(change('mom@example.test', 'correct horse'))).toBe('email_taken')
    // Only to someone who knows the password: an open browser must not learn which addresses have an account.
    expect(await rejection(change('mom@example.test', 'wrong'))).toBe('wrong_password')
    expect(changes).toEqual([])
  })

  it('refuses an address that has an account at Firebase only', async () => {
    const { identity, change } = await art()
    await identity.signUp('half@example.test', 'x')
    expect(await rejection(change('half@example.test', 'correct horse'))).toBe('email_taken')
  })

  it('refuses the address the account already has', async () => {
    const { changes, change } = await art()
    expect(await rejection(change('art@example.test', 'correct horse'))).toBe('email_same')
    expect(changes).toEqual([])
  })

  it('needs the current password of an account that has one', async () => {
    const { changes, change } = await art()
    expect(await rejection(change('art@new.test', 'wrong'))).toBe('wrong_password')
    expect(await rejection(change('art@new.test'))).toBe('wrong_password')
    expect(changes).toEqual([])
  })

  it('goes by the login itself for an account that only logs in with Google', async () => {
    const db = makeDb()
    const { identity, changes, tooOld, refusing } = fakeIdentity()
    const lotte = await logInWithGoogle(db, identity, googleCredential('g-1', 'lotte@gmail.test'))
    const change = (refreshToken?: string) =>
      requestEmailChange(db, identity, lotte.user, refreshToken, { email: 'lotte@new.test' }, legacyCheck)
    // A login cookie from before Firebase, a login from long ago (whether Firebase would mind
    // or not), or a fresh one that Firebase still refuses.
    expect(await rejection(change(undefined))).toBe('reauth_needed')
    tooOld.add(lotte.login.uid)
    expect(await rejection(change(lotte.login.refreshToken))).toBe('reauth_needed')
    tooOld.clear()
    refusing.add(lotte.login.uid)
    expect(await rejection(change(lotte.login.refreshToken))).toBe('reauth_needed')
    refusing.clear()
    expect(changes).toEqual([])
    await change(lotte.login.refreshToken)
    expect(changes).toMatchObject([{ uid: lotte.login.uid, email: 'lotte@new.test' }])
  })

  it('takes the new address over when the person logs in with Google again', async () => {
    const db = makeDb()
    const { identity, confirm } = fakeIdentity()
    const lotte = await logInWithGoogle(db, identity, googleCredential('g-1', 'lotte@gmail.test'))
    await requestEmailChange(db, identity, lotte.user, lotte.login.refreshToken, { email: 'lotte@new.test' }, legacyCheck)
    confirm('lotte@new.test')
    const again = await logInWithGoogle(db, identity, googleCredential('g-1', 'lotte@gmail.test'))
    expect(again.user).toMatchObject({ id: lotte.user.id, email: 'lotte@new.test', googleSub: 'g-1' })
    expect(findUserById(db, lotte.user.id)?.email).toBe('lotte@new.test')
  })

  it('takes the new address over when Settings asks Firebase and the login still stands', async () => {
    const { db, identity, accounts, user, login } = await art()
    accounts[0]!.email = 'art@new.test'
    expect(await signInMethods(db, identity, user, login.refreshToken)).toMatchObject({ email: 'art@new.test' })
    expect(findUserById(db, user.id)?.email).toBe('art@new.test')
  })

  it('keeps its address when another account here has the new one by then', async () => {
    const { db, identity, confirm, user, change } = await art()
    await change('art@new.test', 'correct horse')
    confirm('art@new.test')
    createUser(db, { email: 'art@new.test', displayName: 'Other', passwordHash: 'hash:x' })
    const result = await logIn(db, identity, 'art@new.test', 'correct horse', legacyCheck)
    expect(result?.user).toMatchObject({ id: user.id, email: 'art@example.test' })
    expect(findUserById(db, user.id)?.email).toBe('art@example.test')
  })

  it('moves an account from before Firebase over on the way', async () => {
    const db = makeDb()
    const { identity, changes } = fakeIdentity()
    const old = createUser(db, { email: 'art@example.test', displayName: 'Art', passwordHash: 'hash:correct horse' })
    await requestEmailChange(db, identity, old, undefined, { email: 'art@new.test', currentPassword: 'correct horse' }, legacyCheck)
    expect(findUserById(db, old.id)).toMatchObject({ passwordHash: null, email: 'art@example.test' })
    expect(changes).toMatchObject([{ email: 'art@new.test' }])
  })

  it('asks to log in again, not for another password, once Firebase ended the login', async () => {
    const { db, identity, confirm, user, login, change } = await art()
    await change('art@new.test', 'correct horse')
    confirm('art@new.test')
    // The address here is still the old one, so the right password no longer checks out.
    expect(await rejection(change('art@other.test', 'correct horse'))).toBe('reauth_needed')
    expect(await rejection(changePassword(db, identity, findUserById(db, user.id)!, 'correct horse', 'battery staple', legacyCheck, login.refreshToken))).toBe('reauth_needed')
    // Logged in again, a wrong password is a wrong password.
    const again = await logIn(db, identity, 'art@new.test', 'correct horse', legacyCheck)
    expect(await rejection(changePassword(db, identity, again!.user, 'wrong', 'battery staple', legacyCheck, again!.login.refreshToken))).toBe('wrong_password')
  })
})

// The page the links in Firebase's mails open reads a link first and uses it on a button.
describe("a link from one of Firebase's mails", () => {
  async function art() {
    const db = makeDb()
    const fake = fakeIdentity()
    const { user, login } = await register(db, fake.identity, { email: 'art@example.test', displayName: 'Art', password: 'correct horse' })
    const follow = (code: string, password?: string) => followMailLink(db, fake.identity, code, password)
    return { db, ...fake, user, login, follow }
  }

  it('sets the new password, once', async () => {
    const { db, identity, mailLink, follow } = await art()
    const code = mailLink('reset_password', 'art@example.test')
    expect(await identity.checkMailLink(code)).toEqual({ kind: 'reset_password', email: 'art@example.test' })
    expect(await follow(code, 'battery staple')).toEqual({ kind: 'reset_password', email: 'art@example.test' })
    expect(await logIn(db, identity, 'art@example.test', 'correct horse', legacyCheck)).toBeNull()
    expect(await logIn(db, identity, 'art@example.test', 'battery staple', legacyCheck)).not.toBeNull()
    // The link is used up: a second password does nothing.
    expect(await follow(code, 'third password')).toBeNull()
    expect(await logIn(db, identity, 'art@example.test', 'battery staple', legacyCheck)).not.toBeNull()
  })

  it('changes no password without one, and leaves the link for a second try', async () => {
    const { db, identity, mailLink, follow } = await art()
    const code = mailLink('reset_password', 'art@example.test')
    expect(await rejection(follow(code))).toBe('validation')
    expect(await logIn(db, identity, 'art@example.test', 'correct horse', legacyCheck)).not.toBeNull()
    expect(await follow(code, 'battery staple')).not.toBeNull()
  })

  it('confirms an address and changes nothing else', async () => {
    const { db, accounts, mailLink, user, follow } = await art()
    expect(accounts[0]!.emailVerified).toBe(false)
    expect(await follow(mailLink('verify_email', 'art@example.test'))).toEqual({ kind: 'verify_email', email: 'art@example.test' })
    expect(accounts[0]!.emailVerified).toBe(true)
    expect(findUserById(db, user.id)?.email).toBe('art@example.test')
  })

  it('gives the account its new address here at once, not at the next login', async () => {
    const { db, identity, mailLink, user, follow } = await art()
    const code = mailLink('change_email', 'art@example.test', 'art@new.test')
    expect(await identity.checkMailLink(code)).toEqual({ kind: 'change_email', email: 'art@new.test', previous: 'art@example.test' })
    // Reading the link changes nothing.
    expect(findUserById(db, user.id)?.email).toBe('art@example.test')
    expect(await follow(code)).toMatchObject({ kind: 'change_email', email: 'art@new.test' })
    expect(findUserById(db, user.id)?.email).toBe('art@new.test')
    expect(await logIn(db, identity, 'art@example.test', 'correct horse', legacyCheck)).toBeNull()
    expect((await logIn(db, identity, 'art@new.test', 'correct horse', legacyCheck))?.user.id).toBe(user.id)
  })

  it('puts the old address back, here too', async () => {
    const { db, identity, mailLink, user, follow } = await art()
    await follow(mailLink('change_email', 'art@example.test', 'art@new.test'))
    const back = mailLink('recover_email', 'art@new.test', 'art@example.test')
    expect(await follow(back)).toEqual({ kind: 'recover_email', email: 'art@example.test', previous: 'art@new.test' })
    expect(findUserById(db, user.id)?.email).toBe('art@example.test')
    expect((await logIn(db, identity, 'art@example.test', 'correct horse', legacyCheck))?.user.id).toBe(user.id)
  })

  it('keeps the address here when another account here has the new one by then', async () => {
    const { db, mailLink, user, follow } = await art()
    const code = mailLink('change_email', 'art@example.test', 'art@new.test')
    createUser(db, { email: 'art@new.test', displayName: 'Other', passwordHash: 'hash:x' })
    expect(await follow(code)).not.toBeNull()
    expect(findUserById(db, user.id)?.email).toBe('art@example.test')
  })

  it('does nothing for a link that is made up, used, or for an account that is gone', async () => {
    const { identity, accounts, mailLink, follow } = await art()
    expect(await follow('made-up')).toBeNull()
    expect(await follow('made-up', 'battery staple')).toBeNull()
    const used = mailLink('verify_email', 'art@example.test')
    await follow(used)
    expect(await identity.checkMailLink(used)).toBeNull()
    expect(await follow(used)).toBeNull()
    const orphan = mailLink('reset_password', 'art@example.test')
    accounts.splice(0, 1)
    expect(await follow(orphan, 'battery staple')).toBeNull()
  })
})

// Firebase's mails greet the person by the name Firebase has, so that name follows the one here.
describe("the name in Firebase's mails", () => {
  it('goes to Firebase with a new account', async () => {
    const db = makeDb()
    const { identity, accounts } = fakeIdentity()
    await register(db, identity, { email: 'art@example.test', displayName: 'Art', password: 'correct horse' })
    expect(accounts[0]!.name).toBe('Art')
  })

  it('goes along when an account from before Firebase moves there', async () => {
    const db = makeDb()
    const { identity, accounts } = fakeIdentity()
    createUser(db, { email: 'art@example.test', displayName: 'Art', passwordHash: 'hash:correct horse' })
    await logIn(db, identity, 'art@example.test', 'correct horse', legacyCheck)
    expect(accounts[0]!.name).toBe('Art')
  })

  it('is filled in at the next login for an account Firebase has no name for', async () => {
    const db = makeDb()
    const { identity, accounts } = fakeIdentity()
    await register(db, identity, { email: 'art@example.test', displayName: 'Art', password: 'correct horse' })
    accounts[0]!.name = null
    await logIn(db, identity, 'art@example.test', 'correct horse', legacyCheck)
    expect(accounts[0]!.name).toBe('Art')
  })

  it("is the name here, not Google's, after a login with Google", async () => {
    const db = makeDb()
    const { identity, accounts } = fakeIdentity()
    const { user } = await logInWithGoogle(db, identity, googleCredential('g-1', 'lotte@gmail.test'))
    updateDisplayName(db, user.id, 'Lotte')
    await logInWithGoogle(db, identity, googleCredential('g-1', 'lotte@gmail.test'))
    expect(accounts[0]!.name).toBe('Lotte')
  })

  it('follows a new name from Settings, when the login can ask Firebase', async () => {
    const { identity, accounts } = fakeIdentity()
    const login = await identity.signUp('art@example.test', 'correct horse', 'Art')
    if (login === 'email_exists') throw new Error('unexpected')
    await renameAtFirebase(identity, login.refreshToken, 'Art VdV')
    expect(accounts[0]!.name).toBe('Art VdV')
    // A login cookie from before Firebase has no token: the next login fills the name in.
    await renameAtFirebase(identity, undefined, 'Someone else')
    expect(accounts[0]!.name).toBe('Art VdV')
  })

  it("doesn't stop a login or a new name when Firebase refuses it", async () => {
    const db = makeDb()
    const { identity, accounts } = fakeIdentity()
    const { user, login } = await register(db, identity, { email: 'art@example.test', displayName: 'Art', password: 'correct horse' })
    accounts[0]!.name = null
    identity.setName = async () => {
      throw new Error('Firebase is away')
    }
    expect((await logIn(db, identity, 'art@example.test', 'correct horse', legacyCheck))?.user.id).toBe(user.id)
    await renameAtFirebase(identity, login.refreshToken, 'Art VdV')
    expect(accounts[0]!.name).toBeNull()
  })
})
