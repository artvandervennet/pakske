// The ways to log in this site offers: Google only when whoever runs it set it up (.env).
export default defineEventHandler(() => {
  const google = useRuntimeConfig().oauth?.google
  return { google: Boolean(google?.clientId && google?.clientSecret) }
})
