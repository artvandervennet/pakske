<script setup lang="ts">
import type { ListThread, ThreadMessage } from '#shared/schemas/list'

// One conversation with a list's owners: what was written, and the field for the next message.
// For someone who doesn't own the list it is their own conversation, or only the field before
// they wrote anything. For an owner it is one of the list's conversations, to answer in. The
// server never sends who an owner's conversation is with, so the other side reads "Iemand".
const props = defineProps<{
  token: string
  thread?: ListThread
  owns: boolean
  /** The list's owners, for the line that says who reads a message. */
  owners: string[]
  /** An owner's conversations are told apart by a number. */
  label?: string
}>()
const emit = defineEmits<{ changed: [], remove: [from: HTMLElement] }>()

const { t, locale } = useI18n()
const names = useNames()
const { parse } = useApiError()

const body = ref('')
const sent = ref('')
// Several conversations can be on the page, each with its own field.
const fieldId = computed(() => `message-${props.thread?.id ?? 'new'}`)
const hint = computed(() => props.owns
  ? t('messages.answerHint')
  : t('messages.hint', { names: names(props.owners) }, props.owners.length))

const who = (message: ThreadMessage) => message.mine
  ? t('purchase.you')
  // An owner whose account is gone has no name left; the other side never had one here.
  : message.fromOwner ? message.owner ?? t('purchase.someone') : t('messages.someone')

const { form, pending, message: failure, errors, run } = useForm(async () => {
  sent.value = ''
  await $fetch(`/api/lists/${props.token}/messages`, {
    method: 'POST',
    body: { body: body.value, thread: props.owns ? props.thread?.id : undefined },
  })
  body.value = ''
  sent.value = t('messages.sent')
  emit('changed')
})

const deleting = ref<string | null>(null)
async function remove(id: string) {
  if (deleting.value) return
  deleting.value = id
  failure.value = ''
  sent.value = ''
  try {
    await $fetch(`/api/messages/${id}`, { method: 'DELETE' })
  }
  catch (error) {
    failure.value = parse(error).message
  }
  finally {
    deleting.value = null
    // Also after a failure: the message may already be gone.
    emit('changed')
  }
}
</script>

<template>
  <div class="thread" :role="label ? 'group' : undefined" :aria-label="label">
    <ol v-if="thread" class="thread-messages">
      <li v-for="message in thread.messages" :key="message.id" class="note" :class="{ mine: message.mine }">
        <header>
          <strong>{{ who(message) }}</strong>
          <NuxtTime :datetime="message.createdAt" :locale="locale" date-style="medium" time-style="short" />
          <button
            v-if="message.mine"
            type="button"
            class="icon-button"
            :aria-label="t('messages.delete')"
            :title="t('messages.delete')"
            :aria-disabled="deleting === message.id || undefined"
            @click="remove(message.id)"
          >
            <AppIcon name="close" />
          </button>
        </header>
        <p>{{ message.body }}</p>
      </li>
    </ol>

    <form ref="form" class="form" method="post" novalidate @submit.prevent="run">
      <p v-if="failure" class="form-message" role="alert">{{ failure }}</p>
      <FormField :id="fieldId" v-slot="field" :label="owns ? t('messages.answerLabel') : t('messages.label')" :hint="hint" :error="errors.body">
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
          <button type="submit" :aria-disabled="pending || undefined">{{ owns ? t('messages.answer') : t('messages.send') }}</button>
        </art-button>
        <art-button v-if="owns" variant="quiet" size="s">
          <button type="button" @click="emit('remove', $event.currentTarget as HTMLElement)">{{ t('messages.deleteThread') }}</button>
        </art-button>
        <!-- Always there, so the word is announced when it appears. -->
        <p class="thread-sent" role="status">{{ sent }}</p>
      </div>
    </form>
  </div>
</template>
