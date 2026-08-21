# Tier 4 Cross-Platform Equivalence Report

**Generated:** 2026-08-21T22:24:03.604Z
**Desktop engine:** TypeScript (DZD `number`) — src/domain/calc/*
**Android mirror engine:** TypeScript (centimes Long) — android_mirror/kotlin_mirror_engine.ts
**Strict mode:** false

## Summary

- Total scenarios compared: 525
- Scenarios with full equivalence: 525
- Scenarios with discrepancies: 0
- Total discrepancies: 0
  - Errors (delta > 1 centime or non-numeric mismatch): 0
  - Warnings (delta ≤ 1 centime): 0

## Verdict

✅ **PASS** — Desktop and Android mirror engines produce identical domain state for all tested scenarios.

## Discrepancies

None.

## Methodology

1. Both engines received the **exact same canonical JSON scenarios** from `scenarios/` (hand-crafted) and `generated/` (mulberry32 PRNG).
2. Each engine normalized its result to centimes (the canonical scenario format).
3. The comparator performs **deep equality** at centime-level precision.
4. The only normalization applied is for representational differences (date format → epoch millis, key ordering).
5. **No rounding or tolerance is applied to financial values.**
