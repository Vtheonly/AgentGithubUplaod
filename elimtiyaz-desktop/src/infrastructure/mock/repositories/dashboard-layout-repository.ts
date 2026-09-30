/**
 * Mock dashboard-layout repository — T-448 (UI-326).
 *
 * MOCK-MODE PARITY (§15.70 — per-desktop-local storage is the only safe
 * home when there is no server): the twin persists to localStorage under
 * the EXACT key the editor's offline cache uses
 * (`el-imtiyaz:dashboard-layout:<viewKey>`), so mock mode keeps the full
 * "configure once, reuse forever" semantics without any server.
 *
 * In mock mode this makes load/save/clear idempotent with the editor's own
 * cache writes (same key, same payload — the §6 no-parallel-implementation
 * rule: the key + shape live in ONE place, imported from the editor's
 * module).
 */
import {
  parseStoredDashboardLayout,
  type DashboardLayoutRepository,
  type StoredDashboardLayout,
} from "../../../domain/repository/dashboard-layout-repository";
import type { Result } from "../../../core/result";
import { Ok, Err } from "../../../core/result";
import { Errors } from "../../../core/app-error";

/** The editor's ONE canonical storage prefix (imported, never duplicated). */
import { DASHBOARD_LAYOUT_STORAGE_PREFIX as STORAGE_PREFIX } from "../../../features/dashboard/dashboard-layout-storage";

export class MockDashboardLayoutRepository implements DashboardLayoutRepository {
  async load(viewKey: string): Promise<Result<StoredDashboardLayout | null>> {
    try {
      const raw = localStorage.getItem(STORAGE_PREFIX + viewKey);
      if (!raw) return Ok(null);
      return Ok(parseStoredDashboardLayout(JSON.parse(raw)));
    } catch {
      return Ok(null);
    }
  }

  async save(
    viewKey: string,
    layout: StoredDashboardLayout,
  ): Promise<Result<string>> {
    try {
      localStorage.setItem(STORAGE_PREFIX + viewKey, JSON.stringify(layout));
      return Ok(new Date().toISOString());
    } catch (err) {
      return Err(Errors.unknown(err));
    }
  }

  async clear(viewKey: string): Promise<Result<void>> {
    try {
      localStorage.removeItem(STORAGE_PREFIX + viewKey);
      return Ok(undefined);
    } catch (err) {
      return Err(Errors.unknown(err));
    }
  }
}

export const mockDashboardLayoutRepository = new MockDashboardLayoutRepository();
