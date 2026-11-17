# Big open wishes, and an edit mode for your own list

Design, 17 November 2026. Follows a conversation with Art; "decided" means Art said so, "my call" means I filled it in and Art can change it.

## Why

- A wish's picture is only ever a 3rem thumbnail. Opening a row unfolds text under it, but the picture stays small, so you can't see what the wish actually looks like.
- On your own list there is no way to tidy up: wishes can only be deleted one at a time, from inside each open row, and the order is fixed to when they were added.

## Goals

1. **Decided.** An open wish grows into a large card with the picture at full width. The list stays compact rows; only the rows you open grow (option B from the conversation).
2. **Decided.** An owner of a list gets an **Edit** button. In edit mode they can select several wishes and delete them at once, and move wishes to a new place in the list.
3. **Decided.** Holding a row (long press) puts you straight into edit mode, with that row selected. This is for the phone.
4. **Decided.** Reordering by drag, built in-house: a drag handle per row, holding and dragging a row on touch, and the arrow keys on the handle. No drag library.
5. The order an owner sets is what everyone who opens the list sees.

## Non-goals

- Reordering or mass-deleting on someone else's list, or as a buyer.
- Undo for a mass delete (the confirm dialog is the safeguard, as it is for a single delete).
- Moving wishes between lists.
- A different order per viewer.
- Bigger pictures in the compact rows themselves.

## Anti-goals

- The order, or anything about edit mode, depends on or reveals what buyers did. Reordering and deleting stay blind to purchases, like every other owner action (see `README.md`, "Who sees what", and the comments in `server/domain/wishes.ts`).
- A long press anywhere on the page opens the phone's own menu (save image, copy text) instead of edit mode.
- A tap meant to open a row starts a drag or edit mode, or a scroll on the phone gets stuck because a row grabbed the touch.
- Reordering only works with a mouse or a finger.

## Constraints

- Nuxt 4, SQLite through Drizzle, Gesso for everything visual, Dutch and English strings in `i18n/locales/nl.json` and `en.json`. Unchanged.
- Rules as plain functions in `server/domain/` taking a database and running in one transaction; endpoints stay thin (see `server/domain/wishes.ts` and the endpoints under `server/api/lists/[token]/`).
- Taking a wish off a list goes through `takeOffList` in `server/domain/placement.ts`, so ownership stays settled: a joint wish that is also on another live list only comes off this one; a wish left with no owners is deleted (soft, `deletedAt`). A mass delete must follow exactly the same rule as `deleteWish`.
- The app's existing care for focus, live regions and screen readers stays: every new control has a label, focus never drops to the page start after a change (see `keepFocus` in `app/pages/l/[token].vue`).
- Pictures are stored at up to 1600px on the long side (`app/composables/useImageResize.ts`), so they hold up at card width.

## Approaches

For reordering, three ways were on the table. **Decided: the first.**

| Way | What it means | Trade-off |
|---|---|---|
| **Drag handles, built in-house** (chosen) | Pointer events on a handle (mouse) and on a held row (touch); the handle is a button that also moves the wish with the arrow keys. The new order is saved in one request. | More code to write, but no dependency, and it fits the long press and the focus handling the rows already need. Keyboard support comes with it. |
| A drag library (SortableJS) | Less code up front. | Adds a dependency to a project with almost none, fights the long press and focus code on the rows, no keyboard support. |
| ↑ ↓ buttons only | Simplest, fully accessible. | Slow for moving a wish far in a long list. |

For the bigger picture, Art picked B (the tapped row grows) over A (every row bigger, details in a popup).

## Design

### 1. An open wish is a big card

- **My call.** When a row is open, the head's thumbnail gives way to the picture shown at full row width directly under the head, above the details. It is shown whole (`object-fit: contain` on the sunken surface), not cropped, with a height cap of about `min(70vh, 32rem)` so a tall picture doesn't push everything off the screen.
- **My call.** The open row reads as a card: a raised Gesso surface with some padding, so it stands apart from the compact rows around it. The details below the picture keep their current content and order.
- For an owner, the big picture *is* the picture editor: `WishPictureEdit`'s frame grows to the same size, tapping it still changes the picture, and the remove button stays on it. It moves from its current place in `WishEditor` to the top of the card.
- **My call.** A wish without a picture: a buyer's card has no picture area. An owner's card shows the picture editor's "add a picture" control at its current small size, not a big empty frame.
- Several rows can still be open at once, as now. Opening, folding, the `#wish-<id>` link and the focus behaviour in `WishRow` stay as they are.

### 2. Edit mode

Only for someone who owns the list and while the list is not deleted (`canManage` in `app/pages/l/[token].vue`).

**Getting in.**

- An **Edit** button in the wishes section head, next to "Wensen" (only with at least one wish).
- A long press on a row's head, about 500 ms without moving more than ~8px, enters edit mode with that row selected. A short vibration (`navigator.vibrate`, where it exists) confirms it. The click that follows the press must not open the row. On a list the viewer can manage, the row heads have no text-selection and no touch callout (`user-select: none`, `-webkit-touch-callout: none`, also on the thumbnail), so the phone's own menu doesn't appear.
- "Gezamenlijk maken" in an open row (`WishEditor`) now enters edit mode with that wish selected. **My call:** this replaces the separate joint-selection mode, so there is one set of checkboxes.

**In edit mode.**

