// Bringing wishes over from a shop: what the server found there, and what the page then offers.

/** How many wishes one import brings, and how many links one paste is read for. */
export const IMPORT_MAX = 100

/** A wish found at a shop: its name there and its page. */
export interface ImportItem {
  title: string
  url: string
  /** The picture the shop's own list showed with it, when the product's page names none. */
  image?: string
}

/** What a paste gave. */
export interface ImportRead {
  items: ImportItem[]
  /** The links nothing could be read from: the shop refused, took too long, or named no product. */
  unread: string[]
  /**
   * Set when a shop's list holds more than was read: `read` of its `total`, which is null when
   * the shop doesn't say how many there are.
   */
  short: { read: number, total: number | null } | null
}

/** A link as two of them are compared: without "www.", a closing slash and what follows a #. */
function comparable(link: string): string {
  try {
    const url = new URL(link)
    return `${url.host.replace(/^www\./, '')}${url.pathname.replace(/\/+$/, '')}${url.search}`.toLowerCase()
  }
  catch {
    return link
  }
}

/** Which of the found wishes the list has already: the places in `items` whose link a wish there carries. */
export function alreadyListed(items: readonly ImportItem[], wishes: readonly { urls: readonly string[] }[]): Set<number> {
  const listed = new Set(wishes.flatMap(wish => wish.urls.map(comparable)))
  const found = new Set<number>()
  items.forEach((item, at) => {
    if (listed.has(comparable(item.url))) found.add(at)
  })
  return found
}
