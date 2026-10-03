// Uniwersalny silnik analityki - fire-and-forget beacony do
// /api/public/track. Zdarzenia są buforowane w pamięci, wysyłane co
// FLUSH_INTERVAL_MS lub gdy bufor osiągnie MAX_BATCH; dodatkowo pełny
// flush przy pagehide/visibilitychange (`sendBeacon`, żeby nie stracić
// eventów w trakcie nawigacji). Respektuje zgodę analytics (RODO):
// gdy nie ma zgody, `track()` no-op-uje.
//
// Ten sam helper obsługuje kliknięcia CTA (rejestracja, checkout,
// kontakt, przełącznik miesięcznie/rocznie), odsłony stron/artykułów
// /autorów/ekspertów, wyszukiwania w wyszukiwarce wewnętrznej oraz
// kliknięcia banerów - zdarzenia są typowane po `name` i płaskim
// obiekcie `meta`, żeby dashboardy admin mogły je grupować bez
// dodatkowych migracji.

import { sendBeaconPayload } from "@/lib/observability/report";
import { redactPii } from "@/lib/observability/redact";
import { hasAnalyticsConsent } from "@/lib/ads/consent";
import { ga4Event, ga4PageView } from "./ga4Client";
import { redactTrackedHref, redactTrackedPath } from "./redactTrackedUrl";
import { ga4EventName, ga4EventParams } from "./ga4EventMap";

export interface AnalyticsEventInput {
  /** Techniczna klasa zdarzenia: page_view / cta_click / search / view / interaction. */
  type?: string;
  /** Nazwa biznesowa - np. `pricing_signup_click`, `pricing_interval_change`. */
  name: string;
  /** Encja, której dotyczy - post, page, author, expert, tier, plan, banner… */
  entityType?: string | null;
  entityId?: string | null;
  /** Dodatkowe atrybuty (interval, variant, query, position…). */
  meta?: Record<string, unknown>;
  /** Nadpisanie ścieżki (domyślnie `location.pathname + search`). */
  path?: string;
}

const ENDPOINT = "/api/public/track";
const MAX_BATCH = 20;
const FLUSH_INTERVAL_MS = 5000;
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 min bezczynności
const SESSION_KEY = "nes.analytics.session";
const ANON_KEY = "nes.analytics.anon";

interface QueuedEvent {
  type: string;
  name: string;
  entity_type: string | null;
  entity_id: string | null;
  meta: Record<string, unknown>;
  path: string;
  referrer: string;
  session_id: string;
  anon_id: string;
  lang: string;
  ts: number;
}

const queue: QueuedEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let listenersAttached = false;

function randomId(): string {
  try {
    const g = globalThis.crypto;
    if (g && typeof g.randomUUID === "function") return g.randomUUID();
  } catch {
    // ignore
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// Eksportowane dla beaconu lejka wydarzenia (`src/lib/events/eventFunnelBeacon.ts`):
// ta sama sesja i ten sam identyfikator przegladarki co w `track()`, pod ta
// sama bramka zgody analytics - drugi zestaw identyfikatorow liczylby te sama
// osobe dwa razy.
export function readSession(): string {
  if (typeof sessionStorage === "undefined") return randomId();
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { id: string; ts: number };
      if (parsed?.id && Date.now() - parsed.ts < SESSION_TTL_MS) {
        parsed.ts = Date.now();
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(parsed));
        return parsed.id;
      }
    }
    const id = randomId();
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ id, ts: Date.now() }));
    return id;
  } catch {
    return randomId();
  }
}

export function readAnonId(): string {
  if (typeof localStorage === "undefined") return "";
  try {
    const existing = localStorage.getItem(ANON_KEY);
    if (existing) return existing;
    const id = randomId();
    localStorage.setItem(ANON_KEY, id);
    return id;
  } catch {
    return "";
  }
}

/**
 * Bieżąca ścieżka BEZ poświadczeń: segment tokenu przekazania biletu,
 * certyfikatu czy kalendarza oraz parametry `token`/`t`/`code` są maskowane
 * (`redactTrackedPath`) - ta sama wartość idzie do naszej tabeli i do GA4.
 */
function currentPath(): string {
  if (typeof location === "undefined") return "";
  return redactTrackedPath(`${location.pathname}${location.search || ""}`);
}

function currentLang(): string {
  if (typeof document === "undefined") return "";
  return document.documentElement.lang || "";
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flush();
  }, FLUSH_INTERVAL_MS);
}

function attachListeners(): void {
  if (listenersAttached || typeof window === "undefined") return;
  listenersAttached = true;
  // pagehide/visibilitychange dostarczają eventy zanim strona zniknie -
  // sendBeacon jest gwarantowany przez przeglądarki nawet w trakcie
  // nawigacji.
  window.addEventListener("pagehide", () => flush(true), { capture: true });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush(true);
  });
}

export function flush(_force = false): void {
  if (queue.length === 0) return;
  const batch = queue.splice(0, queue.length);
  sendBeaconPayload(ENDPOINT, { events: batch });
}

/**
 * Kopia zdarzenia do GA4. Wysyłana ZANIM zadziała nasza bramka zgody, bo GA4
 * pracuje w trybie domyślnej odmowy Google: bez zgody nie zapisuje cookies ani
 * identyfikatorów, a trafienie zasila wyłącznie modelowanie. Zgoda przełącza
 * `analytics_storage` w `ga4Client`, więc bramka jest tam, nie tutaj.
 *
 * Domyślna odmowa NIE oznacza pustego ładunku: ping bez cookies niesie nazwę
 * i parametry zdarzenia. Bramka zgody chroni więc tylko identyfikatory, a treść
 * (fraza, `meta`, ścieżka) jest redagowana w `ga4EventParams` - tym samym
 * kompletem redaktorów co na naszym serwerze.
 */
