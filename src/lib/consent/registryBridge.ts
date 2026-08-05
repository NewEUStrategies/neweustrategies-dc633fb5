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
import { GPC_CLAMPED_REGISTRY_KEYS } from "@/lib/consent/gpc";
import { getConsentDefinition } from "@/lib/notifications/consentCatalog";

/** Skąd pochodzi decyzja - trafia do user_consent_events.source. */
export type ConsentDecisionSource =
  | "cmp_banner"
  | "profile_privacy"
  | "notifications_center"
  | "login_sync"
  /**
   * Wycofanie wymuszone sygnałem Global Privacy Control (`Sec-GPC` /
   * `navigator.globalPrivacyControl`). Nie jest decyzją podjętą w UI, więc ma
   * własne źródło - audytor musi widzieć, że zgodę zdjął sygnał przeglądarki,
   * a nie klik w banerze.
   */
  | "gpc_signal";

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
  "gpc_signal",
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
  /**
   * Czy w momencie decyzji aktywny był sygnał GPC. Trafia do kolumny
   * `user_consent_events.gpc` - bez tego audyt nie potrafiłby odpowiedzieć na
   * pytanie "czy zgoda została udzielona wbrew sygnałowi opt-outu".
   */
  gpc?: boolean;
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
  gpc = false,
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
      gpc,
    });
  }
  return entries;
}

/**
 * Wpisy wycofania wymuszonego sygnałem GPC. Obejmują WSZYSTKIE klucze
 * klamrowane sygnałem - także `personalization`, którego CMP nie zna (nie jest
 * kategorią cookie, ale jest profilowaniem, więc sygnał go dotyczy).
 */
export function buildGpcWithdrawalEntries(lang?: "pl" | "en"): RegistryEntry[] {
  const entries: RegistryEntry[] = [];
  for (const key of GPC_CLAMPED_REGISTRY_KEYS) {
    const def = getConsentDefinition(key);
    if (!def) continue;
    entries.push({
      key,
      given: false,
      version: def.version,
      lang,
      source: "gpc_signal",
      gpc: true,
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

/** Kategorie CMP bez żadnego wpisu cookies_* w rejestrze (do backfillu). */
export function missingRegistryCategories(
  presentKeys: ReadonlySet<string>,
): AuditableCmpCategory[] {
  return AUDITABLE_CMP_CATEGORIES.filter((cat) => !presentKeys.has(CMP_TO_REGISTRY[cat]));
}

// -------------------- Metadane decyzji (audyt) --------------------

/**
 * Wersja banera zgód zapisywana przy każdym zdarzeniu. Wyprowadzona z wersji
 * kategorii cookie w katalogu (ta z kolei jest sprzęgnięta z CONSENT_VERSION
 * z `src/lib/ads/consent.ts` testem inwariantu) - dzięki temu bump treści
 * banera automatycznie odcina stare decyzje w audycie, bez drugiego licznika.
 */
export const CONSENT_BANNER_VERSION = `cmp-v${
  getConsentDefinition("cookies_analytics")?.version ?? "2.0"
}`;

/**
 * Identyfikator JEDNEJ decyzji. Jedno kliknięcie „Zapisz” potrafi zmienić kilka
 * kategorii - bez wspólnego id audytor widziałby N niezależnych zdarzeń zamiast
 * jednej decyzji obejmującej zbiór kategorii.
 */
function newDecisionId(): string | undefined {
  try {
    return globalThis.crypto?.randomUUID?.();
  } catch {
    return undefined;
  }
}

/** Adres strony, na której decyzja zapadła (bez query - może nieść PII). */
function currentPageUrl(): string | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const u = new URL(window.location.href);
    return `${u.origin}${u.pathname}`.slice(0, 500);
  } catch {
    return undefined;
  }
}

/** Doklej metadane audytowe wspólne dla całej partii wpisów. */
export function withDecisionMetadata(entries: RegistryEntry[]): RegistryEntry[] {
  const decisionId = newDecisionId();
  const pageUrl = currentPageUrl();
  return entries.map((e) => ({
    ...e,
    bannerVersion: e.bannerVersion ?? CONSENT_BANNER_VERSION,
    decisionId: e.decisionId ?? decisionId,
    pageUrl: e.pageUrl ?? pageUrl,
  }));
}


// Kolejka FIFO zapisów do rejestru (per karta). Dwie szybkie decyzje to dwa
// niezależne requesty bez gwarancji kolejności dostarczenia - wolniejszy,
// STARSZY zapis mógłby nadpisać nowszą decyzję w user_consents i pomieszać
// chronologię audytu. Łańcuch promise gwarantuje, że zapisy wychodzą w
// kolejności podejmowania decyzji; zadania łykają własne błędy, więc łańcuch
// nigdy nie pęka.
let writeChain: Promise<void> = Promise.resolve();
function enqueueRegistryWrite(task: () => Promise<void>): Promise<void> {
  const run = writeChain.then(task);
  writeChain = run.catch(() => undefined);
  return run;
}

async function pushEntriesToRegistry(entries: RegistryEntry[]): Promise<void> {
  const { setMyConsentsBulk } = await import("@/lib/consents.functions");
  await setMyConsentsBulk({ data: { entries } });
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(REGISTRY_SYNC_EVENT));
  }
}

