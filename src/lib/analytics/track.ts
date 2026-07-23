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
import { hasAnalyticsConsent } from "@/lib/ads/consent";

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

function readSession(): string {
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

function readAnonId(): string {
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

function currentPath(): string {
  if (typeof location === "undefined") return "";
  return `${location.pathname}${location.search || ""}`;
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

export function track(input: AnalyticsEventInput): void {
  if (typeof window === "undefined") return;
  if (!hasAnalyticsConsent()) return;
  attachListeners();
  queue.push({
    type: input.type || "interaction",
    name: input.name,
    entity_type: input.entityType ?? null,
    entity_id: input.entityId ?? null,
    meta: input.meta ?? {},
    path: input.path ?? currentPath(),
    referrer: typeof document !== "undefined" ? document.referrer || "" : "",
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
    entityId: q.slice(0, 120).toLowerCase(),
    meta: { q: q.slice(0, 200), ...(meta ?? {}) },
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
