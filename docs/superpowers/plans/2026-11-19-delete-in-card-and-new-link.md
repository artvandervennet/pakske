# Delete in the card, and a new link for a list: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An owner can delete one wish from its opened card, and can give a list a new link whose old link only lets a buyer take back their own ticks.

**Architecture:** The delete button reuses the route that exists. A new link keeps the list's row and swaps its token; the replaced token goes to `list_old_tokens`. An old token resolves in two places only: the list view (a bare view of the viewer's own ticks, or "moved" for an owner) and lowering or withdrawing a purchase.

**Tech Stack:** Nuxt 4, Vue 3, drizzle-orm on better-sqlite3, zod, vitest, @nuxtjs/i18n, the Gesso components (`art-button`, `<dialog class="dialog">`).

**Spec:** `docs/superpowers/specs/2026-11-19-friends-design.md` (steps 1 and 2 of its "Order of work"; friends are a later plan).

## Global Constraints

- The link is the one key to a list. Nothing here adds another way in.
- An owner never learns anything about purchases or notes. `server/domain/lists.ts` and `server/domain/placement.ts` read neither; `test/placement.test.ts` fails if the words `purchases` or `notes` appear anywhere in `placement.ts`, comments included.
- An answer to an owner or a logged-out visitor is the same whatever buyers did (`test/visibility.test.ts`).
- Every sentence exists in `i18n/locales/nl.json` and `en.json`, same keys in the same order, round quotes only (`test/locales.test.ts`).
- Comments and docs in the repo's voice: plain sentences that say why.
- Logged-in checks: a git worktree, the Firebase stand-in, `nuxt dev --port 3112`. Never port 3400, never a second `nuxt dev` in the main checkout.
- One commit per task, message ending with `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`. Nothing is pushed.

## Review Focus

1. **A second new link.** A buyer who ticked before the first one opens the first old link after the second: they still get their ticks. (Task 3 test.)
2. **Giving more through an old link.** Raising a tick, ticking another wish of that list, writing a note, "Op mijn lijst": all "not found", never a new purchase. (Task 3 tests.)
3. **An old link of a list that was deleted afterwards.** The buyer still gets their ticks; an owner gets "not found", not a redirect to a deleted list. (Task 3 test.)
4. **Share links and notices made before the new link.** Accepting a `/j/` link afterwards lands on the new address; a notice's "Bekijken" too. (Task 2 test.)
5. **A page still open at the old address.** An owner's save or a buyer's refresh there gets 404 and the page says the list is gone; nothing is written. (Task 4 api-check lines.)

---

### Task 1: A delete button in an owner's opened wish

**Files:**
- Modify: `app/components/WishEditor.vue`, `app/components/WishRow.vue`, `app/pages/l/[token].vue`
- Modify: `i18n/locales/nl.json`, `i18n/locales/en.json`, `docs/how-it-works.md`

**Interfaces:**
- Consumes: `DELETE /api/lists/[token]/wishes/[id]` (exists, answers 204); `props.saving.url()` in `WishEditor.vue` is that address.
- Produces: `WishEditor` prop `canDelete: boolean` and emit `deleted: []`; `WishRow` emit `deleted: []`.

- [ ] **Step 1: Add the sentences** under `wish` in both locale files, after the last existing `wish` key:

| key | nl | en |
| --- | --- | --- |
| `deleteTitle` | `“{title}” verwijderen?` | `Delete “{title}”?` |
| `deleteBody` | `Hij verdwijnt van je lijst. Dat kun je niet ongedaan maken.` | `It disappears from your list. You can’t undo that.` |
| `deleteBodyElsewhere` | `Hij staat ook op een andere lijst en verdwijnt alleen van deze.` | `It is on another list too, and only disappears from this one.` |
| `deleted` | `“{title}” is van je lijst gehaald.` | `“{title}” was taken off your list.` |

- [ ] **Step 2: The button and its dialog in `WishEditor.vue`.** A quiet `art-button` with `t('listEdit.delete')` at the end of `.wish-card-foot`, only when `canDelete`. It opens a `<dialog class="dialog">` built like the unlink dialog in the same file: title `wish.deleteTitle`, text `wish.deleteBodyElsewhere` when `wish.alsoElsewhere` else `wish.deleteBody`, buttons `listEdit.deleteCancel` (autofocus) and `listEdit.deleteConfirm` (`value="delete"`). On that answer: `$fetch(props.saving.url(), { method: 'DELETE' })`, then `emit('deleted')`; a failure goes to `actionError`. The existing `busy` guards it. Rewrite the file's comment that says deleting lives in edit mode only.

