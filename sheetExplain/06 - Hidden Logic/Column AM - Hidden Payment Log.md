# Column AM — Hidden Payment Log

> **One-line summary**: Column AM on [[ETAT 20262027 - The Master Ledger|ETAT 20262027]] has **no header and almost no cell values**, but it carries ~80 cell comments — each one a hand-typed payment receipt entry in the format `amount/date/receipt#`. This is the school's hidden audit trail, layered on top of the formal column-P totals.

## What column AM looks like

If you open the ETAT sheet and scroll to column AM (column 39), you'll see:
- **AM1**: empty (no header)
- **AM2 through AM404**: almost entirely empty (just one stray `'-'` in AM292)
- **AM405 onward**: empty (spare rows)

At first glance, the column appears unused. But if you hover over many of the AM cells, you'll see a **comment popup** with text like:

```
239500/05/05
```

or

```
250000/07/05B11
```

or even multi-line comments:

```
300000/31/05B01
312800/01/06B01
```

These comments are the **payment receipt log** for each student.

## The comment format

Every AM comment follows (roughly) this format:

```
amount/date  receipt#
```

| Component | Meaning | Example |
|---|---|---|
| `amount` | The payment amount in DZD | `239500`, `25000`, `600000` |
| `/` | Separator | |
| `date` | Payment date as `DD/MM` | `05/05` (May 5), `17/06` (June 17) |
| `B` + number | Receipt book identifier | `B01`, `B11`, `B12` |

So `250000/07/05B11` decodes as: 250,000 DZD paid on May 7th, receipt book B11.

Multi-line comments represent multiple payments:

```
300000/31/05B01
312800/01/06B01
```

This student made two payments: 300,000 on May 31 and 312,800 on June 1, both recorded in receipt book B01.

## The receipt book codes

The receipt book codes that appear in the AM comments:

| Code | Likely meaning |
|---|---|
| `B01` | Receipt book #1 — the current main book (most payments in 2026/2027) |
| `B11` | Receipt book #11 — probably the prior year's book |
| `B12` | Receipt book #12 — also prior year |

The school uses sequentially numbered physical receipt books. Each book has pre-numbered receipt slips (typically 50 or 100 per book). When a cash payment is received, the operator writes a receipt slip from the current book, gives one copy to the parent, and keeps the other copy in the book.

The `B01`, `B11`, `B12` codes in the AM comments identify which book the receipt was written in — making it possible to physically locate the receipt years later if there's a dispute.

## Why the log is in comments, not in cells

You might wonder: why not just have a "Payment Date" column, a "Receipt Number" column, and so on? Why hide the data in comments?

A few likely reasons:

1. **One payment per row constraint**: the ETAT sheet has one row per student, but a student may make 5–10 payments over the year. A single cell can't hold multiple payments — but a comment can have multiple lines.

2. **Avoiding column sprawl**: adding "Date1, Receipt1, Date2, Receipt2, …, Date10, Receipt10" would add 20 columns to an already-wide sheet. Comments keep the audit trail out of the way.

3. **Historical accident**: the operator probably started by typing receipt details in comments as a quick way to remember them, and the convention stuck.

The downside is that **comment data is hard to analyze**. You can't easily sum amounts across comments, filter by date, or search by receipt number. To do any of that, you'd need to parse the comments programmatically (which is what the original analysis script did).

## The 80 comments extracted

The actual AM column contains approximately 80 cell comments spread across rows 2–404. Here's a sample (showing the variety):

