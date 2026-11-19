<script setup lang="ts">
import type { OwnerWish } from '#shared/schemas/list'
import type { WishSave } from '~/composables/useWishSave'
import type { WishTickState } from '~/composables/useWishTick'

// The body of an owner's opened card: the wish itself, each part editable where it is read and
// saving by itself (the title is in the card's head, in WishRow). There is nothing to submit or
// cancel. Three columns on a wide screen: the photo, the description with the amount, and the
// links; one under the other on a phone. Under them, what the owner has of it themselves, and
// who else the wish belongs to.
// Sharing is the button in the card's head. Deleting is a quiet button at the card's end, which
// asks first, so it can't be pressed by mistake for "save"; edit mode deletes several at once.
// `canDelete` is false on a list the viewer doesn't own: a wish comes off one's own list only.
// The editor only has the owner's view of the wish, so nothing in it can depend on buyers:
// unlinking goes the same way whatever they did.
// `tick` is the row's own tick (useWishTick), shown here with its full stepper.
const props = defineProps<{ wish: OwnerWish, saving: WishSave, tick: WishTickState, canDelete: boolean }>()
const emit = defineEmits<{ changed: [], deleted: [] }>()

const { t } = useI18n()
const { parse } = useApiError()
// Several rows can be open at once; every id here is its own.
const id = useId()

const saveDescription = (text: string, saved: string) => props.saving.save(fieldChange('description', text, saved))

// One request at a time: unlinking and deleting stay unavailable while one runs.
const busy = ref(false)
const actionError = ref('')

// It asks first, in a native dialog with the safe button focused.
const unlinkDialog = useTemplateRef<HTMLDialogElement>('unlinkDialog')
const unlinking = ref<{ id: number, name: string } | null>(null)

async function askToUnlink(owner: { id: number, name: string }) {
  if (busy.value) return
  unlinking.value = owner
  // The question names the person; let it render first.
  await nextTick()
  unlinkDialog.value?.showModal()
}

async function onUnlinkClose() {
  const owner = unlinking.value
  const dialog = unlinkDialog.value
  // Escape sets no answer, and browsers differ on whether it clears the last one: reset it.
  const choice = dialog?.returnValue ?? ''
  if (dialog) dialog.returnValue = ''
  if (choice !== 'unlink' || busy.value || !owner) return
  busy.value = true
  actionError.value = ''
  try {
    await $fetch<unknown>(`${props.saving.url()}/owners/${owner.id}`, { method: 'DELETE' })
    emit('changed')
  }
  catch (error) {
    actionError.value = parse(error).message
  }
  finally {
    busy.value = false
  }
}

const deleteDialog = useTemplateRef<HTMLDialogElement>('deleteDialog')
// Off every time the question is asked: skipping the wait is a choice made per delete.
const clearForBuyers = ref(false)

function askToDelete() {
  if (busy.value) return
  clearForBuyers.value = false
  deleteDialog.value?.showModal()
}

async function onDeleteClose() {
  const dialog = deleteDialog.value
  const choice = dialog?.returnValue ?? ''
  if (dialog) dialog.returnValue = ''
  if (choice !== 'delete' || busy.value) return
  busy.value = true
  actionError.value = ''
  try {
    await $fetch<unknown>(props.saving.url(), { method: 'DELETE', body: { clearForBuyers: clearForBuyers.value } })
    emit('deleted')
  }
  catch (error) {
    actionError.value = parse(error).message
  }
  finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="wish-card-body owner">
    <WishPictureEdit :wish="wish" :saving="saving" />
    <div class="wish-card-column">
      <EditableText
        class="wish-text-edit"
        kind="text"
        show-label
        :value="savedText(wish, 'description')"
        :label="t('edit.description')"
        :placeholder="t('edit.descriptionEmpty')"
        :save="saveDescription"
        :maxlength="2000"
      />
      <WishAmountEdit :wish="wish" :saving="saving" />
    </div>
    <div class="wish-card-column">
      <WishLinkEdit :wish="wish" :saving="saving" />
    </div>
  </div>

  <div class="wish-card-foot">
    <WishGive :wish="wish" :tick="tick" />
    <!-- Always there, so the words are announced when they appear. -->
    <p class="wish-saved" role="status">{{ saving.saved.value ? t('edit.saved') : '' }}</p>
    <art-button v-if="canDelete" class="wish-delete danger" variant="quiet" size="s">
      <button type="button" :aria-disabled="busy || undefined" @click="askToDelete">{{ t('listEdit.delete') }}</button>
    </art-button>
  </div>

  <div v-if="wish.coOwners.length" class="wish-card-owners">
    <h4 :id="`${id}-owners`" class="wish-label">{{ t('joint.sharedWith') }}</h4>
    <ul class="people co-owners" :aria-labelledby="`${id}-owners`">
      <li v-for="owner in wish.coOwners" :key="owner.id">
        <span :id="`${id}-owner-${owner.id}`" class="co-owner-name">{{ owner.name }}</span>
        <art-button v-if="owner.canUnlink" variant="quiet" size="s">
          <button type="button" :aria-describedby="`${id}-owner-${owner.id}`" :aria-disabled="busy || undefined" @click="askToUnlink(owner)">{{ t('unlink.action') }}</button>
        </art-button>
      </li>
    </ul>
  </div>
  <p v-if="actionError" class="form-message wish-card-error" role="alert">{{ actionError }}</p>

  <dialog v-if="wish.coOwners.length" ref="unlinkDialog" class="dialog" :aria-labelledby="`${id}-unlink-title`" :aria-describedby="`${id}-unlink-text`" @close="onUnlinkClose">
    <h2 :id="`${id}-unlink-title`">{{ t('unlink.title', { name: unlinking?.name ?? '', title: wish.title }) }}</h2>
    <p :id="`${id}-unlink-text`">{{ t('unlink.body', { name: unlinking?.name ?? '' }) }}</p>
    <form method="dialog" class="actions">
      <art-button variant="secondary">
        <button value="cancel" autofocus>{{ t('unlink.cancel') }}</button>
      </art-button>
      <art-button>
        <button value="unlink">{{ t('unlink.confirm') }}</button>
      </art-button>
    </form>
  </dialog>

  <dialog v-if="canDelete" ref="deleteDialog" class="dialog" :aria-labelledby="`${id}-delete-title`" :aria-describedby="`${id}-delete-text`" @close="onDeleteClose">
    <h2 :id="`${id}-delete-title`">{{ t('wish.deleteTitle', { title: wish.title }) }}</h2>
    <p :id="`${id}-delete-text`">{{ wish.alsoElsewhere ? t('wish.deleteBodyElsewhere') : t('wish.deleteBody') }}</p>
    <KeptForBuyers v-model="clearForBuyers" />
    <form method="dialog" class="actions">
      <art-button variant="secondary">
        <button value="cancel" autofocus>{{ t('listEdit.deleteCancel') }}</button>
      </art-button>
      <art-button class="danger">
        <button value="delete">{{ t('listEdit.deleteConfirm') }}</button>
      </art-button>
    </form>
  </dialog>
</template>
