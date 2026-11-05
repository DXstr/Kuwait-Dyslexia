// Serves the rendered item clips from the site at /audio/<clip>.mp3.
import { cpSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const source = resolve(here, '../../content/dist/audio')
if (!existsSync(source)) throw new Error(`Item audio not found at ${source}`)
cpSync(source, resolve(here, '../public/audio'), { recursive: true })
