/**
 * A ref for a form field that keeps what is already in the field when the page comes alive.
 *
 * The server sends the form as HTML, and the browser (or a password manager, or a fast typist)
 * may fill a field before Vue takes over. Vue would then put its own empty value back. Reading
 * the field once, while Vue is taking over, keeps what was typed.
 */
export function useFieldValue(id: string, initial = '') {
  const filled = import.meta.client && useNuxtApp().isHydrating
    ? (document.getElementById(id) as HTMLInputElement | null)?.value
    : undefined
  return ref(filled || initial)
}