function mirrorToGa4(event: QueuedEvent): void {
  try {
    const name = ga4EventName(event.name);
    ga4Event(
      name,
      ga4EventParams({
        type: event.type,
        name: event.name,
        entityType: event.entity_type,
        entityId: event.entity_id,
        meta: event.meta,
        path: event.path,
        lang: event.lang,
      }),
    );
  } catch {
    // Analityka nie ma prawa wywrócić interakcji użytkownika.
  }
}

export function track(input: AnalyticsEventInput): void {
  if (typeof window === "undefined") return;
  const mirrored: QueuedEvent = {
    type: input.type || "interaction",
    name: input.name,
    entity_type: input.entityType ?? null,
    entity_id: input.entityId ?? null,
    meta: input.meta ?? {},
    path: input.path ?? currentPath(),
    referrer: "",
    session_id: "",
    anon_id: "",
    lang: currentLang(),
    ts: Date.now(),
  };
  if (input.name === "page_view") {
    ga4PageView(mirrored.path, undefined, mirrored.lang);
  } else {
    mirrorToGa4(mirrored);
  }
  if (!hasAnalyticsConsent()) return;
  attachListeners();
  queue.push({
    type: input.type || "interaction",
    name: input.name,
    entity_type: input.entityType ?? null,
    entity_id: input.entityId ?? null,
    meta: input.meta ?? {},
    path: input.path ?? currentPath(),
    referrer:
      typeof document !== "undefined" && document.referrer
        ? redactTrackedHref(document.referrer)
        : "",
    session_id: readSession(),
    anon_id: readAnonId(),
    lang: currentLang(),
    ts: Date.now(),
  });
  if (queue.length >= MAX_BATCH) {
    flush();
    return;
  }
  scheduleFlush();
}

export function trackPageView(path?: string, meta?: Record<string, unknown>): void {
  track({
    type: "page_view",
    name: "page_view",
    path,
    meta: meta ?? {},
  });
}

export function trackCta(name: string, meta?: Record<string, unknown>): void {
  track({ type: "cta_click", name, meta });
}

export function trackSearch(query: string, meta?: Record<string, unknown>): void {
  const q = query.trim();
  if (q.length < 2) return;
  track({
    type: "search",
    name: "internal_search",
    entityType: "search_query",
    // JEDNA kopia frazy, nie dwie. Do naprawy ta sama fraza szła do `entity_id`
    // (znormalizowana, 120 znaków) i do `meta.q` (ORYGINALNA WIELKOŚĆ LITER,
    // 200 znaków) - dwie ekspozycje przy ZEROWYM czytelniku: raport „popularne
    // frazy" (/search, stan pusty) stoi na `search_query_log` i RPC
    // `popular_searches`, a warstwa semantyczna liczy z `analytics_events`
    // WYŁĄCZNIE `COUNT(*) FILTER (WHERE event_type = 'search')`. Kopia zostaje
    // w `entity_id`, bo to ona jest zaindeksowana (analytics_events_entity_idx).
    //
    // W BAZIE TA KOPIA NIE JEST JUŻ TEKSTEM. Trigger BEFORE INSERT (migracja
    // 20261003190000) zamienia `entity_id` wierszy wyszukiwania na
    // `sq1:<hmac-sha256>` z sekretem najemcy i zdejmuje `meta.q`, gdyby ktoś je
    // przysłał. Zostaje grupowanie (ta sama fraza = ten sam skrót) i indeks,
    // znika treść, którą admin i redaktor czytali przez RLS WPROST. Nie znika
    // ZGADYWANIE: skrót jest deterministyczny per najemca, więc rola czytająca
    // skróty wyśle zgadywaną frazę przez /api/public/track i porówna skrót
    // („czy ktoś szukał X?" = beacon + SELECT, słownik w tempie limitera
    // ingestu). Ryzyko przyjęte - opis w nagłówku migracji. Baza normalizuje
    // sama (lower, zwinięte białe znaki), więc `toLowerCase` niżej nie jest już
    // kontraktem klucza - trzyma tylko kopię dla GA4 (`search_term`, która
    // pozostaje jawna i redagowana wyłącznie przez `redactPii`) w jednej postaci.
    //
    // REDAKCJA PRZED CIĘCIEM. Zmierzone: fraza na 100 znaków plus
    // `jan.kowalski@example.com` po `slice(0, 120)` dawała `…jan.kowalski@example`
    // - bez domeny najwyższego poziomu wzorzec e-maila już nie trafia, ani na
    // serwerze, ani w kopii do GA4, więc połowa adresu szła do OBU ujść. Serwer
    // dalej redaguje sam (`api/public/track.ts`); `redactPii` jest idempotentne.
    entityId: (redactPii(q) ?? "").slice(0, 120).toLowerCase(),
    meta: meta ?? {},
  });
}

export function trackEntityView(
  entityType: "post" | "page" | "author" | "expert" | "tag" | "category",
  entityId: string,
  meta?: Record<string, unknown>,
): void {
  track({
    type: "view",
    name: `${entityType}_view`,
    entityType,
    entityId,
    meta,
  });
}
