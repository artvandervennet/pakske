# Joint wishes, step two: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a wish, or a whole list, belong to two or more people and be bought once for all of them: single-use links that make wishes joint or add a co-owner, "Add to my list" as Linked or Copy, unlink and undo, leaving a joint list, and notices on the home page.

**Architecture:** Who owns a wish follows from where it is shown: a wish's owners are the owners of every list that shows it. `server/domain/placement.ts` holds that one rule (`putOnList`, `takeOffList`, `settleOwners`); deleting, leaving, unlinking and undo all go through it, and it keeps `wish_owners` equal to it. `getListView` stays the only place that decides what a viewer sees and still reads `wish_owners` per wish. Everything about a wish goes through a list token that shows it; single-use links have tokens of their own and never give away a list's.

**Tech Stack:** Nuxt 4.6, Vue 3.5, Drizzle 0.45 + better-sqlite3, nuxt-auth-utils 0.6, @nuxtjs/i18n 10, zod 4, Vitest 5, Gesso 1.2.5.

**Spec:** `docs/superpowers/specs/2026-11-17-private-lists-and-joint-wishes-design.md`. This plan covers step two: "Step two: joint wishes and lists", and what step one left out of "The model", "Who sees what, per wish", "The list page" and "The home page". Step one is built (`docs/superpowers/plans/2026-11-17-private-lists-step-one.md`).

## Global Constraints

- An owner of a wish sees the wish and **their own** purchase, nothing about anyone else's, the other owners' included, and no notes. A claim by one owner of a joint wish is invisible to the others. Buyers from every list that shows a wish see one shared state.
- The role is decided per wish from `wish_owners`, in `getListView` only. `wish_owners` is written by `settleOwners` and by nothing else; after every action it holds exactly the owners of the live lists that show the wish, and a wish with none is deleted.
- One rule takes a wish off a list: `takeOffList`. Deleting a wish or a list, unlinking and undo call it; leaving a list calls its ownership half, `settleOwners`. Purchases stay on the wish and are never moved to a copy.
- A wish taken off a list stays visible on that list to logged-in people who own neither the wish nor the list, marked as removed, for as long as anyone has a purchase on it. The list's owners and the wish's owners never get such a row.
- Every request about a wish names a list token, and the wish must be on that list now. The exceptions that existed stay: lowering or removing a purchase and writing a note also work on a wish that was taken off. An increase there answers `wish_removed`.
- Taking off, deleting, lowering an amount, linking, copying, unlinking, undo and leaving answer the same way whatever buyers did. The domain files other than `purchases.ts`, `notes.ts` and `list-view.ts` never mention purchases or notes; a test reads the sources.
- Notices are never about purchases or notes. Linked takes effect at once and tells the earlier owners; Copy tells nobody.
- Single-use link tokens are made like list tokens (128 bits, `newListToken`). A link works once, needs a login, and its view never contains the token of the list it came from.
- Limits carry over with their codes, the lifetime ceiling checked first as now: 200 lists ever (`list_limit_ever`) and 50 live (`list_limit`) per person, also when a link or a new list in the chooser adds one; 500 wishes ever (`wish_limit_ever`) and 200 live (`wish_limit`) per list, also for linked, copied and accepted wishes. The copy an unlink leaves behind is exempt. At most 20 unused links per list; making one more drops the oldest.
- Words from the spec, exactly: "Add to my list" / "Op mijn lijst zetten", "Linked" / "Gekoppeld", "Copy" / "Kopie", "Undo" / "Ongedaan maken", "Unlink" / "Ontkoppelen", "Delete" / "Verwijderen", "Remove from my list" / "Van mijn lijst halen", "with Lotte" / "met Lotte".
- Every new string exists in `i18n/locales/nl.json` and `en.json`, plain and in sentence case. A sentence whose subject is one or more owners has a singular and a plural form, picked by the number of names; lists of names go through `Intl.ListFormat`.
- Everything visual uses Gesso tokens and components. Dialogs follow `TickWarning.vue` (native `<dialog>`, the safe button focused), forms follow `useForm` + `FormField`. New styles go in `app/assets/css/app.css`, marked "candidate for Gesso".
- Domain functions are synchronous and take a database handle. Each exported action runs in one `db.transaction(..., { behavior: 'immediate' })` with no `await` inside; helpers that take part in a caller's transaction open none.
- Routes stay thin and use `domain`, `fail`, `readInput`, `requireUser`, `sessionUserId`, `tokenParam`, `idParam`. No route reads the session itself, so a cookie for an account that is gone or replaced counts as logged out (`sessionUser` in `server/utils/http.ts`, `server/plugins/02.session-check.ts`).
- The migration is added with `pnpm db:generate`; `server/db/migrations/0000_*.sql` is not touched.
- Run `pnpm test` and `pnpm typecheck` after every task; both must be clean. One commit per task, on top of step one; the message is an imperative sentence.

- No form feel (Art, after trying step one): adding and editing happen in place. New things are typed straight into a row that appears where the thing will be; existing things are edited where they are shown, each field saving when you leave it, with a brief "Opgeslagen"; no blocks of labelled fields with Save and Cancel. Choices (which list, Linked or Copy) are made with buttons or a short menu at the spot, and confirmations use the native dialog. Follow the patterns the list page has after step one's Task 13 (the + row that becomes the new row; the owner's unfolded row edited in place).

## Review Focus

Inputs the spec implies but doesn't spell out, most likely first. Each has a test in the task named.

1. **A single-use link used in ways it wasn't meant to be**: opened by two people at once, opened by the person who made it, opened after its wishes or its list are gone. One person gets it, the maker is told to send it on, and a spent link says so. (Tasks 5, 7 and 9)
2. **Undo or Unlink pressed after things moved on**: the linker already took the wish off their list, the notice was dismissed in another tab, the button is pressed twice. The fields still go back when they can; otherwise "not found" and the notices refresh. (Tasks 4 and 10)
3. **A wish that can't land where it is sent**: the chosen list is full, the person has 50 lists, the wish was taken off meanwhile, or the person was unlinked before and links again. A clear refusal, or the old placement comes back without a duplicate. (Tasks 3 and 4)
4. **Two owners with the same name, or a name changed later**: unlinking addresses a person by id; a notice shows the actor's name as it is now and the wish's title as it was. (Tasks 3 and 6)
5. **One picture under two wishes**: a copy, an unlink copy or a remembered earlier picture share a file. Replacing or removing it on one wish leaves it in place for the other. (Tasks 4 and 7)

---

### Task 1: Schema and the take-off rule

**Files:**
- Modify: `server/db/schema.ts`, `server/domain/errors.ts`, `server/utils/http.ts`, `server/domain/wishes.ts`, `server/domain/purchases.ts`, `server/domain/notes.ts`
- Create: `server/domain/placement.ts`, a migration `server/db/migrations/0001_*.sql` (run `pnpm db:generate`)
- Test: `test/placement.test.ts`, `test/helpers.ts`

