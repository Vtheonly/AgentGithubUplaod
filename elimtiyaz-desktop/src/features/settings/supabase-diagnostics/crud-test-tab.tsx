// ============================================================================
// FILE: src/features/settings/supabase-diagnostics/crud-test-tab.tsx
// ============================================================================
/**
 * T-396 / OPS-320 — the backend CRUD integration test tab (the owner's
 * 2026-09-21 mandate: a Settings section to "test the entire CRUD flow ...
 * clearly see whether each operation succeeds or fails, including the actual
 * error when something goes wrong").
 *
 * Self-contained module (the T-393 conventions):
 *   - renders the PASS / FAIL / NON TESTÉ matrix of the deterministic CRUD
 *     runner (crud-test-runner.ts) — grouped by phase, with per-check
 *     durations and the EXACT error text (HTTP status + error code);
 *   - a transparency banner: this suite WRITES probe rows (run-unique codes)
 *     then removes them through the canonical soft-delete RPCs — nothing
 *     touches real families (§15.38), and the audit trail keeps the honest
 *     record (§15.26);
 *   - the safe clipboard export reuses formatDiagnosticsReportText (never
 *     keys, tokens, or JWTs);
 *   - French labels live IN THIS MODULE (the concurrent T-388 i18n burn-down
 *     owns the dictionary files);
 *   - injectable runner/client seams so the unit tests stay hermetic.
 */
