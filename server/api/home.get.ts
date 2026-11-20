import { HOME_LISTS, type HomeView } from '../../shared/schemas/list'
import { listOwnedLists } from '../domain/lists'
import { listGroups } from '../domain/santa'
import { describeLists, listOthersLists } from '../domain/visits'

// The home page gets the first few lists of each kind and how many there are; the lists page
// (GET /api/lists) gets them all. Logged out, the opened lists come from the cookie; tokens in it
// that match no list are skipped.
export default defineEventHandler(async (event): Promise<HomeView> => {
  const userId = await sessionUserId(event)
  const db = useDb()
  const owned = userId === null ? [] : listOwnedLists(db, userId)
  const opened = userId === null ? describeLists(db, readOpened(event)) : listOthersLists(db, userId)
  return {
    owned: owned.slice(0, HOME_LISTS),
    ownedTotal: owned.length,
    opened: opened.slice(0, HOME_LISTS),
    openedTotal: opened.length,
    santa: userId === null ? [] : listGroups(db, userId),
  }
})
