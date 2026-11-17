<script setup lang="ts">
import type { WishView } from '#shared/schemas/list'

// One wish on a list: a row that unfolds in place into a card, with the picture at full width. The page keeps which rows are open, so
// several can be open at once and they stay open when the list refreshes. Unfolded, it shows
// an owner the wish itself, editable where it stands (the title here, the rest in WishEditor),
// and everyone else the details.
// `owners` is the list's owners; `viewerOwnsList` says whether the viewer is one of them.
// `refresh` refreshes the list after an owner's edit saved; `changed` is for what can take the
// focused control away with it, such as deleting. `added` and `removed` come from "Op mijn lijst
// zetten": where the wish went, or that it left this list meanwhile. `joint` comes from the
// owner's "Gezamenlijk maken".
// The `message` slot is for what the page says about this row, at the top of its details.
const props = defineProps<{
  wish: WishView
  token: string
  open: boolean
  owners: string[]
  viewerOwnsList: boolean
  refresh: () => Promise<unknown>
}>()
const emit = defineEmits<{ toggle: [], changed: [], added: [list: { token: string, title: string }], removed: [], joint: [] }>()

const { t } = useI18n()
const { secondLine, amountTag } = useWishStatus()
const names = useNames()

const detailsId = computed(() => `wish-${props.wish.id}-details`)
const line = computed(() => secondLine(props.wish))
const amount = computed(() => amountTag(props.wish))
const removed = computed(() => props.wish.role === 'buyer' && props.wish.removed)
const ownerTag = computed(() => {
  const tag = wishOwnerTag(props.wish, props.viewerOwnsList)
  if (!tag) return null
  return tag.key === 'wish.with' ? t(tag.key, { names: names(tag.names) }) : t(tag.key)
})

// Only the owner's view of the wish reaches the editing, so nothing in it can depend on buyers.
const ownWish = computed(() => (props.wish.role === 'owner' ? props.wish : null))
const editing = computed(() => props.open && ownWish.value !== null)
// Saving needs only the wish's id and the list, which every row has; nothing is sent until an
// owner edits.
const saving = useWishSave(() => props.wish.id, () => props.token, () => props.refresh())
const saveTitle = (text: string, saved: string) => saving.save(fieldChange('title', text, saved))

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
          <!-- For the pointer only: the row's button above folds it for everyone. -->
          <span class="wish-chevron" aria-hidden="true" @click="toggle" />
        </EditableText>
        <span v-if="line" class="wish-line">{{ line }}</span>
      </div>
      <div v-if="amount || removed || ownerTag" class="wish-tags">
        <art-tape v-if="removed" pigment="complement" :seed="`removed-${wish.id}`">{{ t('wish.removed') }}</art-tape>
        <art-tape v-if="ownerTag" class="wish-owner-tag" :seed="`owners-${wish.id}`">{{ ownerTag }}</art-tape>
        <art-tape v-if="amount" :seed="`wish-${wish.id}`">{{ amount }}</art-tape>
      </div>
    </div>
    <div :id="detailsId" class="wish-details" :hidden="!open">
      <template v-if="open">
        <!-- The picture as large as the card allows. An owner's is the control that changes it. -->
        <div v-if="ownWish || wish.image" class="wish-card-picture">
          <WishPictureEdit v-if="ownWish" :wish="ownWish" :saving="saving" />
          <img v-else-if="wish.image" class="wish-picture" :src="wish.image" alt="" decoding="async">
        </div>
        <slot name="message" />
        <WishEditor v-if="ownWish" :wish="ownWish" :saving="saving" :can-remove="viewerOwnsList" @changed="emit('changed')" @joint="emit('joint')" />
        <WishBuyerDetails
          v-else
          :wish="wish"
          :token="token"
          :owners="owners"
          @changed="emit('changed')"
          @added="list => emit('added', list)"
          @removed="emit('removed')"
        />
      </template>
    </div>
  </li>
</template>
