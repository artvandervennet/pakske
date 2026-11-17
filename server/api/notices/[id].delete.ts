import { dismissNotice } from '../../domain/undo'

// Someone else's notice is "not found", the same as one that doesn't exist.
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const id = String(getRouterParam(event, 'id'))
  const { unused } = domain(() => dismissNotice(useDb(), user.id, id))
  await removeUploads(unused)
  return sendNoContent(event)
})