**Interfaces:**
- Produces in the schema: `listWishes` gains `joinOrder: integer('join_order').notNull().default(0)` and `removedAt: integer('removed_at', { mode: 'timestamp_ms' })` (null while the wish is on the list). New tables, all foreign keys cascading: `invites(id, token unique, kind 'wishes' | 'list', listId, createdBy, createdAt, usedAt)`; `inviteWishes(inviteId, wishId)` PK both; `wishLinks(id, wishId, userId, createdAt)` unique `(wishId, userId)`; `linkChanges(linkId, field, before)` PK `(linkId, field)`, where `before` is the earlier value as JSON text; `notices(id uuid text, userId, kind, actorId, title, more default 0, wishId nullable, listId nullable, createdAt, seenAt nullable)` with an index on `userId`.
- Produces: `DomainErrorCode` gains `'list_shared' | 'last_owner' | 'invite_closed'`, all 409 in `server/utils/http.ts`.
- Produces in `placement.ts`:
  - `MAX_LIVE_WISHES = 200`, `MAX_WISHES_EVER = 500` (moved from `wishes.ts`).
  - `onListNow: SQL`: `and(isNull(listWishes.removedAt), isNull(wishes.deletedAt), isNull(lists.deletedAt))`, for queries that join the three tables. "Live placement" below means this.
  - `wishOnList(db, token: string, wishId: number): { wish, list, placement, live: boolean }` (moved from `purchases.ts`; `not_found` when no list has the token or the list has no placement of the wish, taken off or not).
  - `assertRoom(db, listId: number, adding = 1): void` (`wish_limit_ever`, then `wish_limit`, as `addWish` checks now).
  - `putOnList(db, listId: number, wishId: number): void`: a new placement, or a taken-off one brought back, with `addedAt` now and `joinOrder` 0 for a wish that has no placement yet and otherwise one more than the highest any of its placements ever had; then `settleOwners`.
  - `takeOffList(db, listId: number, wishId: number): number[]`: sets `removedAt`, settles, and returns the ids of the people who stopped owning the wish.
  - `settleOwners(db, wishIds: number[]): { wishId: number, userId: number }[]`: makes `wish_owners` for each wish equal to the owners of the live lists that show it, sets `wishes.deletedAt` when none are left, and returns who stopped owning.
  - `standing(db, wishId: number, userId: number): number | null`: the lowest `joinOrder` among the live placements of the wish on lists the person owns.
- Adds to `test/helpers.ts`: `addOwner(db, token, userId): void` (a `list_owners` row and `settleOwners` for the list's wishes; the real way in is Task 5), `ownerIds(db, wishId): number[]` (ascending), `expectOwnersSettled(db): void` (for every wish, `wish_owners` equals the owners of the live lists that show it, and the wish is deleted exactly when that is nobody).

- [ ] **Step 1: Write `test/placement.test.ts`.** `setup()` gives Art, Lotte (`lot`, shown as 'Lot') and Sam, Art's list `A` and Lotte's list `L`, and the lists' ids `aId` and `lId`.

```ts
it('takes a joint wish off one list and leaves it with the other list\'s owners', () => {
  const game = addWishTo(db, art.id, A, 'Bordspel')
  putOnList(db, lId, game.id)
  expect(ownerIds(db, game.id)).toEqual([art.id, lot.id])
  expect([standing(db, game.id, art.id), standing(db, game.id, lot.id)]).toEqual([0, 1])

  expect(takeOffList(db, aId, game.id)).toEqual([art.id])
  expect(ownerIds(db, game.id)).toEqual([lot.id])
  expect(db.select().from(wishes).where(eq(wishes.id, game.id)).get()?.deletedAt).toBeNull()
  expect(takeOffList(db, lId, game.id)).toEqual([lot.id])
  expect(db.select().from(wishes).where(eq(wishes.id, game.id)).get()?.deletedAt).toBeInstanceOf(Date)
})
it('gives a new wish to every owner of its list', ...)                          // addOwner(sam) on A first; owners [art, sam], both standing 0
it('keeps someone as owner who has the wish on another list of theirs', ...)    // on A and on art's second list; take off A: returns [], art still owns
it('takes a wish off a joint list for all its owners', ...)                     // returns [art, sam]; deleted
it('brings a taken-off placement back with a later join order, without a second row', ...)
it('refuses to put a 201st live wish on a list', ...)                           // assertRoom: 'wish_limit'
it('never touches purchases or notes', ...)                                     // source of placement.ts, as in test/wishes.test.ts
```

End every test with `expectOwnersSettled(db)`.

- [ ] **Step 2: Run `pnpm test test/placement.test.ts`.** Expected: FAIL, module not found.
- [ ] **Step 3: Change the schema and run `pnpm db:generate`; write `placement.ts`; add the error codes and statuses.** `addWish` calls `assertRoom` and `putOnList` instead of its own inserts; `purchases.ts` and `notes.ts` import `wishOnList` from `placement.ts`. Behaviour is unchanged.
- [ ] **Step 4: Run `pnpm test` and `pnpm typecheck`.** Expected: PASS, the existing tests included.
- [ ] **Step 5: Commit** "Add the rule that takes a wish off a list".

---

### Task 2: Deleting is taking off a list

**Files:**
- Modify: `server/domain/wishes.ts`, `lists.ts`, `purchases.ts`, `public-wishes.ts`, `list-view.ts`
- Test: `test/wishes.test.ts`, `test/lists.test.ts`, `test/purchases.test.ts`, `test/visibility.test.ts`

**Interfaces:**
- Consumes: `takeOffList`, `onListNow`, `wishOnList`, `putOnList` (Task 1).
- Produces in `wishes.ts`: `ownedWishOnList(db, userId, token, wishId)`: the wish row, or `not_found` unless the placement is live and the person owns the wish. `updateWish` and `setWishImage` use it, so an owner may edit through any list that shows the wish. `deleteWish(db, userId, token, wishId): void` keeps its name and still needs the list to be the caller's (`ownedListId`); it now calls `takeOffList`.
- Produces: `deleteList` takes every wish off the list with `takeOffList`, then sets `lists.deletedAt`. `livePublicWishes` and the wish count in `listOwnedLists` count live placements only. `setPurchase` refuses an increase with `wish_removed` when the placement isn't live, before it reads any other purchase.
- Produces in `getListView`: a placement that isn't live gives a row only to a logged-in viewer who owns neither the wish nor the list, and only while the wish has a purchase: a `buyer` wish with `removed: true`. Live placements get their role as before.

- [ ] **Step 1: Write the tests.** In `test/visibility.test.ts` the `newListToken` mock becomes a counter (`'list-' + String(n).padStart(17, '0')`) that `world()` resets, so one world can hold several lists and two worlds still get the same addresses. `titles` and `wishIn` move to `test/helpers.ts`; later tasks use them. Add, with a small setup of its own:

```ts
it('takes a joint wish off one list and leaves it on the other, for buyers too', () => {
  // art's list A and lotte's list L both show `game` (putOnList); mom bought it through A
  deleteWish(db, art.id, A, game.id)
  expect(titles(getListView(db, A, art.id))).not.toContain('Bordspel')   // the list's owner never gets the row
  expect(titles(getListView(db, A, lot.id))).not.toContain('Bordspel')   // nor does an owner of the wish
  expect(titles(getListView(db, A, null))).not.toContain('Bordspel')
  expect(wishIn(getListView(db, A, mom.id), game.id)).toMatchObject({ role: 'buyer', removed: true, mine: 1 })
  expect(wishIn(getListView(db, L, mom.id), game.id)).toMatchObject({ role: 'buyer', removed: false, bought: 1 })
  expect(wishIn(getListView(db, L, lot.id), game.id)).toMatchObject({ role: 'owner' })
})
it('shows a taken-off wish to nobody when nobody bought it', ...)
```

In `test/wishes.test.ts`: an owner of the wish changes it and sets its picture through a list they don't own (`lot` through `A`); the same person can't take it off that list (`not_found`); deleting a wish that is also on another list leaves `deletedAt` null. In `test/lists.test.ts`: deleting a list leaves a joint wish on the other list with that list's owners. In `test/purchases.test.ts`: through a list the wish was taken off, an increase is `wish_removed` whether or not anyone bought it, lowering and removing work, and through the list that still shows it buying works.

- [ ] **Step 2: Run them.** Expected: FAIL on the new cases.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `pnpm test` and `pnpm typecheck`.** Expected: PASS. The step-one leak tests must pass unchanged apart from the token mock.
- [ ] **Step 5: Commit** "Delete wishes and lists by taking wishes off a list".

---

### Task 3: Linked, Copy and notices

**Files:**
- Create: `server/domain/sharing.ts`, `server/domain/notices.ts`
- Modify: `server/domain/lists.ts`, `shared/schemas/input.ts`, `shared/schemas/list.ts`
- Test: `test/sharing.test.ts`, `test/input.test.ts`

**Interfaces:**
- Consumes: `wishOnList`, `assertRoom`, `putOnList` (Task 1).
- Produces in `shared/schemas/input.ts`: `targetInput` = a union of strict `{ list: string }` (1 to 64 characters) and strict `{ newList: string }` (as `listInput.title`); `type ListTarget`.
- Produces in `shared/schemas/list.ts`: `interface MyLists { lists: { token: string, title: string }[], last: string | null }`; `type NoticeKind = 'wish_linked' | 'wish_unlinked' | 'joint_link_used' | 'list_joined'`; `interface NoticeView { id: string, kind: NoticeKind, actor: string, actorId: number, title: string, more: number, token: string | null, wishId: number | null, canUndo: boolean, fresh: boolean, createdAt: string }`.
- Produces in `lists.ts`: `assertListRoom(db, userId): void` (`list_limit_ever`, then `list_limit`: the two checks `createList` has now, which then calls this); `targetListId(db, userId, target: ListTarget): { id: number, token: string, title: string }` (the caller's own live list, or a new one with that title; `not_found` for a list that isn't theirs); `listMyLists(db, userId): MyLists` (oldest first; `last` is the list a wish was most recently put on, by `list_wishes.addedAt`, or null).
- Produces in `sharing.ts`: `linkWish(db, userId, token, wishId, target: ListTarget): { token: string, title: string, wishId: number }` and `copyWish(...)` with the same signature; both return the list the wish landed on. Rules for both: `not_found` without a placement, `wish_removed` when it isn't live, `forbidden` when the caller already owns the wish, and the limit codes of `assertRoom` and `assertListRoom` from the target. `linkWish` puts the same wish on the target list, makes or keeps the `wishLinks` row for the caller, and gives every earlier owner a `wish_linked` notice. `copyWish` inserts a wish with the same title, text, link, picture file and amount on the target list and tells nobody.
- Produces in `notices.ts`: `addNotice(db, notice: { userId, kind: NoticeKind, actorId, title: string, more?: number, wishId?: number, listId?: number }): void`; `listNotices(db, userId): NoticeView[]` (newest first; by creation time, then insertion order); `countUnseen(db, userId): number`; `markNoticesSeen(db, userId): void`. In a `NoticeView`: `actor` is the actor's display name now, `title` the text stored with the notice, `token` a live list of the recipient's that shows the notice's wish now (or the notice's own list if they still own it), else null; `canUndo` is true for `wish_linked` when `token` isn't null and the `wishLinks` row for `(wishId, actorId)` exists; `fresh` means not seen yet.

