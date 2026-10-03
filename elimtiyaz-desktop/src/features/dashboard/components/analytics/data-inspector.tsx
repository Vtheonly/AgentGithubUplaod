// ============================================================================
// FILE: elimtiyaz-desktop/src/features/dashboard/components/analytics/data-inspector.tsx
// ============================================================================
// Public compatibility surface for the dashboard data inspector.
// The implementation lives in data-inspector-core.tsx so the compact trigger
// can present the exact metric/source it will inspect instead of a generic label.
//
// T-475 — the compat InspectTrigger DELEGATES to the core component: exactly
// ONE styling implementation exists (the canonical inspection-button design
// lives in data-inspector-core.tsx; this surface keeps only its label
// semantics — « Inspecter · {title} » — and its accessibility attributes).

import {
  InspectTrigger as CoreInspectTrigger,
  DataInspectorProvider,
  useDataInspector,
  inspectRequestForKpi,
  EMPTY_INSPECTOR_FILTERS,
} from "./data-inspector-core";
import type { InspectRequest } from "./data-inspector-core";

export {
  DataInspectorProvider,
  useDataInspector,
  inspectRequestForKpi,
  EMPTY_INSPECTOR_FILTERS,
  INSPECT_TRIGGER_CLASS,
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
  disabled = false,
}: {
  request: InspectRequest;
  label?: string;
  compact?: boolean;
  disabled?: boolean;
}) {
  const visibleLabel = label ?? `Inspecter · ${request.title}`;
  return (
    <CoreInspectTrigger
      request={request}
      label={visibleLabel}
      compact={compact}
      disabled={disabled}
      title={`Inspecter : ${request.title}`}
    />
  );
}
