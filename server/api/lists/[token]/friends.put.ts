import { shownFriendsInput } from '../../../../shared/schemas/input'
import { setShownTo } from '../../../domain/friends'

// Which of the person's friends find this list on their Lists page: exactly the ones sent.
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const token = tokenParam(event)
  const input = await readInput(event, shownFriendsInput)
  domain(() => setShownTo(useDb(), user.id, token, input.friends))
  return sendNoContent(event)
})