| Cell | Comment |
|---|---|
| AM2 | `239500/05/05` |
| AM3 | `294500/05/05` |
| AM8 | `600000/17/06` + `22000/07/06b01` |
| AM10 | `292500/06/05` |
| AM11 | `449000/06/05` |
| AM12 | `109000/06/05` |
| AM17 | `250000/07/05B11` |
| AM19 | `261000/10/05` |
| AM24 | `309000/10/05B11` |
| AM25 | `30000/10/05` |
| AM26 | `154000/11/05B11` |
| AM27 | `371000/05/11/B11` |
| AM28 | `220000/11/05B11` |
| AM33 | `113000/12/05B11` |
| AM35 | `242000/13/05B11` |
| AM41 | `43000/13/05B11` |
| AM43 | `393000/13/05B11` |
| AM51 | `96000/13/05` |
| AM52 | `220000/14/05/B11` |
| AM58 | `200000/14/05B11` + `64500/03/06B01` |
| AM59 | `348500/14/05B11` |
| AM60 | `348500/14/05B11` |
| AM61 | `25000/14/05B11` |
| AM62 | `258000/14/05B1` + `1` (split across two lines, probably a typo) |
| AM68 | `125000/11/05B11` |
| AM69 | `309000/14/05B11` |
| AM76 | `75000/17/05B12` |
| AM84 | `25000/17/05B12` |
| AM85 | `245000/17/05B12` |
| AM86 | `199000/17/05B12` |
| AM90 | `279500/18/05B12` |
| AM91 | `239500/18/05B12` |
| AM92 | `25000/18/05B12` |
| AM93 | `300000/8/05B12` |
| AM94 | `110000/20/05B12` (note: this is the row with the S94 off-by-one bug) |
| AM101 | `50000/18/5B12` |
| AM107 | `96000/19/05B12` |
| AM108 | `234500/19/05B12` |
| AM109 | `25000/20/05` |
| AM110 | `25000/20/05` |
| AM111 | `309000/20/05` |
| AM116 | `128000/20/05B12` |
| AM124 | `100000/20/05B12` |
| AM127 | `144000/20/05B12` |
| AM135 | `25000/20/05B12` |
| AM136 | `96000/21/05B12` |
| AM141 | `18000/21/05B12` |
| AM142 | `96000/21/05B12` |
| AM143 | `299000/12/05B12` |
| AM144 | `50000/21/05B12` |
| AM149 | `23000/21/05B12` |
| AM150 | `260000/21/05B12` |
| AM151 | `200000/21/05` + `162500/25/05` (two payments) |
| AM156 | `300000/24/05B12` |
| AM157 | `146000/24/05B12` |
| AM158 | `25000/24/05B12` |
| AM159 | `170000/24/0512` (typo: missing B) |
| AM161 | `303000/24/05B12` |
| AM167 | `117000/24/05B12` |
| AM168 | `110000/24/05B12` |
| AM169 | `25000/24/05B12` |
| AM173 | `309000/24/05B12` |
| AM176 | `25000/24/05B12` |
| AM177 | `245000/12/04B12` (note: April 12, not May — possibly a prior-year payment) |
| AM183 | `54000/25/05B12` |
| AM184 | `126000/25/05B12` |
| AM189 | `347000/25/05B12` |
| AM191 | `1253500/25/05/B12` (large payment — 1.25 million DZD) |
| AM200 | `14300025/05B12` (typo: missing `/` between amount and date) |
| AM201 | `25000/25/05B12` |
| AM202 | `25000/25/05B12` |
| AM206 | `453000/25/5B12` |
| AM209 | `239500/` (incomplete — missing date and receipt) |
| AM210 | `200000/25/05B12` |
| AM211 | `200000/25/05B12` |
| AM222 | `240000/25/05B12` |
| AM223 | `218000/25/05B12` |
| AM225 | `167000/25/05B12` |
| AM226 | `25000/25/05B12` |
| AM227 | `452500/25/05B12` |
| AM231 | `55000/25/05B12` |
| AM233 | `66000/25/05B12` |
| AM234 | `304000/26/05B01` |
| AM240 | `50000/26/05B01` |
| AM242 | `255000/26/05B01` |
| AM243 | `96000/26/05B01` |
| AM244 | `127000/2605B01` (typo: missing `/`) |
| AM248 | `400000/31/05B01` + `794000/14/07` (two payments months apart) |
| AM256 | `300000/31/05B01` + `312800/01/06B01` |
| AM258 | `600000/31/05B01` |
| AM266 | `20000/31/05B01` |
| AM267 | `25000/31/05B01` |
| AM268 | `71000/31/05B01` |
| AM272 | `147000/01/06B01` |
| AM276 | `96000/01/06` |
| AM277 | `67000/01/06B01` |
| AM281 | `920000/02/06/01` (the `/01` at the end is unclear — possibly B01 split) |
| AM283 | `598500/02/06B01` + `250000/02/0601` (two payments, second has typo) |
| AM289 | `25000/02/06B01` |
| AM290 | `45000/03/06B01` |
| AM291 | `24000/03/06B01` |
| AM292 | (the only AM cell with a value — just `'-'`) |
| AM292 (comment) | `25000/07/06` |
| AM301 | `514000/03/06B01` |
| AM305 | `164000/04/06B01` |
| AM306 | `144000/04/06B01` |
| AM307 | `200000/04/06B01` + `19000/07/06b01` |
| AM308 | `30000/04/06B01` |
| AM309 | `75000/04/06B01` |
| AM310 | `96000/04/06B01` |
| AM316 | `157000/04/06B01` |
| AM322 | `200000/04/06B01` |
| AM334 | `25000/07/06` |
| AM338 | `740000/07/06B01` |
| AM341 | `300008/07/06B01` (typo: extra 0 — probably 30,000) |
| AM343 | `136000*07/06B01` (typo: `*` instead of `/`) |
| AM347 | `600000/70/06B01` (typo: `70` instead of `07`) |
| AM350 | `24000/07/06` |
| AM355 | `50000/07/06B01` |
| AM357 | `100000/07/06B01` |
| AM365 | `118000/08/06` |
| AM366 | `25000/09/06B01` |
| AM367 | `30000/09/06B01` |
| AM371 | `18000/10/06B01` |
| AM376 | `242000/10/06B01` |
| AM380 | `194000/11/06B01` |
| AM382 | `270000/14/06B01` |
| AM383 | `733500/14/06B01` |
| AM390 | `40000/15/06B01` |

