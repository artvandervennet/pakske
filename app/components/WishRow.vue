<script setup lang="ts">
import type { WishView } from '#shared/schemas/list'

// One wish on a list: a row that unfolds in place. The page keeps which rows are open, so
// several can be open at once and they stay open when the list refreshes.
// `owners` is the owners' names as one phrase; `ownerCount` picks the singular or plural around it.
const props = defineProps<{ wish: WishView, token: string, open: boolean, owners: string, ownerCount: number }>()
const emit = defineEmits<{ toggle: [], changed: [] }>()

const { t } = useI18n()
const { secondLine, amountTag } = useWishStatus()

const detailsId = computed(() => `wish-${props.wish.id}-details`)
const line = computed(() => secondLine(props.wish))
const amount = computed(() => amountTag(props.wish))
const removed = computed(() => props.wish.role === 'buyer' && props.wish.removed)
</script>

<template>
  <li :id="`wish-${wish.id}`" class="wish-row" :class="{ open, removed }">
    <div class="wish-head">
      <!-- The tick and its message (WishTick). The message wraps onto a line of its own. -->
      <slot name="tick" />
      <WishThumb :wish="wish" />
      <!-- The button stretches over the whole row (see app.css), so tapping the picture or
           the tag unfolds it too; the tick, above it, stays its own control. -->
      <button
        type="button"
        class="wish-toggle"
        :aria-expanded="open ? 'true' : 'false'"
        :aria-controls="detailsId"
        @click="emit('toggle')"
      >
        <span class="wish-title">{{ wish.title }}</span>
        <span v-if="line" class="wish-line">{{ line }}</span>
      </button>
      <div v-if="amount || removed" class="wish-tags">
        <art-tape v-if="removed" pigment="complement" :seed="`removed-${wish.id}`">{{ t('item.removed') }}</art-tape>
        <art-tape v-if="amount" :seed="`wish-${wish.id}`">{{ amount }}</art-tape>
      </div>
    </div>
    <div :id="detailsId" class="wish-details" :hidden="!open">
      <WishBuyerDetails v-if="open" :wish="wish" :token="token" :owners="owners" :owner-count="ownerCount" @changed="emit('changed')" />
    </div>
  </li>
</template>
