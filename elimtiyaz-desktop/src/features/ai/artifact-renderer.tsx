// ============================================================================
// FILE: elimtiyaz-desktop/src/features/ai/artifact-renderer.tsx
// ============================================================================
/**
 * Artifact presentation layer (T-272, 42nd session — AI-311a).
 *
 * Renders ONE validated tool artifact inside the copilot drawer:
 *   - chart    → <ChartSvg/> in a titled card
 *   - diagram  → <DiagramSvg/> in a titled card
 *   - document → a document card with a real DOWNLOAD button
 *
 * Documents never carried their bytes through the conversation (ADR-016
 * §3): the download button calls the copilot context's
 * `downloadArtifact(artifact)`, whose provider-side implementation
 * refetches canonical data and builds the PDF/XLSX/CSV through the
 * SAME generators the app's export buttons use.
 *
 * The renderer is DUMB on purpose: it receives a pre-validated
 * artifact (parseToolArtifact already ran the schema gate) and a
 * download callback. No repository access, no parsing (§15.5 — the
 * drawer never touches repositories directly).
 */
import React, { useState } from "react";
import { BarChart3, Network, FileText, Download, Loader2 } from "lucide-react";
import type { ToolArtifact, DocumentArtifact } from "../../core/ai/artifacts";
import { ChartSvg } from "./chart-svg";
import { DiagramSvg } from "./diagram-svg";

export interface ArtifactRendererProps {
  artifact: ToolArtifact;
  onDownload: (artifact: DocumentArtifact) => Promise<void>;
}

export function ArtifactRenderer({ artifact, onDownload }: ArtifactRendererProps) {
  switch (artifact.kind) {
    case "chart":
      return (
        <div className="w-full max-w-[96%] space-y-2 rounded-lg border border-border/60 bg-surface-elevated p-3 shadow-sm">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-3.5 w-3.5 shrink-0 text-primary" />
            <span className="truncate text-xs font-semibold text-foreground">{artifact.title}</span>
          </div>
          <ChartSvg chart={artifact} />
          {artifact.caption && (
            <p className="break-words text-[10.5px] leading-relaxed text-muted-foreground">{artifact.caption}</p>
          )}
        </div>
      );
    case "diagram":
      return (
        <div className="w-full max-w-[96%] space-y-2 rounded-lg border border-border/60 bg-surface-elevated p-3 shadow-sm">
          <div className="flex items-center gap-2">
            <Network className="h-3.5 w-3.5 shrink-0 text-primary" />
            <span className="truncate text-xs font-semibold text-foreground">{artifact.title}</span>
          </div>
          <DiagramSvg diagram={artifact} />
          {artifact.caption && (
            <p className="break-words text-[10.5px] leading-relaxed text-muted-foreground">{artifact.caption}</p>
          )}
        </div>
      );
    case "document":
      return <DocumentCard artifact={artifact} onDownload={onDownload} />;
    default:
      return null; // exhaustive union — unreachable
  }
}

/* ------------------------------------------------------------------ */
/*  Document card                                                      */
/* ------------------------------------------------------------------ */

function DocumentCard({ artifact, onDownload }: { artifact: DocumentArtifact; onDownload: (a: DocumentArtifact) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDownload = async () => {
    setBusy(true);
    setError(null);
    try {
      await onDownload(artifact);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const formatLabel =
    artifact.format === "pdf" ? "PDF" : artifact.format === "xlsx" ? "Excel" : "CSV";
  const icon = artifact.format === "pdf" ? <FileText className="h-4 w-4" /> : <Download className="h-4 w-4" />;

  return (
    <div className="w-full max-w-[96%] space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
            {icon}
          </div>
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-foreground">{artifact.title}</p>
            <p className="truncate font-mono text-[10px] text-muted-foreground">
              {artifact.fileName} · {formatLabel}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void handleDownload()}
          disabled={busy}
          className="flex shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[11px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          {busy ? "Génération…" : "Télécharger"}
        </button>
      </div>
      <div className="space-y-0.5">
        {artifact.caption && <p className="break-words text-[10.5px] text-muted-foreground">{artifact.caption}</p>}
        {artifact.rowCount !== undefined && artifact.rowCount > 0 && (
          <p className="text-[10.5px] text-muted-foreground">
            {artifact.rowCount.toLocaleString("fr-FR")}
            {artifact.rowCount === 1 ? " ligne" : " lignes"}
            {artifact.truncated ? " (export tronqué à 500)" : ""}
          </p>
        )}
        {artifact.columns && artifact.columns.length > 0 && (
          <p className="truncate font-mono text-[9.5px] text-muted-foreground/70">
            {artifact.columns.slice(0, 6).join(" · ")}
            {artifact.columns.length > 6 ? ` · +${artifact.columns.length - 6}` : ""}
          </p>
        )}
      </div>
      {error && (
        <p className="break-words rounded bg-status-danger/10 px-2 py-1 text-[10.5px] text-status-danger">{error}</p>
      )}
    </div>
  );
}
