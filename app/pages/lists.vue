<script setup lang="ts">
import type { ListsView } from '#shared/schemas/list'

// Every list of your own, and other people's lists: the ones a friend shows you and the ones you
// opened by a link, as one row, with one search over all of them. Logged in they are two tabs;
// logged out there are only the lists this browser opened.
// "Bewerken" in the title band starts edit mode, where lists are ticked and then deleted (your
// own) or taken off the page (other people's).

const { t } = useI18n()
const localePath = useLocalePath()
const route = useRoute()
const router = useRouter()
const { loggedIn } = useUserSession()
const { parse } = useApiError()
const names = useNames()

useHead({ title: () => t('lists.title') })

const { data, error, refresh } = await useFetch<ListsView>('/api/lists')
// Without it a failed load would look like having no lists at all.
const loadError = computed(() => (error.value ? parse(error.value).message : ''))

// The search filters both tabs at once, in the browser: the page already has every list.
// The words are kept in the address too (?q=), so they are still there after a reload, or after
// opening a list and coming back. The field is the source; the address only follows it, so a
// slow navigation can never overwrite what is being typed.
const query = ref(typeof route.query.q === 'string' ? route.query.q : '')
const searching = computed(() => query.value.trim() !== '')
const mine = computed(() => searchLists(data.value?.owned ?? [], query.value))
const visited = computed(() => searchLists(data.value?.opened ?? [], query.value))
const found = computed(() => (loggedIn.value ? mine.value.length : 0) + visited.value.length)

watch(query, (words) => {
  router.replace({ query: { ...route.query, q: words.trim() ? words : undefined } })
})

// Tabs. The chosen one lives in the address (?tab=visited), so a reload and the back button
// keep it. It replaces the history entry: walking through the tabs is not a trail of pages.
type Tab = 'mine' | 'visited'
const tab = computed<Tab>(() => (route.query.tab === 'visited' ? 'visited' : 'mine'))
const tabs = computed(() => [
  { id: 'mine' as const, label: t('lists.mine'), count: mine.value.length },
  { id: 'visited' as const, label: t('lists.visited'), count: visited.value.length },
])
const tabButtons = useTemplateRef<HTMLButtonElement[]>('tabButton')

function show(next: Tab) {
  router.replace({ query: { ...route.query, tab: next === 'visited' ? 'visited' : undefined } })
}

// Left and Right walk through the tabs and wrap around; Home and End go to the first and the
// last. The tab that gets the focus is shown at once: showing a panel costs nothing here.
function onTabKey(event: KeyboardEvent) {
  const last = tabs.value.length - 1
  const at = tabs.value.findIndex(({ id }) => id === tab.value)
  const to = { ArrowRight: at === last ? 0 : at + 1, ArrowLeft: at === 0 ? last : at - 1, Home: 0, End: last }[event.key]
  if (to === undefined) return
  event.preventDefault()
  show(tabs.value[to]!.id)
  tabButtons.value?.[to]?.focus()
}

// The panel that isn't shown is hidden "until found": the browser's own search (Ctrl+F) still
// finds a list in it, and `beforematch` then shows its tab. Vue only knows `hidden` as on or
// off, so the value is set here, after Vue has hidden a panel. A browser that doesn't know the
// value simply hides the panel.
const minePanel = useTemplateRef<HTMLElement>('minePanel')
const visitedPanel = useTemplateRef<HTMLElement>('visitedPanel')
function keepFindable() {
  for (const panel of [minePanel.value, visitedPanel.value]) {
    if (panel?.hidden) panel.setAttribute('hidden', 'until-found')
  }
}
onMounted(keepFindable)
watch(tab, keepFindable, { flush: 'post' })

const { creating, createError, createList } = useNewList()

// After "Weghalen" the focus goes to what names the visited lists: their tab, or their heading
// when logged out.
const visitedTitle = useTemplateRef<HTMLElement>('visitedTitle')
const { removeError, forget } = useForgetList(refresh, () => (loggedIn.value ? tabButtons.value?.[1] : visitedTitle.value))

