/**
 * Field classifier (T-399 / OPS-321) — maps a DOM form control to a
 * semantic kind so the generator produces the RIGHT shape of value.
 *
 * Signals, in priority order:
 *   1. the input's declared `type` (email/tel/date/number/password/url…);
 *   2. the field's human text — the associated <label> (the FormField
 *      pattern), aria-label/aria-labelledby, placeholder, id and name;
 *   3. French-first vocabulary (the app's actual labels — the 83rd-session
 *      census: Prénom / Nom / Genre / Téléphone / WhatsApp / E-mail /
 *      Profession / Adresse / Ville / Date de naissance / Montant / Notes /
 *      Code / Classe / Niveau …) + Arabic and English synonyms (the app is
 *      tri-lingual since T-385/T-388).
 *
 * Matching is accent-insensitive, case-insensitive, word-boundary aware
 * where it matters ("Prénom" must never classify as "Nom").
 */

export type FieldKind =
  | "firstName"
  | "lastName"
  | "fullName"
  | "gender"
  | "phone"
  | "whatsapp"
  | "email"
  | "url"
  | "birthDate"
  | "hireDate"
  | "dueDate"
  | "date"
  | "time"
  | "amount"
  | "year"
  | "number"
  | "city"
  | "address"
  | "occupation"
  | "notes"
  | "code"
  | "reference"
  | "password"
  | "genericText";

/** Normalize for matching: lowercase + strip French/Arabic diacritics.
 *  NOTE: NFD decomposes Arabic hamza carriers too (أ U+0623 → ا + U+0654),
 *  so the Arabic-mark strip range MUST cover U+064b–U+065f, and the RULE
 *  patterns must go through THIS SAME function (module init below) — a
 *  precomposed pattern can never match its own decomposed input. */
export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Latin combining accents
    .replace(/[\u064b-\u065f]/g, "") // Arabic harakat + combining hamzas
    .replace(/\s+/g, " ")
    .trim();
}

interface Rule {
  readonly kind: FieldKind;
  /** Latin-script pattern — \b-bounded (word boundaries are ASCII-only in
   *  JS, which is exactly right for accented Latin words). */
  readonly latin: RegExp;
  /** Arabic-script words — UNBOUNDED substring match: JS `\b` never
   *  matches around Arabic letters (they are non-word chars for the ASCII
   *  boundary engine), so bounded Arabic patterns silently never fire.
   *  The words are normalized through normalizeText AT MODULE INIT so a
   *  precomposed أ in the source matches a decomposed input. */
  readonly arabic?: RegExp;
}

/** Compile Arabic words into a normalized alternation. */
const ar = (...words: string[]): RegExp => new RegExp(words.map((w) => normalizeText(w)).filter(Boolean).join("|"));

/**
 * Ordered rules — FIRST match wins; the order encodes the precedence
 * (whatsapp before phone, birthDate before date, firstName before
 * lastName, amount before number, code/reference before generic text).
 */
const RULES: readonly Rule[] = [
  { kind: "firstName", latin: /\b(prenom|first name|given name|deuxieme prenom)\b/, arabic: ar("الاسم الأول", "الاسم الشخصي") },
  { kind: "fullName", latin: /(nom complet|full name|display name|nom affiche)/, arabic: ar("الاسم الكامل") },
  { kind: "lastName", latin: /\b(nom de famille|last name|family name|surname|nom)\b/, arabic: ar("اللقب", "اسم العائلة") },
  { kind: "gender", latin: /\b(genre|sexe|gender)\b/, arabic: ar("الجنس") },
  { kind: "whatsapp", latin: /(whatsapp)/, arabic: ar("واتساب", "واتس") },
  { kind: "phone", latin: /\b(tel|telephone|phone|mobile|portable)\b/, arabic: ar("هاتف", "جوال", "رقم الهاتف") },
  { kind: "email", latin: /(e-mail|email|courriel|mail)/, arabic: ar("بريد", "البريد") },
  { kind: "birthDate", latin: /(naissance|birth)/, arabic: ar("تاريخ الميلاد", "الميلاد") },
  { kind: "hireDate", latin: /(embauche|hiring|hire date|recrutement)/, arabic: ar("التوظيف") },
  { kind: "dueDate", latin: /(echeance|deadline|due date|expiration)/, arabic: ar("الاستحقاق", "موعد") },
  { kind: "password", latin: /(mot de passe|password|passphrase)/, arabic: ar("كلمة السر", "كلمة المرور") },
  { kind: "code", latin: /\b(code|activation)\b/, arabic: ar("كود", "رمز التفعيل") },
  { kind: "reference", latin: /(reference|ref |num de cheque|n° de cheque|numero de cheque|cheque|transaction|receipt number)/, arabic: ar("مرجع", "رقم الشيك") },
  { kind: "amount", latin: /\b(montant|amount|prix|tarif|total|solde|reste|remise|salaire|revenu|budget|cout|frais|dzd)\b/, arabic: ar("المبلغ", "السعر", "الأجر", "دج") },
  { kind: "year", latin: /\b(annee|annee scolaire|year)\b/, arabic: ar("السنة الدراسية", "السنة") },
  { kind: "city", latin: /\b(ville|commune|city)\b/, arabic: ar("المدينة", "البلدية") },
  { kind: "address", latin: /(adresse|address)/, arabic: ar("العنوان") },
  { kind: "occupation", latin: /\b(profession|metier|occupation|job)\b/, arabic: ar("المهنة", "الوظيفة") },
  { kind: "notes", latin: /\b(note|notes|remarque|observation|commentaire|description)\b/, arabic: ar("ملاحظات", "ملاحظ", "وصف") },
];

/** Classify from the declared input type alone (no label needed). */
export function kindFromInputType(type: string | null | undefined): FieldKind | null {
  switch ((type ?? "text").toLowerCase()) {
    case "email":
      return "email";
    case "tel":
      return "phone";
    case "date":
      return "date";
    case "datetime-local":
      return "date";
    case "time":
      return "time";
    case "number":
      return "number";
    case "password":
      return "password";
    case "url":
      return "url";
    default:
      return null;
  }
}

/**
 * Full classification: the TEXT signal wins over the type signal when it
 * is MORE specific (a type=tel field labelled "WhatsApp" is WhatsApp; a
 * type=text field labelled "Montant" is an amount) — otherwise the type
 * decides (a bare type=date is a generic date).
 */
export function classifyField(text: string, type: string | null | undefined): FieldKind {
  const norm = normalizeText(text);
  for (const rule of RULES) {
    if (rule.latin.test(norm)) return rule.kind;
    if (rule.arabic?.test(norm)) return rule.kind;
  }
  return kindFromInputType(type) ?? "genericText";
}

/** Does this kind want a NUMBER value (amount/year/number)? */
export function isNumericKind(kind: FieldKind): boolean {
  return kind === "amount" || kind === "year" || kind === "number";
}

/** Does this kind want a DATE value (any flavor)? */
export function isDateKind(kind: FieldKind): boolean {
  return kind === "birthDate" || kind === "hireDate" || kind === "dueDate" || kind === "date";
}
