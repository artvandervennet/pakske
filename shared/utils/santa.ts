import type { MyLists } from '../schemas/list'

/**
 * The list a Secret Santa form starts with: the one the person put a wish on last, else their
 * first, else none. It is a choice on view, so they see what goes in before they say yes.
 */
export function startingList(mine: MyLists | null | undefined): string | null {
  if (!mine) return null
  return mine.lists.some(list => list.token === mine.last) ? mine.last : (mine.lists[0]?.token ?? null)
}
