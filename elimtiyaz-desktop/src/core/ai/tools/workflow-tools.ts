// ============================================================================
// FILE: elimtiyaz-desktop/src/core/ai/tools/workflow-tools.ts
// ============================================================================
/**
 * Workflow/composite tool suite (T-276, 42nd session — AI-311e).
 *
 * Four tools that operate at the WORKFLOW level — multi-step operational
 * plans, batched actions, and cross-domain synthesis:
 *   - plan_collection_campaign  → a prioritized collection strategy with
 *                                 tiers, per-debtor recommended actions and
 *                                 a tier chart (ADVISORY — no writes)
 *   - propose_batch_reminders   → ONE human-validated batch of reminders
 *                                 for a list of debtors (REAL execution:
 *                                 the canonical sendReminder per parent —
 *                                 the T-267 execution discipline, batched)
 *   - propose_payment_plan      → an equal-installment plan over the REAL
 *                                 outstanding balance + a printable PDF
 *                                 schedule document (advisory document,
 *                                 never a financial write)
 *   - recommend_interventions   → cross-domain early-warning synthesis
 *                                 (GPA × attendance × data gaps) with
 *                                 concrete recommended actions
 *
 * MUTATION POLICY (§15.5/§15.8): only propose_batch_reminders creates an
 * ActionProposal — and its approval leg executes the canonical
 * repos.debt.sendReminder per parent in the provider (T-272 wiring).
 * The other three are read-side products: analysis + documents. A
 * payment plan is a PRINTED commitment proposal, not a financial
 * mutation — no installment rows are written by the AI layer.
 */
import type { Repositories } from "../../../app/providers/repository-provider";
import type { ToolDefinition, ActionProposal } from "../agent-types";
import { withArtifact, type ChartArtifact, type DocumentArtifact } from "../artifacts";
import {
  prioritizeDebtors,
  scoreInterventionRisk,
  buildPaymentPlan,
  type DebtorInput,
} from "../analysis/insights";
import { computeDescriptiveStats } from "../analysis/statistics";
import { parentDisplayName } from "../../../domain/model/parent";
import { evaluateStudentTermPerformance } from "../../../domain/calc/academics/gpa";
import { calculateAttendanceRate } from "../../../domain/model/academic";
import { computeParentSummary } from "../../../domain/calc/ledger/balance";

/** Hard cap on a batch — one validation card stays reviewable by a human. */
const MAX_BATCH_PARENTS = 10;

/* ------------------------------------------------------------------ */
/*  Tool schemas                                                       */
/* ------------------------------------------------------------------ */

