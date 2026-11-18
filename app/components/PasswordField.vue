<script setup lang="ts">
// A password field with Gesso's eye at its end, which shows what was typed (<art-password>).
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
</script>

<template>
  <FormField :id="id" :label="label" :hint="hint" :error="error">
    <template #default="field">
      <art-password :label="t('auth.showPassword')">
        <input
          :id="id"
          v-model="model"
          :name="id"
          type="password"
          :autocomplete="autocomplete"
          :minlength="minlength"
          maxlength="128"
          required
          autocapitalize="none"
          spellcheck="false"
          :aria-describedby="field.describedBy"
          :aria-invalid="field.invalid"
        >
      </art-password>
    </template>
  </FormField>
</template>
