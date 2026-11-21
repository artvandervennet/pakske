import { describe, expect, it } from 'vitest'
import { bodyRefusal } from '../server/utils/body-limit'
import { UPLOAD_MAX_BYTES } from '../server/utils/uploads'

describe('refusing a body before it is read', () => {
  it('lets a small body through and refuses a large one', () => {
    expect(bodyRefusal('POST', '/api/lists', '200', undefined)).toBeNull()
    expect(bodyRefusal('POST', '/api/lists', String(16 * 1024), undefined)).toBeNull()
    expect(bodyRefusal('POST', '/api/lists', String(16 * 1024 + 1), undefined)).toBe(413)
    expect(bodyRefusal('PATCH', '/api/me', 'many', undefined)).toBe(413)
  })

  it('gives only a picture more room', () => {
    expect(bodyRefusal('PUT', '/api/lists/t/wishes/1/image', String(UPLOAD_MAX_BYTES), undefined)).toBeNull()
    expect(bodyRefusal('PUT', '/api/lists/t/wishes/1/image', String(UPLOAD_MAX_BYTES + 64 * 1024 + 1), undefined)).toBe(413)
  })

  it('gives the wishes of an import room for a hundred of them', () => {
    expect(bodyRefusal('POST', '/api/lists/t/wishes/import', String(256 * 1024), undefined)).toBeNull()
    expect(bodyRefusal('POST', '/api/lists/t/wishes/import', String(256 * 1024 + 1), undefined)).toBe(413)
    expect(bodyRefusal('POST', '/api/lists/t/wishes/import', undefined, undefined)).toBe(411)
    // Reading a paste, and adding one wish, stay small.
    expect(bodyRefusal('POST', '/api/import/read', String(16 * 1024 + 1), undefined)).toBe(413)
    expect(bodyRefusal('POST', '/api/lists/t/wishes', String(16 * 1024 + 1), undefined)).toBe(413)
  })

  it('refuses a body that does not say how long it is', () => {
    expect(bodyRefusal('POST', '/api/lists', undefined, undefined)).toBe(411)
    expect(bodyRefusal('PUT', '/api/me/password', undefined, 'chunked')).toBe(411)
  })

  // Deleting an account sends the password along, so a DELETE can carry a body too.
  it('holds a DELETE with a body to the same limit, and lets one without a body through', () => {
    expect(bodyRefusal('DELETE', '/api/me', undefined, undefined)).toBeNull()
    expect(bodyRefusal('DELETE', '/api/me', '40', undefined)).toBeNull()
    expect(bodyRefusal('DELETE', '/api/me', String(5 * 1024 * 1024), undefined)).toBe(413)
    expect(bodyRefusal('DELETE', '/api/me', undefined, 'chunked')).toBe(411)
  })
})
