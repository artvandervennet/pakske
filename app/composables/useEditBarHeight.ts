import type { ShallowRef } from 'vue'

/**
 * Tells the page how tall its edit bar (.joint-bar) is. The bar sticks under the header while
 * the rows scroll; app.css adds its height to the scroll padding, so a row that gets the focus
 * scrolls to under the bar and not to behind it.
 */
export function useEditBarHeight(bar: Readonly<ShallowRef<HTMLElement | null>>) {
  let observer: ResizeObserver | undefined
  watch(bar, (element) => {
    observer?.disconnect()
    const root = document.documentElement
    if (!element) return root.style.removeProperty('--edit-bar-height')
    observer = new ResizeObserver(() => root.style.setProperty('--edit-bar-height', `${element.offsetHeight}px`))
    observer.observe(element)
  }, { flush: 'post' })
  onBeforeUnmount(() => {
    observer?.disconnect()
    document.documentElement.style.removeProperty('--edit-bar-height')
  })
}
