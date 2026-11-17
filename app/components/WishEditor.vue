<script setup lang="ts">
import type { OwnerWish } from '#shared/schemas/list'
import type { WishSave } from '~/composables/useWishSave'

// An owner's unfolded row: the wish itself, each part editable where it is read, each saving
// by itself (the title is in the row's head, in WishRow). There is nothing to submit or cancel.
// The editor only has the owner's view of the wish, so nothing in it can depend on buyers:
// lowering the amount or deleting goes the same way whatever they did.
const props = defineProps<{ wish: OwnerWish, saving: WishSave }>()
const emit = defineEmits<{ changed: [] }>()

const { t } = useI18n()
const { parse } = useApiError()
// Several rows can be open at once; every id here is its own.
const id = useId()

const saveDescription = (text: string, saved: string) => props.saving.save(fieldChange('description', text, saved))

// Deleting asks first, in a native dialog with the safe button focused.
const dialog = useTemplateRef<HTMLDialogElement>('dialog')
const deleting = ref(false)
const deleteError = ref('')

function askToDelete() {
  if (!deleting.value) dialog.value?.showModal()
}

async function onDialogClose() {
  // Escape sets no value, and browsers differ on whether it clears the last one: reset it.
  const choice = dialog.value?.returnValue
  if (dialog.value) dialog.value.returnValue = ''
  if (choice !== 'delete' || deleting.value) return
  deleting.value = true
  deleteError.value = ''
  try {
    await $fetch(props.saving.url(), { method: 'DELETE' })
    emit('changed')
  }
  catch (error) {
    deleteError.value = parse(error).message
  }
  finally {
    deleting.value = false
  }
}
</script>

<template>
  <div class="wish-details-body wish-edit">
    <EditableText
      class="wish-text-edit"
      kind="text"
      :value="savedText(wish, 'description')"
      :label="t('edit.description')"
      :placeholder="t('edit.descriptionEmpty')"
      :save="saveDescription"
      :maxlength="2000"
    />
    <WishLinkEdit :wish="wish" :saving="saving" />
    <WishAmountEdit :wish="wish" :saving="saving" />
    <WishPictureEdit :wish="wish" :saving="saving" />

    <div class="wish-edit-foot">
      <art-button variant="quiet" size="s">
        <button type="button" :aria-disabled="deleting || undefined" @click="askToDelete">{{ t('wish.delete') }}</button>
      </art-button>
      <!-- Always there, so the words are announced when they appear. -->
      <p class="wish-saved" role="status">{{ saving.saved.value ? t('edit.saved') : '' }}</p>
    </div>
    <p v-if="deleteError" class="form-message" role="alert">{{ deleteError }}</p>

    <dialog ref="dialog" class="dialog" :aria-labelledby="`${id}-delete-title`" :aria-describedby="`${id}-delete-text`" @close="onDialogClose">
      <h2 :id="`${id}-delete-title`">{{ t('wish.deleteTitle', { title: wish.title }) }}</h2>
      <p :id="`${id}-delete-text`">{{ t('wish.deleteBody') }}</p>
      <form method="dialog" class="actions">
        <art-button variant="secondary">
          <button value="cancel" autofocus>{{ t('wish.cancel') }}</button>
        </art-button>
        <art-button>
          <button value="delete">{{ t('wish.deleteConfirm') }}</button>
        </art-button>
      </form>
    </dialog>
  </div>
</template>
