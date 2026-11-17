import type { HomeView } from '../../shared/schemas/list'
import { listOwnedLists } from '../domain/lists'
import { listNotices } from '../domain/notices'
import { describeLists, listOpenedLists } from '../domain/visits'

// Logged out, the opened lists come from the cookie; tokens in it that match no list are skipped.
export default defineEventHandler(async (event): Promise<HomeView> => {
  const userId = await sessionUserId(event)
  const db = useDb()
  if (userId === null) return { owned: [], opened: describeLists(db, readOpened(event)), notices: [] }
  return { owned: listOwnedLists(db, userId), opened: listOpenedLists(db, userId), notices: listNotices(db, userId) }
})
