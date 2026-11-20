import { sql } from 'drizzle-orm'
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

const createdAt = () => integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date())
const updatedAt = () => integer('updated_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date())
const addedAt = () => integer('added_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date())

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email').notNull().unique(),
  displayName: text('display_name').notNull(),
  // The account at Firebase Authentication, which holds the password and the Google login and
  // sends the emails. Null for an account from before Firebase that hasn't logged in since.
  firebaseUid: text('firebase_uid').unique(),
  // Only for an account from before Firebase: its password, until its first login moves it to
  // Firebase. Null after that, and for every newer account.
  passwordHash: text('password_hash'),
  // Google's id for the person ("sub") once Google is linked, so Settings can say so. Firebase
  // holds the link itself.
  googleSub: text('google_sub').unique(),
  // "Standaard anoniem" in Settings: a new purchase of theirs is without their name unless they say otherwise.
  anonymousDefault: integer('anonymous_default', { mode: 'boolean' }).notNull().default(false),
  // The profile picture they put up, a file under uploads/. Without one, the pages draw a study
  // in two paints from the account's id. Only friends are shown it.
  imageFile: text('image_file'),
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

// The addresses a list had before an owner gave it a new link. An old one no longer opens the
// list. It only still lets someone who was giving something from it lower that or take it back,
// so nobody is left with a tick they can't undo (`oldLinkView` in server/domain/list-view.ts).
export const listOldTokens = sqliteTable('list_old_tokens', {
  token: text('token').primaryKey(),
  listId: integer('list_id').notNull().references(() => lists.id, { onDelete: 'cascade' }),
  replacedAt: integer('replaced_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
}, t => [
  index('list_old_tokens_list_idx').on(t.listId),
])

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
  // The wish's links, in the order the owner put them; the first one may give the wish its picture.
  urls: text('urls', { mode: 'json' }).$type<string[]>(),
  imageFile: text('image_file'),
  // The picture is the cover of the first link, fetched by the server, not a photo the owner
  // uploaded. An uploaded photo replaces it; a new first link replaces only a cover.
  imageFromLink: integer('image_from_link', { mode: 'boolean' }).notNull().default(false),
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
  // Set when the owner who took it off said that whoever bought it shouldn't keep seeing it
  // here. Null: they do, for a while (shared/utils/kept-for-buyers.ts).
  clearedAt: integer('cleared_at', { mode: 'timestamp_ms' }),
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
  // Null once the writer's account is deleted: the note stays for the other buyers, without a name.
  userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
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

// A link that shares some wishes, or the whole list. "linked" makes whoever opens it an owner
// and works once. "copy" (wishes only) gives them copies of their own, and works for every
// account once until it expires.
export const invites = sqliteTable('invites', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  token: text('token').notNull().unique(),
  kind: text('kind', { enum: ['wishes', 'list'] }).notNull(),
  listId: integer('list_id').notNull().references(() => lists.id, { onDelete: 'cascade' }),
  createdBy: integer('created_by').notNull().references(() => users.id, { onDelete: 'cascade' }),
  mode: text('mode', { enum: ['linked', 'copy'] }).notNull().default('linked'),
  createdAt: createdAt(),
  // Linked: when it was used, after which it is spent.
  usedAt: integer('used_at', { mode: 'timestamp_ms' }),
  // Copy: until when it can be used. Null for a linked link, which doesn't expire.
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
  // Set when it was sent to a friend instead of made as an address to pass on: it then works
  // for that one person only, who finds it in a notice.
  sentTo: integer('sent_to').references(() => users.id, { onDelete: 'cascade' }),
  // When the friend it was sent to closed the notice about it, for an invitation to a list:
  // the row stays, and gives nothing, so its sender can't see the friend said no.
  declinedAt: integer('declined_at', { mode: 'timestamp_ms' }),
}, t => [
  index('invites_sent_to_idx').on(t.sentTo),
])

// Who used a copy link, so one account takes the copies once.
export const inviteUses = sqliteTable('invite_uses', {
  inviteId: integer('invite_id').notNull().references(() => invites.id, { onDelete: 'cascade' }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  usedAt: integer('used_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
}, t => [
  primaryKey({ columns: [t.inviteId, t.userId] }),
])

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

// Two people who are friends: one row for the pair, the lower id first. Being friends shows
// nothing by itself; each of them chooses which lists the other finds (see `list_friends`).
export const friendships = sqliteTable('friendships', {
  userLow: integer('user_low').notNull().references(() => users.id, { onDelete: 'cascade' }),
  userHigh: integer('user_high').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: createdAt(),
}, t => [
  primaryKey({ columns: [t.userLow, t.userHigh] }),
  index('friendships_high_idx').on(t.userHigh),
  check('friendships_order_check', sql`${t.userLow} < ${t.userHigh}`),
])

// Someone asked to be friends, from a list of the receiver's that they could open. A declined
// request stays, so the sender can't tell it from a waiting one and can't ask again; `hidden`
// is a declined one its sender took off their own page.
export const friendRequests = sqliteTable('friend_requests', {
  // Random, like note ids: the numbers say nothing about other people's requests.
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  fromUser: integer('from_user').notNull().references(() => users.id, { onDelete: 'cascade' }),
  toUser: integer('to_user').notNull().references(() => users.id, { onDelete: 'cascade' }),
  // The list it was sent from, so the receiver can place the sender.
  listId: integer('list_id').references(() => lists.id, { onDelete: 'set null' }),
  status: text('status', { enum: ['pending', 'declined'] }).notNull().default('pending'),
  hidden: integer('hidden', { mode: 'boolean' }).notNull().default(false),
  createdAt: createdAt(),
  seenAt: integer('seen_at', { mode: 'timestamp_ms' }),
}, t => [
  uniqueIndex('friend_requests_pair_idx').on(t.fromUser, t.toUser),
  index('friend_requests_to_idx').on(t.toUser),
])

// A link that makes whoever opens it a friend of its maker. It works once and for 30 days, and
// has a token of its own, made like a list's.
export const friendLinks = sqliteTable('friend_links', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  token: text('token').notNull().unique(),
  createdBy: integer('created_by').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: createdAt(),
  usedAt: integer('used_at', { mode: 'timestamp_ms' }),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
}, t => [
  index('friend_links_maker_idx').on(t.createdBy),
])

// An owner shows one of their lists to a friend: it is then on that friend's Lists page without
// a link being sent. It is not a key: the list opens for anyone who has its link, tick or no
// tick. Each owner of a joint list ticks their own friends, so the owner is part of the key.
// `hiddenAt` is the friend taking the list off their own page; the owner isn't told.
export const listFriends = sqliteTable('list_friends', {
  listId: integer('list_id').notNull().references(() => lists.id, { onDelete: 'cascade' }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  shownBy: integer('shown_by').notNull().references(() => users.id, { onDelete: 'cascade' }),
  addedAt: addedAt(),
  hiddenAt: integer('hidden_at', { mode: 'timestamp_ms' }),
}, t => [
  primaryKey({ columns: [t.listId, t.userId, t.shownBy] }),
  index('list_friends_user_idx').on(t.userId),
])

// A Secret Santa: a group of people who each draw one other member to give something to. The
// token is its address and its invitation, made like a list's: whoever opens it while logged in
// can join until the names are drawn. Whoever joined first runs it (`organiserOf` in
// server/domain/santa.ts), so a group never depends on an account that is gone.
export const santaGroups = sqliteTable('santa_groups', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  token: text('token').notNull().unique(),
  title: text('title').notNull(),
  createdAt: createdAt(),
  // Null until the names are drawn; the last time, when they were drawn again for a latecomer.
  drawnAt: integer('drawn_at', { mode: 'timestamp_ms' }),
})

export const santaMembers = sqliteTable('santa_members', {
  groupId: integer('group_id').notNull().references(() => santaGroups.id, { onDelete: 'cascade' }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  // The list of their own they put in, for whoever draws them. Null when they chose none.
  listId: integer('list_id').references(() => lists.id, { onDelete: 'set null' }),
  // Whose name they drew. The name is only ever read for the member themselves: nobody else is
  // told, the organiser included. Null until the draw, after it for someone who joined later,
  // and for everyone once someone with a name left: the names are then drawn again.
  givesTo: integer('gives_to').references(() => users.id, { onDelete: 'set null' }),
  joinedAt: integer('joined_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
}, t => [
  primaryKey({ columns: [t.groupId, t.userId] }),
  index('santa_members_user_idx').on(t.userId),
])

// What someone who opened a list writes to its owners, and what the owners answer: one
// conversation per person and list. The owners read it without a name. They are sent the
// conversation's random id and its words, never `userId` (server/domain/messages.ts).
export const listThreads = sqliteTable('list_threads', {
  // Random, like note ids: the only handle an owner gets on who wrote says nothing about them.
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  listId: integer('list_id').notNull().references(() => lists.id, { onDelete: 'cascade' }),
  // Who wrote to the owners. Null once that account is deleted: the conversation stays, so an
  // owner can't tell from one that went which account it belonged to.
  userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
}, t => [
  uniqueIndex('list_threads_list_user_idx').on(t.listId, t.userId),
])

export const listMessages = sqliteTable('list_messages', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  threadId: text('thread_id').notNull().references(() => listThreads.id, { onDelete: 'cascade' }),
  // An owner's answer, which carries their name. Otherwise it is from the person the
  // conversation is with, who is never named.
  fromOwner: integer('from_owner', { mode: 'boolean' }).notNull(),
  // Who wrote it. Null once that account is deleted: the message stays.
  userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
  body: text('body').notNull(),
  createdAt: createdAt(),
}, t => [
  index('list_messages_thread_idx').on(t.threadId),
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
  // What a friend sent, for a notice that says so: the notice goes when that does.
  inviteId: integer('invite_id').references(() => invites.id, { onDelete: 'cascade' }),
  // The Secret Santa group a notice is about: the notice goes when the group does.
  santaGroupId: integer('santa_group_id').references(() => santaGroups.id, { onDelete: 'cascade' }),
  createdAt: createdAt(),
  seenAt: integer('seen_at', { mode: 'timestamp_ms' }),
}, t => [
  index('notices_user_idx').on(t.userId),
])
