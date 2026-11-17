// Gesso's components need the DOM (CSSStyleSheet, HTMLElement), so they are only loaded in the
// browser. The server sends plain HTML and the elements upgrade it.
import '@vandervennet/gesso/components/art-header.js'
import '@vandervennet/gesso/components/art-button.js'
import '@vandervennet/gesso/components/art-canvas.js'
import '@vandervennet/gesso/components/art-tape.js'
import '@vandervennet/gesso/components/art-decor.js'
import '@vandervennet/gesso/components/art-scheme.js'
import '@vandervennet/gesso/components/art-signature.js'
import '@vandervennet/gesso/components/art-stroke.js'

export default defineNuxtPlugin(() => {})
