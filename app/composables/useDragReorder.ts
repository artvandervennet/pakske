/**
 * Dragging a row of a list to another place, with a mouse or a finger. The row lifts and follows
 * the pointer while the others stay put; a line shows where it will land, and it moves there once,
 * on release. Near the top or bottom of the screen the page scrolls. Escape, or the browser taking
 * the touch over, puts it back.
 * The listeners are on the document, so the drag goes on when the pointer leaves the row, and it
 * follows only the pointer that started it. `start` can take over a pointer that is already down,
 * such as the one that just held a row (useLongPress).
 */
export function useDragReorder(options: {
  list: Ref<HTMLElement | null>
  order: Ref<number[]>
  move: (id: number, to: number) => void
  onDrop: () => void
}) {
  const dragging = ref<number | null>(null)

  let pointerId = -1
  // A finger is followed through its touch events: the browser may cancel its pointer events
  // (pointercancel) as soon as the finger moves, when it starts on a row that scrolls the page.
  // Touch events keep going to the element the finger first touched, even after edit mode has
  // swapped it out of the page, so they are heard there rather than on the document.
  let touched: EventTarget | null = null
  let item: HTMLElement | null = null
  let startY = 0
  let startScroll = 0
  let lastY = 0
  let to = -1
  let frame = 0
  let lastFrame = 0

  /** The rows other than the dragged one, in order on screen. */
  function others(): HTMLElement[] {
    return [...(options.list.value?.querySelectorAll<HTMLElement>(':scope > li.wish-row') ?? [])].filter(row => row !== item)
  }

  /** Where the row would land: before the first other row whose middle is below the pointer. */
  function dropSpot(rows: HTMLElement[]): number {
    const index = rows.findIndex((row) => {
      const box = row.getBoundingClientRect()
      return box.top + box.height / 2 > lastY
    })
    return index === -1 ? rows.length : index
  }

  function update() {
    const list = options.list.value
    if (!item || !list || dragging.value === null) return
    item.style.translate = `0 ${lastY - startY + (window.scrollY - startScroll)}px`
    const rows = others()
    to = dropSpot(rows)
    // No line where the row already is: dropping there changes nothing.
    if (to === options.order.value.indexOf(dragging.value) || !rows.length) {
      delete list.dataset.drop
      return
    }
    const listBox = list.getBoundingClientRect()
    const y = to < rows.length ? rows[to]!.getBoundingClientRect().top : rows.at(-1)!.getBoundingClientRect().bottom
    list.dataset.drop = ''
    list.style.setProperty('--drop-y', `${y}px`)
    list.style.setProperty('--drop-x', `${listBox.left}px`)
    list.style.setProperty('--drop-w', `${listBox.width}px`)
  }

  /** Scrolls while the pointer is near the top or bottom, faster the closer it gets. */
  function scrollStep(time: number) {
    if (dragging.value === null) return
    const elapsed = lastFrame ? Math.min(time - lastFrame, 50) : 16
    lastFrame = time
    // The sticky header covers the top of the screen; the zone starts under it.
    const header = Math.max(0, document.querySelector('art-header, body > #__nuxt > header')?.getBoundingClientRect().bottom ?? 0)
    const zone = 64
    const top = header + zone
    const bottom = window.innerHeight - zone
    let speed = 0
    if (lastY < top) speed = -Math.min(1, (top - lastY) / zone)
    else if (lastY > bottom) speed = Math.min(1, (lastY - bottom) / zone)
    if (speed) {
      window.scrollBy({ top: speed * elapsed * 0.8, behavior: 'instant' })
      update()
    }
    frame = requestAnimationFrame(scrollStep)
  }

  function start(wishId: number, event: PointerEvent) {
    if (dragging.value !== null || !event.isPrimary) return
    if (event.pointerType === 'mouse' && event.button !== 0) return
    item = options.list.value?.querySelector<HTMLElement>(`#wish-${wishId}`) ?? null
    if (!item) return
    pointerId = event.pointerId
    touched = event.pointerType === 'touch' ? event.target : null
    startY = lastY = event.clientY
    startScroll = window.scrollY
    to = options.order.value.indexOf(wishId)
    dragging.value = wishId
    item.classList.add('dragging')
    document.documentElement.classList.add('dragging-row')
    if (touched) {
      touched.addEventListener('touchmove', followTouch as EventListener, { passive: false })
      touched.addEventListener('touchend', drop)
      touched.addEventListener('touchcancel', finish)
    }
    else {
      document.addEventListener('pointermove', onMove)
      document.addEventListener('pointerup', onUp)
      document.addEventListener('pointercancel', onCancel)
    }
    // Before anything else hears it: Escape ends the drag, not edit mode.
    window.addEventListener('keydown', onKey, true)
    lastFrame = 0
    frame = requestAnimationFrame(scrollStep)
  }

  function onMove(event: PointerEvent) {
    if (event.pointerId !== pointerId) return
    lastY = event.clientY
    update()
  }

  function onUp(event: PointerEvent) {
    if (event.pointerId === pointerId) drop()
  }

  function drop() {
    if (dragging.value === null) return
    const id = dragging.value
    const moved = to !== -1 && to !== options.order.value.indexOf(id)
    const dropped = item
    const before = dropped?.getBoundingClientRect()
    finish()
    if (!moved) return
    options.move(id, to)
    options.onDrop()
    // Glide from where it was let go to its new place.
    nextTick(() => {
      if (!dropped || !before || matchMedia('(prefers-reduced-motion: reduce)').matches) return
      const after = dropped.getBoundingClientRect()
      dropped.animate([{ translate: `0 ${before.top - after.top}px` }, { translate: '0 0' }], { duration: 180, easing: 'ease-out' })
    })
  }

  function onCancel(event: PointerEvent) {
    if (event.pointerId === pointerId) finish()
  }

  function onKey(event: KeyboardEvent) {
    if (event.key !== 'Escape') return
    event.stopPropagation()
    finish()
  }

  function finish() {
    cancelAnimationFrame(frame)
    document.removeEventListener('pointermove', onMove)
    document.removeEventListener('pointerup', onUp)
    document.removeEventListener('pointercancel', onCancel)
    touched?.removeEventListener('touchmove', followTouch as EventListener)
    touched?.removeEventListener('touchend', drop)
    touched?.removeEventListener('touchcancel', finish)
    touched = null
    window.removeEventListener('keydown', onKey, true)
    document.documentElement.classList.remove('dragging-row')
    const list = options.list.value
    if (list) {
      delete list.dataset.drop
      for (const name of ['--drop-y', '--drop-x', '--drop-w']) list.style.removeProperty(name)
    }
    if (item) {
      item.classList.remove('dragging')
      item.style.translate = ''
    }
    item = null
    pointerId = -1
    dragging.value = null
  }

  function followTouch(event: TouchEvent) {
    if (event.cancelable) event.preventDefault()
    const touch = event.touches[0]
    if (!touch || dragging.value === null) return
    lastY = touch.clientY
    update()
  }

  // A finger dragging a row must not scroll the page under it. The listener has to be there before
  // the touch moves and must not be passive; it only acts while a drag is on.
  function holdTouch(event: TouchEvent) {
    if (dragging.value !== null && event.cancelable) event.preventDefault()
  }
  onMounted(() => document.addEventListener('touchmove', holdTouch, { passive: false }))
  onBeforeUnmount(() => {
    document.removeEventListener('touchmove', holdTouch)
    if (dragging.value !== null) finish()
  })

  return { start, dragging }
}
