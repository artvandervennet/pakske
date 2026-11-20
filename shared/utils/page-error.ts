/**
 * Whether the error a page throws, when it can't get what it shows, is `fatal`.
 *
 * In the browser `fatal` is what puts the error page on the screen, so there it always is. On
 * the server a thrown error ends in the error page anyway, and `fatal` only makes the server
 * write the error to its log, with its stack and the page's address. A wrong, old or forbidden
 * link (4xx) is not the server's fault, and a list's address is its key: that stays out of the
 * log. A failure of the server's own (5xx) is logged.
 */
export function pageErrorIsFatal(statusCode: number, inBrowser: boolean): boolean {
  return inBrowser || statusCode >= 500
}
