<script setup lang="ts">
import type { MyLists } from '#shared/schemas/list'
import type { SantaGroupRow } from '#shared/schemas/santa'

// Secret Santa stands beside the lists, as something extra: the groups the person is in, and a
// form for a new one. A group is joined through its link, so nobody finds one here that they
// aren't in.
definePageMeta({ middleware: 'auth' })

const { t } = useI18n()
const localePath = useLocalePath()
const { parse } = useApiError()

useHead({ title: () => t('santa.title') })

const [{ data, error }, { data: mine }] = await Promise.all([
  useFetch<SantaGroupRow[]>('/api/santa'),
  useFetch<MyLists>('/api/me/lists'),
])
const groups = computed(() => data.value ?? [])
// Without it a failed load would look like being in no group at all.
const loadError = computed(() => (error.value ? parse(error.value).message : ''))

const title = ref('')
const list = ref(startingList(mine.value))
// A new group opens at once: its link is there to send on.
const { form, pending, message, errors, run } = useForm(async () => {
  const made = await $fetch<{ token: string }>('/api/santa', { method: 'POST', body: { title: title.value, list: list.value } })
  await navigateTo(localePath(`/s/${made.token}`))
})
</script>

<template>
  <div>
    <PageHead :title="t('santa.title')" :lead="t('santa.lead')" />

    <section class="band section" data-paint="1" aria-labelledby="santa-yours-title">
      <div class="inner">
        <div class="section-head">
          <h2 id="santa-yours-title" class="section-title">{{ t('santa.yours') }}</h2>
        </div>
        <div class="section-body">
          <p v-if="loadError" class="form-message">{{ loadError }}</p>
          <ul v-else-if="groups.length" class="rows">
            <SantaGroupRow v-for="group in groups" :key="group.token" :group="group" />
          </ul>
          <p v-else class="muted">{{ t('santa.none') }}</p>
        </div>
      </div>
    </section>

    <section class="band section" data-paint="2" aria-labelledby="santa-new-title">
      <div class="inner">
        <div class="section-head">
          <h2 id="santa-new-title" class="section-title">{{ t('santa.new') }}</h2>
        </div>
        <div class="section-body">
          <form ref="form" class="form" method="post" novalidate aria-labelledby="santa-new-title" @submit.prevent="run">
            <p v-if="message" class="form-message" role="alert">{{ message }}</p>
            <FormField id="santa-name" v-slot="field" :label="t('santa.name')" :hint="t('santa.nameHint')" :error="errors.title">
              <input
                id="santa-name"
                v-model="title"
                name="santa-name"
                type="text"
                autocomplete="off"
                maxlength="80"
                required
                :aria-describedby="field.describedBy"
                :aria-invalid="field.invalid"
              >
            </FormField>
            <SantaListChoice v-model="list" :lists="mine?.lists ?? []" :legend="t('santa.listLegend')" :hint="t('santa.listHint')" />
            <div class="actions">
              <art-button>
                <button type="submit" :aria-disabled="pending || undefined">{{ pending ? t('auth.busy') : t('santa.create') }}</button>
              </art-button>
            </div>
          </form>
        </div>
      </div>
    </section>
  </div>
</template>
