import { z } from 'zod'

/** One row on a person's home page: a list they own. */
export interface HomeList {
  token: string
  title: string
  /** Live wishes only. */
  wishes: number
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

/** For a visitor who isn't logged in: the wish only. */
export const anonWishSchema = z.strictObject({
  ...publicWishSchema.shape,
  role: z.literal('anon'),
})

/** For an owner of the wish: the wish and their own purchase, nothing about anyone else. */
export const ownerWishSchema = z.strictObject({
  ...publicWishSchema.shape,
  role: z.literal('owner'),
  /** What the viewer bought themselves, 0 when nothing. */
  mine: z.number().int(),
})

/** For a logged-in visitor who doesn't own the wish: every purchase and the notes. */
export const buyerWishSchema = z.strictObject({
  ...publicWishSchema.shape,
  role: z.literal('buyer'),
  /** The owner deleted it, or the list, after someone bought it. */
  removed: z.boolean(),
  bought: z.number().int(),
  mine: z.number().int(),
  purchases: z.array(z.strictObject({
    name: z.string(),
    quantity: z.number().int(),
    mine: z.boolean(),
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
