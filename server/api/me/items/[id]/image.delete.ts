import { setItemImage } from '../../../../domain/items'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const id = idParam(event)
  const { previous } = domain(() => setItemImage(useDb(), user.id, id, null))
  await removeUpload(previous)
  return sendNoContent(event)
})
