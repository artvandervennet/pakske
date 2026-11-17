/**
 * Holding a row of a list: `onPress` runs after `ms` without the pointer moving more than `slop`
 * pixels. It listens on the list itself, so rows that come and go need nothing of their own.
 * A press only counts on the row's head outside its own controls (the tick, the tags, a field,
 * the handle), so holding those does what they always do. A quick swipe scrolls as usual: moving,
 * scrolling or the browser taking over the touch (`pointercancel`) cancels the press.
 * `onPress` gets the `pointerdown` that started it, so a drag can carry on with the same pointer.
 */
export function useLongPress(target: Ref<HTMLElement | null>, options: {
  enabled: () => boolean
  onPress: (wishId: number, event: PointerEvent) => void
  ms?: number
  slop?: number
}) {
  const ms = options.ms ?? 500
  const slop = options.slop ?? 8
  const controls = '.wish-tick, .wish-tags, .inline-edit, .wish-handle, a, input, textarea, select'

  let timer: ReturnType<typeof setTimeout> | undefined
  let start: PointerEvent | null = null
  // The pointer of the press that fired, until it is up again.
  let held: number | null = null

  function cancel() {
    clearTimeout(timer)
    timer = undefined
    start = null
  }

  /** The id of the row a press on this element belongs to, or null when it doesn't count. */
  function rowOf(element: Element | null): number | null {
    const head = element?.closest('.wish-head')
    if (!head || element!.closest(controls)) return null
    const id = Number(head.closest('li.wish-row')?.id.replace(/^wish-/, ''))
    return Number.isInteger(id) && id > 0 ? id : null
  }

  // The click that ends a long press must not open or tick the row. The next click is swallowed,
  // up to a moment after the press's pointer is up: a touch's click can come a little later.
  function swallowClick(pointerId: number) {
    const swallow = (event: Event) => {
      event.preventDefault()
      event.stopPropagation()
      window.removeEventListener('click', swallow, true)
    }
    const release = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return
      window.removeEventListener('pointerup', release, true)
      window.removeEventListener('pointercancel', release, true)
      setTimeout(() => window.removeEventListener('click', swallow, true), 400)
    }
    window.addEventListener('click', swallow, true)
    window.addEventListener('pointerup', release, true)
    window.addEventListener('pointercancel', release, true)
  }

  function onDown(event: PointerEvent) {
    cancel()
    if (!options.enabled() || !event.isPrimary) return
    if (event.pointerType === 'mouse' && event.button !== 0) return
    const id = rowOf(event.target as Element)
    if (id === null) return
    start = event
    timer = setTimeout(() => {
      const pressed = start
      timer = undefined
      start = null
      if (!pressed) return
      navigator.vibrate?.(10)
      held = pressed.pointerId
      swallowClick(pressed.pointerId)
      options.onPress(id, pressed)
    }, ms)
  }

  function onMove(event: PointerEvent) {
    if (!start || event.pointerId !== start.pointerId) return
    if (Math.hypot(event.clientX - start.clientX, event.clientY - start.clientY) > slop) cancel()
  }

  function onEnd(event: PointerEvent) {
    if (event.pointerId === held) held = null
    if (start && event.pointerId === start.pointerId) cancel()
  }

  // Holding a row would otherwise open the phone's own menu (or the browser's, on a computer).
  function onContextMenu(event: Event) {
    if (options.enabled() && rowOf(event.target as Element) !== null) event.preventDefault()
  }

  // The list can appear after the page mounts (its first wish), so its listeners follow the ref.
  watch(target, (list, old) => {
    old?.removeEventListener('pointerdown', onDown)
    old?.removeEventListener('contextmenu', onContextMenu)
    list?.addEventListener('pointerdown', onDown)
    list?.addEventListener('contextmenu', onContextMenu)
  }, { immediate: true, flush: 'post' })

  onMounted(() => {
    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('pointerup', onEnd, { passive: true })
    window.addEventListener('pointercancel', onEnd, { passive: true })
    window.addEventListener('scroll', cancel, { passive: true })
  })

  onBeforeUnmount(() => {
    cancel()
    target.value?.removeEventListener('pointerdown', onDown)
    target.value?.removeEventListener('contextmenu', onContextMenu)
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onEnd)
    window.removeEventListener('pointercancel', onEnd)
    window.removeEventListener('scroll', cancel)
  })

  /** Whether the pointer of a fired press is still down, so something can still follow it. */
  return { isHeld: (pointerId: number) => held === pointerId }
}
