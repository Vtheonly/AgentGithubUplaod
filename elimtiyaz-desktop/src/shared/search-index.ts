/**
 * Search index — iteration 8 (P3-R + SEC-120).
 *
 * Extends the Cmd+K command palette to query 6 entity types instead of
 * just parents + students. Provides a uniform `SearchResult` shape so the
 * palette UI can render results from any index identically.
 *
 * Indexes:
 *   1. Parents     — by name, code, phone, email
 *   2. Students    — by name, code
 *   3. Payments    — by receipt number, parent name
 *   4. Expenses    — by request code, vendor, submitter
 *   5. Audit       — by entity ID, action type, actor name
 *   6. Personnel   — by name, role, category
 *
 * T-542 (SEC-120, 180th session) — the index is PERMISSION-AWARE: every
 * result type maps to the permission of the section it references
 * (SEARCH_TYPE_PERMISSIONS), and an unpermitted type is NEVER QUERIED —
 * the repository call itself is skipped, not a post-filter on its results.
 * The owner's live report: a restricted worker typed a name and the palette
 * disclosed parents, students, payment amounts/receipt numbers, expenses,
 * audit entries and personnel — the leak is the disclosure in the result
 * list, not the navigation. Server-side RLS already narrows the ROWS for
 * Supabase sessions; this closes the client disclosure layer (and the
 * mock-mode default where the full demo dataset leaks every entity type).
 *
 * Recent searches are persisted to localStorage (max 8 items, FIFO).
 */
import type { Repositories } from "../app/providers/repository-provider";
import { parentDisplayName } from "../domain/model/parent";
import { Permission } from "../core/rbac/permissions";
import { can } from "../core/rbac/session";
import type { Session } from "../core/rbac/session";

export type SearchResultType =
  | "parent"
  | "student"
  | "payment"
  | "expense"
  | "audit"
  | "personnel";

/**
 * T-542 / SEC-120 — the permission each search result type requires: the
 * permission of the SECTION the result navigates to (the feature-registry
 * requirements — ViewRoster for the CRM roster, ViewFinancials for the
 * Finances payments/expenses, ViewAuditLog for the settings audit log,
 * ViewPersonnel for the personnel directory). Reuses the canonical
 * `can(session, permission)` predicate — no parallel permission model.
 */
export const SEARCH_TYPE_PERMISSIONS: Record<SearchResultType, Permission> = {
  parent: Permission.ViewRoster,
  student: Permission.ViewRoster,
  payment: Permission.ViewFinancials,
  expense: Permission.ViewFinancials,
  audit: Permission.ViewAuditLog,
  personnel: Permission.ViewPersonnel,
};

/**
 * T-542: the result types THIS session may search (and see as palette
 * chips / recent-search rows). Empty only for a signed-out session — the
 * topbar does not render the palette without a session anyway.
 */
export function permittedSearchTypes(session: Session | null): SearchResultType[] {
  return (Object.keys(SEARCH_TYPE_PERMISSIONS) as SearchResultType[]).filter((t) =>
    can(session, SEARCH_TYPE_PERMISSIONS[t]),
  );
}

export interface SearchResult {
  type: SearchResultType;
  id: string;
  label: string;
  subtitle: string;
  /** Route to navigate to when the result is clicked. */
  route: string;
}

export interface SearchIndex {
  search(query: string): Promise<SearchResult[]>;
}

const MAX_RESULTS_PER_TYPE = 3;
const MAX_RECENT_SEARCHES = 8;
const RECENT_SEARCHES_KEY = "el-imtiyaz:recent-searches";

