import { inviteInput } from '../../../../shared/schemas/input'
import { createInvite, sendInvite } from '../../../domain/invites'

const HOUR = 60 * 60 * 1000

// Shares some wishes on a list of the person's own, or the list itself. Without `friends` it
// answers with a link to pass on. With them, each of those friends gets it as a notice and the
// answer only says how many: what was sent has no address the sender could hand to anyone else.
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const token = tokenParam(event)
  const input = await readInput(event, inviteInput)
  setResponseStatus(event, 201)
  if (!input.friends) return domain(() => createInvite(useDb(), user.id, token, input))
  // Every send is a notice for someone else; sixty an hour is more than anyone needs.
  const key = `send:${user.id}`
  if (isLimited(key, 60)) fail(429, 'rate_limited')
  const sent = domain(() => sendInvite(useDb(), user.id, token, input, input.friends!))
  countHit(key, HOUR)
  return sent
})
