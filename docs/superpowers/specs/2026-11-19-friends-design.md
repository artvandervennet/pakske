# Friends, a new link for a list, and deleting a wish from its card

## Context

Today Pakske shares everything by link: a list (`/l/<token>`), wishes and co-ownership (`/j/<token>`). People who share with the same family again and again keep sending links. The owner of the site wants friends: become friends once, then choose per friend which lists they see, and send wishes or co-ownership to a friend directly. Links must keep working exactly as now. He also wants a button that gives a list a new link.

Decided with him:

- Unticking a list for a friend takes it **off their Lists page only**. The link stays the one key to a list.
- Becoming friends: **a request from a list you opened**, and **a friend link that works once**. No lookup by email address.
- A new friend sees **nothing until you tick it**. A list made later is shown to no friend until its owner chooses.
- Where a share link is made today (wishes as copy or together, "Lijst samen beheren") you can **pick a friend instead**.
- A list's owner can give the list **a new link**; the old one stops working for everyone.
- After a new link, **the old link only undoes ticks**: whoever ticked something there can still lower or withdraw it, and sees nothing else.
- Asked for alongside, and separate from friends: **a delete button in an opened wish** of your own, which asks first. Deleting several at once stays in edit mode.

## Goals, non-goals, anti-goals

Goals: share with the same people without sending links; per friend, per list control over what is listed; a real cut-off when someone should no longer open a list (the new link).

Non-goals (not now): groups of friends; lookup by email or name; befriending another buyer whose name you see on someone's list; friends-only lists that don't open by link; mail or push for requests.

Anti-goals (a failure even if it works):

- Anyone can find out who has an account, or who someone's friends are.
- An owner learns who opened their list, or anything about purchases or notes, through the friend code.
- A screen that suggests unticking a friend locks them out when their link still works.
- Anything about a list changes for people who only use links.

## The rules

1. **No directory.** You can only ask someone whose list you can open, or accept a friend link someone sent you.
2. **Friendship is mutual; what is shown is not.** Each side ticks their own lists for the other.
3. **Nobody sees anyone else's friends**, on any page or in any answer.
4. **A friend sees** your name and the lists you ticked for them. Not your address, not your other lists, not who else sees a list.
5. **On a list a friend is a buyer** like anyone with the link (unless they own a wish there). `getListView` doesn't change. The friend code never reads purchases or notes; the source test in `test/visibility.test.ts` gets the new files.
6. **Owners still never learn who opened a list.** Showing a list to a friend reports nothing back.
7. **A request names its sender** and the list it came from ("via je lijst Verlanglijst"). Sending one tells that owner you have their link; the button says who it goes to.
8. **Declining is silent.** To the sender a declined request looks and behaves like a waiting one, and nothing of theirs reaches the receiver again:
   - "Intrekken" deletes a waiting request. A declined one is only hidden from its sender; the row stays.
   - Asking the same person again brings that row back as "Verzoek verstuurd" and tells the receiver nothing.
   - If the person who declined later asks the other way, the two are friends at once: the first one already wanted it.
   - The cap of 20 is per sender and counts everything the sender sees as waiting, declined ones included, so a freed place never gives a decline away.
9. **Unfriending is silent** and removes what each showed the other. The page says the links keep working.
10. **Deleting an account** takes its friendships, requests, friend links and shown lists along (cascade). A list left behind without an owner is shown to nobody through friends, and stays at its link.
11. **Caps**: 100 friends, 20 requests waiting for an answer, 10 open friend links (a new one drops the oldest), and rate limits on asking, friend links and new links, with `isLimited`/`countHit` (`server/utils/rate-limit.ts`).

## Approaches

1. **Friends as their own part beside lists (chosen).** New tables; lists, links and `getListView` untouched; sending to a friend is today's share link delivered as a notice. Ships in three steps.
2. **Reuse "Bezocht"** (write a `list_visits` row when a list is ticked for a friend). Almost no new screens, but "you showed me" and "I opened it" become one thing: unticking must delete their own history or do nothing.
3. **Groups instead of single friends.** Less ticking for big circles, more to set up and explain. Can be added on top of 1.

The owner talks in outcomes and left the how to me; 1 is my pick.

## What people see

**Nav**: "Vrienden" between "Lijsten" and "Instellingen", logged in only (`app/components/AppHeader.vue`).

**`/friends`** (`app/pages/friends.vue`, `middleware: 'auth'`):

