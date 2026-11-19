<script setup lang="ts">
const { t, locale } = useI18n()
const localePath = useLocalePath()
const { loggedIn, user, clear } = useUserSession()
const { unseen } = useNotices()
const route = useRoute()

// Logging in brings you back to the page you were on. From the login or register page itself,
// the way back that page already carries is kept; from the home page there is nowhere to go back to.
const loginLink = computed(() => {
  const login = localePath('/login')
  const onAuthPage = [login, localePath('/register')].includes(route.path)
  const next = onAuthPage ? route.query.next : route.fullPath === localePath('/') ? undefined : route.fullPath
  return { path: login, query: typeof next === 'string' ? { next } : {} }
})

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
    <!-- The link to the page you are on carries aria-current="page": NuxtLink sets it when its
         address is the current one, whatever the query, and <art-header> paints its stroke
         under that link.
         The mark for new notices sits on the wordmark, which leads to the home page, where the
         notices are. Its words are an aria-label, not text: <art-header> copies the links' text
         into the second coat of its repaint, where hidden words would show.
         The logo stands before the name, inside the same link. The name names the link, so the
         picture has an empty alt. Gesso's layout.css sizes it. -->
    <NuxtLink slot="wordmark" :to="localePath('/')"><img src="/logo.svg" alt="" width="28" height="28">{{ t('site.name') }}<span v-if="unseen > 0" class="nav-mark" role="img" :aria-label="newNotices" /></NuxtLink>
    <NuxtLink :to="localePath('/lists')">{{ t('nav.lists') }}</NuxtLink>
    <NuxtLink v-if="user" :to="localePath('/settings')">{{ t('nav.settings') }}</NuxtLink>
    <art-button v-if="loggedIn" slot="actions" size="s" variant="secondary">
      <button type="button" @click="logout">{{ t('nav.logout') }}</button>
    </art-button>
    <art-button v-else slot="actions" size="s">
      <NuxtLink :to="loginLink">{{ t('nav.login') }}</NuxtLink>
    </art-button>
  </art-header>
</template>
