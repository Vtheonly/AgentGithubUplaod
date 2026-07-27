/**
 * Default pricing config — used to seed the mock repository.
 *
 * IMPORTANT: This is the ONLY place monetary amounts are hardcoded in the
 * entire codebase. After initial seed, all amounts come from the
 * PricingRepository (which in production reads from Supabase).
 *
 * Per the plan: "Adding or changing a price must never require modifying
 * source code." The seed values are initial defaults only — admins edit
 * them at runtime via the Settings → Pricing tab.
 */
import type { PricingConfig, PricingEntry } from "../../domain/model/pricing";
import { TENANT_ID } from "./seed-data";

const nowIso = () => new Date().toISOString();

const discounts: PricingEntry[] = [
  {
    id: "disc-sibling-10",
    tenantId: TENANT_ID,
    category: "discount",
    qualifier: "sibling_10",
    label: "Fratrie — 2ème enfant (-10%)",
    amount: 10,
    discountType: "percentage",
    isActive: true,
    updatedAt: nowIso(),
    updatedBy: "usr-adm-001",
  },
  {
    id: "disc-sibling-15",
    tenantId: TENANT_ID,
    category: "discount",
    qualifier: "sibling_15",
    label: "Fratrie — 3ème enfant et + (-15%)",
    amount: 15,
    discountType: "percentage",
    isActive: true,
    updatedAt: nowIso(),
    updatedBy: "usr-adm-001",
  },
  {
    id: "disc-early-bird",
    tenantId: TENANT_ID,
    category: "discount",
    qualifier: "early_bird",
    label: "Paiement anticipé annuel (-5%)",
    amount: 5,
    discountType: "percentage",
    isActive: true,
    updatedAt: nowIso(),
    updatedBy: "usr-adm-001",
  },
];

const additionalServices: PricingEntry[] = [
  {
    id: "svc-canteen-term",
    tenantId: TENANT_ID,
    category: "additional",
    qualifier: "canteen_term",
    label: "Cantine — trimestre",
    amount: 12000,
    isActive: true,
    updatedAt: nowIso(),
    updatedBy: "usr-adm-001",
  },
  {
    id: "svc-uniform",
    tenantId: TENANT_ID,
    category: "additional",
    qualifier: "uniform",
    label: "Uniforme scolaire",
    amount: 8500,
    isActive: true,
    updatedAt: nowIso(),
    updatedBy: "usr-adm-001",
  },
  {
    id: "svc-books",
    tenantId: TENANT_ID,
    category: "additional",
    qualifier: "books",
    label: "Livres et fournitures",
    amount: 6500,
    isActive: true,
    updatedAt: nowIso(),
    updatedBy: "usr-adm-001",
  },
  {
    id: "svc-chess-club",
    tenantId: TENANT_ID,
    category: "additional",
    qualifier: "chess_club",
    label: "Club d'échecs (annuel)",
    amount: 9000,
    isActive: true,
    updatedAt: nowIso(),
    updatedBy: "usr-adm-001",
  },
  {
    id: "svc-english-club",
    tenantId: TENANT_ID,
    category: "additional",
    qualifier: "english_club",
    label: "Club d'anglais (annuel)",
    amount: 11000,
    isActive: true,
    updatedAt: nowIso(),
    updatedBy: "usr-adm-001",
  },
  {
    id: "svc-speech-therapy",
    tenantId: TENANT_ID,
    category: "additional",
    qualifier: "speech_therapy",
    label: "Séance d'orthophonie",
    amount: 2500,
    isActive: true,
    updatedAt: nowIso(),
    updatedBy: "usr-adm-001",
  },
];

export const defaultPricingConfig: PricingConfig = {
  tuitionByLevel: {
    primaire: 54000,
    cem: 62000,
    lycee: 72000,
  },
  transportByTier: {
    t1: 18000,
    t2: 24000,
    t3: 30000,
  },
  registrationFee: 5000,
  monthlyByLevel: {
    primaire: 6000,
    cem: 6800,
    lycee: 7800,
  },
  latePenaltyPerDay: 100,
  discounts,
  additionalServices,
};
