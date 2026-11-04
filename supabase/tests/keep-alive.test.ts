import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const workflow = readFileSync(
  resolve(new URL('../../.github/workflows/supabase-keep-alive.yml', import.meta.url).pathname),
  'utf8',
)

const migration = readFileSync(
  resolve(new URL('../migrations/20261104000000_keep_alive_rpc.sql', import.meta.url).pathname),
  'utf8',
)

test('keep-alive is opt-in, bounded, and limited to read-only repository permissions', () => {
  assert.match(workflow, /cron:\s*['"]17 3 \*\/3 \* \*['"]\s*/)
  assert.match(workflow, /workflow_dispatch:/)
  assert.match(workflow, /permissions:\s*\n\s+contents:\s+read/)
  assert.match(workflow, /if:.*github\.ref.*refs\/heads\/main.*ENABLE_SUPABASE_KEEP_ALIVE.*true/)
  assert.match(workflow, /timeout-minutes:\s+5/)
  assert.match(workflow, /--max-time 20/)
})

test('keep-alive accepts publishable or legacy anon keys and rejects secret keys', () => {
  assert.match(workflow, /SUPABASE_PUBLIC_KEY:\s*\$\{\{ secrets\.SUPABASE_PUBLIC_KEY \}\}/)
  assert.match(workflow, /sb_publishable_\*/)
  assert.match(workflow, /sb_secret_\*\|service_role\*\|\*service_role\*/)
  assert.match(workflow, /\*\.\*\.\*/) // legacy anon JWT shape
  assert.doesNotMatch(workflow, /SUPABASE_SERVICE_ROLE_KEY/)
  assert.doesNotMatch(workflow, /SUPABASE_ANON_KEY/)
})

test('keep-alive calls only the constant RPC with an apikey header', () => {
  assert.match(workflow, /\/rest\/v1\/rpc\/basira_health_ping/)
  assert.match(workflow, /--header "apikey: \$\{SUPABASE_PUBLIC_KEY\}"/)
  assert.doesNotMatch(workflow, /Authorization:\s*Bearer/)
  assert.doesNotMatch(workflow, /profiles\?/)
  assert.doesNotMatch(workflow, /\?select=/)
  assert.match(workflow, /--output "\$\{body_file\}"/)
  assert.match(workflow, /!= '1'/)
})

test('heartbeat migration is a constant invoker RPC with no table access grants', () => {
  assert.match(migration, /returns integer/)
  assert.match(migration, /stable/)
  assert.match(migration, /security invoker/)
  assert.match(migration, /set search_path = ''/)
  assert.match(migration, /select 1;/)
  assert.match(migration, /revoke all on function public\.basira_health_ping\(\) from public/)
  assert.match(migration, /grant execute on function public\.basira_health_ping\(\) to anon, authenticated/)
  assert.doesNotMatch(migration, /from public\.profiles/)
})
