/**
 * ConnectionCard — Supabase connection editor (local storage).
 *
 * Extracted from `configuration-tab.tsx` (iteration 20) to keep the
 * main tab file under the size guideline. Behavior is unchanged.
 */
import {
  Plug, Save, RotateCcw, RefreshCw, ExternalLink,
  CheckCircle2, XCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../../shared/ui/card";
import { Button } from "../../../shared/ui/button";
import { Input } from "../../../shared/ui/input";
import { Label } from "../../../shared/ui/label";
import { Switch } from "../../../shared/ui/switch";
import { LoadingState } from "../../../shared/layout/state-views";
import type { LocalConfig } from "../../../infrastructure/system-config";
import type { ConnectionTestResult } from "./types";

export interface ConnectionCardProps {
  localConfig: LocalConfig;
  isLoading: boolean;
  isTesting: boolean;
  testResult: ConnectionTestResult | null;
  onConfigChange: (config: LocalConfig) => void;
  onTest: () => void;
  onSave: () => void;
  onReset: () => void;
}

export function ConnectionCard({
  localConfig,
  isLoading,
  isTesting,
  testResult,
  onConfigChange,
  onTest,
  onSave,
  onReset,
}: ConnectionCardProps) {
  if (isLoading) {
    return <LoadingState message="Chargement configuration..." />;
  }

  const useSupabaseFlag = localConfig.supabase_use_supabase ?? false;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Plug className="h-4 w-4 text-primary" />
          Connexion Supabase
        </CardTitle>
        <CardDescription>
          URL + clé publique (anon OU sb_publishable_) stockées localement (Electron userData). Nécessite un redémarrage pour appliquer.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ConnectionHelpBox />

        <div className="space-y-1.5">
          <Label htmlFor="supabase-url">URL Supabase</Label>
          <Input
            id="supabase-url"
            type="url"
            placeholder="https://xxxx.supabase.co"
            value={localConfig.supabase_url ?? ""}
            onChange={(e) => onConfigChange({ ...localConfig, supabase_url: e.target.value })}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="supabase-anon-key">Clé publique (anon public ou publishable)</Label>
          <Input
            id="supabase-anon-key"
            type="password"
            placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9... ou sb_publishable_..."
            value={localConfig.supabase_anon_key ?? ""}
            onChange={(e) => onConfigChange({ ...localConfig, supabase_anon_key: e.target.value })}
          />
          <p className="text-[11px] text-muted-foreground">
            Les deux formats sont acceptés (T-107/MIG-KEYS-201) : l'ancienne clé anon (JWT) et la nouvelle clé publishable (sb_publishable_…) — toutes deux protégées par RLS. Ne JAMAIS utiliser la clé service_role (ou sb_secret_) côté client.
          </p>
        </div>

        <UseSupabaseToggle
          checked={useSupabaseFlag}
          onChange={(checked) => onConfigChange({ ...localConfig, supabase_use_supabase: checked })}
        />

        {testResult && <ConnectionTestBadge result={testResult} />}

        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            variant="outline"
            size="sm"
            onClick={onTest}
            disabled={isTesting || !localConfig.supabase_url || !localConfig.supabase_anon_key}
          >
            {isTesting ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <Plug className="h-4 w-4 mr-2" />}
            Tester
          </Button>
          <Button
            size="sm"
            onClick={onSave}
            disabled={!localConfig.supabase_url || !localConfig.supabase_anon_key}
          >
            <Save className="h-4 w-4 mr-2" />
            Enregistrer &amp; Redémarrer
          </Button>
          <Button variant="ghost" size="sm" onClick={onReset} className="ml-auto">
            <RotateCcw className="h-4 w-4 mr-2" />
            Réinitialiser (mock)
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ConnectionHelpBox() {
  return (
    <div className="rounded-lg border border-status-info/30 bg-status-info/10 p-3 text-xs">
      <p className="font-medium text-status-info mb-1">Où trouver ces valeurs?</p>
      <p className="text-muted-foreground">
        Supabase Dashboard → Project Settings → API → Project URL + Project API keys (anon public, ou la nouvelle clé publishable)
      </p>
      <a
        href="https://supabase.com/dashboard"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-status-info hover:underline mt-1"
      >
        Ouvrir Supabase Dashboard <ExternalLink className="h-3 w-3" />
      </a>
    </div>
  );
}

function UseSupabaseToggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border p-3">
      <div className="space-y-0.5">
        <Label htmlFor="use-supabase" className="font-medium">Utiliser Supabase</Label>
        <p className="text-xs text-muted-foreground">
          Désactivé = mode mock (données en mémoire, réinitialisées au rechargement).
        </p>
      </div>
      <Switch id="use-supabase" checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function ConnectionTestBadge({ result }: { result: ConnectionTestResult }) {
  const ok = result.connected;
  return (
    <div className={`rounded-lg border p-3 text-sm ${
      ok
        ? "border-status-success/30 bg-status-success/10 text-status-success"
        : "border-status-danger/30 bg-status-danger/10 text-status-danger"
    }`}>
      <div className="flex items-center gap-2 font-medium mb-1">
        {ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
        {ok ? "Connexion réussie" : "Échec de connexion"}
      </div>
      <p className="text-xs text-muted-foreground">
        {ok ? `${result.tenantCount} tenant(s) trouvé(s)` : result.error}
      </p>
    </div>
  );
}
