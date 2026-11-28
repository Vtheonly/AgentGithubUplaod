# Similarity audit

Scan committed code for possible reimplementations, then give the review queue to an engineer or coding agent. The scanner groups matching source ranges. A reviewer establishes whether the implementations share a responsibility and whether their behavior agrees.

## Run after a coding session

Use Git, Python 3.10+, Node.js 22+ and npm on Linux. From the main repository root, with optional website and Android checkouts beside it, run:

```sh
cd tools/similarity-audit
npm ci
npm run scan -- --website ../../../elimtiyaz-website --android ../../../elimtiyaz-android
```

For desktop alone, use `npm run scan`. Each selected checkout is read at its local Git HEAD. Commit the changes you want scanned first. The passes include Fallow strict, near and semantic clone detection, jscpd token matching, TypeScript AST body and structure comparisons, and a cross-language function-name check for Kotlin, SQL and JavaScript/TypeScript.

## Review the results

Start with **.audit/REVIEW.md** for the next 25 groups. **.audit/CANDIDATES.md** lists all current groups and source ranges. **.audit/inventory.json** contains machine-readable results, scanned revisions and oversized exclusions.

For each group, read the cited implementations and trace their callers. Compare outputs on the same inputs and check side effects such as writes, permissions and retries. Leave the group pending until the evidence supports a verdict. To record a decision, replace the uppercase placeholders:

```sh
npm run review -- GROUP_ID equivalent --owner 'CANONICAL_MODULE_OR_TEAM' --evidence 'CALLERS_AND_PARITY_TEST_RESULT' --watch 'PATH_FROM_INVENTORY'
```

Verdicts are `exact`, `equivalent`, `conflict`, `intentional` and `false-positive`. Repeat the optional `--watch` flag for callers and fixtures whose changes should reopen a decision.

## What keeps repeat runs manageable

An identical source and scanner fingerprint skips all detection passes. A changed snapshot runs the detectors again across the selected sources so newly copied code can match an older file. Matches are grouped, and the queue size can be changed with `--batch` (1–250). The scan allows up to 20,000 source files, 200 MiB total, 5 MiB per file, and five minutes per detector invocation. Review state lives in the local, Git-ignored `.audit/` directory. Keep it between sessions to reuse decisions. Matches are investigation leads, and sufficiently different implementations can escape detection.

## Pinned dependency patches

`patches/@jscpd+tokenizer+4.0.1.patch` is applied automatically by `patch-package` on `npm ci`. Upstream `@jscpd/tokenizer` 4.0.1 rebuilds its token arrays with `concat`/spread on every token (`groupByFormat`, `tokenize`, `createTokens`), which is quadratic per file; on the full three-repository snapshot (2,017 files, 24 MiB, led by an 18,528-line SQL migration) jscpd exceeded ten minutes and hit the per-invocation timeout. The patch replaces the quadratic rebuilds with `push` only — order, grouping and output are unchanged (verified byte-identical after timestamp normalization on the worst file and on the website+Android subset), and the full-scan jscpd pass drops to about a minute.

