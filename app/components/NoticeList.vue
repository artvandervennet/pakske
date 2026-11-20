<script setup lang="ts">
import type { RequestsView } from '#shared/schemas/friends'
import type { NoticeView } from '#shared/schemas/list'

// The rows behind the bell: friend requests that wait for an answer, then the notices, newest
// first. A row is the sender's picture, the sentence, and when it happened. Only a real choice
// is a button: yes or no to a friend request, "Bekijken" on something a friend sent (which
// leads to where the answer is given), and undoing what can be undone. Where a notice only
// points somewhere, its sentence is the link. A small cross wipes it.
// What a press does is the panel's business (NoticesHost.vue); this only draws the rows.
type FriendRequest = RequestsView['incoming'][number]

defineProps<{ notices: NoticeView[], requests: FriendRequest[], busy: string | null }>()
defineEmits<{ accept: [request: FriendRequest], decline: [request: FriendRequest], undo: [notice: NoticeView], dismiss: [notice: NoticeView] }>()

const { t, locale } = useI18n()
const localePath = useLocalePath()

// One "now" for the whole list, so two rows from the same minute say the same.
const now = new Date()
const when = (iso: string) => ago(new Date(iso), now, locale.value)

/** Where a notice points: a list of the recipient's, at the wish it is about, a friend's row, or a Secret Santa group. */
function destination(notice: NoticeView) {
  if (notice.santa) return localePath(`/s/${notice.santa}`)
  if (notice.token) return localePath(`/l/${notice.token}${notice.wishId === null ? '' : `#wish-${notice.wishId}`}`)
  if (notice.kind === 'friend_accepted' || notice.kind === 'friend_link_used') return { path: localePath('/friends'), hash: `#friend-${notice.actorId}` }
  return null
}
</script>

<template>
  <ul class="notice-list">
    <li v-for="request in requests" :key="request.id" class="notice-item" :class="{ fresh: request.fresh }">
      <PersonPicture :person="{ id: request.fromId, picture: null }" />
      <div class="notice-main">
        <p :id="`request-${request.id}`" class="notice-text">{{ t('friends.wants', { name: request.from }) }}</p>
        <p class="notice-meta"><template v-if="request.via">{{ t('friends.via', { title: request.via }) }} · </template>{{ when(request.createdAt) }}</p>
        <div class="notice-acts">
          <art-button size="s">
            <button type="button" :aria-describedby="`request-${request.id}`" :aria-disabled="busy ? 'true' : undefined" @click="$emit('accept', request)">{{ t('friends.accept') }}</button>
          </art-button>
          <art-button size="s" variant="secondary">
            <button type="button" :aria-describedby="`request-${request.id}`" :aria-disabled="busy ? 'true' : undefined" @click="$emit('decline', request)">{{ t('friends.decline') }}</button>
          </art-button>
        </div>
      </div>
    </li>
    <li v-for="notice in notices" :key="notice.id" class="notice-item" :class="{ fresh: notice.fresh }">
      <PersonPicture :person="{ id: notice.actorId, picture: notice.picture }" />
      <div class="notice-main">
        <p :id="`notice-${notice.id}`" class="notice-text">
          <NuxtLink v-if="!notice.invite && destination(notice)" class="notice-link" :to="destination(notice)!">{{ noticeLine(notice, t) }}</NuxtLink>
          <template v-else>{{ noticeLine(notice, t) }}</template>
        </p>
        <p class="notice-meta">{{ when(notice.createdAt) }}</p>
        <div v-if="notice.invite || notice.canUndo" class="notice-acts">
          <!-- Something a friend sent: on to the page where the answer is given. -->
          <art-button v-if="notice.invite" size="s">
            <NuxtLink :to="localePath(`/j/${notice.invite}`)" :aria-describedby="`notice-${notice.id}`">{{ t('notice.view') }}</NuxtLink>
          </art-button>
          <art-button v-if="notice.canUndo" size="s" variant="secondary">
            <button type="button" :aria-describedby="`notice-${notice.id}`" :aria-disabled="busy ? 'true' : undefined" @click="$emit('undo', notice)">{{ t('notice.undo') }}</button>
          </art-button>
        </div>
      </div>
      <button type="button" class="icon-button notice-close" :aria-label="t('notice.dismiss')" :aria-describedby="`notice-${notice.id}`" :aria-disabled="busy ? 'true' : undefined" @click="$emit('dismiss', notice)">
        <AppIcon name="close" />
      </button>
    </li>
  </ul>
</template>
