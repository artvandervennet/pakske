// The state every form here needs: is it busy, what went wrong, and which fields.
// `submit` does the request and whatever follows a success; a thrown error ends up in
// `message` and `errors`, and focus moves to the first field that needs fixing.
export function useForm(submit: () => Promise<void>) {
  const { parse } = useApiError()
  const form = ref<HTMLFormElement>()
  const pending = ref(false)
  const message = ref('')
  const errors = ref<Record<string, string>>({})

  async function run() {
    if (pending.value) return
    pending.value = true
    message.value = ''
    errors.value = {}
    try {
      await submit()
    }
    catch (error) {
      const parsed = parse(error)
      message.value = parsed.message
      errors.value = parsed.fields
      await nextTick()
      form.value?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
    }
    finally {
      pending.value = false
    }
  }

  return { form, pending, message, errors, run }
}
