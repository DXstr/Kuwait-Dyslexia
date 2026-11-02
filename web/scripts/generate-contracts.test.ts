// @vitest-environment node
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import * as ts from 'typescript'
import { afterEach, describe, expect, expectTypeOf, it } from 'vitest'
import { generateContractTypes, outputPath, schemaPath, updateContractTypes } from './generate-contracts.mjs'
import type {
  Error as ContractError,
  FingerprintResponse,
  Item,
  ParentReport,
  PhonemeResult,
  ScoreItemResponse,
  Stage0ScoreRequest,
  Stage0ScoreResponse,
} from '../src/contracts/basira'

const exec = promisify(execFile)
const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function temporaryOutput() {
  const directory = await mkdtemp(join(tmpdir(), 'basira-contract-types-'))
  temporaryDirectories.push(directory)
  return join(directory, 'basira.ts')
}

function diagnosticsFor(source: string) {
  // Compile a virtual test consumer; no fixture casts, generated-file edits or
  // temporary payload types are needed to hide assignability errors.
  const filename = fileURLToPath(new URL('./__fixture_typecheck__.ts', import.meta.url))
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2023,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowImportingTsExtensions: true,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    types: [],
  }
  const host = ts.createCompilerHost(options)
  const getSourceFile = host.getSourceFile.bind(host)
  host.getSourceFile = (path, languageVersion, ...rest) => path === filename
    ? ts.createSourceFile(path, source, languageVersion)
    : getSourceFile(path, languageVersion, ...rest)
  const program = ts.createProgram([filename], options, host)
  return ts.getPreEmitDiagnostics(program).map((diagnostic) =>
    ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
  )
}

describe('generated contracts', () => {
  it('is deterministic and byte-identical to the checked-in output', async () => {
    const generated = await generateContractTypes()
    expect(generated).toBe(await generateContractTypes())
    expect(generated).toBe(await readFile(outputPath, 'utf8'))
    const source = await readFile(schemaPath, 'utf8')
    const hash = createHash('sha256').update(source).digest('hex')
    expect(generated).toContain(`Source SHA-256: ${hash}`)
    expect(generated).toContain('GENERATED FILE — DO NOT EDIT.')
  })

  it('exports every canonical $def, including definitions not referenced by the registry root', async () => {
    const schema = JSON.parse(await readFile(schemaPath, 'utf8'))
    const source = ts.createSourceFile('basira.ts', await generateContractTypes(), ts.ScriptTarget.ES2023)
    const names = source.statements.flatMap((statement) =>
      (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) &&
      statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
        ? [statement.name.text]
        : [],
    )
    expect(names).toEqual(expect.arrayContaining(Object.keys(schema.$defs)))
  })

  it('writes generated output and checks it without rewriting the file', async () => {
    const destination = await temporaryOutput()
    await updateContractTypes({ destination })
    const before = await stat(destination)
    await updateContractTypes({ destination, check: true })
    expect((await stat(destination)).mtimeMs).toBe(before.mtimeMs)
    expect(await readFile(destination, 'utf8')).toBe(await readFile(outputPath, 'utf8'))
  })

  it('fails for stale output without silently repairing it', async () => {
    const destination = await temporaryOutput()
    await writeFile(destination, '// Deliberately stale test output.\n', 'utf8')
    await expect(updateContractTypes({ destination, check: true })).rejects.toThrow('types are stale')
    expect(await readFile(destination, 'utf8')).toBe('// Deliberately stale test output.\n')
  })

  it('fails for missing output without creating it', async () => {
    const destination = await temporaryOutput()
    await expect(updateContractTypes({ destination, check: true })).rejects.toThrow('types are missing')
    await expect(stat(destination)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('resolves the canonical schema and output independently of the caller working directory', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'basira-contract-cwd-'))
    temporaryDirectories.push(directory)
    const script = fileURLToPath(new URL('./generate-contracts.mjs', import.meta.url))
    const result = await exec(process.execPath, [script, '--check'], { cwd: directory })
    expect(result.stdout).toContain('Generated contract types are current.')
  })

  it('rejects unsupported CLI options rather than writing output', async () => {
    const script = fileURLToPath(new URL('./generate-contracts.mjs', import.meta.url))
    await expect(exec(process.execPath, [script, '--invalid'])).rejects.toMatchObject({ code: 1 })
  })

  it('typechecks every existing contract fixture against its named generated type without casts', async () => {
    const fixtures = fileURLToPath(new URL('../../contracts/fixtures/', import.meta.url))
    const files = (await readdir(fixtures)).filter((name) => name.endsWith('.json')).sort()
    expect(files.length).toBeGreaterThan(0)
    const declarations = await Promise.all(files.map(async (file, index) => {
      const name = file.split('.')[0]
      const fixture = JSON.parse(await readFile(join(fixtures, file), 'utf8'))
      return `const fixture${index} = ${JSON.stringify(fixture)} satisfies Contracts.${name};`
    }))
    const source = `import type * as Contracts from ${JSON.stringify(outputPath)};\n${declarations.join('\n')}`
    expect(diagnosticsFor(source)).toEqual([])
  })

  it('proves the fixture typecheck rejects mismatches instead of merely transpiling them', () => {
    const source = `import type { ParentReport } from ${JSON.stringify(outputPath)};\nconst language: ParentReport['language'] = 'en';`
    expect(diagnosticsFor(source)).toEqual(expect.arrayContaining([
      expect.stringContaining('not assignable to type'),
    ]))
  })
})

// These assertions are checked by `tsc -b`, not just executed by Vitest.
describe('generated type fidelity', () => {
  it('preserves approval, Arabic-only report and validated-item literals', () => {
    expectTypeOf<FingerprintResponse['review_status']>().toEqualTypeOf<'pending_review'>()
    expectTypeOf<ParentReport['language']>().toEqualTypeOf<'ar'>()
    expectTypeOf<Item['validation']['passed']>().toEqualTypeOf<true>()
    expectTypeOf<ParentReport['home_plan']['length']>().toEqualTypeOf<1 | 2 | 3>()
  })

  it('distinguishes required nullable fields from optional fields', () => {
    expectTypeOf<PhonemeResult['heard_ipa']>().toEqualTypeOf<string | null>()
    expectTypeOf<PhonemeResult['expected_letter']>().toEqualTypeOf<string | null>()
    expectTypeOf<FingerprintResponse['features']['wcpm']>().toEqualTypeOf<number | null>()
    expectTypeOf<Stage0ScoreResponse['scaled_score']>().toEqualTypeOf<number | null>()
    expectTypeOf<Item['audio_path']>().toEqualTypeOf<string | null>()
    expectTypeOf<ScoreItemResponse['wcpm']>().toEqualTypeOf<number | null | undefined>()
    expectTypeOf<Stage0ScoreRequest['responses'][number]['time_ms']>().toEqualTypeOf<number | undefined>()
  })

  it('retains synthetic markers, dialect status and the aliased scorer error type', () => {
    expectTypeOf<ScoreItemResponse['synthetic']>().toEqualTypeOf<boolean>()
    expectTypeOf<PhonemeResult['status']>().extract<'dialect_variant'>().toEqualTypeOf<'dialect_variant'>()
    expectTypeOf<ContractError['error']['code']>().extract<'unauthorized'>().toEqualTypeOf<'unauthorized'>()
    expectTypeOf<Extract<keyof ParentReport, 'score' | 'risk_level' | 'label'>>().toBeNever()
  })
})
