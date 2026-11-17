import type { ListResponse } from '../../shared/schemas/list'
import type { Db } from '../db/client'
import { listBuyerItems } from './buyer-list'
import { findOwner, listPublicItems } from './public-list'
import { resolveViewer } from './viewer'

/**
 * A list, as the person asking may see it. This is the one place that chooses between the
 * public view and the buyers' view; the page shows whatever comes back and nothing else.
 */
export function getList(db: Db, username: string, sessionUserId: number | null): ListResponse | undefined {
  const found = findOwner(db, username)
  if (!found) return undefined
  const { id: ownerId, ...owner } = found
  const viewer = resolveViewer(sessionUserId, ownerId)
  if (viewer === 'buyer') return { viewer, owner, items: listBuyerItems(db, ownerId, sessionUserId!) }
  return { viewer, owner, items: listPublicItems(db, ownerId) }
}
