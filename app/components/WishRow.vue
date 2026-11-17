<script setup lang="ts">
import type { WishView } from '#shared/schemas/list'

// One wish on a list: a row that unfolds in place. The page keeps which rows are open, so
// several can be open at once and they stay open when the list refreshes. Unfolded, it shows
// an owner the wish itself, editable where it stands (the title here, the rest in WishEditor),
// and everyone else the details.
// `owners` is the owners' names as one phrase; `ownerCount` picks the singular or plural around it.
const props = defineProps<{ wish: WishView, token: string, open: boolean, owners: string, ownerCount: number }>()
const emit = defineEmits<{ toggle: [], changed: [] }>()

const { t } = useI18n()
const { secondLine, amountTag } = useWishStatus()

const detailsId = computed(() => `wish-${props.wish.id}-details`)
const line = computed(() => secondLine(props.wish))
const amount = computed(() => amountTag(props.wish))
const removed = computed(() => props.wish.role === 'buyer' && props.wish.removed)

// Only the owner's view of the wish reaches the editing, so nothing in it can depend on buyers.
const ownWish = computed(() => (props.wish.role === 'owner' ? props.wish : null))
const editing = computed(() => props.open && ownWish.value !== null)
const saving = useWishSave(() => ownWish.value!, () => props.token, () => emit('changed'))
const saveTitle = (text: string) => saving.save(textChange(props.wish, 'title', text))

const row = useTemplateRef<HTMLElement>('row')

// Folding waits for the saves on their way, so a failure can still show beside its field. A
// field holding a failed save keeps the row open and gets the focus: folding would lose it.
function toggle() {
  if (!editing.value) return emit('toggle')
  const unsaved = row.value?.querySelector<HTMLElement>('[aria-invalid="true"]')
  if (unsaved) return (unsaved.querySelector<HTMLElement>('button, input') ?? unsaved).focus()
  saving.whenSaved(() => emit('toggle'))
}

// When the row folds while the focus is inside it, the focus would drop to the page's start.
// It goes back to the row's own button instead.
const toggleButton = useTemplateRef<HTMLButtonElement>('toggleButton')
watch(() => props.open, (open) => {
  if (!open && row.value?.contains(document.activeElement)) toggleButton.value?.focus()
})
</script>

<template>
  <li :id="`wish-${wish.id}`" ref="row" class="wish-row" :class="{ open, removed, editing }">
    <div class="wish-head">
      <!-- The tick and its message (WishTick). The message wraps onto a line of its own. -->
      <slot name="tick" />
      <WishThumb :wish="wish" />
      <!-- The button stretches over the whole row (see app.css), so tapping the picture or
           the tag unfolds it too; the tick and an owner's title, above it, are their own
           controls. It stays the same element while the title turns editable, so the focus
           stays on it. -->
      <button
        ref="toggleButton"
        type="button"
        class="wish-toggle"
        :aria-expanded="open ? 'true' : 'false'"
        :aria-controls="detailsId"
        :aria-label="editing ? wish.title : undefined"
        @click="toggle"
      >
        <template v-if="!editing">
          <span class="wish-title">{{ wish.title }}</span>
          <span v-if="line" class="wish-line">{{ line }}</span>
        </template>
      </button>
      <div v-if="editing" class="wish-heading">
        <EditableText class="wish-title-edit" :value="wish.title" :label="t('edit.title')" :save="saveTitle" :maxlength="120">
          <span class="wish-chevron" aria-hidden="true" />
        </EditableText>
        <span v-if="line" class="wish-line">{{ line }}</span>
      </div>
      <div v-if="amount || removed" class="wish-tags">
        <art-tape v-if="removed" pigment="complement" :seed="`removed-${wish.id}`">{{ t('wish.removed') }}</art-tape>
        <art-tape v-if="amount" :seed="`wish-${wish.id}`">{{ amount }}</art-tape>
      </div>
    </div>
    <div :id="detailsId" class="wish-details" :hidden="!open">
      <template v-if="open">
        <WishEditor v-if="ownWish" :wish="ownWish" :saving="saving" @changed="emit('changed')" />
        <WishBuyerDetails v-else :wish="wish" :token="token" :owners="owners" :owner-count="ownerCount" @changed="emit('changed')" />
      </template>
    </div>
  </li>
</template>
