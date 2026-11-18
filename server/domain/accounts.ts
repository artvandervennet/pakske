import { count, eq } from 'drizzle-orm'
import type { Db } from '../db/client'
import { users } from '../db/schema'
import { DomainError } from './errors'
import { createUser, findUserByEmail } from './users'

// Logging in. Firebase Authentication holds the passwords and the Google logins and sends the
// emails (a forgotten password); this site keeps its own account for everything else, tied to
// Firebase's by `firebaseUid`. Firebase is reached through `Identity` (server/utils/firebase.ts),
// so these rules can be tested without it.

/** A login at Firebase. The tokens act for the person at Firebase; they never reach the browser. */
export interface FirebaseLogin {
  uid: string
  email: string
  idToken: string
  refreshToken: string
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
  signUp: (email: string, password: string) => Promise<FirebaseLogin | 'email_exists'>
  /** Logs in with Google, or links Google to the account of `linkTo` (an id token). */
  google: (credential: GoogleCredential, linkTo?: string) => Promise<GoogleLogin>
  /** Firebase mails a link to choose a new password; nothing tells whether the address has an account. */
  sendPasswordReset: (email: string, options?: { locale?: string, continueUrl?: string }) => Promise<void>
  /** null when the login was ended at Firebase (a new password, a disabled account). */
  refresh: (refreshToken: string) => Promise<FirebaseLogin | null>
  changePassword: (idToken: string, password: string) => Promise<FirebaseLogin>
  /** The ways the account logs in: 'password', 'google.com'. */
  providers: (idToken: string) => Promise<string[]>
  unlinkGoogle: (idToken: string) => Promise<void>
}

type User = typeof users.$inferSelect
type CheckLegacy = (hash: string, password: string) => Promise<boolean>

function findByUid(db: Db, uid: string) {
  return db.select().from(users).where(eq(users.firebaseUid, uid)).get()
}

/** The account here for a Firebase login: by its id, or the one with its address that has none yet. */
function accountOf(db: Db, login: FirebaseLogin): User {
  const known = findByUid(db, login.uid)
  if (known) return known
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
 * Logs in with an address and password, or answers null. An account from before Firebase moves
 * there on its first login: its own password, checked here, becomes its password at Firebase.
 */
export async function logIn(db: Db, identity: Identity, email: string, password: string, checkLegacy: CheckLegacy) {
  const login = await identity.signIn(email, password)
  if (login) return { user: accountOf(db, login), login }

  const legacy = findUserByEmail(db, email)
  if (!legacy?.passwordHash || legacy.firebaseUid || !(await checkLegacy(legacy.passwordHash, password))) return null
  const made = await identity.signUp(email, password)
  if (made === 'email_exists') return null
  return { user: accountOf(db, made), login: made }
}

export async function register(
  db: Db,
  identity: Identity,
  input: { email: string, displayName: string, password: string },
  options: { maxUsers?: number } = {},
) {
  // What can be answered here is answered before Firebase gets an account it would keep.
  if (options.maxUsers !== undefined && db.select({ n: count() }).from(users).get()!.n >= options.maxUsers) throw new DomainError('registration_closed')
  if (findUserByEmail(db, input.email)) throw new DomainError('email_taken')
  const login = await identity.signUp(input.email, input.password)
  if (login === 'email_exists') throw new DomainError('email_taken')
  const user = createUser(db, { email: input.email, displayName: input.displayName, passwordHash: null, firebaseUid: login.uid }, options)
  return { user, login }
}

/**
 * Logs in with Google: the account Firebase ties to it, or a new one named as at Google. An
 * address that already logs in with a password logs in with it first and links Google in
 * Settings. Firebase asks for that itself; an account from before Firebase is asked here, since
 * Firebase doesn't know it yet.
 */
export async function logInWithGoogle(db: Db, identity: Identity, credential: GoogleCredential, options: { maxUsers?: number } = {}) {
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
    return { user: { ...known, googleSub: result.googleSub }, login }
  }
  if (findUserByEmail(db, login.email)) throw new DomainError('google_email_taken')
  if (!result.emailVerified) throw new DomainError('google_unverified')
  const displayName = (result.name?.trim() || login.email.split('@')[0]!).slice(0, 60)
  const user = createUser(db, { email: login.email, displayName, passwordHash: null, firebaseUid: login.uid, googleSub: result.googleSub }, options)
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
  if (!(await identity.providers(current.idToken)).includes('password')) throw new DomainError('password_needed')
  await identity.unlinkGoogle(current.idToken)
  db.update(users).set({ googleSub: null }).where(eq(users.id, userId)).run()
}

/** How the account logs in, from what is known here: for a login without a Firebase token. */
export function knownSignInMethods(user: User) {
  return { hasPassword: user.googleSub === null || user.passwordHash !== null, google: user.googleSub !== null }
}

/** How the account logs in, for Settings: Firebase's answer when this login can ask it. */
export async function signInMethods(db: Db, identity: Identity, user: User, refreshToken: string | undefined) {
  const current = user.firebaseUid && refreshToken ? await identity.refresh(refreshToken) : null
  if (!current) return knownSignInMethods(user)
  const providers = await identity.providers(current.idToken)
  return { hasPassword: providers.includes('password'), google: providers.includes('google.com') }
}

/** Sets a new password after checking the current one. Answers the login to keep. */
export async function changePassword(db: Db, identity: Identity, user: User, current: string, next: string, checkLegacy: CheckLegacy) {
  const checked = await logIn(db, identity, user.email, current, checkLegacy)
  if (!checked || checked.user.id !== user.id) throw new DomainError('wrong_password')
  return identity.changePassword(checked.login.idToken, next)
}
