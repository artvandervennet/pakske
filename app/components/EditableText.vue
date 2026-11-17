<script setup lang="ts">
// Text that is edited where it is read: a real field, styled as the text it holds (see
// .inline-edit in app.css). It saves by itself when it is left or Enter is pressed, and
// Escape puts the saved text back. A failed save keeps what was typed, with the reason beside
// it. While the field has the focus, or holds a failed save, a refreshed `value` doesn't
// overwrite it.
//
//   line  a title: Enter saves; it wraps like the title it replaces, but stays one line
//   text  a description: Enter makes a new line; Ctrl or Cmd+Enter saves
//   url   a link
const props = withDefaults(defineProps<{
  /** The saved text. */
  value: string
  /** The field's name for screen readers; it has no visible label. */
  label: string
  /** Sends the text; answers null when it was saved (or nothing changed), or the reason it wasn't. */
  save: (text: string) => Promise<string | null>
  kind?: 'line' | 'text' | 'url'
  placeholder?: string
  maxlength?: number
}>(), { kind: 'line', placeholder: undefined, maxlength: undefined })

// After a save that worked or changed nothing, and after Escape; not after a failed save.
const emit = defineEmits<{ done: [how: 'enter' | 'escape' | 'blur'] }>()

const id = useId()
const errorId = `${id}-error`
const field = useTemplateRef<HTMLInputElement | HTMLTextAreaElement>('field')

const draft = ref(props.value)
const error = ref('')
const focused = ref(false)
const saving = ref(false)

watch(() => props.value, (value) => {
  if (followsSaved({ focused: focused.value, saving: saving.value, failed: !!error.value })) draft.value = value
})

// A title typed or pasted over several lines is one line.
function onInput() {
  if (props.kind === 'line' && /[\r\n]/.test(draft.value)) draft.value = oneLine(draft.value)
}

function onKeydown(event: KeyboardEvent) {
  // With an input method (Japanese, Chinese, Korean), Enter and Escape act on the characters
  // being composed. Safari reports that Enter with keyCode 229 instead of isComposing.
  if (event.isComposing || event.keyCode === 229) return
  if (event.key === 'Escape') {
    event.preventDefault()
    draft.value = props.value
    error.value = ''
    emit('done', 'escape')
  }
  else if (event.key === 'Enter') {
    const saves = props.kind !== 'text' || event.ctrlKey || event.metaKey
    if (!saves) return
    event.preventDefault()
    commit('enter')
  }
}

// A second commit while the first is on its way (Enter, then leaving the field) waits for it,
// then sends again only if the text changed meanwhile.
let sent: string | null = null
let again: 'enter' | 'blur' | null = null

async function commit(how: 'enter' | 'blur') {
  if (saving.value) {
    again = how
    return
  }
  saving.value = true
  sent = draft.value
  const reason = await props.save(sent)
  saving.value = false
  error.value = reason ?? ''
  if (again && draft.value !== sent) {
    const next = again
    again = null
    return commit(next)
  }
  again = null
  if (reason) return
  // Saved, and nobody is typing in it any more: show what the list holds now.
  if (!focused.value) draft.value = props.value
  emit('done', how)
}

// A field that goes away while it has the focus (the link turning back into a link after
// Enter) loses the focus on the way out; that is not someone leaving it with a change.
let leaving = false
onBeforeUnmount(() => {
  leaving = true
})

function onBlur() {
  focused.value = false
  if (leaving) return
  // Leaving a field whose save just failed, unchanged, would only fail again.
  if (error.value && draft.value === sent) return
  commit('blur')
}

defineExpose({
  focus: (select = false) => {
    field.value?.focus()
    if (select) field.value?.select()
  },
})
</script>

<template>
  <div class="inline-field">
    <div class="inline-field-line">
      <label :for="id" class="visually-hidden">{{ label }}</label>
      <input
        v-if="kind === 'url'"
        :id="id"
        ref="field"
        v-model="draft"
        class="inline-edit"
        type="url"
        inputmode="url"
        autocomplete="off"
        autocapitalize="none"
        autocorrect="off"
        spellcheck="false"
        enterkeyhint="done"
        :placeholder="placeholder"
        :maxlength="maxlength"
        :aria-invalid="error ? 'true' : undefined"
        :aria-describedby="error ? errorId : undefined"
        :aria-busy="saving || undefined"
        @focus="focused = true"
        @blur="onBlur"
        @keydown="onKeydown"
      >
      <textarea
        v-else
        :id="id"
        ref="field"
        v-model="draft"
        class="inline-edit"
        :class="kind"
        rows="1"
        autocomplete="off"
        :enterkeyhint="kind === 'line' ? 'done' : 'enter'"
        :placeholder="placeholder"
        :maxlength="maxlength"
        :aria-invalid="error ? 'true' : undefined"
        :aria-describedby="error ? errorId : undefined"
        :aria-busy="saving || undefined"
        @focus="focused = true"
        @blur="onBlur"
        @keydown="onKeydown"
        @input="onInput"
      />
      <slot />
    </div>
    <p v-if="error" :id="errorId" class="inline-field-error" role="alert">{{ error }}</p>
  </div>
</template>
