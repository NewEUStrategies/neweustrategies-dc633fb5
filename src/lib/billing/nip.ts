// Walidacja identyfikatorów podatkowych na fakturze (NIP / VAT ID).
// Audyt platformy wskazał NIP jako wolny tekst bez walidacji - tu jest pełna
// suma kontrolna dla polskiego NIP-u oraz łagodna walidacja formatu dla
// pozostałych krajów UE (checkout Stripe z tax_id_collection i tak weryfikuje
// identyfikator po swojej stronie; my chronimy fakturę przed literówkami).

export type TaxIdValidation =
  | { ok: true; normalized: string }
  | { ok: false; reason: "format" | "checksum" };

/** Usuwa separatory (spacje, myślniki, kropki) i normalizuje wielkość liter. */
export function normalizeTaxId(raw: string): string {
  return raw.replace(/[\s.-]/g, "").toUpperCase();
}

const PL_NIP_WEIGHTS = [6, 5, 7, 2, 3, 4, 5, 6, 7] as const;

/**
 * Polski NIP: 10 cyfr, suma kontrolna modulo 11 (wagi 6,5,7,2,3,4,5,6,7),
 * cyfra kontrolna nie może wynosić 10. Akceptuje zapis z prefiksem "PL".
 */
export function isValidPlNip(raw: string): boolean {
  const normalized = normalizeTaxId(raw).replace(/^PL/, "");
  if (!/^\d{10}$/.test(normalized)) return false;
  const digits = normalized.split("").map(Number);
  const sum = PL_NIP_WEIGHTS.reduce((acc, weight, i) => acc + weight * digits[i], 0);
  const control = sum % 11;
  if (control === 10) return false;
  return control === digits[9];
}

/**
 * Walidacja identyfikatora podatkowego względem kraju rozliczeniowego.
 * PL -> pełny checksum NIP; inne kraje -> łagodny format VAT ID (2-14 znaków
 * alfanumerycznych po opcjonalnym prefiksie kraju). Pusta wartość jest
 * dozwolona (pole opcjonalne) - decyzję "wymagane dla firm" podejmuje UI.
 */
export function validateTaxId(raw: string, countryCode: string): TaxIdValidation {
  const normalized = normalizeTaxId(raw);
  if (!normalized) return { ok: true, normalized: "" };

  if ((countryCode || "").toUpperCase() === "PL") {
    const digits = normalized.replace(/^PL/, "");
    if (!/^\d{10}$/.test(digits)) return { ok: false, reason: "format" };
    if (!isValidPlNip(digits)) return { ok: false, reason: "checksum" };
    return { ok: true, normalized: digits };
  }

  if (!/^[A-Z0-9]{2,16}$/.test(normalized)) return { ok: false, reason: "format" };
  return { ok: true, normalized };
}
