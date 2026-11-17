import { noteInput } from '../../../../../../shared/schemas/input'
import { addNote } from '../../../../../domain/notes'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const token = tokenParam(event)
  const id = idParam(event)
  const input = await readInput(event, noteInput)
  const note = domain(() => addNote(useDb(), token, id, user.id, input.body))
  setResponseStatus(event, 201)
  return note
})
