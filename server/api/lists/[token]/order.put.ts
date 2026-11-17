import { wishIdsInput } from '../../../../shared/schemas/input'
import { reorderWishes } from '../../../domain/wishes'

// The list's order, from an owner's edit mode. Always 204 for a list of yours: ids that aren't on
// it are ignored, and wishes left out keep their order after the ones given.
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const token = tokenParam(event)
  const { wishIds } = await readInput(event, wishIdsInput)
  domain(() => reorderWishes(useDb(), user.id, token, wishIds))
  return sendNoContent(event)
})
