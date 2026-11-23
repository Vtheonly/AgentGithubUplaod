// ============================================================================
// FILE: elimtiyaz-desktop/src/infrastructure/ai/ai-config-storage.ts
// ============================================================================
/**
 * BYOK AI config storage — plan §11.04, extended T-260 (39th session).
 *
 * Persists the `AIProviderConfig` with AES-256-GCM encryption for all
 * keys (groq / openrouter / custom-OpenAI); sampling params and model
 * selections are plaintext (no secrets). Plaintext API keys NEVER
 * appear in localStorage.
 *
 * T-266 (41st session): the `readRawStored()` test seam (the at-rest
 * encryption assertions depend on it) was RESTORED after the
 * unregistered 6ce49b9 patch deleted it (REG-005).
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

export const AI_CONFIG_STORAGE_KEY = "el-imtiyaz:ai-config";
export const AI_PASSPHRASE_STORAGE_KEY = "el-imtiyaz:ai-passphrase";

const AI_SALT_HEX = "e1c4f8a92b7d5061934eadc7f3b21895e1c4f8a92b7d5061934eadc7f3b21895";

const AI_SALT_BYTES = (() => {
  const out = new Uint8Array(AI_SALT_HEX.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(AI_SALT_HEX.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
})();

interface StoredAIConfig {
  groqApiKeyEnc: string | null;
  openRouterApiKeyEnc: string | null;
  customApiKeyEnc: string | null;
  customBaseUrl: string | null;
  defaultProvider: AIProviderConfig["defaultProvider"];
  defaultModel: string;
  fastModel?: string;
  reasoningModel?: string;
  fallbackModel: string | null;
  enableSmartRouting?: boolean;
  temperature: number;
  topP: number;
  maxTokens: number;
  reasoningEffort?: AIProviderConfig["reasoningEffort"];
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

function packEncrypted(iv: Uint8Array, ciphertext: Uint8Array): Uint8Array {
  const out = new Uint8Array(iv.length + ciphertext.length);
  out.set(iv, 0);
  out.set(ciphertext, iv.length);
  return out;
}

function unpackEncrypted(packed: Uint8Array): { iv: Uint8Array; ciphertext: Uint8Array } {
  return {
    iv: packed.slice(0, 12),
    ciphertext: packed.slice(12),
  };
}

/**
 * T-585 (BUG-056): the passphrase's home is the OS KEYCHAIN (Electron
 * safeStorage via the `window.elImtiyaz.safeStorage` IPC bridge), with a
 * transparent one-way migration off the legacy localStorage slot:
 *
 *   1. Keychain read hits → use it (and remove a lingering legacy copy).
 *   2. Keychain read misses → migrate the LEGACY localStorage passphrase
 *      when present, else generate a fresh one; write it to the keychain.
 *   3. Any keychain failure (browser / dev server / tests / OS keychain
 *      unavailable) → the pre-T-585 localStorage behavior (the config
 *      keeps working; obfuscated-but-functional beats broken).
 *
 * The function is exported for the t-585 suite's round-trip pins.
 */
export async function getOrCreatePassphrase(): Promise<string> {
  const bridge = (globalThis as { window?: Window }).window?.elImtiyaz?.safeStorage;
  if (bridge) {
    try {
      const read = await bridge.readPassphrase();
      if (read.ok) {
        if (read.value !== null) {
          // A stale legacy copy must not linger beside the ciphertext.
          if (localStorage.getItem(AI_PASSPHRASE_STORAGE_KEY) !== null) {
            localStorage.removeItem(AI_PASSPHRASE_STORAGE_KEY);
          }
          return read.value;
        }
        // No keychain entry yet: migrate the legacy value or generate.
        const legacy = localStorage.getItem(AI_PASSPHRASE_STORAGE_KEY);
        const pass =
          legacy ??
          bytesToBase64(crypto.getRandomValues(new Uint8Array(32)));
        const write = await bridge.writePassphrase(pass);
        if (write.ok) {
          localStorage.removeItem(AI_PASSPHRASE_STORAGE_KEY);
          return pass;
        }
        // Keychain write failed → fall through to the localStorage path.
      }
    } catch {
      // Any bridge surprise → the localStorage path (fail-safe).
    }
  }
  let pass = localStorage.getItem(AI_PASSPHRASE_STORAGE_KEY);
  if (!pass) {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    pass = bytesToBase64(bytes);
    localStorage.setItem(AI_PASSPHRASE_STORAGE_KEY, pass);
  }
  return pass;
}

