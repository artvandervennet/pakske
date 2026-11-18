import { acceptInput } from '../../../../shared/schemas/input'
import { acceptInvite } from '../../../domain/invites'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const invite = tokenParam(event, 'invite')
  const { target, wishIds } = await readInput(event, acceptInput)
  // No await between here and the end of acceptInvite, so of two people at once only one gets it.
  return domain(() => acceptInvite(useDb(), user.id, invite, target, wishIds))
})