- [ ] **Step 3: Pass it through.** `WishRow.vue`: `:can-delete="viewerOwnsList"` on `WishEditor`, and re-emit `deleted`. `app/pages/l/[token].vue`: `@deleted="onWishDeleted(wish)"`, which closes the row (`open.delete(wish.id)`), sets `goneNotice` to `t('wish.deleted', { title: wish.title })`, refreshes, and focuses `wishesTitle`.

- [ ] **Step 4: `docs/how-it-works.md`.** In "The opened wish", replace "It has no delete button: deleting wishes is in the list's edit mode." with one sentence: the card of a wish on a list you own has "Delete", which asks first; edit mode deletes several at once.

- [ ] **Step 5: Verify.** `pnpm test` and `pnpm typecheck` pass. On the scratch server in headless Chrome: open an own wish, press Verwijderen, Annuleren keeps it; confirm removes the row, the notice names it, the focus is on "Wensen". A joint wish seen on someone else's list has no button.

- [ ] **Step 6: Commit** `Put a delete button in an opened wish of your own, which asks first`.

---

### Task 2: A list gets a new link

**Files:**
- Modify: `server/db/schema.ts` (+ migration from `pnpm db:generate`), `server/domain/lists.ts`, `shared/schemas/list.ts` (`NoticeKind`), `i18n/locales/*.json` (`notice.list_relinked`), `app/pages/index.vue` only if notices are rendered per kind there
- Test: `test/lists.test.ts`, `test/invites.test.ts`, `test/visits.test.ts`

**Interfaces:**
- Produces: table `listOldTokens` (`token` text unique not null, `listId` integer not null references `lists.id` on delete cascade, `replacedAt` timestamp_ms); `relinkList(db: Db, userId: number, token: string): { token: string }`; notice kind `'list_relinked'`.

- [ ] **Step 1: Write the failing tests** in `test/lists.test.ts`, a new `describe('a new link for a list')`:

```ts
it('gives the list another address and keeps everything on it', () => {
  const { db, art } = setup()
  const old = addList(db, art.id, 'Kerst')
  addWishTo(db, art.id, old, 'Sokken')
  const { token } = relinkList(db, art.id, old)
  expect(token).toMatch(LIST_TOKEN)
  expect(token).not.toBe(old)
  expect(titles(getListView(db, token, art.id))).toEqual(['Sokken'])
  expect(getListView(db, old, null)).toBeUndefined()
  expect(listOwnedLists(db, art.id).map(list => list.token)).toEqual([token])
})

it('is only for an owner of a live list', () => {
  const { db, art, mom } = setup()
  const token = addList(db, art.id)
  expect(codeOf(() => relinkList(db, mom.id, token))).toBe('not_found')
  deleteList(db, art.id, token)
  expect(codeOf(() => relinkList(db, art.id, token))).toBe('not_found')
})

it('takes the list off the visited lists of everyone who does not own it, and tells the other owners', () => {
  const { db, art, mom } = setup()
  const sis = addUser(db, 'sis')
  const old = addList(db, art.id, 'Kerst')
  addOwner(db, old, sis.id)
  rememberList(db, mom.id, old)
  rememberList(db, sis.id, old)
  const { token } = relinkList(db, art.id, old)
  expect(listOpenedLists(db, mom.id)).toEqual([])
  expect(listOwnedLists(db, sis.id).map(list => list.token)).toEqual([token])
  expect(listNotices(db, sis.id)).toMatchObject([{ kind: 'list_relinked', actor: 'Art', title: 'Kerst', token }])
  expect(listNotices(db, art.id)).toEqual([])
})

it('never reads what buyers did', () => {
  expect(readFileSync('server/domain/lists.ts', 'utf8')).not.toMatch(/purchases|notes/i)
})
```

In `test/invites.test.ts`: a list link and a wishes link made before `relinkList` are accepted afterwards, and `acceptInvite` for the list link returns the new token. In `test/visits.test.ts`: `describeLists(db, [old])` is `[]` after a new link (the logged-out cookie).

