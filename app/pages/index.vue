<script setup lang="ts">
import type { HomeView, NoticeView } from '#shared/schemas/list'

const { t } = useI18n()
const localePath = useLocalePath()
const { loggedIn } = useUserSession()
const { parse } = useApiError()

useHead({ title: () => t('home.title') })

// The few lists of each kind the person had to do with last, and how many there are in all.
// The lists page has every one of them.
const { data: home, error: homeError, refresh } = await useFetch<HomeView>('/api/home')
const owned = computed(() => home.value?.owned ?? [])
const opened = computed(() => home.value?.opened ?? [])
const notices = computed(() => home.value?.notices ?? [])
const ownedTotal = computed(() => home.value?.ownedTotal ?? 0)
const openedTotal = computed(() => home.value?.openedTotal ?? 0)
// Without it a failed load would look like having no lists at all.
const loadError = computed(() => (homeError.value ? parse(homeError.value).message : ''))

const { creating, createError, createList } = useNewList()

const openedTitle = ref<HTMLElement>()
const pageTitle = ref<HTMLElement>()
// After "Weghalen" the focus goes to the section's heading. Logged out, the last list takes the
// whole section along; then it goes to the page's heading.
const { removeError, forget } = useForgetList(refresh, () => openedTitle.value ?? pageTitle.value)

// Notices. Opening this page counts as having seen them, which takes the header's mark away.
const { markSeen } = useNotices()
onMounted(() => {
  // If it fails, the mark stays until the next visit; nothing on this page depends on it.
  if (loggedIn.value) markSeen().catch(() => {})
})

const noticesTitle = ref<HTMLElement>()
const noticeBusy = ref<string | null>(null)
const noticeStatus = ref('')
const noticeError = ref('')

// Undo and dismiss each take the notice away, the row and its focused button with it. A notice
// someone already dealt with elsewhere (another tab, another owner's undo) answers 404; the
// page then catches up and says so. Either way the focus goes to the section's heading, which
// stays while there is something to say, even when the last notice has gone.
async function settleNotice(notice: NoticeView, request: () => Promise<unknown>, done: string) {
  if (noticeBusy.value) return
  noticeBusy.value = notice.id
  noticeStatus.value = ''
  noticeError.value = ''
  try {
    await request()
    noticeStatus.value = done
  }
  catch (error) {
    const parsed = parse(error)
    noticeError.value = parsed.message
    if (parsed.code !== 'not_found') return
  }
  finally {
    noticeBusy.value = null
  }
  await refresh()
  await nextTick()
  if (!document.activeElement || document.activeElement === document.body) noticesTitle.value?.focus()
}

function undo(notice: NoticeView) {
  return settleNotice(
    notice,
    () => $fetch<unknown>(`/api/lists/${notice.token}/wishes/${notice.wishId}/owners/${notice.actorId}/undo`, { method: 'POST' }),
    t('notice.undone'),
  )
}

function dismiss(notice: NoticeView) {
  return settleNotice(notice, () => $fetch<unknown>(`/api/notices/${notice.id}`, { method: 'DELETE' }), t('notice.dismissed'))
}

