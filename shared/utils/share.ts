/**
 * What goes out when a list is shared: the words, and under them the link. One piece of text,
 * because an app that gets words and an address apart often keeps the address only: WhatsApp,
 * Messages and Mail in the share sheet of a Mac or an iPhone do.
 */
export function shareMessage(text: string, url: string): string {
  return `${text}\n${url}`
}
