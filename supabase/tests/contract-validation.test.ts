import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { checkValidation, generateUpgradeValidation, generateValidation, outputPath, upgradeOutputPath } from '../scripts/generate-contract-validation.mjs'

test('database report schema is deterministic and committed output matches', async () => {
  const first = await generateValidation()
  assert.equal(first, await generateValidation())
  assert.equal(first, await readFile(outputPath, 'utf8'))
  assert.match(first, /SHA-256: [a-f0-9]{64}/)
  assert.match(first, /"ParentReport"/)
  assert.match(first, /"SkillId"/)
  assert.doesNotMatch(first, /"ScoreItemResponse"/)
})

test('upgrade schema is canonical, deterministic and committed separately from the deployed baseline', async () => {
  const first = await generateUpgradeValidation()
  assert.equal(first, await generateUpgradeValidation())
  assert.equal(first, await readFile(upgradeOutputPath, 'utf8'))
  assert.match(first, /create or replace function basira_private\.probe_response_schema\(\)/)
  assert.match(first, /"ProbeResponse"/)
  assert.match(first, /to_regprocedure\('basira_private\.probe_response_schema\(\)'\)/)
  assert.doesNotMatch(first, /"ParentReport"/)
})

test('drift checking never repairs stale or missing SQL', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'basira-validation-'))
  const path = join(directory, 'validation.sql')
  try {
    await assert.rejects(checkValidation(path), /Missing generated validation/)
    await writeFile(path, '-- deliberately stale\n')
    await assert.rejects(checkValidation(path), /Stale generated validation/)
    assert.equal(await readFile(path, 'utf8'), '-- deliberately stale\n')
    await writeFile(path, await generateValidation())
    await checkValidation(path)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('generator CLI check resolves paths independently of working directory', () => {
  const script = new URL('../scripts/generate-contract-validation.mjs', import.meta.url)
  const output = execFileSync(process.execPath, [script.pathname, '--check'], { cwd: tmpdir(), encoding: 'utf8' })
  assert.match(output, /Database contract validation is current/)
})
