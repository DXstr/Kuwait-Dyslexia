import { randomBytes } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { parseEnv } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const environmentPath = fileURLToPath(new URL('../functions/.env', import.meta.url))

export async function prepareLocalFunctions(path = environmentPath) {
  try {
    await writeFile(path, `BASIRA_AUDIO_CLEANUP_SECRET=${randomBytes(32).toString('hex')}\n`, { flag: 'wx', mode: 0o600 })
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
  }
  const values = parseEnv(await readFile(path, 'utf8'))
  if (new TextEncoder().encode(values.BASIRA_AUDIO_CLEANUP_SECRET ?? '').byteLength < 32) {
    throw new Error('Local functions/.env needs BASIRA_AUDIO_CLEANUP_SECRET of at least 32 bytes; no existing configuration was overwritten')
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await prepareLocalFunctions()
    console.log('Ignored local function environment is ready; no hosted secrets were changed.')
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
