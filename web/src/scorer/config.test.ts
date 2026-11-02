import { describe, expect, it } from 'vitest'
import { readScorerConfig } from './config'

describe('scorer configuration', () => {
  it('defaults to mock mode with no URL', () => {
    expect(readScorerConfig({})).toEqual({ mode: 'mock', baseUrl: null })
    expect(readScorerConfig({ VITE_SCORER_MODE: '  ', VITE_SCORER_URL: '   ' }))
      .toEqual({ mode: 'mock', baseUrl: null })
  })

  it('allows a configured URL in mock mode for a mode-only switch', () => {
    expect(readScorerConfig({ VITE_SCORER_URL: 'https://scorer.example/api/' }))
      .toEqual({ mode: 'mock', baseUrl: 'https://scorer.example/api' })
    expect(readScorerConfig({ VITE_SCORER_MODE: 'mock', VITE_SCORER_URL: 'https://scorer.example/api///' }))
      .toEqual({ mode: 'mock', baseUrl: 'https://scorer.example/api' })
  })

  it.each([
    'https://scorer.example',
    'https://scorer.example/api/v1',
    'http://localhost:8000',
    'http://127.0.0.1:8000/api',
    'http://[::1]:8000/api',
  ])('accepts a secure or loopback scorer URL: %s', (url) => {
    expect(readScorerConfig({ VITE_SCORER_MODE: 'real', VITE_SCORER_URL: url })).toEqual({
      mode: 'real',
      baseUrl: url,
    })
  })

  it('requires a URL in real mode', () => {
    expect(() => readScorerConfig({ VITE_SCORER_MODE: 'real' })).toThrow('Scorer configuration is invalid')
  })

  it.each(['MOCK', 'REAL', 'mock ', ' real', 1, true])('accepts no mode except exact mock or real: %s', (mode) => {
    expect(() => readScorerConfig({ VITE_SCORER_MODE: mode })).toThrow('Scorer configuration is invalid')
  })

  it.each([
    'http://scorer.example',
    'https://user:pass@scorer.example',
    'https://@scorer.example',
    'https://scorer.example/api?token=secret',
    'https://scorer.example/api?',
    'https://scorer.example/api#fragment',
    'https://scorer.example/api#',
    ' https://scorer.example',
    'https://scorer.example/api\n',
    '//scorer.example/api',
  ])('rejects an unsafe scorer URL: %s', (url) => {
    expect(() => readScorerConfig({ VITE_SCORER_URL: url })).toThrow('Scorer configuration is invalid')
  })

  it('rejects the mismatched legacy variable without echoing its value', () => {
    const legacy = 'https://legacy.example/with-a-secret'
    const parse = () => readScorerConfig({ VITE_SCORER_BASE_URL: legacy })
    expect(parse).toThrow('Scorer configuration is invalid')
    try {
      parse()
    } catch (error) {
      expect(String(error)).not.toContain(legacy)
    }
  })
})
