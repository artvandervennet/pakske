<script setup lang="ts">
// A row to add something by typing its name and pressing Enter: a new list on the home page,
// a new wish on a list. The parent does the request and passes `pending` while it runs, and
// `error` when it failed. The text stays until the request worked, so a failure loses nothing;
// then the field empties and keeps the focus, ready for the next one.
const props = defineProps<{ label: string, pending?: boolean, error?: string }>()
const emit = defineEmits<{ add: [title: string] }>()

const id = useId()
const title = ref('')
// Set from the moment the title is handed over until the parent's request is done. The
// parent's `pending` only arrives with the next render, and a fast second Enter can come
// before that.
const sent = ref(false)

function onEnter(event: KeyboardEvent) {
  // Enter also stops the browser's own submit, which would send it a second time.
  event.preventDefault()
  // With an input method (Japanese, Chinese, Korean) Enter confirms the characters being
  // composed. Safari reports that Enter with keyCode 229 instead of isComposing.
  if (event.isComposing || event.keyCode === 229) return
  add()
}

async function add() {
  if (props.pending || sent.value) return
  const value = title.value.trim()
  if (!value) return
  sent.value = true
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
  if (!props.error) title.value = ''
}

const busy = computed(() => props.pending || sent.value)
const errorId = computed(() => `${id}-error`)
</script>

<template>
  <form class="quick-add" @submit.prevent="add">
    <!-- The + is the field's label, so clicking it puts the cursor in the field. -->
    <label :for="id" class="quick-add-plus">
      <span aria-hidden="true">+</span>
      <span class="visually-hidden">{{ label }}</span>
    </label>
    <input
      :id="id"
      v-model="title"
      type="text"
      autocomplete="off"
      enterkeyhint="done"
      :placeholder="label"
      :readonly="busy || undefined"
      :aria-busy="busy || undefined"
      :aria-invalid="error ? 'true' : undefined"
      :aria-describedby="error ? errorId : undefined"
      @keydown.enter="onEnter"
    >
    <p v-if="error" :id="errorId" class="quick-add-error" role="alert">{{ error }}</p>
  </form>
</template>
