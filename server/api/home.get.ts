import { HOME_LISTS, type HomeView } from '../../shared/schemas/list'
import { listRequests, listShownLists } from '../domain/friends'
import { listOwnedLists } from '../domain/lists'
import { listNotices } from '../domain/notices'
import { describeLists, listOpenedLists } from '../domain/visits'

// The home page gets the first few lists of each kind and how many there are; the lists page
// (GET /api/lists) gets them all. Logged out, the opened lists come from the cookie; tokens in it
// that match no list are skipped.
export default defineEventHandler(async (event): Promise<HomeView> => {
  const userId = await sessionUserId(event)
  const db = useDb()
  const owned = userId === null ? [] : listOwnedLists(db, userId)
  const opened = userId === null ? describeLists(db, readOpened(event)) : listOpenedLists(db, userId)
  const shown = userId === null ? [] : listShownLists(db, userId)
  return {
    owned: owned.slice(0, HOME_LISTS),
    ownedTotal: owned.length,
    opened: opened.slice(0, HOME_LISTS),
    openedTotal: opened.length,
    notices: userId === null ? [] : listNotices(db, userId),
    shown: shown.slice(0, HOME_LISTS),
    shownTotal: shown.length,
    requests: userId === null ? [] : listRequests(db, userId).incoming,
  }
})
