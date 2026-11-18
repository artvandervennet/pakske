<script setup lang="ts">
import type { OwnedList } from '#shared/schemas/list'

// A list of your own as a row, on the home page and the lists page: its name is the link, and
// the line beside it says how many wishes it has and who you share it with.
defineProps<{ list: OwnedList }>()

const { t } = useI18n()
const localePath = useLocalePath()
const names = useNames()
</script>

<template>
  <li class="row">
    <NuxtLink class="row-title" :to="localePath(`/l/${list.token}`)">{{ list.title }}</NuxtLink>
    <span class="row-meta">{{ t('lists.wishes', list.wishes) }}<template v-if="list.sharedWith.length"> · {{ t('wish.with', { names: names(list.sharedWith) }) }}</template></span>
  </li>
</template>
