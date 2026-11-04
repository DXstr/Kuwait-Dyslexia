import type { ParentReport } from '../contracts/basira'
import type { ParentReportRow, PlanRow, ReviewSessionDetail } from '../review/types'
import type { FingerprintRow } from '../review/types'
import type { createParentReportRepository } from './repository'

export type ParentReportCopy = {
  progressNotes: ParentReport['progress_notes']
  homePlan: ParentReport['home_plan']
  nextFocusAr: string
  specialist: ParentReport['specialist']
}

export type ApprovedReportSource = {
  detail: ReviewSessionDetail
  fingerprint: FingerprintRow
  plan: PlanRow
}

export type ParentReportBuildErrorCode =
  | 'invalid_source'
  | 'source_not_approved'
  | 'source_mismatch'
  | 'invalid_copy'

export class ParentReportBuildError extends Error {
  readonly code: ParentReportBuildErrorCode

  constructor(code: ParentReportBuildErrorCode) {
    super(`parent_report_build:${code}`)
    this.name = 'ParentReportBuildError'
    this.code = code
  }
}

export type GuardianReportRow = ParentReportRow & {
  child_first_name: string
  child_is_demo: boolean
}

export type ParentReportRepositoryIssue =
  | 'unavailable'
  | 'unauthorized'
  | 'forbidden'
  | 'cancelled'
  | 'timeout'
  | 'network'
  | 'schema'
  | 'conflict'

export class ParentReportRepositoryError extends Error {
  readonly issue: ParentReportRepositoryIssue
  readonly retryable: boolean

  constructor(issue: ParentReportRepositoryIssue, retryable = false) {
    super(`parent_report_repository:${issue}`)
    this.name = 'ParentReportRepositoryError'
    this.issue = issue
    this.retryable = retryable
  }
}

export type ParentReportRepository = {
  createDraft(source: ApprovedReportSource, copy: ParentReportCopy, signal?: AbortSignal): Promise<ParentReportRow>
  listGuardianReports(signal?: AbortSignal): Promise<GuardianReportRow[]>
  getGuardianReport(reportId: string, signal?: AbortSignal): Promise<GuardianReportRow>
  dispose(): void
}

export type ParentReportRepositoryFactory = Parameters<
  typeof createParentReportRepository
>

export type { ParentReport }
