# Private lists, list-style editing and joint wishes

Design, 17 November 2026. Follows a conversation with Art; "decided" means Art said so, "my call" means I filled it in and Art can change it.

## Why

The first version gives every account one public wishlist and a home page that shows everyone's. Art doesn't want that:

- Lists should not be visible to everyone. You get to a list by its link.
- People have several lists, for different groups.
- A list should feel like a list you work in: tick things, type a new line, edit in place. Not a grid of cards and a form per wish.
- Two people who both want the same thing (Art and his girlfriend, one board game) should be able to share that wish, so it is bought once.

The rule the whole site rests on stays: **an owner of a wish never sees who buys it**, unless they ask in a way that warns them first.

## Goals

1. Lists are private by link. Nobody finds a list without its link.
2. A list you opened once stays on your home page.
3. Anyone who has a list can pass it on.
4. Several lists per account, each with an address the site makes up.
5. The list page is a checklist: rows, tick, +, edit in place.
6. Adding a wish takes a tap on + and a title. Everything else has a default and is edited later.
7. A wish, or a whole list, can belong to two (or more) people. It is bought once for all of them.
8. Owners can tick wishes on their own lists ("I got this myself"), after a warning.

## Non-goals

- Taking a list away from someone who has the link. There is no "remove this person" and no link reset in this version.
- Email of any kind. Notices live inside the site.
- Reordering wishes, prices, fetching titles or pictures from a shop link.
- Migrating data from the first version. Nothing is live, so the data model is replaced.
- Seeing a list of who opened your list.

## Anti-goals

These would make it a failure even if everything works:

- An owner learns about a purchase on their own or joint wish without having asked. Ticking is asking; nothing else is.
- One owner of a joint wish sees that the other owner claimed it. A claim "for us" is a surprise for the other.
- A list or a wish can be reached without knowing a list link.
- Adding a wish needs more than a title.

## Constraints

- Nuxt 4, SQLite through Drizzle, `nuxt-auth-utils`, Dutch and English, Gesso for everything visual, Raspberry Pi with Docker. Unchanged.
- The structure that keeps leaks out stays: rules as plain functions in `server/domain/` that take a database, the server builds what each viewer may see, the page shows exactly what it gets. See `README.md`, "Who sees what".
- The guard rails stay: rate limits, origin check, body size limits, `Cache-Control: private, no-store`, the session watcher, noindex.
- Every new string exists in `i18n/locales/nl.json` and `en.json`.

## How it gets built: two steps

Decided. Three ways were on the table:

| Way | What it means | Trade-off |
|---|---|---|
| **Two steps on the final data model** (chosen) | Step one: private lists, several lists, remembered lists, the new list page, ticking on your own list. Step two: joint wishes and lists, the joint link, "add to my list", notices. Ownership is stored per wish from step one. | The site is usable after step one, and each step gets its own round of leak tests. Step one carries a little structure it doesn't use yet. |
| Everything in one go | Same result, one release. | Nothing usable until all of it works; a leak in the joint logic is harder to find among everything else that changed. |
| Two steps, old ownership first | Keep "one list, one owner" in step one, rework later. | Dropped: the code that keeps owners blind would be written twice. |

Art chose the first because it gives a usable site halfway and keeps the privacy rule in one shape throughout.

Each step is planned and built on its own. Step two starts only when step one is done and checked.

## The model

Decided, unless marked.

- **List**: a title and an address the site makes up (`/l/<token>`). The token is random and long enough that it can't be guessed (my call: at least 96 bits, URL-safe). A list has one or more owners.
- **Wish**: title, text, link, picture, amount (a whole number, or no limit). As now.
- **A wish has owners**, one or more. This is where "who may not see purchases" lives. In step one every wish has the owners of the list it was added to.
- **A wish is shown on one or more lists.** A joint wish between Art and Lotte is *one* wish, shown on a list of his and on a list of hers. If she changes its title or picture, it changes on his list too. (Decided, and Art knows the consequence.)
- **Purchase**: one per person per wish, with a number. Purchases by different people add up to the amount. An owner's own tick is a purchase like any other.
- **Note**: text on a wish, for the buyers.
- **Remembered list**: a list a person opened, kept so the home page can show it.
- **Notice** (step two): a message for one person inside the site, some with an undo.

Usernames go away. Registration asks for name, email and password.

## Who sees what, per wish

The viewer's role is decided per wish, not per list, because one list can hold a joint wish between the viewer and someone else next to wishes that are only the other person's.

| Viewer | Sees of a wish |
|---|---|
| Not logged in | The wish. No purchases, no notes. |
| An owner of the wish | The wish and **their own** purchase. Nothing about anyone else's, the other owners' included. No notes. |
| Logged in, not an owner | The wish, every purchase with name and number, the notes. Wishes an owner deleted after someone bought them stay visible, marked as removed. |

