<script setup lang="ts">
// The profile picture in Settings: the picture as friends see it, a button that opens the file
// chooser, and one that takes the picture away again. The chosen photo is made small in the
// browser and saved at once. Without a photo of their own a person has the study in two
// paints that is drawn from their account, here as everywhere.
const props = defineProps<{ person: { id: number, picture: string | null } }>()
const emit = defineEmits<{ changed: [] }>()

const { t } = useI18n()
const { parse } = useApiError()
const id = useId()

const input = useTemplateRef<HTMLInputElement>('input')
const chooseButton = useTemplateRef<HTMLButtonElement>('chooseButton')
const busy = ref(false)
const error = ref('')
const status = ref('')
// The chosen picture, shown while it uploads and until the page has the saved one.
const preview = ref<string | null>(null)
const shown = computed(() => ({ id: props.person.id, picture: preview.value ?? props.person.picture }))

function setPreview(blob: Blob | null) {
  if (preview.value) URL.revokeObjectURL(preview.value)
  preview.value = blob ? URL.createObjectURL(blob) : null
}
watch(() => props.person.picture, () => setPreview(null))
onBeforeUnmount(() => setPreview(null))

async function onFile() {
  const file = input.value?.files?.[0]
  if (!file || busy.value) return
  busy.value = true
  error.value = ''
  status.value = ''
  try {
    let small: Blob
    try {
      // A face in a circle of a few dozen pixels needs no more than this.
      small = await resizeImage(file, 512)
    }
    catch {
      error.value = t('errors.invalid_image')
      return
    }
    setPreview(small)
    const data = new FormData()
    data.append('image', small, 'image.jpg')
    await $fetch<unknown>('/api/me/image', { method: 'PUT', body: data })
    status.value = t('settings.pictureSaved')
    emit('changed')
  }
  catch (failure) {
    setPreview(null)
    error.value = parse(failure).message
  }
  finally {
    busy.value = false
    // Choosing the same file again should still count as a choice.
    if (input.value) input.value.value = ''
  }
}

async function remove() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  status.value = ''
  try {
    await $fetch<unknown>('/api/me/image', { method: 'DELETE' })
    status.value = t('settings.pictureRemoved')
    emit('changed')
    // The button goes with the picture; the focus goes to the one that stays.
    chooseButton.value?.focus()
  }
  catch (failure) {
    error.value = parse(failure).message
  }
  finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="profile-picture" role="group" :aria-labelledby="`${id}-label`">
    <PersonPicture :person="shown" />
    <div class="profile-picture-text">
      <p :id="`${id}-label`" class="wish-label">{{ t('settings.picture') }}</p>
      <p :id="`${id}-hint`" class="switch-hint">{{ t('settings.pictureHint') }}</p>
      <div class="actions">
        <art-button variant="secondary" size="s">
          <button ref="chooseButton" type="button" :aria-describedby="`${id}-hint`" :aria-disabled="busy || undefined" @click="!busy && input?.click()">
            {{ person.picture ? t('settings.pictureChange') : t('settings.pictureAdd') }}
          </button>
        </art-button>
        <art-button v-if="person.picture" variant="quiet" size="s">
          <button type="button" :aria-disabled="busy || undefined" @click="remove">{{ t('settings.pictureRemove') }}</button>
        </art-button>
      </div>
      <!-- The button above is the control; the browser's own file field stays out of sight and out of the tab order. -->
      <input ref="input" type="file" accept="image/*" class="visually-hidden" tabindex="-1" aria-hidden="true" @change="onFile">
      <p v-if="error" class="form-message" role="alert">{{ error }}</p>
      <p class="visually-hidden" role="status">{{ status }}</p>
    </div>
  </div>
</template>
