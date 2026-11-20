const isProd = process.env.NODE_ENV === 'production'

// Sets the saved colour scheme before the stylesheets apply, so the page never flashes the wrong one.
// <art-scheme remember> writes the same key.
const schemeScript = `try{document.documentElement.dataset.scheme=localStorage.getItem('gesso-scheme')||'auto'}catch{}`

export default defineNuxtConfig({
  compatibilityDate: '2026-11-01',
  devtools: { enabled: false },
  // Not 3000: on this machine another project's Docker container already publishes that port,
  // and a browser that picks IPv4 for "localhost" would reach that container.
  devServer: { port: 3400 },
  modules: ['nuxt-auth-utils', '@nuxtjs/i18n'],
  css: ['~/assets/css/main.css'],

  // The dev server answers only to the names it knows. This lets `tailscale serve` put it on a
  // phone over https, at the Mac's name in the tailnet; nothing outside the tailnet gets there.
  vite: { server: { allowedHosts: ['.ts.net'] } },

  vue: {
    compilerOptions: {
      // Gesso's components are native custom elements, registered in app/plugins/gesso.client.ts.
      isCustomElement: tag => tag.startsWith('art-'),
    },
  },

  app: {
    head: {
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'robots', content: 'noindex, nofollow' },
      ],
      // A present in the hero's red and yellow. The .ico is for browsers without SVG icons.
      link: [
        { rel: 'icon', href: '/favicon.ico', sizes: '32x32 48x48' },
        { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
        { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
      ],
      script: [{ innerHTML: schemeScript, tagPosition: 'head' }],
    },
  },

  runtimeConfig: {
    // NUXT_DATA_DIR: where the SQLite file and the uploaded images live.
    dataDir: '.data',
    // NUXT_MAX_USERS: registration closes when this many accounts exist.
    maxUsers: 200,
    // NUXT_TRUST_PROXY=true when a reverse proxy of yours sets X-Forwarded-For and X-Forwarded-Host.
    trustProxy: false,
    // Firebase Authentication holds the passwords and sends the emails (server/utils/firebase.ts).
    firebase: {
      // NUXT_FIREBASE_API_KEY: the Web API key of the Firebase project.
      apiKey: '',
      // NUXT_FIREBASE_AUTH_EMULATOR_HOST: host:port of the Firebase emulator, for trying it locally.
      authEmulatorHost: '',
    },
    public: {
      // Who runs this site, for its privacy page and its terms (shared/utils/legal.ts). All
      // three may stay empty; the pages then say "the person who runs this site".
      operator: {
        // NUXT_PUBLIC_OPERATOR_NAME: the person or organisation that answers for the site.
        name: '',
        // NUXT_PUBLIC_OPERATOR_EMAIL: where questions about someone's data go. Shown on both pages.
        email: '',
        // NUXT_PUBLIC_OPERATOR_NETWORK: a company whose tunnel or proxy carries the traffic, e.g. Cloudflare.
        network: '',
        // NUXT_PUBLIC_OPERATOR_BACKUPS: a company that stores the nightly, encrypted backups (deploy/backup.sh).
        backups: '',
      },
    },
    session: {
      maxAge: 60 * 60 * 24 * 60,
      // NUXT_SESSION_COOKIE_SECURE=false when the site is served over plain http.
      cookie: { secure: isProd },
    },
  },

  i18n: {
    defaultLocale: 'nl',
    strategy: 'prefix_except_default',
    detectBrowserLanguage: false,
    locales: [
      { code: 'nl', language: 'nl-BE', name: 'Nederlands', file: 'nl.json' },
      { code: 'en', language: 'en-GB', name: 'English', file: 'en.json' },
    ],
  },

  typescript: { strict: true },
})
