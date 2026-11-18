import { wishPatchInput } from '../../../../../../shared/schemas/input'
import { updateWish } from '../../../../../domain/wishes'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const token = tokenParam(event)
  const id = idParam(event)
  const input = await readInput(event, wishPatchInput)
  const { wish, unused } = domain(() => updateWish(useDb(), user.id, token, id, input))
  // The change is saved. Failing to clean up a cover it dropped must not undo that.
  await removeUploads(unused)
  return wish
})
