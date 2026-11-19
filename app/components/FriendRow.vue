<script setup lang="ts">
import type { FriendView } from '#shared/schemas/friends'

// One friend on the friends page: a line with the name and how much goes each way, which unfolds
// into the two things it counts. What this friend finds of the person's own lists is a switch per
// list, saved the moment it is flipped; the whole set is sent each time, so the server and the
// page can't drift apart. What the friend shows the person is a list of links.
// Removing the friend asks first. Nothing here tells the friend anything.
const props = defineProps<{ friend: FriendView }>()
const emit = defineEmits<{ changed: [], removed: [name: string] }>()

const { t } = useI18n()
const localePath = useLocalePath()
const { parse } = useApiError()
const id = useId()

const details = useTemplateRef<HTMLDetailsElement>('details')
const summary = useTemplateRef<HTMLElement>('summary')

/** Unfolds the row and puts the focus on its name: where someone lands who just became friends. */
function show() {
  if (details.value) details.value.open = true
  summary.value?.focus()
}
defineExpose({ show })

const ticksOf = (friend: FriendView) => new Set(friend.shows.filter(list => list.shown).map(list => list.token))
const ticked = ref(ticksOf(props.friend))
const saving = ref(false)
const saved = ref(false)
const error = ref('')
let savedTimer: ReturnType<typeof setTimeout> | undefined
// The page's fresh answer wins, except while a flip of this row is still on its way.
watch(() => props.friend, (friend) => {
  if (!saving.value) ticked.value = ticksOf(friend)
})
onBeforeUnmount(() => clearTimeout(savedTimer))

async function flip(token: string, on: boolean) {
  const before = new Set(ticked.value)
  const next = new Set(before)
  if (on) next.add(token)
  else next.delete(token)
  ticked.value = next
  saving.value = true
  saved.value = false
  error.value = ''
  try {
    await $fetch<unknown>(`/api/friends/${props.friend.id}/lists`, { method: 'PUT', body: { lists: [...next] } })
    saved.value = true
    clearTimeout(savedTimer)
    savedTimer = setTimeout(() => (saved.value = false), 3000)
    emit('changed')
  }
  catch (failure) {
    ticked.value = before
    error.value = parse(failure).message
  }
  finally {
    saving.value = false
  }
}

const shown = computed(() => ticked.value.size)
const counts = computed(() => `${t('friends.showsCount', { n: shown.value }, shown.value)} · ${t('friends.seesCount', { n: props.friend.sees.length }, props.friend.sees.length)}`)

// It asks first, in a native dialog with the safe button focused.
const removeDialog = useTemplateRef<HTMLDialogElement>('removeDialog')
const removing = ref(false)

async function onRemoveClose() {
  const dialog = removeDialog.value
  // Escape sets no answer, and browsers differ on whether it clears the last one: reset it.
  const choice = dialog?.returnValue ?? ''
  if (dialog) dialog.returnValue = ''
  if (choice !== 'remove' || removing.value) return
  removing.value = true
  error.value = ''
  try {
    await $fetch<unknown>(`/api/friends/${props.friend.id}`, { method: 'DELETE' })
    emit('removed', props.friend.name)
  }
  catch (failure) {
    error.value = parse(failure).message
  }
  finally {
    removing.value = false
  }
}
</script>

<template>
  <li :id="`friend-${friend.id}`" class="friend-item">
    <details ref="details" class="friend">
      <summary ref="summary">
        <span class="friend-name">{{ friend.name }}</span>
        <span class="row-meta">{{ counts }}</span>
      </summary>
      <div class="friend-body">
        <fieldset class="friend-shows">
          <legend class="wish-label">{{ t('friends.showsTitle', { name: friend.name }) }}</legend>
          <p v-if="!friend.shows.length" class="muted">{{ t('friends.showsNone') }}</p>
          <label v-for="list in friend.shows" :key="list.token" class="switch">
            <input
              type="checkbox"
              :checked="ticked.has(list.token)"
              :aria-describedby="`${id}-note`"
              @change="event => flip(list.token, (event.target as HTMLInputElement).checked)"
            >
            {{ list.title }}
          </label>
          <p :id="`${id}-note`" class="switch-hint">{{ t('friends.linkNote') }}</p>
          <!-- Always there, so the word is announced when it appears. -->
          <p class="friend-saved" role="status">{{ saved ? t('friends.saved') : '' }}</p>
          <p v-if="error" class="form-message" role="alert">{{ error }}</p>
        </fieldset>

        <div class="friend-sees">
          <h3 :id="`${id}-sees`" class="wish-label">{{ t('friends.seesTitle', { name: friend.name }) }}</h3>
          <ul v-if="friend.sees.length" class="people" :aria-labelledby="`${id}-sees`">
            <li v-for="list in friend.sees" :key="list.token">
              <NuxtLink :to="localePath(`/l/${list.token}`)">{{ list.title }}</NuxtLink>
            </li>
          </ul>
          <p v-else class="muted">{{ t('friends.seesNone', { name: friend.name }) }}</p>
        </div>

        <div class="actions">
          <art-button variant="quiet" size="s" class="danger">
            <button type="button" :aria-disabled="removing || undefined" @click="removeDialog?.showModal()">{{ t('friends.remove') }}</button>
          </art-button>
        </div>
      </div>
    </details>

    <dialog ref="removeDialog" class="dialog" :aria-labelledby="`${id}-remove-title`" :aria-describedby="`${id}-remove-text`" @close="onRemoveClose">
      <h2 :id="`${id}-remove-title`">{{ t('friends.removeTitle', { name: friend.name }) }}</h2>
      <p :id="`${id}-remove-text`">{{ t('friends.removeBody', { name: friend.name }) }}</p>
      <form method="dialog" class="actions">
        <art-button variant="secondary">
          <button value="cancel" autofocus>{{ t('friends.cancel') }}</button>
        </art-button>
        <art-button class="danger">
          <button value="remove">{{ t('friends.removeConfirm') }}</button>
        </art-button>
      </form>
    </dialog>
  </li>
</template>
