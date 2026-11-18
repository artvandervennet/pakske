import { afterEach, describe, expect, it, vi } from 'vitest'
import { firebaseIdentity } from '../server/utils/firebase'

// What this site sends Firebase and how it reads the answers, against canned answers instead of
// the network. `fail` is the server's own helper (server/utils/http.ts), which Nitro hands every
// server file; here it throws what the API would answer.

interface Call { url: string, body: Record<string, unknown>, headers: Record<string, string> }
interface Refusal { statusCode: number, code: string, fields?: Record<string, string> }

function firebase(...answers: ({ error: string } | Record<string, unknown>)[]) {
  const calls: Call[] = []
  vi.stubGlobal('fetch', async (url: string, init: { body: string, headers: Record<string, string> }) => {
    calls.push({ url, body: JSON.parse(init.body), headers: init.headers })
    const answer = answers.shift() ?? {}
    return 'error' in answer
      ? new Response(JSON.stringify({ error: { message: answer.error } }), { status: 400 })
      : new Response(JSON.stringify(answer), { status: 200 })
  })
  vi.stubGlobal('fail', (statusCode: number, code: string, fields?: Record<string, string>) => {
    throw Object.assign(new Error(code), { statusCode, code, fields })
  })
  return { identity: firebaseIdentity('key'), calls }
}

async function refusal(promise: Promise<unknown>): Promise<Refusal | undefined> {
  try {
    await promise
    return undefined
  }
  catch (error) {
    return error as Refusal
  }
}

const session = { localId: 'uid-1', email: 'Art@Example.test', idToken: 'id', refreshToken: 'rt' }

afterEach(() => vi.unstubAllGlobals())

describe('a password Firebase finds too weak', () => {
  it.each(['WEAK_PASSWORD : Password should be at least 6 characters', 'PASSWORD_DOES_NOT_MEET_REQUIREMENTS : Missing password requirements: [Password must contain at least 8 characters]'])('is a too short password on the form, not a broken server: %s', async (error) => {
    const signUp = await refusal(firebase({ error }).identity.signUp('art@example.test', 'short'))
    expect(signUp).toMatchObject({ statusCode: 422, code: 'validation', fields: { password: 'password_short' } })
    const change = await refusal(firebase({ error }).identity.changePassword('id', 'short'))
    expect(change).toMatchObject({ statusCode: 422, code: 'validation', fields: { newPassword: 'password_short' } })
  })

  it('leaves a password Firebase takes alone', async () => {
    const { identity } = firebase(session, session)
    expect(await identity.signUp('art@example.test', 'long enough')).toMatchObject({ uid: 'uid-1', email: 'art@example.test' })
    expect(await identity.changePassword('id', 'long enough')).toMatchObject({ uid: 'uid-1' })
  })
})

describe('a new address', () => {
  const sent = (calls: Call[]) => calls.map(call => call.body)

  it('asks Firebase to mail the new address a link, in the page\'s language, back to the login page', async () => {
    const { identity, calls } = firebase({ email: 'art@example.test' })
    expect(await identity.requestEmailChange('id', 'art@new.test', { locale: 'en', continueUrl: 'https://pakske.example/en/login' })).toBe('sent')
    expect(calls[0]!.url).toContain('/v1/accounts:sendOobCode?key=key')
    expect(calls[0]!.headers).toMatchObject({ 'X-Firebase-Locale': 'en' })
    expect(sent(calls)).toEqual([{ requestType: 'VERIFY_AND_CHANGE_EMAIL', idToken: 'id', newEmail: 'art@new.test', continueUrl: 'https://pakske.example/en/login' }])
  })

  it('sends the mail without the way back when Firebase doesn\'t know the site\'s address', async () => {
    const { identity, calls } = firebase({ error: 'UNAUTHORIZED_DOMAIN : DOMAIN_NOT_ALLOWLISTED' }, {})
    expect(await identity.requestEmailChange('id', 'art@new.test', { continueUrl: 'https://pakske.example/login' })).toBe('sent')
    expect(sent(calls)[1]).toEqual({ requestType: 'VERIFY_AND_CHANGE_EMAIL', idToken: 'id', newEmail: 'art@new.test' })
  })

  it('says so when the address has an account', async () => {
    expect(await firebase({ error: 'EMAIL_EXISTS' }).identity.requestEmailChange('id', 'mom@example.test')).toBe('email_exists')
  })

  it.each(['CREDENTIAL_TOO_OLD_LOGIN_AGAIN', 'TOKEN_EXPIRED', 'INVALID_ID_TOKEN', 'USER_NOT_FOUND'])('asks to log in again on %s', async (error) => {
    expect(await firebase({ error }).identity.requestEmailChange('id', 'art@new.test')).toBe('reauth_needed')
  })

  it('names the field when Firebase finds the address no address', async () => {
    expect(await refusal(firebase({ error: 'INVALID_NEW_EMAIL' }).identity.requestEmailChange('id', 'art@new'))).toMatchObject({ statusCode: 422, fields: { email: 'invalid_email' } })
  })

  it('is too many tries when Firebase says so', async () => {
    expect(await refusal(firebase({ error: 'TOO_MANY_ATTEMPTS_TRY_LATER' }).identity.requestEmailChange('id', 'art@new.test'))).toMatchObject({ statusCode: 429, code: 'rate_limited' })
  })

  it('still breaks on an answer nobody expected', async () => {
    await expect(firebase({ error: 'OPERATION_NOT_ALLOWED' }).identity.requestEmailChange('id', 'art@new.test')).rejects.toThrow('OPERATION_NOT_ALLOWED')
  })
})

describe('what Firebase holds about an account', () => {
  it('is its address and the ways it logs in', async () => {
    const { identity, calls } = firebase({ users: [{ email: 'Art@New.test', passwordHash: 'x', providerUserInfo: [{ providerId: 'password' }, { providerId: 'google.com' }] }] })
    expect(await identity.account('id')).toEqual({ email: 'art@new.test', providers: ['password', 'google.com'] })
    expect(calls[0]!.url).toContain('/v1/accounts:lookup?key=key')
  })
})
