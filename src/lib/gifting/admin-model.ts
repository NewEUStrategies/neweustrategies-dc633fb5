// "Udostepnij pelny artykul" - czysta logika domenowa PANELU ADMINA (zero
// React/Supabase). Jedno zrodlo prawdy dla zakresow limitow (lustro CHECK-ow z
// bazy), draftu formularza ustawien (puste pole != 0!), bramki uprawnienia i
// semantyki budzetu klikniec. Wspoldzielone przez server functions (schemat
// wejscia) i route admin.gifting.tsx (formularz), wiec UI, walidacja serwerowa
// i baza nie moga sie rozjechac po cichu.
import type { GiftEligibility } from "@/lib/gifting/model";

/** Ustawienia gifting edytowalne w panelu (wiersz gift_article_settings). */
export interface GiftAdminSettings {
  enabled: boolean;
  monthly_limit: number;
  link_ttl_days: number;
  max_redemptions_per_link: number;
  /** Kto moze wygenerowac link - patrz GiftEligibility (model.ts). */
  eligibility: GiftEligibility;
}

/** Opcje przelacznika uprawnienia w panelu (kolejnosc = kolejnosc renderowania). */
export const GIFT_ELIGIBILITY_OPTIONS: readonly GiftEligibility[] = [
  "registered",
  "subscribers",
] as const;

/** Pola liczbowe formularza - kolejnosc = kolejnosc renderowania w panelu. */
export const GIFT_ADMIN_LIMIT_FIELDS = [
  "monthly_limit",
  "link_ttl_days",
  "max_redemptions_per_link",
] as const;

export type GiftAdminLimitField = (typeof GIFT_ADMIN_LIMIT_FIELDS)[number];

export interface GiftAdminBounds {
  min: number;
  max: number;
  /** Bezpieczna domyslna - lustro DEFAULT kolumny i fallbackow RPC. */
  fallback: number;
}

/**
 * Zakresy limitow - MUSZA odzwierciedlac CHECK-i z migracji:
 *   monthly_limit BETWEEN 0 AND 1000        (20260722112736)
 *   link_ttl_days BETWEEN 0 AND 365         (20260722112736)
 *   max_redemptions_per_link 0..100000      (20260724090600)
 * Fallbacki = bezpieczne domyslne po migracji 20260806170000 (10/30/5),
 * uzywane tez przez create_gift_link/redeem_gift_link przy braku wiersza.
 */
export const GIFT_ADMIN_BOUNDS: Record<GiftAdminLimitField, GiftAdminBounds> = {
  monthly_limit: { min: 0, max: 1000, fallback: 10 },
  link_ttl_days: { min: 0, max: 365, fallback: 30 },
  max_redemptions_per_link: { min: 0, max: 100000, fallback: 5 },
};

/**
 * Ustawienia efektywne przy BRAKU wiersza w gift_article_settings - dokladnie
 * to, co wyegzekwuje baza (DEFAULT-y kolumn i fallbacki SECURITY DEFINER RPC).
 * Panel pokazujacy cokolwiek innego wprowadzalby admina w blad.
 */
export const DEFAULT_GIFT_ADMIN_SETTINGS: GiftAdminSettings = {
  enabled: true,
  monthly_limit: GIFT_ADMIN_BOUNDS.monthly_limit.fallback,
  link_ttl_days: GIFT_ADMIN_BOUNDS.link_ttl_days.fallback,
  max_redemptions_per_link: GIFT_ADMIN_BOUNDS.max_redemptions_per_link.fallback,
  eligibility: "registered",
};

/**
 * Draft formularza: pole liczbowe moze byc chwilowo PUSTE (null) podczas
 * edycji. Celowo NIE koercjujemy pustego pola do 0 - w tej domenie 0 oznacza
 * "bez limitu" (obejscie paywalla), wiec ciche 0 po skasowaniu wartosci
 * byloby dokladnie ta pulapka, ktora naprawiala migracja 20260724090600.
 */
export interface GiftAdminSettingsDraft {
  enabled: boolean;
  monthly_limit: number | null;
  link_ttl_days: number | null;
  max_redemptions_per_link: number | null;
  eligibility: GiftEligibility;
}

export function toGiftAdminDraft(settings: GiftAdminSettings): GiftAdminSettingsDraft {
  return {
    enabled: settings.enabled,
    monthly_limit: settings.monthly_limit,
    link_ttl_days: settings.link_ttl_days,
    max_redemptions_per_link: settings.max_redemptions_per_link,
    eligibility: settings.eligibility,
  };
}

/**
 * Parsuje surowa wartosc z <input type="number"> do draftu. Puste pole i
 * nie-liczby daja null (pole "w edycji"), nigdy NaN (NaN w controlled input
 * psul zapis i renderowal ostrzezenia Reacta). Ulamki sa obcinane - wszystkie
 * limity sa calkowite.
 */
export function parseGiftAdminLimitInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return null;
  return Math.trunc(parsed);
}

export type GiftAdminDraftIssue = "required" | "range";

export type GiftAdminDraftIssues = Partial<Record<GiftAdminLimitField, GiftAdminDraftIssue>>;

/** Waliduje draft pole po polu; pusty wynik = draft gotowy do zapisu. */
export function validateGiftAdminDraft(draft: GiftAdminSettingsDraft): GiftAdminDraftIssues {
  const issues: GiftAdminDraftIssues = {};
  for (const field of GIFT_ADMIN_LIMIT_FIELDS) {
    const value = draft[field];
    if (value === null) {
      issues[field] = "required";
    } else if (value < GIFT_ADMIN_BOUNDS[field].min || value > GIFT_ADMIN_BOUNDS[field].max) {
      issues[field] = "range";
    }
  }
  return issues;
}

/** Kompletny, poprawny draft -> ustawienia do zapisu; w przeciwnym razie null. */
export function draftToGiftAdminSettings(draft: GiftAdminSettingsDraft): GiftAdminSettings | null {
  const { enabled, monthly_limit, link_ttl_days, max_redemptions_per_link, eligibility } = draft;
  if (monthly_limit === null || link_ttl_days === null || max_redemptions_per_link === null) {
    return null;
  }
  if (Object.keys(validateGiftAdminDraft(draft)).length > 0) return null;
  return { enabled, monthly_limit, link_ttl_days, max_redemptions_per_link, eligibility };
}

/** Rownosc ustawien - do wykrywania "brak zmian" (przycisk zapisu nieaktywny). */
export function giftAdminSettingsEqual(a: GiftAdminSettings, b: GiftAdminSettings): boolean {
  return (
    a.enabled === b.enabled &&
    a.eligibility === b.eligibility &&
    GIFT_ADMIN_LIMIT_FIELDS.every((field) => a[field] === b[field])
  );
}

/**
 * Czy link wyczerpal budzet klikniec - lustro warunku z redeem_gift_link:
 * `v_cap > 0 AND redemption_count >= v_cap`, gdzie v_cap jest ZAMROZONY na
 * linku (post_gift_links.max_redemptions), nie czytany z biezacych ustawien.
 * Cap 0 = bez limitu (nigdy nie wyczerpany).
 */
export function giftCapExhausted(redemptionCount: number, cap: number): boolean {
  return cap > 0 && redemptionCount >= cap;
}
