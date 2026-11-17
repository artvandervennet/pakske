<script setup lang="ts">
import type { PublicItem } from '#shared/schemas/list'

// The form for a new wish and for changing one. Saves the wish, then the picture, then
// goes to the wish's page.
const props = defineProps<{ item?: PublicItem, username: string }>()

const { t } = useI18n()
const localePath = useLocalePath()

const title = ref(props.item?.title ?? '')
const description = ref(props.item?.description ?? '')
const url = ref(props.item?.url ?? '')
const unlimited = ref(props.item ? props.item.quantity === null : false)
const quantity = ref(props.item?.quantity ?? 1)
const image = ref<Blob | null | undefined>(undefined)
// Set once the wish exists. If the picture then fails to upload, saving again changes that
// wish and doesn't make a second one.
const savedId = ref(props.item?.id ?? null)

const backTo = computed(() => localePath(props.item ? `/u/${props.username}/${props.item.id}` : `/u/${props.username}`))

const { form, pending, message, errors, run } = useForm(async () => {
  const body = {
    title: title.value,
    description: description.value,
    url: url.value,
    quantity: unlimited.value ? null : Number(quantity.value),
  }
  const saved = savedId.value
    ? await $fetch<PublicItem>(`/api/me/items/${savedId.value}`, { method: 'PATCH', body })
    : await $fetch<PublicItem>('/api/me/items', { method: 'POST', body })
  savedId.value = saved.id

  if (image.value) {
    const data = new FormData()
    data.append('image', image.value, 'image.jpg')
    await $fetch(`/api/me/items/${saved.id}/image`, { method: 'PUT', body: data })
  }
  else if (image.value === null && props.item?.image) {
    await $fetch(`/api/me/items/${saved.id}/image`, { method: 'DELETE' })
  }

  await navigateTo(localePath(`/u/${props.username}/${saved.id}`))
})
</script>

<template>
  <form ref="form" class="form" method="post" novalidate @submit.prevent="run">
    <p v-if="message" class="form-message" role="alert">{{ message }}</p>

    <FormField id="title" v-slot="field" :label="t('form.title')" :error="errors.title">
      <input
        id="title"
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

    <FormField id="description" v-slot="field" :label="t('form.description')" :hint="t('form.descriptionHint')" :error="errors.description">
      <textarea
        id="description"
        v-model="description"
        name="description"
        rows="4"
        maxlength="2000"
        :aria-describedby="field.describedBy"
        :aria-invalid="field.invalid"
      />
    </FormField>

    <FormField id="url" v-slot="field" :label="t('form.url')" :hint="t('form.urlHint')" :error="errors.url">
      <input
        id="url"
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
        <input id="unlimited" v-model="unlimited" type="checkbox" name="unlimited" aria-describedby="unlimited-hint">
        <label for="unlimited">{{ t('form.unlimited') }}</label>
      </div>
      <span id="unlimited-hint" class="hint">{{ t('form.unlimitedHint') }}</span>
      <FormField v-if="!unlimited" id="quantity" v-slot="field" :label="t('form.howMany')" :error="errors.quantity">
        <input
          id="quantity"
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

    <ImagePicker v-model="image" :current="item?.image ?? null" />

    <div class="actions">
      <art-button>
        <button type="submit" :disabled="pending">{{ pending ? t('form.saving') : t('form.save') }}</button>
      </art-button>
      <art-button variant="secondary">
        <NuxtLink :to="backTo">{{ t('form.cancel') }}</NuxtLink>
      </art-button>
    </div>
  </form>
</template>