async function deriveAIKey(): Promise<CryptoKey> {
  const passphrase = await getOrCreatePassphrase();
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

export async function loadConfig(): Promise<AIProviderConfig> {
  const raw = localStorage.getItem(AI_CONFIG_STORAGE_KEY);
  if (!raw) return { ...DEFAULT_AI_PROVIDER_CONFIG };

  try {
    const stored = JSON.parse(raw) as StoredAIConfig;
    const decryptSafe = async (val: string | null | undefined): Promise<string | null> => {
      if (!val) return null;
      try {
        return await decryptString(val);
      } catch {
        return null;
      }
    };

    const [groqApiKey, openRouterApiKey, customApiKey] = await Promise.all([
      decryptSafe(stored.groqApiKeyEnc),
      decryptSafe(stored.openRouterApiKeyEnc),
      decryptSafe(stored.customApiKeyEnc),
    ]);

    return {
      groqApiKey,
      openRouterApiKey,
      customApiKey,
      customBaseUrl: stored.customBaseUrl ?? DEFAULT_AI_PROVIDER_CONFIG.customBaseUrl,
      defaultProvider: stored.defaultProvider ?? DEFAULT_AI_PROVIDER_CONFIG.defaultProvider,
      defaultModel: stored.defaultModel ?? DEFAULT_AI_PROVIDER_CONFIG.defaultModel,
      fastModel: stored.fastModel ?? DEFAULT_AI_PROVIDER_CONFIG.fastModel,
      reasoningModel: stored.reasoningModel ?? DEFAULT_AI_PROVIDER_CONFIG.reasoningModel,
      fallbackModel: stored.fallbackModel ?? DEFAULT_AI_PROVIDER_CONFIG.fallbackModel,
      enableSmartRouting: stored.enableSmartRouting ?? DEFAULT_AI_PROVIDER_CONFIG.enableSmartRouting,
      temperature: stored.temperature ?? DEFAULT_AI_PROVIDER_CONFIG.temperature,
      topP: stored.topP ?? DEFAULT_AI_PROVIDER_CONFIG.topP,
      maxTokens: stored.maxTokens ?? DEFAULT_AI_PROVIDER_CONFIG.maxTokens,
      reasoningEffort: stored.reasoningEffort ?? DEFAULT_AI_PROVIDER_CONFIG.reasoningEffort,
      updatedAt: stored.updatedAt ?? DEFAULT_AI_PROVIDER_CONFIG.updatedAt,
      updatedBy: stored.updatedBy ?? DEFAULT_AI_PROVIDER_CONFIG.updatedBy,
    };
  } catch {
    return { ...DEFAULT_AI_PROVIDER_CONFIG };
  }
}

export async function saveConfig(config: AIProviderConfig): Promise<StoredAIConfig> {
  const [groqApiKeyEnc, openRouterApiKeyEnc, customApiKeyEnc] = await Promise.all([
    config.groqApiKey ? encryptString(config.groqApiKey) : Promise.resolve(null),
    config.openRouterApiKey ? encryptString(config.openRouterApiKey) : Promise.resolve(null),
    config.customApiKey ? encryptString(config.customApiKey) : Promise.resolve(null),
  ]);

  const stored: StoredAIConfig = {
    groqApiKeyEnc,
    openRouterApiKeyEnc,
    customApiKeyEnc,
    customBaseUrl: config.customBaseUrl,
    defaultProvider: config.defaultProvider,
    defaultModel: config.defaultModel,
    fastModel: config.fastModel,
    reasoningModel: config.reasoningModel,
    fallbackModel: config.fallbackModel,
    enableSmartRouting: config.enableSmartRouting,
    temperature: config.temperature,
    topP: config.topP,
    maxTokens: config.maxTokens,
    reasoningEffort: config.reasoningEffort,
    updatedAt: config.updatedAt,
    updatedBy: config.updatedBy,
  };

  localStorage.setItem(AI_CONFIG_STORAGE_KEY, JSON.stringify(stored));
  return stored;
}

export function clearConfig(): void {
  localStorage.removeItem(AI_CONFIG_STORAGE_KEY);
}

/**
 * Test seam (T-260): read the RAW stored JSON payload — NOT the decrypted
 * config — so tests can assert encryption-at-rest invariants (no
 * plaintext `gsk-…` / `sk-or-…` / key material in localStorage).
 * Restored by T-266 (REG-005) after the unregistered 6ce49b9 patch
 * deleted it and broke the agent-architecture suite.
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