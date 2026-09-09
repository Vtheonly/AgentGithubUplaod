// ============================================================================
// FILE: elimtiyaz-desktop/src/core/ai/tools/system-tools.ts
// ============================================================================
/**
 * Deep-domain tools for the Agentic Copilot (T-260, 39th session).
 *
 * Instead of shallow chatbot answers, the agent is granted direct READ
 * access to real data through the Repositories and the EXACT mathematical
 * engines in `src/domain/calc/` (`computeParentSummary`,
 * `evaluateStudentTermPerformance`, `currentTermWindow`) — the same
 * reference implementations the UI uses, so AI-quoted balances and GPAs can
 * never diverge from the ledgers on screen (AGENTS.md §15.16: never
 * synthesize financial data client-side when REAL rows exist).
 *
 * Mutation policy (§15.5/§15.8): `propose_account_adjustment` does NOT
 * write — it emits an `ActionProposal` for 1-click human validation; the
 * write itself goes through the canonical `repos.payments.adjust` contract
 * in the Copilot provider's `approveAction`.
 */
import type { Repositories } from "../../../app/providers/repository-provider";
import type { ToolDefinition, ActionProposal } from "../agent-types";
import { computeParentSummary } from "../../../domain/calc/ledger/balance";
import { evaluateStudentTermPerformance } from "../../../domain/calc/academics/gpa";
import { currentTermWindow } from "../../../domain/calc/academics/terms";
// Canonical name renderers (DATA-005/T-134): NEVER compose first+last by
// hand — the live corpus carries displayName-only rows.
import { parentDisplayName } from "../../../domain/model/parent";
import { studentDisplayName } from "../../../domain/model/student";

/**
 * Tool schemas sent to the provider (OpenAI function-calling format).
 * Descriptions are in professional French — they steer the model's tool
 * selection and are part of the product's UX.
 */
export const SYSTEM_TOOLS_DEFINITIONS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "search_entities",
      description:
        "Rechercher des élèves, parents, ou classes par mot-clé, nom, code ou téléphone.",
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
        "Obtenir la situation financière vérifiée d'un parent : solde dû, total payé, tranches, créances et anomalies.",
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
      name: "get_school_kpi_overview",
      description:
        "Obtenir les statistiques macro de l'école : effectifs, total des créances impayées, revenus mensuels et présence générale.",
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
        "Proposer une remise, régularisation ou pénalité financière pour un parent nécessitant une validation humaine avant exécution.",
      parameters: {
        type: "object",
        properties: {
          parent_id: { type: "string", description: "UUID du parent" },
          amount: { type: "number", description: "Montant (négatif pour remise/crédit, positif pour débit)" },
          reason: { type: "string", description: "Motif formel justifiant l'ajustement" },
        },
        required: ["parent_id", "amount", "reason"],
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

/**
 * Execute one tool call against the live repositories.
 * ALWAYS returns a JSON string (the wire format for `role: "tool"` messages)
 * — errors are returned as `{ "error": … }`, never thrown, so one bad tool
 * call can't kill the whole agent loop.
 */
export async function executeSystemTool(
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

      case "get_student_academic_profile": {
        const studentId = String(args.student_id ?? "");
        const student = repos.students.observeById(studentId).get();
        if (!student) return JSON.stringify({ error: "Élève introuvable." });

        const assessments = repos.grades.observeForStudent(studentId).get();
        const subjects = repos.subjects.observe().get();
        const term = currentTermWindow();

        // Canonical engine — the SAME GPA computation the bulletins use.
        const gpaResult = evaluateStudentTermPerformance(studentId, assessments, subjects);

        return JSON.stringify({
          student_name: studentDisplayName(student),
          code: student.code,
          grade_level: student.gradeLevel,
          academic_level: student.level,
          current_term: term.label,
          gpa: gpaResult.gpa,
          is_passing: gpaResult.isPassing,
          missing_marks: gpaResult.missingAssessmentsCount,
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

      case "get_school_kpi_overview": {
        const kpisRes = await repos.dashboard.kpis();
        if (!kpisRes.ok) return JSON.stringify({ error: "Impossible de lire les KPIs." });
        return JSON.stringify(kpisRes.value);
      }

      case "propose_account_adjustment": {
        const proposal: ActionProposal = {
          id: `act-${Date.now()}`,
          type: "account_adjustment",
          title: "Proposition d'ajustement de compte",
          summary: `${Number(args.amount) < 0 ? "Remise" : "Débit"} de ${Math.abs(
            Number(args.amount),
          ).toLocaleString("fr-FR")} DZD : ${args.reason}`,
          payload: {
            parentId: args.parent_id,
            amount: Number(args.amount),
            reason: String(args.reason),
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
