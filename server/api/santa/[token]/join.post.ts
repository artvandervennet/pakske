import { santaListInput } from '../../../../shared/schemas/input'
import { joinGroup } from '../../../domain/santa'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const token = tokenParam(event)
  const input = await readInput(event, santaListInput)
  // No await between here and the end of joinGroup, so two people can't both take the last place.
  domain(() => joinGroup(useDb(), user.id, token, input.list))
  return sendNoContent(event)
})
