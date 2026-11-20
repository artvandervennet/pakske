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
- A wish taken off a list stays on that list for the people who have a purchase on it, marked "Taken off the list", and for nobody else: someone who bought none of it no longer gets it, whoever else did. A buyer can lower or withdraw their own purchase there and write notes, but not buy more; once they withdraw it the wish is gone for them too. Thirty days after it left the list it is gone for them anyway (`keptForBuyers` in `shared/utils/kept-for-buyers.ts`), so a list someone tidies up after a birthday is a clean page again for the people who gave. The owner who deletes a wish or a list can skip those thirty days: every question that deletes explains the wait and has a switch, "Gone for everyone right away" (`KeptForBuyers.vue`), which sends `clearForBuyers` with the delete and sets `list_wishes.cleared_at`. The question reads the same whether or not anyone bought anything, and the answer to the delete does too. Either way the purchase stays in the database and nobody is shown it. The same goes for the wishes of a deleted list, counted from the day it was deleted. The list's owners and the wish's owners never get that row.
- Someone who stops owning a wish (by taking it off their list, leaving a list, being removed from one or being unlinked) is a buyer of it again wherever they can still open a list that shows it, and sees its purchases and notes there.

Friends change nothing on a list. A friend who opens a list is a buyer like anyone who has its link, unless they own a wish there. Switching a list on for a friend only puts it on their Lists page. `getListView` knows nothing about friends; the list's route adds who the viewer may ask to be friends beside it. `server/domain/friends.ts` reads neither purchases nor notes, and a test reads its source to keep it that way.

What friends see of each other: a name, a profile picture, the lists switched on for them, and which of each other's lists they have. The picture goes to friends only; a list never carries its owners' pictures. Nobody sees who anyone else's friends are, on any page or in any answer. An owner never learns who opened their list, with one exception, between friends: a friend who opened the list by its link reads to its owner as having it, the same as one it was switched on for (`listFriendsForList`, `listFriends`). Without that the owner would be offered to share a list with someone who already has it. Showing a list still reports nothing back, and neither does a friend taking it off their page. A request shows the sender's name and the list it was sent from to that list's owner. A declined request is indistinguishable from a waiting one for its sender. Something sent to a friend (wishes, or a list to manage together) shows that friend what a share link would: the sender's name and the titles. The sender learns of a yes to wishes shared together or to a list (copies tell nobody), and never of a closed notice: an invitation to a list that was closed keeps reading as "invited" to its sender for as long as one that still waits would.

An address a list had before it got a new link no longer opens the list. `oldLinkView` answers it three ways:

- An owner of the list is told the new address.
- Someone logged in who has a purchase on a wish of that list gets those wishes only, each with their own purchase alone: no other buyers, no notes, no other wishes, and not the new address. They can lower or withdraw it there. Giving more, writing a note and putting the wish on a list of their own answer "not found".
- Everyone else gets "not found", like an address that never existed.

Who owns the list is all that decides an owner's answer, and a visitor's is always "not found", so both are the same whatever buyers did.

The page shows whatever the API returned, so the HTML that Nuxt renders on the server can't contain more than the person may see.

A chat app that fetches a link, to show it with the message it was sent in, isn't logged in: it is a visitor. From a list's page it reads the list's name, the owners' names and how many wishes are on it. No wish is named there, because the preview stays in the chat after the list changes or gets a new link. The links that need a login (a Secret Santa group, wishes or a list someone shares, a friend link) send it to the login page, which says what kind of link it is. That is read from the address alone (`sharedLinkKind` in `shared/utils/shared-link.ts`), with nothing looked up, so it names nobody and is the same for a link that doesn't exist. `public/robots.txt` lets those apps fetch a page and keeps everything else out.

Every request about a wish goes through a list link: the URL names the list's token, and the wish must be on that list now (`wishOnList` in `server/domain/placement.ts`). A wish's number alone gives no access. Lowering or withdrawing a purchase and writing a note also work on a wish that left the list; buying more there answers `wish_removed`. A few requests name no list. Deleting your own note and dismissing your own notice go by a random id, and only their owner gets anything but "not found". A share link goes by its own token.

