#!/usr/bin/env python3
"""Cross-compare the Excel (ETAT CSV) source against the live Supabase DB.

Verifies the owner's claim set:
  - row drops (SUMMARY_KEYWORDS rule)
  - financial column totals vs ledger/payments/installments aggregates
  - student count parity
"""
import csv
import json
import os
import sys
import urllib.request

# Resolve the workbook CSV relative to this script (repo-root/Suivis clients  CSV/).
_REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
CSV = os.path.join(_REPO_ROOT, "Suivis clients  CSV", "Suivis clients  2026_2027 -ETAT 20262027.csv")
SUPABASE_REF = "hkvkefubghbbotgnteir"
# NEVER commit the token (AGENTS.md §15.12) — read from the environment.
TOKEN = os.environ.get("SUPABASE_ACCESS_TOKEN", "")
if not TOKEN:
    sys.exit("Set SUPABASE_ACCESS_TOKEN in the environment (the sbp_ Management-API token).")
SQL_URL = f"https://api.supabase.com/v1/projects/{SUPABASE_REF}/database/query"

SUMMARY_KEYWORDS = ["TOTAL", "TOTAUX", "SOMME", "MOYENNE", "NB", "NOMBRE",
                    "RECAP", "RECAPITULATIF", "STATISTIQUE", "COUNT", "SUM", "AVERAGE"]


def norm(s):
    return (s or "").strip().upper()


def num(v):
    if v is None:
        return 0
    s = str(v).strip().replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return 0.0


def load_csv():
    with open(CSV, encoding="utf-8-sig", newline="") as f:
        rows = list(csv.reader(f))
    header = rows[0]
    # strip header whitespace
    header = [h.strip() for h in header]
    data = []
    for r in rows[1:]:
        if not any(cell.strip() for cell in r):
            continue
        rec = {header[i]: (r[i].strip() if i < len(r) else "") for i in range(len(header))}
        data.append(rec)
    return header, data


def analyze_csv():
    header, data = load_csv()
    print(f"CSV data rows (non-empty): {len(data)}")

    # 1. Rows dropped by the SUMMARY_KEYWORDS rule (any string cell prefix match)
    dropped = []
    for idx, rec in enumerate(data, start=2):  # header is row 1
        nom = rec.get("NOM", "")
        if not nom:
            continue  # rows without NOM are skipped anyway (non-data rows)
        for key, val in rec.items():
            if key.startswith("__") or not val:
                continue
            nv = norm(val)
            for kw in SUMMARY_KEYWORDS:
                if nv == kw or nv.startswith(kw + " ") or nv.startswith(kw + ":") or nv.startswith(kw + " -") or nv.startswith(kw + "_"):
                    dropped.append((idx, nom, key, val, kw))
                    break
            else:
                continue
            break
    print(f"\nRows WITH a NOM that the validator would DROP (keyword rule): {len(dropped)}")
    for d in dropped[:20]:
        print(f"  csv line {d[0]}: NOM={d[1]!r} dropped because {d[2]}={d[3]!r} matched {d[4]}")

    # 2. Student rows (with NOM)
    students = [r for r in data if r.get("NOM", "").strip()]
    print(f"\nStudent rows with NOM: {len(students)}")

    # 3. Financial totals
    totals = {}
    for col in ["DEVIS ANNUEL", "REMISE", "REMBOURCEMENT", "DETTES", "REGLEMENTS DETTES",
                "FI", "V2", "2V", "v3", "SEPTEMBRE", "DECEMBRE", "MARS",
                "1T", "T2", "t3", "PSY1", "PSY2", "ORTH1", "ORTH2", "E-PLANT", "Ratrapage"]:
        totals[col] = sum(num(r.get(col, "")) for r in students)
    print("\nCSV financial column totals (DZD):")
    for k, v in totals.items():
        print(f"  {k:22s} {v:>14,.0f}")

    # 4. Combined per-column counts (nonzero)
    counts = {col: sum(1 for r in students if num(r.get(col, "")) > 0)
              for col in ["FI", "V2", "2V", "v3", "SEPTEMBRE", "DECEMBRE", "MARS", "1T", "T2", "t3", "DISTINATION"]}
    print("\nNonzero counts per column:")
    for k, v in counts.items():
        print(f"  {k:22s} {v}")

    return totals, counts, len(students)


def query_db(sql):
    payload = json.dumps({"query": sql}).encode()
    req = urllib.request.Request(
        SQL_URL, data=payload, method="POST",
        headers={"Authorization": f"Bearer {TOKEN}",
                 "Content-Type": "application/json",
                 "User-Agent": "el-imtiyaz-live-verify/1.0"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.loads(resp.read().decode())


def analyze_db():
    r1 = query_db("SELECT count(*) AS n FROM students WHERE tenant_id='00000000-0000-0000-0000-000000000001' AND is_active")
    r2 = query_db("SELECT count(*) AS n, sum(amount) AS total FROM ledger_entries WHERE tenant_id='00000000-0000-0000-0000-000000000001' AND entry_type='payment' AND metadata->>'field'='FI'")
    r3 = query_db("SELECT count(*) AS n, sum(amount) AS total FROM ledger_entries WHERE tenant_id='00000000-0000-0000-0000-000000000001' AND entry_type='payment' AND metadata->>'field' IN ('V2')")
    r4 = query_db("SELECT count(*) AS n, sum(amount) AS total FROM ledger_entries WHERE tenant_id='00000000-0000-0000-0000-000000000001' AND entry_type='payment' AND metadata->>'field' IN ('V2_ALT')")
    r5 = query_db("SELECT count(*) AS n, sum(amount) AS total FROM ledger_entries WHERE tenant_id='00000000-0000-0000-0000-000000000001' AND entry_type='payment' AND metadata->>'field' IN ('V3')")
    r6 = query_db("SELECT count(*) AS n, sum(amount) AS total FROM ledger_entries WHERE tenant_id='00000000-0000-0000-0000-000000000001' AND entry_type='payment' AND metadata->>'field' IN ('T1','T2','T3')")
    print("\nDB aggregates:")
    print(f"  students (active):            {r1[0]['n']}")
    print(f"  FI payments:      {r2[0]['n']:4d} rows, total {-float(r2[0]['total']):,.0f} DZD")
    print(f"  V2 payments:      {r3[0]['n']:4d} rows, total {-float(r3[0]['total']):,.0f} DZD")
    print(f"  V2_ALT payments:  {r4[0]['n']:4d} rows, total {-float(r4[0]['total']):,.0f} DZD")
    print(f"  V3 payments:      {r5[0]['n']:4d} rows, total {-float(r5[0]['total']):,.0f} DZD")
    print(f"  T1+T2+T3 (transport): {r6[0]['n']:4d} rows, total {-float(r6[0]['total']):,.0f} DZD")


if __name__ == "__main__":
    totals, counts, n_students = analyze_csv()
    analyze_db()
