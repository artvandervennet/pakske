import { setWishImage } from '../../../../../domain/wishes'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const token = tokenParam(event)
  const id = idParam(event)
  const { previous } = domain(() => setWishImage(useDb(), user.id, token, id, null))
  await removeUpload(previous)
  return sendNoContent(event)
})
