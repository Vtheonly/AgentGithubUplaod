#!/usr/bin/env bash
# db-audit.sh — read-only PostgreSQL/Supabase audit via the Supabase Management API.
# Part of the Codebase Intelligence, Architecture & Duplication Audit.
# Usage: SUPABASE_ACCESS_TOKEN=... SUPABASE_PROJECT_REF=... ./db-audit.sh
# SAFETY: SELECT-only queries against catalogs. No DDL/DML, ever.
set -uo pipefail
OUT="$(dirname "$0")/../raw/db"
mkdir -p "$OUT"

REF="${SUPABASE_PROJECT_REF:?set SUPABASE_PROJECT_REF}"
TOK="${SUPABASE_ACCESS_TOKEN:?set SUPABASE_ACCESS_TOKEN}"
URL="https://api.supabase.com/v1/projects/$REF/database/query"

q() {
  local name="$1"; shift
  local query="$1"
  curl -s -m 60 -X POST "$URL" \
    -H "Authorization: Bearer $TOK" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --arg q "$query" '{query: $q}')" > "$OUT/$name.json"
  local n
  n=$(jq 'if type=="array" then length else "ERR" end' "$OUT/$name.json" 2>/dev/null || echo ERR)
  echo "$name: rows=$n"
}

q tables "select table_name, table_type from information_schema.tables where table_schema='public' order by table_name"
q rls "select c.relname as table, c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced, c.relrowsecurity and not exists (select 1 from pg_policies p where p.tablename = c.relname and p.schemaname='public') as rls_enabled_no_policies from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' order by c.relname"
q policies "select schemaname, tablename, policyname, cmd, roles, permissive, qual, with_check from pg_policies where schemaname='public' order by tablename, policyname"
q functions "select p.proname, l.lanname, p.prosecdef as security_definer, p.proconfig, pg_get_function_arguments(p.oid) as args from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang where n.nspname='public' order by p.proname"
q indexes "select tablename, indexname, indexdef from pg_indexes where schemaname='public' order by tablename"
q fks_unindexed "select con.conname as fk, rel.relname as table, att.attname as column, 'FK_COLUMN_NOT_INDEXED' as issue from pg_constraint con join pg_class rel on rel.oid = con.conrelid join pg_attribute att on att.attrelid = con.conrelid and att.attnum = any(con.conkey) where con.contype='f' and rel.relnamespace = 'public'::regnamespace and not exists (select 1 from pg_index i where i.indrelid = con.conrelid and att.attnum = any(i.indkey) and i.indkey[0] = att.attnum) order by rel.relname"
q tables_no_pk "select c.relname as table from pg_class c join pg_namespace n on n.oid=c.relnamespace left join pg_constraint con on con.conrelid=c.oid and con.contype='p' where n.nspname='public' and c.relkind='r' and con.oid is null order by c.relname"
q timestamps_tz "select table_name, column_name, data_type from information_schema.columns where table_schema='public' and data_type like 'timestamp%' group by table_name, column_name, data_type order by data_type, table_name limit 60"
q sizes "select relname as table, pg_size_pretty(pg_total_relation_size(oid)) as total_size, pg_total_relation_size(oid) as bytes, n_live_tup as est_rows from pg_stat_user_tables order by pg_total_relation_size(oid) desc limit 20"
q triggers "select event_object_table as table, trigger_name, action_timing, event_manipulation, action_statement from information_schema.triggers where trigger_schema='public' order by event_object_table, trigger_name"
q views "select viewname, definition from pg_views where schemaname='public' order by viewname"
q enum_types "select t.typname, e.enumlabel from pg_type t join pg_enum e on e.enumtypid=t.oid join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' order by t.typname, e.enumsortorder"
q extensions "select extname, extversion from pg_extension order by extname"
