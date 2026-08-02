// Most CMP -> audytowany rejestr RODO. Zamyka "rozjazd z CMP" (audyt M15/M19):
// do tej pory decyzje cookie z banera i /profile/privacy żyły wyłącznie w
// localStorage/cookie/profiles.prefs.consent, bez śladu w rejestrze
// user_consents/user_consent_events (IP/UA/wersja/źródło). Ten moduł mapuje
// kategorie CMP na klucze katalogu zgód (`cookies_*`) i - dla zalogowanego
// użytkownika - dopisuje każdą decyzję do rejestru przez utwardzony RPC
// SECURITY DEFINER `set_user_consent` (server-fn czyta IP/UA po stronie
// serwera; tabele intake pozostają zamknięte dla klienta - inwariant bramki
// check-sql-anon-insert nietknięty).
//
// Zasada jednego pisarza: stan runtime zgód cookie ZAWSZE zapisuje ścieżka CMP
// (setConsent w src/lib/ads/consent.ts); rejestr jest śladem audytowym, nigdy
// źródłem prawdy dla bramkowania skryptów.
import type { ConsentCategory, ConsentState } from "@/lib/ads/consent";
import { getConsentDefinition } from "@/lib/notifications/consentCatalog";

/** Skąd pochodzi decyzja - trafia do user_consent_events.source. */
export type ConsentDecisionSource =
  | "cmp_banner"
  | "profile_privacy"
  | "notifications_center"
  | "login_sync";

/** Kategorie CMP objęte audytem (necessary jest zawsze true - bez decyzji). */
export type AuditableCmpCategory = Exclude<ConsentCategory, "necessary">;

export const CMP_TO_REGISTRY: Readonly<Record<AuditableCmpCategory, string>> = {
  functional: "cookies_functional",
  analytics: "cookies_analytics",
  marketing: "cookies_marketing",
};

export const REGISTRY_TO_CMP: Readonly<Record<string, AuditableCmpCategory>> = {
  cookies_functional: "functional",
  cookies_analytics: "analytics",
  cookies_marketing: "marketing",
};

export const AUDITABLE_CMP_CATEGORIES = Object.keys(
  CMP_TO_REGISTRY,
) as readonly AuditableCmpCategory[];

/** Panele z zapytaniami o rejestr nasłuchują tego eventu po synchronizacji. */
export const REGISTRY_SYNC_EVENT = "consent-registry-sync";

const VALID_SOURCES: ReadonlySet<string> = new Set([
  "cmp_banner",
  "profile_privacy",
  "notifications_center",
  "login_sync",
]);

/**
 * Runtime-owa sanityzacja źródła: acceptAll/rejectAll bywają podpinane wprost
 * pod onClick, więc pierwszym argumentem może przypadkiem być MouseEvent -
 * wtedy wracamy do bezpiecznego domyślnego "cmp_banner".
 */
export function normalizeDecisionSource(source: unknown): ConsentDecisionSource {
  return typeof source === "string" && VALID_SOURCES.has(source)
    ? (source as ConsentDecisionSource)
    : "cmp_banner";
}

export interface RegistryEntry {
  key: string;
  given: boolean;
  version: string;
  lang?: "pl" | "en";
  source?: string;
}

/**
 * Kategorie, których wartość faktycznie się zmieniła. Brak poprzedniego stanu
 * (pierwsza decyzja) = wszystkie kategorie, bo każda jest świeżą decyzją.
 * Zapis bez zmian (ponowny klik "zapisz") -> pusta lista, zero szumu w audycie.
 */
export function diffCmpCategories(
  prev: ConsentState | null,
  next: ConsentState,
): AuditableCmpCategory[] {
  if (!prev) return [...AUDITABLE_CMP_CATEGORIES];
  return AUDITABLE_CMP_CATEGORIES.filter((cat) => prev.categories[cat] !== next.categories[cat]);
}

/** Zbuduj wpisy rejestru dla zmienionych kategorii (wersja z katalogu zgód). */
export function buildRegistryEntries(
  categories: readonly AuditableCmpCategory[],
  state: ConsentState,
  source: ConsentDecisionSource,
  lang?: "pl" | "en",
): RegistryEntry[] {
  const entries: RegistryEntry[] = [];
  for (const cat of categories) {
    const key = CMP_TO_REGISTRY[cat];
    const def = getConsentDefinition(key);
    if (!def) continue; // klucz poza katalogiem - walidator server-fn i tak odrzuci
    entries.push({
      key,
      given: !!state.categories[cat],
      version: def.version,
      lang,
      source,
    });
  }
  return entries;
}

function detectLang(): "pl" | "en" | undefined {
  if (typeof document === "undefined") return undefined;
  const lang = document.documentElement.lang?.toLowerCase() ?? "";
  if (lang.startsWith("en")) return "en";
  if (lang.startsWith("pl")) return "pl";
  return undefined;
}

/**
 * Dopisz decyzję CMP do rejestru RODO zalogowanego użytkownika.
 * Fire-and-forget: brak sesji / offline / błąd serwera nie może zablokować
 * samej decyzji cookie (ta jest już trwała lokalnie i w profilu) - rejestr
 * jest najlepszym możliwym śladem, nie warunkiem działania CMP.
 */
export async function syncCmpDecisionToRegistry(
  prev: ConsentState | null,
  next: ConsentState,
  source: ConsentDecisionSource,
): Promise<void> {
  try {
    const { supabase } = await import("@/integrations/supabase/client");
    const { data: sess } = await supabase.auth.getSession();
    if (!sess?.session?.user?.id) return;

    const changed = diffCmpCategories(prev, next);
    if (changed.length === 0) return;

    const entries = buildRegistryEntries(
      changed,
      next,
      normalizeDecisionSource(source),
      detectLang(),
    );
    if (entries.length === 0) return;

    const { setMyConsentsBulk } = await import("@/lib/consents.functions");
    await setMyConsentsBulk({ data: { entries } });

    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event(REGISTRY_SYNC_EVENT));
    }
  } catch {
    // Świadomie cicho: audyt rejestru jest best-effort z perspektywy klienta.
  }
}
