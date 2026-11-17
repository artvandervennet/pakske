<script setup lang="ts">
import type { OwnerWish, PublicWish } from '#shared/schemas/list'

// An owner's unfolded row: the wish as a form. Saving sends the words first and the picture
// after; if the picture fails, the words are kept and saving again tries the picture again.
// The editor only has the owner's view of the wish, so nothing in it can depend on buyers:
// lowering the amount or deleting goes the same way whatever they did.
const props = defineProps<{ wish: OwnerWish, token: string }>()
// `busy` while saving or deleting, so the row doesn't fold and take the editor away before it
// can report `changed`.
const emit = defineEmits<{ changed: [], closed: [], busy: [busy: boolean] }>()

const { t } = useI18n()
const { parse } = useApiError()
// Several rows can be open at once; every id in the form is its own.
const id = useId()

const title = ref(props.wish.title)
const description = ref(props.wish.description ?? '')
const url = ref(props.wish.url ?? '')
const unlimited = ref(props.wish.quantity === null)
const quantity = ref(props.wish.quantity ?? 1)
const image = ref<Blob | null | undefined>(undefined)

const wishUrl = computed(() => `/api/lists/${props.token}/wishes/${props.wish.id}`)
const imageMessage = ref('')

const { form, pending, message, errors, run } = useForm(async () => {
  imageMessage.value = ''
  await $fetch<PublicWish>(wishUrl.value, {
    method: 'PATCH',
    body: {
      title: title.value,
      description: description.value,
      url: url.value,
      quantity: unlimited.value ? null : Number(quantity.value),
    },
  })
  try {
    if (image.value) {
      const data = new FormData()
      data.append('image', image.value, 'image.jpg')
      await $fetch(`${wishUrl.value}/image`, { method: 'PUT', body: data })
    }
    else if (image.value === null && props.wish.image) {
      await $fetch(`${wishUrl.value}/image`, { method: 'DELETE' })
    }
  }
  catch (error) {
    // The words are saved; the row shows them while the form stays open to try the picture again.
    imageMessage.value = `${t('form.imageNotSaved')} ${parse(error).message}`
    emit('changed')
    return
  }
  emit('changed')
  emit('closed')
})

const shownMessage = computed(() => message.value || imageMessage.value)

// Closing mid-save would take the form away before a failed picture could say so.
function cancel() {
  if (!pending.value) emit('closed')
}

// Deleting asks first, in a native dialog with the safe button focused.
const dialog = useTemplateRef<HTMLDialogElement>('dialog')
const deleting = ref(false)

function askToDelete() {
  if (!deleting.value) dialog.value?.showModal()
}

async function onDialogClose() {
  // Escape sets no value, and browsers differ on whether it clears the last one: reset it.
  const choice = dialog.value?.returnValue
  if (dialog.value) dialog.value.returnValue = ''
  if (choice !== 'delete' || deleting.value) return
  deleting.value = true
  message.value = ''
  imageMessage.value = ''
  try {
    await $fetch(wishUrl.value, { method: 'DELETE' })
    emit('changed')
  }
  catch (error) {
    message.value = parse(error).message
  }
  finally {
    deleting.value = false
  }
}

watch(() => pending.value || deleting.value, busy => emit('busy', busy))
</script>

<template>
  <div class="wish-details-body">
    <form ref="form" class="form" method="post" novalidate :aria-label="t('form.editTitle', { title: wish.title })" @submit.prevent="run">
      <p v-if="shownMessage" class="form-message" role="alert">{{ shownMessage }}</p>

      <FormField :id="`${id}-title`" v-slot="field" :label="t('form.title')" :error="errors.title">
        <input
          :id="`${id}-title`"
          v-model="title"
          name="title"
          type="text"
          maxlength="120"
          required
          autocomplete="off"
          enterkeyhint="next"
          :aria-describedby="field.describedBy"
          :aria-invalid="field.invalid"
        >
      </FormField>

      <FormField :id="`${id}-description`" v-slot="field" :label="t('form.description')" :hint="t('form.descriptionHint')" :error="errors.description">
        <textarea
          :id="`${id}-description`"
          v-model="description"
          name="description"
          rows="4"
          maxlength="2000"
          :aria-describedby="field.describedBy"
          :aria-invalid="field.invalid"
        />
      </FormField>

      <FormField :id="`${id}-url`" v-slot="field" :label="t('form.url')" :hint="t('form.urlHint')" :error="errors.url">
        <input
          :id="`${id}-url`"
          v-model="url"
          name="url"
          type="url"
          inputmode="url"
          maxlength="2000"
          placeholder="https://"
          autocomplete="off"
          autocapitalize="none"
          autocorrect="off"
          spellcheck="false"
          :aria-describedby="field.describedBy"
          :aria-invalid="field.invalid"
        >
      </FormField>

      <fieldset class="field">
        <legend>{{ t('form.amount') }}</legend>
        <div class="field inline">
          <input :id="`${id}-unlimited`" v-model="unlimited" type="checkbox" name="unlimited" :aria-describedby="`${id}-unlimited-hint`">
          <label :for="`${id}-unlimited`">{{ t('form.unlimited') }}</label>
        </div>
        <span :id="`${id}-unlimited-hint`" class="hint">{{ t('form.unlimitedHint') }}</span>
        <FormField v-if="!unlimited" :id="`${id}-quantity`" v-slot="field" :label="t('form.howMany')" :error="errors.quantity">
          <input
            :id="`${id}-quantity`"
            v-model.number="quantity"
            name="quantity"
            type="number"
            inputmode="numeric"
            min="1"
            max="999"
            step="1"
            required
            :aria-describedby="field.describedBy"
            :aria-invalid="field.invalid"
          >
        </FormField>
      </fieldset>

      <ImagePicker v-model="image" :current="wish.image" />

      <!-- aria-disabled while busy rather than disabled: a disabled button drops the focus, and
           after saving it should go back to the row (WishRow), not to the start of the page. -->
      <div class="actions">
        <art-button>
          <button type="submit" :aria-disabled="pending || undefined">{{ pending ? t('form.saving') : t('form.save') }}</button>
        </art-button>
        <art-button variant="secondary">
          <button type="button" :aria-disabled="pending || undefined" @click="cancel">{{ t('form.cancel') }}</button>
        </art-button>
        <art-button variant="quiet">
          <button type="button" :aria-disabled="deleting || undefined" @click="askToDelete">{{ t('wish.delete') }}</button>
        </art-button>
      </div>
    </form>

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
