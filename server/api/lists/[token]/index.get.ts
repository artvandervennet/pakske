import { ownersToBefriend } from '../../../domain/friends'
import { getListView, oldLinkView } from '../../../domain/list-view'
import { coOwnersOf } from '../../../domain/lists'
import { drawnOwnersOf } from '../../../domain/santa'
import { rememberList } from '../../../domain/visits'

// The one endpoint that returns a list. `getListView` decides per wish what this viewer may see,
// so the response, and with it the page's server-rendered payload, never holds more than that.
// For an address a list had before it got a new link, `oldLinkView` decides the same way.
export default defineEventHandler(async (event) => {
  const token = tokenParam(event)
  const viewerId = await sessionUserId(event)
  const db = useDb()
  const view = getListView(db, token, viewerId)
  if (!view) {
    // No list has this address now. If one had it before a new link, its owner is told where
    // the list went (`movedTo`), and someone who was giving something from it gets just that,
    // to take it back. Neither is opening the list, so nothing is remembered about it.
    const old = oldLinkView(db, token, viewerId)
    if (!old) fail(404, 'not_found')
    return old
  }

  // Opening a list is remembered: in the account, or in a cookie when logged out. Someone else's
  // list goes on your visited lists; a list of your own moves to the front of your own.
  if (viewerId === null) writeOpened(event, withOpened(readOpened(event), token))
  else rememberList(db, viewerId, token)
  // Who they may ask to be friends: the owners of a list they opened. Beside the view, not in
  // it: `getListView` knows nothing about friends.
  return {
    ...view,
    ownersToBefriend: viewerId === null ? [] : ownersToBefriend(db, viewerId, token),
    // Ids of people are for owners only: a visitor gets the owners' names in the view and no more.
    coOwners: viewerId !== null && view.viewerOwnsList && !view.deleted ? coOwnersOf(db, viewerId, token) : undefined,
    // Whose name they drew among the owners: the page says so, and that a tick here is anonymous.
    drewOwners: viewerId === null ? [] : drawnOwnersOf(db, viewerId, token),
  }
})
