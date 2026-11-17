import { randomBytes } from 'node:crypto'

/** 16 random bytes is 128 bits: the address is the only thing that gives access to a list. */
export const LIST_TOKEN = /^[A-Za-z0-9_-]{22}$/

export function newListToken(): string {
  return randomBytes(16).toString('base64url')
}
