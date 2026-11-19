import type { InjectionKey } from 'vue'

/** A wish's picture to show large: its address, and the wish's title to name it by. */
export interface ViewedPicture {
  src: string
  title: string
}

/**
 * Shows a picture large. `from` is the picture as the page already shows it: its own size is
 * known from it at once, so the large one opens in its shape without waiting to load.
 */
export type ViewPicture = (picture: ViewedPicture, from?: HTMLImageElement | null) => void

const key: InjectionKey<ViewPicture> = Symbol('picture-viewer')

// The page has one viewer (<PictureViewer>) for all its rows. The page provides how to open
// it, and a wish's picture opens it through that.
export function providePictureViewer(view: ViewPicture) {
  provide(key, view)
}

/** How to show a picture large, or null on a page without a viewer: the picture is then only a picture. */
export function usePictureViewer(): ViewPicture | null {
  return inject(key, null)
}
