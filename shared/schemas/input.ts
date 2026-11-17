import { z } from 'zod'

// What people submit. Every message is a code; the client translates `fields.<code>`.

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
  displayName: requiredText(60),
  password: newPassword,
})

export const loginInput = z.object({
  email: z.string('required').trim().toLowerCase().min(1, 'required').max(254, 'too_long'),
  password: z.string('required').min(1, 'required').max(128, 'too_long'),
})

export const profileInput = z.object({
  displayName: requiredText(60),
})

export const passwordInput = z.object({
  currentPassword: z.string('required').min(1, 'required').max(128, 'too_long'),
  newPassword,
})

export const listInput = z.object({ title: requiredText(80) })

/** Where a wish from someone else's list should land: one of the person's lists, or a new one. */
export const targetInput = z.union([
  z.strictObject({ list: z.string('required').min(1, 'required').max(64, 'too_long') }),
  z.strictObject({ newList: listInput.shape.title }),
])

const wishFields = {
  title: requiredText(120),
  description: optionalText(2000),
  // http and https only: anything else (javascript:, data:) would run when someone clicks it.
  url: optionalText(2000).refine(v => v === null || isHttpUrl(v), 'invalid_url'),
  // null means unlimited
  quantity: amount.nullable(),
}

/** A new wish. Only the title is needed; an absent amount means one. */
export const wishInput = z.object({
  title: wishFields.title,
  description: wishFields.description.default(null),
  url: wishFields.url.default(null),
  quantity: wishFields.quantity.default(1),
})

/**
 * A change to a wish: only the fields that are sent change. Nothing has a default, or a change
 * to the title alone would reset the amount, the text and the link.
 */
export const wishPatchInput = z.object({
  title: wishFields.title.optional(),
  description: wishFields.description.optional(),
  url: wishFields.url.optional(),
  quantity: wishFields.quantity.optional(),
}).refine(change => Object.values(change).some(value => value !== undefined), 'required')

export const purchaseInput = z.object({ quantity: amount })

export const noteInput = z.object({ body: requiredText(1000) })

export type WishInput = z.infer<typeof wishInput>
export type WishPatchInput = z.infer<typeof wishPatchInput>
export type ListTarget = z.infer<typeof targetInput>

/** The first error code per field, e.g. `{ title: 'required' }`. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {}
  for (const issue of error.issues) {
    const name = issue.path.join('.')
    fields[name] ??= /^[a-z_]+$/.test(issue.message) ? issue.message : 'invalid'
  }
  return fields
}
