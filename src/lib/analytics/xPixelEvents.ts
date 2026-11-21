// Piksel X Ads (uwt.js) - odsłony przejść SPA i konwersje (zdarzenia X).
//
// ŁADOWANIE. Kod bazowy wstawia wyłącznie `ConsentScriptInjector` po zgodzie
// marketingowej; `twq('config', id)` w tym kodzie liczy odsłonę strony wejścia.
//
// ODSŁONY W SPA. uwt.js nie śledzi `history.pushState` (sprawdzone w
// przeglądarce 2026-11-21), więc przejścia routera zgłaszamy sami ponownym
// `twq('config', id)` - przez `trackXPageView`, wołane z tej samej odsłony co
// GA4. Pierwsza strona po starcie jest pomijana (liczy ją kod bazowy), a ta
// sama ścieżka nie liczy się dwa razy z rzędu.
//
// KONWERSJE. Każde zdarzenie z X Events Manager ma identyfikator
// `tw-<piksel>-<zdarzenie>`; administrator wkleja go (albo cały kod
// `twq('event', ...)`) w Pixels -> X Ads, a `ConsentScriptInjector` przekazuje
// mapę do `configureXPixel`. Wysyłamy `twq('event', id, { conversion_id })`
// w tych samych, potwierdzonych przez serwer/płatność punktach co Google Ads
// i LinkedIn (`trackAdsGoal`, `trackAdsPurchase`). Zakup dostaje kwotę, walutę
// i `conversion_id` równe transakcji, raz na kartę (X deduplikuje po nim).
// Cel bez identyfikatora nie wysyła niczego. Bez danych osobowych.
//
// KOLEJKA STARTOWA. Wynik potwierdzony przed startem piksela (powrót z
// płatności) czeka w pamięci (max 20, 60 s). Bez zgody nic nie jest kolejkowane.
//
// ZGODA. Bez zgody marketingowej i przed `configureXPixel` nic nie wychodzi;
// wycofanie zgody (`resetXPixel`) zatrzymuje wysyłkę od razu, czyści kolejkę
// i pozwala, by ponowna zgoda znów policzyła bieżącą odsłonę.
import { hasCategoryConsent } from "@/lib/ads/consent";
import { installAdAutoGoals } from "./adAutoGoals";
import { X_GOALS, type XGoal } from "./xGoals";
import { extractXEventId, extractXPixelId, X_PIXEL_MARKER } from "./xPixelId";

export { extractXEventId, extractXPixelId, X_PIXEL_MARKER };
export { X_EVENT_TYPES, X_FUNNEL, X_GOALS, type XGoal } from "./xGoals";

export type XEventIds = Readonly<Record<XGoal, string>>;

type TwqFn = (...args: unknown[]) => void;

export interface XGoalOptions {
  /** Trwały identyfikator (np. transakcji) - deduplikacja i jedno zgłoszenie zakupu. */
  eventId?: string;
  /** Kwota w jednostkach waluty (tylko zakup). */
  value?: number;
  /** Kod ISO 4217 (tylko zakup). */
  currency?: string;
}

interface PendingXEvent {
  goal: XGoal;
  conversionId: string;
  value?: number;
  currency?: string;
  queuedAt: number;
}

const MAX_PENDING = 20;
const PENDING_TTL_MS = 60_000;
const MAX_CONVERSION_ID = 64;
const CURRENCY_RE = /^[A-Z]{3}$/;

let pixelId: string | null = null;
let eventIds: XEventIds | null = null;
let lastPagePath: string | null = null;
const pending: PendingXEvent[] = [];
const sentPurchases = new Set<string>();

