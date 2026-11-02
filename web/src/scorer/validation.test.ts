import { describe, expect, it } from 'vitest'
import { ContractValidationError, parseContract, type ContractName } from './validation'

const fixtures = import.meta.glob('../../../contracts/fixtures/*.json', {
  eager: true,
  import: 'default',
}) as Record<string, unknown>

const fixtureContracts: Record<string, ContractName> = {
  'Error.unauthorized.json': 'Error',
  'FingerprintRequest.example.json': 'FingerprintRequest',
  'FingerprintResponse.example.json': 'FingerprintResponse',
  'Health.ok.json': 'Health',
  'ItemBank.sample.json': 'ItemBank',
  'ParentReport.sample.json': 'ParentReport',
  'PhoneticInventory.sample.json': 'PhoneticInventory',
  'ProbeRequest.example.json': 'ProbeRequest',
  'ProbeResponse.example.json': 'ProbeResponse',
  'PromptBank.sample.json': 'PromptBank',
  'ScoreItemRequestMeta.example.json': 'ScoreItemRequestMeta',
  'ScoreItemResponse.dialect-variant.json': 'ScoreItemResponse',
  'ScoreItemResponse.dot-confusion.json': 'ScoreItemResponse',
  'Stage0ScoreRequest.example.json': 'Stage0ScoreRequest',
  'Stage0ScoreResponse.license-pending.json': 'Stage0ScoreResponse',
}

function fixture(name: string): unknown {
  const path = Object.keys(fixtures).find((candidate) => candidate.endsWith(`/${name}`))
  if (!path) throw new Error(`Missing test fixture: ${name}`)
  return fixtures[path]
}

const clone = <T>(value: T): T => structuredClone(value)

describe('canonical scorer contract validator', () => {
  it('validates every canonical fixture and returns the same object reference', () => {
    expect(Object.keys(fixtures)).toHaveLength(Object.keys(fixtureContracts).length)
    for (const [filename, contractName] of Object.entries(fixtureContracts)) {
      const value = fixture(filename)
      expect(parseContract(contractName, value)).toBe(value)
    }
  })

  it('enforces nested required and additional-property constraints', () => {
    const itemBank = clone(fixture('ItemBank.sample.json')) as Record<string, unknown>
    const items = itemBank.items as Record<string, unknown>[]
    items[0].unexpected = 'secret-value'
    expect(() => parseContract('ItemBank', itemBank)).toThrow(ContractValidationError)

    const promptBank = clone(fixture('PromptBank.sample.json')) as Record<string, unknown>
    const prompts = promptBank.prompts as Record<string, unknown>[]
    delete prompts[0].validation
    expect(() => parseContract('PromptBank', promptBank)).toThrow(ContractValidationError)
  })

  it.each([
    ['ItemBank', 'ItemBank.sample.json', 'generated_at', 'not-a-date'],
    ['PromptBank', 'PromptBank.sample.json', 'generated_at', 'not-a-date'],
    ['ParentReport', 'ParentReport.sample.json', 'session_date', '2026-99-99'],
  ] as const)('enforces the canonical %s date format', (contractName, filename, property, value) => {
    const payload = clone(fixture(filename)) as Record<string, unknown>
    payload[property] = value
    expect(() => parseContract(contractName, payload)).toThrow(ContractValidationError)
  })

  it('does not coerce, default, remove, or disclose invalid input', () => {
    const payload = clone(fixture('ScoreItemRequestMeta.example.json')) as Record<string, unknown>
    payload.item_id = 42
    payload.secret = 'never-repeat-this-secret'
    const parse = () => parseContract('ScoreItemRequestMeta', payload)
    expect(parse).toThrow(ContractValidationError)
    try {
      parse()
    } catch (error) {
      expect(String(error)).not.toContain('never-repeat-this-secret')
      expect(error).toMatchObject({ contractName: 'ScoreItemRequestMeta', keyword: expect.any(String), instancePath: expect.any(String) })
    }
    expect(payload.item_id).toBe(42)
    expect(payload.secret).toBe('never-repeat-this-secret')
  })
})
