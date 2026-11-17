<script setup lang="ts">
import type { BuyerItem } from '#shared/schemas/list'

// Who is buying a wish, and the control to say how many you buy. Only shown to buyers:
// the owner's page never receives a BuyerItem.
const props = defineProps<{ item: BuyerItem, ownerName: string }>()
const emit = defineEmits<{ changed: [] }>()

const { t } = useI18n()
const { boughtLabel } = useItemStatus()

const mine = computed(() => props.item.purchases.find(p => p.mine)?.quantity ?? 0)
/** How many are still free, or null when there is no limit. */
const left = computed(() => (props.item.quantity === null ? null : Math.max(0, props.item.quantity - props.item.bought)))
/** The most this buyer may set. On a removed wish, or one that is full, they can only go down. */
const most = computed(() => {
  if (props.item.removed) return mine.value
  return left.value === null ? 999 : mine.value + left.value
})

const quantity = ref(mine.value || 1)
watch(mine, value => (quantity.value = value || 1))
// When others buy in the meantime, the number typed earlier may no longer fit.
watch(most, (value) => {
  if (quantity.value > value) quantity.value = Math.max(1, value)
})

/** Runs a request; when it fails, asks for fresh numbers so the form shows what is left now. */
async function send(request: () => Promise<unknown>) {
  try {
    await request()
  }
  catch (error) {
    emit('changed')
    throw error
  }
}

const done = ref('')

const { form, pending, message, errors, run } = useForm(async () => {
  done.value = ''
  removing.message.value = ''
  await send(() => $fetch<void>(`/api/items/${props.item.id}/purchase`, { method: 'PUT', body: { quantity: Number(quantity.value) } }))
  done.value = t('purchase.saved')
  emit('changed')
})

const removing = useForm(async () => {
  done.value = ''
  message.value = ''
  await send(() => $fetch<void>(`/api/items/${props.item.id}/purchase`, { method: 'DELETE' }))
  done.value = t('purchase.removedDone')
  emit('changed')
})

const failure = computed(() => message.value || removing.message.value)
</script>

<template>
  <div class="stack">
    <div class="amount">
      <span id="amount-label">{{ boughtLabel(item) }}</span>
      <progress
        v-if="item.quantity !== null"
        :value="Math.min(item.bought, item.quantity)"
        :max="item.quantity"
        aria-labelledby="amount-label"
      />
      <span v-if="left !== null && !item.removed" class="muted">{{ t('purchase.left', left) }}</span>
    </div>

    <ul v-if="item.purchases.length" class="people">
      <li v-for="(purchase, index) in item.purchases" :key="index">
        <span class="avatar small" aria-hidden="true">{{ purchase.name.charAt(0).toUpperCase() }}</span>
        <span>{{ purchase.mine ? t('purchase.you') : purchase.name }}</span>
        <span class="count">{{ purchase.quantity }}×</span>
      </li>
    </ul>
    <p v-else class="muted">{{ t('purchase.none') }}</p>

    <p v-if="item.removed" class="form-message">{{ t('purchase.removedItem', { name: ownerName }) }}</p>

    <!-- Outside the form: when the last one was just taken, the form goes and the reason stays. -->
    <p v-if="failure" class="form-message" role="alert">{{ failure }}</p>

    <form v-if="most > 0" ref="form" class="form" method="post" novalidate @submit.prevent="run">
      <FormField v-if="most > 1" id="buy-quantity" v-slot="field" :label="t('purchase.label')" :error="errors.quantity">
        <input
          id="buy-quantity"
          v-model.number="quantity"
          name="quantity"
          type="number"
          inputmode="numeric"
          min="1"
          :max="most"
          step="1"
          required
          :aria-describedby="field.describedBy"
          :aria-invalid="field.invalid"
        >
      </FormField>
      <div class="actions">
        <art-button v-if="most > 1 || !mine">
          <button type="submit" :disabled="pending">{{ mine ? t('purchase.save') : t('purchase.buy') }}</button>
        </art-button>
        <art-button v-if="mine" variant="secondary">
          <button type="button" :disabled="removing.pending.value" @click="removing.run">{{ t('purchase.remove') }}</button>
        </art-button>
      </div>
    </form>
    <p class="form-message" role="status">{{ done }}</p>
  </div>
</template>
