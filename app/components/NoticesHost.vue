<script setup lang="ts">
import type { RequestsView } from '#shared/schemas/friends'
import type { NoticeView } from '#shared/schemas/list'

// What the bell in the header opens: the notices and the friend requests that wait. On a wide
// screen it is a panel that hangs under the bell and leaves the page as it is; on a narrow one
// the same rows come up as a sheet against the bottom edge, like "Delen". They are asked for
// when it opens, and opening counts as having seen them, which takes the bell's dot away.
// It lives beside <art-header>, not in it: what sits in the header's light DOM and isn't a link
// or an action goes into the list that folds away under "Menu".
type FriendRequest = RequestsView['incoming'][number]

const { t } = useI18n()
const localePath = useLocalePath()
const { parse } = useApiError()
const { markSeen } = useNotices()
const route = useRoute()

const sheet = useTemplateRef<HTMLDialogElement>('sheet')
const menu = useTemplateRef<HTMLElement>('menu')
const sheetTitle = useTemplateRef<HTMLElement>('sheetTitle')
const menuTitle = useTemplateRef<HTMLElement>('menuTitle')
// Which of the two is open, so the rows are in the page once.
const shown = ref<'menu' | 'sheet' | null>(null)
let bell: HTMLElement | null = null

const notices = ref<NoticeView[]>([])
const requests = ref<FriendRequest[]>([])
const loaded = ref(false)
const busy = ref<string | null>(null)
const status = ref('')
const error = ref('')
const empty = computed(() => loaded.value && !notices.value.length && !requests.value.length)

async function load() {
  try {
    const answer = await $fetch<{ notices: NoticeView[], requests: FriendRequest[] }>('/api/notices')
    notices.value = answer.notices
    requests.value = answer.requests
    loaded.value = true
  }
  catch (failure) {
    error.value = parse(failure).message
  }
}

const heading = () => (shown.value === 'sheet' ? sheetTitle.value : menuTitle.value)

/** The bell: opens what fits the screen, or closes it again. */
async function toggle(from: HTMLElement) {
  bell = from
  if (shown.value) return close()
  status.value = ''
  error.value = ''
  if (matchMedia('(max-width: 40rem)').matches) {
    shown.value = 'sheet'
    sheet.value?.showModal()
  }
  else {
    shown.value = 'menu'
    menu.value?.showPopover()
  }
  // The heading rather than the first button: a screen reader starts with what this is.
  await nextTick()
  heading()?.focus()
  await load()
  // After the rows are in hand, so the ones that were new still show as new this once.
  // If it fails the dot stays until the next time; nothing here depends on it.
  markSeen().catch(() => {})
}

function close() {
  if (shown.value === 'sheet') sheet.value?.close()
  else if (shown.value === 'menu') menu.value?.hidePopover()
}

/** Closed, however that happened: Escape, a click beside it, the cross, a link that was followed. */
function onClosed() {
  if (!shown.value) return
  shown.value = null
  // Back to the bell, unless the person already moved on to something else on the page.
  if (!document.activeElement || document.activeElement === document.body) bell?.focus()
}
function onMenuToggle(event: Event) {
  if ((event as ToggleEvent).newState === 'closed') onClosed()
}

// A notice that was followed took the person somewhere: the panel doesn't stay over that page.
watch(() => route.fullPath, close)

// Every action takes its row away, and the button that was pressed with it. A notice someone
// already dealt with elsewhere answers 404; the list then catches up and says so. The focus
// goes to the heading, which is always there.
async function settle(id: string, request: () => Promise<unknown>, done: string) {
  if (busy.value) return
  busy.value = id
  status.value = ''
  error.value = ''
  try {
    await request()
    status.value = done
  }
  catch (failure) {
    const parsed = parse(failure)
    error.value = parsed.message
    if (parsed.code !== 'not_found') return
  }
  finally {
    busy.value = null
  }
  await load()
  await nextTick()
  if (!document.activeElement || document.activeElement === document.body) heading()?.focus()
}

const undo = (notice: NoticeView) => settle(
  notice.id,
  () => $fetch<unknown>(`/api/lists/${notice.token}/wishes/${notice.wishId}/owners/${notice.actorId}/undo`, { method: 'POST' }),
  t('notice.undone'),
)
const dismiss = (notice: NoticeView) => settle(notice.id, () => $fetch<unknown>(`/api/notices/${notice.id}`, { method: 'DELETE' }), t('notice.dismissed'))
// Declining says so here and tells the sender nothing.
const decline = (request: FriendRequest) => settle(
  request.id,
  () => $fetch<unknown>(`/api/friends/requests/${request.id}/decline`, { method: 'POST' }),
  t('friends.declined', { name: request.from }),
)

/** Accepting goes on to the new friend's row on the friends page, where nothing is switched on yet. */
async function accept(request: FriendRequest) {
  if (busy.value) return
  busy.value = request.id
  error.value = ''
  try {
    const made = await $fetch<{ friendId: number }>(`/api/friends/requests/${request.id}/accept`, { method: 'POST' })
    close()
    await navigateTo({ path: localePath('/friends'), hash: `#friend-${made.friendId}` })
  }
  catch (failure) {
    error.value = parse(failure).message
    await load()
  }
  finally {
    busy.value = null
  }
}

defineExpose({ toggle, open: computed(() => shown.value !== null) })
</script>

<template>
  <dialog ref="sheet" class="dialog sheet notices-sheet" aria-labelledby="notices-sheet-title" @click="$event.target === sheet && sheet?.close()" @close="onClosed">
    <div v-if="shown === 'sheet'" class="sheet-body">
      <div class="sheet-head">
        <h2 id="notices-sheet-title" ref="sheetTitle" tabindex="-1">{{ t('nav.notices') }}</h2>
        <button type="button" class="icon-button" :aria-label="t('share.close')" @click="sheet?.close()"><AppIcon name="close" /></button>
      </div>
      <p v-if="error" class="form-message" role="alert">{{ error }}</p>
      <NoticeList :notices="notices" :requests="requests" :busy="busy" @accept="accept" @decline="decline" @undo="undo" @dismiss="dismiss" />
      <p v-if="empty" class="notice-none">{{ t('notice.none') }}</p>
      <p class="visually-hidden" role="status">{{ status }}</p>
    </div>
  </dialog>
  <div id="notices-menu" ref="menu" class="menu anchored end notices-menu" popover role="dialog" aria-labelledby="notices-menu-title" style="position-anchor: --bell" @toggle="onMenuToggle">
    <template v-if="shown === 'menu'">
      <h2 id="notices-menu-title" ref="menuTitle" class="notices-title" tabindex="-1">{{ t('nav.notices') }}</h2>
      <p v-if="error" class="form-message" role="alert">{{ error }}</p>
      <NoticeList :notices="notices" :requests="requests" :busy="busy" @accept="accept" @decline="decline" @undo="undo" @dismiss="dismiss" />
      <p v-if="empty" class="notice-none">{{ t('notice.none') }}</p>
      <p class="visually-hidden" role="status">{{ status }}</p>
    </template>
  </div>
</template>