- [ ] **Step 1: Write `test/sharing.test.ts`.** `setup()`: Art's list `A` with 'Bordspel' (`game`), Lotte's list `L` titled 'Lijst van Lotte', and mom.

```ts
it('makes the linker an owner at once, of the same wish, and tells the earlier owner', () => {
  setPurchase(db, A, game.id, lot.id, 1)                       // already bought: allowed
  expect(linkWish(db, lot.id, A, game.id, { list: L })).toEqual({ token: L, title: 'Lijst van Lotte', wishId: game.id })
  expect(ownerIds(db, game.id)).toEqual([art.id, lot.id])
  expect(wishIn(getListView(db, L, lot.id), game.id)).toMatchObject({ role: 'owner', mine: 1 })
  expect(wishIn(getListView(db, A, lot.id), game.id)).toMatchObject({ role: 'owner', mine: 1 })
  expect(listNotices(db, art.id)).toMatchObject([{ kind: 'wish_linked', actor: 'Lot', actorId: lot.id, title: 'Bordspel', token: A, wishId: game.id, canUndo: true, fresh: true }])
  expect(listNotices(db, lot.id)).toEqual([])
})
it('copies a wish into a separate one and tells nobody', ...)          // new id; same title, description, url, image, quantity; no notice; changing the copy leaves the original; no purchases on it
it('refuses someone who already owns the wish', ...)                   // 'forbidden' for both
it('finds nothing through a list that does not show the wish, or for a target that is not theirs', ...)   // 'not_found'
it('does not link or copy a wish that was taken off', ...)             // 'wish_removed'
it('can land on a new list', ...)                                      // { newList: 'Samen' }: the caller owns it, the wish is on it
it('refuses when the target list is full, or the person has 50 lists', ...)   // 'wish_limit', 'list_limit' (Review Focus 3)
it('remembers which list was used last', ...)                          // listMyLists(db, lot.id).last === L
it('marks notices as seen', ...)                                       // countUnseen 1, markNoticesSeen, 0, fresh false
it('shows the actor\'s name as it is now and the title as it was', ...) // updateDisplayName, updateWish; notice: new name, old title (Review Focus 4)
it('leaves no notice for buying or writing', ...)                      // setPurchase by a buyer and by an owner, addNote: no rows in notices
it.each(['sharing.ts', 'notices.ts'])('server/domain/%s never touches purchases or notes', ...)   // lists.ts and wishes.ts are checked in test/wishes.test.ts
```

In `test/input.test.ts`: `targetInput` takes `{ list }` or `{ newList }`, refuses both together and an empty name (`required`).

- [ ] **Step 2: Run it.** Expected: FAIL, module not found.
- [ ] **Step 3: Implement.** `targetListId` inserts the list in the caller's transaction; split the insert out of `createList` so both use it.
- [ ] **Step 4: Run `pnpm test` and `pnpm typecheck`.** Expected: PASS.
- [ ] **Step 5: Commit** "Add a wish to your own list, linked or as a copy".

---

### Task 4: Unlink, undo and what a link remembers

**Files:**
- Create: `server/domain/undo.ts`
- Modify: `server/domain/sharing.ts`, `server/domain/wishes.ts`, `server/utils/uploads.ts`, `server/api/lists/[token]/wishes/[id]/image.put.ts`, `image.delete.ts`
- Test: `test/undo.test.ts`, `test/sharing.test.ts`, `test/wishes.test.ts`

