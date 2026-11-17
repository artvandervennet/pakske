import type { InjectionKey } from 'vue'

/** Asks an owner whether to go on ticking their own wish; true means go on. */
export type AskTickWarning = (title: string) => Promise<boolean>

const key: InjectionKey<AskTickWarning> = Symbol('tick-warning')

// The page has one warning dialog for all its rows. The page provides how to ask, and each
// row's tick asks through it.
export function provideTickWarning(ask: AskTickWarning) {
  provide(key, ask)
}

export function useTickWarning(): AskTickWarning {
  const ask = inject(key, null)
  // Without a dialog an owner could tick their own wish unwarned. Better to fail loudly.
  if (!ask) throw new Error('useTickWarning() needs a page that calls provideTickWarning()')
  return ask
}
