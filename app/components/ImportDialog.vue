<script setup lang="ts">
import { hostOf } from '#shared/utils/wish-line'
import { alreadyListed, type ImportItem, type ImportRead } from '#shared/utils/wish-import'

// "Importeren" on a list of your own: a sheet in two steps. First a field to paste into: the
// link of a wishlist kept at bol.com or Amazon, or links of products from any shop. The server
// reads them (the shop sees the server, never this browser) and the sheet then shows what it
// found, each wish with a box, all ticked but the ones whose link the list has already. One
// button puts the ticked ones on the list. Nothing is on the list before that press.
// `added` says how many went on, once they are; the page then shows them.
const props = defineProps<{ token: string, wishes: readonly { urls: readonly string[] }[] }>()
const emit = defineEmits<{ added: [count: number] }>()

const { t } = useI18n()
const { parse } = useApiError()
const id = useId()

const dialog = useTemplateRef<HTMLDialogElement>('dialog')
const heading = useTemplateRef<HTMLElement>('heading')
const field = useTemplateRef<HTMLTextAreaElement>('field')

const text = ref('')
const found = ref<ImportRead | null>(null)
// The places in `found.items` that are ticked, and the ones the list has already.
const ticked = reactive(new Set<number>())
const listed = ref(new Set<number>())
const adding = ref(false)
const addError = ref('')
const status = ref('')

const { form, pending, message, errors, run } = useForm(async () => {
  if (!text.value.trim()) return refuse(t('fields.required'))
  status.value = t('import.reading')
  let read: ImportRead
  try {
    read = await $fetch<ImportRead>('/api/import/read', { method: 'POST', body: { text: text.value } })
  }
  finally {
    status.value = ''
  }
  if (!read.items.length) {
    // No link in it at all, or links that gave nothing.
    if (!read.unread.length) return refuse(t('import.noLinks'))
    message.value = t('import.nothing', read.unread.length)
    return
  }
  listed.value = alreadyListed(read.items, props.wishes)
  ticked.clear()
  read.items.forEach((_item, at) => {
    if (!listed.value.has(at)) ticked.add(at)
  })
  found.value = read
  status.value = t('import.found', { n: read.items.length }, read.items.length)
  // The field and its button are gone with the first step: on to what was found.
  await nextTick()
  heading.value?.focus()
})

/** Says what is wrong with the field and puts the cursor back in it. */
async function refuse(sentence: string) {
  errors.value = { text: sentence }
  await nextTick()
  field.value?.focus()
}

const chosen = computed<ImportItem[]>(() => (found.value?.items ?? []).filter((_item, at) => ticked.has(at)))
const allTicked = computed(() => chosen.value.length === (found.value?.items.length ?? 0))

function tick(at: number, on: boolean) {
  if (on) ticked.add(at)
  else ticked.delete(at)
}

function tickAll(on: boolean) {
  ticked.clear()
  if (on) found.value?.items.forEach((_item, at) => ticked.add(at))
}

/** What a list that wasn't read to its end says about it. */
const short = computed(() => {
  const cut = found.value?.short
  if (!cut) return ''
  return cut.total === null ? t('import.shortUnknown', { read: cut.read }, cut.read) : t('import.short', { read: cut.read, total: cut.total })
})

async function add() {
  if (adding.value || !chosen.value.length) return
  adding.value = true
  addError.value = ''
  status.value = t('import.adding')
  try {
    const count = chosen.value.length
    await $fetch(`/api/lists/${props.token}/wishes/import`, { method: 'POST', body: { items: chosen.value } })
    dialog.value?.close()
    emit('added', count)
  }
  catch (failure) {
    addError.value = parse(failure).message
  }
  finally {
    adding.value = false
    status.value = ''
  }
}

/** Back to the field, with what was pasted still in it. */
async function back() {
  found.value = null
  addError.value = ''
  await nextTick()
  field.value?.focus()
}

/** Opens the sheet on its first step, empty. */
async function open() {
  if (!dialog.value || dialog.value.open) return
  text.value = ''
  found.value = null
  message.value = ''
  errors.value = {}
  addError.value = ''
  status.value = ''
  await nextTick()
  dialog.value.showModal()
  // The heading rather than the field: a screen reader starts with what this is about.
  heading.value?.focus()
}

