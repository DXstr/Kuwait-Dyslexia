-- GENERATED — DO NOT EDIT. Sources: contracts/schemas/basira.schema.json,
-- contracts/skill-graph.json, contracts/dialect-lexicons.json.
-- SHA-256: 395b827537d68e06b260696f9d2fce6f180d6f2515750f21fcb394f534f0922d
-- Regenerate: cd supabase && npm run generate:contracts
create schema if not exists basira_private;
revoke all on schema basira_private from public, anon;
create extension if not exists pg_jsonschema with schema extensions;
create function basira_private.parent_report_schema() returns json
language sql immutable security definer set search_path = '' as $function$
  select $basira_schema${
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$ref": "#/$defs/ParentReport",
  "$defs": {
    "ParentReport": {
      "type": "object",
      "additionalProperties": false,
      "description": "Deliberately has no field that can carry a score, a risk level or a label (non-negotiable 2).",
      "required": [
        "language",
        "child_first_name",
        "session_date",
        "duration_min",
        "practised",
        "progress_notes",
        "home_plan",
        "next_focus_ar",
        "specialist"
      ],
      "properties": {
        "language": {
          "const": "ar"
        },
        "child_first_name": {
          "type": "string"
        },
        "session_date": {
          "type": "string",
          "format": "date"
        },
        "duration_min": {
          "type": "integer",
          "minimum": 0
        },
        "practised": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "skill_id",
              "plain_ar"
            ],
            "properties": {
              "skill_id": {
                "$ref": "#/$defs/SkillId"
              },
              "plain_ar": {
                "type": "string"
              }
            }
          }
        },
        "progress_notes": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "skill_id",
              "note_ar"
            ],
            "properties": {
              "skill_id": {
                "$ref": "#/$defs/SkillId"
              },
              "note_ar": {
                "type": "string"
              }
            }
          }
        },
        "home_plan": {
          "type": "array",
          "minItems": 1,
          "maxItems": 3,
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "title_ar",
              "minutes",
              "words",
              "how_ar"
            ],
            "properties": {
              "title_ar": {
                "type": "string"
              },
              "minutes": {
                "type": "integer",
                "minimum": 5,
                "maximum": 10
              },
              "words": {
                "type": "array",
                "items": {
                  "type": "string"
                }
              },
              "how_ar": {
                "type": "string"
              }
            }
          }
        },
        "next_focus_ar": {
          "type": "string"
        },
        "specialist": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "name",
            "contact"
          ],
          "properties": {
            "name": {
              "type": "string"
            },
            "contact": {
              "type": "string"
            }
          }
        }
      }
    },
    "SkillId": {
      "type": "string",
      "pattern": "^(ls|dot|emph|vowel|pos|decode|fluency)\\.[a-z_-]+$",
      "description": "Must exist in contracts/skill-graph.json",
      "enum": [
        "decode.pseudo",
        "decode.real",
        "dot.ayn-ghayn",
        "dot.baa-taa-thaa-nuun-yaa",
        "dot.daal-dhaal",
        "dot.faa-qaaf",
        "dot.jiim-hhaa-khaa",
        "dot.raa-zaay",
        "dot.saad-daad",
        "dot.siin-shiin",
        "dot.ttaa-zhaa",
        "emph.daad-daal",
        "emph.saad-siin",
        "emph.ttaa-taa",
        "emph.zhaa-dhaal",
        "fluency.passage",
        "ls.alif",
        "ls.ayn",
        "ls.baa",
        "ls.daad",
        "ls.daal",
        "ls.dhaal",
        "ls.faa",
        "ls.ghayn",
        "ls.haa",
        "ls.hhaa",
        "ls.jiim",
        "ls.kaaf",
        "ls.khaa",
        "ls.laam",
        "ls.miim",
        "ls.nuun",
        "ls.qaaf",
        "ls.raa",
        "ls.saad",
        "ls.shiin",
        "ls.siin",
        "ls.taa",
        "ls.thaa",
        "ls.ttaa",
        "ls.waaw",
        "ls.yaa",
        "ls.zaay",
        "ls.zhaa",
        "pos.final",
        "pos.initial",
        "pos.medial",
        "vowel.damma",
        "vowel.fatha",
        "vowel.kasra",
        "vowel.shadda",
        "vowel.sukun",
        "vowel.tanwin"
      ]
    }
  }
}$basira_schema$::json
$function$;
create function basira_private.canonical_skill_ids() returns text[]
language sql immutable security definer set search_path = '' as $function$
  select array(select jsonb_array_elements_text($basira_ids$["decode.pseudo","decode.real","dot.ayn-ghayn","dot.baa-taa-thaa-nuun-yaa","dot.daal-dhaal","dot.faa-qaaf","dot.jiim-hhaa-khaa","dot.raa-zaay","dot.saad-daad","dot.siin-shiin","dot.ttaa-zhaa","emph.daad-daal","emph.saad-siin","emph.ttaa-taa","emph.zhaa-dhaal","fluency.passage","ls.alif","ls.ayn","ls.baa","ls.daad","ls.daal","ls.dhaal","ls.faa","ls.ghayn","ls.haa","ls.hhaa","ls.jiim","ls.kaaf","ls.khaa","ls.laam","ls.miim","ls.nuun","ls.qaaf","ls.raa","ls.saad","ls.shiin","ls.siin","ls.taa","ls.thaa","ls.ttaa","ls.waaw","ls.yaa","ls.zaay","ls.zhaa","pos.final","pos.initial","pos.medial","vowel.damma","vowel.fatha","vowel.kasra","vowel.shadda","vowel.sukun","vowel.tanwin"]$basira_ids$::jsonb))
$function$;
create function basira_private.canonical_dialect_ids() returns text[]
language sql immutable security definer set search_path = '' as $function$
  select array(select jsonb_array_elements_text($basira_ids$["kw","msa"]$basira_ids$::jsonb))
$function$;
revoke all on function basira_private.parent_report_schema(), basira_private.canonical_skill_ids(), basira_private.canonical_dialect_ids() from public, anon, authenticated;
