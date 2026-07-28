/**
 * AIConfigTab — BYOK (Bring Your Own Key) settings UI.
 *
 * Replaces the previous stub in settings-page.tsx. Lets the SuperAdmin
 * configure Groq (primary) + OpenRouter (fallback) API keys, default
 * model, fallback model. Keys are AES-256-GCM encrypted before storage
 * (see ai-config-storage.ts) — the UI only ever sees the decrypted form
 * inside this tab; never elsewhere.
 *
 * RBAC: SuperAdmin only (Permission.ManageAIConfig). Other roles see an
 * "Access denied" card.
 *
 * Per plan §11.04 + §11.08: every save + every test writes an audit entry.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Bot,
  Eye,
  EyeOff,
  Loader2,
  ShieldCheck,
  Trash2,
  Zap,
  CheckCircle2,
} from "lucide-react";
import { useRepositories } from "../../infrastructure/repository-provider";
import { useAuth } from "../../state/auth-context";
import { useToast } from "../../state/toast-context";
import { useObservable } from "../../shared/hooks/use-observable";
import { Permission } from "../../core/rbac/permissions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../shared/ui/card";
import { Button } from "../../shared/ui/button";
import { Input } from "../../shared/ui/input";
import { Label } from "../../shared/ui/label";
import { Badge } from "../../shared/ui/badge";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "../../shared/ui/select";
import { FormField } from "../../shared/components/form-field";
import { AI_PROVIDER_LABELS_FR, type AIProvider } from "../../domain/model/ai";
import { clearConfig } from "../../infrastructure/ai/ai-config-storage";

export function AIConfigTab() {
  const { t } = useTranslation();
  const { session } = useAuth();
  const canManage = !!session && session.permissions.has(Permission.ManageAIConfig);

  if (!canManage) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
          <Bot className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium">Accès refusé</p>
          <p className="text-xs text-muted-foreground max-w-md">
            La configuration IA est réservée au Super Administrateur (plan §11.04).
          </p>
        </CardContent>
      </Card>
    );
  }

  return <AIConfigForm />;
}

function AIConfigForm() {
  const { t } = useTranslation();
  const repos = useRepositories();
  const toast = useToast();
  const { session } = useAuth();
  const config = useObservable(() => repos.aiConfig.observe(), []);

  // Local form state — initialized from the persisted config.
  const [groqKey, setGroqKey] = useState("");
  const [openRouterKey, setOpenRouterKey] = useState("");
  const [defaultProvider, setDefaultProvider] = useState<AIProvider>("groq");
  const [defaultModel, setDefaultModel] = useState("");
  const [fallbackModel, setFallbackModel] = useState("");
  const [showGroq, setShowGroq] = useState(false);
  const [showOpenRouter, setShowOpenRouter] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<AIProvider | null>(null);

  // Hydrate form when the persisted config loads.
  useEffect(() => {
    setGroqKey(config.groqApiKey ?? "");
    setOpenRouterKey(config.openRouterApiKey ?? "");
    setDefaultProvider(config.defaultProvider);
    setDefaultModel(config.defaultModel);
    setFallbackModel(config.fallbackModel ?? "");
  }, [config]);

  async function handleSave() {
    if (!session) return;
    setSaving(true);
    try {
      const result = await repos.aiConfig.updateConfig(
        {
          groqApiKey: groqKey.trim() || null,
          openRouterApiKey: openRouterKey.trim() || null,
          defaultProvider,
          defaultModel: defaultModel.trim(),
          fallbackModel: fallbackModel.trim() || null,
        },
        session.userId,
      );
      if (result.ok) {
        toast.showSuccess(t("ai.save"), t("toast.saved"));
      } else {
        toast.showError(t("toast.error"), result.error.userMessage);
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleClear() {
    if (!session) return;
    setSaving(true);
    try {
      clearConfig();
      setGroqKey("");
      setOpenRouterKey("");
      setDefaultModel("llama-3.3-70b-versatile");
      setFallbackModel("");
      setDefaultProvider("groq");
      // Refresh the observable so subscribers see the cleared state.
      await repos.aiConfig.updateConfig(
        {
          groqApiKey: null,
          openRouterApiKey: null,
          defaultProvider: "groq",
          defaultModel: "llama-3.3-70b-versatile",
          fallbackModel: null,
        },
        session.userId,
      );
      toast.showSuccess(t("ai.clear"), "Configuration effacée.");
    } finally {
      setSaving(false);
    }
  }

  async function handleTest(provider: AIProvider) {
    setTesting(provider);
    try {
      const result = await repos.aiConfig.testProvider(provider);
      if (result.ok && result.value.ok) {
        toast.showSuccess(
          t("ai.testOk"),
          `${AI_PROVIDER_LABELS_FR[provider]} — ${result.value.latencyMs}ms`,
        );
      } else {
        const errMsg = result.ok ? result.value.error ?? "Échec" : result.error.userMessage;
        toast.showError(t("toast.error"), errMsg);
      }
    } finally {
      setTesting(null);
    }
  }

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Bot className="h-4 w-4 text-primary" /> {t("ai.config")}
        </CardTitle>
        <CardDescription>
          BYOK (Bring Your Own Key) — Groq (principal) + OpenRouter (repli). Les clés sont
          chiffrées avant d'être stockées localement.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Encryption-at-rest info banner */}
        <div className="flex items-start gap-3 rounded-md border border-status-success/30 bg-status-success/5 p-3">
          <ShieldCheck className="h-4 w-4 text-status-success shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-status-success">Chiffrement au repos</p>
            <p className="text-xs text-muted-foreground mt-0.5">{t("ai.encryptionNote")}</p>
          </div>
        </div>

        {/* Groq API key */}
        <ProviderKeyField
          label={t("ai.groqKey")}
          placeholder="gsk_..."
          value={groqKey}
          onChange={setGroqKey}
          show={showGroq}
          onToggleShow={() => setShowGroq((v) => !v)}
          configured={!!config.groqApiKey}
          testing={testing === "groq"}
          onTest={() => handleTest("groq")}
          t={t}
          hint={
            <>
              Endpoint:{" "}
              <code className="font-mono text-[10px]">https://api.groq.com/openai/v1</code> —{" "}
              « Groq with a Q » (PAS xAI Grok).
            </>
          }
        />

        {/* OpenRouter API key */}
        <ProviderKeyField
          label={t("ai.openrouterKey")}
          placeholder="sk-or-..."
          value={openRouterKey}
          onChange={setOpenRouterKey}
          show={showOpenRouter}
          onToggleShow={() => setShowOpenRouter((v) => !v)}
          configured={!!config.openRouterApiKey}
          testing={testing === "openrouter"}
          onTest={() => handleTest("openrouter")}
          t={t}
          hint={
            <>Utilisé uniquement lorsque Groq retourne 429. Ne PAS envoyer le même prompt en parallèle.</>
          }
        />

        {/* Default provider */}
        <FormField label={t("ai.defaultProvider")}>
          <Select
            value={defaultProvider}
            onValueChange={(v) => setDefaultProvider(v as AIProvider)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="groq">{AI_PROVIDER_LABELS_FR.groq}</SelectItem>
              <SelectItem value="openrouter">{AI_PROVIDER_LABELS_FR.openrouter}</SelectItem>
            </SelectContent>
          </Select>
        </FormField>

        {/* Default model */}
        <FormField label={t("ai.defaultModel")} hint="Ex: llama-3.3-70b-versatile (Groq), anthropic/claude-3.5-sonnet (OpenRouter)">
          <Input
            value={defaultModel}
            onChange={(e) => setDefaultModel(e.target.value)}
            placeholder="llama-3.3-70b-versatile"
          />
        </FormField>

        {/* Fallback model */}
        <FormField label={t("ai.fallbackModel")}>
          <Input
            value={fallbackModel}
            onChange={(e) => setFallbackModel(e.target.value)}
            placeholder="mixtral-8x7b-32768"
          />
        </FormField>

        {/* Action buttons */}
        <div className="flex items-center gap-2 pt-2">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            {t("ai.save")}
          </Button>
          <Button variant="outline" onClick={handleClear} disabled={saving}>
            <Trash2 className="h-4 w-4" />
            {t("ai.clear")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Provider key field (Groq / OpenRouter share the same shape)        */
/* ------------------------------------------------------------------ */

function ProviderKeyField({
  label,
  placeholder,
  value,
  onChange,
  show,
  onToggleShow,
  configured,
  testing,
  onTest,
  t,
  hint,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  onToggleShow: () => void;
  configured: boolean;
  testing: boolean;
  onTest: () => void;
  t: (key: string) => string;
  hint?: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        {configured ? (
          <Badge variant="outline" className="text-[10px] text-status-success border-status-success/40 bg-status-success/5">
            {t("ai.configured")}
          </Badge>
        ) : (
          <Badge variant="outline" className="text-[10px] text-muted-foreground">
            {t("ai.notConfigured")}
          </Badge>
        )}
      </div>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Input
            type={show ? "text" : "password"}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            className="pr-9"
          />
          <button
            type="button"
            onClick={onToggleShow}
            className="absolute end-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            aria-label={show ? "Masquer" : "Afficher"}
          >
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        <Button variant="outline" size="default" onClick={onTest} disabled={testing}>
          {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
          {testing ? t("ai.testing") : t("ai.test")}
        </Button>
      </div>
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
