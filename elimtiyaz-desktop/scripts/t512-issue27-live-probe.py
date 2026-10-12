#!/usr/bin/env python3
"""
T-512 live probe — issue #27 ([Pedagogy] Student Registration Count Is Always
One Less Than Expected).

Probes the LIVE Supabase data-gateway (PostgREST, service-role key) to answer:

  1. How many students rows have class_id set (ALL rows vs. not-deleted)?
  2. Does the FIRST 1,000-row page (what SupabaseClassRepository.refresh()'s
     unpaginated histogram actually sees) undercount the per-class histogram?
  3. Per-class membership counts: the capped histogram vs. the true full set.
  4. Soft-deleted students carrying class_id (the overcount side).

Read-only. No mutations. Uses the data gateway first (§15.77 — the
sbp_ management token has arrived dead three sessions running).
"""
import json
import os
import urllib.request

SUPABASE_URL = "https://vebfehrpzajhstyhinnw.supabase.co"
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

HEADERS = {
    "apikey": SERVICE_KEY,
    "Authorization": f"Bearer {SERVICE_KEY}",
    "Accept": "application/json",
    "Content-Type": "application/json",
}


def get(path: str, prefer: str | None = None) -> tuple[list, dict]:
    headers = dict(HEADERS)
    if prefer:
        headers["Prefer"] = prefer
    req = urllib.request.Request(f"{SUPABASE_URL}/rest/v1/{path}", headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            body = resp.read().decode("utf-8")
            data = json.loads(body) if body else []
            return data, dict(resp.headers)
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")[:500]
        print(f"HTTP {e.code} on {path[:120]}: {err_body}")
        raise


def head_count(path: str) -> int | None:
    """Exact row count via Prefer: count=exact (Content-Range header)."""
    sep = "&" if "?" in path else "?"
    _, headers = get(f"{path}{sep}limit=1", prefer="count=exact")
    cr = None
    for k, v in headers.items():
        if k.lower() == "content-range":
            cr = v
            break
    if cr is None:
        print(f"[debug] no content-range for {path[:80]} — headers: {list(headers.keys())}")
        return None
    # e.g. "0-0/1137" or "*/1137"
    total = cr.split("/")[-1]
    return int(total) if total != "*" else None


def main() -> None:
    if not SERVICE_KEY:
        print(
            "ABORT: SUPABASE_SERVICE_ROLE_KEY must be exported "
            "(run: SUPABASE_SERVICE_ROLE_KEY=sb_secret_... python3 scripts/t512-issue27-live-probe.py)"
        )
        raise SystemExit(1)
    print("=== T-512 live probe — the enrolled-count histogram (issue #27) ===\n")

    # ── 1. The totals ──────────────────────────────────────────────────
    total_all = head_count("students?select=id")
    total_active = head_count("students?select=id&deleted_at=is.null")
    with_class_all = head_count("students?select=id&class_id=not.is.null")
    with_class_alive = head_count(
        "students?select=id&class_id=not.is.null&deleted_at=is.null"
    )
    deleted_with_class = (
        (with_class_all - with_class_alive)
        if with_class_all is not None and with_class_alive is not None
        else None
    )

    print(f"students rows (ALL, incl. soft-deleted):        {total_all}")
    print(f"students rows (deleted_at IS NULL):             {total_active}")
    print(f"students with class_id set (ALL rows):          {with_class_all}")
    print(f"students with class_id set (not deleted):       {with_class_alive}")
    print(f"soft-deleted students STILL carrying class_id:  {deleted_with_class}")

    # ── 2. What the repository's UNPAGINATED histogram actually reads ──
    # SupabaseClassRepository.refresh() does:
    #   .from("students").select("class_id").not("class_id", "is", null)
    # — no range, no limit → PostgREST returns the FIRST 1,000 rows.
    page1, _ = get("students?select=class_id&class_id=not.is.null&limit=1000")
    print(f"\nThe repository's histogram query reads at most 1,000 rows.")
    print(f"Rows visible to the histogram (first page):     {len(page1)}")

    true_all: dict[str, int] = {}
    for row in page1:
        cid = row.get("class_id")
        if cid:
            true_all[cid] = true_all.get(cid, 0) + 1

    # The COMPLETE set (keyset walk, what the histogram SHOULD see):
    full_rows: list[dict] = []
    last_id = ""
    while True:
        base = "students?select=id,class_id,deleted_at&class_id=not.is.null"
        path = (
            f"{base}&id=gt.{last_id}&order=id.asc&limit=1000"
            if last_id
            else f"{base}&order=id.asc&limit=1000"
        )
        page, _ = get(path)
        full_rows.extend(page)
        if len(page) < 1000:
            break
        last_id = page[-1]["id"]

    hist_all: dict[str, int] = {}
    hist_alive: dict[str, int] = {}
    for row in full_rows:
        cid = row.get("class_id")
        if cid:
            hist_all[cid] = hist_all.get(cid, 0) + 1
            if row.get("deleted_at") is None:
                hist_alive[cid] = hist_alive.get(cid, 0) + 1

    print(f"The COMPLETE class_id-bearing population:       {len(full_rows)}")
    missing_from_histogram = len(full_rows) - len(page1)
    print(
        f"Rows BEYOND the 1,000-row cap (invisible to enrolledCount): "
        f"{missing_from_histogram}"
    )

    # ── 3. Per-class comparison: capped vs. true ───────────────────────
    classes, _ = get("classes?select=id,name,code,is_active&order=code")
    print(f"\nPer-class counts (capped histogram vs. true full set):")
    print(f"{'class':<38} {'capped':>7} {'true':>6} {'alive':>6} {'delta':>6}")
    for c in classes:
        cid = c["id"]
        capped = true_all.get(cid, 0)
        full = hist_all.get(cid, 0)
        alive = hist_alive.get(cid, 0)
        flag = "  <-- UNDERCOUNT" if full > capped else ""
        print(
            f"{(c['name'] or c['code'])[:36]:<38} {capped:>7} {full:>6} {alive:>6} "
            f"{full - capped:>+6}{flag}"
        )

    # ── 4. The undercounted students themselves (evidence) ─────────────
    if missing_from_histogram > 0:
        page1_ids = {r.get("id") for r in page1}
        hidden = [r for r in full_rows if r["id"] not in page1_ids]
        alive_hidden = [r for r in hidden if r.get("deleted_at") is None]
        print(f"\nEvidence — students INVISIBLE to the histogram's first page:")
        print(f"  total hidden rows: {len(hidden)} (alive: {len(alive_hidden)})")
        hidden_by_class: dict[str, int] = {}
        for r in alive_hidden:
            hidden_by_class[r["class_id"]] = hidden_by_class.get(r["class_id"], 0) + 1
        for cid, n in sorted(hidden_by_class.items(), key=lambda kv: -kv[1]):
            cls = next((c for c in classes if c["id"] == cid), None)
            name = (cls["name"] if cls else cid) or cid
            print(f"  {name}: {n} alive student(s) not counted in enrolledCount")


if __name__ == "__main__":
    main()
