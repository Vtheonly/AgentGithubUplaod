# T-460 DELIVERY — the 132nd session: H part 2 + F-19 + pass J (the campaign COMPLETE — DUP-003 RESOLVED-TESTED)

**Session:** 132nd (2026-10-02) · **Task:** T-460 (**COMPLETE** — the issue-#3 inventory fully
delivered) · **Merged at:** android main `3e719ed` · hub main `65fc858` (the registry update) —
all pushed to origin.

## The session's mandate

The issue-#3 registered remaining scope, plus the three owner decisions received this session:
**F-19 = option (b)** (bless on-grid literals, sweep only the off-grid values), **F-11 = keep
ProfileScreen** as the single full session surface, and the push/PAT (every merge pushed +
fetch-guarded per the concurrent-agent caution).

## What was delivered (each: branch → commit → push → merge --no-ff → push main → branch deleted, per ADR-028)

1. **The F-10 dialog sweep** (`a7f81f7 → b2224e9`): the last 8 raw AlertDialogs + the RollCall
   raw DatePickerDialog + every remaining raw field/button/spinner → the DS primitives; the
   birth-date text fields upgraded to the DS ElDatePicker.
2. **The F-18 toast sweep** (`d23d509 → 6bdae0a`): the NEW app-scoped **ElToastHost** DS layer
   (the desktop ToastProvider's Android mirror — toasts survive navigation pops, the property
   that kept the platform toast alive); the 9 fire sites + PhoneUtils (12 call sites) migrated;
   ElToastHostTest 4/4 (ARCH-012 release exclusion in the same commit).
3. **The sp sweep** (`35c16ec → b1e0d1b`): all 62 raw fontSize literals onto the named styles +
   the new `chartMicro` (9sp) tier; the scripted mapping in `scripts/sp-sweep.py`.
4. **The F-19 dp sweep, the owner-approved option b** (`133f835 → 498d04b`): 355 off-grid values
   ≥4dp onto the 4dp grid (ties up; 18→16); the counter IS the standard
   (`scripts/dp-sweep.py --check` = 0) with the sub-4dp micro class, strokes and corner radii
   as documented exemptions.
5. **Pass J / F-13 — the directory search parity** (`60d5e15 → d8915b8`): ElSearchBar on
   Employee / Subjects / Classes (pure, unit-tested filters; DirectorySearchParityT460Test 7/7).
6. **Pass J / F-11 — the session-surface consolidation** (`4a62842 → 3e719ed`): SignOutScreen →
   the redirect (the French roleLabel), the Personnel tab renamed "Session", MainViewModel's
   dead sign-out path deleted, ProfileScreen's debug rows removed; the F-01 pin evolved 2→4
   tests (the canonical-path population = exactly {ProfileViewModel, SettingsViewModel}).

## The closing full gate (isolated runs, per the disk-pressure discipline)

- `./gradlew test` — **debug 669/0 + release 628/0** (656 → 669 this session)
- `lintDebug` + `lintRelease` — green · `assembleDebug` — **31.6 MB**
- **The LIVE-database equivalence run** (the owner's Supabase tokens, a fresh daemon):
  LiveDatabaseEquivalenceTest **ran live** — every dashboard statistic equals the live SQL truth
- All grep gates zero (legacy kits · MaterialTheme reads · raw M3 primitives · platform toasts
  · raw sp · off-grid dp counter)

## The archives

- `elimtiyaz-android-T460-H2J.zip` — the android working tree at main `3e719ed` (2.2 MB;
  excludes .git, build outputs, .env — the secrets never ship in archives — local.properties).
- `el-imtiyaz-all-systems-T460-H2J.zip` — the hub (with the desktop + the updated registries)
  + the android tree (11 MB; same exclusions + the prior deliverable archives, per the
  t440-build-zips convention).

## What remains (registered, outside T-460)

The F-19(a) full-tokenization variant (deliberately not taken — on-grid literals are blessed
per the owner decision) · T-173 (the Room dismissedAt migration) · the standing next pick
**T-102-follow-up** (the Android chat read-side + online sends).
