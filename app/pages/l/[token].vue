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
  if (reason === 'gone' && !list.value.wishes.some(other => other.id === wish.id)) {
    goneNotice.value = t('tick.goneFromList', { title: wish.title })
  }
}

// After an owner's edit saved: the row stays as it is, and so does the focus. The list follows
// the fetched data through a watcher, which runs after the refresh resolves.
async function refreshList() {
  await refresh()
  await nextTick()
}

// A change can take the focused control away with it: deleting a wish removes its row, delete
// button and all; unlinking removes the person's line. Then the focus goes to the row's own
// button while the row is still there, else to the list's heading rather than the start of the page.
const wishesTitle = useTemplateRef<HTMLElement>('wishesTitle')
function keepFocus(wishId: number) {
  if (document.activeElement && document.activeElement !== document.body) return
  const rowButton = document.querySelector<HTMLElement>(`#wish-${wishId} .wish-toggle`)
  ;(rowButton ?? wishesTitle.value)?.focus()
}

async function onWishChanged(wish: WishView) {
  await refresh()
  await nextTick()
  keepFocus(wish.id)
}

// "Op mijn lijst zetten" worked or found the wish gone. The row says so at the top of its
// details; a linked wish is an owner's row after the refresh, with the line still above it.
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
// deletes it. The band offers the one that applies. Either asks first, and afterwards the
// owner goes home, where the list is gone.
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
const bandError = ref('')
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
  bandError.value = ''
  try {
    if (how === 'delete') await $fetch(`/api/lists/${token.value}`, { method: 'DELETE' })
    else await $fetch(`/api/lists/${token.value}/leave`, { method: 'POST' })
    await navigateTo(localePath('/'))
  }
  catch (error) {
    bandError.value = parse(error).message
    // Someone joined or left since the page loaded: the band then offers the other one.
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

// A link that makes someone a co-owner of the list. It shows under the band's buttons, with
// the focus on its address.
const listLink = ref<string | null>(null)
const listLinkBox = useTemplateRef<{ focus: () => void }>('listLinkBox')
const inviting = ref(false)

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

// Edit mode, for an owner: choose wishes to delete or make joint. The Edit button starts it with
// nothing chosen; "Gezamenlijk maken" in an open wish starts it with that wish chosen. The ticks
// turn into boxes and the bar above the list acts on what is chosen. Done or Escape ends it.
const rows = new Map<number, RowControl>()
function rowRef(id: number, row: unknown) {
  if (row) rows.set(id, row as RowControl)
  else rows.delete(id)
}
const edit = useListEdit({ token: () => token.value, wishes: () => wishes.value, refresh, open, rows })
const { editing, selected } = edit
const editButton = useTemplateRef<HTMLButtonElement>('editButton')
const editCount = useTemplateRef<HTMLElement>('editCount')
const wishLink = ref<string | null>(null)
const wishLinkBox = useTemplateRef<{ focus: () => void }>('wishLinkBox')

/** Starts edit mode; the focus goes to the chosen wish's box, else to the bar. */
async function startEditing(wishId?: number) {
  if (!(await edit.enter(wishId))) return false
  wishLink.value = null
  await nextTick()
  const box = wishId === undefined ? null : document.getElementById(`pick-${wishId}`)
  ;(box ?? editCount.value)?.focus()
  return true
}

/** Ends edit mode; the focus goes back to the Edit button, or the heading when the list is empty. */
async function stopEditing() {
  edit.leave()
  await nextTick()
  ;(editButton.value ?? wishesTitle.value)?.focus()
}

function onEscape(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !editing.value || document.querySelector('dialog[open]')) return
  stopEditing()
}
onMounted(() => document.addEventListener('keydown', onEscape))
onBeforeUnmount(() => document.removeEventListener('keydown', onEscape))

// The list emptied while editing ends edit mode (useListEdit); the focus then goes to the heading.
watch(editing, (on) => {
  if (!on && !wishes.value.length) nextTick(() => wishesTitle.value?.focus())
})

