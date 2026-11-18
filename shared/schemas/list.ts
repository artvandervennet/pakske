import { z } from 'zod'

/** One row on a person's home page: a list they own. */
export interface HomeList {
  token: string
  title: string
  /** Live wishes only. */
  wishes: number
  /** The display names of the list's other owners, in the order they joined. */
  sharedWith: string[]
}

/** A wish as everyone who can see the list gets it. Nothing about buyers is in here. */
export const publicWishSchema = z.strictObject({
  id: z.number().int(),
  title: z.string(),
  description: z.string().nullable(),
  url: z.string().nullable(),
  /** `/uploads/<file>`, or null. */
  image: z.string().nullable(),
  /** null means unlimited. */
  quantity: z.number().int().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type PublicWish = z.infer<typeof publicWishSchema>

// What one viewer gets for a wish. The role is decided per wish, so one list can mix them. Each
// shape is strict, so a field that belongs to another role fails to parse.

/**
 * Who else the wish belongs to, for every role: the owners who don't own this list (the list
 * already names its own), never the viewer, the earliest first.
 */
const sharedWith = z.array(z.string())

/** For a visitor who isn't logged in: the wish only. */
export const anonWishSchema = z.strictObject({
  ...publicWishSchema.shape,
  role: z.literal('anon'),
  sharedWith,
})

/** For an owner of the wish: the wish and their own purchase, nothing about anyone else. */
export const ownerWishSchema = z.strictObject({
  ...publicWishSchema.shape,
  role: z.literal('owner'),
  /** What the viewer bought themselves, 0 when nothing. */
  mine: z.number().int(),
  sharedWith,
  /** Every other owner, the earliest first, by id so two people with one name stay apart. */
  coOwners: z.array(z.strictObject({
    id: z.number().int(),
    name: z.string(),
    /** Whether the viewer may unlink them: they came to the wish after the viewer did. */
    canUnlink: z.boolean(),
  })),
  /** Another list shows the wish too, so taking it off this one doesn't delete it. */
  alsoElsewhere: z.boolean(),
})

/** For a logged-in visitor who doesn't own the wish: every purchase and the notes. */
export const buyerWishSchema = z.strictObject({
  ...publicWishSchema.shape,
  role: z.literal('buyer'),
  sharedWith,
  /** No longer on this list (taken off, deleted, or the list deleted), and someone has bought it. */
  removed: z.boolean(),
  bought: z.number().int(),
  mine: z.number().int(),
  purchases: z.array(z.strictObject({
    /** Null for someone else who stays anonymous. */
    name: z.string().nullable(),
    quantity: z.number().int(),
    mine: z.boolean(),
    anonymous: z.boolean(),
  })),
  notes: z.array(z.strictObject({
    id: z.string(),
    author: z.string(),
    body: z.string(),
    createdAt: z.string(),
    mine: z.boolean(),
  })),
})

export type AnonWish = z.infer<typeof anonWishSchema>
export type OwnerWish = z.infer<typeof ownerWishSchema>
export type BuyerWish = z.infer<typeof buyerWishSchema>
export type WishView = AnonWish | OwnerWish | BuyerWish

/** A list as one viewer gets it. The page shows this and nothing else. */
export interface ListView {
  token: string
  title: string
  /** Display names of the list's owners. */
  owners: string[]
  viewerOwnsList: boolean
  /** Only a logged-in non-owner ever gets a deleted list, with the removed wishes someone bought. */
  deleted: boolean
  wishes: WishView[]
}

/** A list someone else owns that this person opened before. */
export interface OpenedList {
  token: string
  title: string
  /** Display names of the list's owners. */
  owners: string[]
  deleted: boolean
}

/** The person's own lists, for choosing where a wish lands. */
export interface MyLists {
  /** Oldest first. */
  lists: { token: string, title: string }[]
  /** The list a wish was most recently put on, or null. */
  last: string | null
}

/**
 * A link that shares wishes or a list, as the person who opened it gets it. It never holds the
 * token of the list it came from, so the link can't be used to reach that list later.
 */
export interface InviteView {
  kind: 'wishes' | 'list'
  /**
   * `linked`: whoever opens it becomes an owner, and it works once. `copy`: they get copies of
   * their own, and it works once per account until it expires. A link to a list is always linked.
   */
  mode: 'linked' | 'copy'
  /**
   * `closed` once nobody can use it any more, `expired` for a copy link past its time, `own` for
   * the person who made it, `used` for someone who took its copies already.
   */
  state: 'open' | 'closed' | 'expired' | 'own' | 'used'
  /** The display name of the person who made it. */
  from: string
  /** The opener made it themselves: a closed link then says to make a new one, not to ask for one. */
  yours: boolean
  listTitle: string
  /**
   * The wishes it shares that are still on the list, in the list's order; empty unless it is
   * open. `owned` says the opener is an owner of that wish already.
   */
  wishes: { id: number, title: string, image: string | null, owned: boolean }[]
  /** The opener's own lists, to choose where the wishes go. */
  mine: MyLists
}

export type NoticeKind = 'wish_linked' | 'wish_unlinked' | 'joint_link_used' | 'list_joined'

/** A notice as its recipient gets it. Notices are about owners and lists, never about buyers. */
export interface NoticeView {
  id: string
  kind: NoticeKind
  /** The display name of the person who did it, as it is now. */
  actor: string
  actorId: number
  /** The wish's or list's title as it was when it happened. */
  title: string
  /** How many more wishes besides the one named. */
  more: number
  /** A live list of the recipient's that shows what the notice is about, or null. */
  token: string | null
  wishId: number | null
  canUndo: boolean
  /** Not seen yet. */
  fresh: boolean
  createdAt: string
}

/** What the home page shows: the lists a person owns, the ones they opened, and their notices. */
export interface HomeView {
  owned: HomeList[]
  opened: OpenedList[]
  /** Newest first; empty when logged out. */
  notices: NoticeView[]
}
