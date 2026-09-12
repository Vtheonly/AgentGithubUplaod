// ============================================================================
// FILE: elimtiyaz-desktop/src/core/ai/tools/system-tools.ts
// ============================================================================
/**
 * CORE domain tools for the Agentic Copilot (T-260, 39th session;
 * DEEPENED T-267, 41st session; RESTRUCTURED T-272, 42nd session — the
 * registry split: this file now owns the CORE suite only; the analysis /
 * visualization / document / workflow suites live in their own modules
 * and are composed by tool-registry.ts, the single on-the-wire source).
 *
 * Instead of shallow chatbot answers, the agent is granted direct READ
 * access to real data through the Repositories and the EXACT mathematical
 * engines in `src/domain/calc/` (`computeParentSummary`,
 * `evaluateStudentTermPerformance`, `calculateAttendanceRate`) — the same
 * reference implementations the UI uses, so AI-quoted balances, GPAs and
 * attendance rates can never diverge from the ledgers on screen
 * (AGENTS.md §15.16: never synthesize financial data client-side when
 * REAL rows exist).
 *
 * T-267 (the owner's "production-quality integration, not a shallow demo"
 * mandate) closed the capability gaps the 39th-session set left open —
 * the copilot can now answer the school's REAL operational questions:
 *
 *   DEBT COLLECTION (the #1 business concern — VAULT §07.06):
 *     - get_overdue_accounts   → the debtor list with aging buckets,
 *                                phones and totals (who to chase, now)
 *     - get_collection_analytics → aging composition + collection rate
 *     - propose_payment_reminder → a REAL actionable task: dispatch the
 *       canonical debt reminder (repos.debt.sendReminder — notification +
 *       audit entry) after human validation. Closes AI-308 residual (b).
 *
 *   ACADEMICS (VAULT §08):
 *     - get_student_attendance → absence/late patterns + the canonical
 *                                attendance rate + justification status
 *     - get_class_performance  → class GPA distribution, top/bottom
 *                                performers, at-risk students
 *
 *   FINANCIAL DETAIL:
 *     - get_payment_history    → a parent's full payment trail (receipts,
 *                                methods, statuses) for dispute resolution
 *
 * Mutation policy (§15.5/§15.8): proposal tools do NOT write — they emit
 * an `ActionProposal` for 1-click human validation. The write itself goes
 * through the canonical repository methods in the Copilot provider's
 * `approveAction` (payments.adjust for account_adjustment,
 * debt.sendReminder for send_reminder). Proposal arguments are VALIDATED
 * (existing parent, non-zero bounded amount, substantive reason) BEFORE
 * a proposal is surfaced — a malformed proposal returns a structured
 * error the model must answer for, never a silent console.warn (the
 * 6ce49b9 patch's fake guardrail — see REG-005).
 */
import type { Repositories } from "../../../app/providers/repository-provider";
import type { ToolDefinition, ActionProposal } from "../agent-types";
import { computeParentSummary } from "../../../domain/calc/ledger/balance";
import { evaluateStudentTermPerformance } from "../../../domain/calc/academics/gpa";
import { currentTermWindow } from "../../../domain/calc/academics/terms";
import { calculateAttendanceRate } from "../../../domain/model/academic";
import { AGING_BUCKET_LABELS_FR, PAYMENT_METHOD_LABELS_FR, PAYMENT_STATUS_LABELS_FR } from "../../../domain/model/payment";
// Canonical name renderers (DATA-005/T-134): NEVER compose first+last by
// hand — the live corpus carries displayName-only rows.
import { parentDisplayName } from "../../../domain/model/parent";
import { studentDisplayName } from "../../../domain/model/student";

/* ------------------------------------------------------------------ */
/*  Proposal argument validation (the REAL guardrail, T-267)           */
/* ------------------------------------------------------------------ */

/**
 * Sanity ceiling for a single manual account adjustment.
 * CALC-001 (2026-09-12): the REAL full-year sticker (FI + scolarité +
 * transport) tops out around ~430 000 DZD for a single student (3EM
 * 30 000 + 365 000 + 65 000); 5 000 000 DZD stays a generous ceiling
 * that still catches gross model errors (e.g. a stray ×10).
 */
