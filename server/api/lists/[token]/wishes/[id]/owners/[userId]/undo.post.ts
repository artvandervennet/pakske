import { undoLink } from '../../../../../../../domain/undo'

// "Undo" on a notice that this person linked the wish.
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const token = tokenParam(event)
  const id = idParam(event)
  const linker = idParam(event, 'userId')
  const { unused } = domain(() => undoLink(useDb(), user.id, token, id, linker))
  await removeUploads(unused)
  return sendNoContent(event)
})
