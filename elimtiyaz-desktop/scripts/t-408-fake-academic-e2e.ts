/**
 * t-408-fake-academic-e2e.ts — T-408 live E2E with owner-authorized
 * FAKE-marked test data (91st session).
 *
 * THE OWNER'S MANDATE (2026-09-22): "Do the rest of the tests. For now,
 * create clearly marked fake test data: fake teacher names, class names,
 * and subjects, with something like `FAKE` in their names so they can be
 * easily identified, queried, tagged, and removed from the database
 * later. Create enough fake classes, teachers, subjects/matières, and
 * related academic records so I can properly test the timetable
 * functionality and its interactions with the rest of the academic
 * system."
 *
 * This closes the T-408 VERIFIED gate #1 (the live teacher/class/curriculum
 * /timetable E2E) with DISPOSABLE data instead of the owner's real staff.
 *
 * WHAT IT DOES — every write goes through the SAME canonical repositories
 * the desktop app uses (src/infrastructure/supabase/repositories/), never
 * a raw SQL shortcut:
 *
 *   PHASE 0 — session: admin sign-in (OPS-310 owner-pinned credential) +
 *              the localStorage session polyfill (el-imtiyaz.session) so
 *              getTenantId() resolves the working tenant.
 *   PHASE 1 — SEED (all rows carry the `FAKE` marker, see the convention
 *              in AGENTS.md §15.50):
 *     1a. 8 FAKE personnel        (SupabasePersonnelRepository.createPersonnel)
 *     1b. 8 FAKE teachers         (SupabaseTeacherRepository.createTeacher —
 *                                  the personnel staff_category flip)
 *     1c. 2 FAKE subjects         (SupabaseSubjectRepository.createSubject)
 *     1d. 5 FAKE classes          (SupabaseClassRepository.createClass —
 *                                  real academic_levels UUID via
 *                                  getByGradeCode + the current year UUID)
 *     1e. 53 class_subjects       (assignSubjectToClass — weekly hours,
 *                                  teacher bindings, required room types,
 *                                  one consecutive double-period block)
 *     1f. 9 FAKE rooms            (SupabaseTimetableRepository.createRoom)
 *     1g. 3 FAKE constraints      (createConstraint — params carry the
 *                                  {"_fake": true} JSONB tag)
 *   PHASE 2 — TIMETABLE E2E (the "rest of the tests"):
 *     2a. the 0109-seeded Algerian configuration is present + active
 *     2b. generateTimetable (ts-greedy-v1) → draft, 0 unplaced,
 *         0 hard violations, entries == total weekly hours
 *     2c. no teacher/room/class double-booking (the DB unique indexes are
 *         the backstop; this is the read-side proof)
 *     2d. submitForReview → in_review
 *     2e. approveVersion   → approved
 *     2f. publishVersion   → published (the canonical fn_timetable_publish
 *         RPC — 0109 §7)
 *     2g. v_timetable_published: admin JWT sees the rows, anon gets 401
 *   PHASE 3 — INTERACTIONS with the rest of the academic system:
 *     3a. the Matières-Classes tab data (observeByClass) round-trips
 *     3b. the teacher registry (observe) lists the 8 FAKE teachers active
 *     3c. the homeroom-teacher FK (0112) round-trips on class read-back
 *     3d. manual-adjustment survival: duplicateVersionToDraft → moveEntry
 *         (live-validated) → setEntryLocked → generateTimetable
 *         (fromVersionId) → the locked pin survives regeneration
 *
 * THE DATA PERSISTS ON PURPOSE — the owner tests the Emploi du temps UI
 * with it afterwards. Cleanup is scripts/t-408-fake-data-purge.py (dry-run
 * by default). Audit rows stay (§15.26).
 *
 * Run (from elimtiyaz-desktop/):
 *   npx tsx scripts/t-408-fake-academic-e2e.ts
 *
 * Environment: the admin credential is the OPS-310 owner-pinned constant
 * (never rotate); the project is the canonical production project baked
 * into supabase-client.ts.
 */

// ============================================================================
// Phase 0 prerequisites — the session polyfill MUST be installed BEFORE the
// repository modules are imported (getTenantId() reads localStorage at call
// time, but the import graph is evaluated once, top-down).
// ============================================================================
const TENANT_ID = "00000000-0000-0000-0000-000000000001";

const storage = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => void storage.set(k, String(v)),
  removeItem: (k: string) => void storage.delete(k),
  clear: () => storage.clear(),
  key: (i: number) => [...storage.keys()][i] ?? null,
  get length() {
    return storage.size;
  },
} as Storage;

// The working-tenant session (the same shape SupabaseAuthRepository stores
// under "el-imtiyaz.session"). userId is filled after sign-in.
storage.set(
  "el-imtiyaz.session",
  JSON.stringify({
    tenantId: TENANT_ID,
    homeTenantId: TENANT_ID,
    userId: "pending",
    displayName: "T-408 FAKE E2E",
  }),
);

