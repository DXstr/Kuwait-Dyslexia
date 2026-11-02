import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseEnv } from 'node:util'
import { prepareLocalFunctions } from '../scripts/prepare-local-functions.mjs'

test('local function secret is strong, private and not overwritten', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'basira-local-env-'))
  const path = join(directory, '.env')
  try {
    await prepareLocalFunctions(path)
    const before = await readFile(path, 'utf8')
    assert.match(parseEnv(before).BASIRA_AUDIO_CLEANUP_SECRET ?? '', /^[a-f0-9]{64}$/)
    assert.equal((await stat(path)).mode & 0o777, 0o600)
    await prepareLocalFunctions(path)
    assert.equal(await readFile(path, 'utf8'), before)
    await writeFile(path, 'BASIRA_AUDIO_CLEANUP_SECRET=short\n')
    await assert.rejects(prepareLocalFunctions(path), /at least 32 bytes/)
    assert.equal(await readFile(path, 'utf8'), 'BASIRA_AUDIO_CLEANUP_SECRET=short\n')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