const noticeLink = (notice: NoticeView) =>
  localePath(`/l/${notice.token}${notice.wishId === null ? '' : `#wish-${notice.wishId}`}`)

const showNotices = computed(() => loggedIn.value && (notices.value.length > 0 || !!noticeStatus.value || !!noticeError.value))

// Logged out, the page is the hero and the lists opened before; with none, one quiet sentence.
const showOpened = computed(() => loggedIn.value || opened.value.length > 0 || !!loadError.value)

// Gesso paints a page's sections 1, 2, 3 in order, whichever of them are there.
const paints = computed(() => {
  let paint = 0
  return { notices: showNotices.value ? ++paint : 0, yours: loggedIn.value ? ++paint : 0, opened: ++paint }
})
</script>

<template>
  <div>
    <div class="band hero" data-paint="deep">
      <div class="inner">
        <!-- The site's name, and the wordmark: <art-header> flies it up into its place as you scroll.
             Under it a brushstroke in the yellow of the signature in the footer (Gesso's
             <art-stroke>), painted once when the page opens. It is part of the title, so it flies
             up with it. No white space inside the element: it would show beside the name. -->
        <h1 ref="pageTitle" tabindex="-1" data-wordmark><art-stroke pigment="stroke" seed="pakske" animate>{{ t('site.name') }}</art-stroke></h1>
        <p class="lead">{{ t('home.lead') }}</p>
        <div v-if="!loggedIn" class="actions">
          <art-button>
            <NuxtLink :to="localePath('/register')">{{ t('auth.register') }}</NuxtLink>
          </art-button>
          <art-button variant="secondary">
            <NuxtLink :to="localePath('/login')">{{ t('nav.login') }}</NuxtLink>
          </art-button>
        </div>
      </div>
      <art-drip class="band-drip" pigment="--surface" stagger flush />
    </div>

    <!-- First under the hero: the mark in the header sends people here for these. -->
    <section v-if="showNotices" class="band section" :data-paint="paints.notices" aria-labelledby="notices-title">
      <div class="inner">
        <div class="section-head">
          <h2 id="notices-title" ref="noticesTitle" class="section-title" tabindex="-1">{{ t('home.notices') }}</h2>
        </div>
        <div class="section-body">
          <p class="form-message" role="status">{{ noticeStatus }}</p>
          <p v-if="noticeError" class="form-message" role="alert">{{ noticeError }}</p>
          <ul v-if="notices.length" class="rows">
            <li v-for="notice in notices" :key="notice.id" class="row notice">
              <p :id="`notice-${notice.id}`" class="notice-line">{{ noticeLine(notice, t) }}</p>
              <div class="notice-actions">
                <art-button v-if="notice.token" variant="quiet" size="s">
                  <NuxtLink :to="noticeLink(notice)" :aria-describedby="`notice-${notice.id}`">{{ t('notice.view') }}</NuxtLink>
                </art-button>
                <art-button v-if="notice.canUndo" variant="quiet" size="s">
                  <button type="button" :aria-describedby="`notice-${notice.id}`" :aria-disabled="noticeBusy ? 'true' : undefined" @click="undo(notice)">{{ t('notice.undo') }}</button>
                </art-button>
                <art-button variant="quiet" size="s">
                  <button type="button" :aria-describedby="`notice-${notice.id}`" :aria-disabled="noticeBusy ? 'true' : undefined" @click="dismiss(notice)">{{ t('notice.dismiss') }}</button>
                </art-button>
              </div>
            </li>
          </ul>
        </div>
      </div>
    </section>

    <section v-if="loggedIn" class="band section" :data-paint="paints.yours" aria-labelledby="yours-title">
      <div class="inner">
        <div class="section-head">
          <h2 id="yours-title" class="section-title">{{ t('home.yourLists') }}</h2>
        </div>
        <div class="section-body">
          <p v-if="loadError" class="form-message">{{ loadError }}</p>
          <ul class="rows">
            <OwnedListRow v-for="list in owned" :key="list.token" :list="list" />
            <li>
              <QuickAdd :label="t('lists.newList')" :field-label="t('lists.newListName')" :pending="creating" :error="createError" @add="createList" />
            </li>
          </ul>
          <!-- Both sections end in a link with these words; each one's heading is its
               description, so a screen reader says which lists it leads to. -->
          <p v-if="ownedTotal > owned.length" class="lists-all">
            <NuxtLink :to="localePath('/lists')" aria-describedby="yours-title">{{ t('home.allLists', { n: ownedTotal }) }}</NuxtLink>
          </p>
        </div>
      </div>
    </section>

    <section v-if="showOpened" class="band section" :data-paint="paints.opened" aria-labelledby="opened-title">
      <div class="inner">
        <div class="section-head">
          <h2 id="opened-title" ref="openedTitle" class="section-title" tabindex="-1">{{ t('home.visited') }}</h2>
          <p class="intro">{{ t('lists.visitedIntro') }}</p>
        </div>
        <div class="section-body">
          <p v-if="removeError" class="form-message" role="alert">{{ removeError }}</p>
          <template v-if="opened.length">
            <ul class="rows">
              <VisitedListRow v-for="list in opened" :key="list.token" :list="list" @forget="forget" />
            </ul>
            <p v-if="openedTotal > opened.length" class="lists-all">
              <NuxtLink :to="{ path: localePath('/lists'), query: { tab: 'visited' } }" aria-describedby="opened-title">{{ t('home.allLists', { n: openedTotal }) }}</NuxtLink>
            </p>
          </template>
          <p v-else-if="loadError" class="form-message">{{ loadError }}</p>
          <div v-else class="empty">
            <art-splatter pigment="complement" seed="none-opened" />
            <p>{{ t('lists.visitedEmpty') }}</p>
          </div>
        </div>
      </div>
    </section>
    <!-- One column, not Gesso's .section: that one keeps its first column for a title. -->
    <div v-else class="band wide" data-paint="1">
      <div class="inner">
        <div class="empty">
          <art-splatter pigment="complement" seed="none-opened" />
          <p>{{ t('lists.visitedEmpty') }}</p>
        </div>
      </div>
    </div>

  </div>
</template>
