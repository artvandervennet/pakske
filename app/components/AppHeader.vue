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

async function logout() {
  await clear()
  // A full reload, so nothing a buyer saw stays in memory for the next person at this computer.
  window.location.assign(localePath('/'))
}

// Candidate for Gesso: a header without links to fold away needs no "Menu" button. Logged out
// there is one link, which stands in the bar itself on a small screen (see the template), so
// the button and its copy in the header's second coat are taken out of the way. They have no
// part to style from outside, so it is done on the elements.
const header = useTemplateRef<HTMLElement>('header')
function fitMenu() {
  for (const button of header.value?.shadowRoot?.querySelectorAll<HTMLElement>('.toggle') ?? []) button.style.display = loggedIn.value ? '' : 'none'
}
onMounted(async () => {
  await customElements.whenDefined('art-header')
  fitMenu()
})
watch(headerKey, async () => {
  await nextTick()
  fitMenu()
})
</script>

<template>
  <!-- The banner role makes the wordmark and the buttons part of a landmark too; <art-header>
       itself only gives its links one (a nav). -->
  <art-header ref="header" :key="headerKey" role="banner" :label="t('nav.label')" data-paint="deep">
    <!-- The link to the page you are on carries aria-current="page": NuxtLink sets it when its
         address is the current one, whatever the query, and <art-header> paints its stroke
         under that link. -->
    <NuxtLink slot="wordmark" :to="localePath('/')">{{ t('site.name') }}</NuxtLink>
    <NuxtLink :to="localePath('/lists')">{{ t('nav.lists') }}</NuxtLink>
    <NuxtLink v-if="user" :to="localePath('/friends')">{{ t('nav.friends') }}</NuxtLink>
    <NuxtLink v-if="user" :to="localePath('/settings')">{{ t('nav.settings') }}</NuxtLink>
    <!-- Logging out is the last of the links, so on a small screen it folds away under "Menu"
         with them and the bar keeps room for the bell. A link and not a button: <art-header>
         only folds, and repaints, its links. It leads where logging out ends, the home page. -->
    <a v-if="loggedIn" :href="localePath('/')" @click.prevent="logout">{{ t('nav.logout') }}</a>
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
    <template v-else>
      <!-- Logged out the bar has room for both, so nothing hides under a menu: on a small
           screen, where the link above is folded away, this one stands in the bar. -->
      <NuxtLink slot="actions" class="bar-link" :to="localePath('/lists')">{{ t('nav.lists') }}</NuxtLink>
      <art-button slot="actions" size="s">
        <NuxtLink :to="loginLink">{{ t('nav.login') }}</NuxtLink>
      </art-button>
    </template>
  </art-header>
  <NoticesHost v-if="loggedIn" ref="noticesHost" />
</template>