// ============================================================================
// Imports (dynamic — AFTER the polyfill)
// ============================================================================
async function main(): Promise<void> {
  const { createClient } = await import("@supabase/supabase-js");
  const {
    SupabasePersonnelRepository,
    RoleLookup,
  } = await import("../src/infrastructure/supabase/repositories/supabase-personnel-repository");
  const {
    SupabaseTeacherRepository,
  } = await import("../src/infrastructure/supabase/repositories/supabase-teacher-repository");
  const {
    SupabaseAcademicYearRepository,
    SupabaseAcademicLevelRepository,
    SupabaseClassRepository,
    SupabaseSubjectRepository,
  } = await import("../src/infrastructure/supabase/repositories/supabase-academic-repository");
  const {
    SupabaseTimetableRepository,
  } = await import("../src/infrastructure/supabase/repositories/supabase-timetable-repository");
  const { GREEDY_SOLVER_ID } = await import("../src/domain/calc/timetable/solver");

  const SUPABASE_URL = "https://vebfehrpzajhstyhinnw.supabase.co";
  const ANON_KEY = "sb_publishable_IPUtQMYQzr1wNnfGTcl5MA_wuz3RUdg";
  // OPS-310: the owner-pinned admin credential — NEVER rotate.
  const ADMIN_EMAIL = "admin@elimtiyaz.dz";
  const ADMIN_PW = "elimtiyaz@admin2026";

  // --------------------------------------------------------------------------
  // Result bookkeeping (any RED exits non-zero)
  // --------------------------------------------------------------------------
  const results: Array<{ label: string; ok: boolean; detail: string }> = [];
  function check(label: string, ok: boolean, detail = ""): void {
    results.push({ label, ok, detail });
    console.log(`  ${ok ? "GREEN" : "RED  "}  ${label}${detail ? ` — ${detail}` : ""}`);
  }

  // PERF-501's transient-failure absorber, harness-side: the Algeria →
  // eu-west-1 route occasionally 5xxes or drops the fetch mid-chain (the
  // 91st session's live evidence: insert #25 of 53 answered « Erreur interne
  // du serveur » while its retry succeeded; a later run's createTeacher got
  // « Connexion réseau impossible » at the fetch layer). Retries (max 2)
  // apply to server/network-class errors ONLY — validation errors fail
  // loud, first try.
  async function withRetry<T>(
    fn: () => Promise<{ ok: true; value: T } | { ok: false; error: { userMessage?: string; message?: string } }>,
    isTransient = (msg: string) =>
      /interne|internal|server|timeout|timed?\s*out|fetch|network|réseau|connexion|unreachable|econn|5\d\d/i.test(msg),
  ): Promise<{ ok: true; value: T } | { ok: false; error: { userMessage?: string; message?: string } }> {
    let res = await fn();
    for (let attempt = 0; attempt < 2 && !res.ok; attempt += 1) {
      const msg = res.ok ? "" : (res.error.userMessage ?? res.error.message ?? "");
      if (!isTransient(msg)) return res;
      console.log(`       … transient (${msg.slice(0, 60)}) — retrying`);
      await new Promise((r) => setTimeout(r, 2500));
      res = await fn();
    }
    return res;
  }

  // Light pacing between seed writes — the burst-of-writes phase is where
  // the gateway blips were observed (2 in 2 runs); 150 ms keeps the whole
  // seed under ~15 s of pacing while smoothing the request rate.
  const pace = () => new Promise((r) => setTimeout(r, 150));

  // Retried READ helper for the direct client queries in the assertion
  // phases — a transient blip on a read must surface as a retry, not as a
  // silent null → "0 rows" RED (the 3rd run's live evidence: the homeroom
  // read-back and the teacher registry both read 0 on blipped fetches).
  async function retriedRead<T>(
    fn: () => Promise<{ data: T | null; error: { message?: string } | null }>,
  ): Promise<{ data: T | null; error: { message?: string } | null }> {
    let res = await fn();
    for (let attempt = 0; attempt < 2 && res.error; attempt += 1) {
      const msg = res.error.message ?? "";
      if (!/fetch|network|réseau|connexion|timeout|5\d\d/i.test(msg)) return res;
      await new Promise((r) => setTimeout(r, 2500));
      res = await fn();
    }
    return res;
  }

  console.log(`== T-408 FAKE academic E2E (${new Date().toISOString()}) ==`);

  // --------------------------------------------------------------------------
  // Phase 0 — client + admin session
  // --------------------------------------------------------------------------
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signIn = await client.auth.signInWithPassword({
    email: ADMIN_EMAIL,
    password: ADMIN_PW,
  });
  check("S0 admin sign-in", !signIn.error, signIn.error?.message ?? "");
  if (signIn.error) process.exit(1);
  const adminUserId = signIn.data.user?.id ?? "";
  const actor = { actorId: adminUserId, actorName: "admin@elimtiyaz.dz" };
  storage.set(
    "el-imtiyaz.session",
    JSON.stringify({
      tenantId: TENANT_ID,
      homeTenantId: TENANT_ID,
      userId: adminUserId,
      displayName: "T-408 FAKE E2E",
    }),
  );

  // Canonical repositories (the SAME classes getSupabaseRepositories() wires).
  const roleLookup = new RoleLookup(client);
  const personnelRepo = new SupabasePersonnelRepository(client, roleLookup);
  const teacherRepo = new SupabaseTeacherRepository(client);
  const yearRepo = new SupabaseAcademicYearRepository(client);
  const levelRepo = new SupabaseAcademicLevelRepository(client);
  const classRepo = new SupabaseClassRepository(client);
  const subjectRepo = new SupabaseSubjectRepository(client);
  const timetableRepo = new SupabaseTimetableRepository(client);

  // --------------------------------------------------------------------------
  // The FAKE dataset (all names/codes/labels carry the ASCII marker `FAKE`)
  // --------------------------------------------------------------------------
  const FAKE_TEACHERS = [
    { key: "T1", first: "FAKE Ahmed", last: "FAKE-Benali", position: "FAKE Enseignant Arabe (test)" },
    { key: "T2", first: "FAKE Amina", last: "FAKE-Haddad", position: "FAKE Enseignante Arabe/Islam (test)" },
    { key: "T3", first: "FAKE Karim", last: "FAKE-Ziani", position: "FAKE Enseignant Français (test)" },
    { key: "T4", first: "FAKE Leila", last: "FAKE-Saidi", position: "FAKE Enseignante Maths (test)" },
    { key: "T5", first: "FAKE Omar", last: "FAKE-Belkacem", position: "FAKE Enseignant Sciences (test)" },
    { key: "T6", first: "FAKE Nadia", last: "FAKE-Merabet", position: "FAKE Enseignante Anglais (test)" },
    { key: "T7", first: "FAKE Yacine", last: "FAKE-Bouzid", position: "FAKE Enseignant EPS/Art (test)" },
    { key: "T8", first: "FAKE Sonia", last: "FAKE-Cherif", position: "FAKE Enseignante Info/Sciences (test)" },
  ] as const;

  const FAKE_SUBJECTS = [
    {
      code: "FAKE-ROBOTIQUE",
      name: "FAKE Robotique éducative",
      nameAr: "FAKE الروبوت التعليمي",
    },
    {
      code: "FAKE-THEATRE",
      name: "FAKE Théâtre et expression",
      nameAr: "FAKE المسرح والتعبير",
    },
  ] as const;

  // Class definitions — gradeCode values are the REAL academic_levels ladder
  // codes (migration 0114's catalog); levels resolve to REAL uuids through
  // SupabaseAcademicLevelRepository.getByGradeCode (the ACAD-506 contract).
  const FAKE_CLASSES = [
    { key: "C1", code: "CLS-FAKE-1AM-A", name: "FAKE 1AM — Section A", grade: "1am" as const, section: "A", capacity: 32, homeroom: "T1" },
    { key: "C2", code: "CLS-FAKE-1AM-B", name: "FAKE 1AM — Section B", grade: "1am" as const, section: "B", capacity: 32, homeroom: "T3" },
    { key: "C3", code: "CLS-FAKE-2AM-A", name: "FAKE 2AM — Section A", grade: "2am" as const, section: "A", capacity: 30, homeroom: "T4" },
    { key: "C4", code: "CLS-FAKE-4AM-B", name: "FAKE 4AM — Section B", grade: "4am" as const, section: "B", capacity: 30, homeroom: "T2" },
    { key: "C5", code: "CLS-FAKE-1AS-A", name: "FAKE 1ère AS — Section A", grade: "1ere_annee" as const, section: "A", capacity: 28, homeroom: "T5" },
  ] as const;

  // The curriculum: [subject code, teacher key, weekly hours, coefficient,
  // required room type, consecutive periods]. REAL catalog subjects carry the
  // canonical Algerian curriculum; the two FAKE subjects ride along.
  //
  // Density calibration (91st session, live evidence): at 27–29 periods per
  // class (90%+ occupancy) the deterministic greedy left exactly ONE period
  // unplaced every run — the class's last free slots all collided with the
  // teacher's busy slots (no backtracking). 22–24h per class (≈80% occupancy,
  // teachers ≤ 16h) is the slack a real school also runs with; the corner
  // case itself is registered as the SCHED-110 solver-improvement finding.
  type Row = [string, string, number, number, string | null, number?];
  const CURRICULUM: Record<string, readonly Row[]> = {
    C1: [
      ["ARABE", "T1", 4, 5, null],
      ["FRANCAIS", "T3", 3, 3, null],
      ["MATHS", "T4", 4, 4, null],
      ["ANGLAIS", "T6", 2, 2, null],
      ["EDU_ISLAM", "T2", 2, 2, null],
      ["EDU_ARTISTIQUE", "T7", 1, 1, null],
      ["EPS", "T7", 2, 1, "sports"],
      ["INFORMATIQUE", "T8", 1, 1, "computer_lab"],
      ["EVEIL_SCI", "T8", 1, 2, null],
      ["HIST_GEO", "T6", 2, 2, null],
      ["FAKE-ROBOTIQUE", "T8", 2, 1, "computer_lab", 2],
    ],
    C2: [
      ["ARABE", "T1", 4, 5, null],
      ["FRANCAIS", "T3", 3, 3, null],
      ["MATHS", "T4", 4, 4, null],
      ["ANGLAIS", "T6", 2, 2, null],
      ["EDU_ISLAM", "T2", 2, 2, null],
      ["EDU_ARTISTIQUE", "T7", 1, 1, null],
      ["EPS", "T7", 2, 1, "sports"],
      ["INFORMATIQUE", "T8", 1, 1, "computer_lab"],
      ["EVEIL_SCI", "T8", 1, 2, null],
      ["HIST_GEO", "T6", 2, 2, null],
    ],
    C3: [
      ["ARABE", "T1", 4, 5, null],
      ["FRANCAIS", "T3", 3, 3, null],
      ["MATHS", "T4", 4, 4, null],
      ["ANGLAIS", "T6", 2, 2, null],
      ["EDU_ISLAM", "T2", 2, 2, null],
      ["EDU_ARTISTIQUE", "T7", 1, 1, null],
      ["EPS", "T7", 2, 1, "sports"],
      ["INFORMATIQUE", "T8", 1, 1, "computer_lab"],
      ["SVT", "T5", 2, 2, null],
      ["PHYSIQUE", "T5", 2, 2, null],
      ["HIST_GEO", "T6", 1, 2, null],
    ],
    C4: [
      ["ARABE", "T2", 4, 5, null],
      ["FRANCAIS", "T3", 3, 3, null],
      ["MATHS", "T4", 4, 4, null],
      ["ANGLAIS", "T6", 2, 2, null],
      ["EDU_ISLAM", "T8", 2, 2, null],
      ["EPS", "T7", 2, 1, "sports"],
      ["INFORMATIQUE", "T8", 1, 1, "computer_lab"],
      ["SVT", "T5", 2, 2, null],
      ["PHYSIQUE", "T5", 2, 2, null],
      ["HIST_GEO", "T6", 1, 2, null],
      ["FAKE-THEATRE", "T7", 1, 1, null],
    ],
    C5: [
      ["ARABE", "T2", 4, 4, null],
      ["FRANCAIS", "T3", 3, 3, null],
      ["MATHS", "T5", 5, 5, null],
      ["PHYSIQUE", "T5", 3, 4, "science_lab"],
      ["SVT", "T8", 2, 4, "science_lab"],
      ["HIST_GEO", "T2", 2, 2, null],
      ["ANGLAIS", "T6", 2, 2, null],
      ["EPS", "T7", 2, 1, "sports"],
      ["INFORMATIQUE", "T8", 1, 1, "computer_lab"],
    ],
  };

  const FAKE_ROOMS = [
    { code: "FAKE-SAL-01", name: "FAKE Salle 01 — Bâtiment A", roomType: "classroom" as const, capacity: 32, building: "FAKE-A", floorLabel: "RDC" },
    { code: "FAKE-SAL-02", name: "FAKE Salle 02 — Bâtiment A", roomType: "classroom" as const, capacity: 32, building: "FAKE-A", floorLabel: "RDC" },
    { code: "FAKE-SAL-03", name: "FAKE Salle 03 — Bâtiment A", roomType: "classroom" as const, capacity: 32, building: "FAKE-A", floorLabel: "1er" },
    { code: "FAKE-SAL-04", name: "FAKE Salle 04 — Bâtiment A", roomType: "classroom" as const, capacity: 32, building: "FAKE-A", floorLabel: "1er" },
    { code: "FAKE-SAL-05", name: "FAKE Salle 05 — Bâtiment B", roomType: "classroom" as const, capacity: 30, building: "FAKE-B", floorLabel: "RDC" },
    { code: "FAKE-SAL-06", name: "FAKE Salle 06 — Bâtiment B", roomType: "classroom" as const, capacity: 30, building: "FAKE-B", floorLabel: "RDC" },
    // SCHED-107 (this session's live discovery): the solver's room-fit rule
    // compares the class's NOMINAL capacity against the room's capacity — a
    // lab seating 24 rejects every class of 28+. Labs sized for a full class.
    { code: "FAKE-LAB-SCI", name: "FAKE Laboratoire de sciences", roomType: "science_lab" as const, capacity: 32, building: "FAKE-B", floorLabel: "1er" },
    { code: "FAKE-LAB-INFO", name: "FAKE Salle informatique", roomType: "computer_lab" as const, capacity: 32, building: "FAKE-B", floorLabel: "1er" },
    { code: "FAKE-GYM", name: "FAKE Salle de sport", roomType: "sports" as const, capacity: 40, building: "FAKE-C", floorLabel: null },
  ] as const;

  const FAKE_NOTE = "DONNÉE FAKE — test T-408 (purge: scripts/t-408-fake-data-purge.py)";

  // --------------------------------------------------------------------------
  // PRE-FLIGHT — refuse to run on top of a previous (possibly partial) FAKE
  // dataset: the seed is NOT idempotent (rooms have UNIQUE (tenant, code),
  // class_subjects have no unique key). Run the purge script first.
  // --------------------------------------------------------------------------
  console.log("\n-- PRE-FLIGHT: FAKE-residue guard --");
  const residue = await client
    .from("rooms")
    .select("id", { count: "exact", head: true })
    .ilike("code", "FAKE%");
  const residueClasses = await client
    .from("classes")
    .select("id", { count: "exact", head: true })
    .ilike("code", "%FAKE%");
  const residuePeople = await client
    .from("personnel")
    .select("id", { count: "exact", head: true })
    .ilike("first_name", "%FAKE%");
  const residueRooms = residue.count ?? 0;
  const residueCls = residueClasses.count ?? 0;
  const residuePpl = residuePeople.count ?? 0;
  if (residueRooms > 0 || residueCls > 0 || residuePpl > 0) {
    check(
      "pre-flight: no prior FAKE residue",
      false,
      `rooms=${residueRooms} classes=${residueCls} personnel=${residuePpl} — run scripts/t-408-fake-data-purge.py --execute first, then re-run`,
    );
    process.exit(1);
  }
  check("pre-flight: no prior FAKE residue", true, "clean");

  // --------------------------------------------------------------------------
  // PHASE 1 — SEED
  // --------------------------------------------------------------------------
  console.log("\n-- PHASE 1: seed (canonical repositories, FAKE-marked) --");

  // 1a. Personnel (future teachers — created as NON-teaching so that 1b's
  // createTeacher exercises the CANONICAL flip (staff_category →
  // 'teaching'), the exact SCHED-105 path the owner's « Ajouter un
  // enseignant » runs. Creating them already-'teaching' would take the
  // no-op branch and prove nothing.)
  const personnelIds: Record<string, string> = {};
  for (const t of FAKE_TEACHERS) {
    const res = await withRetry(() => personnelRepo.createPersonnel({
      userId: null,
      firstName: t.first,
      lastName: t.last,
      staffCategory: "support",
      roleId: "teacher",
      departmentId: null,
      supervisorId: null,
      position: t.position,
      phone: `+213550000${t.key.replace("T", "")}`,
      email: `fake.${t.key.toLowerCase()}@elimtiyaz-test.dz`,
      address: null,
      hireDate: "2026-09-01",
      terminationDate: null,
      salary: 45000,
      paymentMethod: null,
      bankAccount: null,
      weeklyHoursTarget: 20,
      avatarUrl: null,
      status: "active",
      documents: [],
      notes: [],
      emergencyContact: {
        name: "FAKE Contact urgence",
        phone: "+213 55 000 0000",
        relation: "FAKE",
      },
      dateOfBirth: null,
      nationalId: null,
    }));
    check(
      `1a personnel ${t.key} (${t.first} ${t.last})`,
      res.ok,
      res.ok ? res.value.personnelCode ?? res.value.id : res.error.userMessage,
    );
    if (!res.ok) process.exit(1);
    personnelIds[t.key] = res.value.id;
    await pace();
  }

  // 1b. Teacher registration (the canonical personnel → teaching flip)
  const yearRes = await yearRepo.getCurrentYear();
  check("1b current academic year resolves", yearRes.ok, yearRes.ok ? yearRes.value.code : yearRes.error.userMessage);
  if (!yearRes.ok) process.exit(1);
  const year = yearRes.value;

  for (const t of FAKE_TEACHERS) {
    const res = await withRetry(() => teacherRepo.createTeacher(
      {
        personnelId: personnelIds[t.key],
        code: `ENS-FAKE-${t.key}`,
        academicYearId: year.id,
        academicYearCode: year.code,
      },
      actor.actorId,
      actor.actorName,
    ));
    check(
      `1b teacher ${t.key} registered (staff_category flip)`,
      res.ok,
      res.ok ? `${res.value.firstName} ${res.value.lastName} (${res.value.code})` : res.error.userMessage,
    );
    if (!res.ok) process.exit(1);
    await pace();
  }

  // 1b-probe — the registry observable must reflect the flips IMMEDIATELY
  // (the Enseignants tab reads this same subject; an empty registry after
  // registration would be a production-stale-data defect — 3b's zero-row
  // readings in earlier runs are what this probe isolates).
  await new Promise((r) => setTimeout(r, 2500));
  const regAfterSeed = (teacherRepo.observe() as unknown as { get(): unknown }).get();
  const regAfterSeedCount = Array.isArray(regAfterSeed) ? regAfterSeed.length : -1;
  check(
    "1b registry reflects the 8 flips immediately (in-memory)",
    regAfterSeedCount === 8,
    `cached=${regAfterSeedCount}`,
  );

  // 1c. FAKE subjects
  const subjectIds: Record<string, string> = {};
  for (const s of FAKE_SUBJECTS) {
    const res = await withRetry(() => subjectRepo.createSubject({
      code: s.code,
      name: s.name,
      nameAr: s.nameAr,
      cycle: null,
      level: "cem",
      coefficient: 1,
      passingGrade: 10,
      isExtracurricular: false,
      isActive: true,
      teacherId: null,
    }));
    check(`1c subject ${s.code} (${s.name})`, res.ok, res.ok ? res.value.id : res.error.userMessage);
    if (!res.ok) process.exit(1);
    subjectIds[s.code] = res.value.id;
    await pace();
  }

  // Real catalog subjects (the 0114 migration's 14 identity rows) + the 2
  // FAKE subjects created just above.
  const { data: catalogRows } = await client
    .from("subjects")
    .select("id, code")
    .order("code");
  for (const row of catalogRows ?? []) {
    subjectIds[row.code] = row.id;
  }
  const EXPECTED_CATALOG = [
    "ANGLAIS", "ARABE", "EDU_ARTISTIQUE", "EDU_ISLAM", "EPS", "EVEIL_SCI",
    "FRANCAIS", "HIST_GEO", "INFORMATIQUE", "MATHS", "PHILO", "PHYSIQUE",
    "SVT", "TAMAZIGHT",
  ];
  const missingCatalog = EXPECTED_CATALOG.filter((c) => !subjectIds[c]);
  check(
    "1c catalog subjects loaded (14 identity + 2 FAKE)",
    (catalogRows ?? []).length === 16 && missingCatalog.length === 0,
    `${(catalogRows ?? []).length} rows, missing=[${missingCatalog.join(",")}]`,
  );

  // 1d. FAKE classes — REAL level uuids (ACAD-506) + the REAL current year
  const classIds: Record<string, string> = {};
  for (const c of FAKE_CLASSES) {
    const levelRes = await levelRepo.getByGradeCode(c.grade);
    if (!levelRes.ok || !levelRes.value) {
      check(`1d level ${c.grade} resolves`, false, "academic_levels lookup failed");
      process.exit(1);
    }
    const derivedLevel = c.grade.startsWith("prescolaire") || c.grade.endsWith("ap")
      ? "primaire"
      : c.grade.endsWith("am")
        ? "cem"
        : "lycee";
    const res = await withRetry(() => classRepo.createClass({
      academicYearId: year.id,
      academicLevelId: levelRes.value.id,
      code: c.code,
      name: c.name,
      gradeCode: c.grade,
      level: derivedLevel,
      gradeYear: levelRes.value.yearNumber,
      section: c.section,
      filiereCode: null,
      specialiteCode: null,
      room: "Bâtiment FAKE",
      capacity: c.capacity,
      homeroomTeacherId: personnelIds[c.homeroom],
      homeroomTeacherName: `${FAKE_TEACHERS.find((t) => t.key === c.homeroom)!.first} ${FAKE_TEACHERS.find((t) => t.key === c.homeroom)!.last}`,
      notes: FAKE_NOTE,
      academicYear: year.code,
    }));
    check(
      `1d class ${c.code} (${c.name})`,
      res.ok,
      res.ok ? `${res.value.id} / homeroom=${res.value.homeroomTeacherName}` : res.error.userMessage,
    );
    if (!res.ok) process.exit(1);
    classIds[c.key] = res.value.id;
    await pace();
  }

  // 1e. class_subjects — the curriculum with weekly hours + teachers
  const teacherNames: Record<string, string> = {};
  for (const t of FAKE_TEACHERS) {
    teacherNames[t.key] = `${t.first} ${t.last}`;
  }
  let assignmentCount = 0;
  let totalWeeklyHours = 0;
  for (const c of FAKE_CLASSES) {
    for (const [subjectCode, teacherKey, hours, coef, roomType, consecutive] of CURRICULUM[c.key]) {
      const res = await withRetry(() => subjectRepo.assignSubjectToClass({
        classId: classIds[c.key],
        subjectId: subjectIds[subjectCode],
        teacherId: personnelIds[teacherKey],
        teacherName: teacherNames[teacherKey],
        weeklyHours: hours,
        coefficient: coef,
        consecutivePeriods: consecutive ?? 1,
        requiredRoomType: roomType,
      }));
      if (!res.ok) {
        check(`1e assignment ${c.code}×${subjectCode}`, false, res.error.userMessage);
        process.exit(1);
      }
      assignmentCount += 1;
      totalWeeklyHours += hours;
      await pace();
    }
  }
  check(
    `1e class_subjects assigned (${assignmentCount} rows, ${totalWeeklyHours} weekly hours)`,
    assignmentCount === 52,
    `count=${assignmentCount} hours=${totalWeeklyHours}`,
  );

  // 1f. FAKE rooms
  for (const r of FAKE_ROOMS) {
    const res = await withRetry(() => timetableRepo.createRoom(
      {
        code: r.code,
        name: r.name,
        roomType: r.roomType,
        capacity: r.capacity,
        building: r.building,
        floorLabel: r.floorLabel,
        notes: FAKE_NOTE,
      },
      actor,
    ));
    check(`1f room ${r.code} (${r.roomType})`, res.ok, res.ok ? res.value.id : res.error.userMessage);
    if (!res.ok) process.exit(1);
    await pace();
  }

  // 1g. FAKE constraints — every params payload carries {"_fake": true} so
  // the purge script can find them (constraints have no name column).
  const c1 = await withRetry(() => timetableRepo.createConstraint(
    {
      academicYearId: year.id,
      scope: "school",
      entityId: null,
      kind: "minimize_gaps",
      severity: "soft",
      params: { _fake: true },
    },
    actor,
  ));
  check("1g constraint school/minimize_gaps (soft)", c1.ok, c1.ok ? c1.value.id : c1.error.userMessage);

  const c2 = await withRetry(() => timetableRepo.createConstraint(
    {
      academicYearId: year.id,
      scope: "class",
      entityId: classIds["C5"],
      kind: "prefer_morning",
      severity: "soft",
      params: { _fake: true },
    },
    actor,
  ));
  check("1g constraint class C5/prefer_morning (soft)", c2.ok, c2.ok ? c2.value.id : c2.error.userMessage);

  const c3 = await withRetry(() => timetableRepo.createConstraint(
    {
      academicYearId: year.id,
      scope: "teacher",
      entityId: personnelIds["T7"],
      kind: "unavailable_period",
      severity: "hard",
      params: { _fake: true, day: "wednesday", periodIndex: 6 },
    },
    actor,
  ));
  check("1g constraint teacher T7/unavailable_period (hard)", c3.ok, c3.ok ? c3.value.id : c3.error.userMessage);
  if (!c1.ok || !c2.ok || !c3.ok) process.exit(1);

  // --------------------------------------------------------------------------
  // PHASE 2 — TIMETABLE E2E
  // --------------------------------------------------------------------------
  console.log("\n-- PHASE 2: timetable generation → review → approve → publish --");

  // 2a. the seeded Algerian configuration is active for the year
  const { data: cfg } = await client
    .from("timetable_configurations")
    .select("label, school_days, is_active")
    .eq("academic_year_id", year.id)
    .eq("is_active", true)
    .maybeSingle();
  check(
    "2a Algerian configuration active (Sun–Thu, 6 periods)",
    !!cfg &&
      (cfg.school_days ?? []).length === 5 &&
      (cfg.school_days ?? []).includes("sunday") &&
      (cfg.school_days ?? []).includes("thursday"),
    cfg?.label ?? "none",
  );

  // 2b. generation (the canonical ts-greedy-v1 solver, the same one the
  // packaged .exe runs)
  const gen = await timetableRepo.generateTimetable(
    { academicYearId: year.id, solverId: GREEDY_SOLVER_ID, label: "FAKE Essai généré (T-408 E2E)" },
    actor,
  );
  check("2b generateTimetable ok", gen.ok, gen.ok ? `version ${gen.value.versionNumber}` : gen.error.userMessage);
  if (!gen.ok) process.exit(1);
  const version = gen.value;
  check(
    "2b solver stats: 0 unplaced / 0 hard violations",
    version.unplacedCount === 0 && version.hardViolationCount === 0,
    `unplaced=${version.unplacedCount} hard=${version.hardViolationCount} soft=${version.softViolationCount}`,
  );
  check(
    "2b status draft + FAKE label + solver build stamped",
    version.status === "draft" &&
      version.label.includes("FAKE") &&
      version.solverId === GREEDY_SOLVER_ID &&
      !!version.solverBuild,
    `${version.status} / ${version.solverId} ${version.solverBuild}`,
  );

  // 2c. entries == the curriculum's total weekly hours; no double-booking
  const entriesRead = await retriedRead(() =>
    client
      .from("timetable_entries")
      .select("class_id, subject_id, teacher_id, room_id, day, period_index, lesson_group")
      .eq("version_id", version.id),
  );
  check("2c entries readable", !entriesRead.error, entriesRead.error?.message ?? "");
  const entryRows = entriesRead.data ?? [];
  check(
    "2c every curriculum period placed",
    entryRows.length === totalWeeklyHours,
    `entries=${entryRows.length} expected=${totalWeeklyHours}`,
  );

  const teacherConflicts = entryRows.filter(
    (e: { teacher_id: string | null }) => e.teacher_id,
  ).reduce<Record<string, number>>((acc, e) => {
    const k = `${e.teacher_id}|${e.day}|${e.period_index}`;
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});
  check(
    "2c zero teacher double-bookings",
    Object.values(teacherConflicts).every((n) => n === 1),
    `${Object.entries(teacherConflicts).filter(([, n]) => n > 1).length} conflicts`,
  );

  const roomConflicts = entryRows.filter(
    (e: { room_id: string | null }) => e.room_id,
  ).reduce<Record<string, number>>((acc, e) => {
    const k = `${e.room_id}|${e.day}|${e.period_index}`;
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});
  check(
    "2c zero room double-bookings",
    Object.values(roomConflicts).every((n) => n === 1),
    `${Object.entries(roomConflicts).filter(([, n]) => n > 1).length} conflicts`,
  );

  const classConflicts = entryRows.reduce<Record<string, number>>((acc, e) => {
    const k = `${e.class_id}|${e.day}|${e.period_index}`;
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});
  check(
    "2c zero class double-bookings",
    Object.values(classConflicts).every((n) => n === 1),
    `${Object.entries(classConflicts).filter(([, n]) => n > 1).length} conflicts`,
  );

  // The hard teacher-unavailability constraint is honored (T7 never on
  // Wednesday period 6)
  const t7Violations = entryRows.filter(
    (e: { teacher_id: string | null; day: string; period_index: number }) =>
      e.teacher_id === personnelIds["T7"] && e.day === "wednesday" && e.period_index === 6,
  );
  check("2c hard constraint honored (T7 off Wed S6)", t7Violations.length === 0, `${t7Violations.length} violations`);

  // Room-type requirements honored
  const roomTypeRead = await retriedRead(() =>
    client.from("rooms").select("id, code, room_type"),
  );
  const roomTypeById = new Map((roomTypeRead.data ?? []).map((r: { id: string; room_type: string }) => [r.id, r.room_type]));
  const reqRowsRead = await retriedRead(() =>
    client
      .from("class_subjects")
      .select("class_id, subject_id, required_room_type")
      .eq("is_active", true),
  );
  const requiredType = new Map(
    (reqRowsRead.data ?? []).map(
      (r: { class_id: string; subject_id: string; required_room_type: string | null }) =>
        [`${r.class_id}|${r.subject_id}`, r.required_room_type] as const,
    ),
  );
  const roomTypeViolations = entryRows.filter((e: { class_id: string; subject_id: string; room_id: string | null }) => {
    const need = requiredType.get(`${e.class_id}|${e.subject_id}`);
    if (!need) return false;
    const got = e.room_id ? roomTypeById.get(e.room_id) : null;
    return got !== need;
  });
  check(
    "2c required room types honored (lab/info/sports)",
    roomTypeViolations.length === 0,
    `${roomTypeViolations.length} violations`,
  );

  // 2d. submit for review
  const submitted = await withRetry(() => timetableRepo.submitForReview(
    version.id,
    actor,
    "FAKE — soumis par le harnais E2E T-408",
  ));
  check("2d submitForReview → in_review", submitted.ok && submitted.value.status === "in_review", submitted.ok ? submitted.value.status : submitted.error.userMessage);
  if (!submitted.ok) process.exit(1);

  // 2e. approve
  const approved = await withRetry(() => timetableRepo.approveVersion(
    version.id,
    actor,
    "FAKE — approuvé par le harnais E2E T-408",
  ));
  check("2e approveVersion → approved", approved.ok && approved.value.status === "approved", approved.ok ? approved.value.status : approved.error.userMessage);
  if (!approved.ok) process.exit(1);

  // 2f. publish (the canonical fn_timetable_publish RPC)
  const published = await withRetry(() => timetableRepo.publishVersion(version.id, actor));
  check(
    "2f publishVersion → published (fn_timetable_publish)",
    published.ok && published.value.status === "published" && !!published.value.publishedAt,
    published.ok ? `${published.value.status} @ ${published.value.publishedAt}` : published.error.userMessage,
  );
  if (!published.ok) process.exit(1);

  // 2g. the portal view: authenticated sees rows, anon is rejected
  const { data: portalRows, error: portalErr } = await client
    .from("v_timetable_published")
    .select("class_id, subject_id, day, period_index")
    .eq("academic_year_id", year.id);
  check(
    "2g v_timetable_published (admin JWT) carries the full schedule",
    !portalErr && (portalRows ?? []).length === totalWeeklyHours,
    portalErr?.message ?? `${(portalRows ?? []).length} rows`,
  );

  const anonClient = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const anonView = await anonClient.from("v_timetable_published").select("class_id").limit(1);
  check(
    "2g v_timetable_published (anon) rejected",
    anonView.error !== null,
    anonView.error?.message.slice(0, 60) ?? "no error",
  );

  // --------------------------------------------------------------------------
  // PHASE 3 — INTERACTIONS with the rest of the academic system
  // --------------------------------------------------------------------------
  console.log("\n-- PHASE 3: academic-system interactions --");

  // 3a. the Matières-Classes tab data round-trips per class
  for (const c of FAKE_CLASSES) {
    const sub = subjectRepo.observeByClass(classIds[c.key]);
    let observed: unknown = null;
    const unsub = sub.subscribe((rows: unknown) => {
      observed = rows;
    });
    await new Promise((r) => setTimeout(r, 2500));
    unsub();
    const count = Array.isArray(observed) ? observed.length : 0;
    check(
      `3a observeByClass ${c.code} → ${CURRICULUM[c.key].length} matières`,
      count === CURRICULUM[c.key].length,
      `observed=${count}`,
    );
  }

  // 3b. the teacher registry lists the 8 FAKE teachers as active teaching
  // staff (the Enseignants tab's data source)
  const teacherSub = teacherRepo.observe();
  let teacherList: unknown = null;
  const unsubT = teacherSub.subscribe((rows: unknown) => {
    teacherList = rows;
  });
  await new Promise((r) => setTimeout(r, 3500));
  unsubT();
  const teachers = Array.isArray(teacherList)
    ? (teacherList as Array<{ personnelId: string; code: string; firstName: string; lastName: string; status: string }>)
    : [];
  // Teacher.code is the personnel_code (PER-…) — the FAKE marker lives in the
  // names (the ENS-FAKE registration code only rides the audit trail).
  const fakeTeachers = teachers.filter(
    (t) => (t.firstName ?? "").includes("FAKE") && (t.lastName ?? "").includes("FAKE"),
  );
  const allActive = fakeTeachers.every((t) => t.status === "active");
  check(
    "3b teacher registry lists the 8 FAKE teachers (active)",
    fakeTeachers.length === 8 && allActive,
    `${fakeTeachers.length}/8 active=${allActive} (total registry ${teachers.length})`,
  );
  // Cross-evidence: the DB truth (distinguishes an observable-refresh defect
  // from a persistence defect when the two disagree).
  const teachingRead = await retriedRead(() =>
    client
      .from("personnel")
      .select("first_name, last_name, staff_category, is_active")
      .eq("staff_category", "teaching")
      .is("deleted_at", null),
  );
  const dbFakeTeachers = (teachingRead.data ?? []).filter(
    (r: { first_name: string; last_name: string }) =>
      (r.first_name ?? "").includes("FAKE") && (r.last_name ?? "").includes("FAKE"),
  );
  check(
    "3b DB truth: 8 FAKE personnel rows are teaching + active",
    dbFakeTeachers.length === 8,
    `db=${dbFakeTeachers.length} (observable=${fakeTeachers.length})`,
  );

  // 3c. homeroom-teacher FK (0112) round-trips on the class read-back
  const classRead = await retriedRead(() =>
    client
      .from("classes")
      .select("code, homeroom_teacher_id, homeroom_teacher_name, capacity")
      .in("code", FAKE_CLASSES.map((c) => c.code)),
  );
  const classReadBack = classRead.data ?? [];
  check("3c class read-back fetched", !classRead.error, classRead.error?.message ?? "");
  const homeroomOk = (classReadBack ?? []).every(
    (r: { homeroom_teacher_id: string | null; homeroom_teacher_name: string | null }) =>
      r.homeroom_teacher_id !== null && (r.homeroom_teacher_name ?? "").includes("FAKE"),
  );
  check(
    "3c homeroom_teacher FK round-trips on all 5 FAKE classes",
    (classReadBack ?? []).length === 5 && homeroomOk,
    `${(classReadBack ?? []).length} rows`,
  );

  // 3d. manual-adjustment survival (T-404's pinned-entry contract):
  //     duplicate → move (live-validated) → lock → regenerate → pin survives
  const copy = await withRetry(() => timetableRepo.duplicateVersionToDraft(
    version.id,
    actor,
    "FAKE Copie manuelle (T-408 E2E)",
  ));
  check("3d duplicateVersionToDraft ok", copy.ok, copy.ok ? `version ${copy.value.versionNumber} draft` : copy.error.userMessage);
  if (!copy.ok) process.exit(1);

  const copyRead = await retriedRead(() =>
    client
      .from("timetable_entries")
      .select("id, class_id, subject_id, teacher_id, room_id, day, period_index")
      .eq("version_id", copy.value.id)
      .order("id"),
  );
  const copyEntries = copyRead.data ?? [];
  if (!copyEntries || copyEntries.length === 0) {
    check("3d draft copy has entries", false, "no entries found");
    process.exit(1);
  }
  // Pick a move that lands on a slot FREE for the entry's class, teacher AND
  // room — the live validator (validateTimetableMove) checks all three
  // conflict dimensions over the WHOLE candidate schedule. Iterate entries
  // until one HAS a legal destination (a dense class may have none).
  const SCHOOL_DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday"] as const;
  const PERIODS = [1, 2, 3, 4, 5, 6];
  type CopyEntry = { id: string; class_id: string; teacher_id: string | null; room_id: string | null; day: string; period_index: number };
  const busyFor = (key: "class_id" | "teacher_id" | "room_id"): Set<string> =>
    new Set(
      (copyEntries as CopyEntry[])
        .filter((e) => e[key])
        .map((e) => `${e[key]}|${e.day}|${e.period_index}`),
    );
  const busyClass = busyFor("class_id");
  const busyTeacher = busyFor("teacher_id");
  const busyRoom = busyFor("room_id");
  let target: CopyEntry | null = null;
  let moveTo: { day: string; periodIndex: number } | null = null;
  for (const e of copyEntries as CopyEntry[]) {
    for (const d of SCHOOL_DAYS) {
      for (const p of PERIODS) {
        const classFree = !busyClass.has(`${e.class_id}|${d}|${p}`);
        const teacherFree = !e.teacher_id || !busyTeacher.has(`${e.teacher_id}|${d}|${p}`);
        const roomFree = !e.room_id || !busyRoom.has(`${e.room_id}|${d}|${p}`);
        if (classFree && teacherFree && roomFree) {
          target = e;
          moveTo = { day: d, periodIndex: p };
          break;
        }
      }
      if (moveTo) break;
    }
    if (moveTo) break;
  }
  if (!target || !moveTo) {
    check("3d free destination slot found", false, "no movable entry with a free destination");
    process.exit(1);
  }
  const moved = await withRetry(() => timetableRepo.moveEntry(
    target.id,
    { day: moveTo.day, periodIndex: moveTo.periodIndex },
    actor,
  ));
  check(
    `3d moveEntry (live-validated) ${target.day} S${target.period_index} → ${moveTo.day} S${moveTo.periodIndex}`,
    moved.ok,
    moved.ok ? `${moved.value.day} S${moved.value.periodIndex}` : moved.error.userMessage,
  );
  if (!moved.ok) process.exit(1);

  const locked = await withRetry(() => timetableRepo.setEntryLocked(target.id, true, actor));
  check("3d setEntryLocked(true)", locked.ok && locked.value.isLocked, locked.ok ? "locked" : locked.error.userMessage);

  const regen = await withRetry(() => timetableRepo.generateTimetable(
    {
      academicYearId: year.id,
      solverId: GREEDY_SOLVER_ID,
      fromVersionId: copy.value.id,
      label: "FAKE Essai régénéré (T-408 E2E)",
    },
    actor,
  ));
  check("3d regenerate fromVersionId ok", regen.ok, regen.ok ? `version ${regen.value.versionNumber}` : regen.error.userMessage);
  if (!regen.ok) process.exit(1);
  const regenPinsRead = await retriedRead(() =>
    client
      .from("timetable_entries")
      .select("id, class_id, day, period_index, is_locked, source")
      .eq("version_id", regen.value.id)
      .eq("is_locked", true),
  );
  const regenPins = regenPinsRead.data ?? [];
  const pinSurvived =
    (regenPins ?? []).some(
      (e: { class_id: string; day: string; period_index: number }) =>
        e.class_id === target!.class_id &&
        e.day === moveTo!.day &&
        e.period_index === moveTo!.periodIndex,
    );
  check(
    "3d locked pin survives regeneration",
    pinSurvived,
    `${(regenPins ?? []).length} locked entr${(regenPins ?? []).length === 1 ? "y" : "ies"} in v${regen.value.versionNumber}`,
  );
  check(
    "3d regeneration still fully placeable",
    regen.value.unplacedCount === 0 && regen.value.hardViolationCount === 0,
    `unplaced=${regen.value.unplacedCount} hard=${regen.value.hardViolationCount}`,
  );

  // --------------------------------------------------------------------------
  // Final census — what the owner will see in the UI (and what the purge
  // script will remove later)
  // --------------------------------------------------------------------------
  console.log("\n-- FINAL CENSUS (live, FAKE-marked rows) --");
  const counts: Array<[string, number]> = [];
  const jwt = (await client.auth.getSession()).data.session?.access_token ?? "";
  const tables: Array<[string, string]> = [
    ["personnel (FAKE, active)", `personnel?first_name=ilike.*FAKE*&is_active=eq.true`],
    ["classes (FAKE)", `classes?code=ilike.*FAKE*`],
    ["subjects (FAKE)", `subjects?code=ilike.FAKE*`],
    ["class_subjects (on FAKE classes)", `class_subjects?class_id=in.(${Object.values(classIds).join(",")})`],
    ["rooms (FAKE)", `rooms?code=ilike.FAKE*`],
    ["timetable_versions (FAKE labels)", `timetable_versions?label=ilike.*FAKE*`],
    ["timetable_entries (published+drafts)", `timetable_entries?version_id=in.(${[version.id, copy.value.id, regen.value.id].join(",")})`],
    ["timetable_constraints (_fake tag)", `timetable_constraints?params->>_fake=eq.true`],
  ];
  for (const [label, path] of tables) {
    const head = await fetch(`${SUPABASE_URL}/rest/v1/${path}&select=id`, {
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${jwt}`,
        Prefer: "count=exact",
        "Range-Unit": "items",
        Range: "0-0",
      },
    });
    const range = head.headers.get("content-range") ?? "*/?";
    const n = Number(range.split("/")[1]);
    // PostgREST answers 206 (Partial Content) for a Range-limited count
    // request and 200 for an empty result — both are success here.
    check(`census ${label}`, (head.status === 200 || head.status === 206) && !Number.isNaN(n), `${n} rows (HTTP ${head.status})`);
    counts.push([label, n]);
  }

  // --------------------------------------------------------------------------
  // Summary
  // --------------------------------------------------------------------------
  const red = results.filter((r) => !r.ok);
  console.log("\n== SUMMARY ==");
  console.log(`  ${results.length - red.length}/${results.length} GREEN, ${red.length} RED`);
  console.log(
    `\n  FAKE dataset live (for the owner's UI testing): 8 teachers, 2 FAKE subjects,\n  5 classes, ${assignmentCount} class_subjects (${totalWeeklyHours} weekly hours), 9 rooms,\n  3 constraints, published timetable v${version.versionNumber} + 2 FAKE drafts.`,
  );
  console.log("  Purge when done testing: python3 scripts/t-408-fake-data-purge.py --dry-run");
  if (red.length > 0) {
    console.error("\nRED checks:");
    for (const r of red) console.error(`  - ${r.label}: ${r.detail}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