// Holding a wish starts edit mode with it chosen; handy on a phone.
const wishList = useTemplateRef<HTMLElement>('wishList')
useLongPress(wishList, {
  enabled: () => canManage.value,
  onPress: (wishId) => {
    if (!editing.value) startEditing(wishId)
  },
})

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

async function makeJoint() {
  const path = await edit.makeLink()
  if (!path) return
  wishLink.value = path
  await nextTick()
  wishLinkBox.value?.focus()
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
    <PageHead :title="list.title" :lead="list.viewerOwnsList ? null : t('list.owners', { names: owners })">
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
          <art-button variant="secondary">
            <button type="button" :aria-disabled="inviting || undefined" @click="inviteCoOwner">{{ t('list.invite') }}</button>
          </art-button>
          <art-button variant="quiet">
            <button type="button" :aria-disabled="deleting || undefined" @click="askToDeleteOrLeave">{{ shared ? t('list.leave') : t('list.delete') }}</button>
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
          <div v-if="canManage && wishes.length && !editing" class="actions">
            <art-button variant="secondary" size="s">
              <button ref="editButton" type="button" @click="startEditing()">{{ t('listEdit.start') }}</button>
            </art-button>
          </div>
        </div>
        <div class="section-body">
          <p v-if="gone" class="form-message" role="alert">
            {{ t('list.gone') }} <NuxtLink :to="localePath('/')">{{ t('error.home') }}</NuxtLink>
          </p>
          <p v-if="list.deleted" class="form-message">{{ t('list.deleted', { names: owners }, list.owners.length) }}</p>
          <p v-else-if="!wishes.length && !canManage" class="muted">{{ t('list.empty') }}</p>
          <p v-if="goneNotice" class="form-message" role="alert">{{ goneNotice }}</p>
          <div v-if="editing" class="joint-bar" role="group" :aria-label="t('listEdit.label')">
            <p ref="editCount" class="joint-bar-count" role="status" tabindex="-1">{{ t('listEdit.selected', { n: selected.size }, selected.size) }}</p>
            <div class="joint-bar-actions">
              <art-button variant="secondary" size="s">
                <button type="button" :aria-disabled="!selected.size || edit.busy.value || undefined" @click="askToDeleteChosen">{{ t('listEdit.delete') }}</button>
              </art-button>
              <art-button variant="secondary" size="s">
                <button type="button" :aria-disabled="!selected.size || edit.busy.value || undefined" @click="makeJoint">{{ t('joint.make') }}</button>
              </art-button>
              <art-button size="s">
                <button type="button" @click="stopEditing">{{ t('listEdit.done') }}</button>
              </art-button>
            </div>
            <p v-if="edit.error.value" class="form-message" role="alert">{{ edit.error.value }}</p>
          </div>
          <OneTimeLink v-else-if="wishLink" ref="wishLinkBox" class="joint-link" :path="wishLink" :text="t('joint.linkText')" />
          <ul v-if="wishes.length || canManage" ref="wishList" class="wish-list" :class="{ editing, manageable: canManage }">
            <WishRow
              v-for="wish in wishes"
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
              @added="landed => onAdded(wish, landed)"
              @removed="onAddRemoved(wish)"
              @joint="startEditing(wish.id)"
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
              <template v-if="wish.role !== 'anon'" #tick>
                <!-- Named by the row itself, a <label> for it in edit mode (WishRow). -->
                <div v-if="editing" class="wish-tick joint-pick">
                  <span class="tick-box">
                    <input
                      :id="`pick-${wish.id}`"
                      type="checkbox"
                      :checked="selected.has(wish.id)"
                      @change="event => edit.toggle(wish.id, (event.target as HTMLInputElement).checked)"
                    >
                  </span>
                </div>
                <WishTick v-else :wish="wish" :token="list.token" @changed="reason => onTickChanged(wish, reason)" />
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
