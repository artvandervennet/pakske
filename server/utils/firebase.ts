import type { FirebaseLogin, GoogleLogin, Identity } from '../domain/accounts'

// Firebase Authentication through its REST API, from the server only: the browser talks to this
// site and never to Firebase, so the login cookie stays this site's own and the API key stays
// here. NUXT_FIREBASE_API_KEY is the project's Web API key; NUXT_FIREBASE_AUTH_EMULATOR_HOST
// (host:port) points it at the Firebase emulator instead, for trying things out locally.

class FirebaseError extends Error {
  constructor(public readonly reason: string) {
    super(`Firebase: ${reason}`)
  }
}

interface Session {
  localId: string
  email?: string
  idToken: string
  refreshToken: string
}

/** Firebase's answers of a person's credentials: these mean "no", not "something broke". */
const WRONG = ['EMAIL_NOT_FOUND', 'INVALID_PASSWORD', 'INVALID_LOGIN_CREDENTIALS', 'USER_DISABLED', 'MISSING_PASSWORD']
// Firebase's own floor of six characters, or the project's password policy (see the README).
const WEAK = ['WEAK_PASSWORD', 'PASSWORD_DOES_NOT_MEET_REQUIREMENTS']
// Firebase wants a login from the last few minutes before it changes an address or deletes an
// account, and these are its ways of saying this one won't do.
const REAUTH = ['CREDENTIAL_TOO_OLD_LOGIN_AGAIN', 'TOKEN_EXPIRED', 'INVALID_ID_TOKEN', 'USER_NOT_FOUND', 'USER_DISABLED']
const ENDED = ['TOKEN_EXPIRED', 'USER_DISABLED', 'USER_NOT_FOUND', 'INVALID_REFRESH_TOKEN', 'INVALID_GRANT_TYPE', 'MISSING_REFRESH_TOKEN']

