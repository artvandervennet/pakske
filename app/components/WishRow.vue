<script setup lang="ts">
import type { WishView } from '#shared/schemas/list'

// One wish on a list: a row that unfolds in place into a card as wide as the list. The page
// keeps which rows are open, so several can be open at once and they stay open when the list
// refreshes.
//
// Folded, it is the tick, the small picture, the title with a line of detail, and the tags. A
// wish the viewer gives is marked as theirs: an edge in the accent at the row's start and
// their part of the line on a yellow tape; it is never greyed. A wish that others took fully
// is greyed and crossed out (isCrossedOut).
//
// Unfolded, the row's head makes way for the card's: the title (an owner's is editable where
// it stands), then small buttons at the far end: "Delen" for an owner on their own list, "Op
// mijn lijst" for a buyer, and the one that folds the card again. Under it an owner gets the
// wish to edit (WishEditor) and everyone else its details (WishBuyerDetails). The tick is not
// in the card's head: giving is done in the card's body, with the full stepper.
//
// `owners` is the list's owners; `viewerOwnsList` says whether the viewer is one of them.
// `refresh` refreshes the list after an owner's edit saved; `changed` is for what can take the
// focused control away with it, such as unlinking. `ticked` is a tick that was saved or
// refused ('gone' when the wish no longer exists). `added` and `removed` come from "Op mijn
// lijst": where the wish went, or that it left this list meanwhile. `share` is the owner's
// "Delen": the page opens its share dialog for this wish.
// The `message` slot is for what the page says about this row, at the top of the card, `end`
// for what comes after the tags (the handle in edit mode), and `tick` replaces the tick.
// `editMode`: the page's edit mode. The row doesn't open then; tapping it ticks the box the page
// puts in the `tick` slot (its id is "pick-" and the wish's id).
const props = defineProps<{
  wish: WishView
  token: string
  open: boolean
  owners: string[]
  viewerOwnsList: boolean
  refresh: () => Promise<unknown>
  editMode?: boolean
  /** The page behind a list's old link: only the viewer's own tick, to lower or take back. */
  bare?: boolean
}>()
const emit = defineEmits<{
  toggle: []
  changed: []
  ticked: [reason?: 'gone']
  added: [list: { token: string, title: string }]
  removed: []
  share: []
  deleted: []
}>()

const { t } = useI18n()
const { line: lineOf, amountTag } = useWishStatus()
const names = useNames()

const detailsId = computed(() => `wish-${props.wish.id}-details`)
const addId = computed(() => `wish-${props.wish.id}-add`)
const line = computed(() => lineOf(props.wish))
const amount = computed(() => amountTag(props.wish))
// On an old link's page every row is "removed" so nothing more can be given; the tag would be untrue.
const removed = computed(() => props.wish.role === 'buyer' && props.wish.removed && !props.bare)
const mine = computed(() => givenByMe(props.wish))
const crossedOut = computed(() => isCrossedOut(props.wish))
const ownerTag = computed(() => {
  const tag = wishOwnerTag(props.wish, props.viewerOwnsList)
  if (!tag) return null
  return tag.key === 'wish.with' ? t(tag.key, { names: names(tag.names) }) : t(tag.key)
})

// Only the owner's view of the wish reaches the editing, so nothing in it can depend on buyers.
const ownWish = computed(() => (props.wish.role === 'owner' ? props.wish : null))
const editing = computed(() => props.open && ownWish.value !== null)
// In the card, the amount and the other owners are in an owner's body already; their head
// only keeps "ook van jou".
const cardOwnerTag = computed(() => (ownWish.value && props.wish.sharedWith.length ? null : ownerTag.value))
const cardAmount = computed(() => (ownWish.value ? null : amount.value))

// Saving needs only the wish's id and the list, which every row has; nothing is sent until an
// owner edits.
const saving = useWishSave(() => props.wish.id, () => props.token, () => props.refresh())
const saveTitle = (text: string, saved: string) => saving.save(fieldChange('title', text, saved))

