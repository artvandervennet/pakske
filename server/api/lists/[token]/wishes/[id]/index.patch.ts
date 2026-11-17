import { wishPatchInput } from '../../../../../../shared/schemas/input'
import { updateWish } from '../../../../../domain/wishes'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const token = tokenParam(event)
  const id = idParam(event)
  const input = await readInput(event, wishPatchInput)
  return domain(() => updateWish(useDb(), user.id, token, id, input))
})
