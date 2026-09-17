// ============================================================================
// FILE: elimtiyaz-desktop/src/features/dashboard/components/analytics/data-inspector.tsx
// ============================================================================
// Public compatibility surface for the dashboard data inspector.
// The implementation lives in data-inspector-core.tsx so the compact trigger
// can present the exact metric/source it will inspect instead of a generic label.

import { Search } from "lucide-react";
import { useDataInspector } from "./data-inspector-core";
import type { InspectRequest } from "./data-inspector-core";

export {
  DataInspectorProvider,
  useDataInspector,
  inspectRequestForKpi,
  EMPTY_INSPECTOR_FILTERS,
} from "./data-inspector-core";

export type {
  InspectorDomain,
  InspectRequest,
  LineageContributor,
  LineageRecord,
  ResolvedInspection,
} from "./data-inspector-core";

export function InspectTrigger({
  request,
  label,
  compact = true,
}: {
  request: InspectRequest;
  label?: string;
  compact?: boolean;
}) {
  const { inspectData } = useDataInspector();
  const visibleLabel = label ?? `Inspecter · ${request.title}`;

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        inspectData(request);
      }}
      className={`inline-flex items-center gap-1.5 rounded-md border border-primary/25 bg-primary/5 px-2 py-1 text-[10px] font-semibold text-primary transition-colors hover:bg-primary/10 ${compact ? "" : "px-2.5 py-1.5"}`}
      title={`Inspecter : ${request.title}`}
      aria-label={`Inspecter : ${request.title}`}
    >
      <Search className="h-3 w-3" />
      {visibleLabel}
    </button>
  );
}
