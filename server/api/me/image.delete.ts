import { setPicture } from '../../domain/users'

// Takes the person's profile picture away; the pages draw one from their id again.
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const { unused } = domain(() => setPicture(useDb(), user.id, null))
  await removeUploads(unused)
  return sendNoContent(event)
})