**Interfaces:**
- Consumes: `ownedWishOnList` (Task 2), `linkWish`, `addNotice` (Task 3), `takeOffList`, `standing` (Task 1).
- Produces in `sharing.ts`: `mayUnlink(db, wishId, actorId, targetId): boolean`: both own the wish, they are different people, and every live placement of the wish on a list the target owns has a `joinOrder` above the actor's `standing`. `unlinkOwner(db, actorId, token, wishId, targetId): void`: `not_found` unless the actor owns the wish on that list and the target owns it; `forbidden` unless `mayUnlink`. For each live placement on a list the target owns: `takeOffList`, then a plain copy of the wish as it is now on that list (no `assertRoom`). Everyone who stopped owning gets a `wish_unlinked` notice whose `wishId` is the copy on their list. The wish itself and its purchases don't change.
- Produces in `undo.ts`:
  - `type LinkField = 'title' | 'description' | 'url' | 'quantity' | 'imageFile'`; `WishRow` below is `typeof wishes.$inferSelect`.
  - `recordChanges(db, wishId, userId, before: WishRow, after: Partial<Pick<WishRow, LinkField>>): string[]`: `after` holds the fields the change names (`updateWish` takes a partial change); for each of them whose value differs, if the person has a `wishLinks` row for the wish and the field isn't remembered yet, remember `before`; every other link on the wish forgets that field. Returns the picture files forgotten that way.
  - `undoLink(db, userId, token, wishId, linkerId): { unused: string[] }`: `not_found` unless the caller owns the wish on that list and holds a `wish_linked` notice for `(wishId, linkerId)`. Puts each remembered field back, then unlinks the linker as `unlinkOwner` does if they still own the wish and `mayUnlink` holds, then deletes the link and every `wish_linked` notice for it.
  - `dismissNotice(db, userId, noticeId: string): { unused: string[] }`: `not_found` for a notice that isn't the caller's. When it was the last `wish_linked` notice for its link, the link and what it remembered go too.
  - `unusedImages(db, files: (string | null)[]): string[]`: the files no wish row, deleted or not, and no remembered change still points at.
- Produces: `updateWish` and `setWishImage` call `recordChanges` in their transaction. `setWishImage` now returns `{ unused: string[] }` instead of `{ previous }`: the replaced file and any forgotten ones, through `unusedImages`. `server/utils/uploads.ts` gains `removeUploads(names: string[]): Promise<void>`, which never throws; the two image routes use it.

- [ ] **Step 1: Write `test/undo.test.ts`** and the unlink cases in `test/sharing.test.ts`. `setup()` as in Task 3, with `game` having the picture `old.png`.

```ts
it('puts the wish back as it was and leaves the linker a copy', () => {
  linkWish(db, lot.id, A, game.id, { list: L })
  updateWish(db, lot.id, L, game.id, wishPatchInput.parse({ title: 'Ander spel', quantity: 2 }))
  expect(setWishImage(db, lot.id, L, game.id, 'new.png')).toEqual({ unused: [] })       // old.png is kept for the undo
  expect(undoLink(db, art.id, A, game.id, lot.id)).toEqual({ unused: ['new.png'] })

  expect(wishIn(getListView(db, A, art.id), game.id)).toMatchObject({ title: 'Bordspel', quantity: 1, image: '/uploads/old.png' })
  expect(ownerIds(db, game.id)).toEqual([art.id])
  const hers = getListView(db, L, lot.id)!.wishes
  expect(hers).toMatchObject([{ title: 'Bordspel', role: 'owner', mine: 0 }])
  expect(hers[0]!.id).not.toBe(game.id)
  expect(listNotices(db, art.id)).toEqual([])
  expect(listNotices(db, lot.id)).toMatchObject([{ kind: 'wish_unlinked', actor: 'Art', title: 'Bordspel', token: L, wishId: hers[0]!.id }])
})
it('keeps what an earlier owner changed after the linker did', ...)       // lot: title and text; art: title; undo: art's title stays, the text goes back
it('goes back to the value before the linker first changed it', ...)      // lot changes the title twice
it('stops remembering when the notice is dismissed', ...)                 // lot replaces the picture; dismissNotice(art) → { unused: ['old.png'] }; undoLink: 'not_found'; the wish keeps lot's changes
it('keeps remembering until the last of two earlier owners dismissed', ...)
it('lets only someone who holds the notice undo, and only once', ...)     // lot and mom: 'not_found'; a second undo: 'not_found' (Review Focus 2)
it('still puts the fields back when the linker already took the wish off their list', ...)   // no copy, no second notice (Review Focus 2)
it('never touches purchases or notes', ...)                               // source of undo.ts
```

Unlink, in `test/sharing.test.ts`: an earlier owner unlinks a later one, who gets a copy with no purchases and a notice while the wish is unchanged; purchases stay on the original, the unlinked person's own included, and someone who bought through that person's list sees it there with `removed: true`; a later owner can't unlink an earlier one (`forbidden`) but can take the wish off their own list; co-owners of one list (`addOwner`) can't unlink each other (`forbidden`); the copy is made even when the list holds 200 wishes; someone unlinked links again and the list has one placement of the wish, live, with a higher join order (Review Focus 3). In `test/wishes.test.ts`: the image test expects `{ unused: [] }`, `{ unused: ['a.png'] }`, `{ unused: ['b.png'] }`; a picture a copy shares isn't reported unused when one of the two drops it (Review Focus 5).

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** Unlinking inside `undoLink` shares one function with `unlinkOwner` that takes the caller's transaction.
- [ ] **Step 4: Run `pnpm test` and `pnpm typecheck`.** Expected: PASS.
- [ ] **Step 5: Commit** "Unlink an owner and undo a link with its changes".

---

### Task 5: Single-use links and joint lists

**Files:**
- Create: `server/domain/invites.ts`
- Modify: `server/domain/lists.ts`, `shared/schemas/input.ts`, `shared/schemas/list.ts`
- Test: `test/invites.test.ts`, `test/lists.test.ts`

