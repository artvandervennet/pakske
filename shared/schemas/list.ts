import { z } from 'zod'
import type { SantaGroupRow } from './santa'

/** A list the person owns, as a row on the home page and the lists page. */
export interface OwnedList {
  token: string
  title: string
  /** Live wishes only. */
  wishes: number
  /** The display names of all the list's owners, the person included, in the order they joined. */
  owners: string[]
  /** The same without the person: who the row says the list is shared with. */
  sharedWith: string[]
}

/** A wish as everyone who can see the list gets it. Nothing about buyers is in here. */
export const publicWishSchema = z.strictObject({
  id: z.number().int(),
  title: z.string(),
  description: z.string().nullable(),
  /** The links, in the owner's order; empty when there are none. */
  urls: z.array(z.string()),
  /** `/uploads/<file>`, or null. */
  image: z.string().nullable(),
  /** The picture is the cover of the first link, which the server fetched, and not a photo the owner put up. */
  imageFromLink: z.boolean(),
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
    /** Null when the writer's account is deleted. */
    author: z.string().nullable(),
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
  /** Display names of the list's owners. Empty once the account of its only owner is deleted. */
  owners: string[]
  viewerOwnsList: boolean
  /** Only a logged-in non-owner ever gets a deleted list, with the removed wishes someone bought. */
  deleted: boolean
  /**
   * The list got a new link and this is what its old address still shows: only the wishes the
   * viewer was giving, each with their own purchase alone, to lower or take back.
   */
  old: boolean
  wishes: WishView[]
  /**
   * The list's owners as this viewer may ask them to be friends, with what was asked already.
   * Added by the route for someone logged in who doesn't own the list; nobody for anyone else.
   */
  ownersToBefriend?: { id: number, name: string, state: 'none' | 'asked' | 'friends' }[]
  /** For an owner: the other owners, in the order they joined, and whether this viewer may remove each. */
  coOwners?: { id: number, name: string, canRemove: boolean }[]
  /**
   * The list's owners whose name this viewer drew in a Secret Santa, by display name. Added by
   * the route for someone logged in; what they tick here is without their name unless they say
   * otherwise.
   */
  drewOwners?: string[]
}

/** A list someone else owns that is on this person's page: a friend shows it to them, or they opened its link. */
export interface OpenedList {
  token: string
  title: string
  /** Display names of the list's owners. */
  owners: string[]
  deleted: boolean
}

/** A list a friend shows this person, so it is on their Lists page without a link being sent. */
export interface ShownList {
  token: string
  title: string
  /** Display names of the list's owners. */
  owners: string[]
  /** Display names of the friends who show it, the first to do so first. */
  by: string[]
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
   * For a link to a list, when the person who opened it owns that list already and didn't make
   * the link: the list's token, which is theirs to know. The link is then how they find the
   * list again, and the page takes them there. Null for everyone else.
   */
  joined: string | null
  /**
   * The wishes it shares that are still on the list, in the list's order; empty unless it is
   * open. `owned` says the opener is an owner of that wish already.
   */
  wishes: { id: number, title: string, image: string | null, owned: boolean }[]
  /** The opener's own lists, to choose where the wishes go. */
  mine: MyLists
}

export type NoticeKind = 'wish_linked' | 'wish_unlinked' | 'joint_link_used' | 'list_joined' | 'list_relinked' | 'friend_accepted' | 'friend_link_used' | 'list_shown' | 'sent_copy' | 'sent_linked' | 'sent_list' | 'share_accepted' | 'list_removed' | 'santa_joined' | 'santa_joined_late' | 'santa_drawn' | 'santa_redrawn' | 'santa_removed'

/** A notice as its recipient gets it. Notices are about owners, lists and Secret Santa groups, never about buyers. */
export interface NoticeView {
  id: string
  kind: NoticeKind
  /** The display name of the person who did it, as it is now. */
  actor: string
  actorId: number
  /** Their profile picture, when they are a friend of the recipient: nobody else is shown one. */
  picture: string | null
  /** The wish's or list's title as it was when it happened. */
  title: string
  /** How many more wishes besides the one named. */
  more: number
  /** A live list of the recipient's that shows what the notice is about, or null. */
  token: string | null
  wishId: number | null
  /** For something a friend sent: the token of the page where the recipient says yes. */
  invite: string | null
  /** For a notice about a Secret Santa group: the group's token, while the recipient is in it. */
  santa: string | null
  canUndo: boolean
  /** Not seen yet. */
  fresh: boolean
  createdAt: string
}

/** Something of someone else's that the person ticked, as a row on the home page. */
export interface GivenWish {
  id: number
  title: string
  /** `/uploads/<file>`, or null. */
  image: string | null
  /** How many of it the person gives. */
  mine: number
  /** How many the wish asks for; null means unlimited. */
  quantity: number | null
  /** The list on the person's page that shows it, where they can change what they give. */
  token: string
  listTitle: string
  /** No longer on that list (taken off, deleted, or the list deleted): there for a while yet. */
  removed: boolean
}

/** What the person gives to the same people. */
export interface GivenGroup {
  /** Display names of who it is for. Empty when the list they are on has no owner any more. */
  names: string[]
  /** The one ticked last first. */
  wishes: GivenWish[]
}

/** How many lists of each kind the home page shows. The lists page has them all. */
export const HOME_LISTS = 5

/**
 * What the home page shows: the few lists of each kind the person had to do with last, how many
 * there are in all, everything the person gives, and the Secret Santa groups the person is in.
 */
export interface HomeView {
  /** The most recently opened or joined first. */
  owned: OwnedList[]
  ownedTotal: number
  /** Other people's lists: what friends show the person first, then what they opened, most recent first. */
  opened: OpenedList[]
  openedTotal: number
  /**
   * What the person ticked on other people's lists, per person it is for: the people they
   * ticked something for last first. Empty for someone who isn't logged in.
   */
  given: GivenGroup[]
  /** The one joined last first; empty for someone who isn't logged in. */
  santa: SantaGroupRow[]
}

/**
 * What the lists page shows: every list the person owns, and other people's lists as one row
 * (`opened`): the ones a friend shows them and the ones they opened, in the home page's order.
 * Nobody gets a list here that they don't own, weren't shown and never opened.
 */
export interface ListsView {
  owned: OwnedList[]
  opened: OpenedList[]
}
