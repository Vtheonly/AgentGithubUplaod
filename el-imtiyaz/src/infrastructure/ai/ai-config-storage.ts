/**
 * BYOK AI config storage — plan §11.04.
 *
 * Persists the `AIProviderConfig` to localStorage. API keys (Groq + OpenRouter)
 * are encrypted with AES-256-GCM before storage; the rest of the config
 * (defaultProvider, defaultModel, fallbackModel, updatedAt, updatedBy) is
 * stored in plaintext because it contains no secrets.
 *
 * Key derivation:
 *   - A tenant-scoped passphrase is stored in `localStorage["el-imtiyaz:ai-passphrase"]`.
 *     If missing, a random one is generated on first save (32 random bytes →
 *     base64). In production (plan §11.02), the passphrase is held in a
 *     Supabase secret or HSM; the storage layer contract stays identical.
 *   - The passphrase + a fixed salt (per-tenant) derive a 256-bit AES-GCM
 *     key via PBKDF2 (100,000 iterations, SHA-256).
 *
 * The encrypted payload is stored at `localStorage["el-imtiyaz:ai-config"]`
 * as a JSON string of shape:
 *   {
 *     "groqApiKeyEnc": "base64(iv|ciphertext)" | null,
 *     "openRouterApiKeyEnc": "base64(iv|ciphertext)" | null,
 *     "defaultProvider": "groq" | "openrouter",
 *     "defaultModel": string,
 *     "fallbackModel": string | null,
 *     "updatedAt": string,
 *     "updatedBy": string,
 *   }
 *
 * Plaintext API keys NEVER appear in localStorage.
 */
import type { AIProviderConfig } from "../../domain/model/ai";
import { DEFAULT_AI_PROVIDER_CONFIG } from "../../domain/model/ai";
import {
  generateKey,
  encrypt,
  decrypt,
  encodeUtf8,
  decodeUtf8,
} from "../backup/aes-256";

/* ------------------------------------------------------------------ */
/*  Storage keys                                                       */
/* ------------------------------------------------------------------ */

export const AI_CONFIG_STORAGE_KEY = "el-imtiyaz:ai-config";
export const AI_PASSPHRASE_STORAGE_KEY = "el-imtiyaz:ai-passphrase";

/**
 * Fixed per-tenant salt for AI config key derivation (32 bytes hex).
 *
 * In production this would be a tenant-specific value stored alongside the
 * tenant record. For the desktop mock we hardcode a constant — the threat
 * model is "physical access to the admin's localStorage", and the
 * passphrase (also stored locally) is the actual secret. The salt's job is
 * to make rainbow tables infeasible, which a constant salt still achieves
 * for a single-tenant desktop app.
 */
const AI_SALT_HEX = "e1c4f8a92b7d5061934eadc7f3b21895e1c4f8a92b7d5061934eadc7f3b21895";

