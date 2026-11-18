import { sql } from 'drizzle-orm'
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

const createdAt = () => integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date())
const updatedAt = () => integer('updated_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date())
const addedAt = () => integer('added_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date())

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email').notNull().unique(),
  displayName: text('display_name').notNull(),
  // Null for an account made with Google that never set a password.
  passwordHash: text('password_hash'),
  // Google's id for the person ("sub"), once they log in with Google. Their email at Google can
  // change; this doesn't.
  googleSub: text('google_sub').unique(),
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

// Where a wish is shown. A wish taken off a list keeps its row, so buyers of that list can still
// find what they bought, and so bringing it back doesn't make a second one.
export const listWishes = sqliteTable('list_wishes', {
  listId: integer('list_id').notNull().references(() => lists.id, { onDelete: 'cascade' }),
  wishId: integer('wish_id').notNull().references(() => wishes.id, { onDelete: 'cascade' }),
  addedAt: addedAt(),
  // When the wish came to this list compared with its other lists: an owner may unlink only
  // those who joined after them.
  joinOrder: integer('join_order').notNull().default(0),
  // Null while the wish is on the list.
  removedAt: integer('removed_at', { mode: 'timestamp_ms' }),
  // Where the wish stands on this list; set by the list's owners. Lists show the lowest first.
  position: integer('position').notNull().default(0),
}, t => [
  primaryKey({ columns: [t.listId, t.wishId] }),
  index('list_wishes_wish_idx').on(t.wishId),
])

export const purchases = sqliteTable('purchases', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  wishId: integer('wish_id').notNull().references(() => wishes.id, { onDelete: 'cascade' }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  quantity: integer('quantity').notNull(),
  // The other buyers see "someone" instead of this buyer's name.
  anonymous: integer('anonymous', { mode: 'boolean' }).notNull().default(false),
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

// A link that works once: it makes whoever opens it an owner of some wishes, or of the whole list.
export const invites = sqliteTable('invites', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  token: text('token').notNull().unique(),
  kind: text('kind', { enum: ['wishes', 'list'] }).notNull(),
  listId: integer('list_id').notNull().references(() => lists.id, { onDelete: 'cascade' }),
  createdBy: integer('created_by').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: createdAt(),
  usedAt: integer('used_at', { mode: 'timestamp_ms' }),
})

export const inviteWishes = sqliteTable('invite_wishes', {
  inviteId: integer('invite_id').notNull().references(() => invites.id, { onDelete: 'cascade' }),
  wishId: integer('wish_id').notNull().references(() => wishes.id, { onDelete: 'cascade' }),
}, t => [
  primaryKey({ columns: [t.inviteId, t.wishId] }),
])

// Someone who made a wish of another person's theirs with "Linked". Kept while the earlier
// owners can still undo it.
export const wishLinks = sqliteTable('wish_links', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  wishId: integer('wish_id').notNull().references(() => wishes.id, { onDelete: 'cascade' }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: createdAt(),
}, t => [
  uniqueIndex('wish_links_wish_user_idx').on(t.wishId, t.userId),
])

// What a field held before the linker first changed it, so undo can put it back.
export const linkChanges = sqliteTable('link_changes', {
  linkId: integer('link_id').notNull().references(() => wishLinks.id, { onDelete: 'cascade' }),
  field: text('field').notNull(),
  // As JSON, so an empty field (null) and every type of value fit one column.
  before: text('before').notNull(),
}, t => [
  primaryKey({ columns: [t.linkId, t.field] }),
])

export const notices = sqliteTable('notices', {
  // Random, like note ids, so the numbers say nothing about notices for other people.
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  actorId: integer('actor_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  // The wish's or list's title as it was, so a later change doesn't rewrite what happened.
  title: text('title').notNull(),
  // How many more wishes the notice is about besides the one named.
  more: integer('more').notNull().default(0),
  wishId: integer('wish_id').references(() => wishes.id, { onDelete: 'cascade' }),
  listId: integer('list_id').references(() => lists.id, { onDelete: 'cascade' }),
  createdAt: createdAt(),
  seenAt: integer('seen_at', { mode: 'timestamp_ms' }),
}, t => [
  index('notices_user_idx').on(t.userId),
])
