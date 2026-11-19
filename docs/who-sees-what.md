# Who sees what

The server decides this per wish, not per list. A wish's owners are in `wish_owners`: the owners of every list that shows it now. Someone else's list can hold a wish they share with you, so that page shows you that row as an owner and the others as a buyer.

| | The wish | Who bought how many | Notes |
| --- | --- | --- | --- |
| Visitor, not logged in | yes | no | no |
| An owner of the wish | yes | only their own tick | no |
| Anyone else who is logged in | yes | yes, with names | yes |

`getListView` in `server/domain/list-view.ts` builds a list for one viewer. It splits the wishes into the ones the viewer owns and the rest, and builds each kind with different code:

- A visitor gets the wishes from `server/domain/public-wishes.ts`. That file only reads wishes and the list they are on.
- An owner gets the same wishes and their own purchase. The purchases table is read for the viewer's own rows only.
- Anyone who owns neither the wish nor the list gets every purchase with name and number ("someone else" instead of the name when that buyer chose to give anonymously; the name never leaves the server), the notes, and the wishes that left the list after someone bought them. A note whose writer deleted their account stays, also as "someone else": the note no longer points at an account.

A list whose only owner deleted their account has no owners. Everyone who is logged in is a buyer on it, and nobody gets an owner's row, unless they share one of its wishes through a list of their own.

Every viewer sees who else a wish belongs to: a row on Art's list that he shares with Lotte says "with Lotte". An owner also sees the other owners in the opened wish, under "Shared with".

A wish with several owners:

- Each owner sees only their own purchase. When Lotte ticks the board game she shares with Art, Art's page doesn't change. When there aren't enough left, the refusal is the same as on a wish of your own.
- Buyers see one shared state. Mom buying through Art's list and Sis buying through Lotte's list see the same total, the same names and the same notes.
- A wish taken off a list stays on that list for logged-in people who own neither the wish nor the list, marked "Taken off the list", for as long as anyone has a purchase on it. They can lower or withdraw their own purchase there and write notes, but not buy more. The list's owners and the wish's owners never get that row.
- Someone who stops owning a wish (by taking it off their list, leaving a list or being unlinked) is a buyer of it again wherever they can still open a list that shows it, and sees its purchases and notes there.

Friends change nothing on a list. A friend who opens a list is a buyer like anyone who has its link, unless they own a wish there. Switching a list on for a friend only puts it on their Lists page. `getListView` knows nothing about friends; the list's route adds who the viewer may ask to be friends beside it. `server/domain/friends.ts` reads neither purchases nor notes, and a test reads its source to keep it that way.

What friends see of each other: a name, and the lists switched on for them. Nobody sees who anyone else's friends are, on any page or in any answer. An owner still never learns who opened their list: showing a list reports nothing back, and neither does a friend taking it off their page. A request shows the sender's name and the list it was sent from to that list's owner. A declined request is indistinguishable from a waiting one for its sender.

An address a list had before it got a new link no longer opens the list. `oldLinkView` answers it three ways:

- An owner of the list is told the new address.
- Someone logged in who has a purchase on a wish of that list gets those wishes only, each with their own purchase alone: no other buyers, no notes, no other wishes, and not the new address. They can lower or withdraw it there. Giving more, writing a note and putting the wish on a list of their own answer "not found".
- Everyone else gets "not found", like an address that never existed.

Who owns the list is all that decides an owner's answer, and a visitor's is always "not found", so both are the same whatever buyers did.

The page shows whatever the API returned, so the HTML that Nuxt renders on the server can't contain more than the person may see.

Every request about a wish goes through a list link: the URL names the list's token, and the wish must be on that list now (`wishOnList` in `server/domain/placement.ts`). A wish's number alone gives no access. Lowering or withdrawing a purchase and writing a note also work on a wish that left the list; buying more there answers `wish_removed`. A few requests name no list. Deleting your own note and dismissing your own notice go by a random id, and only their owner gets anything but "not found". A share link goes by its own token.

An owner can tick their own wish. Before every tick or higher number the site asks "You might find out that someone already got this. Continue?"; unticking and lowering don't ask. When not enough are left, the owner reads "Someone already has this" or "There aren't that many left" and nothing is recorded. The server answers with a code only, so the refusal names nobody and gives no number. The owner's row never says how many are left, and its count and its + are always enabled.

Rules that keep an owner from finding out by a detour:

- Taking a wish off your list ("Delete" in the list's edit mode or in the wish's own card) always answers 204, whatever buyers did. A wish no list shows any more is marked deleted; its row and image stay. Buyers who bought it still see it, marked as taken off.
- Lowering an amount below what is bought is always accepted. Buyers then see that none are left.
- Deleting a list takes every wish off it the same way. After that its owners and logged-out visitors get "not found", whatever was bought; buyers still see what they bought on it. A list with more than one owner can't be deleted, whatever is on it.
- Linking, copying, unlinking, undo, share links and leaving a list never read purchases or notes, so they answer the same whatever was bought. An already bought wish can be linked or copied like any other.
- Notices are about who owns what: a wish linked or unlinked, wishes made joint through a link, a new co-owner. Buying, ticking and writing notes never make one. Neither does a copy, by button or by link: it changes nothing for the owners of the original.
- Buying and writing notes never change a wish's `updatedAt` or its place in the list.
- An owner of a wish or of the list gets a fixed 403 when they try to write a note on it, also on a wish they took off. Deleting a note that isn't yours answers "not found", the same as a note that doesn't exist.
- Pages and API answers are sent with `Cache-Control: private, no-store`. Logging in and out reloads the page.
- Note ids are random, so a gap in a sequence can't hint at notes written elsewhere.

Only `purchases.ts`, `notes.ts` and `list-view.ts` in `server/domain/` read purchases or notes. Tests read the sources of the files behind wishes, lists, placements, sharing, undo, links and notices to keep it that way.

`test/visibility.test.ts` builds two databases that differ only in what buyers, and the other owners of a joint wish, did. It checks that each owner and a visitor get identical results from both. An owner's own purchase is the one difference, and only that owner sees it.

One limit: an owner can register a second account and open their own list as a buyer. Nothing in the code can stop that.
