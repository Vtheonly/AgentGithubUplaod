// ============================================================================
// FILE: src/features/settings/supabase-diagnostics/supabase-diagnostics-tab.tsx
// ============================================================================
/**
 * T-393 — the deterministic Supabase diagnostics screen (handed-over Task 21).
 *
 * Self-contained module: this tab renders the PASS / FAIL / NON TESTÉ matrix
 * produced by the deterministic runner (diagnostics-runner.ts), plus the
 * OPS-317 seed-degradation records (getSeedDiagnostics) that explain WHY the
 * lists can be empty without a single visible error.
 *
 * Design constraints (from the task registry):
 *   - reuses the canonical singleton getSupabaseClient() — no second client;
 *   - SAFE details only (HTTP status + codes + tables + counts — never keys
 *     or tokens; a banner states this explicitly);
 *   - French labels live IN THIS MODULE (the concurrent T-388 i18n burn-down
 *     owns the dictionary files — this module must not touch them);
 *   - injectable runner/client seams so the unit tests stay hermetic.
 */
import { useCallback, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  Activity,
  CheckCircle2,
  XCircle,
  HelpCircle,
  ClipboardCopy,
  ShieldCheck,
  AlertTriangle,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../shared/ui/card";
import { Button } from "../../../shared/ui/button";
import { Badge } from "../../../shared/ui/badge";
import { useAuth } from "../../../app/providers/auth-provider";
import { getSupabaseClient, isSupabaseConfigured } from "../../../infrastructure/supabase/supabase-client";
import { getSeedDiagnostics } from "../../../infrastructure/supabase/repositories/supabase-shared-repositories";
import { runSupabaseDiagnostics } from "./diagnostics-runner";
import { formatDiagnosticsReportText } from "./diagnostics-runner";
import type { DiagnosticsReport, DiagnosticsRunOptions } from "./diagnostics-types";
import { STATUS_LABELS, type CheckStatus } from "./diagnostics-types";

/* ------------------------------------------------------------------ */
/* Injectable seams (defaults = the canonical implementations)         */
/* ------------------------------------------------------------------ */

interface SupabaseDiagnosticsTabProps {
  /** Test seam: inject a fake runner. Default: the real deterministic runner. */
  runDiagnostics?: (opts: DiagnosticsRunOptions) => Promise<DiagnosticsReport>;
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
/* Status rendering                                                    */
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

export function SupabaseDiagnosticsTab({
  runDiagnostics = runSupabaseDiagnostics,
  getClient = defaultGetClient,
}: SupabaseDiagnosticsTabProps) {
  const { session } = useAuth();
  const [report, setReport] = useState<DiagnosticsReport | null>(null);
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
      const result = await runDiagnostics({ client, domainSession });
      setReport(result);
    } catch (err) {
      // The runner itself is defensive; this catch only covers a broken seam.
      setError(
        err instanceof Error ? `Erreur du diagnostic : ${err.message.slice(0, 200)}` : "Erreur du diagnostic inconnue.",
      );
    } finally {
      setIsRunning(false);
    }
  }, [getClient, runDiagnostics, domainSession]);

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

  // The OPS-317 seed-degradation records (read on every render — cheap array).
  const seedDiagnostics = getSeedDiagnostics();

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
            <Activity className="h-5 w-5" />
            Diagnostic Supabase
          </CardTitle>
          <CardDescription>
            Vérification déterministe, couche par couche : configuration, réseau,
            authentification, résolution du tenant, RLS, RPC, stockage et temps réel.
            Chaque sonde affiche PASS, FAIL ou NON TESTÉ avec le statut HTTP et le
            code d'erreur exact.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Button onClick={handleRun} disabled={isRunning}>
              {isRunning ? "Diagnostic en cours…" : "Lancer le diagnostic"}
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
            Aucune clé, jeton ou secret n'est collecté ni affiché par ce diagnostic.
          </div>

          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {report && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="success">{report.summary.pass} PASS</Badge>
                <Badge variant={report.summary.fail > 0 ? "danger" : "neutral"}>
                  {report.summary.fail} FAIL
                </Badge>
                <Badge variant="neutral">{report.summary.notTested} NON TESTÉ</Badge>
                <span className="text-xs text-muted-foreground">
                  Exécuté le {new Date(report.ranAt).toLocaleString("fr-FR")}
                </span>
              </div>

              {report.summary.fail > 0 && (
                <div className="rounded-md border border-status-warning/40 bg-status-warning/10 p-3 text-sm flex gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>
                    Des contrôles échouent. Si « Session Supabase » est FAIL alors que
                    vous êtes connecté, c'est la signature AUTH-302 : les listes
                    apparaissent vides sans erreur. Déconnectez-vous puis reconnectez-vous.
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

      {/* OPS-317 — the seed-degradation records */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5" />
            Derniers échecs de chargement (listes vides)
          </CardTitle>
          <CardDescription>
            Les erreurs des chargements de listes (parents, élèves…). Une liste vide
            SANS entrée ici est une base réellement vide ; une entrée explique pourquoi
            la liste s'est dégradée (authentification, réseau ou RLS) — la cause est
            enregistrée depuis le correctif AUTH-302/OPS-317.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {seedDiagnostics.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Aucun échec de chargement enregistré (20 derniers conservés).
            </p>
          ) : (
            <div className="divide-y rounded-lg border">
              {seedDiagnostics
                .slice()
                .reverse()
                .map((d, index) => (
                  <div key={`${d.source}-${d.at}-${index}`} className="px-4 py-2.5 text-sm">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="font-medium">{d.source}</span>
                      <Badge variant={d.networkClass ? "warning" : "danger"}>{d.code}</Badge>
                      <span className="text-xs text-muted-foreground">
                        {new Date(d.at).toLocaleString("fr-FR")}
                        {d.networkClass ? " — classe réseau" : ""}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground break-words mt-0.5">
                      {d.message}
                    </p>
                  </div>
                ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
