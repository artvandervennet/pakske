<script setup lang="ts">
import type { OwnerWish } from '#shared/schemas/list'
import type { WishSave } from '~/composables/useWishSave'

// The picture in an owner's row is its own control: activating it opens the file chooser, and
// the chosen picture is made smaller in the browser and saved at once. A small "Remove" sits
// on it. Without a picture, the row's painted study invites to add one. A picture the server
// took from the first link's shop says so under it, with a way to put up a photo of one's own.
const props = defineProps<{ wish: OwnerWish, saving: WishSave }>()

const { t } = useI18n()
const id = useId()
const errorId = `${id}-error`
const input = useTemplateRef<HTMLInputElement>('input')
const error = ref('')
// The chosen picture, shown while it uploads and until the refreshed list has it.
const preview = ref<string | null>(null)
const busy = ref(false)
const shown = computed(() => preview.value ?? props.wish.image)
const imageUrl = (): string => `${props.saving.url()}/image`
// The shop the picture came from, when it is the first link's cover and not the owner's photo.
const coverHost = computed(() => !preview.value && props.wish.image && props.wish.imageFromLink ? hostOf(props.wish.urls[0]) : null)

function setPreview(blob: Blob | null) {
  if (preview.value) URL.revokeObjectURL(preview.value)
  preview.value = blob ? URL.createObjectURL(blob) : null
}

watch(() => props.wish.image, () => setPreview(null))
onBeforeUnmount(() => setPreview(null))

function choose() {
  if (!busy.value) input.value?.click()
}

async function onFile() {
  const file = input.value?.files?.[0]
  if (!file) return
  error.value = ''
  busy.value = true
  try {
    let resized: Blob
    try {
      resized = await resizeImage(file)
    }
    catch {
      // The browser could not read the file as a picture.
      error.value = t('errors.invalid_image')
      return
    }
    setPreview(resized)
    const data = new FormData()
    data.append('image', resized, 'image.jpg')
    const reason = await props.saving.run(() => $fetch<unknown>(imageUrl(), { method: 'PUT', body: data }))
    if (reason) {
      error.value = reason
      setPreview(null)
    }
  }
  finally {
    busy.value = false
    // Choosing the same file again should still count as a choice.
    if (input.value) input.value.value = ''
  }
}

async function remove() {
  if (busy.value) return
  error.value = ''
  busy.value = true
  const reason = await props.saving.run(() => $fetch<unknown>(imageUrl(), { method: 'DELETE' }))
  busy.value = false
  if (reason) error.value = reason
  // The button goes with the picture; the focus goes to the picture's own control.
  else picture.value?.focus()
}

const picture = useTemplateRef<HTMLButtonElement>('picture')
</script>

<template>
  <div class="picture-edit">
    <div class="picture-edit-frame">
      <button
        ref="picture"
        type="button"
        class="picture-edit-choose"
        :aria-busy="busy || undefined"
        :aria-describedby="error ? errorId : undefined"
        @click="choose"
      >
        <img v-if="shown" :src="shown" alt="">
        <WishThumb v-else :wish="{ id: wish.id, image: null }" />
        <span :class="shown ? 'visually-hidden' : 'picture-edit-label'">{{ shown ? t('edit.pictureChange') : t('edit.pictureAdd') }}</span>
      </button>
      <art-button v-if="shown" size="s" class="picture-edit-remove">
        <button type="button" :aria-label="t('edit.pictureRemoveLabel')" :aria-disabled="busy || undefined" @click="remove">{{ t('edit.pictureRemove') }}</button>
      </art-button>
    </div>
    <div v-if="coverHost" class="picture-edit-source">
      <span>{{ t('edit.pictureFromLink', { host: coverHost }) }}</span>
      <art-button variant="quiet" size="s">
        <button type="button" :aria-disabled="busy || undefined" @click="choose">{{ t('edit.pictureAdd') }}</button>
      </art-button>
    </div>
    <input
      ref="input"
      type="file"
      accept="image/jpeg,image/png,image/webp"
      hidden
      @change="onFile"
    >
    <p v-if="error" :id="errorId" class="inline-field-error" role="alert">{{ error }}</p>
  </div>
</template>