- All open rows fold, and tapping a row toggles its checkbox instead of opening it.
- **My call.** Folding follows the rule `WishRow.toggle` already has: it waits for saves on their way, and a row holding a failed save stays open. Then edit mode doesn't start, and the focus goes to that field, as when folding it by hand. This holds for the Edit button, a long press and "Gezamenlijk maken". Each row exposes its save state to the page for this (for example a `whenSaved`/`unsavedField` pair through a template ref or a provide/inject registry); the page doesn't just clear its `open` set, which would throw away unsaved text silently. The tick at the start of each row is replaced by the checkbox (as the joint selection does today, `.joint-pick`).
- Each row gets a drag handle at its end, after the tags: a button labelled "Move <title>".
- The quick-add row at the bottom is hidden.
- A bar above the list, taking the place of today's joint bar: the selected count, **Delete**, **Make joint**, **Done**. Delete and Make joint are unavailable with nothing selected. Escape and Done leave edit mode; focus goes back to the Edit button.
- **Make joint** works exactly as today's "Create link" in the joint bar: it makes the one-time link for the selected wishes, shows it in `OneTimeLink`, and leaves edit mode.

**Delete.** Asks first in a native dialog, like a single delete: "Delete 3 wishes?" **My call:** when any of the selected wishes is also on another list, the dialog says those only come off this list. After the delete the list refreshes, edit mode stays on with nothing selected, and focus goes to the bar.

**Reordering.**

- Mouse: drag the handle. Touch: drag the handle, or hold a row and, once edit mode is on (including the long press that turned it on), keep moving the finger to drag it.
- While dragging, the row follows the pointer and the others move aside; near the top or bottom of the screen the page scrolls. During a touch drag the page must not scroll by itself under the finger (`touch-action: none` on the handle; a held row prevents the touch's default scroll only once the drag has started).
- Keyboard: on a focused handle, ↑ and ↓ move the wish one place. A live region says where it is now ("Lego set, 3 of 10"). Focus stays on the handle as the row moves.
- On drop (or after each arrow press), the page reorders locally at once and saves the whole order. **My call:** arrow presses are saved after a short pause (about 400 ms) rather than per press. If the save fails, the bar shows the error and the list refreshes to the server's order.
- Removed wishes, which only buyers see and always last (`removedLast` in `shared/utils/wish-order.ts`), are not part of this.

### 3. Data and server

**Schema.** A `position` integer on `list_wishes` (not null, default 0). A migration fills it per list in today's order: `wishes.created_at`, then `wishes.id`. Generate it with `pnpm db:generate` and add the backfill `UPDATE` to the generated SQL.

**Order everywhere.** `listView` in `server/domain/list-view.ts` and `anonWishes` in `server/domain/public-wishes.ts` order by `list_wishes.position`, then `wishes.created_at`, then `wishes.id`. Buyers' removed wishes still go last on the page through `removedLast`.

**New wishes go to the bottom (my call).** `putOnList` in `server/domain/placement.ts` sets `position` to one more than the highest position on that list, for a new placement and for a wish that comes back. That covers adding, "Op mijn lijst zetten", and accepting an invite, which all go through it. For a newly added wish this is the same as now. A linked wish or wishes taken in through an invite used to fall in by their original `created_at`, often mid-list; they now go to the bottom too, where the owner sees them arrive.

**An unlinked copy keeps its place (my call).** `unlink` in `server/domain/sharing.ts` (also used by undo, `server/domain/undo.ts`) gives the copy the original's `created_at` on purpose, "so the copy stays where the wish was". With positions, the copy takes over the original placement's `position` on each list it lands on, so someone else's unlink never reshuffles your list. `putOnList` takes an optional position for this. Test it in `test/sharing.test.ts`.

**Saving an order.** `PUT /api/lists/[token]/order` with `{ wishIds: number[] }`, a domain function `reorderWishes(db, userId, token, wishIds)` in `server/domain/wishes.ts`:
- Only an owner of the list (`ownedListId`); otherwise "not found", as elsewhere.
- **My call, so a co-owner's edit made meanwhile isn't lost:** the given ids that are live on the list get positions 0, 1, 2… in the given order; live wishes on the list that are not in the request keep their relative order and come after them; ids that are not live on the list are ignored. Duplicates are refused by the input schema. Answers 204.
- Input schema in `shared/schemas/input.ts`, capped at `MAX_LIVE_WISHES`.

**Deleting several.** `POST /api/lists/[token]/wishes/delete` with `{ wishIds: number[] }`, a domain function `deleteWishes(db, userId, token, wishIds)` next to `deleteWish`:
- One transaction. Only an owner of the list. Each id that is live on the list goes through `takeOffList`, the same rule as `deleteWish`. Ids that are not live on the list are skipped, not an error, so a wish a co-owner deleted meanwhile doesn't fail the rest. Answers 204, whatever buyers did.
- `deleteWish` can become `deleteWishes` with one id; the existing single-delete endpoint stays.

**Rate limits and guards** apply as on the other list endpoints.

### 4. Tests

- Domain tests next to `test/wishes.test.ts`: the backfill order; new and returning wishes go to the bottom; reorder with a partial list keeps the rest after; reorder by a non-owner is "not found"; mass delete takes joint wishes off this list only and deletes the rest; mass delete answers the same whether or not anything was bought (extend the leak checks in `test/visibility.test.ts` style).
- `pnpm typecheck` and `pnpm test` pass. The drag, long press and keyboard reordering are checked by hand in the browser, on a phone-sized window with touch emulation.

## Left to the builder

- Exact Gesso tokens for the card surface, spacing and the dragged row's look.
- How the drag is drawn (moving the real row vs. a placeholder gap), and the auto-scroll speed.
- The Dutch and English strings, in the tone of the existing ones.
- Splitting the page's edit-mode logic into a composable (for example `useListEdit`) if `app/pages/l/[token].vue` grows too long; it already holds the joint selection that this replaces.
