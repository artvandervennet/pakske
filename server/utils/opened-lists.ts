import type { H3Event } from 'h3'
import { LIST_TOKEN } from '../domain/tokens'

const COOKIE = 'opened-lists'
const MAX = 50
const ONE_YEAR = 60 * 60 * 24 * 365

/** Tokens in the cookie, newest first. Anything that isn't a well-formed token is dropped: the cookie is client input. */
export function parseOpened(value: string | undefined): string[] {
  if (!value) return []
  const seen = new Set<string>()
  for (const part of value.split('.')) {
    if (LIST_TOKEN.test(part)) seen.add(part)
    if (seen.size === MAX) break
  }
  return [...seen]
}

/** The token in front, the rest after it, at most 50. */
export function withOpened(tokens: string[], token: string): string[] {
  return [token, ...tokens.filter(t => t !== token)].slice(0, MAX)
}

// The h3 helpers are Nitro auto-imports: they don't exist in unit tests, so they are used only inside these functions.

export function readOpened(event: H3Event): string[] {
  return parseOpened(getCookie(event, COOKIE))
}

export function writeOpened(event: H3Event, tokens: string[]): void {
  setCookie(event, COOKIE, tokens.join('.'), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: ONE_YEAR,
    secure: useRuntimeConfig(event).session.cookie.secure,
  })
}

export function clearOpened(event: H3Event): void {
  deleteCookie(event, COOKIE, { path: '/' })
}