export function firebaseIdentity(apiKey: string, emulatorHost?: string): Identity {
  const root = emulatorHost ? `http://${emulatorHost}/` : 'https://'
  const accountsUrl = `${root}identitytoolkit.googleapis.com/v1`
  const tokenUrl = `${root}securetoken.googleapis.com/v1/token`

  async function call<T>(url: string, init: { body: string, type: string, headers?: Record<string, string> }): Promise<T> {
    const response = await fetch(`${url}?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'content-type': init.type, ...init.headers },
      body: init.body,
    })
    const data = await response.json().catch(() => ({})) as { error?: { message?: string } | string, error_description?: string }
    if (!response.ok) {
      const message = typeof data.error === 'string' ? data.error.toUpperCase() : data.error?.message ?? `HTTP ${response.status}`
      // "WEAK_PASSWORD : Password should be at least 6 characters": the code is the first word.
      throw new FirebaseError(message.split(/[\s:]/)[0]!)
    }
    return data as T
  }
  const accounts = <T>(method: string, body: object, headers?: Record<string, string>) =>
    call<T>(`${accountsUrl}/${method}`, { body: JSON.stringify(body), type: 'application/json', headers })

  const loginOf = (session: Session): FirebaseLogin =>
    ({ uid: session.localId, email: (session.email ?? '').toLowerCase(), idToken: session.idToken, refreshToken: session.refreshToken })

  async function tooMany<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work()
    }
    catch (error) {
      if (error instanceof FirebaseError && error.reason === 'TOO_MANY_ATTEMPTS_TRY_LATER') fail(429, 'rate_limited')
      throw error
    }
  }

  /**
   * A new password Firebase finds too weak is the person's to fix, so it is answered like the
   * form's own check on `field`. The forms ask for eight characters before Firebase is asked, so
   * this only happens when the project's policy asks for more than they do.
   */
  async function strongEnough<T>(field: string, work: () => Promise<T>): Promise<T> {
    try {
      return await work()
    }
    catch (error) {
      if (error instanceof FirebaseError && WEAK.includes(error.reason)) fail(422, 'validation', { [field]: 'password_short' })
      throw error
    }
  }

  return {
    async signIn(email, password) {
      try {
        return loginOf(await tooMany(() => accounts<Session>('accounts:signInWithPassword', { email, password, returnSecureToken: true })))
      }
      catch (error) {
        if (error instanceof FirebaseError && WRONG.includes(error.reason)) return null
        throw error
      }
    },

    async signUp(email, password) {
      try {
        return loginOf(await strongEnough('password', () => tooMany(() => accounts<Session>('accounts:signUp', { email, password, returnSecureToken: true }))))
      }
      catch (error) {
        if (error instanceof FirebaseError && error.reason === 'EMAIL_EXISTS') return 'email_exists'
        throw error
      }
    },

    async google(credential, linkTo): Promise<GoogleLogin> {
      const postBody = new URLSearchParams({ providerId: 'google.com' })
      if (credential.idToken) postBody.set('id_token', credential.idToken)
      else if (credential.accessToken) postBody.set('access_token', credential.accessToken)
      let answer: Session & { needConfirmation?: boolean, emailVerified?: boolean, federatedId?: string, fullName?: string, displayName?: string, rawUserInfo?: string }
      try {
        answer = await accounts('accounts:signInWithIdp', {
          postBody: postBody.toString(),
          requestUri: credential.requestUri,
          returnSecureToken: true,
          returnIdpCredential: true,
          ...(linkTo ? { idToken: linkTo } : {}),
        })
      }
      catch (error) {
        if (error instanceof FirebaseError && ['FEDERATED_USER_ID_ALREADY_LINKED', 'EMAIL_EXISTS', 'CREDENTIAL_ALREADY_IN_USE'].includes(error.reason)) return { kind: 'taken' }
        throw error
      }
      if (answer.needConfirmation || !answer.idToken) return linkTo ? { kind: 'taken' } : { kind: 'needs_password', email: answer.email ?? '' }
      let raw: { sub?: string, name?: string } = {}
      try {
        raw = JSON.parse(answer.rawUserInfo ?? '{}')
      }
      catch { /* not there: the federated id has it too */ }
      return {
        kind: 'ok',
        login: loginOf(answer),
        googleSub: raw.sub ?? answer.federatedId?.split('/').pop() ?? '',
        name: answer.fullName ?? answer.displayName ?? raw.name ?? null,
        emailVerified: answer.emailVerified === true,
      }
    },

    async sendPasswordReset(email, options = {}) {
      const headers = options.locale ? { 'X-Firebase-Locale': options.locale } : undefined
      const send = (continueUrl?: string) =>
        accounts('accounts:sendOobCode', { requestType: 'PASSWORD_RESET', email, ...(continueUrl ? { continueUrl } : {}) }, headers)
      try {
        await tooMany(() => send(options.continueUrl))
      }
      catch (error) {
        if (!(error instanceof FirebaseError)) throw error
        // Nobody with that address: the same answer as when there is, so nobody learns which.
        if (error.reason === 'EMAIL_NOT_FOUND') return
        // The site's address isn't among Firebase's authorised domains: the mail goes without
        // the button back to the site.
        if (['UNAUTHORIZED_DOMAIN', 'INVALID_CONTINUE_URI'].includes(error.reason)) return void (await send())
        throw error
      }
    },

    async refresh(refreshToken) {
      try {
        const answer = await call<{ id_token: string, refresh_token: string, user_id: string }>(tokenUrl, {
          body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }).toString(),
          type: 'application/x-www-form-urlencoded',
        })
        return { uid: answer.user_id, email: '', idToken: answer.id_token, refreshToken: answer.refresh_token }
      }
      catch (error) {
        if (error instanceof FirebaseError && ENDED.includes(error.reason)) return null
        throw error
      }
    },

    async changePassword(idToken, password) {
      return loginOf(await strongEnough('newPassword', () => accounts<Session>('accounts:update', { idToken, password, returnSecureToken: true })))
    },

    async account(idToken) {
      const answer = await accounts<{ users?: { email?: string, providerUserInfo?: { providerId: string }[], passwordHash?: string }[] }>('accounts:lookup', { idToken })
      const user = answer.users?.[0]
      return {
        email: (user?.email ?? '').toLowerCase(),
        providers: [...new Set([...(user?.providerUserInfo ?? []).map(info => info.providerId), ...(user?.passwordHash ? ['password'] : [])])],
      }
    },

    async unlinkGoogle(idToken) {
      await accounts('accounts:update', { idToken, deleteProvider: ['google.com'] })
    },

    async requestEmailChange(idToken, newEmail, options = {}) {
      const headers = options.locale ? { 'X-Firebase-Locale': options.locale } : undefined
      const send = async (continueUrl?: string): Promise<'sent' | 'email_exists' | 'reauth_needed'> => {
        try {
          await tooMany(() => accounts('accounts:sendOobCode', { requestType: 'VERIFY_AND_CHANGE_EMAIL', idToken, newEmail, ...(continueUrl ? { continueUrl } : {}) }, headers))
          return 'sent'
        }
        catch (error) {
          if (!(error instanceof FirebaseError)) throw error
          if (error.reason === 'EMAIL_EXISTS') return 'email_exists'
          if (REAUTH.includes(error.reason)) return 'reauth_needed'
          // An address the form let through and Firebase doesn't: the person's to fix.
          if (['INVALID_EMAIL', 'INVALID_NEW_EMAIL', 'MISSING_NEW_EMAIL'].includes(error.reason)) fail(422, 'validation', { email: 'invalid_email' })
          // The site's address isn't among Firebase's authorised domains: the mail goes without
          // the button back to the site.
          if (continueUrl && ['UNAUTHORIZED_DOMAIN', 'INVALID_CONTINUE_URI'].includes(error.reason)) return send()
          throw error
        }
      }
      return send(options.continueUrl)
    },

    async deleteAccount(idToken) {
      try {
        await accounts('accounts:delete', { idToken })
        return 'deleted'
      }
      catch (error) {
        if (!(error instanceof FirebaseError)) throw error
        // Already gone there: what is left is the account here.
        if (error.reason === 'USER_NOT_FOUND') return 'deleted'
        if (REAUTH.includes(error.reason)) return 'reauth_needed'
        throw error
      }
    },
  }
}

/** Firebase as this site is set up to reach it. Without an API key nobody can log in. */
export function useIdentity(): Identity {
  const { apiKey, authEmulatorHost } = useRuntimeConfig().firebase
  if (!apiKey) fail(503, 'firebase_missing')
  return firebaseIdentity(apiKey, authEmulatorHost || undefined)
}
