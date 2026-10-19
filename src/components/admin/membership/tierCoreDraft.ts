// Szkic RDZENIA warstwy w panelu Członkostwa - pola, patch i nałożenie szkicu
// na świeży wiersz po konflikcie (S1 def. 11, PLAN S1 V25).
//
// DLACZEGO OSOBNY SZKIC, a nie `TierDraft` z `lib/admin/membershipDrafts.ts`.
// Tamten szkic niesie też nazwy, opisy i benefity - z czasów, gdy Członkostwo
// zapisywało CAŁĄ warstwę i przy okazji zmiany rangi cofało benefity ustawione
// w Cenniku. Od S1 właścicielem marketingu jest Cennik (`TIER_MARKETING_COLUMNS`),
// a Członkostwo pisze wyłącznie rdzeń egzekwowany przez bramki:
// `rank`, `features`, `active`, `is_default` (`TIER_CORE_COLUMNS` bez `key` -
// klucz jest tożsamością warstwy w `access_plans.tier_key` i nadaniach, więc
// panel go nie zmienia). Szkicu, który nie ma pól marketingu, nie da się
// przypadkiem zapisać razem z nimi.
//
// PATCH = RÓŻNICA względem wiersza, na którym admin zaczął edycję; `features`
// porównywane po sparsowaniu, więc sam zapis bez zmian nie jest „zmianą".
import { parseFeaturesJson } from "@/lib/admin/membershipDrafts";
import type { MembershipTierRow, TierCorePatch } from "@/lib/billing/tierMutations";

export interface TierCoreDraft {
  rank: number;
  /** Surowy JSON bramek (tekst pola) - parsowany dopiero przy zapisie. */
  features: string;
  active: boolean;
  is_default: boolean;
}

export function coreDraftFromTier(tier: MembershipTierRow): TierCoreDraft {
  return {
    rank: tier.rank,
    features: JSON.stringify(tier.features ?? {}, null, 0),
    active: tier.active,
    is_default: tier.is_default,
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Kolumny rdzenia, w których szkic różni się od bazy. Niepoprawny JSON bramek
 * RZUCA (`InvalidFeaturesJsonError`) - zapis się nie odbywa, bo warstwa
 * z połamanymi bramkami nie otwiera niczego, za co klient zapłacił.
 */
export function corePatch(draft: TierCoreDraft, base: MembershipTierRow): TierCorePatch {
  const next: Required<Omit<TierCorePatch, "key">> = {
    rank: Math.round(draft.rank) || 0,
    features: parseFeaturesJson(draft.features),
    active: draft.active,
    is_default: draft.is_default,
  };
  const prev: Required<Omit<TierCorePatch, "key">> = {
    rank: base.rank,
    features: base.features ?? {},
    active: base.active,
    is_default: base.is_default,
  };
  const patch: TierCorePatch = {};
  for (const key of Object.keys(next) as (keyof typeof next)[]) {
    if (!same(next[key], prev[key])) Object.assign(patch, { [key]: next[key] });
  }
  return patch;
}

/**
 * Szkic po konflikcie: pola zmienione przez admina względem STAREJ bazy
 * wygrywają, reszta przychodzi ze świeżego wiersza (tam jest cudza zmiana).
 */
export function rebaseCoreDraft(
  draft: TierCoreDraft,
  oldBase: MembershipTierRow,
  freshBase: MembershipTierRow,
): TierCoreDraft {
  const before = coreDraftFromTier(oldBase);
  const out = coreDraftFromTier(freshBase);
  for (const key of Object.keys(draft) as (keyof TierCoreDraft)[]) {
    if (!same(draft[key], before[key])) Object.assign(out, { [key]: draft[key] });
  }
  return out;
}