- [ ] **Step 2: Run them:** `pnpm exec vitest run test/lists.test.ts test/invites.test.ts test/visits.test.ts`. Expected: FAIL, `relinkList` is not exported.

- [ ] **Step 3: Schema.** Add `listOldTokens` to `server/db/schema.ts` with a comment saying what an old link is still good for; run `pnpm db:generate`. Add `'list_relinked'` to `NoticeKind`.

- [ ] **Step 4: Implement `relinkList` in `server/domain/lists.ts`,** in one immediate transaction: `ownedListId`; insert the current token into `listOldTokens`; set `lists.token` to `newListToken()`; delete the `listVisits` rows of this list whose user is not among `ownersOfList`; `addNotice` (`server/domain/notices.ts`) to every other owner with `kind: 'list_relinked'`, `listId`, the list's title. The file must not contain the words "purchases" or "notes".

- [ ] **Step 5: The notice's sentence** in both locale files after `notice.list_joined`: nl `{actor} gaf “{title}” een nieuwe link. De oude werkt niet meer.`, en `{actor} gave “{title}” a new link. The old one no longer works.`

- [ ] **Step 6: Run the tests again.** Expected: PASS, and `pnpm test` passes whole (`test/migrations.test.ts` included).

- [ ] **Step 7: Commit** `Let an owner give a list a new link`.

---

### Task 3: The old link only undoes ticks

**Files:**
- Modify: `server/domain/placement.ts` (`wishOnList`), `server/domain/purchases.ts`, `server/domain/list-view.ts`, `shared/schemas/list.ts` (`ListView`)
- Test: new `test/old-links.test.ts`; add to `test/visibility.test.ts`

**Interfaces:**
- Consumes: `relinkList`, `listOldTokens` (Task 2).
- Produces:
  - `wishOnList(db, token, wishId, options?: { old?: boolean })`: with `old: true` a token found only in `listOldTokens` resolves to its list with `live: false` and `old: true`; without it such a token is "not found" as today. The returned object gains `old: boolean`.
  - `ListView.old: boolean` (false on every ordinary view).
  - `oldLinkView(db: Db, token: string, viewerId: number | null): ListView | { movedTo: string } | undefined` in `server/domain/list-view.ts`.

- [ ] **Step 1: Write the failing tests** in `test/old-links.test.ts`. Setup: Art's list "Kerst" with "Sokken" (1), "Glazen" (4) and "Boek" (1); Mom ticks Sokken and takes 2 Glazen and writes a note on Sokken; Sis ticks Boek; then `relinkList`. Assert:

```ts
// what each viewer gets at the old address
expect(oldLinkView(db, old, null)).toBeUndefined()
expect(oldLinkView(db, old, lot.id)).toBeUndefined()            // logged in, ticked nothing
expect(oldLinkView(db, old, art.id)).toEqual({ movedTo: token })
const forMom = oldLinkView(db, old, mom.id) as ListView
expect(forMom).toMatchObject({ token: old, title: 'Kerst', owners: [], viewerOwnsList: false, deleted: false, old: true })
expect(forMom.wishes).toMatchObject([
  { title: 'Sokken', role: 'buyer', removed: true, mine: 1, bought: 1, sharedWith: [], notes: [], purchases: [{ mine: true, quantity: 1 }] },
  { title: 'Glazen', role: 'buyer', removed: true, mine: 2, bought: 2, notes: [], purchases: [{ mine: true, quantity: 2 }] },
])
// the ordinary view never answers an old address, and is never marked old
expect(getListView(db, old, mom.id)).toBeUndefined()
expect(getListView(db, token, mom.id)).toMatchObject({ old: false })

// lowering and withdrawing work; nothing else does
setPurchase(db, old, glazen.id, mom.id, 1)
expect(codeOf(() => setPurchase(db, old, glazen.id, mom.id, 3))).toBe('wish_removed')
expect(codeOf(() => setPurchase(db, old, boek.id, mom.id, 1))).toBe('not_found')   // never ticked it
expect(codeOf(() => setPurchase(db, old, sokken.id, lot.id, 1))).toBe('not_found')
expect(codeOf(() => addNote(db, old, sokken.id, mom.id, 'x'))).toBe('not_found')
expect(codeOf(() => copyWish(db, mom.id, old, sokken.id, { list: momList }))).toBe('not_found')
expect(codeOf(() => linkWish(db, mom.id, old, sokken.id, { list: momList }))).toBe('not_found')
removePurchase(db, old, sokken.id, mom.id)
removePurchase(db, old, glazen.id, mom.id)
expect(oldLinkView(db, old, mom.id)).toBeUndefined()            // nothing left of hers
// through the new address the others see what is left
expect(wishIn(getListView(db, token, sis.id), sokken.id)).toMatchObject({ bought: 0 })
```

