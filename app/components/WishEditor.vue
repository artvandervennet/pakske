<script setup lang="ts">
import type { OwnerWish } from '#shared/schemas/list'
import type { WishSave } from '~/composables/useWishSave'

// An owner's unfolded row: the wish itself, each part editable where it is read, each saving
// by itself (the title is in the row's head, in WishRow). There is nothing to submit or cancel.
// The editor only has the owner's view of the wish, so nothing in it can depend on buyers:
// taking it off, deleting and unlinking go the same way whatever they did.
// `canRemove`: the wish is on the viewer's own list, so they can take it off. On someone else's
// list they can still edit it and unlink the owners who came after them.
const props = defineProps<{ wish: OwnerWish, saving: WishSave, canRemove: boolean }>()
const emit = defineEmits<{ changed: [] }>()

const { t } = useI18n()
const { parse } = useApiError()
// Several rows can be open at once; every id here is its own.
const id = useId()

const saveDescription = (text: string, saved: string) => props.saving.save(fieldChange('description', text, saved))

// Taking the wish off this list deletes it unless another list shows it too. The button and
// its question say which of the two will happen.
const removeWords = computed(() => props.wish.alsoElsewhere
  ? { action: t('wish.removeFromList'), title: t('wish.removeTitle', { title: props.wish.title }), body: t('wish.removeBody'), confirm: t('wish.removeConfirm') }
  : { action: t('wish.delete'), title: t('wish.deleteTitle', { title: props.wish.title }), body: t('wish.deleteBody'), confirm: t('wish.deleteConfirm') })

// One request at a time: taking off and unlinking both stay unavailable while either runs.
const busy = ref(false)
const actionError = ref('')

// Each asks first, in a native dialog with the safe button focused.
const removeDialog = useTemplateRef<HTMLDialogElement>('removeDialog')
const unlinkDialog = useTemplateRef<HTMLDialogElement>('unlinkDialog')
const unlinking = ref<{ id: number, name: string } | null>(null)

function askToRemove() {
  if (!busy.value) removeDialog.value?.showModal()
}

async function askToUnlink(owner: { id: number, name: string }) {
  if (busy.value) return
  unlinking.value = owner
  // The question names the person; let it render first.
  await nextTick()
  unlinkDialog.value?.showModal()
}

/** The dialog's answer. Escape sets none, and browsers differ on whether it clears the last one. */
function answer(dialog: HTMLDialogElement | null): string {
  const choice = dialog?.returnValue ?? ''
  if (dialog) dialog.returnValue = ''
  return choice
}

async function run(request: () => Promise<unknown>) {
  busy.value = true
  actionError.value = ''
  try {
    await request()
    emit('changed')
  }
  catch (error) {
    actionError.value = parse(error).message
  }
  finally {
    busy.value = false
  }
}

function onRemoveClose() {
  if (answer(removeDialog.value) !== 'remove' || busy.value) return
  run(() => $fetch<unknown>(props.saving.url(), { method: 'DELETE' }))
}

function onUnlinkClose() {
  const owner = unlinking.value
  if (answer(unlinkDialog.value) !== 'unlink' || busy.value || !owner) return
  run(() => $fetch<unknown>(`${props.saving.url()}/owners/${owner.id}`, { method: 'DELETE' }))
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
      <art-button v-if="canRemove" variant="quiet" size="s">
        <button type="button" :aria-disabled="busy || undefined" @click="askToRemove">{{ removeWords.action }}</button>
      </art-button>
      <!-- Always there, so the words are announced when they appear. -->
      <p class="wish-saved" role="status">{{ saving.saved.value ? t('edit.saved') : '' }}</p>
    </div>

    <template v-if="wish.coOwners.length">
      <h3 :id="`${id}-owners`" class="wish-subtitle">{{ t('joint.sharedWith') }}</h3>
      <ul class="people co-owners" :aria-labelledby="`${id}-owners`">
        <li v-for="owner in wish.coOwners" :key="owner.id">
          <span :id="`${id}-owner-${owner.id}`" class="co-owner-name">{{ owner.name }}</span>
          <art-button v-if="owner.canUnlink" variant="quiet" size="s">
            <button type="button" :aria-describedby="`${id}-owner-${owner.id}`" :aria-disabled="busy || undefined" @click="askToUnlink(owner)">{{ t('unlink.action') }}</button>
          </art-button>
        </li>
      </ul>
    </template>
    <p v-if="actionError" class="form-message" role="alert">{{ actionError }}</p>

    <dialog v-if="canRemove" ref="removeDialog" class="dialog" :aria-labelledby="`${id}-remove-title`" :aria-describedby="`${id}-remove-text`" @close="onRemoveClose">
      <h2 :id="`${id}-remove-title`">{{ removeWords.title }}</h2>
      <p :id="`${id}-remove-text`">{{ removeWords.body }}</p>
      <form method="dialog" class="actions">
        <art-button variant="secondary">
          <button value="cancel" autofocus>{{ t('wish.cancel') }}</button>
        </art-button>
        <art-button>
          <button value="remove">{{ removeWords.confirm }}</button>
        </art-button>
      </form>
    </dialog>

    <dialog v-if="wish.coOwners.length" ref="unlinkDialog" class="dialog" :aria-labelledby="`${id}-unlink-title`" :aria-describedby="`${id}-unlink-text`" @close="onUnlinkClose">
      <h2 :id="`${id}-unlink-title`">{{ t('unlink.title', { name: unlinking?.name ?? '', title: wish.title }) }}</h2>
      <p :id="`${id}-unlink-text`">{{ t('unlink.body', { name: unlinking?.name ?? '' }) }}</p>
      <form method="dialog" class="actions">
        <art-button variant="secondary">
          <button value="cancel" autofocus>{{ t('wish.cancel') }}</button>
        </art-button>
        <art-button>
          <button value="unlink">{{ t('unlink.confirm') }}</button>
        </art-button>
      </form>
    </dialog>
  </div>
</template>
