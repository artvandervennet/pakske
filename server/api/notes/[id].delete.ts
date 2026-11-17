import { deleteNote } from '../../domain/notes'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const id = String(getRouterParam(event, 'id'))
  domain(() => deleteNote(useDb(), id, user.id))
  return sendNoContent(event)
})
