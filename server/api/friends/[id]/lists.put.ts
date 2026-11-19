import { shownListsInput } from '../../../../shared/schemas/input'
import { setShownLists } from '../../../domain/friends'

// Which of the person's own lists this friend finds on their Lists page: exactly the ones sent.
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const friendId = idParam(event)
  const input = await readInput(event, shownListsInput)
  domain(() => setShownLists(useDb(), user.id, friendId, input.lists))
  return sendNoContent(event)
})
