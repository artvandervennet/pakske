import type { PublicWish } from '../schemas/list'

// What an owner's row sends when a field of the wish is edited in place. Each field saves on
// its own, with only that field in the PATCH, so a save never overwrites another field with
// what the row happened to hold.

export type WishTextField = 'title' | 'description' | 'url'
export type WishChange = Partial<Pick<PublicWish, WishTextField | 'quantity'>>

/** The saved text a field shows, and what Escape puts back. */
export function savedText(wish: Pick<PublicWish, WishTextField>, field: WishTextField): string {
  return wish[field] ?? ''
}

/** A title on one line: where a line ended (typed or pasted), a space. */
export function oneLine(text: string): string {
  return text.replace(/\s*[\r\n]+\s*/g, ' ')
}

/**
 * The text a field holds once it is saved: what was sent, as the server keeps it (trimmed;
 * a title on one line). A field shows this from the moment the save worked, also when the
 * refresh after it fails.
 */
export function cleanText(text: string, kind: 'line' | 'text' | 'url'): string {
  return (kind === 'line' ? oneLine(text) : text).trim()
}

/**
 * What leaving a field, or Enter, does with what it holds:
 *   send   a change since the field got the focus (or since its save failed) goes out
 *   adopt  nothing was changed: take the list's value, which may be newer than the field's
 *   keep   a failed text, left unchanged: it stays, with its reason; Enter tries it again
 * A field left as it was never sends, so it can't overwrite a change made elsewhere meanwhile.
 */
export function commitAction(
  field: { draft: string, atFocus: string, failedText: string | null },
  how: 'enter' | 'blur',
): 'send' | 'adopt' | 'keep' {
  if (field.failedText !== null) {
    if (field.draft !== field.failedText || how === 'enter') return 'send'
    return 'keep'
  }
  return field.draft === field.atFocus ? 'adopt' : 'send'
}

/**
 * The PATCH body for what a field holds, or null when it says what is saved already (spaces
 * around it don't count, as the server trims them). `saved` is the field's saved text. An
 * emptied text or link is cleared; an emptied title is sent, so the server's "fill this in"
 * shows beside it.
 */
export function fieldChange(field: WishTextField, text: string, saved: string): WishChange | null {
  const value = cleanText(text, field === 'title' ? 'line' : 'text')
  if (value === saved) return null
  return field === 'title' ? { title: value } : { [field]: value || null }
}

/** The PATCH body for an amount (null: no limit), or null when it is the saved one. */
export function amountChange(saved: number | null, wanted: number | null): WishChange | null {
  return wanted === saved ? null : { quantity: wanted }
}

/** One step of the stepper, within what the server accepts. */
export function stepAmount(amount: number, step: 1 | -1): number {
  return Math.min(999, Math.max(1, amount + step))
}

/**
 * Whether a field takes the value of a refreshed list. Not while it has the focus, while its
 * save is on the way, or while a failed save waits: each time it holds what was typed.
 */
export function followsSaved(field: { focused: boolean, saving: boolean, failed: boolean }): boolean {
  return !field.focused && !field.saving && !field.failed
}
