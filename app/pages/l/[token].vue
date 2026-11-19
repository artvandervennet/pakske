<script setup lang="ts">
import type { WishView } from '#shared/schemas/list'
import type { RowControl } from '~/composables/useListEdit'
import type { AskTickWarning } from '~/composables/useTickWarning'

const route = useRoute()
const { t } = useI18n()
const localePath = useLocalePath()
const { parse } = useApiError()

const token = computed(() => String(route.params.token))
const { list, gone, refresh, movedTo } = await useListView(token)
// An owner at an address the list had before a new link: on to where it is now. Also when the
// list moved while this page was open (another tab, or the other owner): the next time the page
// asks for the list it follows, or it would go on copying a link that no longer works.
if (movedTo.value) await navigateTo(localePath(`/l/${movedTo.value}`), { replace: true })
watch(movedTo, to => to && navigateTo(localePath(`/l/${to}`), { replace: true }))

useHead({ title: () => list.value.title })

const names = useNames()
// Empty for a list whose owners' accounts are gone: the page then names nobody.
const owners = computed(() => names(list.value.owners))
const wishes = computed(() => removedLast(list.value.wishes))
const canManage = computed(() => list.value.viewerOwnsList && !list.value.deleted)
// The words that go along with the link in the share sheet: "my" list from its owner,
// "our" from one of several, "the" list from someone passing it on.
const shareText = computed(() => {
  const whose = !list.value.viewerOwnsList ? 'Other' : list.value.owners.length > 1 ? 'Joint' : 'Own'
  return t(`share.text${whose}`, { title: list.value.title })
})

const open = reactive(new Set<number>())
function toggle(id: number) {
  if (open.has(id)) open.delete(id)
  else open.add(id)
  if (rowMessage.value?.wishId === id) rowMessage.value = null
}

