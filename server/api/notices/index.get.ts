import { listRequests } from '../../domain/friends'
import { listNotices } from '../../domain/notices'

// What the bell in the header opens: the person's notices, and the friend requests that wait
// for their answer. Asked for when the bell is pressed, not with every page.
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const db = useDb()
  return { notices: listNotices(db, user.id), requests: listRequests(db, user.id).incoming }
})
