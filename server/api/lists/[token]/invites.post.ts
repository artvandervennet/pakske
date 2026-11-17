import { inviteInput } from '../../../../shared/schemas/input'
import { createInvite } from '../../../domain/invites'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const token = tokenParam(event)
  const input = await readInput(event, inviteInput)
  const invite = domain(() => createInvite(useDb(), user.id, token, input))
  setResponseStatus(event, 201)
  return invite
})
