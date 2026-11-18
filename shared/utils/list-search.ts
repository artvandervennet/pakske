/** What the search looks at: a list's title and the display names of its owners. */
export interface SearchableList {
  title: string
  owners: string[]
}

/**
 * Text as the search compares it: without capitals and without accents, so "zoe" finds "Zoë".
 * NFD splits a letter from its accent; the accents are then the combining marks.
 */
function plain(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

/**
 * The lists that fit a search, in the order given. Every word of the search has to be somewhere
 * in the list's title or in the name of one of its owners; the words may be spread over them, so
 * "kerst lotte" finds Lotte's list "Kerst". An empty search fits every list.
 */
export function searchLists<T extends SearchableList>(lists: T[], query: string): T[] {
  const words = plain(query).split(/\s+/).filter(Boolean)
  if (words.length === 0) return lists
  return lists.filter((list) => {
    const texts = [list.title, ...list.owners].map(plain)
    return words.every(word => texts.some(text => text.includes(word)))
  })
}
