// ============================================================================
// FILE: elimtiyaz-desktop/src/core/ai/tools/document-tools.ts
// ============================================================================
/**
 * Document-generation tool suite (T-275, 42nd session — AI-311d).
 *
 * Four tools that produce REAL downloadable documents:
 *   - generate_parent_statement → the canonical account statement PDF
 *                                 (generateAccountStatementPdf — the SAME
 *                                 generator the CRM drawer uses)
 *   - generate_class_report     → a class performance report PDF (NEW
 *                                 generator, receipt-pdf/report-document)
 *   - generate_debt_report      → the collector's daily debt sheet PDF
 *   - export_data               → XLSX/CSV export of a named dataset
 *                                 (buildXlsxBuffer / CSV serialization —
 *                                 the SAME engine the export buttons use)
 *
 * CARRYING MODE (ADR-016 §3): the tool result carries a DOCUMENT
 * artifact with the refetch params (PDF) or the rows themselves
 * (XLSX/CSV, capped at MAX_EXPORT_ROWS). The PDF BYTES never travel
 * through the conversation — the provider's downloadArtifact() refetches
 * canonical data and builds the document at click time through the
 * canonical generators. Nothing here writes to the DB (§15.5/§15.8 —
 * documents are read-only products).
 */
import type { Repositories } from "../../../app/providers/repository-provider";
import type { ToolDefinition } from "../agent-types";
import { withArtifact, MAX_EXPORT_ROWS, type DocumentArtifact } from "../artifacts";
import { parentDisplayName } from "../../../domain/model/parent";
import { studentDisplayName } from "../../../domain/model/student";
import { AGING_BUCKET_LABELS_FR } from "../../../domain/model/payment";
import { evaluateStudentTermPerformance } from "../../../domain/calc/academics/gpa";
import type { Subject } from "../../../domain/model/academic";

/* ------------------------------------------------------------------ */
/*  Tool schemas                                                       */
/* ------------------------------------------------------------------ */

