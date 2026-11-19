<script setup lang="ts">
import type { WishView } from '#shared/schemas/list'
import type { RowControl } from '~/composables/useListEdit'
import type { AskTickWarning } from '~/composables/useTickWarning'

const route = useRoute()
const { t } = useI18n()
const localePath = useLocalePath()
const { parse } = useApiError()

const token = computed(() => String(route.params.token))
const { list, gone, refresh } = await useListView(token)

useHead({ title: () => list.value.title })

const names = useNames()
// Empty for a list whose owners' accounts are gone: the page then names nobody.
const owners = computed(() => names(list.value.owners))
const wishes = computed(() => removedLast(list.value.wishes))
const canManage = computed(() => list.value.viewerOwnsList && !list.value.deleted)

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

// "Lijst samen beheren": a link that makes someone a co-owner of the list. It shows under the
// band's buttons, with the focus on its address.
const listLink = ref<string | null>(null)
const listLinkBox = useTemplateRef<{ focus: () => void }>('listLinkBox')
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
// what is chosen. Done or Escape ends it. A list without wishes has the bar alone. Deleting a
// wish is only done here: an open wish has no delete button to press by mistake.
const rows = new Map<number, RowControl>()
function rowRef(id: number, row: unknown) {
  if (row) rows.set(id, row as RowControl)
  else rows.delete(id)
}
const edit = useListEdit({ token: () => token.value, wishes: () => wishes.value, refresh, open, rows })
const { editing, selected } = edit
const editButton = useTemplateRef<HTMLButtonElement>('editButton')
const editCount = useTemplateRef<HTMLElement>('editCount')

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
  if (event.key !== 'Escape' || !editing.value || document.querySelector('dialog[open]')) return
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
// arrow keys on the handle. The list shows the move at once; the order is saved whole.
const wishList = useTemplateRef<HTMLElement>('wishList')
const { order } = edit
const shownWishes = computed(() => {
  // Also just after edit mode, while a move is still being saved, so the row doesn't jump back.
  if (!editing.value && !edit.orderPending.value) return wishes.value
  const byId = new Map(wishes.value.map(wish => [wish.id, wish]))
  return order.value.flatMap(id => byId.get(id) ?? [])
})
const drag = useDragReorder({ list: wishList, order, move: edit.move, onDrop: () => edit.saveOrder() })

function onHandleDown(wishId: number, event: PointerEvent) {
  drag.start(wishId, event)
}

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
  edit.move(wish.id, to)
  edit.saveOrder({ delay: 400 })
  announcePlace(wish)
  await nextTick()
  // Moving the row can take the focus off its handle.
  const handle = document.querySelector<HTMLElement>(`#wish-${wish.id} .wish-handle`)
  handle?.closest('li')?.scrollIntoView({ block: 'nearest' })
  if (handle && document.activeElement !== handle) handle.focus({ preventScroll: true })
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
        <ShareButton v-if="!list.deleted" :path="localePath(`/l/${list.token}`)" />
        <template v-if="canManage">
          <!-- Gone while editing: the bar above the list has "Klaar", and takes over from here. -->
          <art-button v-if="!editing" variant="secondary">
            <button ref="editButton" type="button" @click="startEditing()"><AppIcon name="pencil" />{{ t('listEdit.start') }}</button>
          </art-button>
          <art-button variant="secondary">
            <button type="button" :aria-disabled="inviting || undefined" @click="inviteCoOwner">{{ t('list.invite') }}</button>
          </art-button>
          <OneTimeLink v-if="listLink" ref="listLinkBox" :path="listLink" :text="t('list.inviteText')" />
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
          <p v-if="gone" class="form-message" role="alert">
            {{ t('list.gone') }} <NuxtLink :to="localePath('/')">{{ t('error.home') }}</NuxtLink>
          </p>
          <p v-if="list.deleted" class="form-message">
            {{ owners ? t('list.deleted', { names: owners }, list.owners.length) : t('list.deletedNobody') }}
          </p>
          <template v-else>
            <!-- Its only owner deleted their account: the list stays, and nobody manages it. -->
            <p v-if="!list.owners.length" class="form-message">{{ t('list.ownerless') }}</p>
            <p v-if="!wishes.length && !canManage" class="muted">{{ t('list.empty') }}</p>
          </template>
          <p v-if="goneNotice" class="form-message" role="alert">{{ goneNotice }}</p>
          <div v-if="editing" class="joint-bar" role="group" :aria-label="t('listEdit.label')">
            <p ref="editCount" class="joint-bar-count" role="status" tabindex="-1">
              {{ wishes.length ? t('listEdit.selected', { n: selected.size }, selected.size) : t('list.empty') }}
            </p>
            <art-button size="s">
              <button type="button" @click="stopEditing">{{ t('listEdit.done') }}</button>
            </art-button>
            <div class="joint-bar-actions">
              <template v-if="wishes.length">
                <art-button variant="secondary" size="s">
                  <button type="button" :aria-disabled="!selected.size || edit.busy.value || undefined" @click="askToDeleteChosen">{{ t('listEdit.delete') }}</button>
                </art-button>
                <art-button variant="secondary" size="s">
                  <button type="button" :aria-disabled="!selected.size || edit.busy.value || undefined" @click="share">{{ t('joint.make') }}</button>
                </art-button>
              </template>
              <!-- About the whole list, not the chosen wishes: quieter, at the far end, and it asks first. -->
              <art-button class="joint-bar-list" variant="quiet" size="s">
                <button type="button" :aria-disabled="deleting || undefined" @click="askToDeleteOrLeave">{{ shared ? t('list.leave') : t('list.delete') }}</button>
              </art-button>
            </div>
            <p v-if="edit.error.value" class="form-message" role="alert">{{ edit.error.value }}</p>
            <p v-if="edit.orderError.value" class="form-message" role="alert">{{ edit.orderError.value }}</p>
            <p v-if="listError" class="form-message" role="alert">{{ listError }}</p>
          </div>
          <p v-if="!editing && edit.orderError.value" class="form-message" role="alert">{{ edit.orderError.value }}</p>
          <p v-if="editing" class="visually-hidden" role="status">{{ orderStatus }}</p>
          <p v-if="editing" id="order-help" class="visually-hidden">{{ t('listEdit.moveHelp') }}</p>
          <ul v-if="wishes.length || (canManage && !editing)" ref="wishList" class="wish-list" :class="{ editing, manageable: canManage }">
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
                  @pointerdown="event => onHandleDown(wish.id, event)"
                  @keydown="event => onHandleKey(wish, event)"
                >
                  <span aria-hidden="true">⠿</span>
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
        </div>
      </div>
    </section>

    <TickWarning v-if="hasOwnWishes" ref="warning" />

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
        <art-button>
          <button value="delete">{{ t('listEdit.deleteConfirm') }}</button>
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
        <art-button>
          <button value="delete">{{ t('list.deleteConfirm') }}</button>
        </art-button>
      </form>
    </dialog>
  </div>
</template>
