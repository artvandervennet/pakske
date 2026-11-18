<script setup lang="ts">
import type { ListsView } from '#shared/schemas/list'

// Every list of your own and every list of someone else's that you opened, with one search over
// both. Logged in they are two tabs; logged out there are only the lists this browser opened.

const { t } = useI18n()
const localePath = useLocalePath()
const route = useRoute()
const router = useRouter()
const { loggedIn } = useUserSession()
const { parse } = useApiError()

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
</script>

<template>
  <div>
    <PageHead :title="t('lists.title')" drip />

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
              <ul class="rows">
                <OwnedListRow v-for="list in mine" :key="list.token" :list="list" />
                <li>
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
              <p class="lists-note">{{ t('lists.visitedIntro') }}</p>
              <p v-if="removeError" class="form-message" role="alert">{{ removeError }}</p>
              <ul v-if="visited.length" class="rows">
                <VisitedListRow v-for="list in visited" :key="list.token" :list="list" @forget="forget" />
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
  </div>
</template>
