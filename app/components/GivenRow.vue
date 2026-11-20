<script setup lang="ts">
import type { GivenWish } from '#shared/schemas/list'

// Something the person gives, as a row on the home page under who it is for: its picture, its
// name as a link to the wish on the list that shows it, and beside it which list that is and how
// many they give when the wish asks for more than one. A tape when it left the list since.
const props = defineProps<{ wish: GivenWish }>()

const { t } = useI18n()
const localePath = useLocalePath()

const meta = computed(() => {
  const { mine, quantity, listTitle } = props.wish
  if (quantity === 1) return listTitle
  const count = quantity === null ? t('tick.count', { n: mine }) : t('tick.countOf', { n: mine, quantity })
  return `${listTitle} · ${count}`
})
</script>

<template>
  <li class="row given-row">
    <WishThumb :wish="wish" />
    <div class="row-text">
      <!-- The list's page opens the wish named after the #. -->
      <NuxtLink class="row-title" :to="{ path: localePath(`/l/${wish.token}`), hash: `#wish-${wish.id}` }">{{ wish.title }}</NuxtLink>
      <span class="row-meta">{{ meta }}</span>
    </div>
    <art-tape v-if="wish.removed" pigment="complement" :seed="`removed-${wish.id}`">{{ t('wish.removed') }}</art-tape>
  </li>
</template>
