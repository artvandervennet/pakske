// After a navigation inside the site the browser leaves the focus where it was: on the link
// that was pressed, or nowhere when that link went with its page. A full page load starts at
// the top of the page, so this does the same: the focus goes to <main>, and the next Tab goes
// to the first control of the new page. <NuxtRouteAnnouncer> in app.vue says the page's title.
// Only when the page itself changed: the tabs and the search on the lists page change the
// address too, and keep the focus where it is.
export function useRouteFocus() {
  if (import.meta.server) return
  let changed = false
  useRouter().afterEach((to, from) => {
    if (to.path !== from.path) changed = true
  })
  useNuxtApp().hook('page:finish', () => {
    if (!changed) return
    changed = false
    document.getElementById('main')?.focus({ preventScroll: true })
  })
}