/** A click on the backdrop lands on the dialog element itself, which has no padding of its own. */
function onClick(event: MouseEvent) {
  if (event.target === dialog.value && !pending.value && !adding.value) dialog.value?.close()
}

function onClose() {
  // Escape sets no value, and browsers differ on whether it clears the last one: reset it.
  if (dialog.value) dialog.value.returnValue = ''
}

defineExpose({ open })
</script>

<template>
  <dialog ref="dialog" class="dialog sheet import-sheet" :aria-labelledby="`${id}-title`" @click="onClick" @close="onClose">
    <div class="sheet-body">
      <div class="sheet-head">
        <h2 :id="`${id}-title`" ref="heading" tabindex="-1">
          {{ found ? t('import.found', { n: found.items.length }, found.items.length) : t('import.title') }}
        </h2>
        <button type="button" class="icon-button" :aria-label="t('share.close')" @click="dialog?.close()">
          <AppIcon name="close" />
        </button>
      </div>

      <form v-if="!found" ref="form" class="form" method="post" novalidate @submit.prevent="run">
        <FormField :id="`${id}-text`" v-slot="control" :label="t('import.label')" :hint="t('import.hint')" :error="errors.text">
          <textarea
            :id="`${id}-text`"
            ref="field"
            v-model="text"
            name="text"
            rows="4"
            maxlength="16000"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            placeholder="https://"
            :readonly="pending || undefined"
            :aria-describedby="control.describedBy"
            :aria-invalid="control.invalid"
          />
        </FormField>
        <p v-if="message" class="form-message" role="alert">{{ message }}</p>
        <p v-if="pending" class="import-wait">{{ t('import.reading') }}</p>
        <div class="sheet-action">
          <art-button>
            <button type="submit" :aria-disabled="pending || undefined">{{ t('import.read') }}</button>
          </art-button>
        </div>
      </form>

      <template v-else>
        <fieldset class="invite-pick import-pick">
          <legend class="invite-pick-legend">{{ t('import.pick') }}</legend>
          <art-button v-if="found.items.length > 5" variant="quiet" size="s">
            <button type="button" @click="tickAll(!allTicked)">{{ allTicked ? t('invite.tickNone') : t('invite.tickAll') }}</button>
          </art-button>
          <ul class="rows import-found">
            <li v-for="(item, at) in found.items" :key="at">
              <label class="row invite-wish">
                <span class="tick-box">
                  <input type="checkbox" :checked="ticked.has(at)" @change="event => tick(at, (event.target as HTMLInputElement).checked)">
                </span>
                <span class="row-text">
                  <span class="row-title">{{ item.title }}</span>
                  <span class="row-meta">{{ listed.has(at) ? t('import.listed', { shop: hostOf(item.url) }) : hostOf(item.url) }}</span>
                </span>
              </label>
            </li>
          </ul>
        </fieldset>

        <p v-if="addError" class="form-message" role="alert">{{ addError }}</p>
        <div class="sheet-action">
          <art-button>
            <button
              type="button"
              :aria-disabled="adding || !chosen.length || undefined"
              :aria-describedby="chosen.length ? undefined : `${id}-nothing`"
              @click="add"
            >
              {{ t('import.add', { n: chosen.length }, chosen.length) }}
            </button>
          </art-button>
        </div>
        <p v-if="!chosen.length" :id="`${id}-nothing`" class="invite-hint">{{ t('invite.nothing') }}</p>
        <!-- What the shops kept back, under the button: it changes nothing about what can be added now. -->
        <p v-if="short" class="import-note">{{ short }}</p>
        <div v-if="found.unread.length" class="import-note">
          <p>{{ t('import.unread', found.unread.length) }}</p>
          <ul class="import-unread">
            <li v-for="link in found.unread" :key="link">{{ link }}</li>
          </ul>
        </div>
        <art-button variant="quiet" size="s">
          <button type="button" :aria-disabled="adding || undefined" @click="adding || back()">{{ t('import.back') }}</button>
        </art-button>
      </template>

      <!-- Always there, so what a press did is announced. -->
      <p class="visually-hidden" role="status">{{ status }}</p>
    </div>
  </dialog>
</template>
