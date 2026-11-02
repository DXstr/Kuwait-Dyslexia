import { describe, expect, it } from 'vitest'
import { ar, en } from '../i18n/messages'
import { canAccess, canUseEnglish } from './roles'

describe('catalogue completeness', () => {
  it('has a nonempty English translation for every Arabic message', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(ar).sort())
    for (const value of Object.values(en)) expect(value.trim().length).toBeGreaterThan(0)
  })

  it('keeps every default message in Arabic except the professional English switch label', () => {
    for (const [key, value] of Object.entries(ar)) {
      if (key !== 'switchToEnglish') expect(value).toMatch(/[\u0600-\u06ff]/)
    }
  })
})

describe('route policies', () => {
  it('never grants access without an authenticated application role', () => {
    expect(canAccess(null, ['guardian', 'specialist', 'examiner', 'admin'])).toBe(false)
  })

  it('does not treat admin as a clinical supervisor', () => {
    expect(canAccess('admin', ['specialist', 'examiner'])).toBe(false)
  })

  it.each(['/child', '/guardian', '/admin', '/', '/specialist/unknown'])('never enables English at %s', (path) => {
    expect(canUseEnglish('specialist', path)).toBe(false)
    expect(canUseEnglish('examiner', path)).toBe(false)
  })
})
