<script setup lang="ts">
import type { ListTarget } from '#shared/schemas/input'
import type { BuyerWish, MyLists } from '#shared/schemas/list'

// "Op mijn lijst" on a wish someone else owns: the choice the card's button unfolds, at the top
// of the card. Which list (ListChooser), and the two ways, each a button that does it at once
// with what it means beside it. Samen makes the person an owner of this wish; Kopie gives them
// a wish of their own. The row shows this only while it is unfolded, so the person's lists are
// fetched each time it opens: an add can make a new list.
// `added` says where the wish went; the row folds this again and the page says so and
// refreshes. `removed` means the wish left this list meanwhile.
const props = defineProps<{ wish: BuyerWish, token: string }>()
const emit = defineEmits<{ added: [list: { token: string, title: string }], removed: [] }>()

const { t } = useI18n()
const { parse } = useApiError()
const id = useId()

const mine = ref<MyLists | null>(null)
const target = ref<ListTarget | null>(null)
const busy = ref(false)
const message = ref('')
const nameError = ref('')
const chooser = useTemplateRef<{ focus: () => void }>('chooser')

onMounted(async () => {
  try {
    mine.value = await $fetch<MyLists>('/api/me/lists')
  }
  catch (error) {
    message.value = parse(error).message
  }
})

// A name typed for a new list clears what was said about the empty one.
watch(target, () => (nameError.value = ''))

async function add(way: 'link' | 'copy') {
  if (busy.value || !mine.value) return
  if (!target.value) {
    nameError.value = t('fields.required')
    chooser.value?.focus()
    return
  }
  busy.value = true
  message.value = ''
  try {
    const landed = await $fetch<{ token: string, title: string }>(
      `/api/lists/${props.token}/wishes/${props.wish.id}/${way}`,
      { method: 'POST', body: target.value },
    )
    emit('added', { token: landed.token, title: landed.title })
  }
  catch (error) {
    const parsed = parse(error)
    if (parsed.code === 'wish_removed') return emit('removed')
    if (parsed.fields.newList) {
      nameError.value = parsed.fields.newList
      chooser.value?.focus()
    }
    else message.value = parsed.message
  }
  finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="add-to-list" role="group" :aria-label="t('add.open')">
    <template v-if="mine">
      <ListChooser ref="chooser" v-model="target" :lists="mine.lists" :last="mine.last" :legend="t('add.which')" :error="nameError" />
      <ul class="add-to-list-ways">
        <li>
          <art-button size="s">
            <button type="button" :aria-describedby="`${id}-linked`" :aria-disabled="busy || undefined" @click="add('link')">{{ t('add.linked') }}</button>
          </art-button>
          <p :id="`${id}-linked`" class="add-to-list-hint">{{ t('add.linkedHint') }}</p>
        </li>
        <li>
          <art-button size="s">
            <button type="button" :aria-describedby="`${id}-copy`" :aria-disabled="busy || undefined" @click="add('copy')">{{ t('add.copy') }}</button>
          </art-button>
          <p :id="`${id}-copy`" class="add-to-list-hint">{{ t('add.copyHint') }}</p>
        </li>
      </ul>
    </template>
    <p v-if="message" class="form-message" role="alert">{{ message }}</p>
  </div>
</template>
