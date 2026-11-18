<script setup lang="ts">
import type { WishView } from '#shared/schemas/list'
import type { WishTickState } from '~/composables/useWishTick'

// "I'm giving this", at the start of a folded row, in a column as narrow as a box on every row.
// A wish asked for once has a box. One asked for more than once, or without a limit, has a
// count the size of that box: it shows this person's number, and pressing it gives one more.
// Lowering is done in the opened card, where the full stepper is (WishGive). When no more can
// be given the count looks and announces as unavailable, like the box.
// The state and the requests are the row's (useWishTick), shared with the card's control.
const props = defineProps<{ wish: WishView, tick: WishTickState }>()

const { t } = useI18n()
const countId = computed(() => `wish-${props.wish.id}-tick-count`)
// An owner ticks what they have themselves; anyone else what they give.
const own = computed(() => props.wish.role === 'owner')

// The box never toggles itself: it shows what the server has, and changes once that does.
function onBox(event: Event) {
  event.preventDefault()
  props.tick.flip()
}
</script>

<template>
  <div class="wish-tick">
    <label v-if="tick.once" class="tick-box">
      <!-- aria-disabled instead of disabled: a control that turns disabled under the keyboard
           loses the focus, and the person pressing it would have to find their place again. -->
      <input
        type="checkbox"
        :checked="tick.mine > 0"
        :disabled="!tick.hydrated || undefined"
        :aria-disabled="tick.unavailable || tick.blocked || undefined"
        :aria-describedby="tick.describedBy"
        @click="onBox"
      >
      <span class="visually-hidden">{{ t(own ? 'tick.ownBox' : 'tick.box', { title: wish.title }) }}</span>
    </label>
    <template v-else>
      <button
        type="button"
        class="tick-count"
        :class="{ on: tick.mine > 0 }"
        :aria-label="t('tick.more', { title: wish.title })"
        :aria-disabled="!tick.raisable || tick.blocked || undefined"
        :aria-describedby="tick.describedBy ? `${countId} ${tick.describedBy}` : countId"
        @click="tick.more()"
      >
        <span class="tick-count-number" aria-hidden="true">{{ tick.mine }}</span>
      </button>
      <span :id="countId" class="visually-hidden" aria-live="polite">{{ tick.countWords }}</span>
    </template>
  </div>
</template>
