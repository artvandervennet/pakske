<script setup lang="ts">
import type { ViewedPicture } from '~/composables/usePictureViewer'

// A wish's picture, large. One for the whole page (usePictureViewer).
//
// It opens as big as the screen lets it be, and never more than twice its own size, so a small
// picture from a shop doesn't turn into a blur. On a phone that is barely wider than the card
// showed it, so it zooms too: a press on the picture, or "Inzoomen", makes it three times as
// large (within the same limit), in a frame that scrolls. A finger drags it around, as any
// scrolling does; a mouse drags it too. The same press, or "Uitzoomen", brings it back.
//
// It closes with its button, with Escape or the phone's back gesture, and with a click or tap
// beside the picture. The dialog is as large as its contents and has no padding, so whatever
// lands on the dialog itself landed beside the picture.
const { t } = useI18n()

const dialog = useTemplateRef<HTMLDialogElement>('dialog')
const frame = useTemplateRef<HTMLElement>('frame')
const image = useTemplateRef<HTMLImageElement>('image')
const picture = ref<ViewedPicture | null>(null)
// The picture's own size in pixels, which gives it its shape and its largest size on screen.
const size = ref<{ width: number, height: number } | null>(null)
// Its width on screen while zoomed in, in CSS pixels; null while it fits the screen.
const zoomWidth = ref<number | null>(null)
// False for a picture so small that it already shows at its largest.
const canZoom = ref(false)

const sizeOf = (from: HTMLImageElement | null | undefined) =>
  from?.naturalWidth && from.naturalHeight ? { width: from.naturalWidth, height: from.naturalHeight } : null

/** The width zooming in gives it, or null when that is hardly more than it has. */
function zoomedWidth(): number | null {
  const fit = image.value?.getBoundingClientRect().width
  if (!fit || !size.value) return null
  const wide = Math.min(fit * 3, size.value.width * 2)
  return wide >= fit * 1.25 ? Math.round(wide) : null
}

async function measure() {
  await nextTick()
  if (zoomWidth.value === null) canZoom.value = zoomedWidth() !== null
}

async function open(next: ViewedPicture, from?: HTMLImageElement | null) {
  picture.value = next
  size.value = sizeOf(from)
  zoomWidth.value = null
  // The picture is only in the page while it is shown: let it render first.
  await nextTick()
  dialog.value?.showModal()
  measure()
}

function onLoad() {
  size.value = sizeOf(image.value)
  measure()
}

const shape = computed(() => size.value && {
  '--ratio': size.value.width / size.value.height,
  '--natural': size.value.width,
  'inlineSize': zoomWidth.value === null ? undefined : `${zoomWidth.value}px`,
})

/**
 * Zooms in or back out. `at` is where the picture was pressed: that spot stays under the
 * finger. Without it (the button) the middle of the picture stays in the middle.
 */
async function toggleZoom(at?: { x: number, y: number }) {
  const shown = image.value?.getBoundingClientRect()
  if (!shown) return
  if (zoomWidth.value !== null) {
    zoomWidth.value = null
    return
  }
  const wide = zoomedWidth()
  if (wide === null) return
  // Which part of the picture was pressed, from 0 to 1 each way.
  const spot = at ? { x: (at.x - shown.left) / shown.width, y: (at.y - shown.top) / shown.height } : { x: 0.5, y: 0.5 }
  zoomWidth.value = wide
  await nextTick()
  const box = frame.value
  const now = image.value
  if (!box || !now) return
  const view = box.getBoundingClientRect()
  box.scrollLeft = spot.x * now.offsetWidth - (at ? at.x - view.left : box.clientWidth / 2)
  box.scrollTop = spot.y * now.offsetHeight - (at ? at.y - view.top : box.clientHeight / 2)
}

// A mouse drags the zoomed picture around; a finger scrolls it by itself. A drag ends in a
// click, which then isn't a press to zoom out. The frame takes the presses, not the picture:
// while it holds the mouse for a drag, the click that ends the press goes to the frame.
let drag: { x: number, y: number, left: number, top: number } | null = null
let dragged = false

function onPointerDown(event: PointerEvent) {
  dragged = false
  if (event.pointerType !== 'mouse' || event.button !== 0 || zoomWidth.value === null || !frame.value) return
  drag = { x: event.clientX, y: event.clientY, left: frame.value.scrollLeft, top: frame.value.scrollTop }
  frame.value.setPointerCapture(event.pointerId)
}

function onPointerMove(event: PointerEvent) {
  if (!drag || !frame.value) return
  const moved = { x: event.clientX - drag.x, y: event.clientY - drag.y }
  if (Math.abs(moved.x) + Math.abs(moved.y) > 4) dragged = true
  frame.value.scrollLeft = drag.left - moved.x
  frame.value.scrollTop = drag.top - moved.y
}

function onPointerUp() {
  drag = null
}

function onPictureClick(event: MouseEvent) {
  if (dragged) return
  // A click without a pointer (Enter on a screen reader's cursor) has no place: zoom on the middle.
  toggleZoom(event.detail === 0 ? undefined : { x: event.clientX, y: event.clientY })
}

// `closedby="any"` closes it on a click beside it where the browser knows that attribute. This
// also does so where it doesn't (Safari), and for the strip beside the buttons.
function onClick(event: MouseEvent) {
  if (event.target === dialog.value) dialog.value?.close()
}

// The picture leaves the page with the dialog. `close` arrives a moment after the dialog
// closed; one that was opened again by then keeps its picture.
function onClose() {
  if (dialog.value?.open) return
  picture.value = null
  zoomWidth.value = null
}

defineExpose({ open })
</script>

<template>
  <dialog ref="dialog" class="picture-viewer" closedby="any" :aria-label="picture ? t('wish.pictureOf', { title: picture.title }) : undefined" @click="onClick" @close="onClose">
    <div v-if="picture" class="picture-viewer-body">
      <div class="picture-viewer-head">
        <art-button v-if="canZoom" variant="secondary" size="s">
          <button type="button" @click="toggleZoom()">{{ zoomWidth === null ? t('wish.pictureZoomIn') : t('wish.pictureZoomOut') }}</button>
        </art-button>
        <art-button size="s">
          <button type="button" autofocus @click="dialog?.close()">{{ t('share.close') }}</button>
        </art-button>
      </div>
      <!-- A frame that scrolls is a Tab stop while it does, so the arrow keys move the picture. -->
      <div
        ref="frame"
        class="picture-viewer-frame"
        :class="{ zoomed: zoomWidth !== null, zoomable: canZoom }"
        :tabindex="zoomWidth === null ? undefined : 0"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
        @click="onPictureClick"
      >
        <!-- Named by the dialog, which says whose picture it is. Until its size is known it
             takes no room, so it never shows in the wrong shape first. -->
        <img ref="image" :src="picture.src" alt="" draggable="false" :style="shape ?? undefined" :hidden="!shape" @load="onLoad">
      </div>
    </div>
  </dialog>
</template>
