import { santaListInput } from '../../../../shared/schemas/input'
import { setGroupList } from '../../../domain/santa'

// Which of their own lists a member puts in, for whoever draws them.
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const token = tokenParam(event)
  const input = await readInput(event, santaListInput)
  domain(() => setGroupList(useDb(), user.id, token, input.list))
  return sendNoContent(event)
})