Everything from the first version that kept an owner from finding out by a detour still holds, now per wish: deleting and lowering an amount always succeed the same way; purchases and notes never change a wish's timestamps or order; note ids are random; "not found" for any note that isn't yours.

Access: every request about a wish goes through a list link. Knowing a wish's number is not enough; the wish must be shown on the list whose link the request names. Pictures keep their random names.

### An owner ticks their own wish

Decided.

- Ticking means "I'm getting this" everywhere. On someone else's wish it works as now.
- On a wish you own (your own list, or a joint wish) the site first asks: "You might find out that someone already got this. Continue?" This appears every time you tick or raise your number, not when you untick or lower it.
- If enough are left, the purchase is recorded. Buyers see it with your name. Other owners of a joint wish see nothing.
- If not enough are left, the site says so ("Someone already has this" / "There aren't that many left") and records nothing. It gives no names and no numbers. That is the spoiler the warning announced.
- The owner's row never shows how many are left. The stepper's + is always enabled and the answer comes after pressing it.

## The list page

Decided from mockups (`.superpowers/brainstorm/` holds them; they are wireframes, not the Gesso look).

```
Christmas                                    [Share]
☐  ▩  Smart plugs                3 wanted
      Zigbee · example.shop
☑  ▩  Book
      You got this yourself
☐  ▩  Board game                 with Lotte
      For 2 to 4 players
＋  Add something…
```

- **Rows with a picture.** Tick box, small picture, title, a second line with the start of the text. Without a picture the row shows a small painted study seeded by the wish, in Gesso's manner.
- **Amounts.** A wish for one has a tick box. A wish for more than one, or with no limit, has a stepper: − and + around "your number / total". Buyers also see who has how many and how many are left; owners don't.
- **Joint wishes** carry a tag naming the other owner or owners ("with Lotte").
- **Tapping a row unfolds it in place.** Several rows can be open at once.
  - Not an owner: text, link to the shop, who is buying, the notes and a field to write one. In step two also "Add to my list".
  - Owner: the fields to edit the wish (title, text, link, amount or no limit, picture), delete (with the confirmation that exists now), and in step two "make joint".
  - Not logged in: text, link, and a line that says logging in lets you tick.
- **Adding.** Tap +, type a title, press Enter. The wish exists with an amount of one and nothing else. The cursor is in a fresh line for the next one. (My call.)
- **Share.** A button on every list, for every viewer, that copies the list's link. There is one link per list.
- A wish can be linked to directly: the list's address with the wish as an anchor opens the page with that row unfolded. (My call; replaces the wish page.)
- Removed wishes that someone bought sit at the end of the list for buyers, marked as removed.
- The wish page (`/u/<name>/<id>`) and the card grid go away.

## The home page

My call, Art agreed.

```
Your lists                              ＋ New list
  Christmas              12 wishes
  Birthday                4 wishes
  Our housewarming        7 wishes · with Lotte

Lists you opened
  Mom's Christmas
  Sam's birthday                         remove

Notices                                  (step two)
  Lotte linked "Board game" to her list.   Undo
```

- A new list works like a new wish: type a name, it exists.
- Not logged in, the home page shows "Lists you opened" from the browser and an invitation to log in. Nothing else: no directory.
- "Remove" takes a list off your home page. It does not take away access; the link still works.

### Renaming and deleting a list

My call; the first version had no lists to delete.

- An owner can rename a list. The address doesn't change.
- A list with one owner can be deleted. Every wish on it is deleted by the rule that exists now: a wish someone bought stays visible to buyers, marked as removed.
- After that, the link answers "not found" for its former owner and for logged-out visitors, always, whatever was bought. Logged-in people who weren't owners still get the page: a line saying the list was deleted, and the removed wishes that someone bought, so they can withdraw a purchase.
- A deleted list leaves "Your lists" at once. Under "Lists you opened" it stays, marked as deleted, until the person removes it.
- A list with several owners (step two) can't be deleted. Owners leave; the last one deletes.

## Remembering lists

Decided, mechanism my call.

- Opening a list while logged in saves it to the account.
- Opening a list while logged out saves it in a cookie the server sets (not localStorage: the server builds the home page and only a cookie reaches it).
- Logging in or registering moves the lists from the cookie into the account and clears the cookie.
- Known consequence: on a shared computer, lists someone opened while logged out go into the account of whoever logs in next. "Remove" is the remedy.

## Step two: joint wishes and lists

Decided, unless marked.

### Making wishes joint with a link

- On your list you select one or more of your wishes and choose "make joint". You get a link.
- The link works once. The person who opens it must be logged in. They see the wishes, pick which of their lists they go on (or make a new list), and become an owner of each.
- From that moment they are an owner: they stop seeing purchases and notes on those wishes, wherever they look at them.
- You get a notice that the link was used and by whom. (My call.)

### "Add to my list" on someone else's list

Each wish on a list you don't own offers "Add to my list" with two choices. You pick which of your lists it lands on; the one you used last is preselected (my call).

