/**
 * AIConfigTab — BYOK (Bring Your Own Key) settings UI with LIVE model
 * discovery (T-260/T-261, 39th session — the Agentic AI Architecture).
 *
 * The admin pastes a Groq / OpenRouter / custom OpenAI-compatible key,
 * clicks "Découvrir les modèles" — the tab live-queries the provider's
 * `/models` endpoint (e.g. https://api.groq.com/openai/v1/models) and
 * populates the model selector (qwen/qwen3.8-27b,
 * llama-3.3-70b-versatile, …) with ZERO hardcoded model locks. Sampling
 * hyperparameters (temperature / top_p / max_tokens) configure the agent
 * runtime; the inference test measures real streaming latency.
 *
 * PRESERVED from the pre-existing tab (blueprint's un-gated variant
 * REJECTED per AGENTS.md §15.4 — never weaken security for a feature):
 *   - RBAC: SuperAdmin only (Permission.ManageAIConfig);
 *   - persistence through `repos.aiConfig.updateConfig` (audit entry per
 *     save, per plan §11.04 + §11.08);
 *   - AES-256-GCM encryption at rest (ai-config-storage.ts);
 *   - the clear/reset action.
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
  RefreshCw,
  Sliders,
} from "lucide-react";
import { useRepositories } from "../../app/providers/repository-provider";
import { useAuth } from "../../app/providers/auth-provider";
import { useToast } from "../../app/providers/toast-provider";
import { useAICopilot } from "../../app/providers/ai-copilot-provider";
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
import { FormField } from "../../shared/ui/form-field";
import {
  AI_PROVIDER_LABELS_FR,
  DEFAULT_AI_PROVIDER_CONFIG,
  type AIProvider,
  type AIProviderConfig,
  type AIModelInfo,
} from "../../domain/model/ai";
import { clearConfig } from "../../infrastructure/ai/ai-config-storage";
import { queryLiveProviderModels } from "../../core/ai/providers/provider-registry";
import { executeOpenAIStream } from "../../core/ai/streaming/stream-client";
import { resolveEndpoint } from "../../core/ai/providers/provider-registry";

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
          <p className="max-w-md text-xs text-muted-foreground">
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
  const { reloadConfig } = useAICopilot();
  const config = useObservable(() => repos.aiConfig.observe(), []);

  // Local form state — initialized from the persisted config.
  const [groqKey, setGroqKey] = useState("");
  const [openRouterKey, setOpenRouterKey] = useState("");
  const [customKey, setCustomKey] = useState("");
  const [customBaseUrl, setCustomBaseUrl] = useState("");
  const [defaultProvider, setDefaultProvider] = useState<AIProvider>("groq");
  const [defaultModel, setDefaultModel] = useState("");
  const [fallbackModel, setFallbackModel] = useState("");
  const [temperature, setTemperature] = useState(DEFAULT_AI_PROVIDER_CONFIG.temperature);
  const [topP, setTopP] = useState(DEFAULT_AI_PROVIDER_CONFIG.topP);
  const [maxTokens, setMaxTokens] = useState(DEFAULT_AI_PROVIDER_CONFIG.maxTokens);
  const [showGroq, setShowGroq] = useState(false);
  const [showOpenRouter, setShowOpenRouter] = useState(false);
  const [showCustom, setShowCustom] = useState(false);
  const [saving, setSaving] = useState(false);

  // T-260: live model discovery state.
  const [availableModels, setAvailableModels] = useState<AIModelInfo[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [testing, setTesting] = useState<AIProvider | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; latencyMs: number } | null>(null);

  // Hydrate form when the persisted config loads.
  useEffect(() => {
    setGroqKey(config.groqApiKey ?? "");
    setOpenRouterKey(config.openRouterApiKey ?? "");
    setCustomKey(config.customApiKey ?? "");
    setCustomBaseUrl(config.customBaseUrl ?? "");
    setDefaultProvider(config.defaultProvider);
    setDefaultModel(config.defaultModel);
    setFallbackModel(config.fallbackModel ?? "");
    setTemperature(config.temperature);
    setTopP(config.topP);
    setMaxTokens(config.maxTokens);
  }, [config]);

  const activeKeyFor = (provider: AIProvider): string => {
    switch (provider) {
      case "groq":
        return groqKey;
      case "openrouter":
        return openRouterKey;
      case "custom_openai":
        return customKey;
    }
  };

  /** T-260: live-query the provider's /models endpoint. */
  const fetchModelsForProvider = async (provider: AIProvider, key: string) => {
    if (!key && provider !== "custom_openai") return;
    setFetchingModels(true);
    try {
      const models = await queryLiveProviderModels(
        provider,
        key,
        provider === "custom_openai" ? customBaseUrl || undefined : undefined,
      );
      setAvailableModels(models);
      toast.showSuccess(
        t("ai.discoverModels"),
        `${models.length} ${t("ai.modelsFound")}.`,
      );
    } catch (err) {
      setAvailableModels([]);
      toast.showError(
        t("toast.error"),
        err instanceof Error ? err.message : "Impossible de lister les modèles du fournisseur.",
      );
    } finally {
      setFetchingModels(false);
    }
  };

  /** Hydrate the model list when the tab (re)mounts with a key already set. */
  useEffect(() => {
    if (config.defaultProvider && activeKeyFor(config.defaultProvider)) {
      void fetchModelsForProvider(config.defaultProvider, activeKeyFor(config.defaultProvider));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hydrate once on persisted-config load; re-running on every keystroke would spam the provider
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  /** T-260/T-261: streaming inference test — measures real SSE latency. */
  const handleTestInference = async () => {
    const key = activeKeyFor(defaultProvider);
    if (!key && defaultProvider !== "custom_openai") {
      toast.showWarning(t("ai.test"), "Veuillez saisir une clé API valide.");
      return;
    }
    setTesting(defaultProvider);
    setTestResult(null);
    const start = Date.now();
    try {
      const endpoint = resolveEndpoint(
        defaultProvider,
        defaultProvider === "custom_openai" ? customBaseUrl : null,
      );
      await executeOpenAIStream(
        endpoint.chatCompletionsUrl,
        endpoint.authHeader(key),
        {
          model: defaultModel || DEFAULT_AI_PROVIDER_CONFIG.defaultModel,
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 5,
        },
        {},
      );
      const latencyMs = Date.now() - start;
      setTestResult({ ok: true, latencyMs });
      toast.showSuccess(t("ai.inferenceOk"), `Latence de flux : ${latencyMs} ms.`);
    } catch (err) {
      setTestResult({ ok: false, latencyMs: Date.now() - start });
      toast.showError(t("toast.error"), err instanceof Error ? err.message : String(err));
    } finally {
      setTesting(null);
    }
  };

  async function handleSave() {
    if (!session) return;
    setSaving(true);
    try {
      const result = await repos.aiConfig.updateConfig(
        {
          groqApiKey: groqKey.trim() || null,
          openRouterApiKey: openRouterKey.trim() || null,
          customApiKey: customKey.trim() || null,
          customBaseUrl: customBaseUrl.trim() || null,
          defaultProvider,
          defaultModel: defaultModel.trim(),
          fallbackModel: fallbackModel.trim() || null,
          temperature,
          topP,
          maxTokens,
        },
        session.userId,
      );
      if (result.ok) {
        await reloadConfig();
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
      setCustomKey("");
      setCustomBaseUrl("");
      setDefaultModel(DEFAULT_AI_PROVIDER_CONFIG.defaultModel);
      setFallbackModel("");
      setDefaultProvider("groq");
      setTemperature(DEFAULT_AI_PROVIDER_CONFIG.temperature);
      setTopP(DEFAULT_AI_PROVIDER_CONFIG.topP);
      setMaxTokens(DEFAULT_AI_PROVIDER_CONFIG.maxTokens);
      setAvailableModels([]);
      // Refresh the observable so subscribers see the cleared state.
      await repos.aiConfig.updateConfig(
        {
          groqApiKey: null,
          openRouterApiKey: null,
          customApiKey: null,
          customBaseUrl: null,
          defaultProvider: "groq",
          defaultModel: DEFAULT_AI_PROVIDER_CONFIG.defaultModel,
          fallbackModel: null,
        },
        session.userId,
      );
      toast.showSuccess(t("ai.clear"), "Configuration effacée.");
    } finally {
      setSaving(false);
    }
  }

  const partialConfig: Omit<AIProviderConfig, "updatedAt" | "updatedBy"> = {
    groqApiKey: groqKey || null,
    openRouterApiKey: openRouterKey || null,
    customApiKey: customKey || null,
    customBaseUrl: customBaseUrl || null,
    defaultProvider,
    defaultModel,
    fallbackModel: fallbackModel || null,
    temperature,
    topP,
    maxTokens,
  };
  void partialConfig;

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Bot className="h-4 w-4 text-primary" /> {t("ai.config")} — BYOK
        </CardTitle>
        <CardDescription>
          Fournisseur modèle-agnostique : Groq (ultra-rapide, recommandé), OpenRouter
          (multi-modèles) ou tout serveur compatible OpenAI (Ollama, LM Studio…). Découverte
          des modèles en direct via l&apos;API du fournisseur. Les clés sont chiffrées
          (AES-256-GCM) avant d&apos;être stockées localement.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Encryption-at-rest info banner */}
        <div className="flex items-start gap-3 rounded-md border border-status-success/30 bg-status-success/5 p-3">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-status-success" />
          <div>
            <p className="text-sm font-medium text-status-success">Chiffrement au repos</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{t("ai.encryptionNote")}</p>
          </div>
        </div>

        {/* Provider + keys */}
        <FormField label={t("ai.defaultProvider")}>
          <Select
            value={defaultProvider}
            onValueChange={(v) => {
              const p = v as AIProvider;
              setDefaultProvider(p);
              setAvailableModels([]);
              setTestResult(null);
              const k =
                p === "groq" ? groqKey : p === "openrouter" ? openRouterKey : customKey;
              if (k || p === "custom_openai") {
                void fetchModelsForProvider(p, k);
              }
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(AI_PROVIDER_LABELS_FR) as AIProvider[]).map((id) => (
                <SelectItem key={id} value={id}>
                  {AI_PROVIDER_LABELS_FR[id]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>

        {defaultProvider === "groq" && (
          <ProviderKeyField
            label={t("ai.groqKey")}
            placeholder="gsk_..."
            value={groqKey}
            onChange={setGroqKey}
            show={showGroq}
            onToggleShow={() => setShowGroq((v) => !v)}
            configured={!!config.groqApiKey}
            discovering={fetchingModels}
            onDiscover={() => void fetchModelsForProvider("groq", groqKey)}
            t={t}
            hint={
              <>
                Endpoint :{" "}
                <code className="font-mono text-[10px]">
                  https://api.groq.com/openai/v1
                </code>{" "}
                — « Groq with a Q » (PAS xAI Grok). Clé gratuite sur console.groq.com.
              </>
            }
          />
        )}

        {defaultProvider === "openrouter" && (
          <ProviderKeyField
            label={t("ai.openrouterKey")}
            placeholder="sk-or-v1-..."
            value={openRouterKey}
            onChange={setOpenRouterKey}
            show={showOpenRouter}
            onToggleShow={() => setShowOpenRouter((v) => !v)}
            configured={!!config.openRouterApiKey}
            discovering={fetchingModels}
            onDiscover={() => void fetchModelsForProvider("openrouter", openRouterKey)}
            t={t}
            hint={<>Utilisé uniquement lorsque Groq retourne 429. Ne PAS envoyer le même prompt en parallèle.</>}
          />
        )}

        {defaultProvider === "custom_openai" && (
          <>
            <ProviderKeyField
              label={t("ai.customKey")}
              placeholder="facultatif (Ollama n'en demande pas)"
              value={customKey}
              onChange={setCustomKey}
              show={showCustom}
              onToggleShow={() => setShowCustom((v) => !v)}
              configured={!!config.customApiKey}
              discovering={fetchingModels}
              onDiscover={() => void fetchModelsForProvider("custom_openai", customKey)}
              t={t}
              hint={<>Ollama / LM Studio / vLLM — toute API compatible OpenAI.</>}
            />
            <FormField label={t("ai.customBaseUrl")} hint="ex: http://localhost:11434/v1">
              <Input
                value={customBaseUrl}
                onChange={(e) => setCustomBaseUrl(e.target.value)}
                placeholder="http://localhost:11434/v1"
                className="font-mono text-xs"
              />
            </FormField>
          </>
        )}

        {/* Model selection — live-discovered list or free input */}
        <div className="space-y-4 border-t pt-4">
          <FormField
            label={t("ai.defaultModel")}
            hint={
              availableModels.length > 0
                ? `${availableModels.length} ${t("ai.modelsFound")} — sélection dans la liste`
                : "Saisissez l'identifiant ou cliquez Découvrir avec une clé valide"
            }
          >
            {availableModels.length > 0 ? (
              <Select value={defaultModel} onValueChange={(m) => setDefaultModel(m)}>
                <SelectTrigger className="font-mono text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-64 font-mono text-xs">
                  {availableModels.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="flex gap-2">
                <Input
                  value={defaultModel}
                  onChange={(e) => setDefaultModel(e.target.value)}
                  placeholder="ex: qwen/qwen3.8-27b ou llama-3.3-70b-versatile"
                  className="font-mono text-xs"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void fetchModelsForProvider(defaultProvider, activeKeyFor(defaultProvider))}
                  disabled={fetchingModels}
                >
                  {fetchingModels ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                  <span className="ml-1.5 hidden text-xs sm:inline">{t("ai.discoverModels")}</span>
                </Button>
              </div>
            )}
          </FormField>

          <FormField label={t("ai.fallbackModel")} hint="Utilisé si le modèle principal retourne 429 / 503">
            <Input
              value={fallbackModel}
              onChange={(e) => setFallbackModel(e.target.value)}
              placeholder="ex: llama-3.3-70b-versatile"
              className="font-mono text-xs"
            />
          </FormField>
        </div>

        {/* Sampling hyperparameters (drive the agent runtime) */}
        <div className="space-y-3 border-t pt-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <Sliders className="h-4 w-4" /> {t("ai.sampling")}
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label className="text-xs">
                {t("ai.temperature")} ({temperature})
              </Label>
              <Input
                type="number"
                step="0.05"
                min="0"
                max="1.5"
                value={temperature}
                onChange={(e) => setTemperature(parseFloat(e.target.value) || 0.6)}
                className="mt-1 h-8 font-mono text-xs"
              />
            </div>
            <div>
              <Label className="text-xs">
                {t("ai.topP")} ({topP})
              </Label>
              <Input
                type="number"
                step="0.05"
                min="0.1"
                max="1"
                value={topP}
                onChange={(e) => setTopP(parseFloat(e.target.value) || 0.95)}
                className="mt-1 h-8 font-mono text-xs"
              />
            </div>
            <div>
              <Label className="text-xs">
                {t("ai.maxTokens")} ({maxTokens})
              </Label>
              <Input
                type="number"
                step="128"
                min="256"
                max="8192"
                value={maxTokens}
                onChange={(e) => setMaxTokens(parseInt(e.target.value, 10) || 2048)}
                className="mt-1 h-8 font-mono text-xs"
              />
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 pt-2">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            {t("ai.save")}
          </Button>
          <Button
            variant="outline"
            onClick={() => void handleTestInference()}
            disabled={testing !== null}
          >
            {testing !== null ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Zap className="h-4 w-4 text-status-warning" />
            )}
            {t("ai.inferenceTest")}
          </Button>
          <Button variant="outline" onClick={handleClear} disabled={saving}>
            <Trash2 className="h-4 w-4" />
            {t("ai.clear")}
          </Button>
          {testResult && (
            <Badge
              variant="outline"
              className={
                testResult.ok
                  ? "border-status-success/40 bg-status-success/5 text-[10px] text-status-success"
                  : "border-status-danger/40 bg-status-danger/5 text-[10px] text-status-danger"
              }
            >
              {testResult.ok ? `OK · ${testResult.latencyMs} ms` : `Échec · ${testResult.latencyMs} ms`}
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Provider key field (Groq / OpenRouter / custom share the shape)    */
/* ------------------------------------------------------------------ */

function ProviderKeyField({
  label,
  placeholder,
  value,
  onChange,
  show,
  onToggleShow,
  configured,
  discovering,
  onDiscover,
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
  discovering: boolean;
  onDiscover: () => void;
  t: (key: string) => string;
  hint?: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        {configured ? (
          <Badge
            variant="outline"
            className="border-status-success/40 bg-status-success/5 text-[10px] text-status-success"
          >
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
            className="pr-9 font-mono text-xs"
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
        <Button variant="outline" onClick={onDiscover} disabled={discovering}>
          {discovering ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          <span className="ml-1.5 hidden text-xs sm:inline">{t("ai.discoverModels")}</span>
        </Button>
      </div>
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
