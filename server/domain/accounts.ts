import { count, eq } from 'drizzle-orm'
import type { Db } from '../db/client'
import { users } from '../db/schema'
import { DomainError } from './errors'
import { createUser, deleteUser, findUserByEmail, type AccountLocale } from './users'

// Logging in. Firebase Authentication holds the passwords and the Google logins and sends the
// emails (a forgotten password, a new address); this site keeps its own account for everything else, tied to
// Firebase's by `firebaseUid`. Firebase is reached through `Identity` (server/utils/firebase.ts),
// so these rules can be tested without it.

/** A login at Firebase. The tokens act for the person at Firebase; they never reach the browser. */
export interface FirebaseLogin {
  uid: string
  email: string
  idToken: string
  refreshToken: string
  /** The name Firebase has for the account, '' when it has none. Only a login just made knows it. */
  name?: string
}

/** What Google gave this site after the person said yes there. */
export interface GoogleCredential {
  idToken?: string
  accessToken?: string
  // The address Google sent the person back to.
  requestUri: string
  // The person's address at Google, as Google's own profile gave it.
  email?: string
}

export type GoogleLogin =
  | { kind: 'ok', login: FirebaseLogin, googleSub: string, name: string | null, emailVerified: boolean }
  // An account with this address logs in with its password; Google can be linked to it after.
  | { kind: 'needs_password', email: string }
  // Linking: this Google account already logs into another account.
  | { kind: 'taken' }

export interface Identity {
  /** null for a wrong password, an unknown address, or an account without a password. */
  signIn: (email: string, password: string) => Promise<FirebaseLogin | null>
  /** `name` is how Firebase's mails greet the person. */
  signUp: (email: string, password: string, name?: string) => Promise<FirebaseLogin | 'email_exists'>
  /** Logs in with Google, or links Google to the account of `linkTo` (an id token). */
  google: (credential: GoogleCredential, linkTo?: string) => Promise<GoogleLogin>
  /** Firebase mails a link to choose a new password; nothing tells whether the address has an account. */
  sendPasswordReset: (email: string, options?: { locale?: string, continueUrl?: string }) => Promise<void>
  /** null when the login was ended at Firebase (a new password, a disabled account). */
  refresh: (refreshToken: string) => Promise<FirebaseLogin | null>
  changePassword: (idToken: string, password: string) => Promise<FirebaseLogin>
  /** What Firebase holds about the account: its address, and the ways it logs in ('password', 'google.com'). */
  account: (idToken: string) => Promise<{ email: string, providers: string[] }>
  unlinkGoogle: (idToken: string) => Promise<void>
  /** The name Firebase's mails greet the person by. */
  setName: (idToken: string, name: string) => Promise<void>
  /**
   * Firebase mails the new address a link; the account's address changes there once the person
   * clicks it. 'reauth_needed' when Firebase wants a fresher login before it does that.
   */
  requestEmailChange: (idToken: string, newEmail: string, options?: { locale?: string, continueUrl?: string }) => Promise<'sent' | 'email_exists' | 'reauth_needed'>
  /** Deletes the account at Firebase; one that is already gone counts as deleted. */
  deleteAccount: (idToken: string) => Promise<'deleted' | 'reauth_needed'>
}

type User = typeof users.$inferSelect
type CheckLegacy = (hash: string, password: string) => Promise<boolean>

function findByUid(db: Db, uid: string) {
  return db.select().from(users).where(eq(users.firebaseUid, uid)).get()
}

/**
 * The account here for a Firebase login: by its id, or the one with its address that has none
 * yet. One made here starts like every account, with a first list.
 */
function accountOf(db: Db, login: FirebaseLogin): User {
  const known = findByUid(db, login.uid)
  if (known) return withAddress(db, known, login.email)
  const byEmail = findUserByEmail(db, login.email)
  if (byEmail && !byEmail.firebaseUid) {
    db.update(users).set({ firebaseUid: login.uid, passwordHash: null }).where(eq(users.id, byEmail.id)).run()
    return { ...byEmail, firebaseUid: login.uid, passwordHash: null }
  }
  // Only this site makes accounts at Firebase, and it makes ours in the same breath; a Firebase
  // account without one here is one whose second half failed. It gets one now.
  return createUser(db, { email: login.email, displayName: login.email.split('@')[0]!.slice(0, 60), passwordHash: null, firebaseUid: login.uid })
}

/**
 * The account with the address Firebase has for it. A new address only counts once the person
 * clicked the link Firebase mailed there, so Firebase has it first and it is taken over here the
 * next time Firebase is heard from. An address another account here has by then is not taken
 * over: the account keeps its own rather than breaking the login.
 */
function withAddress(db: Db, user: User, email: string): User {
  if (!email || email === user.email) return user
  return db.transaction((tx) => {
    if (findUserByEmail(tx, email)) return user
    tx.update(users).set({ email }).where(eq(users.id, user.id)).run()
    return { ...user, email }
  }, { behavior: 'immediate' })
}

/**
 * Firebase's mails greet the person by the name Firebase has ("Dag Art,"), so that name follows
 * the one here. It is only a greeting: when Firebase refuses, the login goes on and the next
 * one tries again.
 */
