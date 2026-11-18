<script setup lang="ts">
import type { ListTarget } from '#shared/schemas/input'

// Which of the person's lists something goes on: every list of theirs is a choice on view, so
// picking one is a single tap, and the last choice, "Een nieuwe lijst", opens a field for its
// name. The one used last is chosen to begin with, else the first, else a new list.
// The model is null while a new list has no name yet. `error` is for the new list's name.
const props = defineProps<{
  lists: { token: string, title: string }[]
  last: string | null
  legend: string
  error?: string
}>()
const model = defineModel<ListTarget | null>({ required: true })

const { t } = useI18n()
const id = useId()
const errorId = `${id}-error`
const NEW = '' // no list token is empty

const start = props.lists.some(list => list.token === props.last) ? props.last! : (props.lists[0]?.token ?? NEW)
const choice = ref<string>(start)
const name = ref('')

watchEffect(() => {
  if (choice.value !== NEW) model.value = { list: choice.value }
  else model.value = name.value.trim() ? { newList: name.value.trim() } : null
})

const group = useTemplateRef<HTMLElement>('group')
const field = useTemplateRef<HTMLInputElement>('field')

// Choosing a new list takes the focus on to the name it needs.
async function pickNew() {
  await nextTick()
  field.value?.focus()
}

/** Puts the focus where the choice is made: the new list's name, or the chosen list. */
function focus() {
  ;(field.value ?? group.value?.querySelector<HTMLInputElement>('input:checked'))?.focus()
}
defineExpose({ focus })
</script>

<template>
  <fieldset ref="group" class="list-chooser">
    <legend class="list-chooser-legend">{{ legend }}</legend>
    <div v-if="lists.length" class="list-chooser-options">
      <label v-for="list in lists" :key="list.token" class="list-chooser-option">
        <input v-model="choice" type="radio" :name="id" :value="list.token">
        <span>{{ list.title }}</span>
      </label>
      <label class="list-chooser-option list-chooser-new">
        <input v-model="choice" type="radio" :name="id" :value="NEW" @change="pickNew">
        <span>{{ t('add.newList') }}</span>
      </label>
    </div>
    <input
      v-if="choice === NEW"
      ref="field"
      v-model="name"
      type="text"
      class="inline-edit list-chooser-name"
      autocomplete="off"
      enterkeyhint="done"
      maxlength="80"
      :aria-label="t('add.newListName')"
      :placeholder="t('add.newListName')"
      :aria-invalid="error ? 'true' : undefined"
      :aria-describedby="error ? errorId : undefined"
    >
    <p v-if="error" :id="errorId" class="inline-field-error">{{ error }}</p>
  </fieldset>
</template>
