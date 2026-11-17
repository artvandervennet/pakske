import { sql } from 'drizzle-orm'
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

const createdAt = () => integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date())
const updatedAt = () => integer('updated_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date())
const addedAt = () => integer('added_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date())

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email').notNull().unique(),
  displayName: text('display_name').notNull(),
  passwordHash: text('password_hash').notNull(),
  createdAt: createdAt(),
})

export const lists = sqliteTable('lists', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  // The link is the access: random and unguessable, never derived from the id.
  token: text('token').notNull().unique(),
  title: text('title').notNull(),
  createdAt: createdAt(),
  deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
})

export const listOwners = sqliteTable('list_owners', {
  listId: integer('list_id').notNull().references(() => lists.id, { onDelete: 'cascade' }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  addedAt: addedAt(),
}, t => [
  primaryKey({ columns: [t.listId, t.userId] }),
  index('list_owners_user_idx').on(t.userId),
])

export const wishes = sqliteTable('wishes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  description: text('description'),
  url: text('url'),
  imageFile: text('image_file'),
  // NULL means unlimited.
  quantity: integer('quantity').default(1),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  // Wishes are never hard-deleted: buyers keep seeing a removed wish they bought.
  deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
}, t => [
  check('wishes_quantity_check', sql`${t.quantity} IS NULL OR ${t.quantity} >= 1`),
])

// Who a wish belongs to. Decided per wish, so the role of a person never depends on the list they came through.
export const wishOwners = sqliteTable('wish_owners', {
  wishId: integer('wish_id').notNull().references(() => wishes.id, { onDelete: 'cascade' }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  addedAt: addedAt(),
}, t => [
  primaryKey({ columns: [t.wishId, t.userId] }),
  index('wish_owners_user_idx').on(t.userId),
])

export const listWishes = sqliteTable('list_wishes', {
  listId: integer('list_id').notNull().references(() => lists.id, { onDelete: 'cascade' }),
  wishId: integer('wish_id').notNull().references(() => wishes.id, { onDelete: 'cascade' }),
  addedAt: addedAt(),
}, t => [
  primaryKey({ columns: [t.listId, t.wishId] }),
  index('list_wishes_wish_idx').on(t.wishId),
])

export const purchases = sqliteTable('purchases', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  wishId: integer('wish_id').notNull().references(() => wishes.id, { onDelete: 'cascade' }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  quantity: integer('quantity').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, t => [
  uniqueIndex('purchases_wish_user_idx').on(t.wishId, t.userId),
  check('purchases_quantity_check', sql`${t.quantity} >= 1`),
])

export const notes = sqliteTable('notes', {
  // Random, not sequential: a gap in a sequence would tell an owner that notes were written
  // somewhere they can't look.
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  wishId: integer('wish_id').notNull().references(() => wishes.id, { onDelete: 'cascade' }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  body: text('body').notNull(),
  createdAt: createdAt(),
}, t => [
  index('notes_wish_idx').on(t.wishId),
])

export const listVisits = sqliteTable('list_visits', {
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  listId: integer('list_id').notNull().references(() => lists.id, { onDelete: 'cascade' }),
  openedAt: integer('opened_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
}, t => [
  primaryKey({ columns: [t.userId, t.listId] }),
])
