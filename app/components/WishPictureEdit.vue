<script setup lang="ts">
import type { OwnerWish } from '#shared/schemas/list'
import type { WishSave } from '~/composables/useWishSave'

// The photo in an owner's card is its own control: a square tile that opens the file chooser,
// and the chosen photo is made smaller in the browser and saved at once. Without a photo the
// tile is empty and invites to add one. A photo of the owner's own has a small "remove" on its
// corner. A picture the server took from the first link's shop says so on the tile ("van
// bol.com"), and under it is the way to put up a photo of one's own instead; it has no remove,
// since the cover would only come back. Under the tile, "Vergroten" shows the picture large.
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

// The tile itself chooses another photo, so showing this one large is a button of its own.
const viewPicture = usePictureViewer()
function enlarge() {
  if (shown.value) viewPicture?.({ src: shown.value, title: props.wish.title }, picture.value?.querySelector('img'))
}
</script>

<template>
  <div class="picture-edit">
    <div class="picture-edit-frame">
      <button
        ref="picture"
        type="button"
        class="picture-edit-choose"
        :class="{ empty: !shown }"
        :aria-busy="busy || undefined"
        :aria-describedby="error ? errorId : undefined"
        @click="choose"
      >
        <template v-if="shown">
          <img :src="shown" alt="">
          <span class="visually-hidden">{{ t('edit.pictureChange') }}</span>
        </template>
        <template v-else>
          <AppIcon name="image" />
          <span class="picture-edit-label">{{ t('edit.pictureAdd') }}</span>
        </template>
      </button>
      <span v-if="coverHost" class="picture-edit-source">{{ t('edit.pictureFromLink', { host: coverHost }) }}</span>
      <button
        v-if="shown && !coverHost"
        type="button"
        class="icon-button picture-edit-remove"
        :aria-label="t('edit.pictureRemove')"
        :title="t('edit.pictureRemove')"
        :aria-disabled="busy || undefined"
        @click="remove"
      >
        <AppIcon name="close" />
      </button>
    </div>
    <button v-if="coverHost" type="button" class="word-button" :aria-disabled="busy || undefined" @click="choose">
      <AppIcon name="image" />
      {{ t('edit.pictureOwn') }}
    </button>
    <button v-if="shown && viewPicture" type="button" class="word-button" @click="enlarge">
      <AppIcon name="expand" />
      {{ t('edit.pictureEnlarge') }}
    </button>
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
