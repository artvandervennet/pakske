import { wishPatchInput } from '../../../../../../shared/schemas/input'
import { updateWish } from '../../../../../domain/wishes'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const token = tokenParam(event)
  const id = idParam(event)
  const input = await readInput(event, wishPatchInput)
  const db = useDb()
  const { wish, unused, coverOf } = domain(() => updateWish(db, user.id, token, id, input))
  // The change is saved. Failing to clean up a cover it dropped must not undo that.
  await removeUploads(unused)
  // A new first link: its cover becomes the picture, unless the owner put up a photo. The
  // fetch happens here, after the change was saved, and whatever it does the wish is returned.
  return (coverOf && await refreshCover(db, user.id, token, id, coverOf)) || wish
})
