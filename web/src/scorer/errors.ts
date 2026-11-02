import type { Error as ContractError } from '../contracts/basira'

export type ScorerIssue =
  | 'configuration'
  | 'unauthorized'
  | 'forbidden'
  | 'invalidRequest'
  | 'invalidAudio'
  | 'invalidResponse'
  | 'responseMismatch'
  | 'fixtureUnavailable'
  | 'network'
  | 'timeout'
  | 'cancelled'
  | 'remote'

/** Deliberately excludes remote messages and payloads from exceptions/logs. */
export class ScorerClientError extends Error {
  readonly issue: ScorerIssue
  readonly status: number | null
  readonly remoteCode: ContractError['error']['code'] | null
  readonly retryAfterSeconds: number | null

  constructor(issue: ScorerIssue, details: {
    status?: number
    remoteCode?: ContractError['error']['code']
    retryAfterSeconds?: number | null
  } = {}) {
    super(`scorer: ${issue}`)
    this.name = 'ScorerClientError'
    this.issue = issue
    this.status = details.status ?? null
    this.remoteCode = details.remoteCode ?? null
    this.retryAfterSeconds = details.retryAfterSeconds ?? null
  }
}
