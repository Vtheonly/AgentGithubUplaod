/**
 * Media Asset Vault — vault §12.07 (signed-URL flow).
 *
 * Sensitive documents (receipt photos, check scans, transfer receipts,
 * medical certificates, therapy notes) live in PRIVATE storage buckets:
 *
 *   1. Client requests access to a media asset.
 *   2. Server validates the user's permission to view that asset.
 *   3. Server generates a TIME-LIMITED signed URL (5-minute expiry).
 *   4. Client downloads the asset via the signed URL.
 *   5. The URL expires; subsequent requests require a fresh signed URL.
 *
 * CRITICAL RULES enforced here:
 *   - Direct public URL access is forbidden (no getPublicUrl anywhere).
 *   - Signed URLs are NEVER cached in client-side storage — every display
 *     request generates a fresh signed URL (freshSignedMediaUrl below).
 *
 * Modes:
 *   - Supabase mode: uploads to the private bucket (`payment-proofs`,
 *     `student-documents`, `expense-receipts`, migration 0018) and signs
 *     URLs with a 5-minute (300 s) expiry.
 *   - Mock mode: files are held in an in-memory object-URL registry that
 *     mimics the signed-URL lifecycle (each fetch returns a fresh,
 *     expiring token-bearing URL) so UI code paths are identical.
 */
import { getSupabaseClient, isSupabaseConfigured } from "../supabase/supabase-client";

/** Buckets defined by migration 0018 (all private). */
export type MediaBucket =
  | "payment-proofs"
  | "student-documents"
  | "expense-receipts"
  | "therapy-attachments";

export interface UploadMediaResult {
  /** Storage path (`<tenantId>/<entityId>/<filename>`) — persist this. */
  readonly path: string;
  readonly bucket: MediaBucket;
  readonly sizeBytes: number;
  readonly contentType: string;
}

/** In-memory mock vault: path → blob. Mimics the private bucket. */
const mockVault = new Map<string, Blob>();
/** In-memory mock registry of live "signed" object URLs. */
const mockObjectUrls = new Map<string, string>();

const SIGN_TTL_SECONDS = 300; // 5 minutes — vault §12.07

/**
 * Upload a sensitive document to the PRIVATE bucket.
 * Never uploads to a public bucket; never returns a public URL.
 */
export async function uploadPrivateMedia(params: {
  bucket: MediaBucket;
  entityId: string;
  tenantId: string;
  file: File;
}): Promise<UploadMediaResult> {
  const { bucket, entityId, tenantId, file } = params;
  // Normalized storage path per migration 0018: <tenant>/<entity>/<filename>.
  const safeName = file.name.replace(/[^\w.\-]+/g, "_");
  const path = `${tenantId}/${entityId}/${Date.now()}-${safeName}`;

  if (isSupabaseConfigured()) {
    const client = getSupabaseClient();
    const { error } = await client.storage
      .from(bucket)
      .upload(path, file, {
        cacheControl: "0",
        upsert: false,
        contentType: file.type || "application/octet-stream",
      });
    if (error) throw new Error(`Media vault upload failed: ${error.message}`);
    return {
      path,
      bucket,
      sizeBytes: file.size,
      contentType: file.type || "application/octet-stream",
    };
  }

  // Mock mode — keep the bytes in the in-memory vault.
  mockVault.set(path, file);
  return {
    path,
    bucket,
    sizeBytes: file.size,
    contentType: file.type || "application/octet-stream",
  };
}

/**
 * Generate a FRESH signed URL for a vaulted asset (5-minute expiry).
 *
 * Never cached — callers must invoke this on every display. In mock mode the
 * "signed URL" is a fresh object URL bound to the vaulted bytes.
 */
export async function freshSignedMediaUrl(params: {
  bucket: MediaBucket;
  path: string;
}): Promise<string | null> {
  const { path } = params;
  if (!path) return null;

  // Mock-mode stored asset (or a legacy mock:// marker) — serve from the
  // in-memory registry with a fresh object URL.
  if (path.startsWith("mock://") || (!isSupabaseConfigured() && mockVault.has(path))) {
    const blob = mockVault.get(path);
    if (!blob) {
      // Legacy marker with no bytes (e.g. seeded data) — no real media.
      return null;
    }
    const previous = mockObjectUrls.get(path);
    if (previous) URL.revokeObjectURL(previous);
    const url = URL.createObjectURL(blob);
    mockObjectUrls.set(path, url);
    return url;
  }

  if (isSupabaseConfigured()) {
    const client = getSupabaseClient();
    const { data, error } = await client.storage
      .from(params.bucket)
      .createSignedUrl(path, SIGN_TTL_SECONDS, { download: false });
    if (error) {
      console.warn("[MediaVault] createSignedUrl failed:", error.message);
      return null;
    }
    return data?.signedUrl ?? null;
  }

  return null;
}

/** Read a mock-vault blob directly (for data-URL previews in mock mode). */
export async function readMockVaultBlob(path: string): Promise<Blob | null> {
  return mockVault.get(path) ?? null;
}

/** Whether a stored path refers to bytes available in the mock vault. */
export function mockVaultHas(path: string): boolean {
  return mockVault.has(path);
}

/** Housekeeping for tests: clear the in-memory vault. */
export function clearMockVault(): void {
  for (const url of mockObjectUrls.values()) URL.revokeObjectURL(url);
  mockObjectUrls.clear();
  mockVault.clear();
}
