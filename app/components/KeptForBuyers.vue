<script setup lang="ts">
// In every question that deletes wishes or a list: what whoever ticked something there still
// sees, why, and the choice to skip that wait. It says the same whether or not anyone ticked
// anything, so the owner learns nothing from it.
const clear = defineModel<boolean>({ required: true })
defineProps<{ several?: boolean }>()

const { t } = useI18n()
const id = useId()
</script>

<template>
  <div class="kept">
    <p>{{ t(several ? 'kept.whySeveral' : 'kept.why', { days: KEPT_FOR_BUYERS_DAYS }) }}</p>
    <div class="switch-field">
      <label class="switch">
        <input v-model="clear" type="checkbox" role="switch" :aria-describedby="`${id}-hint`">
        {{ t('kept.clear') }}
      </label>
      <p :id="`${id}-hint`" class="switch-hint">{{ t('kept.clearHint') }}</p>
    </div>
  </div>
</template>