async function tellName(identity: Identity, login: FirebaseLogin, name: string) {
  if (login.name === name) return
  try {
    await identity.setName(login.idToken, name)
  }
  catch {
    // The next login tries again.
  }
}

/** A new name from Settings, for a login that can ask Firebase; another one is told at its next login. */
export async function renameAtFirebase(identity: Identity, refreshToken: string | undefined, name: string) {
  if (!refreshToken) return
  try {
    const login = await identity.refresh(refreshToken)
    if (login) await identity.setName(login.idToken, name)
  }
  catch {
    // The next login tries again.
  }
}

/**
 * Logs in with an address and password, or answers null. An account from before Firebase moves
 * there on its first login: its own password, checked here, becomes its password at Firebase.
 */
export async function logIn(db: Db, identity: Identity, email: string, password: string, checkLegacy: CheckLegacy) {
  const login = await identity.signIn(email, password)
  if (login) {
    const user = accountOf(db, login)
    await tellName(identity, login, user.displayName)
    return { user, login }
  }

  const legacy = findUserByEmail(db, email)
  if (!legacy?.passwordHash || legacy.firebaseUid || !(await checkLegacy(legacy.passwordHash, password))) return null
  const made = await identity.signUp(email, password, legacy.displayName)
  if (made === 'email_exists') return null
  return { user: accountOf(db, made), login: made }
}

export async function register(
  db: Db,
  identity: Identity,
  input: { email: string, displayName: string, password: string, locale?: AccountLocale },
  options: { maxUsers?: number } = {},
) {
  // What can be answered here is answered before Firebase gets an account it would keep.
  if (options.maxUsers !== undefined && db.select({ n: count() }).from(users).get()!.n >= options.maxUsers) throw new DomainError('registration_closed')
  if (findUserByEmail(db, input.email)) throw new DomainError('email_taken')
  const login = await identity.signUp(input.email, input.password, input.displayName)
  if (login === 'email_exists') throw new DomainError('email_taken')
  const user = createUser(db, { email: input.email, displayName: input.displayName, passwordHash: null, firebaseUid: login.uid }, { ...options, locale: input.locale })
  return { user, login }
}

/**
 * Logs in with Google: the account Firebase ties to it, or a new one named as at Google. An
 * address that already logs in with a password logs in with it first and links Google in
 * Settings. Firebase asks for that itself; an account from before Firebase is asked here, since
 * Firebase doesn't know it yet.
 */
export async function logInWithGoogle(db: Db, identity: Identity, credential: GoogleCredential, options: { maxUsers?: number, locale?: AccountLocale } = {}) {
  // Asked before Firebase hears of it: Firebase would make an account for the address, and that
  // account would then stand in the way of the old password moving there.
  const legacy = credential.email ? findUserByEmail(db, credential.email.trim().toLowerCase()) : undefined
  if (legacy && !legacy.firebaseUid) throw new DomainError('google_email_taken')
  const result = await identity.google(credential)
  if (result.kind !== 'ok') throw new DomainError('google_email_taken')
  const { login } = result
  const known = findByUid(db, login.uid)
  if (known) {
    db.update(users).set({ googleSub: result.googleSub }).where(eq(users.id, known.id)).run()
    // Google's answer names the address at Google; the account's own may have changed since.
    const { email } = await identity.account(login.idToken)
    await tellName(identity, login, known.displayName)
    return { user: withAddress(db, { ...known, googleSub: result.googleSub }, email), login }
  }
  if (findUserByEmail(db, login.email)) throw new DomainError('google_email_taken')
  if (!result.emailVerified) throw new DomainError('google_unverified')
  const displayName = (result.name?.trim() || login.email.split('@')[0]!).slice(0, 60)
  const user = createUser(db, { email: login.email, displayName, passwordHash: null, firebaseUid: login.uid, googleSub: result.googleSub }, options)
  await tellName(identity, login, displayName)
  return { user, login }
}

/** Firebase's id token for the person behind a login cookie, or `reauth_needed`. */
async function idTokenFor(identity: Identity, refreshToken: string | undefined): Promise<FirebaseLogin> {
  const login = refreshToken ? await identity.refresh(refreshToken) : null
  if (!login) throw new DomainError('reauth_needed')
  return login
}

/** Links Google to the logged-in account. Answers the login to keep, which Firebase may renew. */
export async function linkGoogle(db: Db, identity: Identity, userId: number, refreshToken: string | undefined, credential: GoogleCredential) {
  const current = await idTokenFor(identity, refreshToken)
  const result = await identity.google(credential, current.idToken)
  if (result.kind !== 'ok') throw new DomainError('google_taken')
  db.update(users).set({ googleSub: result.googleSub }).where(eq(users.id, userId)).run()
  return result.login
}

/** Stops logging in with Google; only for an account with a password to log in with instead. */
export async function unlinkGoogle(db: Db, identity: Identity, userId: number, refreshToken: string | undefined) {
  const current = await idTokenFor(identity, refreshToken)
  if (!(await identity.account(current.idToken)).providers.includes('password')) throw new DomainError('password_needed')
  await identity.unlinkGoogle(current.idToken)
  db.update(users).set({ googleSub: null }).where(eq(users.id, userId)).run()
}