import { useCallback, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  FlaskConical,
  CheckCircle2,
  XCircle,
  HelpCircle,
  ClipboardCopy,
  ShieldCheck,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../shared/ui/card";
import { Button } from "../../../shared/ui/button";
import { Badge } from "../../../shared/ui/badge";
import { useAuth } from "../../../app/providers/auth-provider";
import { getSupabaseClient, isSupabaseConfigured } from "../../../infrastructure/supabase/supabase-client";
import { runCrudIntegrationTests } from "./crud-test-runner";
import { formatDiagnosticsReportText } from "./diagnostics-runner";
import type { DiagnosticsReport, DiagnosticsRunOptions } from "./diagnostics-types";
import { STATUS_LABELS, type CheckStatus } from "./diagnostics-types";

/** The runner's report shape (probe identity included). */
type CrudReport = DiagnosticsReport & { probe?: { runStamp: string } };

/* ------------------------------------------------------------------ */
/* Injectable seams (defaults = the canonical implementations)         */
/* ------------------------------------------------------------------ */

interface CrudTestTabProps {
  /** Test seam: inject a fake runner. Default: the real CRUD suite. */
  runTests?: (opts: DiagnosticsRunOptions) => Promise<CrudReport>;
  /** Test seam: inject a mock client factory. Default: the canonical singleton. */
  getClient?: () => SupabaseClient | null;
}

function defaultGetClient(): SupabaseClient | null {
  try {
    return isSupabaseConfigured() ? getSupabaseClient() : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Status rendering (mirrors the T-393 tab)                            */
/* ------------------------------------------------------------------ */

const STATUS_VARIANT: Record<CheckStatus, "success" | "danger" | "neutral"> = {
  pass: "success",
  fail: "danger",
  not_tested: "neutral",
};

function StatusIcon({ status }: { status: CheckStatus }) {
  if (status === "pass") return <CheckCircle2 className="h-4 w-4 shrink-0" />;
  if (status === "fail") return <XCircle className="h-4 w-4 shrink-0" />;
  return <HelpCircle className="h-4 w-4 shrink-0" />;
}

const STATUS_ICON_COLOR: Record<CheckStatus, string> = {
  pass: "text-status-success",
  fail: "text-status-danger",
  not_tested: "text-status-neutral",
};

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function CrudTestTab({
  runTests = runCrudIntegrationTests as (opts: DiagnosticsRunOptions) => Promise<CrudReport>,
  getClient = defaultGetClient,
}: CrudTestTabProps) {
  const { session } = useAuth();
  const [report, setReport] = useState<CrudReport | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const domainSession = useMemo(
    () => (session ? { userId: session.userId, email: session.email } : null),
    [session],
  );

  const handleRun = useCallback(async () => {
    setIsRunning(true);
    setError(null);
    setCopied(false);
    try {
      const client = getClient();
      const result = await runTests({ client, domainSession });
      setReport(result);
    } catch (err) {
      // The runner is defensive; this catch only covers a broken seam.
      setError(
        err instanceof Error
          ? `Erreur de la suite CRUD : ${err.message.slice(0, 200)}`
          : "Erreur de la suite CRUD inconnue.",
      );
    } finally {
      setIsRunning(false);
    }
  }, [getClient, runTests, domainSession]);

  const handleCopy = useCallback(async () => {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(formatDiagnosticsReportText(report));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  }, [report]);

  // Group checks by category preserving the deterministic order.
  const grouped = useMemo(() => {
    if (!report) return [] as Array<{ category: string; checks: DiagnosticsReport["checks"] }>;
    const order: string[] = [];
    const map = new Map<string, DiagnosticsReport["checks"]>();
    for (const c of report.checks) {
      if (!map.has(c.category)) {
        map.set(c.category, []);
        order.push(c.category);
      }
      map.get(c.category)!.push(c);
    }
    return order.map((category) => ({ category, checks: map.get(category)! }));
  }, [report]);

  return (
    <div className="space-y-6 max-w-4xl">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FlaskConical className="h-5 w-5" />
            Tests d'intégration CRUD (backend)
          </CardTitle>
          <CardDescription>
            Suite déterministe bout-en-bout : création de parents et d'élèves, mises à jour,
            lectures, import groupé, relations, gestion des erreurs de validation et de serveur,
            suppressions — chaque opération est vérifiée en base après exécution, avec le statut
            PASS / FAIL et l'erreur réelle quand quelque chose échoue.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md border border-status-warning/40 bg-status-warning/10 p-3 text-sm flex gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>
              Ce test <strong>écrit dans la base</strong> : il crée une famille sonde aux codes
              uniques (PAR-PROBE-T396-…), la modifie, lui rattache des écritures, puis la supprime
              par suppression logique. <strong>Aucune famille réelle n'est touchée.</strong> Les
              lignes du journal d'audit restent comme trace honnête de l'exécution.
            </span>
          </div>

          <div className="flex items-center gap-3">
            <Button onClick={handleRun} disabled={isRunning}>
              {isRunning ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Tests en cours…
                </>
              ) : (
                "Lancer la suite CRUD complète"
              )}
            </Button>
            {report && !isRunning && (
              <Button variant="outline" onClick={handleCopy}>
                <ClipboardCopy className="h-4 w-4" />
                {copied ? "Rapport copié" : "Copier le rapport"}
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5" />
            Aucune clé, jeton ou secret n'est collecté ni affiché par cette suite.
          </div>

          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {report && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={report.summary.fail > 0 ? "danger" : "success"}>
                  {report.summary.fail === 0 ? "TOUT EST FONCTIONNEL" : "DES TESTS ÉCHOUENT"}
                </Badge>
                <Badge variant="success">{report.summary.pass} PASS</Badge>
                <Badge variant={report.summary.fail > 0 ? "danger" : "neutral"}>
                  {report.summary.fail} FAIL
                </Badge>
                <Badge variant="neutral">{report.summary.notTested} NON TESTÉ</Badge>
                <span className="text-xs text-muted-foreground">
                  Exécuté le {new Date(report.ranAt).toLocaleString("fr-FR")}
                  {report.probe ? ` — sonde ${report.probe.runStamp}` : ""}
                </span>
              </div>

              {report.summary.fail > 0 && (
                <div className="rounded-md border border-status-warning/40 bg-status-warning/10 p-3 text-sm flex gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>
                    Des opérations échouent : lisez le détail de chaque ligne FAIL — il contient
                    l'erreur réelle (statut HTTP + code d'erreur) telle que le backend l'a renvoyée.
                    Si « Session Supabase » échoue alors que vous êtes connecté, reconnectez-vous
                    d'abord (signature AUTH-302).
                  </span>
                </div>
              )}

              <div className="space-y-4">
                {grouped.map((group) => (
                  <div key={group.category} className="rounded-lg border">
                    <div className="px-4 py-2 border-b bg-muted/40 text-sm font-semibold">
                      {group.category}
                    </div>
                    <div className="divide-y">
                      {group.checks.map((c) => (
                        <div key={`${c.category}-${c.id}`} className="flex items-start gap-3 px-4 py-2.5">
                          <span className={`${STATUS_ICON_COLOR[c.status]} mt-0.5`}>
                            <StatusIcon status={c.status} />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-baseline gap-2">
                              <span className="text-sm font-medium">{c.label}</span>
                              <Badge variant={STATUS_VARIANT[c.status]}>
                                {STATUS_LABELS[c.status]}
                              </Badge>
                              {c.durationMs !== null && (
                                <span className="text-xs text-muted-foreground">
                                  {c.durationMs} ms
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground break-words mt-0.5">
                              {c.detail}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
