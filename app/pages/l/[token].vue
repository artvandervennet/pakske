<script setup lang="ts">
import type { WishView } from '#shared/schemas/list'
import type { AskTickWarning } from '~/composables/useTickWarning'

const route = useRoute()
const { t, locale } = useI18n()
const localePath = useLocalePath()
const { parse } = useApiError()

const token = computed(() => String(route.params.token))
const { list, refresh } = await useListView(token)

useHead({ title: () => list.value.title })

const owners = computed(() =>
  new Intl.ListFormat(locale.value, { type: 'conjunction' }).format(list.value.owners),
)
// Removed wishes only reach buyers, who still need them to sort out what they bought. They
// go last, below everything that is still wanted.
const wishes = computed(() => {
  const isRemoved = (wish: WishView) => wish.role === 'buyer' && wish.removed
  return [...list.value.wishes.filter(wish => !isRemoved(wish)), ...list.value.wishes.filter(isRemoved)]
})
const canManage = computed(() => list.value.viewerOwnsList && !list.value.deleted)

const open = reactive(new Set<number>())
function toggle(id: number) {
  if (open.has(id)) open.delete(id)
  else open.add(id)
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

// A change can take the focused control away with it: deleting a wish removes its row, delete
// button and all. Then the focus goes to the list's heading rather than the start of the page.
const wishesTitle = useTemplateRef<HTMLElement>('wishesTitle')
async function onWishChanged() {
  await refresh()
  await nextTick()
  if (!document.activeElement || document.activeElement === document.body) wishesTitle.value?.focus()
}

// Renaming: the title turns into a field with Save and Cancel. The address stays the same.
const renaming = ref(false)
const newTitle = ref('')
const renameInput = useTemplateRef<HTMLInputElement>('renameInput')
const renameButton = useTemplateRef<HTMLButtonElement>('renameButton')
const { form: renameForm, pending: renamePending, message: renameMessage, errors: renameErrors, run: rename } = useForm(async () => {
  await $fetch(`/api/lists/${token.value}`, { method: 'PATCH', body: { title: newTitle.value } })
  await refresh()
  await stopRenaming()
})

async function startRenaming() {
  newTitle.value = list.value.title
  renameMessage.value = ''
  renameErrors.value = {}
  renaming.value = true
  await nextTick()
  renameInput.value?.select()
}

function onRenameEscape(event: KeyboardEvent) {
  // With an input method, Escape cancels the characters being composed, not the renaming.
  if (event.isComposing) return
  event.preventDefault()
  stopRenaming()
}

async function stopRenaming() {
  renaming.value = false
  // The button that opened the field comes back; the focus goes with it.
  await nextTick()
  renameButton.value?.focus()
}

// Deleting the list asks first. Afterwards the owner goes home, where it is gone.
const deleteDialog = useTemplateRef<HTMLDialogElement>('deleteDialog')
const deleteError = ref('')
const deleting = ref(false)

function askToDelete() {
  if (!deleting.value) deleteDialog.value?.showModal()
}

async function onDeleteDialogClose() {
  // Escape sets no value, and browsers differ on whether it clears the last one: reset it.
  const choice = deleteDialog.value?.returnValue
  if (deleteDialog.value) deleteDialog.value.returnValue = ''
  if (choice !== 'delete' || deleting.value) return
  deleting.value = true
  deleteError.value = ''
  try {
    await $fetch(`/api/lists/${token.value}`, { method: 'DELETE' })
    await navigateTo(localePath('/'))
  }
  catch (error) {
    deleteError.value = parse(error).message
  }
  finally {
    deleting.value = false
  }
}

const adding = ref(false)
const addError = ref('')

async function addWish(title: string) {
  adding.value = true
  addError.value = ''
  try {
    await $fetch(`/api/lists/${token.value}/wishes`, { method: 'POST', body: { title } })
    // The field stays busy until the new row is there, so it doesn't empty before it shows.
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
      <template v-if="renaming" #title>
        <!-- The page keeps its heading while the visible title is a field. -->
        <h1 class="visually-hidden">{{ list.title }}</h1>
        <form ref="renameForm" class="title-edit" novalidate @submit.prevent="rename">
          <p v-if="renameMessage" class="form-message" role="alert">{{ renameMessage }}</p>
          <FormField id="list-title" v-slot="field" :label="t('list.renameLabel')" :error="renameErrors.title">
            <input
              id="list-title"
              ref="renameInput"
              v-model="newTitle"
              name="title"
              type="text"
              maxlength="80"
              required
              autocomplete="off"
              enterkeyhint="done"
              :aria-describedby="field.describedBy"
              :aria-invalid="field.invalid"
              @keydown.esc="onRenameEscape"
            >
          </FormField>
          <div class="actions">
            <art-button>
              <button type="submit" :aria-disabled="renamePending || undefined">{{ t('list.renameSave') }}</button>
            </art-button>
            <art-button variant="secondary">
              <button type="button" @click="stopRenaming">{{ t('list.renameCancel') }}</button>
            </art-button>
          </div>
        </form>
      </template>
      <template #actions>
        <ShareButton :path="localePath(`/l/${list.token}`)" />
        <template v-if="canManage && !renaming">
          <art-button variant="secondary">
            <button ref="renameButton" type="button" @click="startRenaming">{{ t('list.rename') }}</button>
          </art-button>
          <art-button variant="quiet">
            <button type="button" :aria-disabled="deleting || undefined" @click="askToDelete">{{ t('list.delete') }}</button>
          </art-button>
        </template>
      </template>
    </PageHead>

    <section class="band section" data-paint="1" aria-labelledby="wishes-title">
      <div class="inner">
        <div class="section-head">
          <h2 id="wishes-title" ref="wishesTitle" class="section-title" tabindex="-1">{{ t('list.wishes') }}</h2>
        </div>
        <div class="section-body">
          <p v-if="list.deleted" class="form-message">{{ t('list.deleted', { names: owners }, list.owners.length) }}</p>
          <p v-else-if="!wishes.length && !canManage" class="muted">{{ t('list.empty') }}</p>
          <p v-if="deleteError" class="form-message" role="alert">{{ deleteError }}</p>
          <p v-if="goneNotice" class="form-message" role="alert">{{ goneNotice }}</p>
          <ul v-if="wishes.length || canManage" class="wish-list">
            <WishRow
              v-for="wish in wishes"
              :key="wish.id"
              :wish="wish"
              :token="list.token"
              :owners="owners"
              :owner-count="list.owners.length"
              :open="open.has(wish.id)"
              @toggle="toggle(wish.id)"
              @changed="onWishChanged"
              @closed="open.delete(wish.id)"
            >
              <template v-if="wish.role !== 'anon'" #tick>
                <WishTick :wish="wish" :token="list.token" @changed="reason => onTickChanged(wish, reason)" />
              </template>
            </WishRow>
            <li v-if="canManage" class="wish-add">
              <QuickAdd :label="t('list.add')" :pending="adding" :error="addError" @add="addWish" />
            </li>
          </ul>
        </div>
      </div>
    </section>

    <TickWarning v-if="hasOwnWishes" ref="warning" />

    <dialog v-if="canManage" ref="deleteDialog" class="dialog" aria-labelledby="list-delete-title" aria-describedby="list-delete-text" @close="onDeleteDialogClose">
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
