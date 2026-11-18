<script setup lang="ts">
import type { BuyerWish } from '#shared/schemas/list'

// The notes buyers leave each other on a wish. The server only sends them to buyers, and only
// a buyer of this wish gets this component. `hiddenFrom` is everyone who never sees them: the
// list's owners and the wish's other owners. The field's label says so ("Art ziet dit niet"),
// between its name and the field (FormField), so it is read before anything is typed.
const props = defineProps<{ wish: BuyerWish, token: string, hiddenFrom: string[] }>()
const emit = defineEmits<{ changed: [] }>()

const { t, locale } = useI18n()
const names = useNames()
const { parse } = useApiError()
const body = ref('')
// Several rows can be open at once, each with its own form.
const fieldId = computed(() => `note-${props.wish.id}`)
// A deleted list whose owners' accounts are gone has nobody to hide the notes from.
const hint = computed(() => props.hiddenFrom.length
  ? t('notes.hint', { names: names(props.hiddenFrom) }, props.hiddenFrom.length)
  : undefined)

const { form, pending, message, errors, run } = useForm(async () => {
  await $fetch(`/api/lists/${props.token}/wishes/${props.wish.id}/notes`, { method: 'POST', body: { body: body.value } })
  body.value = ''
  emit('changed')
})

const deleting = ref<string | null>(null)
async function remove(id: string) {
  if (deleting.value) return
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
    <h4 v-if="wish.notes.length" :id="`${fieldId}-title`" class="wish-label">{{ t('notes.title') }}</h4>
    <ul v-if="wish.notes.length" class="wish-notes-list" :aria-labelledby="`${fieldId}-title`">
      <li v-for="note in wish.notes" :key="note.id" class="note">
        <header>
          <strong>{{ note.mine ? t('purchase.you') : note.author }}</strong>
          <NuxtTime :datetime="note.createdAt" :locale="locale" date-style="medium" time-style="short" />
          <button
            v-if="note.mine"
            type="button"
            class="icon-button"
            :aria-label="t('notes.delete')"
            :title="t('notes.delete')"
            :aria-disabled="deleting === note.id || undefined"
            @click="remove(note.id)"
          >
            <AppIcon name="close" />
          </button>
        </header>
        <p>{{ note.body }}</p>
      </li>
    </ul>

    <form ref="form" class="form" method="post" novalidate @submit.prevent="run">
      <p v-if="message" class="form-message" role="alert">{{ message }}</p>
      <FormField :id="fieldId" v-slot="field" :label="t('notes.label')" :hint="hint" :error="errors.body">
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
