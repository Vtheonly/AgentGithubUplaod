/**
 * T-223 regression tests — server-side DAG validation contract (migration
 * 0081) pinned against the desktop's canonical subtype registry.
 *
 * The 34th session gave the backend a REAL DAG validator
 * (public.validate_workflow_dag + the workflows_publish_gate trigger — an
 * invalid or cyclic DAG can never be published through ANY writer). The
 * validator's type/subtype whitelist lives in SQL; the builder's palette
 * lives in `domain/model/workflow.ts`. If they drift, a workflow built and
 * validated on the desktop would be rejected server-side (or worse, a
 * server-unknown subtype would sail through). These tests parse the
 * committed migration and pin BOTH whitelists together, plus the
 * structural pieces the EF rewrite depends on.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  NODE_SUBTYPES_BY_TYPE,
  WORKFLOW_NODE_SUBTYPE_LABELS_FR,
} from "../../domain/model/workflow";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Repository root (…/elimtiyaz-desktop). */
const DESKTOP_ROOT = join(__dirname, "..", "..", "..");
const MIGRATION = "supabase/migrations/0081_workflow_dag_execution_alignment.sql";

const sql = readFileSync(join(DESKTOP_ROOT, MIGRATION), "utf8");

/** Extract the v_subtype_map JSON literal from the migration source. */
function parseSqlSubtypeMap(): Record<string, string[]> {
  const start = sql.indexOf("v_subtype_map  jsonb := '{");
  expect(start, "0081 must declare v_subtype_map").toBeGreaterThan(-1);
  const open = sql.indexOf("{", start);
  // The literal ends at the closing }' before ::jsonb.
  const end = sql.indexOf("}'::jsonb", open);
  expect(end, "0081 v_subtype_map literal must terminate with }'::jsonb").toBeGreaterThan(-1);
  const literal = sql.slice(open, end + 1);
  return JSON.parse(literal) as Record<string, string[]>;
}

describe("T-223 — migration 0081 server-side DAG validation contract", () => {
  it("the migration file exists and is registered in schema_migrations", () => {
    expect(existsSync(join(DESKTOP_ROOT, MIGRATION))).toBe(true);
    expect(sql).toContain("insert into supabase_migrations.schema_migrations");
    expect(sql).toContain("'0081'");
  });

  it("SQL subtype whitelist == the desktop NODE_SUBTYPES_BY_TYPE registry (29 subtypes)", () => {
    const sqlMap = parseSqlSubtypeMap();
    const tsMap = NODE_SUBTYPES_BY_TYPE as Record<string, readonly string[]>;
    expect(Object.keys(sqlMap).sort()).toEqual(Object.keys(tsMap).sort());
    for (const type of Object.keys(tsMap)) {
      expect(sqlMap[type].sort(), `type '${type}' whitelist mismatch`).toEqual(
        [...tsMap[type]].sort(),
      );
    }
    const total = Object.values(sqlMap).reduce((n, list) => n + list.length, 0);
    expect(total).toBe(29);
  });

  it("every whitelisted subtype has a FR label in the desktop registry", () => {
    const sqlMap = parseSqlSubtypeMap();
    for (const subtypes of Object.values(sqlMap)) {
      for (const s of subtypes) {
        expect(WORKFLOW_NODE_SUBTYPE_LABELS_FR, `subtype '${s}' lacks a FR label`).toHaveProperty(s);
      }
    }
  });

  it("the publish gate blocks invalid DAGs server-side (trigger + function present)", () => {
    expect(sql).toContain("create or replace function public.workflows_publish_gate()");
    expect(sql).toContain("create trigger workflows_publish_gate");
    expect(sql).toContain("public.validate_workflow_dag(new.dag_definition, true)");
    // The gate fires on ANY transition into published AND on dag edits of an
    // already-published workflow (the whole published lifetime is gated).
    expect(sql).toContain("old.status is distinct from 'published'");
    expect(sql).toContain("new.dag_definition is distinct from old.dag_definition");
  });

  it("Kahn cycle detection + the involved-node report live in the SQL validator", () => {
    expect(sql).toContain("cycle detected");
    expect(sql).toContain("(Kahn)");
    expect(sql).toContain("array_to_string(v_cycle_nodes");
  });

  it("workflow_runs gains the execution-contract columns the EF writes", () => {
    expect(sql).toContain("add column if not exists actor_note");
    expect(sql).toContain("add column if not exists request_id");
    expect(sql).toContain("add column if not exists workflow_version");
    expect(sql).toContain("add column if not exists resumed_at");
  });

  it("trigger_type CHECK covers every desktop trigger subtype (absence_limit_excluded → absence_limit mapping excepted)", () => {
    const checkStart = sql.indexOf("workflow_runs_trigger_type_check");
    expect(checkStart).toBeGreaterThan(-1);
    const constraintBlock = sql.slice(checkStart, sql.indexOf("));", checkStart));
    // Every trigger subtype from the registry…
    for (const subtype of NODE_SUBTYPES_BY_TYPE.trigger) {
      // …with the one documented legacy spelling exception.
      const dbSpelling = subtype === "absence_limit_exceeded" ? "absence_limit" : subtype;
      expect(
        constraintBlock.includes(`'${dbSpelling}'`),
        `trigger_type CHECK must include '${dbSpelling}'`,
      ).toBe(true);
    }
  });

  it("persistent resume scheduling table + duplicate-park protection present", () => {
    expect(sql).toContain("create table if not exists public.workflow_pending_resumes");
    expect(sql).toContain("workflow_pending_resumes_run_node_uidx");
    expect(sql).toContain("where status in ('pending', 'claimed')");
    // service-role only: RLS on, no policies.
    expect(sql).toContain("alter table public.workflow_pending_resumes enable row level security");
  });

  it("publish versioning: column + bump-on-publish trigger", () => {
    expect(sql).toContain("add column if not exists version integer not null default 0");
    expect(sql).toContain("create or replace function public.workflows_version_on_publish()");
    expect(sql).toContain("new.version := coalesce(old.version, 0) + 1");
  });

  it("condition-tree validation mirrors the desktop evaluator contract", () => {
    // comparison ops: exactly the 6 canonical operators.
    expect(sql).toContain("('>', '<', '>=', '<=', '==', '!=')");
    // combinators + the NOT-single-child rule.
    expect(sql).toContain("('and', 'or', 'not')");
    expect(sql).toContain("v_combinator = 'not' and jsonb_array_length");
  });
});
