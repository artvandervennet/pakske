import { setWishImage } from '../../../../../domain/wishes'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const token = tokenParam(event)
  const id = idParam(event)
  const db = useDb()
  const { unused, coverOf } = domain(() => setWishImage(db, user.id, token, id, null))
  await removeUploads(unused)
  // Without the owner's own photo, the first link's cover is the picture again.
  if (coverOf) await refreshCover(db, user.id, token, id, coverOf)
  return sendNoContent(event)
})
