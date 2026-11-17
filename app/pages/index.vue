<script setup lang="ts">
import type { HomeView, NoticeView, OpenedList } from '#shared/schemas/list'

const { t } = useI18n()
const localePath = useLocalePath()
const { loggedIn } = useUserSession()
const { parse } = useApiError()

useHead({ title: () => t('home.title') })

const { data: home, error: homeError, refresh } = await useFetch<HomeView>('/api/home')
const owned = computed(() => home.value?.owned ?? [])
const opened = computed(() => home.value?.opened ?? [])
const notices = computed(() => home.value?.notices ?? [])
// Without it a failed load would look like having no lists at all.
const loadError = computed(() => (homeError.value ? parse(homeError.value).message : ''))

const creating = ref(false)
const createError = ref('')

async function createList(title: string) {
  creating.value = true
  createError.value = ''
  try {
    const list = await $fetch<{ token: string }>('/api/lists', { method: 'POST', body: { title } })
    await navigateTo(localePath(`/l/${list.token}`))
  }
  catch (error) {
    const parsed = parse(error)
    createError.value = parsed.fields.title ?? parsed.message
  }
  finally {
    creating.value = false
  }
}

const removing = ref<string | null>(null)
const removeError = ref('')
const openedTitle = ref<HTMLElement>()
const pageTitle = ref<HTMLElement>()

async function forget(token: string) {
  if (removing.value) return
  removing.value = token
  removeError.value = ''
  try {
    await $fetch(`/api/home/opened/${token}`, { method: 'DELETE' })
    await refresh()
    // The button that had the focus is gone with its row. Logged out, the last one takes the
    // whole section along; then the focus goes to the page's heading.
    await nextTick()
    const heading = openedTitle.value ?? pageTitle.value
    heading?.focus()
  }
  catch (error) {
    removeError.value = parse(error).message
  }
  finally {
    removing.value = null
  }
}

// A deleted list still opens for someone logged in, who may have bought something on it.
// For a visitor who isn't, the link would only lead to "not found".
const canOpen = (list: OpenedList) => !list.deleted || loggedIn.value

const ownerNames = useNames()

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
</script>

<template>
  <div>
    <div class="band hero" data-paint="deep">
      <div class="inner">
        <h1 ref="pageTitle" tabindex="-1">{{ t('home.title') }}</h1>
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

    <section v-if="loggedIn" class="band section" data-paint="1" aria-labelledby="yours-title">
      <div class="inner">
        <div class="section-head">
          <h2 id="yours-title" class="section-title">{{ t('home.yourLists') }}</h2>
        </div>
        <div class="section-body">
          <p v-if="loadError" class="form-message">{{ loadError }}</p>
          <ul class="rows">
            <li v-for="list in owned" :key="list.token" class="row">
              <NuxtLink class="row-title" :to="localePath(`/l/${list.token}`)">{{ list.title }}</NuxtLink>
              <span class="row-meta">{{ t('home.wishes', list.wishes) }}<template v-if="list.sharedWith.length"> · {{ t('wish.with', { names: ownerNames(list.sharedWith) }) }}</template></span>
            </li>
            <li>
              <QuickAdd :label="t('home.newList')" :field-label="t('home.newListName')" :pending="creating" :error="createError" @add="createList" />
            </li>
          </ul>
        </div>
      </div>
    </section>

    <section v-if="showOpened" class="band section" :data-paint="loggedIn ? 2 : 1" aria-labelledby="opened-title">
      <div class="inner">
        <div class="section-head">
          <h2 id="opened-title" ref="openedTitle" class="section-title" tabindex="-1">{{ t('home.opened') }}</h2>
          <p class="intro">{{ t('home.openedIntro') }}</p>
        </div>
        <div class="section-body">
          <p v-if="removeError" class="form-message" role="alert">{{ removeError }}</p>
          <ul v-if="opened.length" class="rows">
            <li v-for="list in opened" :key="list.token" class="row">
              <div class="row-text">
                <NuxtLink v-if="canOpen(list)" :id="`opened-${list.token}`" class="row-title" :to="localePath(`/l/${list.token}`)">{{ list.title }}</NuxtLink>
                <span v-else :id="`opened-${list.token}`" class="row-title">{{ list.title }}</span>
                <span v-if="list.owners.length" class="row-meta">{{ t('list.owners', { names: ownerNames(list.owners) }) }}</span>
              </div>
              <art-tape v-if="list.deleted" :seed="list.token">{{ t('home.deleted') }}</art-tape>
              <art-button variant="quiet" size="s">
                <button type="button" :aria-describedby="`opened-${list.token}`" @click="forget(list.token)">{{ t('home.remove') }}</button>
              </art-button>
            </li>
          </ul>
          <p v-else-if="loadError" class="form-message">{{ loadError }}</p>
          <div v-else class="empty">
            <art-splatter pigment="complement" seed="none-opened" />
            <p>{{ t('home.openedEmpty') }}</p>
          </div>
        </div>
      </div>
    </section>
    <div v-else class="band section" data-paint="1">
      <div class="inner">
        <p class="muted">{{ t('home.openedEmpty') }}</p>
      </div>
    </div>

    <section v-if="showNotices" class="band section" data-paint="1" aria-labelledby="notices-title">
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
  </div>
</template>
