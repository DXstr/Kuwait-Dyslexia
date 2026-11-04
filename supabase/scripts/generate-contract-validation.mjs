import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const schemaPath = fileURLToPath(new URL('../../contracts/schemas/basira.schema.json', import.meta.url))
export const outputPath = fileURLToPath(new URL('../migrations/20261102000000_contract_validation.sql', import.meta.url))
export const upgradeOutputPath = fileURLToPath(new URL('../migrations/20261104000000_probe_contract_validation.sql', import.meta.url))

async function readCanonicalSources() {
  const source = await readFile(schemaPath, 'utf8')
  const skillsSource = await readFile(new URL('../../contracts/skill-graph.json', import.meta.url), 'utf8')
  const dialectsSource = await readFile(new URL('../../contracts/dialect-lexicons.json', import.meta.url), 'utf8')
  const canonical = JSON.parse(source)
  const skillIds = JSON.parse(skillsSource).skills.map(skill => skill.id).sort()
  const dialectIds = JSON.parse(dialectsSource).lexicons.map(lexicon => lexicon.id).sort()
  for (const ids of [skillIds, dialectIds]) {
    if (!ids.length || ids.some(id => typeof id !== 'string') || new Set(ids).size !== ids.length) throw new Error('Canonical ids must be nonempty unique strings')
  }
  return { source, skillsSource, dialectsSource, canonical, skillIds, dialectIds }
}

function schemaDocument(canonical, skillIds, root) {
  const names = new Set([root])
  const visit = (value) => {
    if (!value || typeof value !== 'object') return
    if (typeof value.$ref === 'string') {
      if (!value.$ref.startsWith('#/$defs/')) throw new Error('External references are not supported')
      const name = value.$ref.slice('#/$defs/'.length)
      if (!names.has(name)) {
        names.add(name)
        if (!canonical.$defs[name]) throw new Error(`Missing canonical definition ${name}`)
        visit(canonical.$defs[name])
      }
    }
    Object.values(value).forEach(visit)
  }
  visit(canonical.$defs[root])
  return {
    $schema: canonical.$schema,
    $ref: `#/$defs/${root}`,
    $defs: Object.fromEntries([...names].sort().map(name => [name,
      name === 'SkillId' ? { ...canonical.$defs[name], enum: skillIds } : canonical.$defs[name],
    ])),
  }
}

function probeFunction(schema) {
  return `create function basira_private.probe_response_schema() returns json
language sql immutable security definer set search_path = '' as $function$
  select $basira_probe_schema$${schema}$basira_probe_schema$::json
$function$;`
}

export async function generateValidation() {
  const { source, skillsSource, dialectsSource, canonical, skillIds, dialectIds } = await readCanonicalSources()
  const document = schemaDocument(canonical, skillIds, 'ParentReport')
  const schema = JSON.stringify(document, null, 2)
  if ([schema, JSON.stringify(skillIds), JSON.stringify(dialectIds)].some(value => value.includes('$basira_'))) throw new Error('SQL delimiter occurs in canonical data')
  const hash = createHash('sha256').update(source).update('\0').update(skillsSource).update('\0').update(dialectsSource).digest('hex')
  return `-- GENERATED — DO NOT EDIT. Sources: contracts/schemas/basira.schema.json,
-- contracts/skill-graph.json, contracts/dialect-lexicons.json.
-- SHA-256: ${hash}
-- Regenerate: cd supabase && npm run generate:contracts
create schema if not exists basira_private;
revoke all on schema basira_private from public, anon;
create extension if not exists pg_jsonschema with schema extensions;
create function basira_private.parent_report_schema() returns json
language sql immutable security definer set search_path = '' as $function$
  select $basira_schema$${schema}$basira_schema$::json
$function$;
create function basira_private.canonical_skill_ids() returns text[]
language sql immutable security definer set search_path = '' as $function$
  select array(select jsonb_array_elements_text($basira_ids$${JSON.stringify(skillIds)}$basira_ids$::jsonb))
$function$;
create function basira_private.canonical_dialect_ids() returns text[]
language sql immutable security definer set search_path = '' as $function$
  select array(select jsonb_array_elements_text($basira_ids$${JSON.stringify(dialectIds)}$basira_ids$::jsonb))
$function$;
revoke all on function basira_private.parent_report_schema(), basira_private.canonical_skill_ids(), basira_private.canonical_dialect_ids() from public, anon, authenticated;
`
}

export async function generateUpgradeValidation() {
  const { source, skillsSource, dialectsSource, canonical, skillIds } = await readCanonicalSources()
  const schema = JSON.stringify(schemaDocument(canonical, skillIds, 'ProbeResponse'), null, 2)
  if (schema.includes('$basira_')) throw new Error('SQL delimiter occurs in canonical data')
  const hash = createHash('sha256').update(source).update('\0').update(skillsSource).update('\0').update(dialectsSource).digest('hex')
  const functionSql = probeFunction(schema)
  return `-- GENERATED — DO NOT EDIT. Sources: contracts/schemas/basira.schema.json,
-- contracts/skill-graph.json, contracts/dialect-lexicons.json.
-- SHA-256: ${hash}
-- Regenerate: cd supabase && npm run generate:contracts
-- Forward migration for databases that already applied the baseline validator.
create schema if not exists basira_private;
do $basira_probe_install$
begin
  if to_regprocedure('basira_private.probe_response_schema()') is null then
    execute $basira_probe_create$${functionSql}$basira_probe_create$;
  end if;
end
$basira_probe_install$;
create or replace function basira_private.probe_response_schema() returns json
language sql immutable security definer set search_path = '' as $function$
  select $basira_probe_schema$${schema}$basira_probe_schema$::json
$function$;
revoke all on function basira_private.probe_response_schema() from public, anon, authenticated;
`
}

async function checkGenerated(path, expected, missingMessage) {
  let current
  try { current = await readFile(path, 'utf8') }
  catch (cause) { throw new Error(missingMessage, { cause }) }
  if (current !== expected) throw new Error('Stale generated validation; run npm run generate:contracts')
}

export async function checkValidation(path = outputPath) {
  await checkGenerated(path, await generateValidation(), 'Missing generated validation; run npm run generate:contracts')
  if (path === outputPath) {
    await checkGenerated(upgradeOutputPath, await generateUpgradeValidation(), 'Missing generated upgrade validation; run npm run generate:contracts')
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.includes('--check')) await checkValidation()
    else {
      await writeFile(outputPath, await generateValidation(), 'utf8')
      await writeFile(upgradeOutputPath, await generateUpgradeValidation(), 'utf8')
    }
    console.log(process.argv.includes('--check') ? 'Database contract validation is current.' : 'Generated database contract validation.')
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
