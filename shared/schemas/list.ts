import { z } from 'zod'

// What the server sends about a list. The schemas are strict on purpose: the tests parse the
// owner's and the public's response with them, so an extra field about purchases fails.

export const ownerSchema = z.strictObject({
  username: z.string(),
  displayName: z.string(),
  listIntro: z.string().nullable(),
})

export const publicItemSchema = z.strictObject({
  id: z.number(),
  title: z.string(),
  description: z.string().nullable(),
  url: z.string().nullable(),
  image: z.string().nullable(),
  /** null means unlimited */
  quantity: z.number().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const buyerItemSchema = z.strictObject({
  ...publicItemSchema.shape,
  /** The owner deleted it after someone bought it. */
  removed: z.boolean(),
  bought: z.number(),
  purchases: z.array(z.strictObject({ name: z.string(), quantity: z.number(), mine: z.boolean() })),
  notes: z.array(z.strictObject({
    id: z.string(),
    author: z.string(),
    body: z.string(),
    createdAt: z.string(),
    mine: z.boolean(),
  })),
})

export type ListOwner = z.infer<typeof ownerSchema>
export type PublicItem = z.infer<typeof publicItemSchema>
export type BuyerItem = z.infer<typeof buyerItemSchema>

export type ListResponse
  = | { viewer: 'anon' | 'owner', owner: ListOwner, items: PublicItem[] }
    | { viewer: 'buyer', owner: ListOwner, items: BuyerItem[] }

export interface DirectoryEntry {
  username: string
  displayName: string
  wishes: number
}
