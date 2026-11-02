import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createHandler } from '../functions/audio-cleanup/cleanup.ts'

const root = fileURLToPath(new URL('../..', import.meta.url))
const cli = fileURLToPath(new URL('../node_modules/.bin/supabase', import.meta.url))
const native = process.env.SUPABASE_EXPERIMENTAL_STACK === '1'
const status = JSON.parse(execFileSync(cli, ['status', '--workdir', root, ...(native ? ['--output-format', 'json'] : ['--output', 'json'])], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))
const env = status.env ?? status
const api = env.API_URL ?? env.api_url
const database = env.DB_URL ?? env.db_url
const serviceKey = env.SERVICE_ROLE_KEY ?? env.service_role_key
assert.ok(api && database && serviceKey, 'local stack connection details are required')
for (const url of [api, database]) {
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname), 'integration tests never target a hosted project')
}
const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }
function sql(query: string): string {
  return execFileSync('psql', [database, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1'], { input: query, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
}
function literal(value: string): string { return `'${value.replaceAll("'", "''")}'` }

// Disposable localhost test tokens, not an application sign-in implementation.
function authenticatedHeaders(id: string): Record<string, string> {
  const signingKey = sql("select current_setting('app.settings.jwt_secret',true)")
  assert.ok(signingKey, 'local test JWT key is required')
  const role = sql(`select role from public.profiles where id=${literal(id)}`)
  const issuer = JSON.parse(Buffer.from(serviceKey.split('.')[1], 'base64url').toString()).iss
  const now = Math.floor(Date.now() / 1000)
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({ iss: issuer, sub: id, role: 'authenticated', aud: 'authenticated', app_role: role, iat: now, exp: now + 300 })).toString('base64url')
  const signature = createHmac('sha256', signingKey).update(`${header}.${payload}`).digest('base64url')
  return { apikey: env.ANON_KEY ?? env.anon_key, Authorization: `Bearer ${header}.${payload}.${signature}` }
}

async function removeFixtureObject(bucket: string, path: string): Promise<void> {
  const response = await fetch(`${api}/storage/v1/object/${bucket}`, { method: 'DELETE', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ prefixes: [path] }), signal: AbortSignal.timeout(30_000) })
  assert.ok(response.ok, `local Storage fixture cleanup failed (${response.status})`)
}

// Existing local seed users are visibly labelled demo accounts and cannot sign in.
const specialist = '00000000-0000-4000-a000-000000000002'
const guardian = '00000000-0000-4000-a000-000000000004'
const child = '00000000-0000-4000-a000-000000000010'

test('live Storage bytes are erased before the pointer is cleared; scorer JSON stays unchanged', { timeout: 180_000 }, async () => {
  const session = randomUUID()
  const consent = randomUUID()
  const result = randomUUID()
  const response = JSON.parse(readFileSync(new URL('../../contracts/fixtures/ScoreItemResponse.dot-confusion.json', import.meta.url), 'utf8'))
  assert.equal(response.synthetic, true, 'the integration payload is explicitly synthetic')
  const item = response.item_id
  const object = `audio/${child}/${session}/${item}.wav`
  const encoded = object.split('/').map(encodeURIComponent).join('/')
  const endpoint = `${api}/storage/v1/object/audio/${encoded}`
  const download = `${api}/storage/v1/object/authenticated/audio/${encoded}`
  const payload = JSON.stringify(response)
  const claims = JSON.stringify({ role: 'authenticated', sub: specialist, app_role: 'specialist' })
  try {
    sql(`begin;
      insert into public.consents(id,child_id,guardian_id,specialist_id,scope,signed_at,expires_at,evidence_path)
        values('${consent}','${child}','${guardian}','${specialist}','assessment',now()-interval '50 days',now()+interval '1 day','synthetic-integration-fixture-not-real-consent');
      select set_config('request.jwt.claims',${literal(claims)},true);
      set local role authenticated;
      insert into public.sessions(id,child_id,type,run_by) values('${session}','${child}','assessment','${specialist}');
      reset role;
      -- Privileged historical fixture setup only, never an application capability.
      alter table public.sessions disable trigger guard_session;
      update public.sessions set started_at=now()-interval '40 days' where id='${session}';
      alter table public.sessions enable trigger guard_session;
      set local role authenticated;
      insert into public.item_results(id,session_id,item_id,response,audio_path,synthetic)
        values('${result}','${session}',${literal(item)},${literal(payload)}::jsonb,${literal(object)},true);
      commit;`)

    // A deterministic silent WAV fixture; no child audio is recorded or uploaded.
    const wav = Buffer.alloc(60)
    wav.write('RIFF', 0); wav.writeUInt32LE(52, 4); wav.write('WAVEfmt ', 8)
    wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
    wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28)
    wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(16, 40)
    const upload = await fetch(endpoint, { method: 'POST', headers: { ...headers, 'content-type': 'audio/wav' }, body: wav, signal: AbortSignal.timeout(90_000) })
    assert.equal(upload.status, 200, `synthetic WAV upload failed (${upload.status})`)
    const before = await fetch(download, { headers, signal: AbortSignal.timeout(30_000) })
    assert.equal(before.status, 200)
    assert.deepEqual(Buffer.from(await before.arrayBuffer()), wav)

    const secret = randomBytes(32).toString('hex')
    const handler = createHandler({ url: api, serviceKey, cleanupSecret: secret })
    const denied = await handler(new Request('http://localhost/audio-cleanup', { method: 'POST' }))
    assert.equal(denied.status, 401)
    const cleaned = await handler(new Request('http://localhost/audio-cleanup', { method: 'POST', headers: { Authorization: `Bearer ${secret}` } }))
    assert.equal(cleaned.status, 200, `cleanup returned ${cleaned.status}`)
    const summary = await cleaned.json()
    assert.ok(summary.deleted >= 1)
    assert.ok(summary.confirmed >= 1)
    const after = await fetch(download, { headers, signal: AbortSignal.timeout(30_000) })
    assert.notEqual(after.status, 200, 'original object must no longer download after cleanup')
    assert.equal(sql(`select audio_path is null from public.item_results where id='${result}'`), 't')
    assert.deepEqual(JSON.parse(sql(`select response::text from public.item_results where id='${result}'`)), response)
    assert.equal(sql(`select count(*) from storage.objects where bucket_id='audio' and name=${literal(object)}`), '0')
  } finally {
    await removeFixtureObject('audio', object)
    // Only this test's synthetic rows are removed; append-only audit evidence remains.
    sql(`delete from public.item_results where id='${result}'; delete from public.sessions where id='${session}'; delete from public.consents where id='${consent}';`)
  }
})