An owner can tick their own wish. Before every tick or higher number the site asks "You might find out that someone already got this. Continue?"; unticking and lowering don't ask. When not enough are left, the owner reads "Someone already has this" or "There aren't that many left" and nothing is recorded. The server answers with a code only, so the refusal names nobody and gives no number. The owner's row never says how many are left, and its count and its + are always enabled.

Rules that keep an owner from finding out by a detour:

- Taking a wish off your list ("Delete" in the list's edit mode or in the wish's own card) always answers 204, whatever buyers did. A wish no list shows any more is marked deleted; its row and image stay. Buyers who bought it still see it for thirty days, marked as taken off.
- Lowering an amount below what is bought is always accepted. Buyers then see that none are left.
- Deleting a list takes every wish off it the same way. After that its owners and logged-out visitors get "not found", whatever was bought; buyers still see what they bought on it, for thirty days. A list with more than one owner can't be deleted, whatever is on it.
- Linking, copying, unlinking, undo, share links and leaving a list never read purchases or notes, so they answer the same whatever was bought. An already bought wish can be linked or copied like any other.
- Notices are about who owns what: a wish linked or unlinked, wishes made joint through a link, a new co-owner. Buying, ticking and writing notes never make one. A message to the owners does, without a name (see Writing to the owners below). Neither does a copy, by button or by link: it changes nothing for the owners of the original.
- Buying and writing notes never change a wish's `updatedAt` or its place in the list.
- An owner of a wish or of the list gets a fixed 403 when they try to write a note on it, also on a wish they took off. Deleting a note that isn't yours answers "not found", the same as a note that doesn't exist.
- Pages and API answers are sent with `Cache-Control: private, no-store`. Logging in and out reloads the page.
- Note ids are random, so a gap in a sequence can't hint at notes written elsewhere.

The home page shows someone what they give, per person it is for (`listGiven` in `server/domain/purchases.ts`). It holds what the lists on their page would show them of their own, and nothing else:

- The purchases table is read for that person's own rows only, so what anyone else ticked can't change it, and an owner's home page says nothing about what was bought for them. A wish they own themselves is left out: that tick means "I have this".
- A row links to a list that shows the wish, and only to one the person opened or that a friend shows them. A wish that no such list shows is left out, also when a list they never had the link of shows it. So what is on a list they took off their page is gone from the overview until they open that list again, and so is what is on a list that got a new link.
- A wish that left its list stays in the overview, marked "Taken off the list", for as long as it stays on the list's page for its buyer, and goes at the same moment.

Only `purchases.ts`, `notes.ts` and `list-view.ts` in `server/domain/` read purchases or notes. Tests read the sources of the files behind wishes, lists, placements, sharing, undo, links and notices to keep it that way.

`test/visibility.test.ts` builds two databases that differ only in what buyers, and the other owners of a joint wish, did. It checks that each owner and a visitor get identical results from both. An owner's own purchase is the one difference, and only that owner sees it.

One limit: an owner can register a second account and open their own list as a buyer. Nothing in the code can stop that.

## Writing to the owners

Someone who opened a list can write to its owners, to ask or tell them something, and the owners read it without a name. This is the one thing a buyer does that an owner is shown, and only because the buyer chose to write.

