// ============================================================================
// FILE: elimtiyaz-desktop/src/infrastructure/ai/ai-config-storage.ts
// ============================================================================
/**
 * BYOK AI config storage — plan §11.04.
 *
 * Persists the `AIProviderConfig` with AES-256-GCM encryption for all keys.
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

function getOrCreatePassphrase(): string {
  let pass = localStorage.getItem(AI_PASSPHRASE_STORAGE_KEY);
  if (!pass) {
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