/** How the account logs in, from what is known here: for a login without a Firebase token. */
export function knownSignInMethods(user: User) {
  return { hasPassword: user.googleSub === null || user.passwordHash !== null, google: user.googleSub !== null }
}

/**
 * The account's address and how it logs in, for Settings: Firebase's answer when this login can
 * ask it, and what is known here otherwise.
 */
export async function signInMethods(db: Db, identity: Identity, user: User, refreshToken: string | undefined) {
  const current = user.firebaseUid && refreshToken ? await identity.refresh(refreshToken) : null
  if (!current) return { email: user.email, ...knownSignInMethods(user) }
  const { email, providers } = await identity.account(current.idToken)
  return { email: withAddress(db, user, email).email, hasPassword: providers.includes('password'), google: providers.includes('google.com') }
}

/**
 * Checks the current password the way logging in does, and answers that login. A password that
 * doesn't check out is `wrong_password`, unless Firebase ended this login meanwhile: the address
 * or the password changed somewhere else, so the password may well be right and the address here
 * out of date. Logging in again brings both up to date.
 */
async function checkPassword(db: Db, identity: Identity, user: User, password: string, checkLegacy: CheckLegacy, refreshToken: string | undefined): Promise<FirebaseLogin> {
  const checked = await logIn(db, identity, user.email, password, checkLegacy)
  if (checked && checked.user.id === user.id) return checked.login
  if (user.firebaseUid && refreshToken && !(await identity.refresh(refreshToken))) throw new DomainError('reauth_needed')
  throw new DomainError('wrong_password')
}

/**
 * Makes sure the person themselves asks, before something a stranger at their open browser must
 * not do: the current password for an account that has one, and for an account that only logs in
 * with Google the login itself, which Firebase refuses when it is too long ago.
 */
async function reauthenticate(db: Db, identity: Identity, user: User, refreshToken: string | undefined, currentPassword: string | undefined, checkLegacy: CheckLegacy): Promise<FirebaseLogin> {
  if (currentPassword !== undefined) return checkPassword(db, identity, user, currentPassword, checkLegacy, refreshToken)
  // Leaving the password out is no way round it.
  if (user.passwordHash !== null) throw new DomainError('wrong_password')
  const current = await idTokenFor(identity, refreshToken)
  if (current.uid !== user.firebaseUid) throw new DomainError('reauth_needed')
  if ((await identity.account(current.idToken)).providers.includes('password')) throw new DomainError('wrong_password')
  return current
}

/** Sets a new password after checking the current one. Answers the login to keep. */
export async function changePassword(db: Db, identity: Identity, user: User, current: string, next: string, checkLegacy: CheckLegacy, refreshToken?: string) {
  const checked = await checkPassword(db, identity, user, current, checkLegacy, refreshToken)
  return identity.changePassword(checked.idToken, next)
}

/**
 * Asks for another address: Firebase mails it a link, and the address changes at Firebase once
 * the person clicks that. Here it changes the next time Firebase is heard from (`withAddress`).
 * An address another account here has is refused before anything is sent. Answers the login to keep.
 */
export async function requestEmailChange(
  db: Db,
  identity: Identity,
  user: User,
  refreshToken: string | undefined,
  input: { email: string, currentPassword?: string, locale?: string, continueUrl?: string },
  checkLegacy: CheckLegacy,
) {
  if (input.email === user.email) throw new DomainError('email_same')
  if (findUserByEmail(db, input.email)) throw new DomainError('email_taken')
  const login = await reauthenticate(db, identity, user, refreshToken, input.currentPassword, checkLegacy)
  const answer = await identity.requestEmailChange(login.idToken, input.email, { locale: input.locale, continueUrl: input.continueUrl })
  if (answer === 'email_exists') throw new DomainError('email_taken')
  if (answer === 'reauth_needed') throw new DomainError('reauth_needed')
  return login
}

/**
 * Deletes the account for good, after making sure the person themselves asks. Firebase goes
 * first: were it the other way round and Firebase failed, the next login would find a Firebase
 * account without one here and make an empty one. An account from before Firebase that never
 * moved there has its password checked here, and Firebase has nothing to delete. Returns the
 * pictures nothing points at any more.
 */
export async function deleteAccount(
  db: Db,
  identity: Identity,
  user: User,
  refreshToken: string | undefined,
  currentPassword: string | undefined,
  checkLegacy: CheckLegacy,
): Promise<{ unused: string[] }> {
  if (user.firebaseUid === null && user.passwordHash !== null) {
    if (currentPassword === undefined || !(await checkLegacy(user.passwordHash, currentPassword))) throw new DomainError('wrong_password')
  }
  else {
    const login = await reauthenticate(db, identity, user, refreshToken, currentPassword, checkLegacy)
    if ((await identity.deleteAccount(login.idToken)) === 'reauth_needed') throw new DomainError('reauth_needed')
  }
  return deleteUser(db, user.id)
}
