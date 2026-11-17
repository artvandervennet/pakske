<script setup lang="ts">
import type { OwnerWish } from '#shared/schemas/list'
import type { WishSave } from '~/composables/useWishSave'

// How many the owner asks for: the list's stepper (− number +) and a "No limit" switch. It
// looks like the tick's stepper, so it says in words that this is the amount asked for. Each
// step saves; quick steps go out one after another, the last one winning. Lowering always
// works the same way, whatever buyers did.
const props = defineProps<{ wish: OwnerWish, saving: WishSave }>()

const { t } = useI18n()
const id = useId()

// What the server has, and what the stepper shows; they differ while a step is on its way.
const confirmed = ref(props.wish.quantity)
const draft = ref(props.wish.quantity)
// The number to go back to when "No limit" is switched off again.
const lastNumber = ref(props.wish.quantity ?? 1)
const error = ref('')
const sending = ref(false)
const focused = ref(false)

watch(() => props.wish.quantity, (quantity) => {
  if (!followsSaved({ focused: focused.value, saving: sending.value, failed: !!error.value })) return
  confirmed.value = draft.value = quantity
  if (quantity !== null) lastNumber.value = quantity
})

async function send() {
  if (sending.value) return
  sending.value = true
  // A step taken while one is on its way is sent after it.
  while (draft.value !== confirmed.value) {
    const wanted = draft.value
    const reason = await props.saving.save(amountChange(confirmed.value, wanted))
    if (reason) {
      error.value = reason
      break
    }
    confirmed.value = wanted
  }
  sending.value = false
}

function set(quantity: number | null) {
  error.value = ''
  draft.value = quantity
  if (quantity !== null) lastNumber.value = quantity
  send()
}

function step(by: 1 | -1) {
  if (draft.value === null) return
  set(stepAmount(draft.value, by))
}

function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !error.value) return
  event.preventDefault()
  error.value = ''
  draft.value = confirmed.value
}

function onFocusout(event: FocusEvent) {
  focused.value = (event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)
}
</script>

<template>
  <div
    class="amount-edit"
    role="group"
    :aria-labelledby="`${id}-label`"
    :aria-invalid="error ? 'true' : undefined"
    @keydown="onKeydown"
    @focusin="focused = true"
    @focusout="onFocusout"
  >
    <span :id="`${id}-label`" class="amount-edit-label">{{ t('edit.amount') }}</span>
    <div v-if="draft !== null" class="stepper">
      <button
        type="button"
        :aria-label="t('edit.amountLess')"
        :aria-disabled="draft <= 1 || undefined"
        :aria-describedby="error ? `${id}-error` : undefined"
        @click="step(-1)"
      >
        −
      </button>
      <span class="stepper-count" aria-hidden="true">{{ draft }}</span>
      <span class="visually-hidden" aria-live="polite">{{ t('wish.wanted', { n: draft }) }}</span>
      <button
        type="button"
        :aria-label="t('edit.amountMore')"
        :aria-disabled="draft >= 999 || undefined"
        :aria-describedby="error ? `${id}-error` : undefined"
        @click="step(1)"
      >
        +
      </button>
    </div>
    <label class="switch">
      <input
        type="checkbox"
        role="switch"
        :checked="draft === null"
        :aria-describedby="error ? `${id}-error` : undefined"
        @change="set(($event.target as HTMLInputElement).checked ? null : lastNumber)"
      >
      {{ t('edit.unlimited') }}
    </label>
    <p v-if="error" :id="`${id}-error`" class="inline-field-error" role="alert">{{ error }}</p>
  </div>
</template>
