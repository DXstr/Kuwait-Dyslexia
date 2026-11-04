-- GENERATED — DO NOT EDIT. Sources: contracts/schemas/basira.schema.json,
-- contracts/skill-graph.json, contracts/dialect-lexicons.json.
-- SHA-256: b24542a93a1f46763b4874610aa762f91fc5e4dc551e808294ddc41261171d02
-- Regenerate: cd supabase && npm run generate:contracts
-- Forward migration for databases that already applied the baseline validator.
create schema if not exists basira_private;
do $basira_probe_install$
begin
  if to_regprocedure('basira_private.probe_response_schema()') is null then
    execute $basira_probe_create$create function basira_private.probe_response_schema() returns json
language sql immutable security definer set search_path = '' as $function$
  select $basira_probe_schema${
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$ref": "#/$defs/ProbeResponse",
  "$defs": {
    "ProbeResponse": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "session_id",
        "model_version",
        "synthetic",
        "per_skill"
      ],
      "properties": {
        "session_id": {
          "type": "string"
        },
        "model_version": {
          "type": "string"
        },
        "synthetic": {
          "type": "boolean"
        },
        "per_skill": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "skill_id",
              "practised_accuracy",
              "unseen_accuracy",
              "n_practised",
              "n_unseen",
              "transfer"
            ],
            "properties": {
              "skill_id": {
                "$ref": "#/$defs/SkillId"
              },
              "practised_accuracy": {
                "type": [
                  "number",
                  "null"
                ]
              },
              "unseen_accuracy": {
                "type": [
                  "number",
                  "null"
                ]
              },
              "n_practised": {
                "type": "integer",
                "minimum": 0
              },
              "n_unseen": {
                "type": "integer",
                "minimum": 0
              },
              "transfer": {
                "enum": [
                  "transfer_shown",
                  "no_transfer_yet",
                  "insufficient_data"
                ]
              }
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
}$basira_probe_schema$::json
$function$;$basira_probe_create$;
  end if;
end
$basira_probe_install$;
create or replace function basira_private.probe_response_schema() returns json
language sql immutable security definer set search_path = '' as $function$
  select $basira_probe_schema${
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$ref": "#/$defs/ProbeResponse",
  "$defs": {
    "ProbeResponse": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "session_id",
        "model_version",
        "synthetic",
        "per_skill"
      ],
      "properties": {
        "session_id": {
          "type": "string"
        },
        "model_version": {
          "type": "string"
        },
        "synthetic": {
          "type": "boolean"
        },
        "per_skill": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "skill_id",
              "practised_accuracy",
              "unseen_accuracy",
              "n_practised",
              "n_unseen",
              "transfer"
            ],
            "properties": {
              "skill_id": {
                "$ref": "#/$defs/SkillId"
              },
              "practised_accuracy": {
                "type": [
                  "number",
                  "null"
                ]
              },
              "unseen_accuracy": {
                "type": [
                  "number",
                  "null"
                ]
              },
              "n_practised": {
                "type": "integer",
                "minimum": 0
              },
              "n_unseen": {
                "type": "integer",
                "minimum": 0
              },
              "transfer": {
                "enum": [
                  "transfer_shown",
                  "no_transfer_yet",
                  "insufficient_data"
                ]
              }
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
}$basira_probe_schema$::json
$function$;
revoke all on function basira_private.probe_response_schema() from public, anon, authenticated;
