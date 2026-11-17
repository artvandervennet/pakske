<script setup lang="ts">
import type { WishView } from '#shared/schemas/list'
import type { AskTickWarning } from '~/composables/useTickWarning'

const route = useRoute()
const { t, locale } = useI18n()
const localePath = useLocalePath()
const { parse } = useApiError()

const token = computed(() => String(route.params.token))
const { list, gone, refresh } = await useListView(token)

useHead({ title: () => list.value.title })

const owners = computed(() =>
  new Intl.ListFormat(locale.value, { type: 'conjunction' }).format(list.value.owners),
)
const wishes = computed(() => removedLast(list.value.wishes))
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

async function rename(text: string): Promise<string | null> {
  const title = oneLine(text).trim()
  if (title === list.value.title) return null
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
          <p v-if="gone" class="form-message" role="alert">
            {{ t('list.gone') }} <NuxtLink :to="localePath('/')">{{ t('error.home') }}</NuxtLink>
          </p>
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
            >
              <template v-if="wish.role !== 'anon'" #tick>
                <WishTick :wish="wish" :token="list.token" @changed="reason => onTickChanged(wish, reason)" />
              </template>
            </WishRow>
            <li v-if="canManage" class="wish-add">
              <QuickAdd :label="t('list.add')" :field-label="t('list.newWish')" :pending="adding" :error="addError" @add="addWish" />
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
