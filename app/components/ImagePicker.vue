<script setup lang="ts">
// Chooses the picture of a wish. The picture is made smaller in the browser first; the parent
// gets the result and uploads it after the wish itself is saved.
//
// The model says what should happen to the picture on save:
//   undefined  leave it as it is
//   null       remove it
//   Blob       replace it with this one
const props = defineProps<{ current: string | null }>()
const model = defineModel<Blob | null | undefined>()
const { t } = useI18n()
// Several wishes can be open for editing at once, each with its own picker.
const id = useId()

const error = ref('')
const input = ref<HTMLInputElement>()
const previewUrl = ref<string | null>(null)

const shown = computed(() => {
  if (model.value === null) return null
  return previewUrl.value ?? props.current
})

function setPreview(blob: Blob | null) {
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
  previewUrl.value = blob ? URL.createObjectURL(blob) : null
}

async function choose(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  error.value = ''
  if (!file) return
  try {
    const resized = await resizeImage(file)
    setPreview(resized)
    model.value = resized
  }
  catch {
    // The browser could not read the file as a picture.
    error.value = t('errors.invalid_image')
    if (input.value) input.value.value = ''
  }
}

function remove() {
  setPreview(null)
  if (input.value) input.value.value = ''
  error.value = ''
  model.value = null
}

onBeforeUnmount(() => setPreview(null))
</script>

<template>
  <FormField :id="id" v-slot="field" :label="t('form.image')" :hint="t('form.imageHint')" :error="error">
    <div class="image-picker">
      <img v-if="shown" :src="shown" :alt="t('form.imageAlt')">
      <input
        :id="id"
        ref="input"
        type="file"
        name="image"
        accept="image/jpeg,image/png,image/webp"
        :aria-describedby="field.describedBy"
        :aria-invalid="field.invalid"
        @change="choose"
      >
      <art-button v-if="shown" variant="quiet" size="s">
        <button type="button" @click="remove">{{ t('form.imageRemove') }}</button>
      </art-button>
    </div>
  </FormField>
</template>
