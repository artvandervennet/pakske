// The pages search engines may index, in both languages, each with its other language beside it
// (shared/utils/seo.ts).

import { sitemapXml } from '../../shared/utils/seo'

export default defineEventHandler((event) => {
  setResponseHeader(event, 'Content-Type', 'application/xml; charset=utf-8')
  return sitemapXml(siteOrigin(event))
})
