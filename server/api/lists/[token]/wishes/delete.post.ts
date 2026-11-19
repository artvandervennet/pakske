import { wishesDeleteInput } from '../../../../../shared/schemas/input'
import { deleteWishes } from '../../../../domain/wishes'

// Deleting several wishes from an owner's edit mode, each the way a single delete goes. Always
// 204 for a list of yours, whatever buyers did; a wish already gone is skipped.
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const token = tokenParam(event)
  const { wishIds, ...options } = await readInput(event, wishesDeleteInput)
  domain(() => deleteWishes(useDb(), user.id, token, wishIds, options))
  return sendNoContent(event)
})
