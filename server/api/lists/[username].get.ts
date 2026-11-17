import { getList } from '../../domain/list'

// The one endpoint that returns a list. `getList` picks the view from the session, so the
// response, and with it the page's server-rendered payload, never holds more than the person
// asking may see.
export default defineEventHandler(async (event) => {
  const username = String(getRouterParam(event, 'username')).toLowerCase()
  const list = getList(useDb(), username, await sessionUserId(event))
  if (!list) fail(404, 'not_found')
  return list
})