function normalizePath(path: string): string {
  const clean = path.split(/[?#]/)[0] ?? "";
  return clean.length > 1 ? clean.replace(/\/+$/, "") : clean || "/";
}

function readTwq(): TwqFn | null {
  if (typeof window === "undefined") return null;
  const candidate: unknown = (window as Window & { twq?: unknown }).twq;
  return typeof candidate === "function" ? (candidate as TwqFn) : null;
}

function newConversionId(goal: XGoal): string {
  const random =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `x_${goal}_${random}`.slice(0, MAX_CONVERSION_ID);
}

function normalizeIds(raw: Partial<Record<XGoal, string>>): XEventIds {
  const out = {} as Record<XGoal, string>;
  for (const goal of X_GOALS) out[goal] = extractXEventId(raw[goal] ?? "");
  return out;
}

function send(twq: TwqFn, ids: XEventIds, event: PendingXEvent): boolean {
  const id = ids[event.goal];
  if (!id) return false;
  const params: Record<string, unknown> = { conversion_id: event.conversionId };
  if (event.value !== undefined && event.currency) {
    params["value"] = event.value;
    params["currency"] = event.currency;
  }
  try {
    twq("event", id, params);
    return true;
  } catch {
    return false;
  }
}

function sendPageViewConversion(twq: TwqFn, ids: XEventIds): boolean {
  return send(twq, ids, {
    goal: "page_view",
    conversionId: newConversionId("page_view"),
    queuedAt: Date.now(),
  });
}

/**
 * Kod bazowy stoi: zapamiętuje piksel, bieżącą ścieżkę (już policzoną przez
 * kod bazowy) i identyfikatory zdarzeń; wysyła zakolejkowane wyniki oraz
 * konwersję "Wyświetlenie strony" strony wejścia.
 */
export function configureXPixel(raw: string, events: Partial<Record<XGoal, string>> = {}): void {
  if (typeof window === "undefined") return;
  const id = extractXPixelId(raw);
  pixelId = id || null;
  lastPagePath = id ? normalizePath(window.location.pathname) : null;
  eventIds = id ? normalizeIds(events) : null;
  const queued = pending.splice(0, pending.length);
  const ids = eventIds;
  if (!ids || !hasCategoryConsent("marketing")) return;
  const twq = readTwq();
  if (!twq) return;
  const now = Date.now();
  for (const event of queued) {
    if (now - event.queuedAt <= PENDING_TTL_MS) send(twq, ids, event);
  }
  sendPageViewConversion(twq, ids);
}

/** Wycofanie zgody / brak piksela: zapomina konfigurację i kolejkę. */
export function resetXPixel(): void {
  pixelId = null;
  eventIds = null;
  lastPagePath = null;
  pending.length = 0;
  if (typeof window !== "undefined") {
    delete (window as Window & { [X_PIXEL_MARKER]?: unknown })[X_PIXEL_MARKER];
  }
}

/**
 * Odsłona po przejściu routera. Zwraca `true`, gdy poszła do piksela; bez
 * zgody, przed startem piksela albo dla tej samej ścieżki - nic.
 */
export function trackXPageView(path?: string): boolean {
  if (typeof window === "undefined" || pixelId === null) return false;
  if (!hasCategoryConsent("marketing")) return false;
  const twq = readTwq();
  if (!twq) return false;
  const next = normalizePath(path ?? window.location.pathname);
  if (next === lastPagePath) return false;
  lastPagePath = next;
  try {
    twq("config", pixelId);
  } catch {
    return false;
  }
  if (eventIds) sendPageViewConversion(twq, eventIds);
  return true;
}

/**
 * Zgłasza potwierdzony wynik jako zdarzenie X. Zwraca `true`, gdy poszło do
 * piksela albo czeka w kolejce startowej na konfigurację.
 */
export function trackXGoal(goal: XGoal, options: XGoalOptions = {}): boolean {
  if (typeof window === "undefined") return false;
  if (!hasCategoryConsent("marketing")) return false;
  const stableId = options.eventId?.trim().slice(0, MAX_CONVERSION_ID) ?? "";
  const event: PendingXEvent = {
    goal,
    conversionId: stableId || newConversionId(goal),
    queuedAt: Date.now(),
  };
  if (goal === "purchase") {
    if (!stableId || sentPurchases.has(stableId)) return false;
    const currency = options.currency?.trim().toUpperCase() ?? "";
    const value = options.value;
    if (value !== undefined && Number.isFinite(value) && value > 0 && CURRENCY_RE.test(currency)) {
      event.value = Math.round(value * 100) / 100;
      event.currency = currency;
    }
  }
  const ids = eventIds;
  const twq = readTwq();
  if (!ids || !twq) {
    // Piksel skonfigurowany bez tego celu - nie ma na co czekać.
    if (ids && !ids[goal]) return false;
    if (pending.length >= MAX_PENDING) pending.shift();
    pending.push(event);
    if (goal === "purchase") sentPurchases.add(stableId);
    return true;
  }
  const ok = send(twq, ids, event);
  if (ok && goal === "purchase") sentPurchases.add(stableId);
  return ok;
}

/** Wyświetlenie wideo i pobranie pliku jako zdarzenia X. Zwraca sprzątanie. */
export function installXAutoGoals(): () => void {
  return installAdAutoGoals((goal) => {
    trackXGoal(goal);
  });
}

/** Tylko testy. */
export function __resetXPixelForTests(): void {
  resetXPixel();
  sentPurchases.clear();
}