// A link to one wish (`/l/<token>#wish-12`, also where logging in returns to) opens that row.
// The server never sees the part after #, so this waits for the browser.
onMounted(async () => {
  const id = Number(/^#wish-(\d+)$/.exec(location.hash)?.[1])
  if (!list.value.wishes.some(wish => wish.id === id)) return
  open.add(id)
  await nextTick()
  document.getElementById(`wish-${id}`)?.scrollIntoView({ block: 'start' })
})

// One warning dialog for every row an owner can tick.
const warning = useTemplateRef<{ ask: AskTickWarning }>('warning')
provideTickWarning(title => warning.value?.ask(title) ?? Promise.resolve(false))
const hasOwnWishes = computed(() => list.value.wishes.some(wish => wish.role === 'owner'))

// A tick on a wish that was deleted meanwhile refreshes the list, and the row usually goes
// with it, taking its message along. Then the message is said here instead.
const goneNotice = ref('')
async function onTickChanged(wish: WishView, reason?: 'gone') {
  goneNotice.value = ''
  await refresh()
  // The list follows the fetched data through a watcher, which runs after this resolves.
  await nextTick()
  if (list.value.wishes.some(other => other.id === wish.id)) return
  if (reason === 'gone') goneNotice.value = t('tick.goneFromList', { title: wish.title })
  // The row went, and the control that was pressed with it: taking back the last purchase on
  // a wish that left the list does that too.
  keepFocus(wish.id)
}

// After an owner's edit saved: the row stays as it is, and so does the focus. The list follows
// the fetched data through a watcher, which runs after the refresh resolves.
async function refreshList() {
  await refresh()
  await nextTick()
}

// A change can take the focused control away with it: unlinking removes the person's line, and
// putting a wish on your own list can turn its card into an owner's. Then the focus goes to the
// row's own button (the one that folds an open card) while the row is still there, else to the
// list's heading rather than the start of the page.
const wishesTitle = useTemplateRef<HTMLElement>('wishesTitle')
function keepFocus(wishId: number) {
  if (document.activeElement && document.activeElement !== document.body) return
  const rowButton = document.querySelector<HTMLElement>(`#wish-${wishId} :is(.wish-toggle, .wish-fold)`)
  ;(rowButton ?? wishesTitle.value)?.focus()
}

async function onWishChanged(wish: WishView) {
  await refresh()
  await nextTick()
  keepFocus(wish.id)
}

// "Op mijn lijst zetten" worked or found the wish gone. The row says so at the top of its
// card; a linked wish is an owner's card after the refresh, with the line still above it.
// When the row went with the refresh, the list says it instead.
const rowMessage = ref<{ wishId: number, title: string, list?: { token: string, title: string } } | null>(null)

async function onAdded(wish: WishView, landed: { token: string, title: string }) {
  goneNotice.value = ''
  rowMessage.value = { wishId: wish.id, title: wish.title, list: landed }
  await refresh()
  await nextTick()
  keepFocus(wish.id)
}

async function onAddRemoved(wish: WishView) {
  goneNotice.value = ''
  rowMessage.value = { wishId: wish.id, title: wish.title }
  await refresh()
  await nextTick()
  if (!list.value.wishes.some(other => other.id === wish.id)) {
    rowMessage.value = null
    goneNotice.value = t('add.removed')
  }
  keepFocus(wish.id)
}

// "Verwijderen" in an owner's card took the wish off the list, and its row with the focus in it.
// The list says which one went, and the focus goes to the heading above the wishes.
async function onWishDeleted(wish: WishView) {
  open.delete(wish.id)
  rowMessage.value = null
  goneNotice.value = t('wish.deleted', { title: wish.title })
  await refresh()
  await nextTick()
  wishesTitle.value?.focus()
}

// Renaming: the title in the head band is the control. Activated, it turns into a field in
// the title's own type; leaving it or Enter saves, Escape puts the name back. The address stays.
const renaming = ref(false)
const renameField = useTemplateRef<{ focus: (select?: boolean) => void }>('renameField')
const renameButton = useTemplateRef<HTMLButtonElement>('renameButton')

async function startRenaming() {
  renaming.value = true
  await nextTick()
  renameField.value?.focus(true)
}

async function rename(text: string, saved: string): Promise<string | null> {
  const title = cleanText(text, 'line')
  if (title === saved) return null
  try {
    await $fetch(`/api/lists/${token.value}`, { method: 'PATCH', body: { title } })
    await refresh()
    return null
  }
  catch (error) {
    const parsed = parse(error)
    return parsed.fields.title ?? parsed.message
  }
}

async function onRenameDone(how: 'enter' | 'escape' | 'blur') {
  renaming.value = false
  // After leaving the field by clicking elsewhere, the focus is where that click put it.
  if (how === 'blur') return
  await nextTick()
  renameButton.value?.focus()
}

// A list with more than one owner can't be deleted: each owner leaves, and the last one
// deletes it. The edit bar offers the one that applies, away from the buttons people press
// every day. Either asks first, and afterwards the owner goes home, where the list is gone.
const shared = computed(() => list.value.owners.length > 1)
const { user } = useUserSession()
// The other owners, for "it stays with …": the viewer's own name taken out once, since two
// owners can have the same name.
const otherOwners = computed(() => {
  const others = [...list.value.owners]
  const own = others.indexOf(user.value?.displayName ?? '')
  if (own !== -1) others.splice(own, 1)
  return names(others)
})

const deleteDialog = useTemplateRef<HTMLDialogElement>('deleteDialog')
const leaveDialog = useTemplateRef<HTMLDialogElement>('leaveDialog')
const listError = ref('')
const deleting = ref(false)

function askToDeleteOrLeave() {
  if (deleting.value) return
  ;(shared.value ? leaveDialog : deleteDialog).value?.showModal()
}

/** The dialog's answer. Escape sets none, and browsers differ on whether it clears the last one. */
function answer(dialog: HTMLDialogElement | null): string {
  const choice = dialog?.returnValue ?? ''
  if (dialog) dialog.returnValue = ''
  return choice
}

async function deleteOrLeave(how: 'delete' | 'leave') {
  deleting.value = true
  listError.value = ''
  try {
    if (how === 'delete') await $fetch(`/api/lists/${token.value}`, { method: 'DELETE' })
    else await $fetch(`/api/lists/${token.value}/leave`, { method: 'POST' })
    await navigateTo(localePath('/'))
  }
  catch (error) {
    listError.value = parse(error).message
    // Someone joined or left since the page loaded: the bar then offers the other one.
    await refresh()
  }
  finally {
    deleting.value = false
  }
}

function onDeleteDialogClose() {
  if (answer(deleteDialog.value) === 'delete' && !deleting.value) deleteOrLeave('delete')
}

function onLeaveDialogClose() {
  if (answer(leaveDialog.value) === 'leave' && !deleting.value) deleteOrLeave('leave')
}

// Removing a co-owner, in edit mode beside leaving: one quiet button per person who joined the
// list after you, which asks first. What happened is said in a line that is always there, since
// the button that was pressed goes with the person.
type CoOwner = NonNullable<typeof list.value.coOwners>[number]
const removable = computed(() => (list.value.coOwners ?? []).filter(owner => owner.canRemove))
const removeOwnerDialog = useTemplateRef<HTMLDialogElement>('removeOwnerDialog')
const leaving = ref<CoOwner | null>(null)
const ownerStatus = ref('')

async function askToRemove(owner: CoOwner) {
  if (deleting.value) return
  leaving.value = owner
  // The dialog names the person, so it shows once that name is in it.
  await nextTick()
  removeOwnerDialog.value?.showModal()
}

async function onRemoveOwnerClose() {
  const owner = leaving.value
  if (answer(removeOwnerDialog.value) !== 'remove' || !owner || deleting.value) return
  deleting.value = true
  listError.value = ''
  ownerStatus.value = ''
  try {
    await $fetch(`/api/lists/${token.value}/owners/${owner.id}`, { method: 'DELETE' })
    ownerStatus.value = t('list.removeOwnerDone', { name: owner.name })
  }
  catch (error) {
    listError.value = parse(error).message
  }
  finally {
    deleting.value = false
    // Also after a refusal: someone joined, left or was removed since the page loaded.
    await refresh()
  }
}

// Someone who opened a list may ask its owners to be friends, one button per owner. That is how
// people find each other here: there is no search, and the request names the list it came from.
// What was asked stays on the page as a line; the server says the same after a reload, also for
// a request that was declined, which its sender must not be able to tell.
type Befriendable = NonNullable<typeof list.value.ownersToBefriend>[number]
// An owner who is a friend already isn't named here: there is nothing to ask, and nothing to say.
const befriendable = computed(() => (list.value.old ? [] : list.value.ownersToBefriend ?? []).filter(owner => befriendState(owner) !== 'friends' || asked.has(owner.id)))
const asked = reactive(new Map<number, 'asked' | 'friends'>())
const befriendState = (owner: Befriendable) => asked.get(owner.id) ?? owner.state
const befriending = ref(false)

async function befriend(owner: Befriendable) {
  if (befriending.value) return
  befriending.value = true
  bandError.value = ''
  try {
    const answered = await $fetch<{ state: 'asked' | 'friends' }>(`/api/lists/${token.value}/friend-requests`, { method: 'POST', body: { owner: owner.id } })
    asked.set(owner.id, answered.state)
    // The button is gone; the line that took its place is read out where the focus lands.
    await nextTick()
    document.getElementById(`befriend-${owner.id}`)?.focus()
  }
  catch (error) {
    bandError.value = parse(error).message
  }
  finally {
    befriending.value = false
  }
}

// "Vrienden", for an owner: which friends find this list among other people's lists on their Lists page.
const friendsDialog = useTemplateRef<{ open: () => Promise<void> }>('friendsDialog')
const friendsStatus = ref('')
function onFriendsSaved(shown: number) {
  friendsStatus.value = t('list.friendsSaved', { n: shown }, shown)
}

// "Nieuwe link", in edit mode: the list gets another address and the one it had stops opening it.
// It asks first. Afterwards the page goes on at the new address, where it says so once: the
// page there is a new one, so what to say travels in a state that page clears when it goes.
const newLinkDialog = useTemplateRef<HTMLDialogElement>('newLinkDialog')
const relinking = ref(false)
const relinkedTo = useState<string | null>('list-relinked-to', () => null)
const justRelinked = relinkedTo.value === token.value
const relinkedLine = useTemplateRef<HTMLElement>('relinkedLine')
if (justRelinked) {
  // Read out where the focus lands: the button that asked for it went with the old page.
  onMounted(() => relinkedLine.value?.focus())
  onBeforeUnmount(() => (relinkedTo.value = null))
}

// How many of the owner's friends find the list now: they follow it to the new address.
const shownFriends = ref(0)

async function askForNewLink() {
  if (relinking.value) return
  try {
    const answered = await $fetch<{ friends: { shown: boolean }[] }>(`/api/lists/${token.value}/friends`)
    shownFriends.value = answered.friends.filter(friend => friend.shown).length
  }
  catch {
    // The question can do without that sentence.
    shownFriends.value = 0
  }
  newLinkDialog.value?.showModal()
}

async function onNewLinkClose() {
  if (answer(newLinkDialog.value) !== 'relink' || relinking.value) return
  relinking.value = true
  listError.value = ''
  try {
    const made = await $fetch<{ token: string }>(`/api/lists/${token.value}/new-link`, { method: 'POST' })
    relinkedTo.value = made.token
    await navigateTo(localePath(`/l/${made.token}`), { replace: true })
  }
  catch (error) {
    listError.value = parse(error).message
  }
  finally {
    relinking.value = false
  }
}

// "Lijst samen beheren": a link that makes someone a co-owner of the list. It shows under the
// band's buttons, with the focus on its address. Someone with friends who could be sent the list
// is first asked whether it goes to some of them; the line under the buttons says who it went to.
const sendListDialog = useTemplateRef<{ open: () => Promise<void> }>('sendListDialog')
function startInvite() {
  void sendListDialog.value?.open()
}
function onListSent(to: string[]) {
  friendsStatus.value = t('list.sent', { names: names(to) }, to.length)
}

const listLink = ref<string | null>(null)
const listLinkBox = useTemplateRef<{ focus: () => void, share: () => Promise<boolean> }>('listLinkBox')
const inviting = ref(false)
const bandError = ref('')

async function inviteCoOwner() {
  if (inviting.value) return
  inviting.value = true
  bandError.value = ''
  try {
    const made = await $fetch<{ invite: string }>(`/api/lists/${token.value}/invites`, { method: 'POST', body: { kind: 'list' } })
    listLink.value = localePath(`/j/${made.invite}`)
    await nextTick()
    listLinkBox.value?.focus()
    // And straight on to the share sheet, where there is one. Not waited for: the link is made.
    void listLinkBox.value?.share()
  }
  catch (error) {
    bandError.value = parse(error).message
  }
  finally {
    inviting.value = false
  }
}

// Edit mode, for an owner: choose wishes to delete or share, move them, and delete or leave the
// list itself. The Edit button in the title band starts it with nothing chosen; holding a row
// starts it with that wish chosen. The ticks turn into boxes and the bar above the list acts on
// what is chosen. Done or Escape ends it. A list without wishes has the bar alone. Deleting several
// wishes at once is done here; an open wish has a delete button of its own, which asks first.
const rows = new Map<number, RowControl>()
function rowRef(id: number, row: unknown) {
  if (row) rows.set(id, row as RowControl)
  else rows.delete(id)
}
const edit = useListEdit({ token: () => token.value, wishes: () => wishes.value, refresh, open, rows })
const { editing, selected } = edit
const editButton = useTemplateRef<HTMLButtonElement>('editButton')
const editCount = useTemplateRef<HTMLElement>('editCount')

// The bar sticks under the header while the list scrolls. The page is told how tall it is
// (app.css adds it to the scroll padding), so a row that gets the focus scrolls to under the
// bar and not to behind it.
const editBar = useTemplateRef<HTMLElement>('editBar')
let barObserver: ResizeObserver | undefined
watch(editBar, (bar) => {
  barObserver?.disconnect()
  const root = document.documentElement
  if (!bar) return root.style.removeProperty('--edit-bar-height')
  barObserver = new ResizeObserver(() => root.style.setProperty('--edit-bar-height', `${bar.offsetHeight}px`))
  barObserver.observe(bar)
}, { flush: 'post' })
onBeforeUnmount(() => {
  barObserver?.disconnect()
  document.documentElement.style.removeProperty('--edit-bar-height')
})

/** Starts edit mode; the focus goes to the chosen wish's box, else to the bar. */
async function startEditing(wishId?: number) {
  if (!(await edit.enter(wishId))) return false
  listError.value = ''
  await nextTick()
  const box = wishId === undefined ? null : document.getElementById(`pick-${wishId}`)
  ;(box ?? editCount.value)?.focus()
  return true
}

/**
 * Ends edit mode; the focus goes back to the Edit button. That button is in the title band,
 * which may be far above a long list: the page stays where it is rather than jumping there.
 */
async function stopEditing() {
  edit.leave()
  await nextTick()
  ;(editButton.value ?? wishesTitle.value)?.focus({ preventScroll: true })
}

function onEscape(event: KeyboardEvent) {
  // A dialog or the move menu that is open takes Escape for itself.
  if (event.key !== 'Escape' || !editing.value || document.querySelector('dialog[open], :popover-open')) return
  stopEditing()
}
onMounted(() => document.addEventListener('keydown', onEscape))
onBeforeUnmount(() => document.removeEventListener('keydown', onEscape))

// "Delen": the dialog asks how, and makes the link. The bar's button opens it for the chosen
// wishes; once a link was made that choice has served, so closing the dialog ends edit mode too.
// The button in an open wish's card opens it for that one wish, without edit mode. The browser
// gives the focus back to the button that opened it.
const shareDialog = useTemplateRef<{ open: () => Promise<void> }>('shareDialog')
const shareIds = ref<number[]>([])

async function openShare(wishIds: number[]) {
  shareIds.value = wishIds
  // The dialog takes its wishes when it opens: let it have these first.
  await nextTick()
  await shareDialog.value?.open()
}

function share() {
  if (selected.size && !edit.busy.value) openShare(edit.chosen().map(wish => wish.id))
}

function onShareClose(made: boolean) {
  if (made && editing.value) stopEditing()
}

// Moving wishes in edit mode: drag the handle, or hold the row and drag (on a phone), or the
// arrow keys on the handle, or press the handle and choose where the wish goes. The last one
// needs neither a drag nor a keyboard. The list shows the move at once; the order is saved whole.
const wishList = useTemplateRef<HTMLElement>('wishList')
const { order } = edit
const shownWishes = computed(() => {
  // Also just after edit mode, while a move is still being saved, so the row doesn't jump back.
  if (!editing.value && !edit.orderPending.value) return wishes.value
  const byId = new Map(wishes.value.map(wish => [wish.id, wish]))
  return order.value.flatMap(id => byId.get(id) ?? [])
})
const drag = useDragReorder({
  list: wishList,
  order,
  move: edit.move,
  onDrop: () => edit.saveOrder(),
  // After the press that ended it: opened inside that press, the menu would count it as a
  // press outside itself and close again.
  onTap: id => setTimeout(() => openMoveMenu(id, false)),
})

function onHandleDown(wishId: number, event: PointerEvent) {
  drag.start(wishId, event, { tap: true })
}

// Pressing a handle opens a small menu under it: to the top, one up, one down, to the bottom.
// One menu serves every row; it hangs from the handle that opened it (Gesso's .menu.anchored).
// A pointer's press comes from the drag (onTap); Enter or Space on the handle is a click
// without a pointer.
const MOVES = ['moveTop', 'moveUp', 'moveDown', 'moveBottom'] as const
type Move = typeof MOVES[number]
const moveMenu = useTemplateRef<HTMLElement>('moveMenu')
const movingId = ref<number | null>(null)
const moveMenuOpen = ref(false)
const movingWish = computed(() => wishes.value.find(wish => wish.id === movingId.value) ?? null)
const handleOf = (wishId: number) => document.querySelector<HTMLElement>(`#wish-${wishId} .wish-handle`)

/** Where a choice of the menu would put the wish, or null when it is there already. */
function moveTarget(wishId: number, how: Move): number | null {
  const from = order.value.indexOf(wishId)
  const last = order.value.length - 1
  const to = { moveTop: 0, moveUp: from - 1, moveDown: from + 1, moveBottom: last }[how]
  return from === -1 || to === from || to < 0 || to > last ? null : to
}

async function openMoveMenu(wishId: number, byKeyboard: boolean) {
  const menu = moveMenu.value
  if (!menu || !editing.value) return
  if (menu.matches(':popover-open')) {
    const same = movingId.value === wishId
    menu.hidePopover()
    if (same) return
  }
  movingId.value = wishId
  // The handle gets the anchor's name first, so the menu opens under it.
  await nextTick()
  const handle = handleOf(wishId)
  if (!handle) return
  menu.showPopover({ source: handle })
  // A keyboard goes into the menu; a pointer stays where it is.
  if (byKeyboard) menu.querySelector<HTMLElement>('button:not([aria-disabled="true"])')?.focus()
}

function onHandleClick(wishId: number, event: MouseEvent) {
  if (event.detail === 0) openMoveMenu(wishId, true)
}

function onMoveMenuToggle(event: Event) {
  moveMenuOpen.value = (event as ToggleEvent).newState === 'open'
}

/** Moves a wish in the order on screen, saves, says where it is now, and keeps the focus on its handle. */
async function moveWish(wish: WishView, to: number, focusVisible = true) {
  edit.move(wish.id, to)
  edit.saveOrder({ delay: 400 })
  announcePlace(wish)
  await nextTick()
  // Moving the row can take the focus off its handle.
  const handle = handleOf(wish.id)
  handle?.closest('li')?.scrollIntoView({ block: 'nearest' })
  if (handle && document.activeElement !== handle) handle.focus({ preventScroll: true, focusVisible } as FocusOptions)
}

function chooseMove(how: Move, event: MouseEvent) {
  const wish = movingWish.value
  const to = wish ? moveTarget(wish.id, how) : null
  if (!wish || to === null) return
  // Back to the handle before the menu goes, so the focus is never inside something hidden;
  // without a ring after a pointer, which did not come from the keyboard.
  handleOf(wish.id)?.focus({ preventScroll: true, focusVisible: event.detail === 0 } as FocusOptions)
  moveMenu.value?.hidePopover()
  moveWish(wish, to, event.detail === 0)
}

// The menu belongs to edit mode, and to a wish that is still on the list.
watch([editing, movingWish], ([on, wish]) => {
  if ((!on || !wish) && moveMenu.value?.matches(':popover-open')) moveMenu.value.hidePopover()
})

// Holding a wish starts edit mode with it chosen, and keeps going as a drag if the finger moves.
const longPress = useLongPress(wishList, {
  enabled: () => canManage.value,
  onPress: async (wishId, event) => {
    if (editing.value) return drag.start(wishId, event)
    // Edit mode can wait for a save; a finger lifted meanwhile has nothing left to drag.
    // The bar that edit mode puts above the list pushes the rows down; the page scrolls along, so
    // the row stays under the finger that holds it.
    const top = () => document.getElementById(`wish-${wishId}`)?.getBoundingClientRect().top ?? 0
    const before = top()
    if (!(await startEditing(wishId))) return
    window.scrollBy({ top: top() - before, behavior: 'instant' })
    if (longPress.isHeld(event.pointerId)) drag.start(wishId, event)
  },
})

const orderStatus = ref('')
let statusTimer: ReturnType<typeof setTimeout> | undefined
/** Says where the wish is now, a moment after the move, so the refocused handle doesn't drown it. */
function announcePlace(wish: WishView) {
  orderStatus.value = ''
  clearTimeout(statusTimer)
  statusTimer = setTimeout(() => {
    orderStatus.value = t('listEdit.position', { title: wish.title, n: order.value.indexOf(wish.id) + 1, total: order.value.length })
  }, 300)
}
onBeforeUnmount(() => clearTimeout(statusTimer))

async function onHandleKey(wish: WishView, event: KeyboardEvent) {
  const step = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0
  if (!step) return
  event.preventDefault()
  const from = order.value.indexOf(wish.id)
  const to = from + step
  // At the top or the bottom there is nowhere to go: nothing moves and nothing is sent.
  if (from === -1 || to < 0 || to >= order.value.length) return
  await moveWish(wish, to)
}

const editDeleteDialog = useTemplateRef<HTMLDialogElement>('editDeleteDialog')
const chosenElsewhere = computed(() => edit.chosen().some(wish => wish.role === 'owner' && wish.alsoElsewhere))

function askToDeleteChosen() {
  if (selected.size && !edit.busy.value) editDeleteDialog.value?.showModal()
}

async function onEditDeleteClose() {
  if (answer(editDeleteDialog.value) !== 'delete') return
  await edit.deleteSelected()
  await nextTick()
  editCount.value?.focus()
}

const adding = ref(false)
const addError = ref('')

async function addWish(title: string) {
  adding.value = true
  addError.value = ''
  try {
    await $fetch(`/api/lists/${token.value}/wishes`, { method: 'POST', body: { title } })
    // The new row stays busy until its wish is in the list, so it doesn't empty before that shows.
    await refresh()
  }
  catch (error) {
    const parsed = parse(error)
    addError.value = parsed.fields.title ?? parsed.message
  }
  finally {
    adding.value = false
  }
}
</script>

<template>
  <div>
    <PageHead :title="list.title" :lead="list.viewerOwnsList || !owners ? null : t('list.owners', { names: owners })">
      <template v-if="canManage" #title>
        <h1 v-if="!renaming">
          <button ref="renameButton" type="button" class="title-edit" aria-describedby="list-rename-hint" @click="startRenaming">{{ list.title }}</button>
        </h1>
        <template v-else>
          <!-- The page keeps its heading while the visible title is a field. -->
          <h1 class="visually-hidden">{{ list.title }}</h1>
          <EditableText
            ref="renameField"
            class="title-edit-field"
            :value="list.title"
            :label="t('list.renameLabel')"
            :save="rename"
            :maxlength="80"
            @done="onRenameDone"
          />
        </template>
        <span id="list-rename-hint" class="visually-hidden">{{ t('list.rename') }}</span>
      </template>
      <template #actions>
        <!-- A deleted list only opens for people who bought something on it: no one to share it with. -->
        <ShareButton v-if="!list.deleted && !list.old" :path="localePath(`/l/${list.token}`)" :share="{ title: list.title, text: shareText }" />
        <div v-if="befriendable.length" class="befriend">
          <template v-for="owner in befriendable" :key="owner.id">
            <art-button v-if="befriendState(owner) === 'none'" variant="quiet" size="s">
              <button type="button" :aria-disabled="befriending || undefined" @click="befriend(owner)">{{ t('list.befriend', { name: owner.name }) }}</button>
            </art-button>
            <span v-else :id="`befriend-${owner.id}`" class="befriend-state" tabindex="-1">
              {{ befriendState(owner) === 'asked' ? t('list.befriendAsked', { name: owner.name }) : t('list.befriendFriends', { name: owner.name }) }}
            </span>
          </template>
        </div>
        <p v-if="bandError && !canManage" class="form-message" role="alert">{{ bandError }}</p>
        <template v-if="canManage">
          <!-- Gone while editing: the bar above the list has "Klaar", and takes over from here. -->
          <art-button v-if="!editing" variant="secondary">
            <button ref="editButton" type="button" @click="startEditing()"><AppIcon name="pencil" />{{ t('listEdit.start') }}</button>
          </art-button>
          <art-button variant="secondary">
            <button type="button" @click="friendsDialog?.open()">{{ t('list.friends') }}</button>
          </art-button>
          <art-button variant="secondary">
            <button type="button" :aria-disabled="inviting || undefined" @click="startInvite">{{ t('list.invite') }}</button>
          </art-button>
          <OneTimeLink v-if="listLink" ref="listLinkBox" :path="listLink" :text="t('list.inviteText')" :share="{ title: list.title, text: t('list.inviteShareText', { title: list.title }) }" />
          <!-- Always there for an owner, so the words are announced when they appear. -->
          <p class="form-message" role="status">{{ friendsStatus }}</p>
          <p v-if="bandError" class="form-message" role="alert">{{ bandError }}</p>
        </template>
      </template>
    </PageHead>

    <section class="band section" data-paint="1" aria-labelledby="wishes-title">
      <div class="inner">
        <div class="section-head">
          <h2 id="wishes-title" ref="wishesTitle" class="section-title" tabindex="-1">{{ t('list.wishes') }}</h2>
        </div>
        <div class="section-body">
          <p v-if="gone && !list.old" class="form-message" role="alert">
            {{ t('list.gone') }} <NuxtLink :to="localePath('/')">{{ t('error.home') }}</NuxtLink>
          </p>
          <p v-if="justRelinked" ref="relinkedLine" class="form-message" role="status" tabindex="-1">{{ t('list.newLinkDone') }}</p>
          <!-- What an old link still shows: the viewer's own ticks. When the last one is taken
               back the address answers nothing any more, and the page says why it is empty. -->
          <p v-if="list.old" class="form-message" role="status">{{ gone ? t('list.oldLinkDone') : t('list.oldLink') }}</p>
          <p v-else-if="list.deleted" class="form-message">
            {{ owners ? t('list.deleted', { names: owners }, list.owners.length) : t('list.deletedNobody') }}
          </p>
          <template v-else>
            <!-- Its only owner deleted their account: the list stays, and nobody manages it. -->
            <p v-if="!list.owners.length" class="form-message">{{ t('list.ownerless') }}</p>
            <p v-if="!wishes.length && !canManage" class="muted">{{ t('list.empty') }}</p>
          </template>
          <p v-if="goneNotice" class="form-message" role="alert">{{ goneNotice }}</p>
          <div v-if="editing" ref="editBar" class="joint-bar" role="group" :aria-label="t('listEdit.label')">
            <p ref="editCount" class="joint-bar-count" role="status" tabindex="-1">
              {{ wishes.length ? t('listEdit.selected', { n: selected.size }, selected.size) : t('list.empty') }}
            </p>
            <art-button size="s">
              <button type="button" @click="stopEditing">{{ t('listEdit.done') }}</button>
            </art-button>
            <div v-if="wishes.length" class="joint-bar-actions">
              <art-button variant="secondary" size="s">
                <button type="button" :aria-disabled="!selected.size || edit.busy.value || undefined" @click="askToDeleteChosen">{{ t('listEdit.delete') }}</button>
              </art-button>
              <art-button variant="secondary" size="s">
                <button type="button" :aria-disabled="!selected.size || edit.busy.value || undefined" @click="share">{{ t('joint.make') }}</button>
              </art-button>
            </div>
            <p v-if="edit.error.value" class="form-message" role="alert">{{ edit.error.value }}</p>
            <p v-if="edit.orderError.value" class="form-message" role="alert">{{ edit.orderError.value }}</p>
          </div>
          <p v-if="!editing && edit.orderError.value" class="form-message" role="alert">{{ edit.orderError.value }}</p>
          <p v-if="editing" class="visually-hidden" role="status">{{ orderStatus }}</p>
          <p v-if="editing" id="order-help" class="visually-hidden">{{ t('listEdit.moveHelp') }}</p>
          <ul v-if="(wishes.length || (canManage && !editing)) && !(list.old && gone)" ref="wishList" class="wish-list" :class="{ editing, manageable: canManage }">
            <WishRow
              v-for="wish in shownWishes"
              :key="wish.id"
              :ref="row => rowRef(wish.id, row)"
              :wish="wish"
              :token="list.token"
              :owners="list.owners"
              :viewer-owns-list="list.viewerOwnsList"
              :open="open.has(wish.id)"
              :refresh="refreshList"
              :edit-mode="editing"
              :bare="list.old"
              @toggle="toggle(wish.id)"
              @changed="onWishChanged(wish)"
              @ticked="reason => onTickChanged(wish, reason)"
              @added="landed => onAdded(wish, landed)"
              @removed="onAddRemoved(wish)"
              @share="openShare([wish.id])"
              @deleted="onWishDeleted(wish)"
            >
              <template #message>
                <!-- Always there in an open row, so the words are announced when they appear. -->
                <p class="wish-message" role="status">
                  <template v-if="rowMessage?.wishId === wish.id">
                    <i18n-t v-if="rowMessage.list" keypath="add.done" scope="global">
                      <template #title>{{ rowMessage.title }}</template>
                      <template #list>
                        <NuxtLink :to="localePath(`/l/${rowMessage.list.token}`)">{{ rowMessage.list.title }}</NuxtLink>
                      </template>
                    </i18n-t>
                    <template v-else>{{ t('add.removed') }}</template>
                  </template>
                </p>
              </template>
              <template v-if="editing" #end>
                <button
                  type="button"
                  class="wish-handle"
                  :aria-label="t('listEdit.move', { title: wish.title })"
                  aria-describedby="order-help"
                  aria-controls="move-menu"
                  :aria-expanded="moveMenuOpen && movingId === wish.id ? 'true' : 'false'"
                  :style="movingId === wish.id ? 'anchor-name: --move-handle' : undefined"
                  @pointerdown="event => onHandleDown(wish.id, event)"
                  @click="event => onHandleClick(wish.id, event)"
                  @keydown="event => onHandleKey(wish, event)"
                >
                  <AppIcon name="grip" />
                </button>
              </template>
              <!-- In edit mode the tick makes way for the box that chooses the wish. -->
              <template v-if="editing" #tick>
                <!-- Named by the row itself, a <label> for it in edit mode (WishRow). -->
                <div class="wish-tick joint-pick">
                  <span class="tick-box">
                    <input
                      :id="`pick-${wish.id}`"
                      type="checkbox"
                      :checked="selected.has(wish.id)"
                      @change="event => edit.toggle(wish.id, (event.target as HTMLInputElement).checked)"
                    >
                  </span>
                </div>
              </template>
            </WishRow>
            <li v-if="canManage && !editing" class="wish-add">
              <QuickAdd :label="t('list.add')" :field-label="t('list.newWish')" :pending="adding" :error="addError" @add="addWish" />
            </li>
          </ul>
          <!-- About the whole list, not the chosen wishes: under the list, away from the bar's
               buttons, and it asks first. -->
          <div v-if="editing" class="list-actions">
            <p v-if="listError" class="form-message" role="alert">{{ listError }}</p>
            <!-- Always there, so the words are announced; the button that went shows the rest. -->
            <p class="visually-hidden" role="status">{{ ownerStatus }}</p>
            <art-button v-for="owner in removable" :key="owner.id" variant="quiet" size="s">
              <button type="button" :aria-disabled="deleting || undefined" @click="askToRemove(owner)">{{ t('list.removeOwner', { name: owner.name }) }}</button>
            </art-button>
            <art-button variant="quiet" size="s">
              <button type="button" :aria-disabled="relinking || undefined" @click="askForNewLink">{{ t('list.newLink') }}</button>
            </art-button>
            <art-button variant="quiet" size="s" :class="{ danger: !shared }">
              <button type="button" :aria-disabled="deleting || undefined" @click="askToDeleteOrLeave">{{ shared ? t('list.leave') : t('list.delete') }}</button>
            </art-button>
          </div>
        </div>
      </div>
    </section>

    <TickWarning v-if="hasOwnWishes" ref="warning" />

    <!-- The choices a handle opens. A group of buttons, not a menu in ARIA's sense: Tab walks
         them like any buttons, and Escape or a press beside it closes it. -->
    <div
      v-if="canManage"
      id="move-menu"
      ref="moveMenu"
      class="menu anchored end"
      popover
      role="group"
      :aria-label="movingWish ? t('listEdit.move', { title: movingWish.title }) : undefined"
      style="position-anchor: --move-handle"
      @toggle="onMoveMenuToggle"
    >
      <button
        v-for="how in MOVES"
        :key="how"
        type="button"
        :aria-disabled="movingId === null || moveTarget(movingId, how) === null || undefined"
        @click="event => chooseMove(how, event)"
      >
        {{ t(`listEdit.${how}`) }}
      </button>
    </div>

    <ListFriendsDialog v-if="canManage" ref="friendsDialog" :token="list.token" :title="list.title" @saved="onFriendsSaved" />
    <SendListDialog v-if="canManage" ref="sendListDialog" :token="list.token" :title="list.title" @link="inviteCoOwner" @sent="onListSent" />

    <ShareWishesDialog v-if="canManage" ref="shareDialog" :token="list.token" :wish-ids="shareIds" @close="onShareClose" @failed="refreshList" />

    <dialog v-if="canManage && shared" ref="leaveDialog" class="dialog" aria-labelledby="list-leave-title" aria-describedby="list-leave-text" @close="onLeaveDialogClose">
      <h2 id="list-leave-title">{{ t('list.leaveTitle', { title: list.title }) }}</h2>
      <p id="list-leave-text">{{ t('list.leaveBody', { names: otherOwners }) }}</p>
      <form method="dialog" class="actions">
        <art-button variant="secondary">
          <button value="cancel" autofocus>{{ t('list.deleteCancel') }}</button>
        </art-button>
        <art-button>
          <button value="leave">{{ t('list.leaveConfirm') }}</button>
        </art-button>
      </form>
    </dialog>

    <dialog v-if="canManage && shared" ref="removeOwnerDialog" class="dialog" aria-labelledby="remove-owner-title" aria-describedby="remove-owner-text" @close="onRemoveOwnerClose">
      <h2 id="remove-owner-title">{{ t('list.removeOwnerTitle', { name: leaving?.name ?? '' }) }}</h2>
      <p id="remove-owner-text">{{ t('list.removeOwnerBody', { name: leaving?.name ?? '' }) }}</p>
      <form method="dialog" class="actions">
        <art-button variant="secondary">
          <button value="cancel" autofocus>{{ t('list.deleteCancel') }}</button>
        </art-button>
        <art-button class="danger">
          <button value="remove">{{ t('list.removeOwnerConfirm') }}</button>
        </art-button>
      </form>
    </dialog>

    <dialog v-if="canManage" ref="editDeleteDialog" class="dialog" aria-labelledby="edit-delete-title" aria-describedby="edit-delete-text" @close="onEditDeleteClose">
      <h2 id="edit-delete-title">{{ t('listEdit.deleteTitle', { n: selected.size }, selected.size) }}</h2>
      <p id="edit-delete-text">
        {{ t('listEdit.deleteBody') }}
        <template v-if="chosenElsewhere">{{ t('listEdit.deleteBodyElsewhere') }}</template>
      </p>
      <form method="dialog" class="actions">
        <art-button variant="secondary">
          <button value="cancel" autofocus>{{ t('listEdit.deleteCancel') }}</button>
        </art-button>
        <art-button class="danger">
          <button value="delete">{{ t('listEdit.deleteConfirm') }}</button>
        </art-button>
      </form>
    </dialog>

    <dialog v-if="canManage" ref="newLinkDialog" class="dialog" aria-labelledby="list-new-link-title" aria-describedby="list-new-link-text" @close="onNewLinkClose">
      <h2 id="list-new-link-title">{{ t('list.newLinkTitle', { title: list.title }) }}</h2>
      <p id="list-new-link-text">
        {{ t('list.newLinkBody') }}
        <template v-if="shared">{{ t('list.newLinkBodyShared', { names: otherOwners }, list.owners.length - 1) }}</template>
        <template v-if="shownFriends">{{ ' ' + t('list.newLinkBodyFriends', { n: shownFriends }, shownFriends) }}</template>
      </p>
      <form method="dialog" class="actions">
        <art-button variant="secondary">
          <button value="cancel" autofocus>{{ t('list.deleteCancel') }}</button>
        </art-button>
        <art-button>
          <button value="relink">{{ t('list.newLinkConfirm') }}</button>
        </art-button>
      </form>
    </dialog>

    <dialog v-if="canManage && !shared" ref="deleteDialog" class="dialog" aria-labelledby="list-delete-title" aria-describedby="list-delete-text" @close="onDeleteDialogClose">
      <h2 id="list-delete-title">{{ t('list.deleteTitle', { title: list.title }) }}</h2>
      <p id="list-delete-text">{{ t('list.deleteBody') }}</p>
      <form method="dialog" class="actions">
        <art-button variant="secondary">
          <button value="cancel" autofocus>{{ t('list.deleteCancel') }}</button>
        </art-button>
        <art-button class="danger">
          <button value="delete">{{ t('list.deleteConfirm') }}</button>
        </art-button>
      </form>
    </dialog>
  </div>
</template>
