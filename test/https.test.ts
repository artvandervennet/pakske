import { describe, expect, it } from 'vitest'
import { httpsAddress } from '../server/utils/https'

describe('sending a visitor who came over plain http to https', () => {
  it('gives the same page over https', () => {
    expect(httpsAddress('http', 'pakske.example.com', '/l/abc?x=1')).toBe('https://pakske.example.com/l/abc?x=1')
    expect(httpsAddress('HTTP', 'pakske.example.com:80', '/')).toBe('https://pakske.example.com/')
  })

  it('leaves a visitor on https, and a request no proxy spoke for, where they are', () => {
    expect(httpsAddress('https', 'pakske.example.com', '/')).toBeUndefined()
    expect(httpsAddress(undefined, 'pakske.example.com', '/')).toBeUndefined()
    expect(httpsAddress('', 'pakske.example.com', '/')).toBeUndefined()
  })

  it('believes the last proxy, which the visitor cannot make up', () => {
    expect(httpsAddress('https, http', 'pakske.example.com', '/')).toBe('https://pakske.example.com/')
    expect(httpsAddress('http, https', 'pakske.example.com', '/')).toBeUndefined()
  })

  it('sends nobody to an address that is not a host name', () => {
    expect(httpsAddress('http', undefined, '/')).toBeUndefined()
    expect(httpsAddress('http', 'evil.example/@pakske.example.com', '/')).toBeUndefined()
    expect(httpsAddress('http', 'pakske.example.com', 'l/abc')).toBeUndefined()
  })
})
