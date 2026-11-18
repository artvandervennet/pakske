import type { FirebaseLogin, GoogleCredential, GoogleLogin, Identity } from '../server/domain/accounts'

interface Account {
  uid: string
  email: string
  password: string | null
  // The name Firebase greets the person by in its mails.
  name: string | null
  emailVerified: boolean
  googleSub: string | null
  // Firebase ended the logins from before a change of address: their tokens no longer refresh.
  ended?: boolean
}

/**
 * Firebase Authentication as the accounts code meets it, in memory, with "one account per email
 * address" as Firebase does it: a Google login for the address of an account with a password
 * asks for that password first (needConfirmation), unless that address was never confirmed:
 * then Google takes the account over and the password is dropped.
 * A Google credential is written `google:<sub>:<email>`; `refreshToken` and `idToken` are `rt:<uid>`
 * and `id:<uid>`.
 * A new address waits in `changes` until `confirm` plays the person clicking the mailed link.
 * `tooOld` holds the ids of accounts whose login is too long ago for Firebase to change the
 * address or delete the account on its word.
 */
export function fakeIdentity() {
  const accounts: Account[] = []
  const sent: string[] = []
  const changes: { uid: string, email: string, locale?: string, continueUrl?: string }[] = []
  const tooOld = new Set<string>()
  let next = 1

  const loginOf = (account: Account): FirebaseLogin =>
    ({ uid: account.uid, email: account.email, idToken: `id:${account.uid}`, refreshToken: `rt:${account.uid}`, name: account.name ?? '' })
  const byToken = (token: string, prefix: string) => accounts.find(account => `${prefix}:${account.uid}` === token)

  const identity: Identity = {
    async signIn(email, password) {
      const account = accounts.find(a => a.email === email)
      if (!account || account.password === null || account.password !== password) return null
      account.ended = false
      return loginOf(account)
    },
    async signUp(email, password, name) {
      if (accounts.some(a => a.email === email)) return 'email_exists'
      const account = { uid: `uid-${next++}`, email, password, name: name ?? null, emailVerified: false, googleSub: null }
      accounts.push(account)
      return loginOf(account)
    },
    async google(credential: GoogleCredential, linkTo?: string): Promise<GoogleLogin> {
      const [, sub, email] = (credential.idToken ?? '').split(':') as [string, string, string]
      const linked = accounts.find(a => a.googleSub === sub)
      if (linkTo) {
        const me = byToken(linkTo, 'id')
        if (!me) throw new Error('bad id token')
        if (linked && linked !== me) return { kind: 'taken' }
        me.googleSub = sub
        return { kind: 'ok', login: loginOf(me), googleSub: sub, name: 'From Google', emailVerified: true }
      }
      if (linked) {
        linked.ended = false
        // Google's answer names the address at Google, whatever the account's own address is by now.
        return { kind: 'ok', login: { ...loginOf(linked), email }, googleSub: sub, name: 'From Google', emailVerified: true }
      }
      const same = accounts.find(a => a.email === email)
      if (same && same.emailVerified) return { kind: 'needs_password', email }
      if (same) {
        same.password = null
        same.googleSub = sub
        same.emailVerified = true
        return { kind: 'ok', login: loginOf(same), googleSub: sub, name: 'From Google', emailVerified: true }
      }
      const account = { uid: `uid-${next++}`, email, password: null, name: 'Lotte Peeters', emailVerified: true, googleSub: sub }
      accounts.push(account)
      return { kind: 'ok', login: loginOf(account), googleSub: sub, name: 'Lotte Peeters', emailVerified: true }
    },
    async sendPasswordReset(email) {
      sent.push(email)
    },
    async refresh(refreshToken) {
      const account = byToken(refreshToken, 'rt')
      return account && !account.ended ? loginOf(account) : null
    },
    async changePassword(idToken, password) {
      const account = byToken(idToken, 'id')!
      account.password = password
      return loginOf(account)
    },
    async account(idToken) {
      const account = byToken(idToken, 'id')!
      return { email: account.email, providers: [...(account.password !== null ? ['password'] : []), ...(account.googleSub ? ['google.com'] : [])] }
    },
    async requestEmailChange(idToken, newEmail, options = {}) {
      const account = byToken(idToken, 'id')
      if (!account || tooOld.has(account.uid)) return 'reauth_needed'
      if (accounts.some(a => a.email === newEmail)) return 'email_exists'
      changes.push({ uid: account.uid, email: newEmail, ...options })
      return 'sent'
    },
    async deleteAccount(idToken) {
      const account = byToken(idToken, 'id')
      if (!account) return 'deleted'
      if (tooOld.has(account.uid)) return 'reauth_needed'
      accounts.splice(accounts.indexOf(account), 1)
      return 'deleted'
    },
    async unlinkGoogle(idToken) {
      byToken(idToken, 'id')!.googleSub = null
    },
    async setName(idToken, name) {
      byToken(idToken, 'id')!.name = name
    },
  }

  /** The person clicks the link Firebase mailed to their new address. */
  function confirm(email: string): void {
    const change = changes.find(c => c.email === email)
    const account = accounts.find(a => a.uid === change?.uid)
    if (!change || !account) throw new Error(`no mail went to ${email}`)
    changes.splice(changes.indexOf(change), 1)
    account.email = email
    account.emailVerified = true
    account.ended = true
  }

  return { identity, accounts, sent, changes, tooOld, confirm }
}

export const googleCredential = (sub: string, email: string): GoogleCredential =>
  ({ idToken: `google:${sub}:${email.toLowerCase()}`, email, requestUri: 'http://localhost/auth/google' })
