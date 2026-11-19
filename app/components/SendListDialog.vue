<script setup lang="ts">
// "Lijst samen beheren" for someone who has friends: send the list to some of them, or make
// the link as before. A friend gets a notice and becomes a co-owner only by saying yes there.
// With nobody chosen the button makes the link; the page does that (`link`), so the link shows
// in the title band where it always did. The dialog asks the server who can be sent the list
// each time it opens: a friend who owns it already isn't among them.
const props = defineProps<{ token: string, title: string }>()
const emit = defineEmits<{ link: [], sent: [names: string[]] }>()

const { t } = useI18n()
const { parse } = useApiError()
const id = useId()

const dialog = useTemplateRef<HTMLDialogElement>('dialog')
const heading = useTemplateRef<HTMLElement>('heading')
const friends = ref<{ id: number, name: string }[]>([])
const chosen = ref<number[]>([])
const busy = ref(false)
const error = ref('')

async function open() {
  if (!dialog.value || dialog.value.open) return
  error.value = ''
  chosen.value = []
  try {
    friends.value = (await $fetch<{ friends: { id: number, name: string }[] }>(`/api/lists/${props.token}/friends`)).friends
  }
  catch {
    // Without the names there is still the link.
    friends.value = []
  }
  dialog.value.showModal()
  // The heading rather than the first switch: a screen reader starts with what this is about.
  heading.value?.focus()
}

async function go() {
  if (busy.value) return
  if (!chosen.value.length) {
    dialog.value?.close()
    emit('link')
    return
  }
  busy.value = true
  error.value = ''
  try {
    const to = friends.value.filter(friend => chosen.value.includes(friend.id))
    await $fetch<unknown>(`/api/lists/${props.token}/invites`, { method: 'POST', body: { kind: 'list', friends: to.map(friend => friend.id) } })
    dialog.value?.close()
    emit('sent', to.map(friend => friend.name))
  }
  catch (failure) {
    error.value = parse(failure).message
  }
  finally {
    busy.value = false
  }
}

defineExpose({ open })
</script>

<template>
  <dialog ref="dialog" class="dialog friends-dialog" :aria-labelledby="`${id}-title`">
    <h2 :id="`${id}-title`" ref="heading" tabindex="-1">{{ t('list.sendTitle', { title }) }}</h2>
    <p>{{ t('list.sendBody') }}</p>
    <FriendChoice v-if="friends.length" v-model="chosen" :friends="friends" :legend="t('share.toFriends')" :hint="t('share.toFriendsHint')" />
    <p v-if="error" class="form-message" role="alert">{{ error }}</p>
    <div class="actions">
      <art-button variant="secondary">
        <button type="button" @click="dialog?.close()">{{ t('share.cancel') }}</button>
      </art-button>
      <art-button>
        <button type="button" :aria-disabled="busy || undefined" @click="go">{{ chosen.length ? t('share.send') : t('share.make') }}</button>
      </art-button>
    </div>
  </dialog>
</template>