const ADJUSTMENT_AMOUNT_CEILING_DZD = 5_000_000;

type AdjustmentValidation =
  | { ok: true; parentId: string; amount: number; reason: string; parentName: string }
  | { ok: false; error: string; hint?: string };

/**
 * Enforce the propose_account_adjustment contract BEFORE a proposal card
 * is ever surfaced:
 *   - parent_id must resolve to a REAL parent (actionable error otherwise)
 *   - amount must be a finite, non-zero number within the sanity ceiling
 *   - reason must be substantive (≥ 3 chars — mirrors the refund-payment
 *     Edge Function contract)
 *
 * Returns a structured error the MODEL receives as the tool result — it
 * must correct its arguments or ask the user; the proposal is never
 * created from invalid input.
 */
function validateAdjustmentArgs(
  args: Record<string, unknown>,
  repos: Repositories,
): AdjustmentValidation {
  const parentId = typeof args.parent_id === "string" ? args.parent_id.trim() : "";
  if (!parentId) {
    return {
      ok: false,
      error: "Paramètre manquant : parent_id (UUID) est obligatoire.",
      hint: "Utilisez search_entities pour identifier le parent, puis rappelez propose_account_adjustment.",
    };
  }
  const parent = repos.parents.observeById(parentId).get();
  if (!parent) {
    return {
      ok: false,
      error: `Aucun parent avec l'identifiant « ${parentId} ». La proposition est refusée.`,
      hint: "Recherchez le parent avec search_entities pour obtenir son UUID exact.",
    };
  }
  const amount = Number(args.amount);
  if (!Number.isFinite(amount) || amount === 0) {
    return {
      ok: false,
      error: "Montant invalide : un ajustement doit être un nombre non nul (négatif = remise, positif = débit).",
    };
  }
  if (Math.abs(amount) > ADJUSTMENT_AMOUNT_CEILING_DZD) {
    return {
      ok: false,
      error: `Montant hors limites : |${amount}| DZD dépasse le plafond de ${ADJUSTMENT_AMOUNT_CEILING_DZD.toLocaleString("fr-FR")} DZD pour un ajustement manuel.`,
      hint: "Vérifiez l'ordre de grandeur — une scolarité annuelle complète (FI + scolarité + transport) est d'environ 125 000 à 430 000 DZD selon le niveau (matrice réelle 2026/2027).",
    };
  }
  const reason = typeof args.reason === "string" ? args.reason.trim() : "";
  if (reason.length < 3) {
    return {
      ok: false,
      error: "Motif invalide : un motif formel d'au moins 3 caractères est obligatoire (traçabilité d'audit).",
    };
  }
  return { ok: true, parentId, amount, reason, parentName: parentDisplayName(parent) };
}

/* ------------------------------------------------------------------ */
/*  Tool schemas (OpenAI function-calling format)                      */
/* ------------------------------------------------------------------ */

/**
 * Tool schemas sent to the provider (OpenAI function-calling format).
 * Descriptions are in professional French — they steer the model's tool
 * selection and are part of the product's UX.
 *
 * T-267: the registry grew from 6 to 12 tools. ALL of them are always on
 * the wire (T-266 removed slicing); list outputs are capped to keep the
 * tool-result payloads token-efficient.
 */