export function makeSearchIndex(repos: Repositories, session: Session | null): SearchIndex {
  return {
    async search(query: string): Promise<SearchResult[]> {
      const q = query.trim().toLowerCase();
      if (!q) return [];

      // T-542 / SEC-120: the permission gate runs BEFORE the repository is
      // touched — an unpermitted type is NEVER QUERIED (no repository call,
      // no cache warm, no result to filter). A restricted worker's palette
      // queries exactly the indexes their grants permit.
      const canSearch = (t: SearchResultType) => can(session, SEARCH_TYPE_PERMISSIONS[t]);

      const [
        parentRes,
        studentRes,
        payments,
        expenses,
        auditRes,
        personnel,
      ] = await Promise.all([
        canSearch("parent") ? repos.parents.search(q) : Promise.resolve(null),
        canSearch("student") ? repos.students.search(q) : Promise.resolve(null),
        canSearch("payment") ? Promise.resolve(repos.payments.observe().get()) : Promise.resolve(null),
        canSearch("expense") ? Promise.resolve(repos.expenses.observe().get()) : Promise.resolve(null),
        canSearch("audit") ? repos.audit.recent(200) : Promise.resolve(null),
        canSearch("personnel") ? Promise.resolve(repos.personnel.observe().get()) : Promise.resolve(null),
      ]);

      const results: SearchResult[] = [];

      // Parents
      if (parentRes?.ok) {
        for (const p of parentRes.value.slice(0, MAX_RESULTS_PER_TYPE)) {
          results.push({
            type: "parent",
            id: p.id,
            label: parentDisplayName(p),
            subtitle: p.code,
            route: `/crm?parentId=${p.id}`,
          });
        }
      }

      // Students
      if (studentRes && studentRes.ok) {
        for (const s of studentRes.value.slice(0, MAX_RESULTS_PER_TYPE)) {
          results.push({
            type: "student",
            id: s.id,
            label: `${s.firstName} ${s.lastName}`,
            subtitle: s.code,
            route: `/crm?studentId=${s.id}`,
          });
        }
      }

      // Payments — search by receipt number / method
      let paymentCount = 0;
      for (const pmt of payments ?? []) {
        if (paymentCount >= MAX_RESULTS_PER_TYPE) break;
        const receiptMatch = pmt.receiptNumber?.toLowerCase().includes(q);
        const methodMatch = pmt.method?.toLowerCase().includes(q);
        if (receiptMatch || methodMatch) {
          results.push({
            type: "payment",
            id: pmt.id,
            label: `Paiement ${pmt.receiptNumber ?? pmt.id.slice(0, 8)}`,
            subtitle: `${pmt.method} • ${pmt.amount.toLocaleString("fr-DZ")} DA`,
            route: `/financials?paymentId=${pmt.id}`,
          });
          paymentCount++;
        }
      }

      // Expenses — search by requestCode / payee / title / description
      let expenseCount = 0;
      for (const exp of expenses ?? []) {
        if (expenseCount >= MAX_RESULTS_PER_TYPE) break;
        const codeMatch = exp.requestCode?.toLowerCase().includes(q);
        const payeeMatch = exp.payee?.toLowerCase().includes(q);
        const titleMatch = exp.title?.toLowerCase().includes(q);
        const descMatch = exp.description?.toLowerCase().includes(q);
        if (codeMatch || payeeMatch || titleMatch || descMatch) {
          results.push({
            type: "expense",
            id: exp.id,
            label: `Dépense ${exp.requestCode ?? exp.id.slice(0, 8)}`,
            subtitle: `${exp.payee ?? "—"} • ${exp.amount.toLocaleString("fr-DZ")} DA`,
            route: `/financials?expenseId=${exp.id}`,
          });
          expenseCount++;
        }
      }

      // Audit — search by entity ID / action / actor name
      if (auditRes?.ok) {
        let auditCount = 0;
        for (const entry of auditRes.value) {
          if (auditCount >= MAX_RESULTS_PER_TYPE) break;
          const entityMatch = entry.entityId?.toLowerCase().includes(q);
          const actionMatch = entry.action?.toLowerCase().includes(q);
          const actorMatch = entry.actorName?.toLowerCase().includes(q);
          if (entityMatch || actionMatch || actorMatch) {
            results.push({
              type: "audit",
              id: entry.id,
              label: `${entry.action} — ${entry.entityType}`,
              subtitle: `${entry.actorName} • ${entry.entityId.slice(0, 12)}`,
              route: `/settings?auditId=${entry.id}`,
            });
            auditCount++;
          }
        }
      }

      // Personnel — search by name / staffCategory / phone / email
      let personnelCount = 0;
      for (const person of personnel ?? []) {
        if (personnelCount >= MAX_RESULTS_PER_TYPE) break;
        const nameMatch = `${person.firstName} ${person.lastName}`.toLowerCase().includes(q);
        const categoryMatch = person.staffCategory?.toLowerCase().includes(q);
        const phoneMatch = person.phone?.toLowerCase().includes(q);
        const emailMatch = person.email?.toLowerCase().includes(q);
        if (nameMatch || categoryMatch || phoneMatch || emailMatch) {
          results.push({
            type: "personnel",
            id: person.id,
            label: `${person.firstName} ${person.lastName}`,
            subtitle: person.staffCategory ?? "—",
            route: `/personnel?personnelId=${person.id}`,
          });
          personnelCount++;
        }
      }

      return results;
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Recent searches (localStorage, max 8, FIFO)                       */
/* ------------------------------------------------------------------ */

export interface RecentSearch {
  type: SearchResultType;
  id: string;
  label: string;
  subtitle: string;
  route: string;
  at: number; // epoch ms
}

export function loadRecentSearches(): RecentSearch[] {
  try {
    const raw = localStorage.getItem(RECENT_SEARCHES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, MAX_RECENT_SEARCHES);
  } catch {
    return [];
  }
}

export function saveRecentSearch(entry: Omit<RecentSearch, "at">): void {
  try {
    const existing = loadRecentSearches();
    // De-duplicate by (type, id) — move to front if it already exists.
    const filtered = existing.filter((r) => !(r.type === entry.type && r.id === entry.id));
    const next = [{ ...entry, at: Date.now() }, ...filtered].slice(0, MAX_RECENT_SEARCHES);
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next));
  } catch {
    // Silently ignore quota / serialization errors — recent searches are a
    // best-effort convenience, not a critical feature.
  }
}

export function clearRecentSearches(): void {
  try {
    localStorage.removeItem(RECENT_SEARCHES_KEY);
  } catch {
    // ignore
  }
}

export const SEARCH_INDEX_CONSTANTS = {
  MAX_RESULTS_PER_TYPE,
  MAX_RECENT_SEARCHES,
  RECENT_SEARCHES_KEY,
};
