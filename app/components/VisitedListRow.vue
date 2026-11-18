<script setup lang="ts">
import type { OpenedList } from '#shared/schemas/list'

// Someone else's list that you opened before, as a row on the home page and the lists page: its
// name, whose it is, a tape when it was deleted, and "Weghalen". The button says only "Weghalen";
// the list's name is its description, so a screen reader says which list it takes away.
const props = defineProps<{ list: OpenedList }>()
defineEmits<{ forget: [token: string] }>()

const { t } = useI18n()
const localePath = useLocalePath()
const { loggedIn } = useUserSession()
const names = useNames()

const titleId = computed(() => `visited-${props.list.token}`)
// A deleted list still opens for someone logged in, who may have bought something on it.
// For a visitor who isn't, the link would only lead to "not found".
const canOpen = computed(() => !props.list.deleted || loggedIn.value)
</script>

<template>
  <li class="row">
    <div class="row-text">
      <NuxtLink v-if="canOpen" :id="titleId" class="row-title" :to="localePath(`/l/${list.token}`)">{{ list.title }}</NuxtLink>
      <span v-else :id="titleId" class="row-title">{{ list.title }}</span>
      <span v-if="list.owners.length" class="row-meta">{{ t('list.owners', { names: names(list.owners) }) }}</span>
    </div>
    <art-tape v-if="list.deleted" :seed="list.token">{{ t('lists.deleted') }}</art-tape>
    <art-button variant="quiet" size="s">
      <button type="button" :aria-describedby="titleId" @click="$emit('forget', list.token)">{{ t('lists.remove') }}</button>
    </art-button>
  </li>
</template>
