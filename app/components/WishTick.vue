<script setup lang="ts">
import type { WishView } from '#shared/schemas/list'

// "I'm getting this", at the start of a row: a box for a wish wanted once, a stepper for one
// wanted more than once or without a limit. A buyer can't take more than is left. An owner
// is never shown what is left: their controls stay open, they are warned before every
// increase, and a refusal names nobody and gives no number.
const props = defineProps<{ wish: WishView, token: string }>()
// 'gone' when the wish no longer exists, so the page can say so if the row disappears.
const emit = defineEmits<{ changed: [reason?: 'gone'] }>()

const { t } = useI18n()
const { parse } = useApiError()
const askWarning = useTickWarning()

const url = computed(() => `/api/lists/${props.token}/wishes/${props.wish.id}/purchase`)
const messageId = computed(() => `wish-${props.wish.id}-tick-message`)

// What this person asked for last, until the refreshed list brings the real number. Without
// it, a second tap before the refresh lands would send the same number again.
const pending = ref<number | null>(null)
const mine = computed(() => (props.wish.role === 'anon' ? 0 : pending.value ?? props.wish.mine))
const isBox = computed(() => props.wish.quantity === 1)

const message = ref('')
// The tick state a refusal is about. A refusal asks for a refresh, and that refresh brings the
// state it refers to (null until then); the message goes once a later refresh changes it.
let messageState: string | null = null
watch(() => props.wish, (wish) => {
  pending.value = null
  if (!message.value) return
  const state = tickState(wish)
  if (messageState === null) messageState = state
  else if (state !== messageState) message.value = ''
})

// Until the page is hydrated a tap does nothing, and a box would tick itself without asking,
// so the box is really disabled until then.
const hydrated = ref(false)
onMounted(() => {
  hydrated.value = true
})

const busy = ref(false)
const blocked = computed(() => !hydrated.value || busy.value)
const canLower = computed(() => mine.value > 0)
const raisable = computed(() => canRaise(props.wish, mine.value))

async function setMine(target: number) {
  if (blocked.value) return
  if (target > mine.value && !raisable.value) return
  if (target < mine.value && !canLower.value) return
  // Busy before the warning, so a second tap can't open it again behind the first.
  busy.value = true
  message.value = ''
  try {
    if (needsWarning(props.wish, mine.value, target) && !(await askWarning(props.wish.title))) return
    if (target === 0) await $fetch(url.value, { method: 'DELETE' })
    else await $fetch(url.value, { method: 'PUT', body: { quantity: target } })
    pending.value = target
    emit('changed')
  }
  catch (error) {
    const { code, message: sentence } = parse(error)
    const refusal = tickRefusal(code, isBox.value)
    if (refusal) {
      message.value = t(refusal.key)
      messageState = null
      // A buyer who bought a removed wish keeps its row; for everyone else it goes.
      emit('changed', refusal.gone ? 'gone' : undefined)
    }
    else {
      message.value = sentence
      messageState = tickState(props.wish)
    }
  }
  finally {
    busy.value = false
  }
}

// The box never toggles itself: it shows what the server has, and changes once that does.
function onBox(event: Event) {
  event.preventDefault()
  setMine(mine.value > 0 ? 0 : 1)
}

// aria-disabled instead of disabled: a button that turns disabled under the keyboard loses
// the focus, and the person pressing + would have to find their place again.
const boxDisabled = computed(() => mine.value === 0 && !raisable.value)
const describedBy = computed(() => (message.value ? messageId.value : undefined))
</script>

<template>
  <template v-if="wish.role !== 'anon'">
    <div class="wish-tick">
      <label v-if="isBox" class="tick-box">
        <input
          type="checkbox"
          :checked="mine > 0"
          :disabled="!hydrated || undefined"
          :aria-disabled="boxDisabled || blocked || undefined"
          :aria-describedby="describedBy"
          @click="onBox"
        >
        <span class="visually-hidden">{{ t('tick.box', { title: wish.title }) }}</span>
      </label>
      <div v-else class="stepper">
        <button
          type="button"
          :aria-label="t('tick.less', { title: wish.title })"
          :aria-disabled="!canLower || blocked || undefined"
          :aria-describedby="describedBy"
          @click="setMine(mine - 1)"
        >
          −
        </button>
        <span class="stepper-count" aria-hidden="true">{{ wish.quantity === null ? mine : `${mine} / ${wish.quantity}` }}</span>
        <span class="visually-hidden" aria-live="polite">
          {{ wish.quantity === null ? t('tick.count', { n: mine }) : t('tick.countOf', { n: mine, quantity: wish.quantity }) }}
        </span>
        <button
          type="button"
          :aria-label="t('tick.more', { title: wish.title })"
          :aria-disabled="!raisable || blocked || undefined"
          :aria-describedby="describedBy"
          @click="setMine(mine + 1)"
        >
          +
        </button>
      </div>
    </div>
    <p v-if="message" :id="messageId" class="wish-tick-message" role="alert">{{ message }}</p>
  </template>
</template>