- **Linked.** You become an owner of that wish at once and it shows on your list. The existing owners get a notice with an undo. A wish that is already bought can be linked: the purchase then counts for you too.
- **Copy.** A new wish of your own with the same title, text, link, picture and amount. Nobody is told and the two have nothing to do with each other.

### Undo and unlink

Decided: a linker can edit at once, undo also undoes what they changed, and the wish itself offers a way to unlink someone. The mechanics are my call.

- **Undo**, on the notice. The fields the linker changed (title, text, link, amount, picture) go back to what they were before the linker first changed them. Changes the earlier owners made stay. Then the linker is unlinked, as below.
- To make that possible the site remembers, per link, the earlier value of each field the linker changes, and keeps a replaced picture on disk. It stops remembering when the notice is dismissed; from then on the changes are simply the wish.
- **Unlink**, in the unfolded wish, at any time. An owner sees the other owners there and can unlink anyone who became an owner after them. Unlinking changes nothing in the wish. Someone who joined later can't unlink those who were there before; they can only take the wish off their own list.
- **What unlinking does to the other person.** The joint wish is taken off their list by the rule below, and in its place they get a plain copy as the wish is at that moment, with no purchases. They get a notice saying so.
- Purchases stay on the original wish, the unlinked person's own included. Someone who bought it through that person's list still sees it there, marked as taken off, and can withdraw.

### Taking a wish off a list

My call. One rule covers deleting, leaving and undo.

- **Taking a wish off a list** removes it from that list. Each owner of the list who doesn't have the wish on another list of theirs stops owning it. If nobody owns it any more, the wish is deleted.
- So on your own list, taking off a wish that only you own deletes it, as now. Taking off a joint wish that also sits on Lotte's list removes it from yours and leaves it hers. On a joint list, any co-owner can take a wish off, and it is gone for all the list's owners.
- The button says what will happen: "Delete" when nobody will own the wish afterwards, "Remove from my list" otherwise.
- **What buyers of that list see.** People the list was shared with keep seeing the wish at the end of the list, marked as taken off, for as long as anyone has a purchase on it. This is the rule that already exists for deleted wishes, applied to the list the wish left. They can lower or withdraw their own purchase there. The list's owners never see these rows. Purchases stay on the wish itself; they are not moved to a copy.

### A joint list

Decided: one list with two (or more) owners.

- An owner of a list can make a link that works once and makes the person who opens it a co-owner of the list. (My call: the same mechanism as the joint-wish link.)
- A co-owner sees the list under "Your lists", adds and edits wishes, and owns every wish on it, those already there and those added later.
- Leaving a joint list (my call): you stop owning the list, and every wish on it that isn't also on another list of yours. The last owner can't leave; they delete the list.

### Notices

- Inside the site only, on the home page, with a mark in the header when there are new ones (my call).
- Kinds: someone linked a wish of yours (with undo, and a way to dismiss it); you were unlinked from a wish; your joint link was used; someone became co-owner of your list.
- Never about purchases or notes.

### Things that follow, so the builder isn't surprised

- Any logged-in person who can open your list can link one of your wishes and then, as an owner, edit it. Undo puts their changes back and removes them. (Follows from "linked takes effect at once"; Art decided that and the undo.)
- Once you no longer own a joint wish, you are a buyer of it again if you can open the other owner's list, so you then see who bought it. It is no longer your wish, so this is accepted.

## What goes away

- `/u/<username>`, usernames, the list address field at registration.
- The public directory on the home page and its API.
- The wish page and the full-page form for a new wish. The form's fields move into the unfolded row.

## Left to the builder

- Table and column names, the API's shape, how list tokens are generated, how the cookie stores remembered lists and how many.
- How the unfolded row is built (it must work with the keyboard and say whether it is open), whether editing saves on a button or as you type, how the stepper reports a refusal.
- How the small painted study is drawn with Gesso's brush engine, and what a row looks like before Gesso's components load. New styles go in `app/assets/css/app.css`, marked as candidates for Gesso.
- Which existing code is reshaped and which is rewritten. The domain layer, the tests' approach (two databases that differ only in what buyers did) and `test/api-check.sh` are worth keeping and extending to the per-wish roles, joint wishes and owner ticks.
- Exact wording of the new texts, in the voice the site has: plain, sentence case, errors that say what to do.

## How we'll know it works

- The leak tests pass per wish: for every wish, what its owners and a logged-out visitor get is identical whether or not buyers bought or wrote. An owner's own purchase is the only exception, and only for that owner.
- A joint wish: neither owner sees the other's claim; buyers from both lists see one shared state.
- Link a wish, change its title and picture as the linker, undo as the owner: the wish is as it was, and the linker has a copy.
- A list can't be read, and a wish can't be bought or noted, without a list link that shows it.
- On a phone: add three wishes with + and three titles, no other input.
- Open a list logged out, log in, find it on the home page on another device.
