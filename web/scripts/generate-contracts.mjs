import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compile } from 'json-schema-to-typescript'

export const schemaPath = fileURLToPath(new URL('../../contracts/schemas/basira.schema.json', import.meta.url))
export const outputPath = fileURLToPath(new URL('../src/contracts/basira.ts', import.meta.url))

export async function generateContractTypes() {
  const source = await readFile(schemaPath, 'utf8')
  const hash = createHash('sha256').update(source).digest('hex')
  return compile(JSON.parse(source), 'BasiraContracts', {
    cwd: dirname(schemaPath),
    unreachableDefinitions: true,
    unknownAny: true,
    bannerComment: [
      '/**',
      ' * GENERATED FILE — DO NOT EDIT.',
      ' * Source: contracts/schemas/basira.schema.json',
      ` * Source SHA-256: ${hash}`,
      ' * Generator: json-schema-to-typescript (version pinned in package-lock.json).',
      ' * Regenerate from web/: npm run generate:contracts',
      ' * These types are not runtime validation or database authorization.',
      ' */',
    ].join('\n'),
    style: {
      singleQuote: true,
      semi: false,
      tabWidth: 2,
      trailingComma: 'all',
      printWidth: 100,
      endOfLine: 'lf',
    },
  })
}

/** @param {{ check?: boolean, destination?: string }} [options] */
export async function updateContractTypes({ check = false, destination = outputPath } = {}) {
  const generated = await generateContractTypes()
  if (check) {
    let existing
    try {
      existing = await readFile(destination, 'utf8')
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        throw new Error('Generated contract types are missing. Run npm run generate:contracts.', { cause: error })
      }
      throw error
    }
    if (existing !== generated) {
      throw new Error('Generated contract types are stale. Run npm run generate:contracts and commit the result.')
    }
    return
  }
  await mkdir(dirname(destination), { recursive: true })
  await writeFile(destination, generated, 'utf8')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2)
    if (args.length > 1 || (args.length === 1 && args[0] !== '--check')) {
      throw new Error('Usage: node scripts/generate-contracts.mjs [--check]')
    }
    const check = args[0] === '--check'
    await updateContractTypes({ check })
    console.log(check ? 'Generated contract types are current.' : 'Generated src/contracts/basira.ts.')
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
