<script setup lang="ts">
// A password field with a button to show what was typed.
defineProps<{
  id: string
  label: string
  autocomplete: 'current-password' | 'new-password'
  hint?: string
  error?: string
  minlength?: number
}>()
const model = defineModel<string>({ required: true })
const { t } = useI18n()
const shown = ref(false)
</script>

<template>
  <FormField :id="id" v-slot="field" :label="label" :hint="hint" :error="error">
    <div class="field-row">
      <input
        :id="id"
        v-model="model"
        :name="id"
        :type="shown ? 'text' : 'password'"
        :autocomplete="autocomplete"
        :minlength="minlength"
        maxlength="128"
        required
        autocapitalize="none"
        spellcheck="false"
        :aria-describedby="field.describedBy"
        :aria-invalid="field.invalid"
      >
      <art-button variant="quiet" size="s">
        <button type="button" :aria-pressed="shown" @click="shown = !shown">{{ t('auth.showPassword') }}</button>
      </art-button>
    </div>
  </FormField>
</template>
