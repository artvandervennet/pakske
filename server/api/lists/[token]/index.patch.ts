import { listInput } from '../../../../shared/schemas/input'
import { renameList } from '../../../domain/lists'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const token = tokenParam(event)
  const input = await readInput(event, listInput)
  domain(() => renameList(useDb(), user.id, token, input.title))
  return { token, title: input.title }
})
