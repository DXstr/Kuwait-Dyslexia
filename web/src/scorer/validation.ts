import Ajv2020 from 'ajv/dist/2020'
import type { ValidateFunction } from 'ajv'
import addFormats from 'ajv-formats'
import canonicalSchema from '../../../contracts/schemas/basira.schema.json'
import type {
  Error,
  ErrorCategory,
  FingerprintRequest,
  FingerprintResponse,
  Health,
  Item,
  ItemBank,
  ItemType,
  ParentReport,
  MouthShape,
  PhoneticInventory,
  PhoneticLetter,
  PhoneticReview,
  PhonemeResult,
  ProbeRequest,
  ProbeResponse,
  PromptBank,
  PromptClip,
  PromptTrigger,
  ReviewStatus,
  ScoreItemRequestMeta,
  ScoreItemResponse,
  SkillEvidence,
  SkillId,
  Stage0Construct,
  Stage0ScoreRequest,
  Stage0Block,
  Stage0Option,
  Stage0ScoreResponse,
  Stage0TaskItem,
  Stage0TaskSet,
  TaskReview,
  VowelModifier,
} from '../contracts/basira'

export type ContractPayloads = {
  SkillId: SkillId
  ErrorCategory: ErrorCategory
  ReviewStatus: ReviewStatus
  ItemType: ItemType
  PhonemeResult: PhonemeResult
  SkillEvidence: SkillEvidence
  ScoreItemRequestMeta: ScoreItemRequestMeta
  ScoreItemResponse: ScoreItemResponse
  FingerprintRequest: FingerprintRequest
  FingerprintResponse: FingerprintResponse
  ProbeRequest: ProbeRequest
  ProbeResponse: ProbeResponse
  Stage0Construct: Stage0Construct
  Stage0ScoreRequest: Stage0ScoreRequest
  Stage0ScoreResponse: Stage0ScoreResponse
  Stage0Option: Stage0Option
  Stage0TaskItem: Stage0TaskItem
  Stage0Block: Stage0Block
  Stage0TaskSet: Stage0TaskSet
  TaskReview: TaskReview
  Health: Health
  Error: Error
  ItemBank: ItemBank
  Item: Item
  PromptTrigger: PromptTrigger
  PromptClip: PromptClip
  PromptBank: PromptBank
  ParentReport: ParentReport
  MouthShape: MouthShape
  PhoneticInventory: PhoneticInventory
  PhoneticLetter: PhoneticLetter
  PhoneticReview: PhoneticReview
  VowelModifier: VowelModifier
}

export type ContractName = keyof ContractPayloads

const CONTRACT_NAMES = [
  'SkillId',
  'ErrorCategory',
  'ReviewStatus',
  'ItemType',
  'PhonemeResult',
  'SkillEvidence',
  'ScoreItemRequestMeta',
  'ScoreItemResponse',
  'FingerprintRequest',
  'FingerprintResponse',
  'ProbeRequest',
  'ProbeResponse',
  'Stage0Construct',
  'Stage0ScoreRequest',
  'Stage0ScoreResponse',
  'Stage0Option',
  'Stage0TaskItem',
  'Stage0Block',
  'Stage0TaskSet',
  'TaskReview',
  'Health',
  'Error',
  'ItemBank',
  'Item',
  'PromptTrigger',
  'PromptClip',
  'PromptBank',
  'ParentReport',
  'MouthShape',
  'PhoneticInventory',
  'PhoneticLetter',
  'PhoneticReview',
  'VowelModifier',
] as const satisfies readonly ContractName[]

const ajv = new Ajv2020({
  allErrors: false,
  allowUnionTypes: true,
  ownProperties: true,
})
addFormats(ajv)
ajv.addSchema(canonicalSchema)

const validators = Object.fromEntries(
  CONTRACT_NAMES.map((name) => [
    name,
    ajv.compile({ $ref: `${canonicalSchema.$id}#/$defs/${name}` }),
  ]),
) as Record<ContractName, ValidateFunction>

const SAFE_KEYWORD = /^[A-Za-z][A-Za-z0-9_-]*$/
const SAFE_INSTANCE_PATH = /^(?:\/(?:[A-Za-z0-9_.~-]+|\d+))*$/

function safeKeyword(keyword: string | undefined): string {
  return keyword && SAFE_KEYWORD.test(keyword) ? keyword : 'validation'
}

function safeInstancePath(instancePath: string | undefined): string {
  return instancePath && SAFE_INSTANCE_PATH.test(instancePath) ? instancePath : '/'
}

export class ContractValidationError extends Error {
  readonly contractName: ContractName
  readonly keyword: string
  readonly instancePath: string

  constructor(contractName: ContractName, keyword?: string, instancePath?: string) {
    const safeKeywordValue = safeKeyword(keyword)
    const safeInstancePathValue = safeInstancePath(instancePath)
    super(`Contract validation failed for ${contractName} at ${safeInstancePathValue} (${safeKeywordValue})`)
    this.name = 'ContractValidationError'
    this.contractName = contractName
    this.keyword = safeKeywordValue
    this.instancePath = safeInstancePathValue
  }
}

export function parseContract<K extends ContractName>(name: K, data: unknown): ContractPayloads[K] {
  const validator = validators[name]
  if (!validator || !validator(data)) {
    const error = validator?.errors?.[0]
    throw new ContractValidationError(name, error?.keyword, error?.instancePath)
  }
  return data as ContractPayloads[K]
}
