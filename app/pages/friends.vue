<script setup lang="ts">
import type { FriendsView, RequestsView } from '#shared/schemas/friends'

// The person's friends: who asked, whom they asked, and for each friend which lists go each
// way. There is no search for people here, on purpose: someone becomes a friend through the
// link this page makes, or by being asked from a list of theirs. Nobody else's friends are on
// this page, and nothing done on it tells a friend anything except being accepted.
definePageMeta({ middleware: 'auth' })

const { t } = useI18n()
const localePath = useLocalePath()
const route = useRoute()
const { parse } = useApiError()

useHead({ title: () => t('friends.title') })

const { data, error, refresh } = await useFetch<FriendsView>('/api/friends')
const friends = computed(() => data.value?.friends ?? [])
const incoming = computed(() => data.value?.requests.incoming ?? [])
const outgoing = computed(() => data.value?.requests.outgoing ?? [])
// Without it a failed load would look like having no friends at all.
const loadError = computed(() => (error.value ? parse(error.value).message : ''))

// Opening this page counts as having seen the requests, which takes the header's mark away.
const { markRequestsSeen } = useNotices()

const rows = new Map<number, { show: () => void }>()
function rowRef(id: number, row: unknown) {
  if (row) rows.set(id, row as { show: () => void })
  else rows.delete(id)
}
/** Unfolds a friend's row with the focus on it; the address names it, so a reload does the same. */
async function showFriend(id: number) {
  await nextTick()
  rows.get(id)?.show()
}
onMounted(() => {
  markRequestsSeen().catch(() => {})
  const named = /^#friend-(\d+)$/.exec(route.hash)
  if (named) showFriend(Number(named[1]))
})

// "Vriend toevoegen": a link to send to one person. It shows under the band's button, with the
// focus on its address.
const link = ref<string | null>(null)
const linkBox = useTemplateRef<{ focus: () => void }>('linkBox')
const making = ref(false)
const bandError = ref('')

async function addFriend() {
  if (making.value) return
  making.value = true
  bandError.value = ''
  try {
    const made = await $fetch<{ token: string }>('/api/friends/links', { method: 'POST' })
    link.value = localePath(`/f/${made.token}`)
    await nextTick()
    linkBox.value?.focus()
  }
  catch (failure) {
    bandError.value = parse(failure).message
  }
  finally {
    making.value = false
  }
}

// Answering and withdrawing take a row away, and the button in it with the focus. What happened
// is said in a line that is always there, and the focus goes to the heading above the friends.
const friendsTitle = useTemplateRef<HTMLElement>('friendsTitle')
const status = ref('')
const actionError = ref('')
const busy = ref<string | null>(null)

async function settle(key: string, request: () => Promise<unknown>, done: string) {
  if (busy.value) return
  busy.value = key
  status.value = ''
  actionError.value = ''
  try {
    await request()
    status.value = done
  }
  catch (failure) {
    actionError.value = parse(failure).message
  }
  finally {
    await refresh()
    busy.value = null
  }
  await nextTick()
  if (!document.activeElement || document.activeElement === document.body) friendsTitle.value?.focus()
}

type Incoming = RequestsView['incoming'][number]
type Outgoing = RequestsView['outgoing'][number]

async function accept(request: Incoming) {
  let friendId: number | undefined
  await settle(request.id, async () => {
    friendId = (await $fetch<{ friendId: number }>(`/api/friends/requests/${request.id}/accept`, { method: 'POST' })).friendId
  }, '')
  // Nothing is ticked for a new friend: their row opens, where that is chosen.
  if (friendId !== undefined) showFriend(friendId)
}

const decline = (request: Incoming) =>
  settle(request.id, () => $fetch<unknown>(`/api/friends/requests/${request.id}/decline`, { method: 'POST' }), t('friends.declined', { name: request.from }))

const withdraw = (request: Outgoing) =>
  settle(request.id, () => $fetch<unknown>(`/api/friends/requests/${request.id}`, { method: 'DELETE' }), t('friends.withdrawn'))

async function onRemoved(name: string) {
  status.value = t('friends.removed', { name })
  await refresh()
  await nextTick()
  friendsTitle.value?.focus()
}
</script>

<template>
  <div>
    <PageHead :title="t('friends.title')" :lead="t('friends.lead')">
      <template #actions>
        <art-button variant="secondary">
          <button type="button" :aria-disabled="making || undefined" @click="addFriend">{{ t('friends.add') }}</button>
        </art-button>
        <OneTimeLink v-if="link" ref="linkBox" :path="link" :text="t('friends.linkText')" />
        <p v-if="bandError" class="form-message" role="alert">{{ bandError }}</p>
      </template>
    </PageHead>

    <section v-if="incoming.length || outgoing.length" class="band section" data-paint="1" aria-labelledby="requests-title">
      <div class="inner">
        <div class="section-head">
          <h2 id="requests-title" class="section-title">{{ t('friends.requests') }}</h2>
        </div>
        <div class="section-body">
          <ul v-if="incoming.length" class="rows friends-requests">
            <li v-for="request in incoming" :key="request.id" class="row notice">
              <p :id="`request-${request.id}`" class="notice-line">
                {{ t('friends.wants', { name: request.from }) }}<template v-if="request.via"> · {{ t('friends.via', { title: request.via }) }}</template>
              </p>
              <div class="notice-actions">
                <art-button size="s">
                  <button type="button" :aria-describedby="`request-${request.id}`" :aria-disabled="busy ? 'true' : undefined" @click="accept(request)">{{ t('friends.accept') }}</button>
                </art-button>
                <art-button variant="quiet" size="s">
                  <button type="button" :aria-describedby="`request-${request.id}`" :aria-disabled="busy ? 'true' : undefined" @click="decline(request)">{{ t('friends.decline') }}</button>
                </art-button>
              </div>
            </li>
          </ul>
          <template v-if="outgoing.length">
            <h3 id="sent-title" class="wish-label friends-sent-title">{{ t('friends.sent') }}</h3>
            <ul class="rows friends-sent" aria-labelledby="sent-title">
              <li v-for="request in outgoing" :key="request.id" class="row">
                <div :id="`sent-${request.id}`" class="row-text">
                  <span class="row-title">{{ request.to }}</span>
                  <span class="row-meta">{{ t('friends.waiting') }}</span>
                </div>
                <art-button variant="quiet" size="s">
                  <button type="button" :aria-describedby="`sent-${request.id}`" :aria-disabled="busy ? 'true' : undefined" @click="withdraw(request)">{{ t('friends.withdraw') }}</button>
                </art-button>
              </li>
            </ul>
          </template>
        </div>
      </div>
    </section>

    <section class="band section" :data-paint="incoming.length || outgoing.length ? 2 : 1" aria-labelledby="friends-title">
      <div class="inner">
        <div class="section-head">
          <h2 id="friends-title" ref="friendsTitle" class="section-title" tabindex="-1">{{ t('friends.yours') }}</h2>
        </div>
        <div class="section-body">
          <!-- Always there, so the words are announced when they appear. -->
          <p class="form-message" role="status">{{ status }}</p>
          <p v-if="actionError" class="form-message" role="alert">{{ actionError }}</p>
          <p v-if="loadError" class="form-message">{{ loadError }}</p>
          <ul v-if="friends.length" class="rows friends-list">
            <FriendRow v-for="friend in friends" :key="friend.id" :ref="row => rowRef(friend.id, row)" :friend="friend" @changed="refresh" @removed="onRemoved" />
          </ul>
          <p v-else-if="!loadError" class="muted friends-none">{{ t('friends.none') }}</p>
        </div>
      </div>
    </section>
  </div>
</template>