- `server/domain/messages.ts` keeps one conversation per person and list (`list_threads`, with its messages in `list_messages`). `threadsFor` builds what one viewer reads: an owner of the list gets every conversation, each as a random id and its messages; anyone else gets their own. A message says whether an owner wrote it and, only then, that owner's name. The account a conversation is with is read to find the person's own conversation and to tell them of an answer, and is in no answer to anyone.
- An owner answers in a conversation, with their name. On a joint list every owner reads every conversation and any of them can answer.
- The owners get a notice that someone wrote. It names nobody: its row has the owner themselves as its actor, and `listNotices` sends it without a name, an id or a picture. Whoever wrote gets a notice with the name of the owner who answered. A person has one notice per list for each of the two; a newer message replaces it.
- The notice about an answer leads to the list only while the person still has it: a friend shows it to them, or it is among the lists they opened. After a new link it is neither, so the notice never hands out an address they weren't given.
- Everyone can delete a message they wrote; deleting someone else's answers "not found", like a message that doesn't exist. An owner can delete a whole conversation on their list. A conversation whose last message is deleted is gone, and what its writer sends next starts a new one with a new id, which the owners can't tell from a first message by someone else.
- When the person who wrote deletes their account, the conversation stays as it was (`list_threads.user_id` becomes null), so an owner can't match a conversation that went to an account that went. An answer in it then reaches nobody. An owner's answer stays too when that owner's account goes, without a name.
- Writing is for someone logged in, on a list that isn't deleted and has an owner to read it. An owner can't start a conversation: they have nobody to write to but someone who wrote first.
- `server/domain/messages.ts` reads neither purchases nor notes, and a test reads its source to keep it that way. A test checks that a message leaves an owner's view of their wishes as it was.

The limits. The site doesn't say who wrote, but the words can: a message that mentions something only one person knows names that person. An owner who gave the link to one person knows who has it. And who wrote is in the database, where whoever runs the server can read it.

## Secret Santa

A Secret Santa group has one secret of its own: who drew whom. It is kept the way a wish's buyers are kept from its owners, by never sending it.

- `getGroup` in `server/domain/santa.ts` builds a group for one viewer. A member gets the members (name, whether they put a list in, who runs the group) and, of the draw, the one name they drew themselves, with the list that person put in. The name in `gives_to` is read from the viewer's own row and from no other, so the answer is the same whatever the others drew. Of the other rows only whether there is a name: every member sees who has none yet, because they joined after the draw or the person they drew is gone. The person who runs the group gets exactly what any member gets.
- Someone who isn't in the group gets its name, who runs it, how many are in, and whether it can still be joined. No member is named to them but the one who runs it.
- The rows on the home page and the Secret Santa page say how many are in a group and whether the names are drawn. The notices say that someone joined, that someone was taken out, and that the names were drawn or drawn again, never what came out.
- A test builds two databases that differ only in what the other members drew and checks that a member, the organiser and an outsider each get the same answer from both.
- Someone with a name who leaves, or is taken out, takes the whole draw along: every member's name is wiped, and the page reads the same for all who stay. Wiping only the name of whoever had drawn them would show the others who that was. Everyone who stays is told who went.
- Drawing again, for someone who joined later or after someone went, is a new draw of everyone. Fitting the newcomer into the old draw would change one member's name, and that member would know the newcomer now has the name they had. Every other member is told that the names were drawn again.
- A list that a member puts in is handed to every other member as its link: on the group's page beside the member's name, and among their lists "Van anderen" (`listGroupLists`), for as long as both are in the group and the list stays in. It opens for them as it does for anyone who has the link: they are buyers there. Someone who only has the group's link, and isn't in it, gets none of the lists.
- What a member ticks on a list of the person they drew is given without their name unless they say otherwise on the wish (`drewAnOwnerOf`, read by `setPurchase`). Without that, another member who opens the same list would read the draw from who ticked what. The list's page tells them before they tick (`drewOwners`, added by the list's route for the viewer alone).
- `server/domain/santa.ts` reads neither purchases nor notes, and a test reads its source to keep it that way.

Three limits. With three members there are only two possible draws, so each member can work out who drew them; the question before the draw says so, and from four on it can't be done. The draw is in the database, where whoever runs the server can read it. And when an account is deleted after the draw, whoever drew that person is given the name that person had drawn, and so learns that one pair. A deleted account can't be named in a notice, so the draw is mended that way instead of ended, as it is when someone leaves.