export const DOCUMENT_TOOLS_DEFINITIONS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "generate_parent_statement",
      description:
        "Générer le relevé de compte officiel d'un parent (PDF) : tous ses paiements, montants, méthodes et statuts — le document canonique utilisé en cas de contestation ou de récapitulatif annuel. Un bouton de téléchargement apparaît dans la conversation.",
      parameters: {
        type: "object",
        properties: {
          parent_id: { type: "string", description: "UUID du parent (doit exister)." },
        },
        required: ["parent_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_class_report",
      description:
        "Générer le rapport de performance d'une classe (PDF) : moyenne de classe, distribution des niveaux, meilleurs élèves, élèves à risque et effectifs — le document de réunion pédagogique. Un bouton de téléchargement apparaît dans la conversation.",
      parameters: {
        type: "object",
        properties: {
          class_id: { type: "string", description: "UUID de la classe (doit exister)." },
        },
        required: ["class_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_debt_report",
      description:
        "Générer la feuille de recouvrement du jour (PDF) : débiteurs triés par priorité avec montants, ancienneté, téléphones et actions recommandées — le document de travail de l'équipe de recouvrement. Un bouton de téléchargement apparaît dans la conversation.",
      parameters: {
        type: "object",
        properties: {
          min_days_overdue: {
            type: "number",
            description: "Optionnel: seuil minimum de jours de retard (défaut 1).",
          },
          limit: { type: "number", description: "Optionnel: nombre max de débiteurs (défaut 15, max 25)." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "export_data",
      description:
        "Exporter un jeu de données en fichier Excel (.xlsx) ou CSV : débiteurs, paiements d'un parent, performance d'une classe, revenus 12 mois, ou démographie. Le fichier est téléchargeable directement depuis la conversation. Idéal pour préparer un tableur externe.",
      parameters: {
        type: "object",
        properties: {
          dataset: {
            type: "string",
            description: "Le jeu de données à exporter",
            enum: [
              "overdue_accounts",
              "payments_by_parent",
              "class_performance",
              "revenue_12m",
              "enrollment_demographics",
            ],
          },
          format: { type: "string", description: "Le format de fichier", enum: ["xlsx", "csv"] },
          parent_id: { type: "string", description: "Obligatoire pour payments_by_parent." },
          class_id: { type: "string", description: "Obligatoire pour class_performance." },
        },
        required: ["dataset", "format"],
      },
    },
  },
];

/* ------------------------------------------------------------------ */
/*  Execution                                                          */
/* ------------------------------------------------------------------ */

export async function executeDocumentTool(
  name: string,
  args: Record<string, unknown>,
  repos: Repositories,
): Promise<string> {
  switch (name) {
    /* ---------------- generate_parent_statement ---------------- */
    case "generate_parent_statement": {
      const parentId = typeof args.parent_id === "string" ? args.parent_id.trim() : "";
      if (!parentId) {
        return JSON.stringify({
          error: "Paramètre manquant : parent_id est obligatoire.",
          hint: "Utilisez search_entities pour identifier le parent.",
        });
      }
      const parent = repos.parents.observeById(parentId).get();
      if (!parent) return JSON.stringify({ error: `Aucun parent avec l'identifiant « ${parentId} ».` });
      const payments = repos.payments.observeByParent(parentId).get();
      if (payments.length === 0) {
        return JSON.stringify({
          error: `${parentDisplayName(parent)} n'a aucun paiement enregistré — un relevé serait vide.`,
        });
      }

      const artifact: DocumentArtifact = {
        kind: "document",
        format: "pdf",
        documentType: "parent_statement",
        title: `Relevé de compte — ${parentDisplayName(parent)}`,
        fileName: `releve-compte-${parent.code}-${new Date().toISOString().slice(0, 10)}.pdf`,
        params: { parentId },
        rowCount: payments.length,
        caption: `${payments.length} paiements — document officiel canonique.`,
      };
      return withArtifact(
        {
          status: "document_ready",
          document_type: "parent_statement",
          parent_name: parentDisplayName(parent),
          parent_code: parent.code,
          payment_count: payments.length,
          message: "Le relevé PDF est prêt — cliquez sur Télécharger dans la conversation.",
        },
        artifact,
      );
    }

    /* ---------------- generate_class_report ---------------- */
    case "generate_class_report": {
      const classId = typeof args.class_id === "string" ? args.class_id.trim() : "";
      if (!classId) {
        return JSON.stringify({
          error: "Paramètre manquant : class_id est obligatoire.",
          hint: "Utilisez search_entities avec entity_type=class pour identifier la classe.",
        });
      }
      const cls = repos.classes.observeById(classId).get();
      if (!cls) return JSON.stringify({ error: "Classe introuvable." });
      const students = repos.students.observeByClass(classId).get();
      if (students.length === 0) {
        return JSON.stringify({ error: `La classe ${cls.name} n'a aucun élève — rapport vide.` });
      }

      const artifact: DocumentArtifact = {
        kind: "document",
        format: "pdf",
        documentType: "class_report",
        title: `Rapport de classe — ${cls.name}`,
        fileName: `rapport-classe-${cls.code}-${new Date().toISOString().slice(0, 10)}.pdf`,
        params: { classId },
        rowCount: students.length,
        caption: `Effectif ${students.length} — document de réunion pédagogique.`,
      };
      return withArtifact(
        {
          status: "document_ready",
          document_type: "class_report",
          class_name: cls.name,
          class_code: cls.code,
          student_count: students.length,
          message: "Le rapport de classe PDF est prêt — cliquez sur Télécharger dans la conversation.",
        },
        artifact,
      );
    }

    /* ---------------- generate_debt_report ---------------- */
    case "generate_debt_report": {
      const minDays = Number.isFinite(Number(args.min_days_overdue))
        ? Math.max(1, Number(args.min_days_overdue))
        : 1;
      const limit = Math.min(25, Math.max(1, Number(args.limit) || 15));
      const debtors = repos.debt
        .observeSummary()
        .get()
        .filter((d) => d.daysOverdue >= minDays)
        .sort((a, b) => b.outstandingAmount - a.outstandingAmount)
        .slice(0, limit);
      if (debtors.length === 0) {
        return JSON.stringify({ error: "Aucun débiteur pour ces critères — la feuille serait vide." });
      }
      const totalOutstanding = debtors.reduce((s, d) => s + d.outstandingAmount, 0);

      const artifact: DocumentArtifact = {
        kind: "document",
        format: "pdf",
        documentType: "debt_report",
        title: "Feuille de recouvrement",
        fileName: `recouvrement-${new Date().toISOString().slice(0, 10)}.pdf`,
        params: { minDaysOverdue: minDays, limit },
        rowCount: debtors.length,
        caption: `${debtors.length} débiteurs · ${totalOutstanding.toLocaleString("fr-FR")} DZD dus.`,
      };
      return withArtifact(
        {
          status: "document_ready",
          document_type: "debt_report",
          min_days_overdue: minDays,
          debtor_count: debtors.length,
          total_outstanding: totalOutstanding,
          message: "La feuille de recouvrement PDF est prête — cliquez sur Télécharger dans la conversation.",
        },
        artifact,
      );
    }

    /* ---------------- export_data ---------------- */
    case "export_data": {
      const dataset = String(args.dataset ?? "");
      const format = args.format === "csv" ? "csv" : "xlsx";
      const parentId = typeof args.parent_id === "string" ? args.parent_id : "";
      const classId = typeof args.class_id === "string" ? args.class_id : "";

      let columns: string[] = [];
      let rows: (string | number | null)[][] = [];
      let label = "";

      switch (dataset) {
        case "overdue_accounts": {
          const debtors = repos.debt.observeSummary().get();
          columns = ["Parent", "Téléphone", "Montant dû (DZD)", "Jours de retard", "Tranche d'ancienneté", "Enfants"];
          rows = debtors.map((d) => [
            d.parentName,
            d.parentPhone,
            d.outstandingAmount,
            d.daysOverdue,
            AGING_BUCKET_LABELS_FR[d.bucket] ?? d.bucket,
            d.studentCount,
          ]);
          label = "comptes-en-retard";
          break;
        }
        case "payments_by_parent": {
          if (!parentId) {
            return JSON.stringify({
              error: "Paramètre manquant : parent_id est obligatoire pour payments_by_parent.",
              hint: "Utilisez search_entities pour identifier le parent.",
            });
          }
          const parent = repos.parents.observeById(parentId).get();
          if (!parent) return JSON.stringify({ error: "Parent introuvable." });
          const payments = repos.payments
            .observeByParent(parentId)
            .get()
            .sort((a, b) => b.collectedAt.localeCompare(a.collectedAt));
          columns = ["Reçu", "Date", "Montant (DZD)", "Méthode", "Statut", "Catégorie", "Notes"];
          rows = payments.map((p) => [
            p.receiptNumber,
            p.collectedAt.slice(0, 10),
            p.amount,
            p.method,
            p.status,
            p.category,
            p.notes,
          ]);
          label = `paiements-${parent.code}`;
          break;
        }
        case "class_performance": {
          if (!classId) {
            return JSON.stringify({
              error: "Paramètre manquant : class_id est obligatoire pour class_performance.",
              hint: "Utilisez search_entities avec entity_type=class pour identifier la classe.",
            });
          }
          const cls = repos.classes.observeById(classId).get();
          if (!cls) return JSON.stringify({ error: "Classe introuvable." });
          const students = repos.students.observeByClass(classId).get();
          const subjects = repos.subjects.observe().get();
          columns = ["Élève", "Code", "Moyenne /20", "Statut", "Évaluations manquantes"];
          rows = students.map((s) => {
            const gpa = evaluateGpa(repos, s.id, subjects);
            return [
              studentDisplayName(s),
              s.code,
              gpa.gpa ?? "n/a",
              gpa.gpa === null ? "non évalué" : gpa.isPassing ? "admis" : "à risque",
              gpa.missing,
            ];
          });
          label = `performance-${cls.code}`;
          break;
        }
        case "revenue_12m": {
          const res = await repos.dashboard.revenueLast12Months();
          if (!res.ok) return JSON.stringify({ error: "Impossible de lire la série de revenus." });
          columns = ["Mois", "Revenu (DZD)"];
          rows = res.value.map((p) => [p.label, p.amount]);
          label = "revenus-12-mois";
          break;
        }
        case "enrollment_demographics": {
          const res = await repos.dashboard.demographics();
          if (!res.ok) return JSON.stringify({ error: "Impossible de lire la démographie." });
          columns = ["Catégorie", "Segment", "Effectif", "Pourcentage"];
          rows = [
            ...res.value.grade.map((s) => ["Niveau", s.label, s.count, s.percent]),
            ...res.value.gender.map((s) => ["Genre", s.label, s.count, s.percent]),
            ...res.value.age.map((s) => ["Âge", s.label, s.count, s.percent]),
            ...res.value.capacity.map((s) => ["Remplissage", s.label, s.count, s.percent]),
          ];
          label = "demographie";
          break;
        }
        default:
          return JSON.stringify({ error: `Jeu de données inconnu : ${dataset}` });
      }

      if (rows.length === 0) {
        return JSON.stringify({ error: "Aucune donnée à exporter pour ce jeu." });
      }
      const truncated = rows.length > MAX_EXPORT_ROWS;
      if (truncated) rows = rows.slice(0, MAX_EXPORT_ROWS);

      const artifact: DocumentArtifact = {
        kind: "document",
        format,
        documentType: "data_export",
        title: `Export — ${dataset}`,
        fileName: `${label}-${new Date().toISOString().slice(0, 10)}.${format}`,
        params: { dataset, format },
        columns,
        rows,
        rowCount: rows.length,
        truncated,
        caption: truncated
          ? `Export limité aux ${MAX_EXPORT_ROWS} premières lignes.`
          : `${rows.length} lignes · ${columns.length} colonnes.`,
      };

      return withArtifact(
        {
          status: "document_ready",
          document_type: "data_export",
          dataset,
          format,
          row_count: rows.length,
          truncated,
          message: `L'export ${format.toUpperCase()} est prêt — cliquez sur Télécharger dans la conversation.`,
        },
        artifact,
      );
    }

    default:
      return JSON.stringify({ error: `Outil documentaire inconnu : ${name}` });
  }
}

/** GPA helper (canonical engine) — used by the class_performance export. */
function evaluateGpa(repos: Repositories, studentId: string, subjects: readonly Subject[]) {
  const assessments = repos.grades.observeForStudent(studentId).get();
  const result = evaluateStudentTermPerformance(studentId, assessments, subjects);
  return { gpa: result.gpa, isPassing: result.isPassing, missing: result.missingAssessmentsCount };
}
