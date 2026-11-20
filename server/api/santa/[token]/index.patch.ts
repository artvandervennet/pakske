import { listInput } from '../../../../shared/schemas/input'
import { renameGroup } from '../../../domain/santa'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const token = tokenParam(event)
  const input = await readInput(event, listInput)
  domain(() => renameGroup(useDb(), user.id, token, input.title))
  return sendNoContent(event)
})