test('canonical ParentReport fixture validates but nested scored JSON cannot be published', () => {
  const source = JSON.parse(readFileSync(new URL('../../contracts/fixtures/ParentReport.sample.json', import.meta.url), 'utf8'))
  const check = (value: unknown) => sql(`select extensions.jsonb_matches_schema(basira_private.parent_report_schema(),${literal(JSON.stringify(value))}::jsonb)`)
  assert.equal(check(source), 't')
  assert.equal(check({ ...source, risk_score: 0.8 }), 'f')
  assert.equal(check({ ...source, home_plan: [{ ...source.home_plan[0], risk_score: 0.8 }] }), 'f')
  assert.equal(check({ ...source, home_plan: [{ ...source.home_plan[0], words: [{ risk_score: 0.8 }] }] }), 'f')
  assert.equal(check({ ...source, language: 'en' }), 'f')
})

test('pgcrypto scheduler HMAC is accepted by the real cleanup handler', async () => {
  const secret = randomBytes(32).toString('hex')
  const stamp = String(Math.floor(Date.now() / 1000))
  const signature = sql(`select encode(extensions.hmac(${literal(`basira-audio-cleanup:${stamp}`)},${literal(secret)},'sha256'),'hex')`)
  const handler = createHandler({ url: api, serviceKey, cleanupSecret: secret })
  const response = await handler(new Request('http://localhost/audio-cleanup', { method: 'POST', headers: { Authorization: `Bearer ${signature}`, 'x-basira-cleanup-timestamp': stamp } }))
  assert.equal(response.status, 200)
})

