import { getListView } from '../../../domain/list-view'
import { rememberList } from '../../../domain/visits'

// The one endpoint that returns a list. `getListView` decides per wish what this viewer may see,
// so the response, and with it the page's server-rendered payload, never holds more than that.
export default defineEventHandler(async (event) => {
  const token = tokenParam(event)
  const viewerId = await sessionUserId(event)
  const db = useDb()
  const view = getListView(db, token, viewerId)
  if (!view) fail(404, 'not_found')

  // Opening a list is remembered: in the account, or in a cookie when logged out. Someone else's
  // list goes on your visited lists; a list of your own moves to the front of your own.
  if (viewerId === null) writeOpened(event, withOpened(readOpened(event), token))
  else rememberList(db, viewerId, token)
  return view
})
