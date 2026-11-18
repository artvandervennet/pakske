import { z } from 'zod'
import { MAX_LINKS } from '../utils/wish-edit'

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

/** The page's language, for what Firebase mails. */
export const mailLocale = z.enum(['nl', 'en']).default('nl')

/** "Wachtwoord vergeten": the address, and the page's language for the mail. */
export const forgotInput = z.object({ email, locale: mailLocale })

export const passwordMailInput = z.object({ locale: mailLocale })

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

/** A link that works once: for some wishes on the list, or for the list itself. */
export const inviteInput = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('wishes'),
    wishIds: z.array(z.number('invalid').int('invalid').positive('invalid'), 'required').min(1, 'required').max(50, 'too_long'),
  }),
  z.strictObject({ kind: z.literal('list') }),
])

/**
 * Some wishes on a list, for reordering or deleting them together: each once, and at most 200,
 * the number of wishes a list can show at a time (MAX_LIVE_WISHES).
 */
export const wishIdsInput = z.strictObject({
  wishIds: z.array(z.number('invalid').int('invalid').positive('invalid'), 'required')
    .min(1, 'required')
    .max(200, 'too_long')
    .refine(ids => new Set(ids).size === ids.length, 'invalid'),
})

/**
 * Accepting a link: wishes need a list to land on; a link to a list needs nothing, which parses to
 * null. The empty shape names both keys as never, so `{ newList: ' ' }` still reports the field
 * rather than a union that matched nothing.
 */
export const acceptInput = z.union([
  ...targetInput.options,
  z.strictObject({ list: z.never().optional(), newList: z.never().optional() }).transform(() => null),
])

/**
 * A wish's links, in the owner's order. Every refusal is reported on the list itself and not on
 * the entry, so the page finds it under `urls`, the one field it sent.
 */
const links = z.array(z.string('invalid').trim(), 'invalid').superRefine((list, ctx) => {
  const refuse = (message: string) => ctx.addIssue({ code: 'custom', message })
  if (list.length > MAX_LINKS) return refuse('too_many_links')
  if (list.some(link => link.length > 2000)) return refuse('too_long')
  // http and https only: anything else (javascript:, data:) would run when someone clicks it.
  if (!list.every(isHttpUrl)) return refuse('invalid_url')
  if (new Set(list).size !== list.length) refuse('duplicate_link')
})

const wishFields = {
  title: requiredText(120),
  description: optionalText(2000),
  urls: links,
  // null means unlimited
  quantity: amount.nullable(),
}

/** A new wish. Only the title is needed; an absent amount means one. */
export const wishInput = z.object({
  title: wishFields.title,
  description: wishFields.description.default(null),
  urls: wishFields.urls.default([]),
  quantity: wishFields.quantity.default(1),
})

/**
 * A change to a wish: only the fields that are sent change. Nothing has a default, or a change
 * to the title alone would reset the amount, the text and the links. `urls` replaces the whole
 * list; an empty one clears it.
 */
export const wishPatchInput = z.object({
  title: wishFields.title.optional(),
  description: wishFields.description.optional(),
  urls: wishFields.urls.optional(),
  quantity: wishFields.quantity.optional(),
}).refine(change => Object.values(change).some(value => value !== undefined), 'required')

/** How many this person is getting, and, when given, whether the other buyers see their name. */
export const purchaseInput = z.object({ quantity: amount, anonymous: z.boolean('invalid').optional() })

export const noteInput = z.object({ body: requiredText(1000) })

export type WishInput = z.infer<typeof wishInput>
export type WishPatchInput = z.infer<typeof wishPatchInput>
export type ListTarget = z.infer<typeof targetInput>
export type InviteInput = z.infer<typeof inviteInput>

/** The first error code per field, e.g. `{ title: 'required' }`. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {}
  for (const issue of error.issues) {
    const name = issue.path.join('.')
    fields[name] ??= /^[a-z_]+$/.test(issue.message) ? issue.message : 'invalid'
  }
  return fields
}
