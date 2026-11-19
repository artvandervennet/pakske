<script setup lang="ts">
// "Vrienden" on a list of your own: which of your friends find this list among other people's
// lists on their Lists page.
// The dialog asks the server who your friends are each time it opens, so a friend made a minute
// ago is in it. Nothing changes until Opslaan, which sends the whole set. On a joint list every
// owner has a dialog of their own, with their own friends.
// It says, each time, that this is no lock: the list's link opens it for anyone who has it.
const props = defineProps<{ token: string, title: string }>()
const emit = defineEmits<{ saved: [shown: number] }>()

const { t } = useI18n()
const localePath = useLocalePath()
const { parse } = useApiError()
const id = useId()

const dialog = useTemplateRef<HTMLDialogElement>('dialog')
const heading = useTemplateRef<HTMLElement>('heading')
const friends = ref<{ id: number, name: string, shown: boolean }[]>([])
const busy = ref(false)
const error = ref('')

async function open() {
  if (!dialog.value || dialog.value.open) return
  error.value = ''
  friends.value = []
  try {
    friends.value = (await $fetch<{ friends: { id: number, name: string, shown: boolean }[] }>(`/api/lists/${props.token}/friends`)).friends
  }
  catch (failure) {
    error.value = parse(failure).message
  }
  dialog.value.showModal()
  // The heading rather than the first switch: a screen reader starts with what this is about.
  heading.value?.focus()
}

function all() {
  for (const friend of friends.value) friend.shown = true
}

async function save() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    const chosen = friends.value.filter(friend => friend.shown).map(friend => friend.id)
    await $fetch<unknown>(`/api/lists/${props.token}/friends`, { method: 'PUT', body: { friends: chosen } })
    dialog.value?.close()
    emit('saved', chosen.length)
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
  <dialog ref="dialog" class="dialog friends-dialog" :aria-labelledby="`${id}-title`" :aria-describedby="`${id}-note`">
    <h2 :id="`${id}-title`" ref="heading" tabindex="-1">{{ t('list.friendsTitle', { title }) }}</h2>
    <p v-if="error" class="form-message" role="alert">{{ error }}</p>
    <template v-if="friends.length">
      <fieldset class="friend-shows">
        <legend class="visually-hidden">{{ t('list.friends') }}</legend>
        <label v-for="friend in friends" :key="friend.id" class="switch">
          <input v-model="friend.shown" type="checkbox">
          {{ friend.name }}
        </label>
      </fieldset>
      <art-button variant="quiet" size="s">
        <button type="button" @click="all">{{ t('list.friendsAll') }}</button>
      </art-button>
    </template>
    <p v-else-if="!error">
      {{ t('list.friendsNone') }}
      <NuxtLink :to="localePath('/friends')">{{ t('friends.toFriends') }}</NuxtLink>
    </p>
    <p :id="`${id}-note`" class="switch-hint">{{ t('list.friendsNote') }}</p>
    <div class="actions">
      <art-button variant="secondary">
        <button type="button" @click="dialog?.close()">{{ t('list.deleteCancel') }}</button>
      </art-button>
      <art-button v-if="friends.length">
        <button type="button" :aria-disabled="busy || undefined" @click="save">{{ t('list.friendsSave') }}</button>
      </art-button>
    </div>
  </dialog>
</template>
