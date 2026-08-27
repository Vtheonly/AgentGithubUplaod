/**
 * Inspect actual column shapes of the tables the 0039 functions write to.
 */
import { Client } from "pg";

const db = new Client({ host: "/tmp", port: 55432, user: "postgres", database: "elimtiyaz_equiv", ssl: false });

async function cols(table: string) {
  const r = await db.query(`
    select column_name, data_type, is_nullable, column_default
    from information_schema.columns
    where table_schema='public' and table_name=$1 order by ordinal_position`, [table]);
  console.log(`\n=== ${table} ===`);
  for (const c of r.rows) {
    console.log(`  ${c.column_name.padEnd(24)} ${c.data_type.padEnd(12)} nullable=${c.is_nullable} default=${c.column_default ?? "-"}`);
  }
}

async function main() {
  await db.connect();
  await cols("payments");
  await cols("ledger_entries");
  await cols("audit_logs");
  await cols("installments");
  await db.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