export const CORE_TOOLS_DEFINITIONS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "search_entities",
      description:
        "Rechercher des élèves, parents, ou classes par mot-clé, nom, code ou téléphone. TOUJOURS l'étape préliminaire avant une question sur une entité précise.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Le terme de recherche (ex: Nom de famille, prénom, code élève)",
          },
          entity_type: {
            type: "string",
            description: "Optionnel: filtrer par type d'entité",
            enum: ["all", "student", "parent", "class"],
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_financial_ledger_summary",
      description:
        "Obtenir la situation financière vérifiée d'un parent : solde dû, total payé, tranches, créances et anomalies. Utilisé pour les questions de solde, d'impayés ou de régularisation.",
      parameters: {
        type: "object",
        properties: {
          parent_id: { type: "string", description: "L'identifiant unique (UUID) du parent." },
        },
        required: ["parent_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_overdue_accounts",
      description:
        "Lister les comptes en retard de paiement (débiteurs) triés par montant dû décroissant, avec ancienneté du retard, téléphone et nombre d'enfants. L'outil de recouvrement : « qui dois-je relancer aujourd'hui ? »",
      parameters: {
        type: "object",
        properties: {
          min_days_overdue: {
            type: "number",
            description: "Optionnel: seuil minimum de jours de retard (ex: 30, 60, 90). Défaut: 1 (tout retard).",
          },
          limit: {
            type: "number",
            description: "Optionnel: nombre max de débiteurs (défaut 10, max 25).",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_collection_analytics",
      description:
        "Vue analytique du recouvrement : répartition des créances par tranche d'ancienneté (0-30j, 31-60j, 61-90j, 91-180j, 180j+), taux de recouvrement global et KPIs financiers.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_payment_history",
      description:
        "Historique complet des paiements d'un parent : reçus, montants, méthodes (espèces/chèque/virement), statuts et dates. Utilisé pour résoudre une contestation ou retracer un règlement.",
      parameters: {
        type: "object",
        properties: {
          parent_id: { type: "string", description: "L'identifiant unique (UUID) du parent." },
        },
        required: ["parent_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_student_academic_profile",
      description:
        "Consulter le relevé de notes officiel, la moyenne générale pondérée, l'assiduité et le statut de promotion d'un élève.",
      parameters: {
        type: "object",
        properties: {
          student_id: { type: "string", description: "L'identifiant unique (UUID) de l'élève." },
        },
        required: ["student_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_student_attendance",
      description:
        "Détail d'assiduité d'un élève sur une période : taux de présence canonique, absences (excusées/non excusées), retards, et statut des justificatifs parentaux. Détecte le décrochage scolaire.",
      parameters: {
        type: "object",
        properties: {
          student_id: { type: "string", description: "L'identifiant unique (UUID) de l'élève." },
          days: {
            type: "number",
            description: "Optionnel: fenêtre en jours en arrière (défaut 30, max 365).",
          },
        },
        required: ["student_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_class_performance",
      description:
        "Performance comparative d'une classe : moyenne de classe, top et bas de classe, élèves à risque (moyenne < 10/20) et effectif évalué. Base des décisions pédagogiques.",
      parameters: {
        type: "object",
        properties: {
          class_id: { type: "string", description: "L'identifiant unique (UUID) de la classe." },
        },
        required: ["class_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_school_kpi_overview",
      description:
        "Obtenir les statistiques macro de l'école : effectifs, total des créances impayées, revenus et présence générale.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_account_adjustment",
      description:
        "Proposer une remise, régularisation ou pénalité financière pour un parent. Génère une carte de validation humaine — JAMAIS d'écriture directe. Le parent, le montant (plafonné) et le motif (≥ 3 caractères) sont validés avant création.",
      parameters: {
        type: "object",
        properties: {
          parent_id: { type: "string", description: "UUID du parent (doit exister)" },
          amount: { type: "number", description: "Montant en DZD (négatif pour remise/crédit, positif pour débit)" },
          reason: { type: "string", description: "Motif formel justifiant l'ajustement (min. 3 caractères)" },
        },
        required: ["parent_id", "amount", "reason"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_payment_reminder",
      description:
        "Proposer l'envoi d'un rappel de paiement officiel à un parent débiteur (notification + entrée d'audit — le canal canonique de relance). Nécessite une validation humaine avant l'envoi.",
      parameters: {
        type: "object",
        properties: {
          parent_id: { type: "string", description: "UUID du parent à relancer" },
          reason: {
            type: "string",
            description: "Optionnel: contexte de la relance inclus au résumé de validation",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "request_user_clarification",
      description:
        "À utiliser lorsque la demande de l'utilisateur est ambiguë ou manque d'informations requises (ex: nom partiel sans correspondance unique).",
      parameters: {
        type: "object",
        properties: {
          question: {
            type: "string",
            description: "La question claire posée à l'utilisateur pour débloquer l'analyse",
          },
          context_details: { type: "string", description: "Pourquoi cette information est nécessaire" },
        },
        required: ["question"],
      },
    },
  },
];

/* ------------------------------------------------------------------ */
/*  Tool execution                                                     */
/* ------------------------------------------------------------------ */

/**
 * Execute one tool call against the live repositories.
 * ALWAYS returns a JSON string (the wire format for `role: "tool"` messages)
 * — errors are returned as `{ "error": … }`, never thrown, so one bad tool
 * call can't kill the whole agent loop. List outputs are capped for token
 * efficiency.
 */
export async function executeCoreTool(
  name: string,
  args: Record<string, unknown>,
  repos: Repositories,
  onActionProposed?: (action: ActionProposal) => void,
): Promise<string> {
  try {
    switch (name) {
      case "search_entities": {
        const query = String(args.query || "");
        const entityType = String(args.entity_type || "all");
        const wantParents = entityType === "all" || entityType === "parent";
        const wantStudents = entityType === "all" || entityType === "student";
        const wantClasses = entityType === "all" || entityType === "class";

        const [parentsRes, studentsRes] = await Promise.all([
          wantParents ? repos.parents.search(query) : Promise.resolve({ ok: true, value: [] } as const),
          wantStudents ? repos.students.search(query) : Promise.resolve({ ok: true, value: [] } as const),
        ]);

        const parents = parentsRes.ok ? parentsRes.value.slice(0, 5) : [];
        const students = studentsRes.ok ? studentsRes.value.slice(0, 5) : [];
        const lowerQuery = query.toLowerCase();
        const classes = wantClasses
          ? repos.classes
              .observe()
              .get()
              .filter(
                (c) =>
                  c.name.toLowerCase().includes(lowerQuery) ||
                  c.code.toLowerCase().includes(lowerQuery),
              )
              .slice(0, 5)
          : [];

        return JSON.stringify({
          matched_parents: parents.map((p) => ({
            id: p.id,
            name: parentDisplayName(p),
            code: p.code,
            phone: p.phone,
          })),
          matched_students: students.map((s) => ({
            id: s.id,
            name: studentDisplayName(s),
            code: s.code,
            level: s.level,
            grade_level: s.gradeLevel,
            parent_id: s.parentId,
          })),
          matched_classes: classes.map((c) => ({
            id: c.id,
            name: c.name,
            code: c.code,
            level: c.level,
          })),
        });
      }

      case "get_financial_ledger_summary": {
        const parentId = String(args.parent_id ?? "");
        const parent = repos.parents.observeById(parentId).get();
        if (!parent) return JSON.stringify({ error: "Parent introuvable." });

        const entries = repos.ledger.observeByParent(parentId).get();
        const installments = repos.installments.observeByParent(parentId).get();
        const parentName = parentDisplayName(parent);

        // Canonical engine — the SAME computation the financial UI uses.
        const summary = computeParentSummary(entries, parentId, parentName);
        return JSON.stringify({
          parent_name: parentName,
          parent_code: parent.code,
          phone: parent.phone,
          total_outstanding_balance: summary.totalOutstanding,
          total_paid_cleared: summary.totalCleared,
          total_pending: summary.totalPending,
          total_overdue: summary.totalOverdue,
          unallocated_credit: summary.totalUnallocatedCredit,
          open_installments: installments
            .filter((i) => i.status !== "paid")
            .map((i) => ({
              id: i.id,
              label: i.label,
              category: i.category,
              amount_due: i.amountDue,
              amount_paid: i.amountPaid,
              status: i.status,
              due_date: i.dueDate,
            })),
        });
      }

      case "get_overdue_accounts": {
        // T-267 — the debt-collection lens. DebtSummary comes from the
        // canonical debt repository (the SAME stream the alerts workspace
        // renders); no client-side re-derivation (§15.16).
        const minDays = Number.isFinite(Number(args.min_days_overdue))
          ? Math.max(1, Number(args.min_days_overdue))
          : 1;
        const limit = Math.min(25, Math.max(1, Number(args.limit) || 10));

        const debtors = repos.debt
          .observeSummary()
          .get()
          .filter((d) => d.daysOverdue >= minDays)
          .sort((a, b) => b.outstandingAmount - a.outstandingAmount)
          .slice(0, limit);

        const totalOutstanding = debtors.reduce((s, d) => s + d.outstandingAmount, 0);
        return JSON.stringify({
          filter_min_days_overdue: minDays,
          debtor_count: debtors.length,
          total_outstanding_filtered: totalOutstanding,
          debtors: debtors.map((d) => ({
            parent_id: d.parentId,
            parent_name: d.parentName,
            phone: d.parentPhone,
            student_count: d.studentCount,
            outstanding_amount: d.outstandingAmount,
            days_overdue: d.daysOverdue,
            aging_bucket: AGING_BUCKET_LABELS_FR[d.bucket] ?? d.bucket,
          })),
          guidance:
            "Trié par montant dû décroissant. propose_payment_reminder prépare une relance canonique (validation humaine requise).",
        });
      }

      case "get_collection_analytics": {
        // T-267 — aging composition + collection rate, straight from the
        // dashboard repository (the SAME data the Analytics tab renders).
        const [kpisRes, agingRes] = await Promise.all([
          repos.dashboard.kpis(),
          repos.dashboard.debtByAging(),
        ]);
        if (!kpisRes.ok) return JSON.stringify({ error: "Impossible de lire les KPIs." });
        if (!agingRes.ok) return JSON.stringify({ error: "Impossible de lire l'ancienneté des créances." });

        const kpis = kpisRes.value;
        const aging = agingRes.value;
        // Collection rate uses monthlyRevenue + outstandingDebt (the KPI
        // fields the DashboardKpi contract actually carries — the same
        // figures the Overview KPI cards render).
        const collected = kpis.monthlyRevenue;
        const outstanding = kpis.outstandingDebt;
        const totalExpected = collected + outstanding;
        const collectionRate = totalExpected > 0 ? Number(((collected / totalExpected) * 100).toFixed(1)) : 100;

        return JSON.stringify({
          collection_rate_percent: collectionRate,
          annual_revenue_collected: collected,
          outstanding_debt: outstanding,
          aging_buckets: aging.map((b) => ({
            bucket: AGING_BUCKET_LABELS_FR[b.bucket] ?? b.bucket,
            amount: b.amount,
            debtor_count: b.debtorCount,
          })),
          guidance:
            "Taux de recouvrement = encaissé mensuel / (encaissé mensuel + créances), calculé sur les KPIs canoniques du tableau de bord.",
        });
      }

      case "get_payment_history": {
        const parentId = String(args.parent_id ?? "");
        const parent = repos.parents.observeById(parentId).get();
        if (!parent) return JSON.stringify({ error: "Parent introuvable." });

        const payments = repos.payments
          .observeByParent(parentId)
          .get()
          .sort((a, b) => b.collectedAt.localeCompare(a.collectedAt))
          .slice(0, 15);

        const totalPaid = payments
          .filter((p) => p.status === "paid" || p.status === "pending_clearance")
          .reduce((s, p) => s + p.amount, 0);

        return JSON.stringify({
          parent_name: parentDisplayName(parent),
          payment_count: payments.length,
          total_value_of_shown_payments: totalPaid,
          payments: payments.map((p) => ({
            id: p.id,
            receipt_number: p.receiptNumber,
            amount: p.amount,
            method: PAYMENT_METHOD_LABELS_FR[p.method] ?? p.method,
            status: PAYMENT_STATUS_LABELS_FR[p.status] ?? p.status,
            collected_at: p.collectedAt,
            student_id: p.studentId,
            notes: p.notes,
          })),
        });
      }

      case "get_student_academic_profile": {
        const studentId = String(args.student_id ?? "");
        const student = repos.students.observeById(studentId).get();
        if (!student) return JSON.stringify({ error: "Élève introuvable." });

        const assessments = repos.grades.observeForStudent(studentId).get();
        const subjects = repos.subjects.observe().get();
        const term = currentTermWindow();

        // Canonical engine — the SAME GPA computation the bulletins use.
        const gpaResult = evaluateStudentTermPerformance(studentId, assessments, subjects);

        // T-267: attendance joins the profile (the canonical rate fn).
        const to = new Date();
        const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
        const attendance = repos.attendance
          .observeByStudent(studentId, from.toISOString().slice(0, 10), to.toISOString().slice(0, 10))
          .get();
        const attendanceRate = calculateAttendanceRate(attendance);

        return JSON.stringify({
          student_name: studentDisplayName(student),
          code: student.code,
          grade_level: student.gradeLevel,
          academic_level: student.level,
          current_term: term.label,
          gpa: gpaResult.gpa,
          is_passing: gpaResult.isPassing,
          missing_marks: gpaResult.missingAssessmentsCount,
          attendance_rate_last_30d: attendanceRate,
          recent_assessments: assessments.slice(0, 8).map((a) => {
            const subj = subjects.find((s) => s.id === a.subjectId);
            return {
              subject: subj?.name ?? a.subjectId,
              average: a.subjectAverage,
              term: a.term,
            };
          }),
        });
      }

      case "get_student_attendance": {
        // T-267 — the early-warning lens for décrochage scolaire. Uses the
        // canonical calculateAttendanceRate (academic.ts §attendance-rate).
        const studentId = String(args.student_id ?? "");
        const student = repos.students.observeById(studentId).get();
        if (!student) return JSON.stringify({ error: "Élève introuvable." });

        const days = Math.min(365, Math.max(1, Number(args.days) || 30));
        const to = new Date();
        const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
        const fromIso = from.toISOString().slice(0, 10);
        const toIso = to.toISOString().slice(0, 10);

        const records = repos.attendance
          .observeByStudent(studentId, fromIso, toIso)
          .get()
          .sort((a, b) => b.date.localeCompare(a.date));

        const rate = calculateAttendanceRate(records);
        const count = (status: string) => records.filter((r) => r.status === status).length;

        const recent = records.slice(0, 10).map((r) => ({
          date: r.date,
          session: r.session,
          status: r.status,
          arrival_time: r.arrivalTime ?? null,
          justification_status: r.justificationStatus ?? null,
        }));

        const unexcusedAbsences = count("absent_unexcused");
        const risk =
          unexcusedAbsences >= 8 ? "high" : unexcusedAbsences >= 4 ? "medium" : rate < 0.85 ? "watch" : "low";

        return JSON.stringify({
          student_name: studentDisplayName(student),
          window_days: days,
          total_sessions: records.length,
          attendance_rate: rate,
          present_count: count("present"),
          late_count: count("late"),
          excused_absences: count("absent_excused"),
          unexcused_absences: unexcusedAbsences,
          drop_off_risk: risk,
          risk_scale: "low < watch < medium < high (seuils : absences non excusées ≥4 médian, ≥8 élevé ; taux < 85%)",
          recent_records: recent,
        });
      }

      case "get_class_performance": {
        // T-267 — the pedagogical decision lens. GPA per student comes
        // from the SAME evaluateStudentTermPerformance the bulletins use.
        const classId = String(args.class_id ?? "");
        const cls = repos.classes.observeById(classId).get();
        if (!cls) return JSON.stringify({ error: "Classe introuvable." });

        const students = repos.students.observeByClass(classId).get();
        const subjects = repos.subjects.observe().get();

        const performances = students.map((s) => {
          const assessments = repos.grades.observeForStudent(s.id).get();
          const gpaResult = evaluateStudentTermPerformance(s.id, assessments, subjects);
          return {
            student_id: s.id,
            name: studentDisplayName(s),
            gpa: gpaResult.gpa,
            is_passing: gpaResult.isPassing,
          };
        });

        const evaluated = performances.filter((p) => p.gpa !== null);
        const classAverage =
          evaluated.length > 0
            ? Number((evaluated.reduce((sum, p) => sum + (p.gpa ?? 0), 0) / evaluated.length).toFixed(2))
            : null;

        const sorted = [...evaluated].sort((a, b) => (b.gpa ?? 0) - (a.gpa ?? 0));
        const atRisk = evaluated.filter((p) => (p.gpa ?? 20) < 10);

        return JSON.stringify({
          class_name: cls.name,
          class_code: cls.code,
          level: cls.level,
          student_count: students.length,
          evaluated_count: evaluated.length,
          class_average: classAverage,
          top_performers: sorted.slice(0, 3).map((p) => ({ name: p.name, gpa: p.gpa })),
          bottom_performers: sorted.slice(-3).reverse().map((p) => ({ name: p.name, gpa: p.gpa })),
          at_risk_count: atRisk.length,
          at_risk_students: atRisk
            .slice(0, 10)
            .map((p) => ({ student_id: p.student_id, name: p.name, gpa: p.gpa })),
          note: "Moyenne < 10/20 = élève à risque (règle canonique de passage).",
        });
      }

      case "get_school_kpi_overview": {
        const kpisRes = await repos.dashboard.kpis();
        if (!kpisRes.ok) return JSON.stringify({ error: "Impossible de lire les KPIs." });
        return JSON.stringify(kpisRes.value);
      }

      case "propose_account_adjustment": {
        // T-267: REAL enforcement — validate BEFORE the proposal exists.
        // A malformed proposal returns an error the model must answer for;
        // the human-in-the-loop card only ever sees valid input.
        const validation = validateAdjustmentArgs(args, repos);
        if (!validation.ok) {
          return JSON.stringify({ error: validation.error, hint: validation.hint ?? null });
        }

        const proposal: ActionProposal = {
          id: `act-${Date.now()}`,
          type: "account_adjustment",
          title: "Proposition d'ajustement de compte",
          summary: `${validation.amount < 0 ? "Remise" : "Débit"} de ${Math.abs(
            validation.amount,
          ).toLocaleString("fr-FR")} DZD pour ${validation.parentName} : ${validation.reason}`,
          payload: {
            parentId: validation.parentId,
            parentName: validation.parentName,
            amount: validation.amount,
            reason: validation.reason,
          },
          requiresApproval: true,
          status: "pending",
        };
        onActionProposed?.(proposal);
        return JSON.stringify({
          status: "proposal_generated",
          message:
            "L'action a été soumise à l'approbation de l'administrateur dans l'interface.",
          proposal_id: proposal.id,
        });
      }

      case "propose_payment_reminder": {
        // T-267 — a REAL actionable task: the canonical debt reminder
        // (repos.debt.sendReminder — notification + audit entry, VAULT
        // §07.06) dispatched after human validation. Closes AI-308
        // residual (b): at least one proposal type beyond
        // account_adjustment now executes a real side effect.
        const parentId = typeof args.parent_id === "string" ? args.parent_id.trim() : "";
        if (!parentId) {
          return JSON.stringify({
            error: "Paramètre manquant : parent_id (UUID) est obligatoire.",
            hint: "Utilisez get_overdue_accounts ou search_entities pour identifier le parent.",
          });
        }
        const parent = repos.parents.observeById(parentId).get();
        if (!parent) {
          return JSON.stringify({ error: `Aucun parent avec l'identifiant « ${parentId} ».` });
        }

        // Cross-check the debt stream: a reminder is only meaningful for
        // an actual debtor (the same stream the alerts workspace uses).
        const debtors = repos.debt.observeSummary().get();
        const debt = debtors.find((d) => d.parentId === parentId);
        if (!debt) {
          return JSON.stringify({
            error: "Ce parent n'a aucune créance en retard — un rappel n'est pas pertinent.",
            hint: "Utilisez get_financial_ledger_summary pour vérifier sa situation réelle.",
          });
        }
        const reason = typeof args.reason === "string" ? args.reason.trim() : "";

        const proposal: ActionProposal = {
          id: `act-${Date.now()}`,
          type: "send_reminder",
          title: "Rappel de paiement",
          summary: `Envoyer un rappel officiel à ${debt.parentName} — ${debt.outstandingAmount.toLocaleString("fr-FR")} DZD dus, ${debt.daysOverdue} jours de retard${reason ? ` (${reason})` : ""}`,
          payload: {
            parentId,
            parentName: debt.parentName,
            outstandingAmount: debt.outstandingAmount,
            daysOverdue: debt.daysOverdue,
            reason,
          },
          requiresApproval: true,
          status: "pending",
        };
        onActionProposed?.(proposal);
        return JSON.stringify({
          status: "proposal_generated",
          message: "Le rappel est prêt — validation humaine requise avant l'envoi.",
          proposal_id: proposal.id,
        });
      }

      case "request_user_clarification": {
        return JSON.stringify({
          status: "clarification_needed",
          question: args.question,
          details: args.context_details,
        });
      }

      default:
        return JSON.stringify({ error: `Outil inconnu : ${name}` });
    }
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
  }
}
