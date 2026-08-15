/**
 * Parent fixture factory — parametric, deterministic, no hardcoded arrays.
 */
import type { Parent, CreateParentInput, CityTier } from "../../../domain/model/parent";
import { makeRng, pad, buildCode, type Rng } from "./rng";

const FIRST_NAMES_FR_M = ["Karim", "Yacine", "Rachid", "Sofiane", "Hocine", "Toufik", "Nabil", "Samir"];
const FIRST_NAMES_FR_F = ["Amina", "Fatima", "Nadia", "Salima", "Yamina", "Leila", "Nawel", "Samira"];
const LAST_NAMES = ["Benali", "Cherif", "Mansouri", "Belkacem", "Khelifi", "Bouzid", "Saidi", "Touati", "Haddad", "Boudjelal"];
const OCCUPATIONS = ["Ingénieur", "Médecin", "Commerçant", "Enseignante", "Pharmacienne", "Chauffeur", "Fonctionnaire", "Avocat"];
const CITIES_T1 = ["Oran", "Bir El Djir", "Es Senia"];
const CITIES_T2 = ["Arzew", "Bethioua", "Boutlelis"];
const CITIES_T3 = ["Aïn El Türck", "Mers El Kébir", "Gdyel"];
const STREETS = ["rue des Frères Bouadou", "bd de la Soummam", "cité Es-Salem", "rue Larbi Ben M'hidi", "rue Mostaganem"];

export interface ParentFixtureOptions {
  tenantId: string;
  count: number;
  seed?: number;
}

export function buildParent(rng: Rng, idx: number, tenantId: string): Parent {
  const gender = rng.maybe(0.5) ? "male" : "female";
  const first = gender === "male" ? rng.pick(FIRST_NAMES_FR_M) : rng.pick(FIRST_NAMES_FR_F);
  const last = rng.pick(LAST_NAMES);
  const cityTier: CityTier = rng.pick(["t1", "t2", "t3"] as const);
  const city = cityTier === "t1" ? rng.pick(CITIES_T1) : cityTier === "t2" ? rng.pick(CITIES_T2) : rng.pick(CITIES_T3);
  const phone = `+213 ${rng.pick(["555", "661", "770", "559"])} ${pad(rng.int(10, 100), 2)} ${pad(rng.int(10, 100), 2)} ${pad(rng.int(10, 100), 2)}`;
  const hasWhatsapp = rng.maybe(0.6);
  const hasEmail = rng.maybe(0.55);
  const now = new Date("2025-09-15T10:00:00Z").toISOString();
  return {
    id: `par-${pad(idx + 1, 3)}`,
    tenantId,
    code: buildCode("PAR", 2025, rng),
    firstName: first,
    lastName: last,
    displayName: null,
    gender,
    phone,
    whatsapp: hasWhatsapp ? phone : null,
    email: hasEmail ? `${first.toLowerCase()}.${last.toLowerCase()}@example.dz` : null,
    occupation: rng.maybe(0.85) ? rng.pick(OCCUPATIONS) : null,
    address: `${rng.int(1, 60)} ${rng.pick(STREETS)}, ${city}`,
    cityTier,
    transportDestination: null,
    preferredLanguage: rng.maybe(0.7) ? "fr" : "ar",
    avatarUrl: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function buildParents(opts: ParentFixtureOptions): Parent[] {
  const rng = makeRng(opts.seed ?? 42);
  return Array.from({ length: opts.count }, (_, i) => buildParent(rng, i, opts.tenantId));
}

export function toCreateParentInput(p: Parent): CreateParentInput {
  return {
    firstName: p.firstName, lastName: p.lastName, gender: p.gender, phone: p.phone,
    whatsapp: p.whatsapp, email: p.email, occupation: p.occupation, address: p.address,
    cityTier: p.cityTier, preferredLanguage: p.preferredLanguage,
  };
}
