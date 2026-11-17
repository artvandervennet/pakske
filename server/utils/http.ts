import type { H3Event } from 'h3'
import type { ZodType } from 'zod'
import { fieldErrors } from '../../shared/schemas/input'
import { DomainError, type DomainErrorCode } from '../domain/errors'
import { findUserById } from '../domain/users'

const STATUS: Record<DomainErrorCode, number> = {
  not_found: 404,
  forbidden: 403,
  validation: 422,
  email_taken: 409,
  username_taken: 409,
  registration_closed: 403,
  item_limit: 409,
  quantity_exceeded: 409,
  item_removed: 409,
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

/** The id of the logged-in person, or null. */
export async function sessionUserId(event: H3Event): Promise<number | null> {
  const session = await getUserSession(event)
  return session.user?.id ?? null
}

/** The logged-in person's account, or 401. Also 401 when the account behind the cookie is gone. */
export async function requireUser(event: H3Event) {
  const id = await sessionUserId(event)
  const user = id === null ? undefined : findUserById(useDb(), id)
  if (!user) {
    if (id !== null) await clearUserSession(event)
    fail(401, 'unauthorized')
  }
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