**Interfaces:**
- Consumes: `targetListId`, `assertListRoom`, `listMyLists` (Task 3), `putOnList`, `assertRoom`, `settleOwners` (Task 1), `addNotice`.
- Produces in `shared/schemas/input.ts`: `inviteInput` = a discriminated union on `kind`: `{ kind: 'wishes', wishIds: number[] }` (1 to 50 positive whole numbers) or `{ kind: 'list' }`; `acceptInput` = `targetInput` or a strict empty object.
- Produces in `shared/schemas/list.ts`: `interface InviteView { kind: 'wishes' | 'list', state: 'open' | 'closed' | 'own', from: string, listTitle: string, wishes: { id: number, title: string, image: string | null }[], mine: MyLists }`; `HomeList` gains `sharedWith: string[]` (the other owners' names, in the order they joined).
- Produces in `invites.ts`:
  - `MAX_OPEN_INVITES = 20`.
  - `createInvite(db, userId, token, input): { invite: string }`: `not_found` unless the caller owns the live list and, for `wishes`, every id is a wish on it now. The 21st unused link on a list deletes the oldest unused one.
  - `getInviteView(db, invite: string, viewerId: number): InviteView | undefined`: undefined for an unknown token. `own` for the person who made it. `closed` when it was used, the list is deleted, its maker no longer owns the list, or none of its wishes is still on the list. `wishes` holds the ones still on the list, and only while `open`.
  - `acceptInvite(db, userId, invite: string, target: ListTarget | null): { token: string }`: `not_found` unknown; `invite_closed` unless open; `forbidden` for its maker and for someone who already owns the list of a `list` link. For `wishes`: `validation` without a target; each wish still on the source list is put on the target list unless it is there already (`assertRoom` for all of them first); the maker gets one `joint_link_used` notice with the first wish's title, `more` the number of further wishes and `wishId` the first; returns the target list. For `list`: `assertListRoom`, a `list_owners` row, `settleOwners` for the list's wishes, a `list_joined` notice (`listId`, the list's title) for every earlier owner; returns the list. Either way the link is marked used in the same transaction.
- Produces in `lists.ts`: `leaveList(db, userId, token): void`: `not_found` unless the caller owns the live list, `last_owner` for its only owner; removes the `list_owners` row and settles the list's wishes, which stay on the list. `deleteList` answers `list_shared` when the list has more than one owner.

- [ ] **Step 1: Write `test/invites.test.ts`.**

```ts
it('makes a link that works once', () => {
  const { invite } = createInvite(db, art.id, A, { kind: 'wishes', wishIds: [game.id, book.id] })
  expect(invite).toMatch(LIST_TOKEN)
  expect(acceptInvite(db, lot.id, invite, { list: L })).toEqual({ token: L })
  expect(ownerIds(db, game.id)).toEqual([art.id, lot.id])
  expect(codeOf(() => acceptInvite(db, mom.id, invite, { newList: 'Van mama' }))).toBe('invite_closed')
  expect(getInviteView(db, invite, mom.id)).toMatchObject({ state: 'closed', wishes: [] })
  expect(listNotices(db, art.id)).toMatchObject([{ kind: 'joint_link_used', actor: 'Lot', title: 'Bordspel', more: 1 }])
})
it('shows the opener the wishes and their own lists, never the address it came from', ...)   // wishes [{ id, title, image }], mine.lists; JSON has no A, 'purchases', 'notes', 'bought'
it('does not let its maker use it, and stays open for someone else', ...)                    // state 'own'; 'forbidden'; lot then accepts (Review Focus 1)
it('takes only wishes on that list, from an owner of it', ...)                               // mom, and a wish of another list: 'not_found'
it('skips a wish deleted meanwhile and closes when none is left', ...)                       // (Review Focus 1)
it('makes the accepter an owner who no longer sees purchases on those wishes', ...)          // lot bought first; afterwards role 'owner', mine 1, no names
it('keeps at most 20 unused links per list', ...)                                            // after the 21st, getInviteView of the first is undefined
describe('a joint list', () => {
  it('makes a co-owner an owner of the list and of every wish on it, now and later', ...)    // list invite; listOwnedLists(lot) has it with sharedWith ['Art']; a wish either adds has owners [art, lot]
  it('tells the earlier owners', ...)                                                         // 'list_joined', title the list's
  it('lets any co-owner take a wish off, for all of them', ...)
  it('cannot be deleted while it has several owners', ...)                                    // 'list_shared'
  it('lets someone leave: the list and its wishes are no longer theirs, except a wish on another list of theirs', ...)
  it('does not let the last owner leave, who can delete it', ...)                             // 'last_owner', then deleteList works
  it('refuses a 51st list for the accepter', ...)                                             // 'list_limit'
})
it('never touches purchases or notes', ...)                                                  // source of invites.ts
```

- [ ] **Step 2: Run it.** Expected: FAIL, module not found.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `pnpm test` and `pnpm typecheck`.** Expected: PASS.
- [ ] **Step 5: Commit** "Share wishes and lists with links that work once".

---

### Task 6: What each viewer gets with several owners

**Files:**
- Modify: `server/domain/list-view.ts`, `shared/schemas/list.ts`
- Test: `test/visibility.test.ts`

**Interfaces:**
- Consumes: everything above; `mayUnlink` (Task 4).
- Produces in `shared/schemas/list.ts`: all three wish schemas gain `sharedWith: string[]`: the names of the wish's owners who don't own this list, without the viewer, by `standing` then user id. `ownerWishSchema` also gains `coOwners: { id: number, name: string, canUnlink: boolean }[]` (every other owner of the wish, same order; `canUnlink` is `mayUnlink`) and `alsoElsewhere: boolean` (the wish has another live placement). All stay strict.
- Rules: none of the new fields is read from purchases or notes. The owner builder still reads `purchases` with `userId = viewerId` only.

- [ ] **Step 1: Extend `test/visibility.test.ts`** with a second pair of worlds. `jointWorld` resets the token counter and uses the clock the way `world` does:

```ts
/**
 * Art's list A ('Bordspel', 3 wanted, and 'Boek') and Lotte's list L ('Sjaal'); Lotte links
 * Bordspel onto L. With `others`, mom buys one through A, sis one through L, both write a note,
 * and `others.ticker`, the other owner, ticks one. Nothing else differs between two worlds.
 */
function jointWorld(others: { ticker: 'art' | 'lot' } | null) { ... }

it.each(['art', 'lot'] as const)('gives %s the same lists and notices whether or not anyone else bought, ticked or wrote', (me) => {
  const quiet = jointWorld(null)
  const busy = jointWorld({ ticker: me === 'art' ? 'lot' : 'art' })
  for (const list of ['A', 'L'] as const) {
    expect(getListView(busy.db, busy[list], busy[me].id)).toEqual(getListView(quiet.db, quiet[list], quiet[me].id))
    expect(getListView(busy.db, busy[list], null)).toEqual(getListView(quiet.db, quiet[list], null))
  }
  const plain = (w: typeof quiet) => listNotices(w.db, w[me].id).map(({ id, ...rest }) => rest)
  expect(plain(busy)).toEqual(plain(quiet))
})
it('shows each owner their own tick and not the other\'s', ...)                // both tick: each view has mine 1; every wish parses with ownerWishSchema; no 'Mom', 'Sis', note text, 'purchases', 'notes', 'bought', 'removed'
it('changes nothing for an owner whose tick was refused', ...)                 // three taken, lot ticks: 'quantity_exceeded'; her views equal the quiet world's
it('gives buyers from both lists one shared state', ...)                       // mom through A, sis through L: bought 3, the same names and numbers, the same notes; only `mine` flags differ
it('names the other owners on the row', ...)                                   // sharedWith: art on A ['Lot'], lot on L ['Art'], mom and a visitor on A ['Lot'], art on L []
it('tells an owner whom they can unlink, by id', ...)                          // art: [{ id: lot.id, name: 'Lot', canUnlink: true }]; lot: canUnlink false; two owners both named 'Lot' have different ids (Review Focus 4)
it('says whether taking a wish off deletes it', ...)                           // alsoElsewhere true for Bordspel, false for Boek
it('hides a taken-off joint wish the same way in both worlds', ...)            // art deletes it on A in both: art's and lot's views of A are equal across worlds and lack it; mom on A has it removed only in the busy world; L still shows it
it('gives an unlinked person the same list in both worlds', ...)               // art unlinks lot in both: her view of L is equal across worlds, a copy with mine 0, the original gone
it('makes a former owner a buyer again on the other owner\'s list', ...)       // after the unlink, lot on A: role 'buyer' with the purchases
it('reaches no wish through a list that does not show it', ...)                // setPurchase, addNote, updateWish, linkWish, copyWish, unlinkOwner, undoLink with L's token for 'Boek': each 'not_found'
```

- [ ] **Step 2: Run it.** Expected: FAIL, the schemas don't know the new fields.
- [ ] **Step 3: Implement** the three fields in `getListView`.
- [ ] **Step 4: Break it on purpose once:** make an owner's `mine` the sum of all owners' purchases. Run the test, see the joint non-interference tests fail, undo. Then `pnpm test` and `pnpm typecheck`: PASS.
- [ ] **Step 5: Commit** "Build each viewer's list for wishes with several owners".

---

### Task 7: The HTTP API

**Files:**
- Create under `server/api/`: `me/lists.get.ts`, `lists/[token]/leave.post.ts`, `lists/[token]/invites.post.ts`, `lists/[token]/wishes/[id]/link.post.ts`, `copy.post.ts`, `lists/[token]/wishes/[id]/owners/[userId]/index.delete.ts`, `undo.post.ts`, `invites/[invite]/index.get.ts`, `accept.post.ts`, `notices/unseen.get.ts`, `seen.post.ts`, `[id].delete.ts`
- Modify: `server/api/home.get.ts`, `server/utils/http.ts`, `shared/schemas/list.ts`, `test/api-check.sh`

**Interfaces:**
- Consumes: every domain function above.
- Produces: `tokenParam(event, name = 'token')`; `HomeView` gains `notices: NoticeView[]` (empty when logged out).
- Routes and answers. Routes not listed are unchanged; `PATCH` and the image routes now work for an owner of the wish through any list that shows it.

| Route | Who | Answer |
|---|---|---|
| `GET /api/home` | anyone | `HomeView` with `notices` |
| `GET /api/me/lists` | logged in | `MyLists` |
| `DELETE /api/lists/:token` | owner | 204; 409 `list_shared` with several owners |
| `POST /api/lists/:token/leave` | owner | 204; 409 `last_owner` |
| `POST /api/lists/:token/invites` `inviteInput` | owner | 201 `{ invite }` |
| `GET /api/invites/:invite` | logged in | `InviteView`; 401 logged out; 404 unknown |
| `POST /api/invites/:invite/accept` `acceptInput` | logged in | 200 `{ token }`; 409 `invite_closed`; 403 its maker |
| `DELETE /api/lists/:token/wishes/:id` | owner of the list | 204, whatever the wish is shared with |
| `POST …/wishes/:id/link`, `…/copy` `targetInput` | logged in, not an owner of the wish | 201 `{ token, title, wishId }`; 403 for an owner; 409 `wish_removed` or one of the limit codes |
| `DELETE …/wishes/:id/owners/:userId` | owner of the wish | 204; 403 unless they came later |
| `POST …/wishes/:id/owners/:userId/undo` | holder of the notice | 204; 404 otherwise |
| `GET /api/notices/unseen` | logged in | `{ unseen: number }` |
| `POST /api/notices/seen` | logged in | 204 |
| `DELETE /api/notices/:id` | its recipient | 204; 404 otherwise |

- [ ] **Step 1: Extend `test/api-check.sh`** with a fourth person (`register lot Lotte`) and new sections between "remembering opened lists" and "deleting a list", on lists of their own so the earlier byte-for-byte comparisons stay valid. It must check at least:
  - a joint link: art gets 201 and a 22-character token; mom can't make one on art's list (404); a wish of another list in it is 404; an empty `wishIds` is 422;
  - opening it: 401 logged out; 404 for a well-formed unknown token; lot gets the titles and no trace of art's list token; art gets `"state":"own"` and 403 on accept;
  - lot and mom accept at the same moment (two background `curl`s, as the race for the last one): exactly one 200 and one 409 (Review Focus 1); afterwards the link says `"state":"closed"`;
  - art's home has a `joint_link_used` notice naming Lotte; `/api/notices/unseen` goes from 1 to 0 after `POST /api/notices/seen`;
  - the joint wish (3 wanted): art's and lot's lists are saved, then mom buys one through art's list, sis one through lot's, both write a note, lot ticks one. Art's list is byte for byte what it was; lot's differs only by `"mine":1` and has no `purchases`, `notes`, `bought`, `Moeke`, `Zus` or note text; mom and sis both get `"bought":3` with the same three names;
  - the page itself, the way the script already checks `/l/$TOKEN`: the HTML of both lists has no `Moeke`, `Zus` or note text for art, for lot and for a visitor, and has them for mom;
  - art ticks it: 409 `quantity_exceeded`, no name and no number in the answer; lot gets 403 for a note on it;
  - Linked: sis links another wish of art's (201); art has a `wish_linked` notice with `"canUndo":true`; sis changes its title and picture through her own list (200); art's list shows the new title; art's undo is 204; art's list has the old title and old picture, sis's list has a wish with the old title and another id, sis has a `wish_unlinked` notice; a second undo is 404 (Review Focus 2);
  - Copy: mom copies a wish with a picture (201); art gets no notice; mom replaces the picture on her copy and art's picture still answers 200 (Review Focus 5);
  - unlink: lot can't unlink art (403); art unlinks lot (204); lot's list has a copy with `"mine":0`; sis, who bought through lot's list, still gets the original there with `"removed":true`, can't raise (409 `wish_removed`) and can withdraw (204);
  - taking off: after a new link, lot's `DELETE` on her list is 204 and the wish is still on art's list;
  - a joint list: art makes a `list` link, lot accepts; lot's home has the list with `"sharedWith":["Art"]`; a wish lot adds has `"role":"owner"` for art; art's `DELETE` of the list is 409 `list_shared`; lot leaves (204); art leaves as the last owner: 409 `last_owner`; art deletes it (204);
  - dismissing: 204, then 404; another person's notice id is 404.
- [ ] **Step 2: Start a server on an empty database and run it** (`NUXT_DATA_DIR=$(mktemp -d) pnpm dev --port 3112`, then `test/api-check.sh http://localhost:3112`). Expected: FAIL on the first new route.
- [ ] **Step 3: Write the routes.** The undo and dismiss routes pass the domain's `unused` to `removeUploads` before answering.
- [ ] **Step 4: Restart on an empty database and run the check.** Expected: "All checks passed."
- [ ] **Step 5: Commit** "Serve joint wishes, single-use links and notices".

---

### Task 8: The list page: joint tag, removing, unlinking, "Add to my list"

**Files:**
- Create: `app/components/AddToMyList.vue`, `app/components/ListChooser.vue`, `app/composables/useNames.ts`
- Modify: `app/components/WishRow.vue`, `WishEditor.vue`, `WishBuyerDetails.vue`, `WishNotes.vue`, `app/pages/l/[token].vue`, `app/pages/index.vue`, `shared/utils/wish-line.ts`, `i18n/locales/*.json`, `app/assets/css/app.css`
- Test: `test/wish-line.test.ts`

**Interfaces:**
- Consumes: `WishView` with the Task 6 fields, `GET /api/me/lists`, the link, copy and unlink routes.
- Produces `useNames(): (names: string[]) => string` (`Intl.ListFormat`, conjunction, current locale); the two inline copies in the pages go.
- Produces in `wish-line.ts`: `wishOwnerTag(wish: WishView, viewerOwnsList: boolean): { key: 'wish.with', names: string[] } | { key: 'wish.alsoYours' } | null`: the first when `sharedWith` isn't empty, the second for an owner of the wish on a list that isn't theirs, else null.
- Produces `ListChooser.vue`: props `lists: { token: string, title: string }[]`, `last: string | null`, `legend: string`; `v-model: ListTarget | null`. A radio group of the person's lists plus "Een nieuwe lijst" with a name field; `last` is preselected, else the first list, else the new list; null while the new list has no name.
- Produces `AddToMyList.vue`: props `wish: BuyerWish`, `token: string`; emits `added: [list: { token: string, title: string }]`. A button that unfolds a form: two radios, "Gekoppeld" and "Kopie", each with its hint, a `ListChooser` filled from `/api/me/lists` on first opening, and a submit that posts to `…/link` or `…/copy`.
- Changes: `WishRow` props become `wish`, `token`, `open`, `owners: string[]` (the list's owners), `viewerOwnsList: boolean`; it emits `added` upward. `WishEditor` gains the prop `canRemove: boolean`. `WishBuyerDetails` takes `owners: string[]`. `WishNotes` takes `hiddenFrom: string` (the list's owners and `sharedWith`, formatted) instead of `owners`.

- [ ] **Step 1: Tests first** in `test/wish-line.test.ts`: `wishOwnerTag` names the owners who aren't on this list; says "also yours" to an owner on someone else's list; is null for a wish of this list's owners only and for a buyer of a plain wish. Run: FAIL. Implement: PASS.
- [ ] **Step 2: The row.** The tag sits with the amount tag: `wish.with` "met {names}" / "with {names}", `wish.alsoYours` "ook van jou" / "also yours".
- [ ] **Step 3: The owner's unfolded row.** The remove button shows only with `canRemove`. It says `wish.delete` when `alsoElsewhere` is false and `wish.removeFromList` "Van mijn lijst halen" / "Remove from my list" otherwise, with a dialog of its own (`wish.removeTitle`, `wish.removeBody`: the wish leaves this list and stays on the other lists that show it). The editor keeps reporting `busy` while either runs. Below the form, when `coOwners` isn't empty: a heading `joint.sharedWith` "Samen met" / "Shared with", the names, and for each with `canUnlink` a quiet button `unlink.action` "Ontkoppelen" / "Unlink" behind a dialog (`unlink.title` "{name} ontkoppelen van \"{title}\"?", `unlink.body` "{name} krijgt een eigen kopie zonder aankopen. Aan jouw wens verandert niets." and their English versions) that sends `DELETE …/owners/:id` and emits `changed`.
- [ ] **Step 4: The buyer's unfolded row** gets `AddToMyList` under the notes, not for a removed wish. Strings: `add.open` "Op mijn lijst zetten" / "Add to my list"; `add.linked` "Gekoppeld" / "Linked" with `add.linkedHint` "Jullie delen dan één wens, die één keer gekocht wordt. Je ziet daarna niet meer wie hem koopt." / "You then share one wish, bought once. From then on you no longer see who buys it."; `add.copy` "Kopie" / "Copy" with `add.copyHint` "Een eigen wens die losstaat van deze. Niemand krijgt er bericht van." / "A wish of your own, separate from this one. Nobody is told."; `add.which`, `add.newList`, `add.newListName`, `add.submit`. The page says the result in a `role="status"` line with a link to that list (`add.done` "\"{title}\" staat nu op {list}." / "\"{title}\" is now on {list}.") and refreshes; a linked row is then an owner's row. A `wish_removed` answer shows `add.removed` "Deze wens staat niet meer op de lijst." / "This wish is no longer on the list." and refreshes (step one dropped `errors.wish_removed`). `errors.forbidden` is reworded so it also fits a wish: "Dat kan hier niet." / "That isn't possible here."
- [ ] **Step 5: Check in a browser** on a dev server with an empty database, three accounts:
  - as a buyer, "Op mijn lijst zetten" preselects the list used last; with no list at all the new-list field is selected; Kopie puts a separate wish on the chosen list;
  - Gekoppeld: the row turns into an owner's row tagged "ook van jou", the owner's list tags it "met <name>", a second buyer sees the tag and the note hint names both owners;
  - the owner's button says "Van mijn lijst halen" for the joint wish and "Verwijderen" for a plain one; removing leaves it on the other list;
  - Ontkoppelen asks first, Cancel has the focus; afterwards the tag is gone and the other person has a copy;
  - a tag with three long names at 400 px wide wraps and nothing scrolls sideways.
- [ ] **Step 6: Run `pnpm test`, `pnpm typecheck`, and the API check.** Expected: clean. **Commit** "Show joint wishes on a list and add wishes to your own".

---

### Task 9: Making joint, the link page, co-owners and leaving

**Files:**
- Create: `app/pages/j/[token].vue`, `app/components/OneTimeLink.vue`
- Modify: `app/pages/l/[token].vue`, `app/components/WishEditor.vue`, `WishRow.vue`, `i18n/locales/*.json`, `app/assets/css/app.css`

**Interfaces:**
- Consumes: `POST /api/lists/:token/invites`, `GET /api/invites/:invite`, `POST …/accept`, `POST /api/lists/:token/leave`, `ListChooser` (Task 8), `ShareButton`, the `auth` middleware.
- Produces: `WishEditor` and `WishRow` emit `joint: []`.
- Produces `OneTimeLink.vue`: props `path: string`, `text: string`. The text, the full address in a read-only field, and `ShareButton` for the same path.

- [ ] **Step 1: Selecting.** `WishEditor` gets a secondary button `joint.make` "Gezamenlijk maken" / "Make joint", shown with `canRemove`, that emits `joint`; `WishRow` passes it on. The page then enters selection mode with that wish chosen: `selecting: Ref<boolean>`, `selected: Set<number>`. While selecting, the `tick` slot of every wish the viewer owns on their own list holds a checkbox labelled `joint.select` "Kies {title}" instead of `WishTick`, and a bar above the list (`role="group"`) shows `joint.selected` ("Kies de wensen die je wilt delen | {n} wens gekozen | {n} wensen gekozen"), `joint.createLink` "Link maken" (`aria-disabled` at zero) and Cancel. "Link maken" posts `{ kind: 'wishes', wishIds }`, leaves selection mode and shows `OneTimeLink` with `/j/<invite>` and `joint.linkText` "Deze link werkt één keer. Wie hem opent, wordt mede-eigenaar van de gekozen wensen en ziet daarna niet meer wie ze koopt." / "This link works once. Whoever opens it becomes a co-owner of the chosen wishes and from then on no longer sees who buys them."
- [ ] **Step 2: The title band, for an owner.** `list.invite` "Mede-eigenaar uitnodigen" / "Invite a co-owner" posts `{ kind: 'list' }` and shows `OneTimeLink` with `list.inviteText` (works once; makes someone co-owner of the list and of every wish on it). With more than one owner, `list.leave` "Lijst verlaten" / "Leave list" replaces "Lijst verwijderen", behind a dialog (`list.leaveTitle`, `list.leaveBody`: you stop owning the list and the wishes on it that aren't on another list of yours; it stays for {names}); afterwards go to `/`. Add a sentence for each new error code, saying what to do instead: `errors.list_shared` (leave; the last owner can delete), `errors.last_owner` (delete the list), `errors.invite_closed` (ask for a new link).
- [ ] **Step 3: The page a link opens**, `/j/<token>`, with `definePageMeta({ middleware: 'auth' })` so a visitor logs in first and comes back. A 404 is the error page. By `state`:
  - `open`, wishes: the title `invite.wishes` ("{from} deelt een wens met je | {from} deelt {n} wensen met je"), the wishes with `WishThumb` and title, `invite.wishesLead` (pick the list they go on; you become co-owner and no longer see who buys them), `ListChooser` with `mine`, and `invite.accept` "Op mijn lijst zetten". Accepting goes to `/l/<token>`.
  - `open`, list: `invite.list` "{from} nodigt je uit voor \"{title}\"", `invite.listLead` (you become co-owner of the list and every wish on it and no longer see who buys what there), `invite.acceptList` "Mede-eigenaar worden" / "Become a co-owner".
  - `closed`: `invite.closed` "Deze link werkt niet meer. Vraag {from} om een nieuwe." / "This link no longer works. Ask {from} for a new one." A 409 on accepting shows the same line (Review Focus 1).
  - `own`: `invite.own` "Dit is je eigen link. Stuur hem naar de persoon met wie je wilt delen." / "This is your own link. Send it to the person you want to share with."
- [ ] **Step 4: Check in a browser** with two accounts:
  - select two wishes, make a link, open it logged out: the login page, then back on the link; choose a new list, accept: both wishes are there, tagged with the maker's name, and the maker's rows name the accepter;
  - open the same link again, and as its maker: the closed and the own line;
  - the selection works with the keyboard alone, and Cancel restores the ticks;
  - invite a co-owner: after accepting, the list is under "Jouw lijsten" for both, either can add a wish with +, "Lijst verwijderen" has become "Lijst verlaten"; after one leaves, the other has "Lijst verwijderen" again.
- [ ] **Step 5: Run `pnpm test`, `pnpm typecheck`, and the API check.** Expected: clean. **Commit** "Make wishes joint and lists shared with a link that works once".

---

### Task 10: Notices on the home page and the mark in the header

**Files:**
- Create: `shared/utils/notice-line.ts`, `app/composables/useNotices.ts`
- Modify: `app/pages/index.vue`, `app/components/AppHeader.vue`, `shared/utils/wish-line.ts` (the `Translate` type), `i18n/locales/*.json`, `app/assets/css/app.css`
- Test: `test/notice-line.test.ts`

**Interfaces:**
- Consumes: `HomeView.notices`, `HomeList.sharedWith`, `GET /api/notices/unseen`, `POST /api/notices/seen`, `DELETE /api/notices/:id`, `POST …/owners/:userId/undo`.
- Produces: `Translate` gains the overload `(key: string, named: Record<string, unknown>, plural: number): string`. `noticeLine(notice: NoticeView, t: Translate): string` = `t('notice.' + kind, { actor, title, n: more }, more)`.
- Produces `useNotices()`: `{ unseen: Ref<number>, markSeen(): Promise<void> }`. `unseen` comes from `useFetch('/api/notices/unseen')` when logged in, under one key so the header and the home page share it; `markSeen` posts and sets it to 0.

- [ ] **Step 1: Tests first** in `test/notice-line.test.ts`, with the key-echoing `t` of `test/wish-line.test.ts`: each kind uses its own key; `joint_link_used` passes `more` as the plural. Run: FAIL. Implement: PASS.
- [ ] **Step 2: Strings.** `home.notices` "Meldingen" / "Notices"; `notice.wish_linked` "{actor} zette \"{title}\" ook op een eigen lijst. Jullie delen die wens nu." / "{actor} added \"{title}\" to a list of their own. You now share that wish."; `notice.wish_unlinked` "{actor} heeft je losgekoppeld van \"{title}\". Je hebt nu een eigen kopie." / "{actor} unlinked you from \"{title}\". You now have a copy of your own."; `notice.joint_link_used` "{actor} gebruikte je link. \"{title}\" is nu ook van {actor}. | {actor} gebruikte je link. \"{title}\" en nog {n} andere wens zijn nu ook van {actor}. | {actor} gebruikte je link. \"{title}\" en nog {n} andere wensen zijn nu ook van {actor}." with the English forms; `notice.list_joined` "{actor} is nu mede-eigenaar van \"{title}\"." / "{actor} is now a co-owner of \"{title}\"."; `notice.undo` "Ongedaan maken" / "Undo"; `notice.dismiss` "Sluiten" / "Dismiss"; `notice.view` "Bekijken" / "View"; `nav.newNotices` "{n} nieuwe melding | {n} nieuwe meldingen".
- [ ] **Step 3: The home page.** A joint list's row reads "7 wensen · met Lotte" (`sharedWith` through `useNames`). A third section, "Meldingen", shows for a logged-in person with notices: one row each with the sentence, a "Bekijken" link to `/l/<token>#wish-<id>` when `token` isn't null, "Ongedaan maken" when `canUndo`, and "Sluiten". Undo posts to `/api/lists/<token>/wishes/<wishId>/owners/<actorId>/undo`; both buttons refresh the home data, and a 404 refreshes too and shows `errors.not_found` (Review Focus 2). The focus goes to the section's heading when the focused row disappears, as for "Lijsten die je opende". On mount the page calls `markSeen()`.
- [ ] **Step 4: The header.** The "Lijsten" link carries a small mark (`.nav-mark`, candidate for Gesso) with a visually hidden `nav.newNotices` while `unseen > 0`. `headerKey` includes whether there is a mark, because `<art-header>` reads its children once.
- [ ] **Step 5: Check in a browser** with two accounts: link a wish as the second; the first has the mark on every page until the home page was opened, and the notice with "Ongedaan maken"; change the title and the picture as the linker, undo as the owner: the wish is as it was, the notice is gone, the linker has a copy and a notice of their own; dismiss a notice in one tab and press Undo on it in another: the message shows and the row goes; no hydration warnings.
- [ ] **Step 6: Run `pnpm test`, `pnpm typecheck`, and the API check.** Expected: clean. **Commit** "Show notices on the home page, with undo".

---

### Task 11: Tidy up and prove it in the container

**Files:**
- Modify: `README.md`, `i18n/locales/*.json`, `app/assets/css/app.css`

- [ ] **Step 1: Remove what nothing uses:** locale keys (compare the keys used in `app/` and `shared/` with both files; both must have the same keys), styles, props and components without users.
- [ ] **Step 2: Rewrite the README:** "Who sees what" (owners follow from the lists that show a wish; each owner sees only their own tick; taken-off wishes and who still gets them; a former owner is a buyer again), "How it is put together" (`placement.ts` and the one rule, single-use links, Linked and Copy, what a link remembers and when it forgets, notices, pictures shared between wishes), the list of rules that keep an owner from finding out by a detour (unlink, undo and leaving answer the same whatever was bought), and "Not included" (joint wishes leave it; add: notices stay inside the site, a single-use link can't be withdrawn, nobody is told when someone leaves a list).
- [ ] **Step 3: Build and check the image:** `docker compose -p wishlist-check --env-file <a temp file with NUXT_APP_SECRET, NUXT_SESSION_COOKIE_SECURE=false, PORT=3201> up -d --build`, run `test/api-check.sh http://localhost:3201`, which now also fetches the pages of the joint wish as each owner, a visitor and a buyer, then `down -v --rmi local`. Expected: "All checks passed."
- [ ] **Step 4: Run `pnpm test` and `pnpm typecheck`.** Expected: clean.
- [ ] **Step 5: Commit** "Document joint wishes and remove leftovers".
