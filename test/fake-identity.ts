import type { FirebaseLogin, GoogleCredential, GoogleLogin, Identity } from '../server/domain/accounts'

interface Account {
  uid: string
  email: string
  password: string | null
  emailVerified: boolean
  googleSub: string | null
}

/**
 * Firebase Authentication as the accounts code meets it, in memory, with "one account per email
 * address" as Firebase does it: a Google login for the address of an account with a password
 * asks for that password first (needConfirmation), unless that address was never confirmed:
 * then Google takes the account over and the password is dropped.
 * A Google credential is written `google:<sub>:<email>`; `refreshToken` and `idToken` are `rt:<uid>`
 * and `id:<uid>`.
 */
export function fakeIdentity() {
  const accounts: Account[] = []
  const sent: string[] = []
  let next = 1

  const loginOf = (account: Account): FirebaseLogin =>
    ({ uid: account.uid, email: account.email, idToken: `id:${account.uid}`, refreshToken: `rt:${account.uid}` })
  const byToken = (token: string, prefix: string) => accounts.find(account => `${prefix}:${account.uid}` === token)

  const identity: Identity = {
    async signIn(email, password) {
      const account = accounts.find(a => a.email === email)
      return account && account.password !== null && account.password === password ? loginOf(account) : null
    },
    async signUp(email, password) {
      if (accounts.some(a => a.email === email)) return 'email_exists'
      const account = { uid: `uid-${next++}`, email, password, emailVerified: false, googleSub: null }
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
      if (linked) return { kind: 'ok', login: loginOf(linked), googleSub: sub, name: 'From Google', emailVerified: true }
      const same = accounts.find(a => a.email === email)
      if (same && same.emailVerified) return { kind: 'needs_password', email }
      if (same) {
        same.password = null
        same.googleSub = sub
        same.emailVerified = true
        return { kind: 'ok', login: loginOf(same), googleSub: sub, name: 'From Google', emailVerified: true }
      }
      const account = { uid: `uid-${next++}`, email, password: null, emailVerified: true, googleSub: sub }
      accounts.push(account)
      return { kind: 'ok', login: loginOf(account), googleSub: sub, name: 'Lotte Peeters', emailVerified: true }
    },
    async sendPasswordReset(email) {
      sent.push(email)
    },
    async refresh(refreshToken) {
      const account = byToken(refreshToken, 'rt')
      return account ? loginOf(account) : null
    },
    async changePassword(idToken, password) {
      const account = byToken(idToken, 'id')!
      account.password = password
      return loginOf(account)
    },
    async providers(idToken) {
      const account = byToken(idToken, 'id')!
      return [...(account.password !== null ? ['password'] : []), ...(account.googleSub ? ['google.com'] : [])]
    },
    async unlinkGoogle(idToken) {
      byToken(idToken, 'id')!.googleSub = null
    },
  }
  return { identity, accounts, sent }
}

export const googleCredential = (sub: string, email: string): GoogleCredential =>
  ({ idToken: `google:${sub}:${email.toLowerCase()}`, email, requestUri: 'http://localhost/auth/google' })
