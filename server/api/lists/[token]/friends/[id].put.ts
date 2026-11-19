import { listFriendInput } from '../../../../../shared/schemas/input'
import { setShownToOne } from '../../../../domain/friends'
import { sendInvite } from '../../../../domain/invites'

const HOUR = 60 * 60 * 1000

// One friend and one list of the person's own: whether that friend finds the list (`shown`), or
// that they are invited to co-own it (`invited`). Each press in the share sheet is one of
// these, so two quick presses on two friends can't overwrite each other.
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const token = tokenParam(event)
  const friendId = idParam(event)
  const input = await readInput(event, listFriendInput)
  const db = useDb()
  if ('shown' in input) domain(() => setShownToOne(db, user.id, token, friendId, input.shown))
  else {
    // An invitation is a notice for someone else, counted with everything else that is sent.
    const key = `send:${user.id}`
    if (isLimited(key, 60)) fail(429, 'rate_limited')
    domain(() => sendInvite(db, user.id, token, { kind: 'list' }, [friendId]))
    countHit(key, HOUR)
  }
  return sendNoContent(event)
})