/**
 * Dopisz decyzję CMP do rejestru RODO zalogowanego użytkownika.
 * Fire-and-forget: brak sesji / offline / błąd serwera nie może zablokować
 * samej decyzji cookie (ta jest już trwała lokalnie i w profilu) - rejestr
 * jest najlepszym możliwym śladem, nie warunkiem działania CMP.
 */
export function syncCmpDecisionToRegistry(
  prev: ConsentState | null,
  next: ConsentState,
  source: ConsentDecisionSource,
  gpcActive = false,
): Promise<void> {
  // Diff liczony synchronicznie w momencie decyzji; kolejka serializuje tylko
  // sam transport, więc chronologia audytu = chronologia decyzji.
  const changed = diffCmpCategories(prev, next);
  if (changed.length === 0) return Promise.resolve();
  const entries = buildRegistryEntries(
    changed,
    next,
    normalizeDecisionSource(source),
    detectLang(),
    gpcActive,
  );
  if (entries.length === 0) return Promise.resolve();

  return enqueueRegistryWrite(async () => {
    try {
      const { supabase } = await import("@/integrations/supabase/client");
      const { data: sess } = await supabase.auth.getSession();
      if (!sess?.session?.user?.id) return;
      await pushEntriesToRegistry(entries);
    } catch {
      // Świadomie cicho: audyt rejestru jest best-effort z perspektywy klienta.
    }
  });
}

// -------------------- Backfill przy logowaniu --------------------

const BACKFILL_FLAG_PREFIX = "consent:registry-backfill:v1:";
const backfillInFlight = new Map<string, Promise<void>>();

function backfillFlagDone(userId: string): boolean {
  try {
    return window.localStorage.getItem(`${BACKFILL_FLAG_PREFIX}${userId}`) === "1";
  } catch {
    return false;
  }
}

function markBackfillDone(userId: string): void {
  try {
    window.localStorage.setItem(`${BACKFILL_FLAG_PREFIX}${userId}`, "1");
  } catch {
    /* private mode - trudno, sprawdzimy rejestr ponownie następnym razem */
  }
}

/**
 * Backfill rejestru RODO przy logowaniu, sterowany BRAKIEM wpisów cookies_*
 * w rejestrze (nie brakiem prefs.consent w profilu). Pokrywa dwa przypadki:
 * decyzję podjętą anonimowo, która właśnie zyskała podmiot, oraz konta sprzed
 * unifikacji, które mają zsynchronizowany profil, ale zero śladu w audycie
 * (późniejsze zapisy diffują tylko ZMIENIONE kategorie, więc bez backfillu
 * nietknięte kategorie nigdy nie dostałyby wpisu).
 *
 * Deduplikacja: flaga per użytkownik w localStorage (kolejne sesje) + mapa
 * in-flight na poziomie modułu (wiele instancji useConsent reagujących na ten
 * sam event auth - __root, ConsentBanner, injector skryptów). Zapis idzie tą
 * samą kolejką FIFO co zwykłe decyzje, więc backfill nie wyprzedzi świeższej
 * decyzji użytkownika podjętej tuż po zalogowaniu.
 *
 * Świadomy zakres: uzupełniamy tylko BRAKUJĄCE klucze - istniejących wpisów
 * nie nadpisujemy stanem z tego urządzenia; rozjazd wartości domyka pierwsza
 * jawna decyzja (diff w syncCmpDecisionToRegistry).
 */