```text
Vrienden                                         [Vriend toevoegen]
                                    (makes a link that works once, shown
                                     in OneTimeLink.vue with its copy button)
Verzoeken
  Moeke wil vrienden worden · via je lijst “Verlanglijst”   [Aanvaarden] [Weigeren]
Verstuurd
  Zus · wacht op antwoord                                    [Intrekken]

Je vrienden (3)
  Lotte   ziet 2 van je 3 lijsten · toont jou 1 lijst         ⌄
     Wat Lotte van jou ziet    [x] Verlanglijst  [x] Kerst 2026  [ ] Verjaardag Lotte
     Wat jij van Lotte ziet    Verlanglijst van Lotte →
     Iedereen met de link van een lijst kan hem openen, ook zonder dit vinkje.
     [Vriend verwijderen]
```

Right after accepting (request or friend link) the person lands on that friend's unfolded row with nothing ticked.

**Home** (`app/pages/index.vue`): waiting requests stand with the notices, with Aanvaarden and Weigeren. They count for the mark on the wordmark (`/api/notices/unseen`).

**A list you opened** (`app/pages/l/[token].vue`, logged in, not an owner): per owner one quiet button under the title, "Vriend worden met Art"; afterwards it reads "Verzoek verstuurd". For a friend it reads "Vrienden met Art". A list without owners has none.

**A list of your own**, title band: a button "Vrienden" opens a dialog:

```text
Wie ziet “Kerst 2026” bij zijn lijsten?
  [x] Lotte   [ ] Moeke   [ ] Zus                 [Alle vrienden]
Iedereen met de link kan de lijst openen, ook wie hier niet aangevinkt is.
                                                   [Annuleren] [Opslaan]
```

On a joint list each owner sees and ticks only their own friends.

**Lists page** (`app/pages/lists.vue`): a third tab "Van vrienden" (`?tab=friends`), rows like `VisitedListRow.vue` with "van Art". The search covers it. The home page gets its first few (`HOME_LISTS`).

- A list shown to you is not also under "Bezocht" while it is shown, and opening it then is not remembered as a visit (`server/api/lists/[token]/index.get.ts` skips `rememberList`): you didn't need the link. So when the owner unticks it, it is gone from your page. It only stays under "Bezocht" if you had opened its link before it was shown to you, or open the link afterwards.
- "Weghalen" on a row hides that list for you (`hidden_at` on your `list_friends` row). The owner's tick stays and the owner isn't told. It comes back when the owner unticks and ticks it again.

