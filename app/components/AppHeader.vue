<script setup lang="ts">
const { t, locale } = useI18n()
const localePath = useLocalePath()
const { loggedIn, user, clear } = useUserSession()

// <art-header> reads its links and its actions once, when it connects. A new key makes Vue
// replace the element when the person or the language changes.
const headerKey = computed(() => `${user.value?.id ?? 'anon'}-${locale.value}`)

async function logout() {
  await clear()
  // A full reload, so nothing a buyer saw stays in memory for the next person at this computer.
  window.location.assign(localePath('/'))
}
</script>

<template>
  <art-header :key="headerKey" :label="t('nav.label')" data-paint="deep">
    <NuxtLink slot="wordmark" :to="localePath('/')">{{ t('site.name') }}</NuxtLink>
    <NuxtLink :to="localePath('/')">{{ t('nav.lists') }}</NuxtLink>
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
