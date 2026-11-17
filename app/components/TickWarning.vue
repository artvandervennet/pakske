<script setup lang="ts">
// The warning an owner gets before ticking their own wish: going ahead may show them that
// someone already has it. One dialog serves every row on the page; ask() opens it and
// resolves when it closes. Cancel has the focus, so Enter or a stray tap changes nothing.
const { t } = useI18n()

const dialog = useTemplateRef<HTMLDialogElement>('dialog')
const title = ref('')
let answer: ((goOn: boolean) => void) | null = null

async function ask(wishTitle: string): Promise<boolean> {
  if (!dialog.value) return false
  answer?.(false)
  title.value = wishTitle
  // The heading names the wish; let it render first, so the dialog opens with the right name.
  await nextTick()
  dialog.value.showModal()
  return new Promise((resolve) => {
    answer = resolve
  })
}

function onClose() {
  // Escape sets no value, and browsers differ on whether it clears the last one: reset it.
  const choice = dialog.value?.returnValue
  if (dialog.value) dialog.value.returnValue = ''
  answer?.(choice === 'continue')
  answer = null
}

defineExpose({ ask })
</script>

<template>
  <dialog ref="dialog" class="dialog" aria-labelledby="tick-warning-title" aria-describedby="tick-warning-text" @close="onClose">
    <h2 id="tick-warning-title">{{ t('tick.warningTitle', { title }) }}</h2>
    <p id="tick-warning-text">{{ t('tick.warning') }}</p>
    <form method="dialog" class="actions">
      <art-button variant="secondary">
        <button value="cancel" autofocus>{{ t('tick.cancel') }}</button>
      </art-button>
      <art-button>
        <button value="continue">{{ t('tick.continue') }}</button>
      </art-button>
    </form>
  </dialog>
</template>
