import { countFreshRequests } from '../../domain/friends'
import { countUnseen } from '../../domain/notices'

// What the mark in the header counts: notices the person hasn't seen, and friend requests that
// wait for their answer and that they haven't seen either.
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const db = useDb()
  return { unseen: countUnseen(db, user.id) + countFreshRequests(db, user.id) }
})
