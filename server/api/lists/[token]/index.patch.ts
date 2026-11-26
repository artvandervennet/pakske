import { listPatchInput } from '../../../../shared/schemas/input'
import { changeList } from '../../../domain/lists'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const token = tokenParam(event)
  const input = await readInput(event, listPatchInput)
  const list = domain(() => changeList(useDb(), user.id, token, input))
  return { token, ...list }
})
