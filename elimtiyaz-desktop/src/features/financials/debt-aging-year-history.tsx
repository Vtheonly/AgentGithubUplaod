/**
 * FamilyYearHistoryPanel — T-442 (UI-323): the Debt Aging drawer's
 * « Par année » tab content.
 *
 * The owner's mandate: "if a student has an outstanding balance from 2024,
 * I should be able to open the 2024 record and see exactly what they owed
 * in 2024, what they paid during that year, what services they had
 * selected, and what remains unpaid. The same should be available
 * separately for 2025, 2026, etc." — reachable from the DEBT surface
 * itself, not only from the CRM drawer.
 *
 * REUSE, never a second implementation (§6/§15.53a): this component mounts
 * the SAME `ParentYearHistorySection` the CRM parent drawer's Finances tab
 * renders, fed by the SAME canonical repository streams
 * (`repos.installments.observeByParent`, `repos.payments.observeByParent`,
 * `repos.payments.observeAllocations`, `repos.ledger.observeByParent`,
 * `repos.academicYears.observeAll`, `repos.pricing.listConfigs`) — one
 * engine, one rendering component, two surfaces. It computes NOTHING.
 *
 * The T-430 conditional-mount rule: the drawer renders only the ACTIVE
 * tab's content, so these observables subscribe only when the « Par année »
 * tab is selected — never eagerly on the drawer's open.
 */
import { useEffect, useMemo, useState } from "react";
import { useRepositories } from "../../app/providers/repository-provider";
import { useObservable } from "../../shared/hooks/use-observable";
import { ParentYearHistorySection } from "../crm/parent-year-history-section";
import type { PricingConfigSummary } from "../../domain/model/pricing";

export function FamilyYearHistoryPanel({
  parentId,
  parentName,
}: {
  readonly parentId: string;
  /** T-466 (DEBT-102): the family's display name — passed through to the
   *  section's manual-debt modal (the aging row already holds it). */
  readonly parentName?: string;
}) {
  const repos = useRepositories();

  // T-469 (DEBT-103): the tenant ACTIVE risk configuration - the per-year
  // amount band derives from it (the SAME config the aging tab statuses
  // use; the panel mounts only on tab selection - the T-430 rule).
  const debtThresholds = useObservable(() => repos.debt.observeThresholds(), []);
  const installments = useObservable(() => repos.installments.observeByParent(parentId), [parentId]);
  const payments = useObservable(() => repos.payments.observeByParent(parentId), [parentId]);
  // T-436's optional-method pattern: fakes (and Android mirrors) without
  // the allocations stream get a constant-empty one — the year-history
  // engine's honest paid-date-heuristic basis, never a fabricated
  // coverage.
  const allocations = useObservable(
    () =>
      repos.payments.observeAllocations?.() ?? {
        subscribe: () => () => undefined,
        get: () => [],
      },
    [],
  );
  const ledgerEntries = useObservable(() => repos.ledger.observeByParent(parentId), [parentId]);
  const academicYears = useObservable(() => repos.academicYears.observeAll(), []);

  // The per-year pricing configurations (ADR-025's listConfigs — the same
  // one-fetch pattern the CRM drawer applies; a failure renders no config
  // references, never a fabricated one).
  const [yearPricingConfigs, setYearPricingConfigs] = useState<readonly PricingConfigSummary[]>([]);
  useEffect(() => {
    let cancelled = false;
    repos.pricing
      .listConfigs()
      .then((result) => {
        if (!cancelled && result.ok) setYearPricingConfigs(result.value);
      })
      .catch(() => {
        /* honest degradation: no config references */
      });
    return () => {
      cancelled = true;
    };
  }, [repos.pricing]);

  return (
    <ParentYearHistorySection
      parentId={parentId}
      parentName={parentName}
      debtThresholds={debtThresholds}
      installments={installments}
      payments={payments}
      allocations={allocations}
      ledgerEntries={ledgerEntries}
      academicYears={academicYears}
      pricingConfigs={useMemo(
        () => new Map(yearPricingConfigs.map((c) => [c.academicYearCode, c])),
        [yearPricingConfigs],
      )}
    />
  );
}
