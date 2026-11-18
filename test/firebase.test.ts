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
