import { hideShownList } from '../../../domain/friends'

// Takes a list a friend shows the person off their own page. The friend isn't told.
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const token = tokenParam(event)
  domain(() => hideShownList(useDb(), user.id, token))
  return sendNoContent(event)
})
