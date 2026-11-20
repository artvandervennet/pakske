<script setup lang="ts">
// Which of the person's own lists goes into a Secret Santa group, for whoever draws their name.
// Every list is a choice on view, as where a wish is put on a list (ListChooser), and the last
// choice is none at all. The model is the list's address, or null for none.
defineProps<{ lists: { token: string, title: string }[], legend: string, hint?: string }>()
const model = defineModel<string | null>({ required: true })

const { t } = useI18n()
const id = useId()
const NONE = '' // no list token is empty
const choice = computed({
  get: () => model.value ?? NONE,
  set: value => (model.value = value === NONE ? null : value),
})
</script>

<template>
  <fieldset class="list-chooser" :aria-describedby="hint ? `${id}-hint` : undefined">
    <legend class="list-chooser-legend">{{ legend }}</legend>
    <div class="list-chooser-options">
      <label v-for="list in lists" :key="list.token" class="list-chooser-option">
        <input v-model="choice" type="radio" :name="id" :value="list.token">
        <span>{{ list.title }}</span>
      </label>
      <label class="list-chooser-option list-chooser-new">
        <input v-model="choice" type="radio" :name="id" :value="NONE">
        <span>{{ t('santa.noList') }}</span>
      </label>
    </div>
    <p v-if="hint" :id="`${id}-hint`" class="switch-hint">{{ hint }}</p>
  </fieldset>
</template>
