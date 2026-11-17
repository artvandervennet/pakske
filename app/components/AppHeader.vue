<script setup lang="ts">
const { t, locale } = useI18n()
const localePath = useLocalePath()
const { loggedIn, user, clear } = useUserSession()
const { unseen } = useNotices()

// <art-header> reads its links and its actions once, when it connects. A new key makes Vue
// replace the element when the person, the language or the mark for new notices changes.
const headerKey = computed(() => `${user.value?.id ?? 'anon'}-${locale.value}-${unseen.value > 0 ? 'new' : 'none'}`)
const newNotices = computed(() => t('nav.newNotices', { n: unseen.value }, unseen.value))

async function logout() {
  await clear()
  // A full reload, so nothing a buyer saw stays in memory for the next person at this computer.
  window.location.assign(localePath('/'))
}
</script>

<template>
  <art-header :key="headerKey" :label="t('nav.label')" data-paint="deep">
    <!-- On small screens the links fold away under "Menu", so the mark sits on the wordmark,
         which links to the same page; on wide screens it sits on "Lijsten". CSS shows one. The
         words are an aria-label, not text: <art-header> copies the links' text into the second
         coat of its repaint, where hidden words would show. -->
    <NuxtLink slot="wordmark" :to="localePath('/')">{{ t('site.name') }}<span v-if="unseen > 0" class="nav-mark nav-mark-narrow" role="img" :aria-label="newNotices" /></NuxtLink>
    <NuxtLink :to="localePath('/')">{{ t('nav.lists') }}<span v-if="unseen > 0" class="nav-mark nav-mark-wide" role="img" :aria-label="newNotices" /></NuxtLink>
    <NuxtLink v-if="user" :to="localePath('/settings')">{{ t('nav.settings') }}</NuxtLink>
    <art-scheme slot="actions" remember />
    <art-button v-if="loggedIn" slot="actions" size="s" variant="secondary">
      <button type="button" @click="logout">{{ t('nav.logout') }}</button>
    </art-button>
    <art-button v-else slot="actions" size="s">
      <NuxtLink :to="localePath('/login')">{{ t('nav.login') }}</NuxtLink>
    </art-button>
  </art-header>
</template>