**Sharing wishes** (`ShareWishesDialog.vue`): after Kopie or Samen, "Naar wie?" with a box per friend and "Of maak een link" (today's step). **"Lijst samen beheren"**: pick one friend, or make the link as today. The friend gets a notice ("Art wil 3 wensen met je delen", "Art wil “Kerst” samen met je beheren") whose "Bekijken" opens `/j/<token>`, the page a link opens now. Nothing changes for them until they say yes there.

**New link** (edit mode's bar, quiet, beside "Lijst verwijderen"), asks first:

```text
“Kerst 2026” een nieuwe link geven?
De oude link werkt dan voor niemand meer. Jij en Lotte (mede-eigenaar) houden de lijst,
en de 2 vrienden die hem zien krijgen de nieuwe link vanzelf. Alle anderen moet je de
nieuwe link sturen.
```

Afterwards the page is at the new address.

**The old link after that** keeps one use, so nobody is left with a tick they can't take back. Today a buyer can always get back to what they ticked, also on a deleted list; this keeps that true.

- Logged out, or logged in without a tick on that list: "not found", like a link that never existed.
- Logged in with a tick there: a bare page with the list's title and only the wishes they ticked, each with their own tick alone. They can lower or withdraw it. No other buyers, no notes, no other wishes, no giving more, no "Op mijn lijst".

  ```text
  Kerst 2026
  Deze lijst heeft een nieuwe link. Hier staat alleen nog wat jij aanvinkte.
  Je kunt het verlagen of intrekken. Vraag de eigenaar om de nieuwe link.
    [x] Sokken
  ```

- An owner who opens the old link is sent on to the new one. Nobody else ever gets the new address from the old one.
- Opening an old link is never remembered under "Bezocht".

**Deleting one wish from its card** (`app/components/WishEditor.vue`, an owner's opened wish on a list they own): a quiet "Verwijderen" at the end of the card. It asks first, with the sentences edit mode already has (`listEdit.deleteTitle`, `deleteBody`, and `deleteBodyElsewhere` when `wish.alsoElsewhere`), Annuleren has the focus. It calls the route that exists, `DELETE /api/lists/[token]/wishes/[id]` (`deleteWish` in `server/domain/wishes.ts`), so the answer is the same whatever was bought. Afterwards the row is gone and the focus goes to the list's heading (`keepFocus` in `app/pages/l/[token].vue`). An owner of a joint wish who looks at it on someone else's list gets no button: they take it off their own list.

**`/f/<token>`** (`app/pages/f/[token].vue`, needs a login like `/j/`): "Art wil vrienden worden" with one button. Used, expired or its maker gone: "Deze link werkt niet meer". Your own: it says so and offers to copy it again.

## Data (`server/db/schema.ts`, one migration with `pnpm db:generate`)

- `friendships (user_low, user_high, created_at)`: one row per pair, `user_low < user_high` (check), both cascade.
- `friend_requests (id uuid, from_user, to_user, list_id null, status 'pending'|'declined', created_at, seen_at)`: unique per sender and receiver; `list_id` set null when the list goes.
- `friend_links (id, token unique, created_by, created_at, used_at, expires_at)`: token from `newListToken` (`server/domain/tokens.ts`), 30 days.
- `list_friends (list_id, user_id, shown_by, added_at, hidden_at null)`, key on the first three: owner `shown_by` shows the list to friend `user_id`. A friend sees a list when a row that isn't hidden says so, the list is live, `shown_by` still owns it and the two are still friends.
- `list_old_tokens (token unique, list_id, replaced_at)`: every link a list had before, cascade with the list.
- `notices` gets `invite_id` (null, cascade), and new kinds: `friend_accepted`, `friend_link_used`, `list_shown`, `share_sent`, `list_relinked`.

## Server

New `server/domain/friends.ts` (nothing in it reads purchases or notes):

- `askFriend(db, userId, listToken, ownerId)`: the list must be live and `ownerId` one of its owners. A request the other way already waiting makes them friends at once.
- `answerRequest(accept | decline)`, `withdrawRequest`, `listRequests` (incoming pending, outgoing).
- `makeFriendLink`, `getFriendLink` (state: open, own, closed, friends already), `acceptFriendLink`.
- `listFriends` (each with how many lists go each way), `removeFriend` (also deletes both directions of `list_friends`).
- `setShownTo(db, ownerId, listToken, friendIds)` and `setShownLists(db, ownerId, friendId, listTokens)`: replace this owner's ticks; a new tick leaves a `list_shown` notice, an untick removes it and says nothing.
- `listShownLists(db, userId)` for the tab and the home page.

Changes to existing code:

- `server/domain/lists.ts`: `leaveList` and `deleteList` delete the leaver's `list_friends` rows for that list. New `relinkList(db, userId, token)`: new token, deletes `list_visits` of everyone who doesn't own the list (so "Bezocht" hands nobody the new link), leaves `list_friends` and open share links alone, tells the other owners (`list_relinked`).
- Old links (the only part that touches who-sees-what code):
  - `relinkList` writes the replaced token to `list_old_tokens`. It reads no purchases, so it answers the same whatever was bought.
  - `getListView` (`server/domain/list-view.ts`): a token found only among the old ones gives an owner `{ movedTo: <new token> }` for the page to follow; gives anyone else with a purchase on that list a view marked `old: true` holding only the wishes they ticked, as buyer rows with `removed: true`, their own purchase alone and no notes; and is undefined for everyone else. `ListView` gets `old` and `movedTo`.
  - `wishOnList` (`server/domain/placement.ts`) resolves an old token as "not live", flagged old. `setPurchase` and `removePurchase` (`server/domain/purchases.ts`) work on it as on any removed wish: lower and withdraw, never more. `addNote` refuses a flagged one with "not found"; linking and copying already refuse a wish that isn't live.
  - `server/api/lists/[token]/index.get.ts` remembers no visit for an old token.
- `server/domain/visits.ts` `listOpenedLists`: leaves out lists shown to the person.
- `server/domain/invites.ts` `createInvite`: optional `friendIds`, at most 20 per send. A link that works once (Samen, a list) is made once per friend; a copy link is one for all. Each friend gets a `share_sent` notice tied to the link by `invite_id`. Links made for a friend don't count toward a list's 20 open links (`MAX_OPEN_INVITES`) and never push an older link out; a new send to the same friend for the same wishes replaces the earlier one.
- `server/domain/notices.ts` + `shared/schemas/list.ts`: the new kinds, and `invite` (the link's token) on `NoticeView`. A `share_sent` notice whose link is closed is not listed.
- `ListView` gets, for a logged-in viewer who doesn't own the list, `ownersToBefriend: { id, name, state }[]` (`none`, `asked`, `friends`); built in `server/api/lists/[token]/index.get.ts` from `friends.ts`, not in `getListView`.

Routes (thin, like the existing ones: `requireUser`, `readInput` with a zod schema in `shared/schemas/input.ts`, `domain()`):

- `GET /api/friends`, `DELETE /api/friends/[id]`, `PUT /api/friends/[id]/lists`
- `POST /api/friends/requests/[id]/accept`, `…/decline`, `DELETE /api/friends/requests/[id]`
- `POST /api/friends/links`, `GET /api/friends/links/[token]`, `POST /api/friends/links/[token]/accept`
- `POST /api/lists/[token]/friend-requests`, `GET` and `PUT /api/lists/[token]/friends`, `POST /api/lists/[token]/new-link`
- `GET /api/lists` and `GET /api/home` gain `shown`; `/api/notices/unseen` counts waiting requests.

New `DomainError` codes with their status in `server/utils/http.ts` and sentences in both locale files: `friend_limit`, `request_limit`, `not_friends`.

## Words and documents

- Both locale files (`i18n/locales/nl.json`, `en.json`; same keys in the same order, round quotes only).
- Privacy page (`shared/utils/legal.ts` outline + sentences, new date): what is kept (friends, requests, which list is shown to whom), who sees it, what goes with the account. Terms: "the site can't take a link back" becomes "an owner can give a list a new link".
- The delete-account dialog in Settings: friends are among what disappears.
- `docs/how-it-works.md`, `docs/who-sees-what.md` (a friend is a buyer; nobody sees friends).

## Order of work (each step ships on its own)

1. **Delete button in a wish**: the button and its dialog in `WishEditor.vue`, and the sentence in `docs/how-it-works.md` that says a card has none. The route and its checks in `test/api-check.sh` exist already.
2. **New link for a list**: `relinkList`, the old link's bare page for taking back ticks, route, the button and dialog, terms sentence, `docs/who-sees-what.md`, tests. Until step 3 exists the dialog leaves out the sentence about friends.
3. **Friends**: tables, `friends.ts`, routes, `/friends`, `/f/<token>`, the button on a list, the "Vrienden" dialog, the tab, home, notices, privacy page, docs.
4. **Send to a friend**: `createInvite` with friends, the two dialogs, the `share_sent` notice.

Each step gets its own plan in `docs/superpowers/plans/`, one commit per logical change, nothing pushed until asked.

## Calls made while designing (approved with the design on 2026-11-19)

- The page is `/friends`, the friend link `/f/<token>`; "Vrienden" is in the nav.
- Requests also show on the home page and count for the notice mark.
- A friend gets a notice when a list is newly shown to them; none when it is unticked.
- Every owner of a joint list may give it a new link; the other owners are told.
- A new link also clears the list from "Bezocht" for everyone who doesn't own it.
- On a joint list each owner's ticks are their own; a friend sees the list while any owner shows it.
- A friend link lasts 30 days.

## Verification

- `pnpm test`: new `test/friends.test.ts` (asking, the crossing request, silent decline, caps, friend link once, unfriend clears both ways, shown lists follow ownership and friendship, account deletion), relink tests in `test/lists.test.ts`, invite-to-friend tests in `test/invites.test.ts`, `test/visibility.test.ts` with the new sources, `test/locales.test.ts` and `test/legal.test.ts` still pass.
- `pnpm typecheck`, and `nuxt build` in a worktree.
- `test/api-check.sh` gains a section per step, run against a scratch server in a git worktree with the Firebase stand-in (never port 3400, never a second `nuxt dev` in the main checkout).
- Headless Chrome at 2x on the scratch server: deleting a wish from its card (cancel keeps it, confirm removes it, focus lands on the heading); two accounts become friends both ways (request, friend link), tick and untick a list, the third tab, the dialogs at phone width; a new link (old address "not found" logged out, the bare page for a buyer with a tick who then withdraws it, an owner sent on, the friend's tab has the new one, "Bezocht" of a third account no longer has it); sending wishes to a friend and accepting on `/j/`.
- Old links in `test/visibility.test.ts`: two databases that differ only in what buyers did give an owner and a visitor the same answers for the old token as for the new one.
