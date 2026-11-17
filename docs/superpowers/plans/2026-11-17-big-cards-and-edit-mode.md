# Big open wishes and an edit mode: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An open wish grows into a card with its picture at full width, and an owner of a list gets an edit mode (button or long press) to select several wishes to delete or make joint, and to reorder wishes by drag or keyboard.

**Architecture:** A `position` per placement (`list_wishes`) gives every list an order of its own, set by its owners and the same for every viewer. Two new domain actions, `reorderWishes` and `deleteWishes`, sit next to `deleteWish` in `server/domain/wishes.ts` and go through the existing placement rules. On the page, edit mode replaces today's joint selection; its state lives in a composable, and long press and drag are two small composables built on pointer events, without a library.

**Tech Stack:** Nuxt 4.6, Vue 3.5, Drizzle 0.45 + better-sqlite3, @nuxtjs/i18n 10, zod 4, Vitest 5, Gesso 1.2.5.

**Spec:** `docs/superpowers/specs/2026-11-17-big-cards-and-edit-mode-design.md`.

## Global Constraints

- Reordering and deleting stay blind to purchases: they answer the same way whatever buyers did. `server/domain/wishes.ts` never mentions purchases or notes (a test reads the sources).
- Every way a wish leaves a list goes through `takeOffList` in `server/domain/placement.ts`. A joint wish also on another live list only comes off this one.
- The order is the same for everyone and depends on nothing but what owners did: `list_wishes.position`, then `wishes.created_at`, then `wishes.id`.
- New placements, and wishes that come back to a list, get `position` = highest position on that list + 1. The copy `unlink` leaves behind takes the original placement's `position`.
- Domain functions are synchronous, take a db handle, and each exported action runs in one `db.transaction(..., { behavior: 'immediate' })`. Routes stay thin: `requireUser`, `tokenParam`, `readInput`, `domain`.
- The migration is added with `pnpm db:generate`; the earlier migration files are not touched.
- Edit mode exists only while `canManage` (viewer owns the list, list not deleted).
- Long press: about 500 ms without moving more than 8px. Keyboard saves wait about 400 ms after the last arrow press. The open card's picture height cap is about `min(70vh, 32rem)`, shown whole (`object-fit: contain`).
- Every new string exists in `i18n/locales/nl.json` and `en.json`, plain, sentence case, in the tone of the existing ones. Counts use the existing `a | b | c` plural form.
- Everything visual uses Gesso tokens; new styles go in `app/assets/css/app.css`. Dialogs follow the existing native `<dialog>` pattern with the safe button focused (`WishEditor.vue`).
- Focus never drops to the page start after a change.
- Run `pnpm test` and `pnpm typecheck` after every task; both clean. One commit per task, imperative sentence, ending with the `Co-Authored-By` trailer the session gives.

## Review Focus

1. **A quick swipe over a row on the phone must scroll, not start a long press or a drag.** Movement over 8px, `pointercancel`, or a scroll before 500 ms cancels the press (Task 5).
2. **A long press on a control inside the row (the tick or stepper, a tag, an editable title, the handle) must not enter edit mode.** Only presses that land on the row's toggle area or picture count (Task 5).
3. **A co-owner changed the list while you were editing.** A reorder with ids that are gone or missing, or a delete of a wish already taken off, must not fail the rest (Task 2 tests).
4. **Deleting every wish in edit mode.** With nothing left, edit mode ends by itself, the Edit button hides, the quick-add row comes back, and focus goes to the "Wensen" heading (Task 4).
5. **Arrow keys at the top or bottom of the list** do nothing, send no request, and keep focus on the handle (Task 6).

---

### Task 1: Positions on placements

**Files:**
- Modify: `server/db/schema.ts` (`listWishes`)
- Create: `server/db/migrations/0002_*.sql` (generated, plus a backfill)
- Modify: `server/domain/placement.ts` (`putOnList`)
- Modify: `server/domain/sharing.ts` (`unlink`)
- Modify: `server/domain/list-view.ts:181` (owner/buyer rows order)
- Modify: `server/domain/public-wishes.ts` (`livePublicWishes` order)
- Modify: `README.md` (Placements paragraph; drop "reordering wishes" from the not-in-this-version list)
- Create: `test/order.test.ts`
- Modify: `test/sharing.test.ts`

