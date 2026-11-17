// People's names as one phrase in the page's language: "Art, Lotte en Sam", "Art, Lotte and Sam".
export function useNames() {
  const { locale } = useI18n()
  return (names: string[]): string =>
    new Intl.ListFormat(locale.value, { type: 'conjunction' }).format(names)
}