test('authenticated Storage HTTP cannot replace or remove an approved family PDF', { timeout: 180_000 }, async () => {
  const session = randomUUID()
  const consent = randomUUID()
  const report = randomUUID()
  const draft = randomUUID()
  const approvedPath = `reports/${child}/${report}.pdf`
  const draftPath = `reports/${child}/${draft}.pdf`
  const content = JSON.parse(readFileSync(new URL('../../contracts/fixtures/ParentReport.sample.json', import.meta.url), 'utf8'))
  content.child_first_name = 'ليان (ملف تجريبي)'
  content.specialist.name = 'أخصائي (ملف تجريبي)'
  const claims = JSON.stringify({ role: 'authenticated', sub: specialist })
  const document = Buffer.from('%PDF-1.4\n% Basira synthetic test bytes only; not a report deliverable\n%%EOF\n')
  const changed = Buffer.from('%PDF-1.4\n% Synthetic tamper attempt\n%%EOF\n')
  const specialistHeaders = authenticatedHeaders(specialist)
  const guardianHeaders = authenticatedHeaders(guardian)
  const objectUrl = (path: string) => `${api}/storage/v1/object/reports/${path.split('/').map(encodeURIComponent).join('/')}`
  const read = async () => {
    const response = await fetch(`${api}/storage/v1/object/authenticated/reports/${approvedPath}`, { headers: guardianHeaders, signal: AbortSignal.timeout(30_000) })
    assert.equal(response.status, 200, 'guardian can download only the approved own-family PDF')
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), document)
  }
  try {
    sql(`begin;
      insert into public.consents(id,child_id,guardian_id,specialist_id,scope,signed_at,expires_at,evidence_path)
      values('${consent}','${child}','${guardian}','${specialist}','assessment',now()-interval '1 day',now()+interval '1 day','synthetic-storage-policy-test-evidence-only');
      select set_config('request.jwt.claims',${literal(claims)},true); set local role authenticated;
      insert into public.sessions(id,child_id,type,run_by) values('${session}','${child}','assessment','${specialist}');
      insert into public.parent_reports(id,child_id,session_id,content,pdf_path) values
      ('${report}','${child}','${session}',${literal(JSON.stringify(content))}::jsonb,${literal(approvedPath)}),
      ('${draft}','${child}','${session}',${literal(JSON.stringify(content))}::jsonb,${literal(draftPath)});
      commit;`)
    for (const path of [approvedPath, draftPath]) {
      const response = await fetch(objectUrl(path), { method: 'POST', headers: { ...specialistHeaders, 'content-type': 'application/pdf' }, body: document, signal: AbortSignal.timeout(30_000) })
      assert.equal(response.status, 200, `draft PDF upload failed (${response.status})`)
    }
    const unapproved = await fetch(`${api}/storage/v1/object/authenticated/reports/${approvedPath}`, { headers: guardianHeaders })
    assert.notEqual(unapproved.status, 200, 'guardian cannot download a draft PDF')
    sql(`begin; select set_config('request.jwt.claims',${literal(claims)},true); set local role authenticated;
      update public.parent_reports set review_status='pending_review' where id='${report}';
      update public.parent_reports set review_status='approved' where id='${report}'; commit;`)
    await read()
    for (const method of ['PUT', 'POST']) {
      const response = await fetch(objectUrl(approvedPath), { method, headers: { ...specialistHeaders, 'content-type': 'application/pdf', 'x-upsert': 'true' }, body: changed, signal: AbortSignal.timeout(30_000) })
      assert.ok(!response.ok, `approved PDF ${method}/upsert must be refused`)
      await read()
    }
    for (const operation of ['copy', 'move']) {
      const response = await fetch(`${api}/storage/v1/object/${operation}`, { method: 'POST', headers: { ...specialistHeaders, 'content-type': 'application/json' }, body: JSON.stringify({ bucketId: 'reports', sourceKey: draftPath, destinationKey: approvedPath }), signal: AbortSignal.timeout(30_000) })
      assert.ok(!response.ok, `copy/move onto an approved PDF must be refused`)
      await read()
    }
    await fetch(`${api}/storage/v1/object/reports`, { method: 'DELETE', headers: { ...specialistHeaders, 'content-type': 'application/json' }, body: JSON.stringify({ prefixes: [approvedPath] }), signal: AbortSignal.timeout(30_000) })
    await read() // DELETE may be idempotent with an empty result; bytes must remain.
  } finally {
    await removeFixtureObject('reports', approvedPath)
    await removeFixtureObject('reports', draftPath)
    sql(`delete from public.parent_reports where id in ('${report}','${draft}'); delete from public.sessions where id='${session}'; delete from public.consents where id='${consent}';`)
  }
})

test('actual local Deno entrypoint authenticates and runs a bounded cleanup request', { timeout: 120_000 }, async () => {
  const { parseEnv } = await import('node:util')
  const values = parseEnv(readFileSync(new URL('../functions/.env', import.meta.url), 'utf8'))
  const secret = values.BASIRA_AUDIO_CLEANUP_SECRET
  assert.ok(typeof secret === 'string' && secret.length >= 32, 'run npm run prepare:local before starting the local stack')
  const url = `${api}/functions/v1/audio-cleanup`
  const unauthorized = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(60_000) })
  assert.equal(unauthorized.status, 401, 'unconfigured entrypoint must not masquerade as a passing test')
  const stamp = String(Math.floor(Date.now() / 1000))
  const signature = createHmac('sha256', secret).update(`basira-audio-cleanup:${stamp}`).digest('hex')
  const response = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${signature}`, 'x-basira-cleanup-timestamp': stamp }, signal: AbortSignal.timeout(60_000) })
  assert.equal(response.status, 200)
  const summary = await response.json()
  assert.ok(Number.isInteger(summary.examined) && summary.examined <= 100)
})
