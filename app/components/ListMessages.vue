<script setup lang="ts">
import type { ListThread } from '#shared/schemas/list'

// The band under a list's wishes where its owners are written to. Someone who opened the list
// asks or tells them something there, without a name: the owners read the words and never who
// wrote them (server/domain/messages.ts). An owner finds every conversation here and answers
// with their own name; the band is only there for them once someone wrote. Someone who isn't
// logged in is told to log in. The page comes here from a notice by `#messages`.
const props = defineProps<{ token: string, threads: ListThread[], owners: string[], owns: boolean }>()
const emit = defineEmits<{ changed: [] }>()

const { t } = useI18n()
const names = useNames()
const { parse } = useApiError()
const { loggedIn } = useUserSession()
const route = useRoute()
const localePath = useLocalePath()

const loginLink = computed(() => ({ path: localePath('/login'), query: { next: `${route.path}#messages` } }))

// An owner deleting a conversation is asked first. Afterwards its button is gone with it, so
// the heading takes the focus and a line says what happened. After "Annuleren" the focus goes
// back to the button that asked: Safari doesn't focus a button that is clicked, so the dialog
// has nothing to give the focus back to by itself.
const dialog = useTemplateRef<HTMLDialogElement>('dialog')
const heading = useTemplateRef<HTMLElement>('heading')
const leaving = ref<string | null>(null)
let asker: HTMLElement | null = null
const busy = ref(false)
const status = ref('')
const error = ref('')

function askToDelete(threadId: string, from: HTMLElement) {
  if (busy.value) return
  leaving.value = threadId
  asker = from
  dialog.value?.showModal()
}

async function onDialogClose() {
  const threadId = leaving.value
  const choice = dialog.value?.returnValue ?? ''
  if (dialog.value) dialog.value.returnValue = ''
  if (choice !== 'delete' || !threadId || busy.value) return void asker?.focus()
  busy.value = true
  status.value = ''
  error.value = ''
  try {
    await $fetch(`/api/lists/${props.token}/threads/${threadId}`, { method: 'DELETE' })
    status.value = t('messages.threadDeleted')
  }
  catch (failure) {
    error.value = parse(failure).message
  }
  finally {
    busy.value = false
    // Also after a refusal: the conversation may already be gone.
    emit('changed')
    await nextTick()
    heading.value?.focus()
  }
}
</script>

<template>
  <section id="messages" class="band section" data-paint="2" aria-labelledby="messages-title">
    <div class="inner">
      <div class="section-head">
        <h2 id="messages-title" ref="heading" class="section-title" tabindex="-1">
          {{ owns ? t('messages.title') : t('messages.titleTo', { names: names(owners) }) }}
        </h2>
      </div>
      <div class="section-body">
        <template v-if="owns">
          <p class="muted thread-lead">{{ t('messages.ownerLead') }}</p>
          <!-- Always there, so the words are announced when they appear. -->
          <p class="form-message" role="status">{{ status }}</p>
          <p v-if="error" class="form-message" role="alert">{{ error }}</p>
          <ul class="threads">
            <li v-for="(thread, index) in threads" :key="thread.id">
              <MessageThread
                :token="token"
                :thread="thread"
                :owners="owners"
                :label="t('messages.thread', { n: threads.length - index })"
                owns
                @changed="emit('changed')"
                @remove="from => askToDelete(thread.id, from)"
              />
            </li>
          </ul>
        </template>
        <MessageThread v-else-if="loggedIn" :token="token" :thread="threads[0]" :owners="owners" :owns="false" @changed="emit('changed')" />
        <p v-else class="muted">
          {{ t('messages.loginHint', { names: names(owners) }) }}
          <NuxtLink :to="loginLink">{{ t('nav.login') }}</NuxtLink>
        </p>
      </div>
    </div>

    <dialog v-if="owns" ref="dialog" class="dialog" aria-labelledby="thread-delete-title" aria-describedby="thread-delete-text" @close="onDialogClose">
      <h2 id="thread-delete-title">{{ t('messages.deleteThreadTitle') }}</h2>
      <p id="thread-delete-text">{{ t('messages.deleteThreadBody') }}</p>
      <form method="dialog" class="actions">
        <art-button variant="secondary">
          <button value="cancel" autofocus>{{ t('list.deleteCancel') }}</button>
        </art-button>
        <art-button class="danger">
          <button value="delete">{{ t('messages.deleteThread') }}</button>
        </art-button>
      </form>
    </dialog>
  </section>
</template>
