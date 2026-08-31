/**
 * SyncQueueStore — persistence layer for the sync queue.
 *
 * The queue MUST survive app restarts so that pending changes are not
 * lost when the user closes the desktop. We use IndexedDB (via a thin
 * wrapper) so the queue is durable and works in the Electron renderer
 * without IPC round-trips.
 *
 * The store is intentionally minimal — just CRUD over a single object
 * store. All higher-level logic (mock exclusion, retry backoff, online
 * detection) lives in `SyncService`.
 *
 * If IndexedDB is unavailable (older Electron, browser private mode),
 * we fall back to an in-memory store with a console warning. The app
 * still works but pending changes will be lost on restart.
 */

const DB_NAME = "el-imtiyaz-sync";
const DB_VERSION = 1;
const STORE_NAME = "queue";

import type { SyncQueueEntry } from "./sync-types";

/**
 * Minimal IndexedDB wrapper — enough for our queue. We avoid pulling in
 * a library to keep the bundle small and to keep the dependency surface
 * tight (the sync layer is security-sensitive).
 */
class IndexedDBQueueStore {
  private db: IDBDatabase | null = null;
  private readonly memFallback: Map<string, SyncQueueEntry> = new Map();
  private usingFallback = false;
  private _initialized = false;

  async init(): Promise<void> {
    if (this.db || this.usingFallback) return;
    if (typeof indexedDB === "undefined") {
      console.warn("[SyncQueueStore] IndexedDB unavailable — using in-memory fallback (queue will NOT survive restart).");
      this.usingFallback = true;
      return;
    }
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const os = db.createObjectStore(STORE_NAME, { keyPath: "id" });
          os.createIndex("status", "status", { unique: false });
          os.createIndex("queuedAt", "queuedAt", { unique: false });
          os.createIndex("isMock", "isMock", { unique: false });
        }
      };
      req.onsuccess = () => {
        this.db = req.result;
        resolve();
      };
      req.onerror = () => {
        console.warn("[SyncQueueStore] IndexedDB open failed — using in-memory fallback.", req.error);
        this.usingFallback = true;
        resolve();
      };
    });
  }

  async add(entry: SyncQueueEntry): Promise<void> {
    if (this.usingFallback) {
      this.memFallback.set(entry.id, entry);
      return;
    }
    return this.txn("readwrite", (os) => os.put(entry));
  }

  /**
   * Add multiple entries in a SINGLE IndexedDB transaction.
   *
   * Why this matters: the Excel import path enqueues ~1,170 entries at
   * once (parent + student + ledger_entry per row × ~390 rows). Calling
   * `add()` N times opens N separate transactions → N round-trips to
   * IndexedDB → N snapshot emissions → N React re-renders. Batching
   * cuts all of that to ONE transaction + ONE snapshot emission.
   *
   * Falls back to a synchronous loop when using the in-memory store
   * (the loop is already O(N) Map.set calls — no batching needed).
   */
  async addBatch(entries: readonly SyncQueueEntry[]): Promise<void> {
    if (entries.length === 0) return;
    if (this.usingFallback) {
      for (const entry of entries) this.memFallback.set(entry.id, entry);
      return;
    }
    return new Promise((resolve, reject) => {
      const txn = this.db!.transaction(STORE_NAME, "readwrite");
      const os = txn.objectStore(STORE_NAME);
      let pending = entries.length;
      let firstError: DOMException | null = null;
      for (const entry of entries) {
        const req = os.put(entry);
        req.onsuccess = () => {
          if (--pending === 0) {
            if (firstError) reject(firstError);
            else resolve();
          }
        };
        req.onerror = () => {
          if (!firstError) firstError = req.error;
          if (--pending === 0) reject(firstError ?? req.error);
        };
      }
      // If no entries were processed (shouldn't happen — we checked above),
      // resolve immediately so the promise doesn't dangle.
      if (entries.length === 0) resolve();
    });
  }

  async update(entry: SyncQueueEntry): Promise<void> {
    return this.add(entry); // put() upserts
  }

  async get(id: string): Promise<SyncQueueEntry | null> {
    if (this.usingFallback) return this.memFallback.get(id) ?? null;
    return new Promise((resolve, reject) => {
      const txn = this.db!.transaction(STORE_NAME, "readonly");
      const os = txn.objectStore(STORE_NAME);
      const req = os.get(id);
      req.onsuccess = () => resolve((req.result as SyncQueueEntry) ?? null);
      req.onerror = () => reject(req.error);
    });
  }

  async listByStatus(status: SyncQueueEntry["status"]): Promise<SyncQueueEntry[]> {
    if (this.usingFallback) {
      return Array.from(this.memFallback.values()).filter((e) => e.status === status);
    }
    return new Promise((resolve, reject) => {
      const txn = this.db!.transaction(STORE_NAME, "readonly");
      const idx = txn.objectStore(STORE_NAME).index("status");
      const req = idx.getAll(status);
      req.onsuccess = () => resolve((req.result as SyncQueueEntry[]) ?? []);
      req.onerror = () => reject(req.error);
    });
  }

  async listAll(): Promise<SyncQueueEntry[]> {
    if (this.usingFallback) return Array.from(this.memFallback.values());
    return new Promise((resolve, reject) => {
      const txn = this.db!.transaction(STORE_NAME, "readonly");
      const req = txn.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => resolve((req.result as SyncQueueEntry[]) ?? []);
      req.onerror = () => reject(req.error);
    });
  }

  async clear(): Promise<void> {
    if (this.usingFallback) {
      this.memFallback.clear();
      return;
    }
    return this.txn("readwrite", (os) => os.clear());
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this._initialized = false;
  }

  /**
   * CACHE-102: whether the queue is running on the IN-MEMORY fallback
   * (IndexedDB unavailable). The UI surfaces this so the user knows
   * pending changes will be lost on app close — instead of a silent
   * console.warn and a lying "synced" indicator.
   */
  isUsingFallback(): boolean {
    return this.usingFallback;
  }

  private txn(mode: IDBTransactionMode, fn: (os: IDBObjectStore) => IDBRequest): Promise<void> {
    return new Promise((resolve, reject) => {
      const txn = this.db!.transaction(STORE_NAME, mode);
      const os = txn.objectStore(STORE_NAME);
      const req = fn(os);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }
}

/** Singleton store — the entire app shares one queue. */
let _store: IndexedDBQueueStore | null = null;
export function getSyncQueueStore(): IndexedDBQueueStore {
  if (!_store) _store = new IndexedDBQueueStore();
  return _store;
}

/**
 * Test-only: reset the singleton AND wipe the underlying IndexedDB
 * database so tests start from a clean slate.
 */
export async function _resetSyncQueueStoreForTests(): Promise<void> {
  if (_store) {
    try {
      await _store.close();
    } catch {
      // ignore — store may not have been initialised
    }
  }
  _store = null;
  // Also delete the IndexedDB database so the next test starts fresh.
  if (typeof indexedDB !== "undefined") {
    await new Promise<void>((resolve) => {
      try {
        const req = indexedDB.deleteDatabase("el-imtiyaz-sync");
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
        req.onblocked = () => resolve();
      } catch {
        resolve();
      }
    });
  }
}
