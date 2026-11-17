<script setup lang="ts">
import type { BuyerWish } from '#shared/schemas/list'

// The notes buyers leave each other on a wish. The server only sends them to buyers, and only
// a buyer of this wish gets this component. `hiddenFrom` names everyone who never sees them:
// the list's owners and the wish's other owners, as one phrase.
const props = defineProps<{ wish: BuyerWish, token: string, hiddenFrom: string }>()
const emit = defineEmits<{ changed: [] }>()

const { t, locale } = useI18n()
const { parse } = useApiError()
const body = ref('')
// Several rows can be open at once, each with its own form.
const fieldId = computed(() => `note-${props.wish.id}`)

const { form, pending, message, errors, run } = useForm(async () => {
  await $fetch(`/api/lists/${props.token}/wishes/${props.wish.id}/notes`, { method: 'POST', body: { body: body.value } })
  body.value = ''
  emit('changed')
})

const deleting = ref<string | null>(null)
async function remove(id: string) {
  deleting.value = id
  message.value = ''
  try {
    await $fetch(`/api/notes/${id}`, { method: 'DELETE' })
  }
  catch (error) {
    message.value = parse(error).message
  }
  finally {
    deleting.value = null
    // Also after a failure: the note may already be gone.
    emit('changed')
  }
}
</script>

<template>
  <div class="wish-notes">
    <ul v-if="wish.notes.length" class="wish-notes-list">
      <li v-for="note in wish.notes" :key="note.id" class="note">
        <header>
          <strong>{{ note.mine ? t('purchase.you') : note.author }}</strong>
          <NuxtTime :datetime="note.createdAt" :locale="locale" date-style="medium" time-style="short" />
          <art-button v-if="note.mine" variant="quiet" size="s">
            <button type="button" :disabled="deleting === note.id" @click="remove(note.id)">{{ t('notes.delete') }}</button>
          </art-button>
        </header>
        <p>{{ note.body }}</p>
      </li>
    </ul>

    <form ref="form" class="form" method="post" novalidate @submit.prevent="run">
      <p v-if="message" class="form-message" role="alert">{{ message }}</p>
      <FormField :id="fieldId" v-slot="field" :label="t('notes.label')" :hint="t('notes.hint', { names: hiddenFrom })" :error="errors.body">
        <textarea
          :id="fieldId"
          v-model="body"
          name="body"
          rows="2"
          maxlength="1000"
          required
          :aria-describedby="field.describedBy"
          :aria-invalid="field.invalid"
        />
      </FormField>
      <div class="actions">
        <art-button size="s">
          <button type="submit" :disabled="pending">{{ t('notes.add') }}</button>
        </art-button>
      </div>
    </form>
  </div>
</template>
