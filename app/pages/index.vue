<script setup lang="ts">
import type { HomeView, OpenedList } from '#shared/schemas/list'

const { t, locale } = useI18n()
const localePath = useLocalePath()
const { loggedIn } = useUserSession()
const { parse } = useApiError()

useHead({ title: () => t('home.title') })

const { data: home, refresh } = await useFetch<HomeView>('/api/home')
const owned = computed(() => home.value?.owned ?? [])
const opened = computed(() => home.value?.opened ?? [])

const creating = ref(false)
const createError = ref('')

async function createList(title: string) {
  creating.value = true
  createError.value = ''
  try {
    const list = await $fetch<{ token: string }>('/api/lists', { method: 'POST', body: { title } })
    await navigateTo(localePath(`/l/${list.token}`))
  }
  catch (error) {
    const parsed = parse(error)
    createError.value = parsed.fields.title ?? parsed.message
  }
  finally {
    creating.value = false
  }
}

const removing = ref<string | null>(null)
const removeError = ref('')
const openedTitle = ref<HTMLElement>()

async function forget(token: string) {
  if (removing.value) return
  removing.value = token
  removeError.value = ''
  try {
    await $fetch(`/api/home/opened/${token}`, { method: 'DELETE' })
    await refresh()
    // The button that had the focus is gone with its row.
    openedTitle.value?.focus()
  }
  catch (error) {
    removeError.value = parse(error).message
  }
  finally {
    removing.value = null
  }
}

// A deleted list still opens for someone logged in, who may have bought something on it.
// For a visitor who isn't, the link would only lead to "not found".
const canOpen = (list: OpenedList) => !list.deleted || loggedIn.value

const ownerNames = (owners: string[]) =>
  new Intl.ListFormat(locale.value, { type: 'conjunction' }).format(owners)

// Gesso allows one splatter per view; when both sections are empty the first one has it.
const openedSplatter = computed(() => !loggedIn.value || owned.value.length > 0)
</script>

<template>
  <div>
    <div class="band hero" data-paint="deep">
      <div class="inner">
        <h1>{{ t('home.title') }}</h1>
        <p class="lead">{{ t('home.lead') }}</p>
      </div>
      <art-drip class="band-drip" pigment="--surface" stagger flush />
    </div>

    <section class="band section" data-paint="1" aria-labelledby="yours-title">
      <div class="inner">
        <div class="section-head">
          <h2 id="yours-title" class="section-title">{{ t('home.yourLists') }}</h2>
        </div>
        <div v-if="loggedIn" class="section-body">
          <div v-if="!owned.length" class="empty">
            <art-splatter pigment="complement" seed="no-lists" />
            <p>{{ t('home.yourListsEmpty') }}</p>
          </div>
          <ul class="rows">
            <li v-for="list in owned" :key="list.token" class="row">
              <NuxtLink class="row-title" :to="localePath(`/l/${list.token}`)">{{ list.title }}</NuxtLink>
              <span class="row-meta">{{ t('home.wishes', list.wishes) }}</span>
            </li>
            <li>
              <QuickAdd :label="t('home.newList')" :pending="creating" @add="createList" />
            </li>
          </ul>
          <p v-if="createError" class="form-message" role="alert">{{ createError }}</p>
        </div>
        <div v-else class="section-body">
          <p class="intro">{{ t('home.loggedOut') }}</p>
          <div class="actions">
            <art-button>
              <NuxtLink :to="localePath('/login')">{{ t('nav.login') }}</NuxtLink>
            </art-button>
            <art-button variant="secondary">
              <NuxtLink :to="localePath('/register')">{{ t('auth.register') }}</NuxtLink>
            </art-button>
          </div>
        </div>
      </div>
    </section>

    <section class="band section" data-paint="2" aria-labelledby="opened-title">
      <div class="inner">
        <div class="section-head">
          <h2 id="opened-title" ref="openedTitle" class="section-title" tabindex="-1">{{ t('home.opened') }}</h2>
          <p class="intro">{{ t('home.openedIntro') }}</p>
        </div>
        <div class="section-body">
          <p v-if="removeError" class="form-message" role="alert">{{ removeError }}</p>
          <ul v-if="opened.length" class="rows">
            <li v-for="list in opened" :key="list.token" class="row">
              <div class="row-text">
                <NuxtLink v-if="canOpen(list)" :id="`opened-${list.token}`" class="row-title" :to="localePath(`/l/${list.token}`)">{{ list.title }}</NuxtLink>
                <span v-else :id="`opened-${list.token}`" class="row-title">{{ list.title }}</span>
                <span v-if="list.owners.length" class="row-meta">{{ t('home.owners', { names: ownerNames(list.owners) }) }}</span>
              </div>
              <art-tape v-if="list.deleted" :seed="list.token">{{ t('home.deleted') }}</art-tape>
              <art-button variant="quiet" size="s">
                <button type="button" :aria-describedby="`opened-${list.token}`" @click="forget(list.token)">{{ t('home.remove') }}</button>
              </art-button>
            </li>
          </ul>
          <div v-else class="empty">
            <art-splatter v-if="openedSplatter" pigment="complement" seed="none-opened" />
            <p>{{ t('home.openedEmpty') }}</p>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