// Edit mode: every row gets a box, and the bar above the lists acts on the ticked ones. It acts
// on the lists in view: your own are deleted, other people's are taken off the page. Going to the
// other tab unticks everything, so nothing is deleted that isn't on screen as a kind. A ticked
// list that the search hides stays ticked, and the bar keeps counting it.
const edit = useListsEdit({ refresh })
const { editing, selected } = edit
const hasLists = computed(() => (data.value?.owned.length ?? 0) + (data.value?.opened.length ?? 0) > 0)
const shown = computed<Tab>(() => (loggedIn.value ? tab.value : 'visited'))
const chosenMine = computed(() => (data.value?.owned ?? []).filter(list => selected.has(list.token)))
const chosenVisited = computed(() => (data.value?.opened ?? []).filter(list => selected.has(list.token)))
const chosen = computed(() => (shown.value === 'mine' ? chosenMine.value : chosenVisited.value))
watch(shown, () => edit.clear())

const editButton = useTemplateRef<HTMLButtonElement>('editButton')
const editCount = useTemplateRef<HTMLElement>('editCount')
const editBar = useTemplateRef<HTMLElement>('editBar')
useEditBarHeight(editBar)

/** Starts edit mode; the focus goes to the bar, which says what to do. */
async function startEditing() {
  edit.enter()
  await nextTick()
  editCount.value?.focus()
}

/** Ends edit mode; the focus goes back to "Bewerken", without the page jumping up to it. */
async function stopEditing() {
  edit.leave()
  await nextTick()
  editButton.value?.focus({ preventScroll: true })
}

function onEscape(event: KeyboardEvent) {
  // An open dialog takes Escape for itself.
  if (event.key !== 'Escape' || !editing.value || document.querySelector('dialog[open]')) return
  stopEditing()
}
onMounted(() => document.addEventListener('keydown', onEscape))
onBeforeUnmount(() => document.removeEventListener('keydown', onEscape))

// The rows went, and the boxes with them: the focus goes to the bar's count.
async function afterRemoving() {
  await nextTick()
  editCount.value?.focus()
}

// Other people's lists go without a question, as "Weghalen" on a row does: the link keeps
// working. Your own lists are deleted for good, so that asks first.
const deleteDialog = useTemplateRef<HTMLDialogElement>('deleteDialog')
// Off every time the question is asked: skipping the wait is a choice made per delete. It is
// only asked when something is deleted; a list that is left stays as it is for everyone else.
const clearForBuyers = ref(false)
const deletesSome = computed(() => chosenMine.value.some(list => !list.sharedWith.length))

async function removeChosen() {
  if (!chosen.value.length || edit.busy.value) return
  if (shown.value === 'mine') {
    clearForBuyers.value = false
    return deleteDialog.value?.showModal()
  }
  await edit.each(chosenVisited.value.map(list => list.token), token => $fetch<unknown>(`/api/home/opened/${token}`, { method: 'DELETE' }))
  await afterRemoving()
}

// A list with other owners can't be deleted, only left: it stays with them. The question says
// which of the two happens. One list is asked about by name, the way its own page asks; more
// are counted, with their names under the question.
const deleteWords = computed(() => {
  const lists = chosenMine.value
  const n = lists.length
  const left = lists.filter(list => list.sharedWith.length).length
  const only = n === 1 ? lists[0]! : null
  if (only && left) return { title: t('list.leaveTitle', { title: only.title }), body: t('list.leaveBody', { names: names(only.sharedWith) }), confirm: t('list.leaveConfirm'), danger: false }
  if (only) return { title: t('list.deleteTitle', { title: only.title }), body: t('list.deleteBody'), confirm: t('list.deleteConfirm'), danger: true }
  if (n && left === n) return { title: t('lists.leaveTitle', { n }), body: t('lists.leaveBody'), confirm: t('lists.leaveConfirm'), danger: false }
  return { title: t('lists.deleteTitle', { n }), body: left ? `${t('lists.deleteBody')} ${t('lists.deleteBodyShared')}` : t('lists.deleteBody'), confirm: t('lists.deleteConfirm'), danger: true }
})

