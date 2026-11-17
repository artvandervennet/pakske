import { z } from 'zod'

// What people submit. Every message is a code; the client translates `fields.<code>`.

export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/

const requiredText = (max: number) => z.string('required').trim().min(1, 'required').max(max, 'too_long')
const optionalText = (max: number) => z.string('invalid').trim().max(max, 'too_long').nullish().transform(v => v || null)

function isHttpUrl(value: string) {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol)
  }
  catch {
    return false
  }
}

const email = z.string('required').trim().toLowerCase().min(1, 'required').max(254, 'too_long').pipe(z.email('invalid_email'))
const newPassword = z.string('required').min(10, 'password_short').max(128, 'too_long')
const amount = z.number('invalid_amount').int('invalid_amount').min(1, 'invalid_amount').max(999, 'invalid_amount')

export const registerInput = z.object({
  email,
  username: z.string('required').trim().toLowerCase().regex(USERNAME_PATTERN, 'invalid_username'),
  displayName: requiredText(60),
  password: newPassword,
})

export const loginInput = z.object({
  email: z.string('required').trim().toLowerCase().min(1, 'required').max(254, 'too_long'),
  password: z.string('required').min(1, 'required').max(128, 'too_long'),
})

export const profileInput = z.object({
  displayName: requiredText(60),
  listIntro: optionalText(500),
})

export const passwordInput = z.object({
  currentPassword: z.string('required').min(1, 'required').max(128, 'too_long'),
  newPassword,
})

export const itemInput = z.object({
  title: requiredText(120),
  description: optionalText(2000),
  // http and https only: anything else (javascript:, data:) would run when someone clicks it.
  url: optionalText(2000).refine(v => v === null || isHttpUrl(v), 'invalid_url'),
  // null means unlimited
  quantity: amount.nullable(),
})

export const purchaseInput = z.object({ quantity: amount })

export const noteInput = z.object({ body: requiredText(1000) })

export type RegisterInput = z.infer<typeof registerInput>
export type ProfileInput = z.infer<typeof profileInput>
export type ItemInput = z.infer<typeof itemInput>

/** The first error code per field, e.g. `{ title: 'required' }`. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {}
  for (const issue of error.issues) {
    const name = issue.path.join('.')
    fields[name] ??= /^[a-z_]+$/.test(issue.message) ? issue.message : 'invalid'
  }
  return fields
}