**Interfaces:**
- Produces: `listWishes.position: integer not null default 0`. `putOnList(db: Db, listId: number, wishId: number, position?: number): void`. All three list readers order by position.

- [ ] **Step 1: Write the failing tests** in `test/order.test.ts` (use `setup`-style helpers from `test/helpers.ts`):
  - `shows wishes in the order they were added` — add A, B, C; `titles(getListView(...))` is `['A','B','C']` for the owner, a buyer and a logged-out viewer.
  - `puts a wish that comes back at the bottom` — add A, B, C; `deleteWish` A; `putOnList(db, listId, a.id)`; owner's titles are `['B','C','A']`.
  - `puts a linked wish at the bottom` — mom's list has X (made first); art's list has A, B; `linkWish` X onto art's list; art's titles end with `X`.
  And in `test/sharing.test.ts`:
  - `keeps the copy where the wish was when someone is unlinked` — lot's list has L1, J, L2 where J is joint (linked from art, art first); art unlinks lot; lot's titles are `['L1', 'J', 'L2']` (the copy in J's place), even after `db.update(listWishes).set({ position })` has made the order differ from `created_at`.

- [ ] **Step 2: Run them and see them fail.** Run: `pnpm vitest run test/order.test.ts test/sharing.test.ts`. Expected: the bottom/keeps-place tests FAIL (positions don't exist yet / order follows `created_at`).

- [ ] **Step 3: Add the column and migration.** Add `position: integer('position').notNull().default(0)` to `listWishes` with a one-line comment ("Where the wish stands on this list; set by the list's owners."). Run `pnpm db:generate`. Append the backfill to the generated SQL, after a `--> statement-breakpoint`:

```sql
UPDATE `list_wishes` SET `position` = (
  SELECT COUNT(*) FROM `list_wishes` AS `o`
  INNER JOIN `wishes` AS `ow` ON `ow`.`id` = `o`.`wish_id`
  INNER JOIN `wishes` AS `w` ON `w`.`id` = `list_wishes`.`wish_id`
  WHERE `o`.`list_id` = `list_wishes`.`list_id`
    AND (`ow`.`created_at` < `w`.`created_at` OR (`ow`.`created_at` = `w`.`created_at` AND `ow`.`id` < `w`.`id`))
);
```

- [ ] **Step 4: `putOnList` sets the position.** With no `position` argument, use `max(position) + 1` over all placements on that list (live or not; 0 for an empty list), both for a new row and for one that comes back. With an argument, use it as given. Update its doc comment.

- [ ] **Step 5: `unlink` passes the original placement's position.** Read `listWishes.position` for `(listId, wishId)` before `takeOffList` (it doesn't change it) and pass it to `putOnList` for the copy. Replace the comment on `createdAt` so it says the copy keeps the original's `created_at` and its position, which together keep its place.

- [ ] **Step 6: Order by position everywhere.** In `list-view.ts` (the `rows` query) and `livePublicWishes`: `.orderBy(asc(listWishes.position), asc(wishes.createdAt), asc(wishes.id))`. Update `livePublicWishes`' doc comment ("in the list's order"). Update `README.md` as listed above.

- [ ] **Step 7: Run everything.** Run: `pnpm test && pnpm typecheck`. Expected: all pass, the new tests included.

- [ ] **Step 8: Commit.** `git add -A server test README.md && git commit` with "Give each list an order of its own".

---

### Task 2: Reorder and delete several, on the server

**Files:**
- Modify: `shared/schemas/input.ts`
- Modify: `server/domain/wishes.ts`
- Create: `server/api/lists/[token]/order.put.ts`
- Create: `server/api/lists/[token]/wishes/delete.post.ts`
- Modify: `test/order.test.ts`, `test/wishes.test.ts`, `test/visibility.test.ts`
- Modify: `test/api-check.sh` (two checks: a non-owner gets 404 on both new routes)

**Interfaces:**
- Consumes: `listWishes.position` (Task 1).
- Produces: `wishIdsInput = z.strictObject({ wishIds: z.array(positive int).min(1).max(200) })`, refusing duplicates with `'invalid'`. `reorderWishes(db: Db, userId: number, token: string, wishIds: number[]): void`. `deleteWishes(db: Db, userId: number, token: string, wishIds: number[]): void`. `PUT /api/lists/:token/order` and `POST /api/lists/:token/wishes/delete`, body `{ wishIds }`, both answer 204.

- [ ] **Step 1: Write the failing tests.**
  In `test/order.test.ts`:
  - `reorders the wishes` — A, B, C; `reorderWishes(db, art.id, token, [c, a, b])`; titles `['C','A','B']` for the owner and a logged-out viewer.
  - `keeps the wishes left out after the ones given, in their order` — A, B, C, D; reorder `[d, b]`; titles `['D','B','A','C']`.
  - `ignores ids that are not on the list now` — A, B; mom's wish M; A deleted; reorder `[m, a, b]`; titles `['B']`, and mom's list is unchanged.
  - `refuses someone who doesn't own the list` — `codeOf(() => reorderWishes(db, mom.id, token, [a]))` is `'not_found'`.
  - `refuses duplicate ids` — `wishIdsInput.safeParse({ wishIds: [1, 1] }).success` is `false`.
  In `test/wishes.test.ts`:
  - `deletes several wishes at once` — A, B, C; `deleteWishes(..., [a, c])`; titles `['B']`; A and C have `deletedAt` set.
  - `takes a joint wish off this list only` — J on art's and lot's lists; `deleteWishes(art, [j])`; J is still on lot's list with lot as only owner (`expectOwnersSettled`).
  - `skips wishes that are already gone` — A, B; `deleteWish` A; `deleteWishes(..., [a, b])` doesn't throw; titles `[]`.
  - `refuses someone who doesn't own the list` — `'not_found'`.
  In `test/visibility.test.ts`, next to the existing "same whether or not anyone bought" checks:
  - `reorders and deletes several the same way whether or not anyone bought` — two identical setups, one with a purchase by mom on B; both `reorderWishes` and `deleteWishes` return without throwing, and the owner's views afterwards are equal.

- [ ] **Step 2: Run them and see them fail.** Run: `pnpm vitest run test/order.test.ts test/wishes.test.ts test/visibility.test.ts`. Expected: FAIL, `reorderWishes`/`deleteWishes`/`wishIdsInput` not exported.

- [ ] **Step 3: Add `wishIdsInput`** to `shared/schemas/input.ts`, with a comment that 200 is the live-wish limit of a list (`MAX_LIVE_WISHES`).

- [ ] **Step 4: Implement `reorderWishes`.** One transaction: `ownedListId`, then the live placements on the list in their current order (same `orderBy` as Task 1, filtered with `onListNow`), then new order = given ids that are live (in given order) followed by the remaining live ids (in current order); write `position = index` for each. Doc comment: why the left-out wishes keep their order (a co-owner's addition made meanwhile isn't lost).

- [ ] **Step 5: Implement `deleteWishes`** and make `deleteWish` call it with one id, keeping its `not_found` for a single wish that isn't live (the existing tests pin that). For several: skip ids that aren't live on the list; each live one goes through `takeOffList`. One transaction.

- [ ] **Step 6: Add the two routes**, shaped like `server/api/lists/[token]/wishes/[id]/index.delete.ts`: `requireUser`, `tokenParam`, `readInput(event, wishIdsInput)`, `domain(...)`, `sendNoContent(event)`. Add the two 404 checks to `test/api-check.sh`.

- [ ] **Step 7: Run everything.** Run: `pnpm test && pnpm typecheck`. Expected: all pass.

- [ ] **Step 8: Commit.** "Reorder a list and delete several wishes at once".

---

### Task 3: An open wish is a big card

**Files:**
- Modify: `app/components/WishRow.vue`
- Modify: `app/components/WishEditor.vue` (drop `WishPictureEdit` from it)
- Modify: `app/components/WishPictureEdit.vue` (only if a class hook is needed for the big frame)
- Modify: `app/assets/css/app.css` (`.wish-row.open`, `.wish-picture`, `.picture-edit-*` in the card)

**Interfaces:**
- Produces: nothing new for later tasks. `WishRow`'s props and events are unchanged.

- [ ] **Step 1: Picture at the top of the card.** In `WishRow`'s details, before the `message` slot: for an owner (`ownWish`), `<WishPictureEdit :wish="ownWish" :saving="saving" />`; for anyone else with `wish.image`, `<img class="wish-picture" :src="wish.image" alt="" decoding="async">`. Remove `WishPictureEdit` from `WishEditor`.

- [ ] **Step 2: Style the card.** `.wish-row.open` gets a raised Gesso surface with padding (builder's choice of tokens). `.wish-picture` and the picture editor's image, when shown: full row width, `max-block-size: min(70vh, 32rem)`, `object-fit: contain`, on `var(--surface-sunken)`. In an open row that shows a big picture, hide the head's `.wish-thumb`. An owner's wish without a picture keeps the editor's small "add a picture" control. The details body's start padding (`calc(var(--wish-tick-room) + 3rem + var(--space-3))`) still lines the text up with the title.

- [ ] **Step 3: Check it in the browser** (dev server, `pnpm dev`), at desktop width and at 390px: a buyer's open wish with a portrait and a landscape picture shows each whole; one without a picture has no empty frame; an owner's open wish changes and removes its picture from the big frame; several rows open at once; `#wish-<id>` links still open and scroll to the row; light and dark scheme.

- [ ] **Step 4: Run checks.** Run: `pnpm test && pnpm typecheck`. Expected: clean.

- [ ] **Step 5: Commit.** "Open a wish as a card with its picture at full width".

---

### Task 4: Edit mode: select, delete, make joint

**Files:**
- Create: `app/composables/useListEdit.ts`
- Modify: `app/pages/l/[token].vue` (replaces `selecting`, `selected`, `pickable`, `startSelecting`, `choose`, `stopSelecting`, `makeWishLink` and the joint bar)
- Modify: `app/components/WishRow.vue`
- Modify: `app/assets/css/app.css` (the bar, the checkbox in place of the tick, the `.joint-bar` styles renamed or reused)
- Modify: `i18n/locales/en.json`, `i18n/locales/nl.json`
- Modify: `README.md` (the "Make joint" sentence under single-use links)

**Interfaces:**
- Consumes: `POST /api/lists/:token/wishes/delete` (Task 2); `POST /api/lists/:token/invites` with `{ kind: 'wishes', wishIds }` (existing).
- Produces:
  - `WishRow` new props `editMode: boolean`, `selected: boolean`; new event `select: [selected: boolean]`; new slot `end` (after the tags, for Task 6's handle); `defineExpose({ settle })` where `settle(): Promise<boolean>` waits for the row's saves (`saving.whenSaved`) and resolves `false` after focusing the field when a row holds `[aria-invalid="true"]`, otherwise `true`.
  - `useListEdit(options: { token: () => string, wishes: () => WishView[], refresh: () => Promise<unknown>, open: Set<number>, rows: Map<number, { settle: () => Promise<boolean> }> })` returning `{ editing: Ref<boolean>, selected: Set<number>, enter(wishId?: number): Promise<boolean>, leave(): Promise<void>, toggle(id: number, on: boolean): void, deleteSelected(): Promise<void>, makeLink(): Promise<string | null>, error: Ref<string>, busy: Ref<boolean> }`. `enter` settles every open row first and returns `false` without entering when one refuses; otherwise it clears `open`, sets `editing`, selects `wishId` if given.
  - i18n namespace `listEdit`: `start` ("Edit" / "Bewerken"), `done` ("Done" / "Klaar"), `selected` (count, plural, with a zero form like `joint.selected`), `delete` ("Delete" / "Verwijderen"), `deleteTitle` ("Delete this wish? | Delete {n} wishes?"), `deleteBody`, `deleteBodyElsewhere` (those also on another list only come off this one), `deleteConfirm`, `move` ("Move {title}"), `position` ("{title}, {n} of {total}"). `joint.make` is reused for the bar's Make joint; `joint.select`, `joint.cancel`, `joint.createLink` go if nothing uses them any more.

- [ ] **Step 1: Row in edit mode.** In `WishRow`, when `editMode`: the stretched `.wish-toggle` button becomes a `<label>` for the row's checkbox (`:for="`pick-${wish.id}`"`), showing title and line, so tapping the row toggles the box; the details stay closed. Add the `end` slot and `settle` (expose).

- [ ] **Step 2: `useListEdit`**, with the behaviour in its Interfaces line. `deleteSelected` posts the selected ids that are still on the list, refreshes, clears the selection, and keeps edit mode on; on error it sets `error` and refreshes. `makeLink` posts the invite (only ids still on the list), leaves edit mode on success and returns the path (`localePath('/j/' + invite)`); maps a `wishIds` field error to `joint.tooMany`. A watcher leaves edit mode when the list has no wishes left.

- [ ] **Step 3: Wire the page.** A function `:ref` on each `WishRow` fills the `rows` map (delete on unmount). In edit mode the `#tick` slot renders the checkbox (`id="pick-<id>"`, `.wish-tick.joint-pick` look) for every row. An **Edit** button (`listEdit.start`) in the section head next to the `h2`, shown when `canManage && wishes.length && !editing`. The bar above the list while `editing`: count (`role="status"`, `tabindex="-1"` so focus can land on it), **Delete** (opens the dialog), **Make joint**, **Done**; Delete and Make joint `aria-disabled` with nothing selected. The quick-add row is hidden while editing. `WishRow`'s `@joint` calls `enter(wish.id)`. Escape (on `document`, ignored while a dialog is open) and Done call `leave`, which puts focus on the Edit button; when the list is empty, on the `wishesTitle` heading.

- [ ] **Step 4: The delete dialog**, after `list-delete` in the page: title `listEdit.deleteTitle` with the count; body `deleteBody`, plus `deleteBodyElsewhere` when any selected wish has `alsoElsewhere`; buttons Cancel (focused) and `deleteConfirm`. On confirm: `deleteSelected`, then focus the bar's count.

- [ ] **Step 5: Strings** in both locale files; update the README's "Make joint" sentence (owners select wishes in edit mode).

- [ ] **Step 6: Check it in the browser.** Edit button enters with nothing selected; "Gezamenlijk maken" in an open wish enters with that wish selected; an open wish with a failed save (stop the dev server, edit a field, restart) keeps edit mode from starting and gets focus; tapping a row toggles its box; Delete with two wishes, one joint with another list, shows the extra sentence and leaves the joint one on the other list; deleting every wish ends edit mode (Review Focus 4); Make joint gives the one-time link; Escape and Done return focus to Edit; a buyer and a logged-out visitor never see Edit.

- [ ] **Step 7: Run checks.** `pnpm test && pnpm typecheck`. Clean.

- [ ] **Step 8: Commit.** "Select wishes in an edit mode to delete or share them".

---

### Task 5: Long press enters edit mode

**Files:**
- Create: `app/composables/useLongPress.ts`
- Modify: `app/pages/l/[token].vue`
- Modify: `app/assets/css/app.css`

**Interfaces:**
- Consumes: `useListEdit().enter` (Task 4).
- Produces: `useLongPress(target: Ref<HTMLElement | null>, options: { enabled: () => boolean, onPress: (wishId: number, event: PointerEvent) => void, ms?: number, slop?: number })`. Delegated on the list element: a press counts when `pointerdown` lands inside a `li.wish-row` head but not inside `.wish-tick, .wish-tags, .inline-edit, .wish-handle, a, input` (Review Focus 2). `ms` defaults to 500, `slop` to 8. `onPress` receives the original `pointerdown` so Task 6 can continue the same pointer into a drag.

- [ ] **Step 1: Implement `useLongPress`.** Start a timer on `pointerdown` (primary button or touch only); cancel on `pointerup`, `pointercancel`, a move beyond `slop`, or a `scroll` (Review Focus 1). When it fires: `navigator.vibrate?.(10)`, call `onPress`, and swallow the next `click` with a one-time capturing listener so the row doesn't open. Prevent `contextmenu` on the list while `enabled()`. Clean up listeners on unmount.

- [ ] **Step 2: Wire it** on the `ul.wish-list` with `enabled: () => canManage.value` and `onPress: wishId => edit.enter(wishId)` (Task 6 extends this to continue into a drag).

- [ ] **Step 3: No phone menu on the rows.** For a list the viewer can manage (a class on the `ul`, e.g. `.wish-list.manageable`): `.wish-head` and `.wish-thumb` get `user-select: none; -webkit-user-select: none; -webkit-touch-callout: none`; `img` there gets `-webkit-user-drag: none`.

- [ ] **Step 4: Check it** with touch emulation in Chrome devtools and on a phone if one is at hand: holding a row enters edit mode with it selected and doesn't open it; a quick swipe scrolls; holding the stepper, a tag or the tick does nothing special; no save-image or text-selection menu appears; on a buyer's view a long press does nothing.

- [ ] **Step 5: Run checks.** `pnpm test && pnpm typecheck`. Clean.

- [ ] **Step 6: Commit.** "Enter edit mode by holding a wish".

---

### Task 6: Reorder by drag and by keyboard

**Files:**
- Create: `app/composables/useDragReorder.ts`
- Modify: `app/pages/l/[token].vue`
- Modify: `app/composables/useListEdit.ts` (order and saving)
- Modify: `app/assets/css/app.css` (`.wish-handle`, the dragged row)

**Interfaces:**
- Consumes: `PUT /api/lists/:token/order` (Task 2); `WishRow` slot `end` (Task 4); `useLongPress` `onPress(wishId, event)` (Task 5).
- Produces:
  - `useListEdit` gains `order: Ref<number[]>` (the ids in their shown order while editing; the page renders `wishes` sorted by it while `editing`), `move(id: number, to: number): void`, and `saveOrder(options?: { delay?: number }): void`. `saveOrder` sends the whole `order`; with `delay` it waits that long after the last call (400 for keyboard). On failure: `error` is set and the list refreshes, which resets `order`.
  - `useDragReorder(options: { list: Ref<HTMLElement | null>, order: Ref<number[]>, move: (id: number, to: number) => void, onDrop: () => void })` returning `{ start(wishId: number, event: PointerEvent): void, dragging: Ref<number | null> }`.

- [ ] **Step 1: The handle.** In the `#end` slot while editing: `<button type="button" class="wish-handle" :aria-label="t('listEdit.move', { title })" aria-describedby="<live region id>">` with a ⠿ grip (`aria-hidden`), `touch-action: none`. `pointerdown` on it calls `drag.start(wish.id, event)`. `keydown` ArrowUp/ArrowDown calls `move` by one place, `saveOrder({ delay: 400 })`, and writes `listEdit.position` into a polite live region; at the ends it does nothing (Review Focus 5). After the move, focus stays on the same handle (`nextTick` + refocus if Vue re-created it).

- [ ] **Step 2: `useDragReorder`.** `start` captures the pointer, then on `pointermove` translates the dragged row with the pointer and calls `move` when it crosses a neighbour's midpoint; near the viewport's top or bottom edge (about 48px) it scrolls the page each frame. On `pointerup` it calls `onDrop`; on `pointercancel` too. While a touch drag is on, a non-passive `touchmove` listener on the list (registered once on mount, acting only while `dragging` is set) calls `preventDefault` so the page doesn't scroll under the finger. How the row and gap are drawn is the builder's call (spec, "Left to the builder").

- [ ] **Step 3: Drag after a long press.** Change Task 5's `onPress` to `async (wishId, event) => { if (await edit.enter(wishId)) drag.start(wishId, event) }`. A drag that never moves leaves the order unchanged and sends nothing.

- [ ] **Step 4: Save on drop.** `onDrop` calls `saveOrder()` when the order changed. Leaving edit mode flushes a pending delayed save first.

- [ ] **Step 5: Check it in the browser**: mouse drag on the handle; touch drag on the handle and by holding a row (devtools touch emulation); auto-scroll in a list taller than the screen; keyboard ↑/↓ with VoiceOver announcing "<title>, 3 of 10"; reload shows the saved order, also for a logged-out visitor in another browser; a failed save (stop the server mid-drag) shows the error and puts the server's order back.

- [ ] **Step 6: Run checks.** `pnpm test && pnpm typecheck`. Clean.

- [ ] **Step 7: Commit.** "Reorder wishes by dragging or with the arrow keys".
