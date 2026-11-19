<script setup lang="ts">
import type { ShownList } from '#shared/schemas/list'

// A list a friend shows you, as a row on the home page and the lists page: its name, whose it
// is, and "Weghalen", which takes it off your own page only. Whoever shows it isn't told, and
// the list's link keeps working. The button says only "Weghalen"; the list's name is its
// description, so a screen reader says which list it takes away.
const props = defineProps<{ list: ShownList }>()
defineEmits<{ hide: [token: string] }>()

const { t } = useI18n()
const localePath = useLocalePath()
const names = useNames()

const titleId = computed(() => `shown-${props.list.token}`)
</script>

<template>
  <li class="row">
    <div class="row-text">
      <NuxtLink :id="titleId" class="row-title" :to="localePath(`/l/${list.token}`)">{{ list.title }}</NuxtLink>
      <span v-if="list.owners.length" class="row-meta">{{ t('list.owners', { names: names(list.owners) }) }}</span>
    </div>
    <art-button variant="quiet" size="s">
      <button type="button" :aria-describedby="titleId" @click="$emit('hide', list.token)">{{ t('lists.remove') }}</button>
    </art-button>
  </li>
</template>
