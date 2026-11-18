# Private lists, step one: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace "one public list per account" with private lists reached by link, several per account, remembered once opened, shown as a checklist with quick add, in-place editing and ticking, including an owner ticking their own wish after a spoiler warning.

**Architecture:** The data model is replaced (nothing is live): lists with owners, wishes with owners, and a table saying which wish is shown on which list. Rules stay plain functions in `server/domain/` that take a database; `getListView` builds, per wish, exactly what the viewer may see, and the page renders that. Every wish request goes through a list token.

**Tech Stack:** Nuxt 4.6, Vue 3.5, Drizzle 0.45 + better-sqlite3, nuxt-auth-utils 0.6, @nuxtjs/i18n 10, zod 4, Vitest 5, Gesso 1.2.5.

**Spec:** `docs/superpowers/specs/2026-11-17-private-lists-and-joint-wishes-design.md`. This plan covers step one only. Joint wishes, joint lists, "add to my list" and notices are step two and are not built here.

## Global Constraints

- An owner of a wish sees the wish and **their own** purchase, nothing about anyone else's, and no notes. A logged-out visitor sees the wish only. A logged-in non-owner sees every purchase with name and number, and the notes.
- The role is decided **per wish** (`wish_owners`), never per list, even though in step one a wish's owners are its list's owners.
- Every request about a wish names a list token, and the wish must be shown on that list. A wish id alone gives no access.
- Deleting a wish or a list, and lowering an amount, always answer the same way whatever buyers did. Purchases and notes never change a wish's `updatedAt` or its order. Note ids are random; a note that isn't yours is "not found".
- List tokens are random, at least 96 bits, URL-safe. This plan uses 128 bits.
- A refusal to an owner's tick gives no names and no numbers.
- The warning text, exactly: "You might find out that someone already got this. Continue?" Refusals: "Someone already has this" and "There aren't that many left".
- Adding a wish needs only a title; the amount defaults to one.
- Every new string exists in `i18n/locales/nl.json` and `en.json`. Words people act on are plain, sentence case; errors say what to do.
- Everything visual uses Gesso tokens and components. New styles go in `app/assets/css/app.css`, marked "candidate for Gesso".
- Keep: rate limits, origin check, body size limits, `Cache-Control: private, no-store`, the session watcher, noindex, `test/api-check.sh` as the HTTP check.
- Server routes use the h3 v1 auto-imports and the helpers in `server/utils/http.ts` (`fail`, `domain`, `readInput`, `idParam`, `requireUser`, `sessionUserId`).
- Run `pnpm test` after every task; it must be clean. `pnpm typecheck` must be clean from Task 8 on (Tasks 1 to 7 leave the first version's pages in place, and they no longer compile).
- Commits: the repository has no commits yet. Before Task 1, commit the current tree as "First version" with Art's go-ahead; then one commit per task. Message format: an imperative sentence.

## Review Focus

Inputs the spec implies but doesn't spell out, most likely first. Each has a test in the task named.

1. **The remembered-lists cookie holds junk**: a tampered value, a token of a list that no longer exists, more than 50 entries. The home page still renders and skips what it can't resolve. (Task 6)
2. **Enter pressed twice, an empty or all-spaces title, Enter while composing with an IME** in the + line. No empty wish, no duplicate. (Task 9)
3. **A wish changed elsewhere**: ticked in one tab after it was deleted in another, or the last one taken meanwhile. The row shows a message and the list refreshes; it doesn't keep stale numbers. (Tasks 4 and 10)
4. **An address with an anchor to a wish that is gone**, or a list token that is well-formed but unknown. The list opens without the row, or the not-found page shows; no error. (Tasks 7 and 9)
5. **A long list and long words**: 200 wishes, a title of 120 characters without spaces. Rows wrap, nothing scrolls sideways at 400 px, the + line is reachable. (Task 9)

---

### Task 1: New schema, accounts without usernames

**Files:**
- Rewrite: `server/db/schema.ts`
- Delete and regenerate: `server/db/migrations/` (run `pnpm db:generate` after deleting the folder)
- Modify: `server/domain/users.ts`, `server/domain/errors.ts`, `shared/schemas/input.ts`, `shared/types/auth.d.ts`
- Delete: `server/domain/items.ts`, `list.ts`, `public-list.ts`, `buyer-list.ts`, `viewer.ts`, and `test/items.test.ts`, `test/visibility.test.ts`, `test/purchases.test.ts`, `test/notes.test.ts` (later tasks write their replacements)
- Test: `test/users.test.ts`, `test/input.test.ts`, `test/helpers.ts`

**Interfaces:**
- Produces: tables `users(id, email, displayName, passwordHash, createdAt)`, `lists(id, token unique, title, createdAt, deletedAt)`, `listOwners(listId, userId, addedAt)` PK both, `wishes(id, title, description, url, imageFile, quantity default 1 null=unlimited, createdAt, updatedAt, deletedAt)` with the quantity check, `wishOwners(wishId, userId, addedAt)` PK both, `listWishes(listId, wishId, addedAt)` PK both, `purchases(id, wishId, userId, quantity ≥ 1, createdAt, updatedAt)` unique `(wishId, userId)`, `notes(id uuid text, wishId, userId, body, createdAt)`, `listVisits(userId, listId, openedAt)` PK both. All foreign keys cascade.
- Produces: `createUser(db, input: { email: string, displayName: string, passwordHash: string }, options?: { maxUsers?: number })`, `findUserByEmail`, `findUserById`, `updateDisplayName(db, userId: number, displayName: string): void`, `setPasswordHash`.
- Produces: `DomainErrorCode` = `'not_found' | 'forbidden' | 'validation' | 'email_taken' | 'registration_closed' | 'list_limit' | 'wish_limit' | 'quantity_exceeded' | 'wish_removed'`.
- Produces in `shared/schemas/input.ts`: `registerInput` (`email`, `displayName`, `password`), `loginInput`, `profileInput` (`displayName`), `passwordInput`, `listInput` (`title`: required, max 80), `wishInput` (`title` required max 120; `description`, `url`, `quantity` as today's `itemInput`, but `description` and `url` default to `null` and `quantity` defaults to `1` when absent), `purchaseInput`, `noteInput`, `fieldErrors`, and the types `WishInput` and `RegisterInput`. `USERNAME_PATTERN` and `itemInput` are removed.
- Produces in `test/helpers.ts`: `makeDb()`, `addUser(db, name: string)` (email `<name>@example.test`, display name capitalised), `codeOf(fn)`.
- Session user type becomes `{ id: number, displayName: string }`.

- [ ] **Step 1: Update the tests first.** In `test/users.test.ts` drop the username and reserved-name cases and keep: stores and finds by email; refuses a duplicate email (`email_taken`); closes at `maxUsers` (`registration_closed`); `updateDisplayName` changes the name. In `test/input.test.ts` replace the wish cases with:

```ts
it('needs only a title, and fills in the rest', () => {
  expect(wishInput.parse({ title: '  Boek ' })).toEqual({ title: 'Boek', description: null, url: null, quantity: 1 })
})
it('keeps null as "no limit"', () => {
  expect(wishInput.parse({ title: 'Puzzels', quantity: null }).quantity).toBeNull()
})
it('names a list', () => {
  expect(fieldErrors(listInput.safeParse({ title: '   ' }).error!)).toEqual({ title: 'required' })
})
```

Keep the existing URL, amount and registration cases, without `username`.

- [ ] **Step 2: Run `pnpm test`.** Expected: FAIL, `listInput` and `wishInput` are not exported.
- [ ] **Step 3: Rewrite the schema, regenerate the migration, change `users.ts`, `errors.ts`, `input.ts`, `auth.d.ts`, `helpers.ts`; delete the files listed.** `server/utils/http.ts` gets the new status map: `list_limit` and `wish_limit` 409, `wish_removed` 409, the rest as now.
- [ ] **Step 4: Run `pnpm test`.** Expected: PASS for `users`, `input`, `safety`.
- [ ] **Step 5: Commit** "Replace the data model with lists, wishes and owners".

---

### Task 2: Lists

**Files:**
- Create: `server/domain/tokens.ts`, `server/domain/lists.ts`
- Test: `test/lists.test.ts`

**Interfaces:**
- Consumes: Task 1 schema and helpers.
- Produces: `newListToken(): string` (16 random bytes as base64url, 22 characters), `LIST_TOKEN: RegExp` = `/^[A-Za-z0-9_-]{22}$/`.
- Produces: `createList(db, userId: number, title: string): { token: string, title: string }` (`list_limit` at 50 live lists per person); `renameList(db, userId, token: string, title: string): void`; `deleteList(db, userId, token): void`; `listOwnedLists(db, userId): HomeList[]`; `ownedListId(db, userId, token): number` (throws `not_found` unless the list is live and `userId` owns it; used by Task 3).
- Produces in `shared/schemas/list.ts`: `interface HomeList { token: string, title: string, wishes: number }`.
- Adds to `test/helpers.ts`: `addList(db, userId, title = 'Kerst')` returning the token.

- [ ] **Step 1: Write `test/lists.test.ts`:**

```ts
it('makes a list with an address nobody chose', () => {
  const { token, title } = createList(db, art.id, 'Kerst')
  expect(title).toBe('Kerst')
  expect(token).toMatch(LIST_TOKEN)
  expect(createList(db, art.id, 'Kerst').token).not.toBe(token)
})
it('shows a person their own lists, oldest first, with how many wishes each has', ...)   // [{ token, title: 'Kerst', wishes: 0 }, …], none of mom's
it('renames a list and keeps its address', ...)
it('does not let someone else rename or delete it', ...)                                  // both 'not_found'
it('takes a deleted list off the owner\'s lists, and a second delete finds nothing', ...) // [] then 'not_found'
it('refuses a 51st list', ...)                                                            // 'list_limit'
```

- [ ] **Step 2: Run `pnpm test test/lists.test.ts`.** Expected: FAIL, module not found.
- [ ] **Step 3: Implement `tokens.ts` and `lists.ts`.** `deleteList` sets `lists.deletedAt` and, in the same transaction, `wishes.deletedAt` for every live wish shown on it. `listOwnedLists` counts live wishes only.
- [ ] **Step 4: Run `pnpm test`.** Expected: PASS.
- [ ] **Step 5: Commit** "Add lists with made-up addresses".

---

### Task 3: Wishes on a list

**Files:**
- Create: `server/domain/wishes.ts`, `server/domain/public-wishes.ts`
- Test: `test/wishes.test.ts`

**Interfaces:**
- Consumes: `ownedListId` (Task 2), `wishInput` (Task 1).
- Produces in `shared/schemas/list.ts`: `publicWishSchema` = strict `{ id, title, description, url, image, quantity, createdAt, updatedAt }` (`image` is `/uploads/<file>` or null, timestamps ISO strings), `type PublicWish`.
- Produces in `public-wishes.ts`: `toPublicWish(row): PublicWish`; `livePublicWishes(db, listId: number): PublicWish[]` (oldest first). This file must not mention purchases or notes.
- Produces in `wishes.ts`: `addWish(db, userId, token, input: WishInput): PublicWish`; `updateWish(db, userId, token, wishId: number, input: WishInput): PublicWish`; `deleteWish(db, userId, token, wishId): void`; `setWishImage(db, userId, token, wishId, imageFile: string | null): { previous: string | null }`. All throw `not_found` unless the list is live, `userId` owns it, and the wish is live and shown on it. `addWish` throws `wish_limit` at 200 live wishes on the list or 500 ever.
- Adds to `test/helpers.ts`: `addWishTo(db, userId, token, title, quantity: number | null = 1)`.

- [ ] **Step 1: Write `test/wishes.test.ts`:** adds a wish from a title alone (`quantity: 1`, `description: null`, `url: null`, `image: null`); the owner of the new wish is the list's owner (`wishOwners` has one row for `art.id`); changes a wish; someone else gets `not_found` for update, delete and image; a wish can't be reached through another list's token, even one the same person owns (`not_found`); delete removes it from `livePublicWishes` and a second delete is `not_found`; image set, replaced and cleared report `previous`; the 201st live wish is `wish_limit`. Plus:

```ts
it.each(['server/domain/public-wishes.ts', 'server/domain/wishes.ts'])('%s never touches purchases or notes', (file) => {
  expect(readFileSync(file, 'utf8')).not.toMatch(/purchases|notes/i)
})
```

- [ ] **Step 2: Run it.** Expected: FAIL, module not found.
- [ ] **Step 3: Implement.** `addWish` inserts the wish, one `wishOwners` row per owner of the list, and the `listWishes` row, in one immediate transaction.
- [ ] **Step 4: Run `pnpm test`.** Expected: PASS.
- [ ] **Step 5: Commit** "Add wishes that belong to a list's owners".

---

### Task 4: Buying, including your own wish, and notes

**Files:**
- Rewrite: `server/domain/purchases.ts`, `server/domain/notes.ts`
- Test: `test/purchases.test.ts`, `test/notes.test.ts`

**Interfaces:**
- Consumes: schema, `addWishTo`, `addList`.
- Produces: `setPurchase(db, token: string, wishId: number, userId: number, quantity: number): void`; `removePurchase(db, token, wishId, userId): void`; `addNote(db, token, wishId, userId, body: string): { id: string }`; `deleteNote(db, noteId: string, userId): void`.
- Adds to `test/helpers.ts`: `purchaseRows(db, wishId: number): { userId: number, quantity: number }[]`, read straight from the table.
- Rules: `not_found` when the list doesn't exist or the wish isn't shown on it. A deleted list or wish still accepts lowering and removing. An increase is refused with `wish_removed` on a deleted wish or list, and with `quantity_exceeded` when everyone else's purchases plus the new number exceed the amount. **Owners may buy their own wish**; the same checks apply and the same codes come back. Owners may not write notes (`forbidden`). `deleteNote` is `not_found` for anyone but the author.

- [ ] **Step 1: Write `test/purchases.test.ts`.** Carry over the first version's cases with the new signatures (adds up; refuses more than asked; no ceiling without a limit; replaces instead of adding; counts only others when changing; removes; lowering works after the owner lowered the amount; on a deleted wish only lowering works; amounts below 1 and fractions are `validation`). Replace the "owner is forbidden" case with:

```ts
describe('an owner ticking their own wish', () => {
  it('records it like any purchase when the wish is free', () => {
    setPurchase(db, token, wish.id, art.id, 1)
    expect(purchaseRows(db, wish.id)).toEqual([{ userId: art.id, quantity: 1 }])
  })
  it('is refused, with the same code a buyer gets, when someone already has it', () => {
    setPurchase(db, token, wish.id, mom.id, 1)
    expect(codeOf(() => setPurchase(db, token, wish.id, art.id, 1))).toBe('quantity_exceeded')
  })
  it('can always be undone', () => { ... removePurchase leaves no row for art ... })
})
it('finds nothing through a list that does not show the wish', () => {
  const other = addList(db, art.id, 'Verjaardag')
  expect(codeOf(() => setPurchase(db, other, wish.id, mom.id, 1))).toBe('not_found')
})
it('finds nothing for a wish that was deleted and never bought, also when lowering', ...)   // Review Focus 3
```

In `test/notes.test.ts`: a buyer's note is stored; an owner is `forbidden`; a wish not on that list is `not_found`; the author deletes; anyone else, and an unknown id, get `not_found`.

- [ ] **Step 2: Run both.** Expected: FAIL.
- [ ] **Step 3: Implement.** Keep the one synchronous `db.transaction(..., { behavior: 'immediate' })` with no `await` inside.
- [ ] **Step 4: Run `pnpm test`.** Expected: PASS.
- [ ] **Step 5: Commit** "Let owners tick their own wishes; route buying and notes through a list".

---

### Task 5: What each viewer gets

**Files:**
- Create: `server/domain/list-view.ts`
- Modify: `shared/schemas/list.ts`
- Test: `test/visibility.test.ts`

**Interfaces:**
- Consumes: `livePublicWishes`, `toPublicWish`, the purchase and note functions.
- Produces in `shared/schemas/list.ts`: `anonWishSchema` = public + `{ role: 'anon' }`; `ownerWishSchema` = public + `{ role: 'owner', mine: number }`; `buyerWishSchema` = public + `{ role: 'buyer', removed: boolean, bought: number, mine: number, purchases: { name, quantity, mine }[], notes: { id, author, body, createdAt, mine }[] }`; all strict; `type WishView` their union; `interface ListView { token: string, title: string, owners: string[], viewerOwnsList: boolean, deleted: boolean, wishes: WishView[] }`.
- Produces: `getListView(db, token: string, viewerId: number | null): ListView | undefined`.
- Rules: role per wish: no viewer is `anon`; a viewer in the wish's owners is `owner`; anyone else is `buyer`. `mine` is the viewer's own purchase, 0 when none. A deleted wish appears only as a `buyer` wish with `removed: true`, and only while it has a purchase. A deleted list is `undefined` for its owners and for logged-out visitors; a logged-in non-owner gets `deleted: true` with the removed wishes someone bought. An unknown token is `undefined`. Wishes are ordered by `createdAt` then id, for everyone.

- [ ] **Step 1: Write `test/visibility.test.ts`.** Build `world(buyersActive: boolean)` as in the first version (fake timers, same clock): Art's list with four wishes; with buyers active, mom and sis buy and write notes on three of them; afterwards, in both worlds, Art lowers one amount and deletes one wish. Tests:

```ts
it('gives the owner and a logged-out visitor exactly the same list whether or not anyone bought or wrote', () => {
  expect(getListView(busy.db, busy.token, busy.art.id)).toEqual(getListView(quiet.db, quiet.token, quiet.art.id))
  expect(getListView(busy.db, busy.token, null)).toEqual(getListView(quiet.db, quiet.token, null))
})
it('gives them wishes with no field about other people', ...)       // every wish parses with ownerWishSchema / anonWishSchema; JSON has no 'Mom', 'Sis', note text, 'purchases', 'notes', 'bought', 'removed'
it('shows an owner their own purchase and nothing else', () => {    // art ticks plugs: mine 1; the rest of both worlds' owner views still equal apart from that field
it('gives the same list to the owner after their own tick was refused', ...) // setPurchase throws; view unchanged
it('shows a buyer who bought how many, the notes, and which are their own', ...)
it('keeps a deleted wish for buyers while someone has it, marked removed', ...)
it('hides a deleted wish nobody bought from everyone', ...)
it('answers undefined for an unknown token', ...)
describe('a deleted list', () => {
  it('is gone for its owner and for logged-out visitors, whatever was bought', ...)   // undefined in both worlds
  it('still shows a buyer what was bought on it, marked deleted', ...)                 // deleted: true, only removed wishes with purchases
})
it.each(['server/domain/public-wishes.ts'])('%s never touches purchases or notes', ...)
```

- [ ] **Step 2: Run it.** Expected: FAIL, module not found.
- [ ] **Step 3: Implement `getListView`.** Three private builders, one per role; the owner builder reads `purchases` only with `userId = viewerId`.
- [ ] **Step 4: Break it on purpose once:** make the owner builder return `bought`. Run the test, see the non-interference and schema tests fail, undo. Then `pnpm test`: PASS.
- [ ] **Step 5: Commit** "Build each viewer's list per wish".

---

### Task 6: Remembering opened lists

**Files:**
- Create: `server/domain/visits.ts`, `server/utils/opened-lists.ts`
- Test: `test/visits.test.ts`

**Interfaces:**
- Produces in `shared/schemas/list.ts`: `interface OpenedList { token: string, title: string, owners: string[], deleted: boolean }`, `interface HomeView { owned: HomeList[], opened: OpenedList[] }`.
- Produces in `visits.ts`: `rememberList(db, userId, token): void` (no-op for an unknown token or a list the person owns; refreshes `openedAt`); `forgetList(db, userId, token): void`; `listOpenedLists(db, userId): OpenedList[]` (most recently opened first; never lists the person owns); `describeLists(db, tokens: string[]): OpenedList[]` (in the given order, unknown tokens skipped); `mergeVisits(db, userId, tokens: string[]): void`.
- Produces in `opened-lists.ts`: pure `parseOpened(value: string | undefined): string[]` (tokens separated by `.`, each must match `LIST_TOKEN`, duplicates dropped, at most 50) and `withOpened(tokens: string[], token: string): string[]` (newest first, capped at 50); and the h3 wrappers `readOpened(event)`, `writeOpened(event, tokens)`, `clearOpened(event)` for the cookie `opened-lists` (httpOnly, `sameSite: 'lax'`, path `/`, one year, `secure` as `runtimeConfig.session.cookie.secure`).

- [ ] **Step 1: Write `test/visits.test.ts`:** remembering puts a list on the person's opened lists with its title and owners' names; opening it again moves it to the front without a second entry; a person's own list is never among them; forgetting removes it; `mergeVisits` adds lists from a cookie and ignores ones already there and ones the person owns; a deleted list shows as `deleted: true`. For Review Focus 1:

```ts
it('reads only well-formed tokens from the cookie', () => {
  expect(parseOpened(`${good}.nonsense.${good}.<script>`)).toEqual([good])
  expect(parseOpened(undefined)).toEqual([])
})
it('keeps the newest 50', () => {
  const fifty = Array.from({ length: 50 }, () => newListToken())
  const next = withOpened(fifty, good)
  expect(next).toHaveLength(50)
  expect(next[0]).toBe(good)
})
it('describes the lists it can find and skips the rest', () => {
  expect(describeLists(db, [newListToken(), token]).map(l => l.token)).toEqual([token])
})
```

- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Implement both files.**
- [ ] **Step 4: Run `pnpm test`.** Expected: PASS.
- [ ] **Step 5: Commit** "Remember opened lists in the account or in a cookie".

---

### Task 7: The HTTP API

**Files:**
- Delete: `server/api/lists/index.get.ts`, `server/api/lists/[username].get.ts`, `server/api/me/items/**`, `server/api/items/**`
- Create under `server/api/`: `home.get.ts`, `home/opened/[token].delete.ts`, `lists/index.post.ts`, `lists/[token]/index.get.ts`, `index.patch.ts`, `index.delete.ts`, `lists/[token]/wishes/index.post.ts`, `wishes/[id]/index.patch.ts`, `index.delete.ts`, `image.put.ts`, `image.delete.ts`, `purchase.put.ts`, `purchase.delete.ts`, `notes.post.ts`
- Modify: `server/api/auth/register.post.ts`, `login.post.ts`, `server/api/me/index.get.ts`, `index.patch.ts`, `server/utils/http.ts`, `server/middleware/01.security.ts` (the 3 MB limit still keys on a path ending in `/image`)
- Keep: `server/api/notes/[id].delete.ts`, `me/password.put.ts`, `health.get.ts`, `server/routes/uploads/[file].get.ts`
- Rewrite: `test/api-check.sh`

**Interfaces:**
- Consumes: every domain function above.
- Produces in `server/utils/http.ts`: `tokenParam(event): string` (404 unless it matches `LIST_TOKEN`).
- Routes and answers:

| Route | Who | Answer |
|---|---|---|
| `POST /api/auth/register` `{ email, displayName, password }` | anyone | 201 `{ displayName }`; merges and clears the cookie |
| `POST /api/auth/login` | anyone | 200 `{ displayName }`; merges and clears the cookie |
| `GET /api/home` | anyone | `HomeView`; logged out: `owned: []`, `opened` from the cookie |
| `DELETE /api/home/opened/:token` | anyone | 204; account or cookie |
| `POST /api/lists` `{ title }` | logged in | 201 `{ token, title }` |
| `GET /api/lists/:token` | anyone | `ListView`, or 404. Remembers the list: account for a logged-in non-owner, cookie when logged out |
| `PATCH /api/lists/:token` `{ title }` | owner | 200 `{ token, title }`; 404 otherwise |
| `DELETE /api/lists/:token` | owner | 204; 404 otherwise |
| `POST /api/lists/:token/wishes` | owner | 201 `PublicWish` |
| `PATCH`, `DELETE /api/lists/:token/wishes/:id` | owner | 200 `PublicWish` / 204 |
| `PUT`, `DELETE …/wishes/:id/image` | owner | `{ image }` / 204 |
| `PUT`, `DELETE …/wishes/:id/purchase` | logged in | 204; 409 `quantity_exceeded` or `wish_removed` |
| `POST …/wishes/:id/notes` | logged in, not an owner | 201 `{ id }`; 403 for an owner |
| `DELETE /api/notes/:id` | author | 204; 404 otherwise |

- [ ] **Step 1: Rewrite `test/api-check.sh`** for these routes, keeping its helpers (`req`, `check`, `has`, `lacks`, `json`, the race, the byte-for-byte comparison, images, guard rails). It must check at least:
  - register without a username; a list is made and its token has 22 characters;
  - a well-formed unknown token is 404, for the list and for every wish route under it (Review Focus 4);
  - mom can't add, change or delete on Art's list (404), and can't reach Art's wish through her own list's token (404);
  - buying adds up and is capped; two buyers racing for the last one give exactly one 204 and one 409;
  - Art's and the visitor's `GET /api/lists/:token` are byte for byte the same before and after buyers act;
  - Art ticks his own free wish: 204, and his list now has `"mine":1` on it and still no `purchases`, `notes`, `bought`, names or note text;
  - Art ticks a wish mom already has: 409 `quantity_exceeded`, and the body has no name and no number;
  - Art gets 403 for a note on his own wish, 404 for mom's note id;
  - logged out, opening a list sets the `opened-lists` cookie and `GET /api/home` lists it; after logging in it is in the account and the cookie is cleared; `DELETE /api/home/opened/:token` removes it;
  - a cookie with junk in it still gives 200 on `/api/home`;
  - deleting a list: 204 then 404 for Art; a visitor gets 404; mom still gets it with `"deleted":true`.
- [ ] **Step 2: Start a server on an empty database and run it** (`NUXT_DATA_DIR=$(mktemp -d) pnpm dev --port 3112`, then `test/api-check.sh http://localhost:3112`). Expected: FAIL on the first new route.
- [ ] **Step 3: Write the routes and remove the old ones.** After login and register: `mergeVisits(db, user.id, readOpened(event))`, then `clearOpened(event)`.
- [ ] **Step 4: Restart on an empty database and run the check.** Expected: "All checks passed."
- [ ] **Step 5: Commit** "Serve lists by token and remember them".

---

### Task 8: Home page, accounts, header

**Files:**
- Rewrite: `app/pages/index.vue`
- Create: `app/components/QuickAdd.vue`, `app/components/ShareButton.vue`
- Modify: `app/pages/register.vue`, `login.vue`, `settings.vue`, `app/components/AppHeader.vue`, `i18n/locales/*.json`, `app/assets/css/app.css`
- Delete: `app/pages/u/**`, `app/pages/me/**`, `app/components/ItemCard.vue`, `ItemForm.vue`, `ItemNotes.vue`, `PurchasePanel.vue`, `app/composables/useList.ts`, `useItemStatus.ts`. They use types that no longer exist. Tasks 9 to 11 build their replacements and take what is reusable from the first commit (`git show <first commit>:app/components/ItemForm.vue`); until then there is no list page.

**Interfaces:**
- Produces `QuickAdd.vue`: props `label: string`, `pending?: boolean`; emits `add: [title: string]`. A text field in a row that looks like a list row with a +. Enter emits the trimmed title when it isn't empty, ignores Enter while `event.isComposing`, clears the field and keeps the focus. While `pending` the field is read-only, so a second Enter adds nothing.
- Produces `ShareButton.vue`: prop `path: string`; copies `location.origin + path` with `navigator.clipboard.writeText` and says "Link gekopieerd" / "Link copied" in a `role="status"` line for a few seconds; when the clipboard isn't available it shows the address in a read-only field to copy by hand.

- [ ] **Step 1: Home page.** `useFetch<HomeView>('/api/home')`. Deep hero band with the title; a section "Jouw lijsten" (logged in) with one row per list (title, wish count, link to `/l/<token>`) and a `QuickAdd` "Nieuwe lijst…" that posts to `/api/lists` and goes to the new list; a section "Lijsten die je opende" with a "remove" button per row that calls `DELETE /api/home/opened/:token` and refreshes, deleted lists marked; logged out, an invitation to log in or make an account in place of "Jouw lijsten". Empty states use `.empty` with `<art-splatter>`.
- [ ] **Step 2: Accounts.** Registration loses the address field and its slug suggestion; after registering or logging in, go to `next` when it is safe (`safeNextPath`), otherwise `/`. Settings keeps the name and password forms. The header loses "Mijn lijst".
- [ ] **Step 3: Strings.** Add `home.yourLists`, `home.newList`, `home.opened`, `home.remove`, `home.deleted`, `home.loggedOut`, `share.copy`, `share.copied`, and a sentence for each new error code: `errors.list_limit`, `errors.wish_limit`, `errors.wish_removed` (replacing `item_limit` and `item_removed`). Remove the keys the deleted pages used.
- [ ] **Step 4: Run `pnpm typecheck`** (clean), then check in a browser at `http://localhost:3400`: register with name, email, password only; type a list name and press Enter: the address bar shows `/l/` and 22 characters; back on the home page the list is there with "nog geen wensen"; logged out, the home page shows no lists and no directory. No hydration warnings in the console.
- [ ] **Step 5: Commit** "Make the home page yours: your lists and the ones you opened".

---

### Task 9: The list page: rows, +, unfolding, sharing

**Files:**
- Create: `app/pages/l/[token].vue`, `app/composables/useListView.ts`, `app/composables/useWishStatus.ts`, `app/components/WishRow.vue`, `WishThumb.vue`, `WishBuyerDetails.vue`, `WishNotes.vue` (the first commit's `ItemNotes.vue`, with the new route)
- Modify: `i18n/locales/*.json`, `app/assets/css/app.css`

**Interfaces:**
- Consumes: `ListView`, `WishView`, `QuickAdd`, `ShareButton`.
- Produces `useListView(token: MaybeRefOrGetter<string>)`: `{ list: Ref<ListView>, refresh }`; a 404 becomes the error page; a failed refresh keeps the last list (as `useList` did).
- Produces `useWishStatus()`: `secondLine(wish: WishView): string` (the start of the text; for an owner with `mine > 0` "Je hebt dit zelf" / "Je hebt er zelf {n}"; for a buyer who bought what and how many are left) and `amountTag(wish): string | null` ("3 gevraagd", "Onbeperkt", null for one).
- Produces `WishRow.vue`: props `wish: WishView`, `token: string`, `open: boolean`; emits `toggle`, `changed`. Markup: `<li id="wish-<id>">`, a slot `tick` (Task 10 fills it), `WishThumb`, a button with the title and second line that carries `aria-expanded` and `aria-controls="wish-<id>-details"`, the amount tag, and the details region below.
- Produces `WishThumb.vue`: prop `wish: { id: number, image: string | null }`. The picture, or a study made in CSS from two of Gesso's paints chosen by `id % 8`, so it is the same on the server and in the browser.

- [ ] **Step 1: The page.** Deep title band with the list title, the owners' names for non-owners, and `ShareButton` for everyone. One section with `<ul class="wish-list">` of `WishRow`, removed wishes last. For an owner, a `QuickAdd` "Voeg iets toe…" as the last row that posts `{ title }` to `/api/lists/:token/wishes` and refreshes. A list with `deleted: true` shows a line saying its owner deleted it. Which rows are open is page state (`Set<number>`); on mount, a `#wish-<id>` in the address opens that row and scrolls to it, and is ignored when no such row exists.
- [ ] **Step 2: Unfolded content for buyers and visitors.** `WishBuyerDetails`: the text (`white-space: pre-line`), the shop link as a secondary `<art-button>` (`target="_blank" rel="noopener noreferrer"`), who is buying (the `.people` list), and `WishNotes`. A logged-out visitor gets the text, the link and a line with a login link that carries `next`. (Owners get the editor in Task 11; until then their unfolded row shows the text and link.)
- [ ] **Step 3: Styles** for `.wish-list`, the row, the thumb, the open state, in `app.css`, marked as candidates for Gesso. Rows wrap long titles (`overflow-wrap: anywhere`); nothing scrolls sideways.
- [ ] **Step 4: Check in a browser:**
  - as the owner, add three wishes with + and three titles and nothing else: three rows, amount one, in the order typed;
  - press Enter twice quickly, on an empty line, and on a line of spaces: no extra row (Review Focus 2);
  - a 120-character title without spaces and a list of 200 wishes (add them with a curl loop) at 400 px wide: no sideways scroll, the + line is reachable (Review Focus 5);
  - Share copies the address; opened in a logged-out window it shows the wishes and no purchases, and the home page there now lists it;
  - `/l/<token>#wish-999999` opens the list with nothing unfolded and no console error (Review Focus 4);
  - as a buyer, unfold a wish: text, link, notes; write a note and see it.
- [ ] **Step 5: Commit** "Show a list as rows you can add to, unfold and share".

---

### Task 10: Ticking

**Files:**
- Create: `app/components/WishTick.vue`
- Modify: `app/pages/l/[token].vue` (fill the `tick` slot), `i18n/locales/*.json`, `app/assets/css/app.css`

**Interfaces:**
- Consumes: `WishView`, `PUT`/`DELETE …/purchase`.
- Produces `WishTick.vue`: props `wish: WishView`, `token: string`; emits `changed`. Renders nothing for `role: 'anon'`.
  - Amount one: a checkbox, checked when `mine ≥ 1`. More than one or no limit: a stepper, two buttons around "`mine` / `quantity`" (just `mine` when there is no limit), with `aria-label`s that name the wish.
  - Buyer: the box is disabled when none are left and `mine` is 0; + is disabled when none are left. A removed wish can only go down.
  - Owner: + and the box are never disabled and nothing shows how many are left. Before any increase a native `<dialog class="dialog">` asks the warning text; Cancel has the focus. Lowering and unticking ask nothing.
  - A 409 shows, under the row, "Iemand heeft dit al" (amount one) or "Zoveel zijn er niet meer over" (more), then emits `changed` so the row shows the fresh state. A 404 shows "Dat bestaat niet meer" and emits `changed` (Review Focus 3).

- [ ] **Step 1: Strings:** `tick.warningTitle`, `tick.warning` ("Je komt misschien te weten dat iemand dit al heeft. Doorgaan?" / the English text from Global Constraints), `tick.continue`, `tick.cancel`, `tick.taken` ("Iemand heeft dit al." / "Someone already has this."), `tick.notEnough` ("Zoveel zijn er niet meer over." / "There aren't that many left."), `tick.gone`, and the stepper labels.
- [ ] **Step 2: Build `WishTick.vue` and place it in each row.**
- [ ] **Step 3: Check in a browser with two accounts:**
  - buyer ticks a wish for one: the box is checked, the second line names them; unticking clears it;
  - buyer on "3 gevraagd" presses + twice: "2 / 3", "nog 1 over"; a second buyer takes the last; the first presses +: refused, numbers refresh;
  - owner ticks a free wish: the warning shows, Cancel changes nothing, Continue checks the box and the second line says "Je hebt dit zelf"; the buyer's view names the owner;
  - owner ticks a wish the buyer already has: after the warning, "Iemand heeft dit al", the box stays empty, and the row shows nothing else new;
  - owner unticks: no warning;
  - tick a wish in one tab after deleting it in another: the message shows and the row disappears (Review Focus 3).
- [ ] **Step 4: Run `test/api-check.sh` on an empty database.** Expected: still "All checks passed."
- [ ] **Step 5: Commit** "Tick wishes, with a warning on your own".

---

### Task 11: Editing in place, renaming and deleting

**Files:**
- Create: `app/components/WishEditor.vue` (the first commit's `ItemForm.vue`, reshaped)
- Modify: `app/pages/l/[token].vue`, `i18n/locales/*.json`

**Interfaces:**
- Consumes: `PATCH`/`DELETE …/wishes/:id`, the image routes, `PATCH`/`DELETE /api/lists/:token`, `FormField`, `ImagePicker`, `useForm`.
- Produces `WishEditor.vue`: props `wish: WishView` (role `owner`), `token: string`; emits `changed`, `closed`. The fields of `ItemForm` (title, text, link, amount with "Geen limiet", picture) and three actions: "Wens opslaan" (saves, uploads or removes the picture, emits `changed` then `closed`), "Annuleren", and "Verwijderen" behind the existing confirmation dialog.

- [ ] **Step 1: The owner's unfolded row shows `WishEditor`.** Saving closes the row and refreshes the list. Deleting refreshes the list.
- [ ] **Step 2: The title band, for an owner,** gets "Naam wijzigen" (the title becomes a field with Save and Cancel) and "Lijst verwijderen" behind a confirmation dialog whose text says the wishes go with it; after deleting, go to `/`.
- [ ] **Step 3: Check in a browser:** add "Boek" with +, unfold it, add a text, a link, an amount of 3 and a picture, save: the row shows the picture, the start of the text and "3 gevraagd"; rename the list and reload: the address is unchanged; delete a wish a buyer bought: gone for the owner, still there for the buyer, marked as removed; delete the list: the owner lands on the home page without it, the buyer's home page marks it as deleted and its page shows what they bought.
- [ ] **Step 4: Run `pnpm test`, `pnpm typecheck`, and `test/api-check.sh` on an empty database.** Expected: all clean.
- [ ] **Step 5: Commit** "Edit wishes in place; rename and delete lists".

---

### Task 12: Tidy up and prove it in the container

**Files:**
- Modify: `README.md`, `i18n/locales/*.json`, `app/assets/css/app.css`

- [ ] **Step 1: Remove what nothing uses:** locale keys (compare the keys used in `app/` with both files; both must also have the same keys), styles for cards and the wish page, components and composables without importers.
- [ ] **Step 2: Rewrite the README sections** "Who sees what" (per wish, the owner's own tick, the warning), "How it is put together" (lists, tokens, remembered lists), and the intro. Remove the mention of usernames. State that step two (joint wishes) is designed in the spec and not built.
- [ ] **Step 3: Build and check the image:** `docker compose -p pakske-check --env-file <a temp file with NUXT_APP_SECRET, NUXT_SESSION_COOKIE_SECURE=false, PORT=3201> up -d --build`, run `test/api-check.sh http://localhost:3201`, fetch `/l/<token>` as the owner, logged out and as a buyer and count buyer names and note text in the HTML (zero for the first two), then `down -v --rmi local`. Expected: "All checks passed.", zero, zero, non-zero.
- [ ] **Step 4: Run `pnpm test` and `pnpm typecheck`.** Expected: clean.
- [ ] **Step 5: Commit** "Document private lists and remove the first version's leftovers".
