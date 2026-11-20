/**
 * The error a page throws when it can't get what it shows: the 404 page for a link that is
 * wrong, old or not this person's to open. `pageErrorIsFatal` says when the server logs it.
 */
export function pageError(statusCode: number) {
  return createError({ statusCode, fatal: pageErrorIsFatal(statusCode, import.meta.client) })
}
