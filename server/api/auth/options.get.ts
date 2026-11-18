// The ways to log in this site offers: Google only when whoever runs it set it up (.env), both
// at Google and at Firebase, which keeps the link between a Google account and an account here.
export default defineEventHandler(() => {
  const config = useRuntimeConfig()
  const google = config.oauth?.google
  return { google: Boolean(google?.clientId && google?.clientSecret && config.firebase.apiKey) }
})
