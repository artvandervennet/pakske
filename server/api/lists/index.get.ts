import type { ListsView } from '../../../shared/schemas/list'
import { listShownLists } from '../../domain/friends'
import { listOwnedLists } from '../../domain/lists'
import { describeLists, listOpenedLists } from '../../domain/visits'

// Every list the lists page shows, for its search to filter in the browser. Only the person's own
// lists, the ones a friend shows them, and the ones they opened themselves: logged in from the account, logged out from this
// browser's cookie. There is no way to ask for anyone else's.
export default defineEventHandler(async (event): Promise<ListsView> => {
  const userId = await sessionUserId(event)
  const db = useDb()
  if (userId === null) return { owned: [], opened: describeLists(db, readOpened(event)), shown: [] }
  return { owned: listOwnedLists(db, userId), opened: listOpenedLists(db, userId), shown: listShownLists(db, userId) }
})