export function backfillRegistryOnLogin(
  state: ConsentState,
  userId: string,
  gpcActive = false,
): Promise<void> {
  if (typeof window === "undefined" || !userId) return Promise.resolve();
  if (backfillFlagDone(userId)) return Promise.resolve();
  const inFlight = backfillInFlight.get(userId);
  if (inFlight) return inFlight;

  const run = enqueueRegistryWrite(async () => {
    try {
      const { listMyConsents } = await import("@/lib/consents.functions");
      const rows = (await listMyConsents()) as Array<{ consent_key: string }>;
      const present = new Set(rows.map((r) => r.consent_key));
      const missing = missingRegistryCategories(present);
      if (missing.length > 0) {
        const entries = buildRegistryEntries(missing, state, "login_sync", detectLang(), gpcActive);
        await pushEntriesToRegistry(entries);
      }
      markBackfillDone(userId);
    } catch {
      // Best-effort: bez flagi "done" spróbujemy ponownie przy następnym
      // evencie auth.
    }
  }).finally(() => {
    backfillInFlight.delete(userId);
  });

  backfillInFlight.set(userId, run);
  return run;
}

// -------------------- Wycofanie wymuszone sygnałem GPC --------------------

// Deduplikacja per użytkownik: sygnał GPC nie zmienia się między nawigacjami, a
// `onAuthStateChange` odpala się przy każdym INITIAL_SESSION - bez tej flagi
// rejestr dostawałby identyczne wycofanie przy każdym otwarciu karty i historia
// decyzji zamieniłaby się w log nawigacji.
const GPC_SYNC_FLAG_PREFIX = "consent:gpc-registry:v1:";
const gpcSyncInFlight = new Map<string, Promise<void>>();

function gpcSyncDone(userId: string): boolean {
  try {
    return window.localStorage.getItem(`${GPC_SYNC_FLAG_PREFIX}${userId}`) === "1";
  } catch {
    return false;
  }
}

function markGpcSyncDone(userId: string): void {
  try {
    window.localStorage.setItem(`${GPC_SYNC_FLAG_PREFIX}${userId}`, "1");
  } catch {
    /* private mode - powtórzymy przy następnym evencie auth */
  }
}

/**
 * Czy trzeba dopisać wycofanie GPC: tylko dla kluczy, których rejestr NIE ma
 * jeszcze jako wycofanych. Wpis już wycofany (albo przez sygnał, albo ręcznie)
 * jest zgodny ze skutkiem sygnału - powtarzanie go byłoby szumem w audycie.
 */
export function gpcWithdrawalsNeeded(
  registryState: ReadonlyMap<string, boolean>,
): readonly string[] {
  return GPC_CLAMPED_REGISTRY_KEYS.filter((key) => registryState.get(key) !== false);
}

/**
 * Dopisz do rejestru RODO wycofanie wymuszone sygnałem GPC (źródło
 * `gpc_signal`, `gpc = true`). Sygnał jest sprzeciwem art. 21 RODO i wycofaniem
 * zgody art. 7 ust. 3 - musi mieć ślad audytowy z IP/UA/wersją, nie tylko efekt
 * w runtime. Fire-and-forget: klamra działa niezależnie od powodzenia zapisu.
 *
 * Wywoływane po `backfillRegistryOnLogin`, żeby wycofanie było w audycie
 * chronologicznie PO stanie, który wycofuje.
 */
export function syncGpcSignalToRegistry(userId: string): Promise<void> {
  if (typeof window === "undefined" || !userId) return Promise.resolve();
  if (gpcSyncDone(userId)) return Promise.resolve();
  const inFlight = gpcSyncInFlight.get(userId);
  if (inFlight) return inFlight;

  const run = enqueueRegistryWrite(async () => {
    try {
      const { listMyConsents } = await import("@/lib/consents.functions");
      const rows = (await listMyConsents()) as Array<{ consent_key: string; given: boolean }>;
      const current = new Map(rows.map((r) => [r.consent_key, r.given]));
      const needed = new Set(gpcWithdrawalsNeeded(current));
      if (needed.size > 0) {
        const entries = buildGpcWithdrawalEntries(detectLang()).filter((e) => needed.has(e.key));
        if (entries.length > 0) await pushEntriesToRegistry(entries);
      }
      markGpcSyncDone(userId);
    } catch {
      // Best-effort: bez flagi spróbujemy ponownie przy następnym evencie auth.
    }
  }).finally(() => {
    gpcSyncInFlight.delete(userId);
  });

  gpcSyncInFlight.set(userId, run);
  return run;
}
