import type { H3Event } from 'h3'
import type { ZodType } from 'zod'
import { fieldErrors } from '../../shared/schemas/input'
import { DomainError, type DomainErrorCode } from '../domain/errors'
import { LIST_TOKEN } from '../domain/tokens'
import { findUserById, sessionBelongsTo } from '../domain/users'

const STATUS: Record<DomainErrorCode, number> = {
  not_found: 404,
  forbidden: 403,
  validation: 422,
  email_taken: 409,
  registration_closed: 403,
  list_limit: 409,
  wish_limit: 409,
  quantity_exceeded: 409,
  wish_removed: 409,
}

/** Ends the request with a status and an error code the client can translate. */
export function fail(statusCode: number, code: string, fields?: Record<string, string>): never {
  throw createError({ statusCode, statusMessage: code, data: { code, fields } })
}

/** Runs a domain function and turns a DomainError into the matching HTTP error. */
export function domain<T>(fn: () => T): T {
  try {
    return fn()
  }
  catch (error) {
    if (error instanceof DomainError) fail(STATUS[error.code], error.code)
    throw error
  }
}

/** The JSON body, validated. Answers 422 with a code per field when it doesn't fit. */
export async function readInput<T>(event: H3Event, schema: ZodType<T>): Promise<T> {
  const body = await readBody(event).catch(() => null)
  const result = schema.safeParse(body ?? {})
  if (!result.success) fail(422, 'validation', fieldErrors(result.error))
  return result.data
}

/** A positive whole number from the route, or 404. */
export function idParam(event: H3Event, name = 'id'): number {
  const id = Number(getRouterParam(event, name))
  if (!Number.isInteger(id) || id < 1) fail(404, 'not_found')
  return id
}

/** The list token from the route. A malformed one is "not found", the same as one that matches no list. */
export function tokenParam(event: H3Event): string {
  const token = String(getRouterParam(event, 'token'))
  if (!LIST_TOKEN.test(token)) fail(404, 'not_found')
  return token
}

/** What the login cookie holds about an account. */
export function sessionUserOf(user: { id: number, displayName: string, createdAt: Date }) {
  return { id: user.id, displayName: user.displayName, createdAt: user.createdAt.getTime() }
}

/**
 * The logged-in person's account, or undefined. A cookie for an account that is gone, or whose
 * id now belongs to another account (say, after a restore), is cleared, so whoever holds it is
 * simply logged out. The page's own idea of who is logged in gets the same check
 * (server/plugins/02.session-check.ts).
 */
async function sessionUser(event: H3Event) {
  const session = await getUserSession(event)
  if (!session.user) return undefined
  const user = findUserById(useDb(), session.user.id)
  if (!sessionBelongsTo(session.user, user)) {
    await clearUserSession(event)
    return undefined
  }
  return user
}

/** The id of the logged-in person, or null. */
export async function sessionUserId(event: H3Event): Promise<number | null> {
  return (await sessionUser(event))?.id ?? null
}

/** The logged-in person's account, or 401. */
export async function requireUser(event: H3Event) {
  const user = await sessionUser(event)
  if (!user) fail(401, 'unauthorized')
  return user
}

/**
 * The address a request comes from, for the rate limits. Behind a proxy of ours
 * (NUXT_TRUST_PROXY=true) that is the address the proxy saw; otherwise the socket's.
 */
export function clientIp(event: H3Event): string {
  if (useRuntimeConfig().trustProxy === true) {
    const forwarded = lastForwardedFor(getRequestHeader(event, 'x-forwarded-for'))
    if (forwarded) return forwarded
  }
  return getRequestIP(event) ?? 'unknown'
}
