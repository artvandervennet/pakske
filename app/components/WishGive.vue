<script setup lang="ts">
import type { BuyerWish, OwnerWish } from '#shared/schemas/list'
import type { WishTickState } from '~/composables/useWishTick'

// "I'm giving this", in the opened card: the one place to give a wish and to take that back.
// A wish asked for once has a wide button (Gesso's <art-button>) that stays pressed while you give it. One asked for
// more than once, or without a limit, has the stepper (− number +) in a sentence: "Ik geef er
// 2 van 3", where 3 is the most this person can have (tickCeiling).
// An owner gets the same control in quieter words and colours: it says they have the wish
// themselves, not that they give it. Their + is always open and warns first (useWishTick).
// The state and the requests are the row's, shared with the control at the start of the row.
const props = defineProps<{ wish: BuyerWish | OwnerWish, tick: WishTickState }>()

const { t } = useI18n()
const own = computed(() => props.wish.role === 'owner')
// Others took all of it: the control can't be used, and says why under it. An owner never
// gets here (their control stays open), nor does a wish that left the list, which says so itself.
const full = computed(() => props.tick.unavailable && props.wish.role === 'buyer' && !props.wish.removed)
// What the button says about itself, whichever of its two looks it has.
const press = computed(() => ({
  'type': 'button' as const,
  'aria-pressed': props.tick.mine > 0 ? 'true' as const : 'false' as const,
  'aria-disabled': props.tick.unavailable || props.tick.blocked || undefined,
  'aria-describedby': props.tick.describedBy,
}))
</script>

<template>
  <div class="wish-give" :class="{ own }">
    <!-- aria-disabled instead of disabled: a button that turns disabled under the keyboard
         loses the focus, and the person pressing it would have to find their place again. -->
    <template v-if="tick.once">
      <!-- For a buyer it is the card's one bold button: Gesso's own, as wide as the column. -->
      <art-button v-if="!own">
        <button v-bind="press" @click="tick.flip()">
          <span class="give-box" aria-hidden="true"><AppIcon v-if="tick.mine > 0" name="check" /></span>
          {{ t('tick.give') }}
        </button>
      </art-button>
      <button v-else v-bind="press" class="give-own" @click="tick.flip()">
        <span class="give-box" aria-hidden="true"><AppIcon v-if="tick.mine > 0" name="check" /></span>
        {{ t('tick.own') }}
      </button>
    </template>
    <div v-else class="give-count" role="group" :aria-label="t(own ? 'tick.ownGroup' : 'tick.giveGroup', { title: wish.title })">
      <span class="give-count-words">{{ t(own ? 'tick.ownSome' : 'tick.giveSome') }}</span>
      <div class="stepper">
        <button
          type="button"
          :aria-label="t('tick.less', { title: wish.title })"
          :aria-disabled="!tick.canLower || tick.blocked || undefined"
          :aria-describedby="tick.describedBy"
          @click="tick.less()"
        >
          <AppIcon name="minus" />
        </button>
        <span class="stepper-count" aria-hidden="true">{{ tick.mine }}</span>
        <button
          type="button"
          :aria-label="t('tick.more', { title: wish.title })"
          :aria-disabled="!tick.raisable || tick.blocked || undefined"
          :aria-describedby="tick.describedBy"
          @click="tick.more()"
        >
          <AppIcon name="plus" />
        </button>
      </div>
      <span v-if="tick.ceiling !== null" class="give-count-words" aria-hidden="true">{{ t('tick.of', { quantity: tick.ceiling }) }}</span>
      <span class="visually-hidden" aria-live="polite">{{ tick.countWords }}</span>
    </div>
    <p v-if="full" class="wish-give-hint">{{ t('tick.full') }}</p>
    <p v-if="tick.message" :id="tick.messageId" class="wish-tick-message" role="alert">{{ tick.message }}</p>
  </div>
</template>
