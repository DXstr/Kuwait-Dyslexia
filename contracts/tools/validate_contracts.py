"""Validate every contract artefact. Run from the repo root:  python contracts/tools/validate_contracts.py

Checks:
  1. Every fixture contracts/fixtures/<Def>.<name>.json validates against $defs/<Def> in basira.schema.json.
  2. Every skill id referenced in fixtures, prerequisites and the item bank exists in skill-graph.json.
  3. Skill-graph prerequisites have no cycles.
  4. Taxonomy letters referenced by the skill graph, dot groups and dialect rules exist.
  5. Dialect rule ids referenced by fixtures exist.
Exit code 1 on any failure (CI blocks the PR).
"""
import json
import sys
from pathlib import Path

try:
    from jsonschema import Draft202012Validator
    from referencing import Registry, Resource
except ImportError:
    sys.exit("pip install 'jsonschema>=4.18'")

ROOT = Path(__file__).resolve().parents[1]
errors: list[str] = []


def load(p: Path):
    return json.loads(p.read_text(encoding="utf-8"))


schema = load(ROOT / "schemas" / "basira.schema.json")
registry = Registry().with_resource(schema["$id"], Resource.from_contents(schema))
Draft202012Validator.check_schema(schema)

graph = load(ROOT / "skill-graph.json")
tax = load(ROOT / "taxonomy.json")
lex = load(ROOT / "dialect-lexicons.json")

skill_ids = {s["id"] for s in graph["skills"]}
letter_ids = {l["id"] for l in tax["letters"]}
rule_ids = {r["id"] for L in lex["lexicons"] for r in L["rules"]}

# 1. fixtures vs schema
for f in sorted((ROOT / "fixtures").glob("*.json")):
    definition = f.name.split(".")[0]
    if definition not in schema["$defs"]:
        errors.append(f"{f.name}: no $defs/{definition} in schema")
        continue
    v = Draft202012Validator({"$ref": f"{schema['$id']}#/$defs/{definition}"}, registry=registry)
    for e in v.iter_errors(load(f)):
        errors.append(f"{f.name}: {'/'.join(map(str, e.absolute_path))}: {e.message}")


# 2. + 5. referenced ids exist
def walk(o, path, fname):
    if isinstance(o, dict):
        for k, val in o.items():
            if k == "skill_id" and val not in skill_ids:
                errors.append(f"{fname}: unknown skill_id {val}")
            if k == "skill_ids":
                for s in val:
                    if s not in skill_ids:
                        errors.append(f"{fname}: unknown skill_id {s}")
            if k == "dialect_rule_id" and val is not None and val not in rule_ids:
                errors.append(f"{fname}: unknown dialect_rule_id {val}")
            if k == "expected_letter" and val is not None and val not in letter_ids:
                errors.append(f"{fname}: unknown letter {val}")
            walk(val, path + [k], fname)
    elif isinstance(o, list):
        for x in o:
            walk(x, path, fname)


for f in sorted((ROOT / "fixtures").glob("*.json")):
    walk(load(f), [], f.name)

for s in graph["skills"]:
    for p in s["prerequisites"]:
        if p not in skill_ids:
            errors.append(f"skill-graph: {s['id']} has unknown prerequisite {p}")
    for l in s["letters"]:
        if l not in letter_ids:
            errors.append(f"skill-graph: {s['id']} has unknown letter {l}")

# 3. no cycles
prereq = {s["id"]: s["prerequisites"] for s in graph["skills"]}
state: dict[str, int] = {}


def visit(n, stack):
    if state.get(n) == 1:
        errors.append(f"skill-graph: cycle {' -> '.join(stack + [n])}")
        return
    if state.get(n) == 2:
        return
    state[n] = 1
    for p in prereq.get(n, []):
        visit(p, stack + [n])
    state[n] = 2


for n in prereq:
    visit(n, [])

# 4. taxonomy integrity
for g in tax["dot_groups"]:
    for l in g["letters"]:
        if l not in letter_ids:
            errors.append(f"taxonomy: dot group {g['id']} unknown letter {l}")
for L in lex["lexicons"]:
    for r in L["rules"]:
        if r["letter"] not in letter_ids:
            errors.append(f"dialect-lexicons: {r['id']} unknown letter {r['letter']}")

if errors:
    print("CONTRACT CHECK FAILED")
    print("\n".join(errors))
    sys.exit(1)
print(f"Contracts OK: {len(list((ROOT / 'fixtures').glob('*.json')))} fixtures, {len(skill_ids)} skills, {len(rule_ids)} dialect rules")
