// What crawlers may read (shared/utils/seo.ts). Made per request, because the sitemap it points
// to is a whole address and the site's name is whatever it is served at.

import { robotsTxt } from '../../shared/utils/seo'

export default defineEventHandler((event) => {
  setResponseHeader(event, 'Content-Type', 'text/plain; charset=utf-8')
  return robotsTxt(siteOrigin(event))
})