async function onDeleteClose() {
  const dialog = deleteDialog.value
  // Escape sets no answer, and browsers differ on whether it clears the last one: reset it.
  const choice = dialog?.returnValue ?? ''
  if (dialog) dialog.returnValue = ''
  if (choice !== 'delete') return
  const lists = chosenMine.value
  const leaving = new Set(lists.filter(list => list.sharedWith.length).map(list => list.token))
  await edit.each(lists.map(list => list.token), token =>
    leaving.has(token) ? $fetch<unknown>(`/api/lists/${token}/leave`, { method: 'POST' }) : $fetch<unknown>(`/api/lists/${token}`, { method: 'DELETE', body: { clearForBuyers: clearForBuyers.value } }))
  await afterRemoving()
}
</script>

<template>
  <div>
    <PageHead :title="t('lists.title')">
      <!-- Gone while editing: the bar above the lists has "Klaar", and takes over from here. -->
      <template v-if="hasLists && !editing" #actions>
        <art-button variant="secondary">
          <button ref="editButton" type="button" @click="startEditing"><AppIcon name="pencil" />{{ t('listEdit.start') }}</button>
        </art-button>
      </template>
    </PageHead>

    <div class="band wide" data-paint="1">
      <div class="inner">
        <!-- One search bar for both tabs: a magnifying glass and one word say what it is, and
             its full name is there for a screen reader. Each tab's label shows how many of its
             lists fit; the line under the bar says the total aloud as the words are typed. -->
        <div class="lists-search" role="search">
          <svg class="lists-search-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <circle cx="10.5" cy="10.5" r="6.5" />
            <path d="m15.5 15.5 5 5" />
          </svg>
          <input
            id="lists-search"
            v-model="query"
            type="search"
            :aria-label="t('lists.search')"
            :placeholder="t('lists.searchPlaceholder')"
            autocomplete="off"
            enterkeyhint="search"
            spellcheck="false"
          >
          <p class="visually-hidden" role="status">{{ searching ? t('lists.found', found) : '' }}</p>
        </div>

        <div class="lists-body">
          <!-- The bar acts on the tab in view; it sticks under the header while the lists scroll. -->
          <div v-if="editing" ref="editBar" class="joint-bar" role="group" :aria-label="t('lists.editLabel')">
            <p ref="editCount" class="joint-bar-count" role="status" tabindex="-1">
              {{ t(shown === 'mine' ? 'lists.pickedMine' : 'lists.pickedVisited', { n: chosen.length }, chosen.length) }}
            </p>
            <art-button size="s">
              <button type="button" @click="stopEditing">{{ t('listEdit.done') }}</button>
            </art-button>
            <div class="joint-bar-actions">
              <art-button variant="secondary" size="s">
                <button type="button" :aria-disabled="!chosen.length || edit.busy.value || undefined" @click="removeChosen">
                  {{ shown === 'mine' ? t('listEdit.delete') : t('lists.remove') }}
                </button>
              </art-button>
            </div>
            <p v-if="edit.error.value" class="form-message" role="alert">{{ edit.error.value }}</p>
          </div>

          <!-- Left and Right move between the tabs, so only the chosen one is a Tab stop. -->
          <div v-if="loggedIn" class="tabs" role="tablist" :aria-label="t('lists.title')" @keydown="onTabKey">
            <button
              v-for="item in tabs"
              :id="`tab-${item.id}`"
              :key="item.id"
              ref="tabButton"
              type="button"
              role="tab"
              :aria-selected="item.id === tab"
              :tabindex="item.id === tab ? 0 : -1"
              @click="show(item.id)"
            >
              {{ item.label }} ({{ item.count }})
            </button>
          </div>

          <div v-if="loggedIn" id="panel-mine" ref="minePanel" role="tabpanel" aria-labelledby="tab-mine" :hidden="tab !== 'mine'" @beforematch="show('mine')">
            <div class="lists-panel">
              <p v-if="loadError" class="form-message">{{ loadError }}</p>
              <p v-else-if="!mine.length" class="lists-none">{{ searching ? t('lists.mineNone', { query: query.trim() }) : t('lists.mineEmpty') }}</p>
              <ul v-if="mine.length || !editing" class="rows">
                <OwnedListRow
                  v-for="list in mine"
                  :key="list.token"
                  :list="list"
                  :picking="editing"
                  :picked="selected.has(list.token)"
                  @pick="on => edit.toggle(list.token, on)"
                />
                <li v-if="!editing">
                  <QuickAdd :label="t('lists.newList')" :field-label="t('lists.newListName')" :pending="creating" :error="createError" @add="createList" />
                </li>
              </ul>
            </div>
          </div>

          <!-- Logged out there are no tabs: the visited lists stand under a heading of their
               own. A panel without anything to focus in it is a Tab stop itself, so a keyboard
               reaches what it says. -->
          <h2 v-if="!loggedIn" id="visited-title" ref="visitedTitle" class="section-title" tabindex="-1">{{ t('lists.visited') }}</h2>
          <div
            ref="visitedPanel"
            v-bind="loggedIn ? { 'id': 'panel-visited', 'role': 'tabpanel', 'aria-labelledby': 'tab-visited' } : {}"
            :hidden="loggedIn && tab !== 'visited'"
            :tabindex="loggedIn && tab === 'visited' && !visited.length ? 0 : undefined"
            @beforematch="show('visited')"
          >
            <div class="lists-panel">
              <p v-if="removeError" class="form-message" role="alert">{{ removeError }}</p>
              <ul v-if="visited.length" class="rows">
                <VisitedListRow
                  v-for="list in visited"
                  :key="list.token"
                  :list="list"
                  :picking="editing"
                  :picked="selected.has(list.token)"
                  @forget="forget"
                  @pick="on => edit.toggle(list.token, on)"
                />
              </ul>
              <p v-else-if="loadError" class="form-message">{{ loadError }}</p>
              <p v-else-if="searching" class="lists-none">{{ t('lists.visitedNone', { query: query.trim() }) }}</p>
              <div v-else class="empty">
                <art-splatter pigment="complement" seed="none-visited" />
                <p>{{ t('lists.visitedEmpty') }}</p>
              </div>
              <p v-if="!loggedIn" class="lists-login">
                <NuxtLink :to="{ path: localePath('/login'), query: { next: localePath('/lists') } }">{{ t('lists.login') }}</NuxtLink>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>

    <dialog v-if="loggedIn" ref="deleteDialog" class="dialog" aria-labelledby="lists-delete-title" aria-describedby="lists-delete-text" @close="onDeleteClose">
      <h2 id="lists-delete-title">{{ deleteWords.title }}</h2>
      <p id="lists-delete-text">{{ deleteWords.body }}</p>
      <ul v-if="chosenMine.length > 1" class="dialog-lists">
        <li v-for="list in chosenMine" :key="list.token">
          {{ list.title }}<span v-if="list.sharedWith.length" class="row-meta"> · {{ t('wish.with', { names: names(list.sharedWith) }) }}</span>
        </li>
      </ul>
      <KeptForBuyers v-if="deletesSome" v-model="clearForBuyers" several />
      <form method="dialog" class="actions">
        <art-button variant="secondary">
          <button value="cancel" autofocus>{{ t('list.deleteCancel') }}</button>
        </art-button>
        <art-button :class="{ danger: deleteWords.danger }">
          <button value="delete">{{ deleteWords.confirm }}</button>
        </art-button>
      </form>
    </dialog>
  </div>
</template>
