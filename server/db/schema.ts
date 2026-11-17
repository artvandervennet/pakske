import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

const createdAt = () => integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date())
const updatedAt = () => integer('updated_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date())

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email').notNull().unique(),
  username: text('username').notNull().unique(),
  displayName: text('display_name').notNull(),
  passwordHash: text('password_hash').notNull(),
  listIntro: text('list_intro'),
  createdAt: createdAt(),
})

export const items = sqliteTable('items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description'),
  url: text('url'),
  imageFile: text('image_file'),
  // NULL means unlimited.
  quantity: integer('quantity').default(1),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  // Items are never hard-deleted: buyers keep seeing a removed item they bought.
  deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
}, t => [
  index('items_user_deleted_idx').on(t.userId, t.deletedAt),
  check('items_quantity_check', sql`${t.quantity} IS NULL OR ${t.quantity} >= 1`),
])

export const purchases = sqliteTable('purchases', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  itemId: integer('item_id').notNull().references(() => items.id, { onDelete: 'cascade' }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  quantity: integer('quantity').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, t => [
  uniqueIndex('purchases_item_user_idx').on(t.itemId, t.userId),
  check('purchases_quantity_check', sql`${t.quantity} >= 1`),
])

export const notes = sqliteTable('notes', {
  // Random, not sequential: a gap in a sequence would tell an owner that notes were written
  // somewhere they can't look.
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  itemId: integer('item_id').notNull().references(() => items.id, { onDelete: 'cascade' }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  body: text('body').notNull(),
  createdAt: createdAt(),
}, t => [
  index('notes_item_idx').on(t.itemId),
])