/** Decode the hex salt into bytes once at module load. */
const AI_SALT_BYTES = (() => {
  const out = new Uint8Array(AI_SALT_HEX.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(AI_SALT_HEX.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
})();

/* ------------------------------------------------------------------ */
/*  Internal serialization helpers                                     */
/* ------------------------------------------------------------------ */

interface StoredAIConfig {
  groqApiKeyEnc: string | null;
  openRouterApiKeyEnc: string | null;
  defaultProvider: AIProviderConfig["defaultProvider"];
  defaultModel: string;
  fallbackModel: string | null;
  updatedAt: string;
  updatedBy: string;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Concatenate IV (12 bytes) + ciphertext into a single Uint8Array. */
function packEncrypted(iv: Uint8Array, ciphertext: Uint8Array): Uint8Array {
  const out = new Uint8Array(iv.length + ciphertext.length);
  out.set(iv, 0);
  out.set(ciphertext, iv.length);
  return out;
}

/** Split a packed (iv|ciphertext) buffer back into its parts. */
function unpackEncrypted(packed: Uint8Array): { iv: Uint8Array; ciphertext: Uint8Array } {
  const iv = packed.slice(0, 12);
  const ciphertext = packed.slice(12);
  return { iv, ciphertext };
}

function getOrCreatePassphrase(): string {
  let pass = localStorage.getItem(AI_PASSPHRASE_STORAGE_KEY);
  if (!pass) {
    // Generate a random 32-byte passphrase and base64-encode it.
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    pass = bytesToBase64(bytes);
    localStorage.setItem(AI_PASSPHRASE_STORAGE_KEY, pass);
  }
  return pass;
}

async function deriveAIKey(): Promise<CryptoKey> {
  const passphrase = getOrCreatePassphrase();
  return generateKey(passphrase, AI_SALT_BYTES);
}

async function encryptString(plaintext: string): Promise<string> {
  const key = await deriveAIKey();
  const { ciphertext, iv } = await encrypt(encodeUtf8(plaintext), key);
  return bytesToBase64(packEncrypted(iv, ciphertext));
}

async function decryptString(b64: string): Promise<string> {
  const key = await deriveAIKey();
  const packed = base64ToBytes(b64);
  const { iv, ciphertext } = unpackEncrypted(packed);
  const plainBytes = await decrypt(ciphertext, iv, key);
  return decodeUtf8(plainBytes);
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Load the persisted AI provider config from localStorage. If no config is
 * stored, returns the default empty config. API keys are decrypted on read.
 *
 * If decryption fails (corrupted data / changed passphrase), the
 * corresponding key is returned as `null` rather than throwing — this
 * guarantees the UI can always render a usable form.
 */
export async function loadConfig(): Promise<AIProviderConfig> {
  const raw = localStorage.getItem(AI_CONFIG_STORAGE_KEY);
  if (!raw) return { ...DEFAULT_AI_PROVIDER_CONFIG };

  try {
    const stored = JSON.parse(raw) as StoredAIConfig;
    let groqApiKey: string | null = null;
    let openRouterApiKey: string | null = null;
    if (stored.groqApiKeyEnc) {
      try {
        groqApiKey = await decryptString(stored.groqApiKeyEnc);
      } catch {
        groqApiKey = null;
      }
    }
    if (stored.openRouterApiKeyEnc) {
      try {
        openRouterApiKey = await decryptString(stored.openRouterApiKeyEnc);
      } catch {
        openRouterApiKey = null;
      }
    }
    return {
      groqApiKey,
      openRouterApiKey,
      defaultProvider: stored.defaultProvider ?? "groq",
      defaultModel: stored.defaultModel ?? DEFAULT_AI_PROVIDER_CONFIG.defaultModel,
      fallbackModel: stored.fallbackModel ?? null,
      updatedAt: stored.updatedAt ?? DEFAULT_AI_PROVIDER_CONFIG.updatedAt,
      updatedBy: stored.updatedBy ?? DEFAULT_AI_PROVIDER_CONFIG.updatedBy,
    };
  } catch {
    return { ...DEFAULT_AI_PROVIDER_CONFIG };
  }
}

/**
 * Persist the AI provider config to localStorage. API keys are encrypted
 * with AES-256-GCM before storage. Plaintext keys NEVER appear in
 * localStorage — only the encrypted blobs do.
 *
 * Returns the canonical `StoredAIConfig` for callers that want to inspect
 * what was actually written (e.g. tests verifying the key is encrypted).
 */
export async function saveConfig(config: AIProviderConfig): Promise<StoredAIConfig> {
  const stored: StoredAIConfig = {
    groqApiKeyEnc: config.groqApiKey ? await encryptString(config.groqApiKey) : null,
    openRouterApiKeyEnc: config.openRouterApiKey
      ? await encryptString(config.openRouterApiKey)
      : null,
    defaultProvider: config.defaultProvider,
    defaultModel: config.defaultModel,
    fallbackModel: config.fallbackModel,
    updatedAt: config.updatedAt,
    updatedBy: config.updatedBy,
  };
  localStorage.setItem(AI_CONFIG_STORAGE_KEY, JSON.stringify(stored));
  return stored;
}

/**
 * Remove the stored config entirely. The passphrase is kept (so future
 * configs can still be decrypted if the user re-enters the same key).
 */
export function clearConfig(): void {
  localStorage.removeItem(AI_CONFIG_STORAGE_KEY);
}

/**
 * Read the raw stored JSON (without decrypting). Used by tests to verify
 * the API key never appears in plaintext in localStorage.
 */
export function readRawStored(): StoredAIConfig | null {
  const raw = localStorage.getItem(AI_CONFIG_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredAIConfig;
  } catch {
    return null;
  }
}
