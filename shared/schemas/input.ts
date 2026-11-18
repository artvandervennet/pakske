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
const newPassword = z.string('required').min(8, 'password_short').max(128, 'too_long')
const amount = z.number('invalid_amount').int('invalid_amount').min(1, 'invalid_amount').max(999, 'invalid_amount')

/** The page's language: for what Firebase mails, and for the name of a new account's first list. */
export const mailLocale = z.enum(['nl', 'en']).default('nl')

export const registerInput = z.object({
  email,
  displayName: requiredText(60),
  password: newPassword,
  locale: mailLocale,
})

export const loginInput = z.object({
  email: z.string('required').trim().toLowerCase().min(1, 'required').max(254, 'too_long'),
  password: z.string('required').min(1, 'required').max(128, 'too_long'),
})

/** "Wachtwoord vergeten": the address, and the page's language for the mail. */
export const forgotInput = z.object({ email, locale: mailLocale })

export const passwordMailInput = z.object({ locale: mailLocale })

/** A change to the profile: only what is sent changes. */
export const profileInput = z.object({
  displayName: requiredText(60).optional(),
  // "Standaard anoniem geven": a new purchase of theirs is without their name.
  anonymousDefault: z.boolean('invalid').optional(),
}).refine(change => Object.values(change).some(value => value !== undefined), 'required')

const currentPassword = z.string('required').min(1, 'required').max(128, 'too_long')

export const passwordInput = z.object({ currentPassword, newPassword })

/**
 * Another address for the account, and the page's language for the mail that confirms it. The
 * current password comes along for an account that has one.
 */
export const emailChangeInput = z.object({ email, currentPassword: currentPassword.optional(), locale: mailLocale })

/** Deleting the account: the current password, for an account that has one. */
export const accountDeleteInput = z.object({ currentPassword: currentPassword.optional() })

export const listInput = z.object({ title: requiredText(80) })

/** Where a wish from someone else's list should land: one of the person's lists, or a new one. */
export const targetInput = z.union([
  z.strictObject({ list: z.string('required').min(1, 'required').max(64, 'too_long') }),
  z.strictObject({ newList: listInput.shape.title }),
])

const wishId = z.number('invalid').int('invalid').positive('invalid')

/**
 * A link that shares some wishes on the list, or the list itself. Wishes go as copies unless the
 * maker says "linked"; a list is only ever shared together, so it has no mode to choose.
 */
export const inviteInput = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('wishes'),
    mode: z.enum(['linked', 'copy'], 'invalid').default('copy'),
    wishIds: z.array(wishId, 'required').min(1, 'required').max(50, 'too_long'),
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
 * Which of a link's wishes to take: each once, and no more than a link can hold. The ceiling is
 * a refinement because zod's own `max` ends the parse, and the union below then reports no field.
 */
const chosenWishIds = z.array(wishId, 'required')
  .min(1, 'required')
  .refine(ids => ids.length <= 50, 'too_long')
  .refine(ids => new Set(ids).size === ids.length, 'invalid')
  .optional()

const [onList, onNewList] = targetInput.options

/**
 * Accepting a link: wishes need a list to land on, and may name which of them to take (all of
 * them when left out); a link to a list needs nothing, which parses to a null target. The empty
 * shape names every key as never, so `{ newList: ' ' }` still reports the field rather than a
 * union that matched nothing. The reshaping comes after the union for the same reason: inside
 * it, an option with a transform would no longer count as the one that nearly matched.
 */
export const acceptInput = z.union([
  z.strictObject({ ...onList.shape, wishIds: chosenWishIds }),
  z.strictObject({ ...onNewList.shape, wishIds: chosenWishIds }),
  z.strictObject({ list: z.never().optional(), newList: z.never().optional(), wishIds: z.never().optional() }),
]).transform((input): { target: ListTarget | null, wishIds?: number[] } => {
  if ('list' in input && input.list !== undefined) return { target: { list: input.list }, wishIds: input.wishIds }
  if ('newList' in input && input.newList !== undefined) return { target: { newList: input.newList }, wishIds: input.wishIds }
  return { target: null }
})

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
