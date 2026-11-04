import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { test } from 'node:test'

function assertUniqueMigrationVersions(files: readonly string[]) {
  const versions = new Map<string, string>()
  for (const file of files) {
    const match = /^(\d{14})_[a-z][a-z0-9_]*\.sql$/.exec(file)
    assert.ok(match, `Invalid migration filename: ${file}`)
    const version = match[1]
    const previous = versions.get(version)
    assert.equal(previous, undefined,
      `Duplicate migration version ${version}: ${previous} and ${file}`)
    versions.set(version, file)
  }
}

test('committed SQL migrations have valid, unique Supabase versions', () => {
  const files = readdirSync(new URL('../migrations/', import.meta.url))
    .filter((file) => file.endsWith('.sql'))
    .sort()
  assert.ok(files.length > 0, 'No SQL migrations found')
  assertUniqueMigrationVersions(files)
})

test('different migration names cannot reuse the same ledger version', () => {
  assert.throws(() => assertUniqueMigrationVersions([
    '20261104000000_keep_alive_rpc.sql',
    '20261104000000_probe_contract_validation.sql',
  ]), /Duplicate migration version 20261104000000/)
})

test('distinct migration versions are accepted', () => {
  assert.doesNotThrow(() => assertUniqueMigrationVersions([
    '20261104000000_probe_contract_validation.sql',
    '20261104000100_durable_probe_results.sql',
    '20261104000200_keep_alive_rpc.sql',
  ]))
})

test('malformed migration versions are rejected', () => {
  assert.throws(() => assertUniqueMigrationVersions([
    '20261104_keep_alive_rpc.sql',
  ]), /Invalid migration filename/)
})
