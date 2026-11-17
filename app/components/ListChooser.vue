<script setup lang="ts">
import type { ListTarget } from '#shared/schemas/input'

// Which of the person's lists something goes on, chosen where it is asked: the list's name is
// a button that opens a short menu of their lists and "Een nieuwe lijst". A new list is named
// right there, in a field where the name was. The one used last is chosen to begin with, else
// the first, else a new list.
// The model is null while a new list has no name yet. `error` is for the new list's name.
const props = defineProps<{
  lists: { token: string, title: string }[]
  last: string | null
  legend: string
  error?: string
}>()
const model = defineModel<ListTarget | null>({ required: true })

const { t } = useI18n()
// Anchor names are CSS identifiers; an id may hold characters they can't.
const id = useId().replace(/[^\w-]/g, '-')
const menuId = `${id}-menu`
const errorId = `${id}-error`

const NEW = Symbol('new list')
const start = props.lists.some(list => list.token === props.last) ? props.last! : (props.lists[0]?.token ?? NEW)
const choice = ref<string | typeof NEW>(start)
const name = ref('')

const chosenTitle = computed(() =>
  choice.value === NEW ? t('add.newList') : (props.lists.find(list => list.token === choice.value)?.title ?? ''))

watchEffect(() => {
  if (choice.value !== NEW) model.value = { list: choice.value }
  else model.value = name.value.trim() ? { newList: name.value.trim() } : null
})

const menu = useTemplateRef<HTMLElement>('menu')
const trigger = useTemplateRef<HTMLButtonElement>('trigger')
const field = useTemplateRef<HTMLInputElement>('field')

// Opened with the keyboard, the menu takes the focus to the chosen list; opened with a pointer,
// it leaves the focus where it was. A click from the keyboard has no click count.
let fromKeyboard = false
function onTriggerClick(event: MouseEvent) {
  fromKeyboard = event.detail === 0
}
function onToggle(event: Event) {
  if ((event as ToggleEvent).newState !== 'open' || !fromKeyboard) return
  menu.value?.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus()
}

async function pick(next: string | typeof NEW) {
  choice.value = next
  // The menu goes; the focus goes back to its button, or on to the name a new list needs.
  trigger.value?.focus()
  menu.value?.hidePopover()
  if (next === NEW) {
    await nextTick()
    field.value?.focus()
  }
}

/** Puts the focus where the choice is made: the new list's name, or the menu's button. */
function focus() {
  ;(field.value ?? trigger.value)?.focus()
}
defineExpose({ focus })
</script>

<template>
  <div class="list-chooser" role="group" :aria-labelledby="`${id}-legend`">
    <span :id="`${id}-legend`" class="list-chooser-legend">{{ legend }}</span>
    <template v-if="lists.length">
      <button
        ref="trigger"
        type="button"
        class="list-chooser-pick"
        :popovertarget="menuId"
        :style="{ anchorName: `--${id}` }"
        @click="onTriggerClick"
      >
        {{ chosenTitle }}<span class="list-chooser-chevron" aria-hidden="true" />
      </button>
      <div :id="menuId" ref="menu" class="menu anchored" popover :style="{ positionAnchor: `--${id}` }" @toggle="onToggle">
        <button v-for="list in lists" :key="list.token" type="button" :aria-pressed="choice === list.token ? 'true' : 'false'" @click="pick(list.token)">
          {{ list.title }}
        </button>
        <hr>
        <button type="button" :aria-pressed="choice === NEW ? 'true' : 'false'" @click="pick(NEW)">{{ t('add.newList') }}</button>
      </div>
    </template>
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
  </div>
</template>
