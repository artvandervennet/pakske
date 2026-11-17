<script setup lang="ts">
// A row to add something by typing its name and pressing Enter: a new list on the home page,
// a new wish on a list. The field empties and keeps the focus, ready for the next one.
const props = defineProps<{ label: string, pending?: boolean }>()
const emit = defineEmits<{ add: [title: string] }>()

const id = useId()
const title = ref('')

function onEnter(event: KeyboardEvent) {
  // Enter also stops the browser's own submit, which would send it a second time.
  event.preventDefault()
  // With an input method (Japanese, Chinese, Korean) Enter confirms the characters being
  // composed. Safari reports that Enter with keyCode 229 instead of isComposing.
  if (event.isComposing || event.keyCode === 229) return
  add()
}

function add() {
  // While the last one is still on its way the field is read-only, but a fast second Enter
  // can arrive before that shows; this keeps it from adding the same thing twice.
  if (props.pending) return
  const value = title.value.trim()
  if (!value) return
  emit('add', value)
  title.value = ''
}
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
      :readonly="pending || undefined"
      :aria-busy="pending || undefined"
      @keydown.enter="onEnter"
    >
  </form>
</template>
