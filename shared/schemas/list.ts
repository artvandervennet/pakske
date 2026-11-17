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