// One tick per row, shown by the box or the count at the row's start and by the card's stepper.
const tick = useWishTick(() => props.wish, () => props.token, reason => emit('ticked', reason))

const row = useTemplateRef<HTMLElement>('row')

// Folding waits for the saves on their way, so a failure can still show beside its field. A
// field holding a failed save keeps the row open and gets the focus: folding would lose it.
function toggle() {
  if (!editing.value) return emit('toggle')
  const unsaved = row.value?.querySelector<HTMLElement>('[aria-invalid="true"]')
  if (unsaved) return (unsaved.querySelector<HTMLElement>('button, input') ?? unsaved).focus()
  saving.whenSaved(() => emit('toggle'))
}

// "Op mijn lijst": the card's button unfolds the choice of a list at the top of the card.
const canAdd = computed(() => props.wish.role === 'buyer' && !props.wish.removed)
// A list's owners own every wish on it, and `sharedWith` names the owners beyond them. Neither:
// the wish is on a list whose owner's account is gone.
const hasOwners = computed(() => props.owners.length > 0 || props.wish.sharedWith.length > 0)
const adding = ref(false)
const addButton = useTemplateRef<HTMLButtonElement>('addButton')

async function onAdded(list: { token: string, title: string }) {
  adding.value = false
  await nextTick()
  // The choice went with its buttons. After "Samen" this button is gone too, and the page
  // puts the focus on the row.
  addButton.value?.focus()
  emit('added', list)
}

// The row's head and the card's head are different elements, so the button that was pressed
// goes away with its head. The focus moves to the button that does the opposite: the card's
// fold button after opening, the row's own button after folding.
const toggleButton = useTemplateRef<HTMLButtonElement>('toggleButton')
const foldButton = useTemplateRef<HTMLButtonElement>('foldButton')
watch(() => props.open, async (open) => {
  // Asked before the head is replaced: afterwards the focus has already dropped to the page.
  const inside = row.value?.contains(document.activeElement)
  if (!open) adding.value = false
  await nextTick()
  if (inside) (open ? foldButton : toggleButton).value?.focus()
})

/**
 * For the page, before it folds this row from outside (edit mode): waits for the saves on their
 * way, and answers false, with the focus on the field, when one failed, as `toggle` does.
 */
async function settle(): Promise<boolean> {
  if (saving.busy.value) {
    await new Promise<void>((resolve) => {
      const stop = watch(saving.busy, (busy) => {
        if (busy) return
        stop()
        resolve()
      })
    })
  }
  await nextTick()
  const unsaved = row.value?.querySelector<HTMLElement>('[aria-invalid="true"]')
  if (!unsaved) return true
  ;(unsaved.querySelector<HTMLElement>('button, input') ?? unsaved).focus()
  return false
}

defineExpose({ settle })
</script>