export const WORKFLOW_TOOLS_DEFINITIONS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "plan_collection_campaign",
      description:
        "Construire la stratégie de recouvrement priorisée : score par débiteur (montant × ancienneté selon la stratégie choisie), paliers P1/P2/P3, action recommandée par débiteur et répartition par palier. Advisory pur — aucune action n'est exécutée ; utilisez ensuite propose_batch_reminders pour lancer les relances.",
      parameters: {
        type: "object",
        properties: {
          strategy: {
            type: "string",
            description: "La stratégie de priorisation",
            enum: ["amount_first", "aging_first", "balanced"],
          },
          min_days_overdue: {
            type: "number",
            description: "Optionnel: seuil minimum de jours de retard (défaut 1).",
          },
          limit: { type: "number", description: "Optionnel: nombre max de débiteurs (défaut 15, max 25)." },
        },
        required: ["strategy"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_batch_reminders",
      description:
        "Proposer l'envoi d'un lot de rappels de paiement à plusieurs débiteurs (max 10) en UNE seule carte de validation. Chaque parent est vérifié contre le flux réel des créances avant la proposition. Après validation humaine, chaque rappel est envoyé via le canal canonique (notification + entrée d'audit).",
      parameters: {
        type: "object",
        properties: {
          parent_ids: {
            type: "array",
            items: { type: "string" },
            description: "Les UUIDs des parents à relancer (1 à 10, tous débiteurs réels).",
          },
          reason: { type: "string", description: "Optionnel: contexte de la campagne." },
        },
        required: ["parent_ids"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_payment_plan",
      description:
        "Construire un plan de paiement échelonné pour un parent débiteur : versements égaux sur 1 à 12 mois (avec acompte optionnel), dates d'échéance et tableau d'amortissement — le solde utilisé est le solde réel canonique. Retourne un document PDF imprimable à remettre au parent. Advisory : aucune écriture financière n'est effectuée.",
      parameters: {
        type: "object",
        properties: {
          parent_id: { type: "string", description: "UUID du parent débiteur (doit exister)." },
          months: { type: "number", description: "Durée en mois (1 à 12)." },
          down_payment: {
            type: "number",
            description: "Optionnel: acompte immédiat en DZD (défaut 0, plafonné au solde).",
          },
        },
        required: ["parent_id", "months"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "recommend_interventions",
      description:
        "Identifier les élèves nécessitant une intervention immédiate et recommander les actions : score de risque composite (moyenne, assiduité, évaluations manquantes) par élève, avec drivers détaillés et actions concrètes. Pour une classe précise ou toute l'école (max 3 classes). Le système d'alerte précoce pédagogique.",
      parameters: {
        type: "object",
        properties: {
          class_id: {
            type: "string",
            description: "Optionnel: UUID d'une classe cible (défaut: les 3 premières classes).",
          },
        },
      },
    },
  },
];

/* ------------------------------------------------------------------ */
/*  Execution                                                          */
/* ------------------------------------------------------------------ */

export async function executeWorkflowTool(
  name: string,
  args: Record<string, unknown>,
  repos: Repositories,
  onActionProposed?: (action: ActionProposal) => void,
): Promise<string> {
  switch (name) {
    /* ---------------- plan_collection_campaign ---------------- */
    case "plan_collection_campaign": {
      const strategyArg = String(args.strategy ?? "balanced");
      const strategy =
        strategyArg === "amount_first" || strategyArg === "aging_first" ? strategyArg : "balanced";
      const minDays = Number.isFinite(Number(args.min_days_overdue))
        ? Math.max(1, Number(args.min_days_overdue))
        : 1;
      const limit = Math.min(25, Math.max(1, Number(args.limit) || 15));

      const debtors: DebtorInput[] = repos.debt
        .observeSummary()
        .get()
        .filter((d) => d.daysOverdue >= minDays)
        .slice(0, limit)
        .map((d) => ({
          parentId: d.parentId,
          parentName: d.parentName,
          parentPhone: d.parentPhone,
          studentCount: d.studentCount,
          outstandingAmount: d.outstandingAmount,
          daysOverdue: d.daysOverdue,
          bucket: d.bucket,
        }));
      if (debtors.length === 0) {
        return JSON.stringify({ error: "Aucun débiteur pour ces critères — la campagne serait vide." });
      }

      const prioritized = prioritizeDebtors(debtors, strategy);
      const p1 = prioritized.filter((d) => d.priority === "P1");
      const p2 = prioritized.filter((d) => d.priority === "P2");
      const p3 = prioritized.filter((d) => d.priority === "P3");
      const total = prioritized.reduce((s, d) => s + d.outstandingAmount, 0);
      const amountStats = computeDescriptiveStats(debtors.map((d) => d.outstandingAmount), 0);

      const artifact: ChartArtifact = {
        kind: "chart",
        chartType: "bar",
        title: `Répartition par palier de priorité (${strategy === "amount_first" ? "montant d'abord" : strategy === "aging_first" ? "ancienneté d'abord" : "équilibré"})`,
        categories: ["P1 — action immédiate", "P2 — rappel écrit", "P3 — rappel automatique"],
        series: [
          {
            name: "Débiteurs",
            data: [p1.length, p2.length, p3.length],
          },
        ],
        unit: "count",
        caption: `${prioritized.length} débiteurs · ${total.toLocaleString("fr-FR")} DZD dus · score = montile du montant et de l'ancienneté pondérés selon la stratégie.`,
      };

      return withArtifact(
        {
          strategy,
          min_days_overdue: minDays,
          debtor_count: prioritized.length,
          total_outstanding: total,
          amount_stats: { mean: amountStats.mean, median: amountStats.median, max: amountStats.max },
          tiers: {
            P1: {
              count: p1.length,
              outstanding: p1.reduce((s, d) => s + d.outstandingAmount, 0),
            },
            P2: {
              count: p2.length,
              outstanding: p2.reduce((s, d) => s + d.outstandingAmount, 0),
            },
            P3: {
              count: p3.length,
              outstanding: p3.reduce((s, d) => s + d.outstandingAmount, 0),
            },
          },
          prioritized_debtors: prioritized.map((d) => ({
            parent_id: d.parentId,
            parent_name: d.parentName,
            phone: d.parentPhone,
            outstanding_amount: d.outstandingAmount,
            days_overdue: d.daysOverdue,
            priority: d.priority,
            score: d.score,
            recommended_action: d.recommendedAction,
            rationale: d.rationale,
          })),
          guidance:
            "Plan advisory : aucune relance n'est partie. Passez par propose_batch_reminders (max 10 parents) pour soumettre les envois à validation humaine.",
        },
        artifact,
      );
    }

    /* ---------------- propose_batch_reminders ---------------- */
    case "propose_batch_reminders": {
      const ids = Array.isArray(args.parent_ids)
        ? (args.parent_ids as unknown[]).filter((id): id is string => typeof id === "string")
        : [];
      if (ids.length === 0) {
        return JSON.stringify({
          error: "Paramètre manquant ou vide : parent_ids doit contenir 1 à 10 UUIDs.",
          hint: "Utilisez plan_collection_campaign ou get_overdue_accounts pour constituer la liste.",
        });
      }
      if (ids.length > MAX_BATCH_PARENTS) {
        return JSON.stringify({
          error: `Lot trop volumineux : ${ids.length} parents fournis, maximum ${MAX_BATCH_PARENTS}.`,
          hint: "Découpez la campagne en plusieurs lots — chaque carte de validation doit rester vérifiable par un humain.",
        });
      }

      // Validate EVERY parent against the real debt stream (the same
      // discipline as the single-reminder proposal — T-267).
      const debtors = repos.debt.observeSummary().get();
      const validated: { id: string; name: string; amount: number; days: number }[] = [];
      const rejected: { id: string; reason: string }[] = [];
      for (const id of ids) {
        const parent = repos.parents.observeById(id).get();
        if (!parent) {
          rejected.push({ id, reason: "parent introuvable" });
          continue;
        }
        const debt = debtors.find((d) => d.parentId === id);
        if (!debt) {
          rejected.push({
            id,
            reason: `${parentDisplayName(parent)} n'a aucune créance en retard`,
          });
          continue;
        }
        validated.push({
          id,
          name: parentDisplayName(parent),
          amount: debt.outstandingAmount,
          days: debt.daysOverdue,
        });
      }
      if (validated.length === 0) {
        return JSON.stringify({
          error: "Aucun parent du lot n'est un débiteur réel — la proposition est refusée.",
          rejected,
          hint: "Constituez le lot depuis get_overdue_accounts ou plan_collection_campaign.",
        });
      }

      const reason = typeof args.reason === "string" ? args.reason.trim() : "";
      const totalOutstanding = validated.reduce((s, v) => s + v.amount, 0);
      const proposal: ActionProposal = {
        id: `act-${Date.now()}`,
        type: "batch_reminders",
        title: `Rappels groupés (${validated.length} parents)`,
        summary: `Envoyer un rappel officiel à ${validated.length} débiteurs — ${totalOutstanding.toLocaleString("fr-FR")} DZD dus au total${reason ? ` (${reason})` : ""} : ${validated.map((v) => v.name).join(", ")}`,
        payload: {
          parentIds: validated.map((v) => v.id),
          parentNames: validated.map((v) => v.name),
          totalOutstanding,
          reason,
        },
        requiresApproval: true,
        status: "pending",
      };
      onActionProposed?.(proposal);

      return JSON.stringify({
        status: validated.length < ids.length ? "proposal_generated_partial" : "proposal_generated",
        message: `${validated.length} rappels préparés — validation humaine requise avant l'envoi.`,
        validated: validated.map((v) => ({
          parent_id: v.id,
          parent_name: v.name,
          outstanding_amount: v.amount,
          days_overdue: v.days,
        })),
        rejected,
        proposal_id: proposal.id,
      });
    }

    /* ---------------- propose_payment_plan ---------------- */
    case "propose_payment_plan": {
      const parentId = typeof args.parent_id === "string" ? args.parent_id.trim() : "";
      if (!parentId) {
        return JSON.stringify({
          error: "Paramètre manquant : parent_id est obligatoire.",
          hint: "Utilisez get_overdue_accounts ou search_entities pour identifier le parent.",
        });
      }
      const parent = repos.parents.observeById(parentId).get();
      if (!parent) return JSON.stringify({ error: `Aucun parent avec l'identifiant « ${parentId} ».` });

      // The outstanding amount comes from the CANONICAL summary (the
      // same engine the financial UI uses — §15.16, never re-derived).
      const entries = repos.ledger.observeByParent(parentId).get();
      const summary = computeParentSummary(entries, parentId, parentDisplayName(parent));
      const outstanding = summary.totalOutstanding;
      if (outstanding <= 0) {
        return JSON.stringify({
          error: `${parentDisplayName(parent)} n'a aucun solde dû (${Math.round(outstanding).toLocaleString("fr-FR")} DZD) — un plan serait vide.`,
          hint: "Vérifiez la situation réelle avec get_financial_ledger_summary.",
        });
      }

      const months = Math.round(Number(args.months));
      if (!Number.isFinite(months) || months < 1 || months > 12) {
        return JSON.stringify({
          error: "Durée invalide : months doit être un entier entre 1 et 12.",
        });
      }
      const downPayment = Number.isFinite(Number(args.down_payment)) ? Math.max(0, Number(args.down_payment)) : 0;

      const plan = buildPaymentPlan(outstanding, months, new Date(), downPayment);
      const parentCode = parent.code;

      const artifact: DocumentArtifact = {
        kind: "document",
        format: "pdf",
        documentType: "payment_plan",
        title: `Plan de paiement — ${parentDisplayName(parent)}`,
        fileName: `plan-paiement-${parentCode}-${new Date().toISOString().slice(0, 10)}.pdf`,
        params: { parentId, months, downPayment: plan.downPayment },
        rowCount: plan.schedule.length,
        caption: `${months} mensualités de ${plan.monthlyAmount.toLocaleString("fr-FR")} DZD${plan.downPayment > 0 ? ` + acompte ${plan.downPayment.toLocaleString("fr-FR")} DZD` : ""} — total ${plan.totalPlanned.toLocaleString("fr-FR")} DZD.`,
      };

      return withArtifact(
        {
          status: "plan_ready",
          parent_name: parentDisplayName(parent),
          parent_code: parentCode,
          outstanding_amount: plan.outstandingAmount,
          months: plan.months,
          down_payment: plan.downPayment,
          monthly_amount: plan.monthlyAmount,
          total_planned: plan.totalPlanned,
          schedule: plan.schedule,
          message:
            "Le plan de paiement PDF est prêt — cliquez sur Télécharger dans la conversation. Document advisory : aucune échéance n'est inscrite dans le système.",
        },
        artifact,
      );
    }

    /* ---------------- recommend_interventions ---------------- */
    case "recommend_interventions": {
      const classId = typeof args.class_id === "string" ? args.class_id.trim() : "";
      let targetClassIds: string[] = [];
      if (classId) {
        const cls = repos.classes.observeById(classId).get();
        if (!cls) return JSON.stringify({ error: "Classe introuvable." });
        targetClassIds = [classId];
      } else {
        targetClassIds = repos.classes
          .observe()
          .get()
          .slice(0, 3)
          .map((c) => c.id);
      }
      if (targetClassIds.length === 0) return JSON.stringify({ error: "Aucune classe à analyser." });

      const subjects = repos.subjects.observe().get();
      const { from, to } = { from: isoWindow(), to: todayIso() };
      const candidates: {
        student: { id: string; firstName: string; lastName: string; displayName: string | null; classId: string | null };
        gpa: number | null;
        isPassing: boolean | null;
        attendanceRate: number | null;
        unexcusedAbsences: number;
        missingAssessments: number;
      }[] = [];

      for (const cid of targetClassIds) {
        const cls = repos.classes.observeById(cid).get();
        if (!cls) continue;
        for (const s of repos.students.observeByClass(cid).get()) {
          const gpa = evaluateStudentTermPerformance(
            s.id,
            repos.grades.observeForStudent(s.id).get(),
            subjects,
          );
          const records = repos.attendance.observeByStudent(s.id, from, to).get();
          candidates.push({
            student: s,
            gpa: gpa.gpa,
            isPassing: gpa.isPassing,
            attendanceRate: calculateAttendanceRate(records),
            unexcusedAbsences: records.filter((r) => r.status === "absent_unexcused").length,
            missingAssessments: gpa.missingAssessmentsCount,
          });
        }
      }
      if (candidates.length === 0) {
        return JSON.stringify({ error: "Aucun élève à évaluer dans les classes ciblées." });
      }

      const ranked = scoreInterventionRisk(candidates);
      const critical = ranked.filter((c) => c.riskLevel === "critical").length;
      const high = ranked.filter((c) => c.riskLevel === "high").length;

      const artifact: ChartArtifact | null =
        ranked.length > 0
          ? {
              kind: "chart",
              chartType: "bar",
              title: "Score de risque composite par élève",
              categories: ranked.map((c) => c.studentName),
              series: [{ name: "Score /100", data: ranked.map((c) => c.riskScore) }],
              unit: "score",
              caption: "Académique (45) + assiduité (35) + données manquantes (20) — seuils : critique ≥ 75, élevé ≥ 55.",
            }
          : null;

      const base: Record<string, unknown> = {
        analyzed_students: candidates.length,
        classes: targetClassIds
          .map((id) => repos.classes.observeById(id).get()?.name)
          .filter((n): n is string => Boolean(n)),
        flagged_count: ranked.length,
        critical_count: critical,
        high_count: high,
        interventions: ranked.map((c, i) => ({
          rank: i + 1,
          student_id: c.studentId,
          student_name: c.studentName,
          class_id: c.classId,
          gpa: c.gpa,
          attendance_rate: c.attendanceRate,
          unexcused_absences: c.unexcusedAbsences,
          missing_assessments: c.missingAssessments,
          risk_score: c.riskScore,
          risk_level: c.riskLevel,
          drivers: c.drivers,
          recommended_actions: c.recommendedActions,
        })),
        guidance:
          "Croisez TOUJOURS le score avec le contexte (un élève nouveau peut simplement manquer d'évaluations). Les scores ≥ 55 appellent un contact cette semaine.",
      };
      return artifact ? withArtifact(base, artifact) : JSON.stringify(base);
    }

    default:
      return JSON.stringify({ error: `Outil de workflow inconnu : ${name}` });
  }
}

/* ------------------------------------------------------------------ */
/*  Local helpers                                                      */
/* ------------------------------------------------------------------ */

function isoWindow(): string {
  const from = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  return from.toISOString().slice(0, 10);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
