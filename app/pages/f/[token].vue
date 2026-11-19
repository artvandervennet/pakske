<script setup lang="ts">
import type { FriendLinkView } from '#shared/schemas/friends'

// The page behind a friend link. Whoever made the link already said yes by making it, so one
// button here is the whole answer; afterwards the person is on their friends page, at the new
// friend's row, where nothing is ticked yet. A link that is used, expired or made up says so and
// nothing else. It needs a login: a friendship is between two accounts.
definePageMeta({ middleware: 'auth' })

const route = useRoute()
const { t } = useI18n()
const localePath = useLocalePath()

const token = String(route.params.token)
// A token that matches no link answers 404; the page then has nothing, which reads as "closed".
const { data: link } = await useFetch<FriendLinkView>(`/api/friends/links/${encodeURIComponent(token)}`)
const state = computed(() => link.value?.state ?? 'closed')
const from = computed(() => link.value?.from ?? '')

const title = computed(() => ({
  open: t('friends.linkTitle', { name: from.value }),
  own: t('friends.linkOwnTitle'),
  friends: t('friends.linkFriendsTitle'),
  closed: t('friends.linkGoneTitle'),
})[state.value])
const lead = computed(() => (state.value === 'open' ? t('friends.linkLead') : null))

useHead({ title })

const { form, pending, message, run } = useForm(async () => {
  const made = await $fetch<{ friendId: number }>(`/api/friends/links/${encodeURIComponent(token)}/accept`, { method: 'POST' })
  await navigateTo({ path: localePath('/friends'), hash: `#friend-${made.friendId}` })
})
</script>

<template>
  <div>
    <PageHead :title="title" :lead="lead" />
    <section class="band wide" data-paint="1">
      <div class="inner">
        <form v-if="state === 'open'" ref="form" class="form" method="post" novalidate @submit.prevent="run">
          <p v-if="message" class="form-message" role="alert">{{ message }}</p>
          <div class="actions">
            <art-button>
              <button type="submit" :disabled="pending">{{ pending ? t('auth.busy') : t('friends.linkAccept') }}</button>
            </art-button>
          </div>
        </form>
        <div v-else class="form">
          <OneTimeLink v-if="state === 'own'" :path="route.path" :text="t('friends.linkOwn')" />
          <p v-else-if="state === 'friends'">{{ t('friends.linkFriends', { name: from }) }}</p>
          <p v-else class="form-message">{{ t('friends.linkGone') }}</p>
          <p><NuxtLink :to="localePath('/friends')">{{ t('friends.toFriends') }}</NuxtLink></p>
        </div>
      </div>
    </section>
  </div>
</template>