Further cases, one `it` each: a second `relinkList` leaves both old addresses working for Mom; after `deleteList` the old address still gives Mom her ticks and gives Art `undefined`; an owner of one wish there who is not an owner of the list (through `linkWish`) is treated like any buyer with a tick.

In `test/visibility.test.ts`: in both worlds give the list a new link at the end; `oldLinkView(db, old, art.id)` and `oldLinkView(db, old, null)` are equal across the worlds.

- [ ] **Step 2: Run:** `pnpm exec vitest run test/old-links.test.ts test/visibility.test.ts`. Expected: FAIL, `oldLinkView` is not exported.

- [ ] **Step 3: `wishOnList`** per the interface above. Keep the words "purchases" and "notes" out of `placement.ts`.

- [ ] **Step 4: `purchases.ts`.** Both functions call `wishOnList(..., { old: true })`. Through an old token, `setPurchase` answers `not_found` when the person has no row for that wish (before anything about others is read) and otherwise goes on as for any wish that isn't live; `removePurchase` is unchanged. `notes.ts` and `sharing.ts` keep calling without the option, so they answer "not found".

- [ ] **Step 5: `oldLinkView`** in `list-view.ts`: the list behind the old token; an owner of a live list gets `{ movedTo }`, an owner of a deleted one `undefined`; anyone else logged in gets the wishes they have a purchase on, in the list's order, built as the test says, or `undefined` when there are none. Set `old: false` in `getListView`.

- [ ] **Step 6: Run the tests again,** then `pnpm test`. Expected: PASS.

- [ ] **Step 7: Commit** `Let the old link of a list still take back a tick, and nothing else`.

---

### Task 4: The routes

**Files:**
- Create: `server/api/lists/[token]/new-link.post.ts`
- Modify: `server/api/lists/[token]/index.get.ts`, `test/api-check.sh`

**Interfaces:**
- Consumes: `relinkList`, `oldLinkView`.
- Produces: `POST /api/lists/[token]/new-link` answers 200 `{ token }`; `GET /api/lists/[token]` answers the view, or `{ movedTo }` for an owner at an old address, or 404.

- [ ] **Step 1: `new-link.post.ts`:** `requireUser`, `tokenParam`, at most 10 per hour per account (`isLimited`/`countHit`, key `relink:<id>`, 429 `rate_limited`), `domain(() => relinkList(...))`.

- [ ] **Step 2: `index.get.ts`:** when `getListView` has nothing, answer `oldLinkView(db, token, viewerId)` when it has something, without remembering a visit and without touching the opened-lists cookie; otherwise 404 as today.

- [ ] **Step 3: `test/api-check.sh`,** a section "a new link" before "deleting a list", on a list of its own so the rest stays as it is: mom cannot give art's list a new link (404); art can (200, a token that differs); the old address is 404 for a visitor and for sis (who ticked nothing), `{"movedTo":…}` for art, and for mom (who ticked) a view with `"old":true` holding only her wish; mom cannot raise her tick there (409 `wish_removed`), write a note (404) or tick another wish (404); she withdraws it (204) and the old address is then 404 for her; art's `PATCH` to the old address is 404; the new address works for a visitor.

- [ ] **Step 4: Run it** against the scratch server: every line `ok`.

- [ ] **Step 5: Commit** `Answer a list's old link with what its holder ticked, and its owner with the new one`.

---

### Task 5: The page

**Files:**
- Modify: `app/pages/l/[token].vue`, `app/composables/useListView.ts`, `app/components/WishRow.vue`, `app/components/WishBuyerDetails.vue`
- Modify: `i18n/locales/nl.json`, `en.json`, `docs/how-it-works.md`, `docs/who-sees-what.md`

