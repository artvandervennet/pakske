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
  /**
   * Sends the text; `saved` is the field's last saved text, to compare with. Answers null
   * when it was saved (or nothing changed), or the reason it wasn't.
   */
  save: (text: string, saved: string) => Promise<string | null>
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
// The last saved text: the list's value, or what a save just sent until the list has it (also
// when the refresh after the save fails). Escape puts this back.
const saved = ref(props.value)
// What the field held when it got the focus (or was last saved): leaving it with this sends nothing.
const atFocus = ref(props.value)
// The text whose save failed, kept with its reason until it is changed or Escape is pressed.
const failedText = ref<string | null>(null)
const error = ref('')
const focused = ref(false)
const saving = ref(false)

watch(() => props.value, (value) => {
  saved.value = value
  if (followsSaved({ focused: focused.value, saving: saving.value, failed: failedText.value !== null })) {
    draft.value = atFocus.value = value
  }
})

function onFocus() {
  focused.value = true
  atFocus.value = draft.value
}

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
    // With a save on its way, the saved text is only known once it answers.
    if (saving.value) escapeAfterSave = true
    else restore()
  }
  else if (event.key === 'Enter') {
    const saves = props.kind !== 'text' || event.ctrlKey || event.metaKey
    if (!saves) return
    event.preventDefault()
    commit('enter')
  }
}

// Escape puts back the last saved text: after a save that worked, the text it saved.
function restore() {
  draft.value = atFocus.value = saved.value
  failedText.value = null
  error.value = ''
  emit('done', 'escape')
}

// A second commit while the first is on its way (Enter, then leaving the field) waits for it,
// then goes again if the text changed meanwhile. Escape meanwhile waits for it too.
let again: 'enter' | 'blur' | null = null
let escapeAfterSave = false

async function commit(how: 'enter' | 'blur') {
  if (saving.value) {
    again = how
    return
  }
  const action = commitAction({ draft: draft.value, atFocus: atFocus.value, failedText: failedText.value }, how)
  if (action === 'keep') return
  if (action === 'adopt') {
    draft.value = atFocus.value = saved.value
    emit('done', how)
    return
  }
  saving.value = true
  const sent = draft.value
  const reason = await props.save(sent, saved.value)
  saving.value = false
  // Typed while the save was on its way: that text stays, and goes out next.
  const changedMeanwhile = draft.value !== sent
  if (reason) {
    failedText.value = sent
    error.value = reason
  }
  else {
    failedText.value = null
    error.value = ''
    saved.value = cleanText(sent, props.kind)
    if (!changedMeanwhile) {
      atFocus.value = sent
      // Left: the field shows what was saved, as the server keeps it.
      if (!focused.value) draft.value = atFocus.value = saved.value
    }
  }
  const next = again
  again = null
  if (escapeAfterSave) {
    escapeAfterSave = false
    return restore()
  }
  if (next && changedMeanwhile) return commit(next)
  if (!reason) emit('done', how)
}

// A field that goes away while it has the focus (the link turning back into a link after
// Enter) loses the focus on the way out; that is not someone leaving it with a change.
let leaving = false
onBeforeUnmount(() => {
  leaving = true
})

function onBlur() {
  focused.value = false
  if (!leaving) commit('blur')
}

// A tap beside the field, within its own area (a title's is taller than its text), puts the
// cursor in it.
function onAreaClick(event: MouseEvent) {
  if (event.target === event.currentTarget || (event.target as Element).classList.contains('inline-field-line')) field.value?.focus()
}

defineExpose({
  focus: (select = false) => {
    field.value?.focus()
    if (select) field.value?.select()
  },
})
</script>

<template>
  <div class="inline-field" @click="onAreaClick">
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
        @focus="onFocus"
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
        @focus="onFocus"
        @blur="onBlur"
        @keydown="onKeydown"
        @input="onInput"
      />
      <slot />
    </div>
    <p v-if="error" :id="errorId" class="inline-field-error" role="alert">{{ error }}</p>
  </div>
</template>
