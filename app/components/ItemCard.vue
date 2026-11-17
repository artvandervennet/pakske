<script setup lang="ts">
import type { BuyerItem, PublicItem } from '#shared/schemas/list'

// One wish in a list. The heading holds the card's one link, to the wish's own page;
// <art-canvas> makes the whole card follow it. Without a picture the canvas paints a study,
// seeded by the wish so it is the same every time.
const props = defineProps<{ item: PublicItem | BuyerItem, username: string }>()

const localePath = useLocalePath()
const { amountLabel, boughtLabel } = useItemStatus()

const buyerItem = computed(() => (isBuyerItem(props.item) ? props.item : null))
const amount = computed(() => {
  // For buyers the status already says how many are asked for, except when there is no limit.
  if (buyerItem.value && props.item.quantity !== null) return null
  return amountLabel(props.item)
})
const status = computed(() => {
  if (!buyerItem.value) return null
  return buyerItem.value.removed ? null : boughtLabel(buyerItem.value)
})
</script>

<template>
  <art-canvas :seed="`wish-${item.id}`">
    <img v-if="item.image" slot="media" :src="item.image" alt="" width="400" height="300" loading="lazy" decoding="async">
    <h3>
      <NuxtLink :to="localePath(`/u/${username}/${item.id}`)">{{ item.title }}</NuxtLink>
    </h3>
    <p v-if="item.description" class="clamp">{{ item.description }}</p>
    <div v-if="amount || status" class="tapes">
      <art-tape v-if="amount">{{ amount }}</art-tape>
      <art-tape v-if="status" :pigment="buyerItem && buyerItem.bought > 0 ? 'brand' : undefined">{{ status }}</art-tape>
    </div>
  </art-canvas>
</template>
