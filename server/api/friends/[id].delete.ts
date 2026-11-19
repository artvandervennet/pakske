import { removeFriend } from '../../domain/friends'

// Stops being friends. The other isn't told; what each showed the other goes with it.
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const friendId = idParam(event)
  domain(() => removeFriend(useDb(), user.id, friendId))
  return sendNoContent(event)
})
