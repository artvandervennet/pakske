// Turns a failed API call into sentences. The server answers with a code (and a code per
// field); the words come from the locale files, under `errors.*` and `fields.*`.
export function useApiError() {
  const { t, te } = useI18n()

  function parse(error: unknown): { code: string, message: string, fields: Record<string, string> } {
    const outer = (error as { data?: { data?: unknown } } | null)?.data
    const data = (outer?.data ?? outer ?? {}) as { code?: string, fields?: Record<string, string> }
    const code = data.code ?? 'unknown'
    const fields: Record<string, string> = {}
    for (const [name, fieldCode] of Object.entries(data.fields ?? {})) {
      fields[name] = te(`fields.${fieldCode}`) ? t(`fields.${fieldCode}`) : t('fields.invalid')
    }
    return { code, message: te(`errors.${code}`) ? t(`errors.${code}`) : t('errors.unknown'), fields }
  }

  return { parse }
}
