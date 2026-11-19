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
// replace the element when the person or the language changes.
const headerKey = computed(() => `${user.value?.id ?? 'anon'}-${locale.value}`)

// The bell. Its name says how many are new; the dot on it is only for the eye.
const noticesHost = useTemplateRef<{ toggle: (from: HTMLElement) => void, open: boolean }>('noticesHost')
const bellName = computed(() => (unseen.value > 0 ? `${t('nav.notices')}, ${t('nav.newNotices', { n: unseen.value }, unseen.value)}` : t('nav.notices')))

// The header stays while the pages under it change. A menu that was left open doesn't stay
// over the next page, however that page was reached.
const header = useTemplateRef<HTMLElement & { open?: (yes: boolean) => void }>('header')
watch(() => route.fullPath, () => header.value?.open?.(false))

async function logout() {
  await clear()
  // A full reload, so nothing a buyer saw stays in memory for the next person at this computer.
  window.location.assign(localePath('/'))
}
</script>

<template>
  <!-- The banner role makes the wordmark and the buttons part of a landmark too; <art-header>
       itself only gives its links one (a nav). -->
  <!-- Logged out the header holds one link and one button, which fit a phone's bar: `nofold`
       keeps them there, and there is no "Menu" to open for a single line. -->
  <art-header ref="header" :key="headerKey" role="banner" :label="t('nav.label')" data-paint="deep" :nofold="loggedIn ? undefined : ''">
    <!-- The link to the page you are on carries aria-current="page": NuxtLink sets it when its
         address is the current one, whatever the query, and <art-header> paints its stroke
         under that link. -->
    <NuxtLink slot="wordmark" :to="localePath('/')">{{ t('site.name') }}</NuxtLink>
    <NuxtLink :to="localePath('/lists')">{{ t('nav.lists') }}</NuxtLink>
    <NuxtLink v-if="user" :to="localePath('/friends')">{{ t('nav.friends') }}</NuxtLink>
    <NuxtLink v-if="user" :to="localePath('/settings')">{{ t('nav.settings') }}</NuxtLink>
    <!-- The bell is an action, and actions stay in the bar at every width: never under "Menu". -->
    <button
      v-if="loggedIn"
      slot="actions"
      type="button"
      class="bell"
      style="anchor-name: --bell"
      :aria-label="bellName"
      aria-haspopup="dialog"
      :aria-expanded="noticesHost?.open ? 'true' : 'false'"
      @click="noticesHost?.toggle($event.currentTarget as HTMLElement)"
    >
      <AppIcon name="bell" />
      <span v-if="unseen > 0" class="bell-dot" aria-hidden="true" />
    </button>
    <!-- Logging out is an action too, and looks like one: a button after the bell. With `fold`
         <art-header> moves it into "Menu" on a small screen, as its last line, so the bar there
         keeps its room for the bell. -->
    <art-button v-if="loggedIn" slot="actions" fold size="s" variant="secondary">
      <button type="button" @click="logout">{{ t('nav.logout') }}</button>
    </art-button>
    <art-button v-else slot="actions" size="s">
      <NuxtLink :to="loginLink">{{ t('nav.login') }}</NuxtLink>
    </art-button>
  </art-header>
  <NoticesHost v-if="loggedIn" ref="noticesHost" />
</template>