**Interfaces:**
- Consumes: the two routes of Task 4; `ListView.old`.

- [ ] **Step 1: The sentences.** Under `list`, after `leaveConfirm` (or the last key of the leave/delete group):

| key | nl | en |
| --- | --- | --- |
| `newLink` | `Nieuwe link` | `New link` |
| `newLinkTitle` | `“{title}” een nieuwe link geven?` | `Give “{title}” a new link?` |
| `newLinkBody` | `De oude link werkt dan voor niemand meer. Je houdt de lijst, en stuurt de nieuwe link naar wie hem mag hebben. Wie iets aanvinkte, kan dat via de oude link nog intrekken.` | `The old link then stops working for everyone. You keep the list, and send the new link to whoever may have it. Someone who ticked something can still take that back through the old link.` |
| `newLinkBodyShared` | `Ook {names} houdt de lijst. \| Ook {names} houden de lijst.` | `{names} keeps the list too. \| {names} keep the list too.` |
| `newLinkConfirm` | `Nieuwe link geven` | `Give a new link` |
| `newLinkDone` | `Deze lijst heeft een nieuwe link. De oude werkt niet meer.` | `This list has a new link. The old one no longer works.` |
| `oldLink` | `Deze lijst heeft een nieuwe link. Hier staat alleen nog wat jij aanvinkte: je kunt het verlagen of intrekken. Vraag de eigenaar om de nieuwe link.` | `This list has a new link. Only what you ticked is still here: you can lower it or take it back. Ask the owner for the new link.` |
| `oldLinkDone` | `Je hebt hier niets meer aangevinkt.` | `You have nothing ticked here any more.` |

Terms, `terms.lists.open`: replace the last sentence. nl: `Een eigenaar kan een lijst een nieuwe link geven; de oude werkt dan niet meer.` en: `An owner can give a list a new link; the old one then stops working.` Set `terms.updated` to 19 November 2026 in both.

- [ ] **Step 2: `useListView.ts`.** An answer with `movedTo` is followed: `navigateTo(localePath('/l/' + movedTo), { replace: true })` (on the server a redirect), before anything renders.

- [ ] **Step 3: The button and dialog** in `app/pages/l/[token].vue`: in the edit bar next to the list's delete or leave button, a quiet `art-button` `list.newLink`; a `<dialog class="dialog">` like `deleteDialog` with `newLinkTitle`, `newLinkBody`, `newLinkBodyShared` with `otherOwners` when `shared`, Annuleren (autofocus, `list.deleteCancel`) and `newLinkConfirm`. On yes: `POST …/new-link`, leave edit mode, `navigateTo(localePath('/l/' + token), { replace: true })`, then show `newLinkDone` as a status line in the wishes section; a failure goes to `listError`.

- [ ] **Step 4: The bare page.** When `list.old`: the message `list.oldLink` where the deleted-list message stands; no `ShareButton`, no owners' lead; `WishRow` gets a `bare` prop that it passes to `WishBuyerDetails`, which then leaves out the "taken off the list" sentence, "Wie geeft dit?" and `WishNotes`. When a refresh then answers 404 (`gone`), the page says `list.oldLinkDone` instead of `list.gone`.

- [ ] **Step 5: Docs.** `docs/how-it-works.md`: a bullet "A new link" after "Lists" (what `relinkList` does, what the old link still does and where that is decided). `docs/who-sees-what.md`: one paragraph on what an old link answers to whom, and that it answers an owner and a visitor the same whatever was bought.

- [ ] **Step 6: Verify.** `pnpm test`, `pnpm typecheck`, `nuxt build` in the worktree, `test/api-check.sh` all pass. Headless Chrome at 2x on the scratch server, wide and at 390 px: the dialog; after yes the address bar has the new token and the status line shows; a logged-out visit to the old address is the 404 page; Mom at the old address sees the bare page with only her ticks and no notes field, lowers one, withdraws all, and reads `oldLinkDone`; Art at the old address lands on the new one; Mom's "Bezocht" no longer lists it.

- [ ] **Step 7: Commit** `Give a list a new link from its edit mode, and show the old link's holder their ticks`.
