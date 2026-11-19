<script setup lang="ts">
import type { FriendLinkView } from '#shared/schemas/friends'

// The page behind a friend link. Whoever made the link already said yes by making it, so one
// button is the whole answer. It stands in the title band, where the question is; under the band
// the page says in three lines what being friends means here, so nobody has to say yes to
// something they can't picture. Afterwards the person is on their friends page, at the new
// friend's row, where nothing is switched on yet. A link that is used, expired or made up says
// so. It needs a login: a friendship is between two accounts.
definePageMeta({ middleware: 'auth' })

const route = useRoute()
const { t } = useI18n()
const localePath = useLocalePath()
const { parse } = useApiError()

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
const lead = computed(() => ({
  open: t('friends.linkLead'),
  // Its own sentence stands with the address, in the box that copies it.
  own: null,
  friends: t('friends.linkFriends', { name: from.value }),
  closed: t('friends.linkGone'),
})[state.value])

useHead({ title })

const busy = ref(false)
const message = ref('')

async function accept() {
  if (busy.value) return
  busy.value = true
  message.value = ''
  try {
    const made = await $fetch<{ friendId: number }>(`/api/friends/links/${encodeURIComponent(token)}/accept`, { method: 'POST' })
    await navigateTo({ path: localePath('/friends'), hash: `#friend-${made.friendId}` })
  }
  catch (error) {
    message.value = parse(error).message
  }
  finally {
    busy.value = false
  }
}
</script>

<template>
  <div>
    <PageHead :title="title" :lead="lead">
      <template #actions>
        <template v-if="state === 'open'">
          <art-button>
            <button type="button" :aria-disabled="busy || undefined" @click="accept">{{ busy ? t('auth.busy') : t('friends.linkAccept') }}</button>
          </art-button>
          <art-button variant="quiet">
            <NuxtLink :to="localePath('/')">{{ t('friends.linkLater') }}</NuxtLink>
          </art-button>
          <p v-if="message" class="form-message" role="alert">{{ message }}</p>
        </template>
        <OneTimeLink v-else-if="state === 'own'" :path="route.path" :text="t('friends.linkOwn')" :share="{ title: t('friends.linkShareTitle'), text: t('friends.linkShareText') }" />
        <art-button v-else variant="secondary">
          <NuxtLink :to="localePath('/friends')">{{ t('friends.toFriends') }}</NuxtLink>
        </art-button>
      </template>
    </PageHead>

    <section class="band section" data-paint="1" aria-labelledby="friends-how-title">
      <div class="inner">
        <div class="section-head">
          <h2 id="friends-how-title" class="section-title">{{ t('friends.howTitle') }}</h2>
        </div>
        <div class="section-body">
          <ul class="rows">
            <li v-for="n in 3" :key="n" class="row">{{ t(`friends.how${n}`) }}</li>
          </ul>
        </div>
      </div>
    </section>
  </div>
</template>
