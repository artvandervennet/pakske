<script setup lang="ts">
// The last row of a list: a + that turns into the new row itself. At rest it is a button that
// looks like a row; activated, the row's title is a field with the cursor in it. Enter adds and
// opens the next new row, so several can be typed one after another. Escape, or leaving the
// row empty, brings the + back; leaving it with text adds.
//
// The parent does the request and passes `pending` while it runs, and `error` when it failed.
// The text stays until the request worked, so a failure loses nothing.
const props = defineProps<{
  /** What the + says at rest: "Voeg iets toe". */
  label: string
  /** The field's name and placeholder: "Nieuwe wens". */
  fieldLabel: string
  pending?: boolean
  error?: string
}>()
const emit = defineEmits<{ add: [title: string] }>()

const id = useId()
const errorId = `${id}-error`
const title = ref('')
const open = ref(false)
const input = useTemplateRef<HTMLInputElement>('input')
const plus = useTemplateRef<HTMLButtonElement>('plus')
// Set from the moment the title is handed over until the parent's request is done. The
// parent's `pending` only arrives with the next render, and a fast second Enter can come
// before that.
const sent = ref(false)
const busy = computed(() => props.pending || sent.value)
// A failure the person walked away from (Escape) isn't shown again when the + opens next time.
const dismissed = ref(false)
const shownError = computed(() => (dismissed.value ? '' : props.error))

async function start() {
  open.value = true
  await nextTick()
  input.value?.focus()
  // On a phone the keyboard covers the lower half of the screen.
  input.value?.scrollIntoView({ block: 'center' })
}

async function close(refocus: boolean) {
  open.value = false
  title.value = ''
  dismissed.value = true
  if (!refocus) return
  await nextTick()
  plus.value?.focus()
}

function onKeydown(event: KeyboardEvent) {
  // With an input method (Japanese, Chinese, Korean) Enter and Escape act on the characters
  // being composed. Safari reports that Enter with keyCode 229 instead of isComposing.
  if (event.isComposing || event.keyCode === 229) return
  if (event.key === 'Escape') {
    event.preventDefault()
    if (!busy.value) close(true)
  }
  else if (event.key === 'Enter') {
    event.preventDefault()
    add()
  }
}

function onBlur() {
  if (busy.value) return
  if (title.value.trim()) add()
  else close(false)
}

async function add() {
  if (busy.value) return
  const value = title.value.trim()
  if (!value) return
  sent.value = true
  dismissed.value = false
  emit('add', value)
  await nextTick()
  // A parent that answered at once, without ever being pending, is done already.
  if (!props.pending) finish()
}

watch(() => props.pending, (pending) => {
  if (!pending && sent.value) finish()
})

function finish() {
  sent.value = false
  if (props.error) return
  // Still in the field (Enter): ready for the next one. Left it: the + comes back.
  if (document.activeElement === input.value) title.value = ''
  else close(false)
}
</script>

<template>
  <div class="quick-add">
    <button v-if="!open" ref="plus" type="button" class="quick-add-start" @click="start">
      <span class="quick-add-plus" aria-hidden="true">+</span>
      <span class="quick-add-label">{{ label }}</span>
    </button>
    <template v-else>
      <span class="quick-add-plus" aria-hidden="true">+</span>
      <label :for="id" class="visually-hidden">{{ fieldLabel }}</label>
      <input
        :id="id"
        ref="input"
        v-model="title"
        type="text"
        autocomplete="off"
        enterkeyhint="done"
        :placeholder="fieldLabel"
        :readonly="busy || undefined"
        :aria-busy="busy || undefined"
        :aria-invalid="shownError ? 'true' : undefined"
        :aria-describedby="shownError ? errorId : undefined"
        @keydown="onKeydown"
        @blur="onBlur"
      >
      <p v-if="shownError" :id="errorId" class="quick-add-error" role="alert">{{ shownError }}</p>
    </template>
  </div>
</template>
