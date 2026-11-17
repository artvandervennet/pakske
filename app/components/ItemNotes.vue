<script setup lang="ts">
import type { BuyerItem } from '#shared/schemas/list'

// The notes buyers leave each other on a wish. Only shown to buyers.
const props = defineProps<{ item: BuyerItem }>()
const emit = defineEmits<{ changed: [] }>()

const { t, locale } = useI18n()
const { parse } = useApiError()
const body = ref('')

const { form, pending, message, errors, run } = useForm(async () => {
  await $fetch(`/api/items/${props.item.id}/notes`, { method: 'POST', body: { body: body.value } })
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
  <div class="stack">
    <ul v-if="item.notes.length" class="stack">
      <li v-for="note in item.notes" :key="note.id" class="card note">
        <header>
          <span class="avatar small" aria-hidden="true">{{ note.author.charAt(0).toUpperCase() }}</span>
          <strong>{{ note.author }}</strong>
          <NuxtTime :datetime="note.createdAt" :locale="locale" date-style="medium" time-style="short" />
          <art-button v-if="note.mine" variant="quiet" size="s">
            <button type="button" :disabled="deleting === note.id" @click="remove(note.id)">{{ t('notes.delete') }}</button>
          </art-button>
        </header>
        <p>{{ note.body }}</p>
      </li>
    </ul>
    <p v-else class="muted">{{ t('notes.empty') }}</p>

    <form ref="form" class="form" method="post" novalidate @submit.prevent="run">
      <p v-if="message" class="form-message" role="alert">{{ message }}</p>
      <FormField id="note" v-slot="field" :label="t('notes.label')" :error="errors.body">
        <textarea
          id="note"
          v-model="body"
          name="body"
          rows="3"
          maxlength="1000"
          required
          :aria-describedby="field.describedBy"
          :aria-invalid="field.invalid"
        />
      </FormField>
      <div class="actions">
        <art-button>
          <button type="submit" :disabled="pending">{{ t('notes.add') }}</button>
        </art-button>
      </div>
    </form>
  </div>
</template>
