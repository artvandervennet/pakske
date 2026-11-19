import { describe, expect, it } from 'vitest'
import { shareMessage } from '../shared/utils/share'

describe('the message a share sheet gets', () => {
  // WhatsApp, Messages and Mail on a Mac or an iPhone send only the address when a page hands
  // them words and an address apart. So the address is part of the words.
  it('is the words with the address on a line of its own under them', () => {
    expect(shareMessage('Hey, hier is mijn verlanglijstje “Kerst”.', 'https://pakske.example/l/abc'))
      .toBe('Hey, hier is mijn verlanglijstje “Kerst”.\nhttps://pakske.example/l/abc')
  })
})