<template>
  <li :id="`wish-${wish.id}`" ref="row" class="wish-row" :class="{ open, removed, mine, 'edit-mode': editMode, done: crossedOut }">
    <div v-if="!open" class="wish-head">
      <slot name="tick">
        <WishTick v-if="wish.role !== 'anon'" :wish="wish" :tick="tick" />
      </slot>
      <WishThumb :wish="wish" />
      <!-- The button stretches over the whole row (see app.css), so tapping the picture or
           the tag unfolds it too; the tick, above it, is its own control. -->
      <!-- In edit mode the whole row is the label of its box, so tapping it ticks the box. -->
      <label v-if="editMode" class="wish-toggle" :for="`pick-${wish.id}`">
        <span class="wish-title">{{ wish.title }}</span>
        <span v-if="line" class="wish-line">{{ line }}</span>
      </label>
      <button
        v-else
        ref="toggleButton"
        type="button"
        class="wish-toggle"
        aria-expanded="false"
        :aria-controls="detailsId"
        @click="toggle"
      >
        <span class="wish-title">{{ wish.title }}</span>
        <span v-if="line" class="wish-line">{{ line }}</span>
      </button>
      <div v-if="amount || removed || ownerTag" class="wish-tags">
        <art-tape v-if="removed" pigment="complement" :seed="`removed-${wish.id}`">{{ t('wish.removed') }}</art-tape>
        <art-tape v-if="ownerTag" class="wish-owner-tag" :seed="`owners-${wish.id}`">{{ ownerTag }}</art-tape>
        <art-tape v-if="amount" :seed="`wish-${wish.id}`">{{ amount }}</art-tape>
      </div>
      <slot name="end" />
      <!-- A refused tick, on a line of its own under the row. -->
      <p v-if="tick.message" :id="tick.messageId" class="wish-tick-message" role="alert">{{ tick.message }}</p>
    </div>

    <div v-else class="wish-card-head">
      <div class="wish-card-heading">
        <template v-if="ownWish">
          <!-- The card keeps a heading while its visible title is a field. -->
          <h3 class="visually-hidden">{{ wish.title }}</h3>
          <EditableText class="wish-title-edit" :value="wish.title" :label="t('edit.title')" :save="saveTitle" :maxlength="120" />
        </template>
        <h3 v-else class="wish-card-title">{{ wish.title }}</h3>
        <div v-if="cardAmount || removed || cardOwnerTag" class="wish-tags">
          <art-tape v-if="removed" pigment="complement" :seed="`removed-${wish.id}`">{{ t('wish.removed') }}</art-tape>
          <art-tape v-if="cardOwnerTag" class="wish-owner-tag" :seed="`owners-${wish.id}`">{{ cardOwnerTag }}</art-tape>
          <art-tape v-if="cardAmount" :seed="`wish-${wish.id}`">{{ cardAmount }}</art-tape>
        </div>
      </div>
      <div class="wish-card-actions">
        <!-- Its word shows beside the icon where there is room, and is its name everywhere. -->
        <button v-if="ownWish && viewerOwnsList" type="button" class="icon-button worded" @click="emit('share')">
          <AppIcon name="share" />
          <span class="icon-button-words">{{ t('joint.make') }}</span>
        </button>
        <button
          v-if="canAdd"
          ref="addButton"
          type="button"
          class="icon-button"
          :aria-label="t('add.open')"
          :title="t('add.open')"
          :aria-expanded="adding ? 'true' : 'false'"
          :aria-controls="addId"
          @click="adding = !adding"
        >
          <AppIcon name="add-to-list" />
        </button>
        <!-- Its target spreads under the whole head (see app.css), so tapping the title of a
             wish that isn't yours folds the card, the way tapping the row opened it. -->
        <button
          ref="foldButton"
          type="button"
          class="icon-button wish-fold"
          aria-expanded="true"
          :aria-controls="detailsId"
          :aria-label="t('wish.close', { title: wish.title })"
          @click="toggle"
        >
          <!-- The square that shows the hover: the button's own target is the whole head. -->
          <span class="wish-fold-face"><AppIcon name="chevron" /></span>
        </button>
      </div>
    </div>

    <div :id="detailsId" class="wish-details" :hidden="!open">
      <template v-if="open">
        <slot name="message" />
        <div v-if="canAdd" :id="addId" class="wish-card-add" :hidden="!adding">
          <AddToMyList v-if="adding && wish.role === 'buyer'" :wish="wish" :token="token" :can-link="hasOwners" @added="onAdded" @removed="emit('removed')" />
        </div>
        <WishEditor v-if="ownWish" :wish="ownWish" :saving="saving" :tick="tick" :can-delete="viewerOwnsList" @changed="emit('changed')" @deleted="emit('deleted')" />
        <WishBuyerDetails v-else :wish="wish" :token="token" :owners="owners" :tick="tick" :bare="bare" @changed="emit('changed')" />
      </template>
    </div>
  </li>
</template>