Plus one stray comment on `AL531`: `50000/19/09 ======` — this looks like a misplaced receipt entry that should have gone in AM531. It's the only non-AM comment in the workbook.

## What the log tells us

Looking at the comments as a whole, we can infer:

### Payment timing

Most payments are dated **May–June**, with a few in **September**. This suggests:
- The school year's payment cycle is concentrated in May and June (the end of the prior school year and the start of enrollment for the next).
- September payments are likely registration fees for the new year.
- There are no payments dated July–August (summer break) or October–April (the bulk of the school year) — the operator doesn't seem to log payments during those months, either because none are made or because the operator falls behind on logging.

### Payment amounts

The amounts range from 18,000 (a single pre-school registration) to 1,253,500 (a large family paying all children's fees at once). The most common amounts are:
- 25,000 (registration fee)
- 25000 (same, sometimes lowercase)
- 30,000 (transport tranche or larger registration)
- 100,000 (large tuition installment)
- 200,000, 300,000, 400,000, 600,000 (large lump-sum payments covering multiple installments)

### Receipt book usage

- `B11` was used heavily in May (mostly the first three weeks).
- `B12` was used in late May and early June.
- `B01` is the current book, used from late May onward.

This suggests the school cycles through receipt books roughly every few weeks during peak enrollment season.

### Operator typos

The comments contain many typos:
- Missing slashes: `14300025/05B12` (should be `143000/25/05B12`)
- Missing `B`: `170000/24/0512` (should be `170000/24/05B12`)
- Extra characters: `300008/07/06B01` (probably `30000/07/06B01`)
- Wrong separators: `136000*07/06B01` (should be `136000/07/06B01`)
- Typos in dates: `600000/70/06B01` (probably `600000/07/06B01`)

These typos make the log harder to parse programmatically but don't affect the receipt-tracking purpose — the operator can still find the receipt in the physical book.

## How this log interacts with the formulas

**It doesn't.** The AM comments are not referenced by any formula in the workbook. They're purely informational:
- The amount goes into the appropriate payment column (R/S/T/U/W/X/Y).
- The AM comment records the receipt details for audit purposes.
- P sums the payment columns; Q = L − P. Neither sees AM.

This means:
- If you enter a payment in R but forget the AM comment, P and Q update correctly — but you've lost the audit trail.
- If you enter an AM comment but forget to put the amount in R, P doesn't update — but the receipt log shows a payment was made.

The two should always be kept in sync. When reconciling at end-of-day, the operator should verify that every new AM comment has a corresponding entry in R/S/T/U/W/X/Y, and vice versa.

## How to read the log programmatically

If you wanted to extract the AM comments with Python (as the original analysis script did):

```python
import openpyxl, zipfile, re
from lxml import etree

SRC = "Suivis clients  2026_2027 .xlsx"

with zipfile.ZipFile(SRC) as z:
    cxml = z.read("xl/comments1.xml").decode("utf-8")
    root = etree.fromstring(cxml.encode("utf-8"))

ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
comments = root.findall(".//m:comment", ns)

for c in comments:
    ref = c.get("ref")  # e.g., "AM2"
    text_parts = c.findall(".//m:t", ns)
    text = "".join(t.text or "" for t in text_parts)
    print(f"{ref}: {text}")
```

This would let you build a separate "payment history" sheet from the comments, which would be useful for analysis or for including in customer statements.

## Why this matters

The AM comment log is the **only place** in the workbook where receipt-level payment details are stored. Without it:
- The school can't tie Excel entries back to physical receipts.
- Auditors can't verify that the cash the operator received matches what was entered in Excel.
- The school can't answer "when exactly did this family pay?" — only "how much have they paid total?"

The log is the workbook's **manual audit trail**, layered on top of the formal column-P totals. It's a clever workaround for the limitations of one-row-per-student spreadsheets, but it has costs: the data is hard to analyze, hard to print, and easy to forget to update.

## Recommendations

If you were modernizing the workbook, you'd want to:

1. **Move the payment log to a separate sheet** with one row per payment:
   ```
   Date | Student_Row | Amount | Receipt_Book | Receipt_Number | Method | Notes
   ```
   This would make the log filterable, sortable, and printable.

2. **Use formulas to compute P from the log**: `P = SUMIF(PayLog[Student_Row], this_row, PayLog[Amount])`. No more manual entry into R/S/T/U/W/X/Y — the log is the source of truth.

3. **Add a "Receipt Number" column** to make each payment uniquely identifiable.

4. **Print the log** as part of the customer statement (see [[Workflow 4 - Customer Statement]]).

5. **Backfill the existing AM comments** into the new log format (the Python script above can do this).

This would be a significant enhancement but would make the workbook much more robust and auditable.

## See also

- [[ETAT 20262027 - The Master Ledger]] — the sheet where AM lives
- [[P - TOTAL VERSEMENTS Formula]] — the formal payment total (which AM doesn't feed into)
- [[Workflow 3 - Payment Recording]] — the daily loop that creates AM comments
- [[French Terms Glossary]] — for terms like "Versements", "Règlements"
