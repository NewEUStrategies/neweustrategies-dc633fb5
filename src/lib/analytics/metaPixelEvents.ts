// Zdarzenia standardowe piksela Meta - jedyna droga wysyłki zdarzeń, także
// PageView (`trackMetaPageView`; snippet w `ConsentScriptInjector` tylko
// inicjuje piksel i wyłącza jego automatyczne odsłony przejść SPA, które
// wychodziłyby bez `eventID`).
//
// ZGODA. Zdarzenie wychodzi WYŁĄCZNIE, gdy: (1) odwiedzający ma zgodę
// marketingową, (2) `window.fbq` istnieje - piksel uruchamia tylko
// `ConsentScriptInjector` po tej zgodzie. Wycofanie zgody zatrzymuje wysyłkę
// bez przeładowania strony (`fbq('consent','revoke')` + ta bramka).
//
// KOLEJKA STARTOWA. Przy twardym wejściu efekt strony (np. odsłona artykułu,
// powrót z płatności) biegnie PRZED efektem injectora w `__root`, więc zgoda
// już jest, a `fbq` jeszcze nie. Takie zdarzenie czeka w pamięci (max 20,
// 60 s) i wychodzi przy `flushPendingMetaEvents()` zaraz po starcie piksela.
// Bez zgody nic nie jest kolejkowane - zdarzenie sprzed zgody przepada.
//
// MOMENT. Zdarzenia wyniku (Lead, CompleteRegistration, SubmitApplication,
// Purchase, Subscribe, Donate) wołamy PO potwierdzeniu przez serwer albo
// operatora płatności, nigdy na samo kliknięcie. Zdarzenia zamiaru
// (ViewContent, Search, AddToCart, InitiateCheckout, Contact) idą przy samej
// akcji odwiedzającego.
//
// DANE. Bez danych osobowych: tylko wartość, waluta, identyfikatory treści
// i kategoria - fraza wyszukiwania i adres e-mail/telefon NIE wychodzą.
// Każde zdarzenie ma własny `eventID` i po przekazaniu do `fbq` dostaje kopię
// serwerową (API konwersji, `metaCapiMirror.ts`) z tym samym ID i nazwą, więc
// Meta liczy parę raz, a zdarzenie zgubione przez przeglądarkę dociera z serwera.
import { hasCategoryConsent } from "@/lib/ads/consent";
import type { MetaCapiCustomData, MetaStandardEventName } from "./metaCapiContract";
import { mirrorMetaEventToCapi } from "./metaCapiMirror";

export type MetaStandardEvent = MetaStandardEventName;

export interface MetaEventParams {
  value?: number;
  currency?: string;
  content_ids?: readonly string[];
  content_category?: string;
  num_items?: number;
  /** `product` dla pojedynczych pozycji (bilet, plan), `product_group` dla grup. */
  content_type?: "product" | "product_group";
  /** Pozycje z ilością - wymagane przez Meta dla katalogu. */
  contents?: readonly { id: string; quantity: number }[];
  /** Przewidywana wartość klienta (StartTrial, Subscribe). */
  predicted_ltv?: number;
}

type FbqFn = (...args: unknown[]) => void;

interface PendingMetaEvent {
  name: MetaStandardEvent;
  params: MetaCapiCustomData;
  eventId: string;
  /** Moment zdarzenia (ms) i adres strony w tej chwili - dla kopii serwerowej. */
  occurredAt: number;
  href: string;
  queuedAt: number;
}

const CURRENCY_RE = /^[A-Z]{3}$/;
const MAX_CONTENT_IDS = 20;
const MAX_TEXT = 100;
const MAX_PENDING = 20;
const PENDING_TTL_MS = 60_000;
export const META_SEARCH_IDLE_MS = 1_500;
const CONTACT_DEDUPE_MS = 2_000;
/** Górne granice zgodne z kontraktem serwera (`MetaCapiCustomDataSchema`). */
const MAX_VALUE = 10_000_000;
const MAX_QUANTITY = 1_000;

const pending: PendingMetaEvent[] = [];

function readFbq(): FbqFn | null {
  if (typeof window === "undefined") return null;
  const candidate: unknown = (window as Window & { fbq?: unknown }).fbq;
  return typeof candidate === "function" ? (candidate as FbqFn) : null;
}

function clip(value: string): string {
  return value.trim().slice(0, MAX_TEXT);
}

/** Czyści parametry: odrzuca niepoprawne kwoty, waluty i puste identyfikatory. */
export function sanitizeMetaParams(params: MetaEventParams): MetaCapiCustomData {
  const out: MetaCapiCustomData = {};
  if (
    typeof params.value === "number" &&
    Number.isFinite(params.value) &&
    params.value >= 0 &&
    params.value <= MAX_VALUE
  ) {
    out.value = Math.round(params.value * 100) / 100;
  }
  const currency = params.currency?.trim().toUpperCase();
  if (currency && CURRENCY_RE.test(currency)) out.currency = currency;
  if (out.value !== undefined && out.currency === undefined) delete out.value;
  const ids = (params.content_ids ?? [])
    .map(clip)
    .filter((id) => id.length > 0)
    .slice(0, MAX_CONTENT_IDS);
  if (ids.length > 0) out.content_ids = ids;
  if (params.content_category) {
    const category = clip(params.content_category);
    if (category) out.content_category = category;
  }
  if (params.content_type === "product" || params.content_type === "product_group") {
    out.content_type = params.content_type;
  }
  const contents = (params.contents ?? [])
    .map((entry) => ({ id: clip(entry.id), quantity: entry.quantity }))
    .filter(
      (entry) =>
        entry.id.length > 0 &&
        Number.isInteger(entry.quantity) &&
        entry.quantity > 0 &&
        entry.quantity <= MAX_QUANTITY,
    )
    .slice(0, MAX_CONTENT_IDS);
  if (contents.length > 0) out.contents = contents;
  if (
    typeof params.predicted_ltv === "number" &&
    Number.isFinite(params.predicted_ltv) &&
    params.predicted_ltv >= 0 &&
    params.predicted_ltv <= MAX_VALUE &&
    out.currency !== undefined
  ) {
    out.predicted_ltv = Math.round(params.predicted_ltv * 100) / 100;
  }
  if (
    typeof params.num_items === "number" &&
    Number.isInteger(params.num_items) &&
    params.num_items > 0 &&
    params.num_items <= MAX_QUANTITY
  ) {
    out.num_items = params.num_items;
  }
  return out;
}

/** Unikalny identyfikator zdarzenia (deduplikacja przeglądarka/serwer). */
export function newMetaEventId(prefix: string): string {
  const random =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${clip(prefix).replace(/[^A-Za-z0-9_-]/g, "_")}_${random}`;
}

function send(fbq: FbqFn, event: Omit<PendingMetaEvent, "queuedAt">): boolean {
  try {
    fbq("track", event.name, event.params, { eventID: event.eventId });
  } catch {
    return false;
  }
  // Kopia serwerowa z tym samym `eventID` - błąd kolejki nie cofa piksela.
  try {
    mirrorMetaEventToCapi({
      name: event.name,
      eventId: event.eventId,
      params: event.params,
      occurredAt: event.occurredAt,
      href: event.href,
    });
  } catch {
    /* tylko piksel */
  }
  return true;
}

/**
 * Wysyła zdarzenie standardowe do piksela Meta. Zwraca `true`, gdy zdarzenie
 * zostało przekazane do `fbq`; `false`, gdy bramka zgody je zatrzymała albo
 * czeka w kolejce startowej na uruchomienie piksela.
 */
export function trackMetaEvent(
  name: MetaStandardEvent,
  params: MetaEventParams = {},
  eventId?: string,
): boolean {
  if (typeof window === "undefined") return false;
  if (!hasCategoryConsent("marketing")) return false;
  const event = {
    name,
    params: sanitizeMetaParams(params),
    eventId: eventId ?? newMetaEventId(name),
    occurredAt: Date.now(),
    href: window.location.href,
  };
  const fbq = readFbq();
  if (!fbq) {
    if (pending.length >= MAX_PENDING) pending.shift();
    pending.push({ ...event, queuedAt: Date.now() });
    return false;
  }
  return send(fbq, event);
}

/**
 * Wysyła zdarzenia zakolejkowane przed startem piksela. Woła go
 * `ConsentScriptInjector` po wstrzyknięciu snippetu. Brak zgody czyści kolejkę.
 */
export function flushPendingMetaEvents(now: number = Date.now()): number {
  if (!hasCategoryConsent("marketing")) {
    pending.length = 0;
    return 0;
  }
  const fbq = readFbq();
  if (!fbq) return 0;
  const ready = pending.splice(0, pending.length);
  let sent = 0;
  for (const event of ready) {
    if (now - event.queuedAt > PENDING_TTL_MS) continue;
    if (send(fbq, event)) sent += 1;
  }
  return sent;
}

// ---------------- PageView ----------------

let lastPageViewPath: string | null = null;

/**
 * Odsłona strony z `eventID` (piksel + kopia serwerowa). Wołają ją: start
 * piksela w `ConsentScriptInjector` i każde przejście SPA (`track.ts`). Klucz to
 * bieżąca ścieżka (bez zapytania) - ta sama ścieżka dwa razy z rzędu liczy się
 * raz, więc oba wywołania przy wejściu na stronę dają jedną odsłonę. Bez zgody
 * nic nie zapamiętujemy.
 */
export function trackMetaPageView(): boolean {
  if (typeof window === "undefined") return false;
  if (!hasCategoryConsent("marketing")) return false;
  const path = window.location.pathname || "/";
  if (path === lastPageViewPath) return false;
  lastPageViewPath = path;
  trackMetaEvent("PageView");
  return true;
}

/** Wycofanie zgody: następne udzielenie zgody znów liczy bieżącą odsłonę. */
export function resetMetaPageView(): void {
  lastPageViewPath = null;
}

/** Tylko testy: stan modułu między przypadkami. */
export function resetMetaPixelStateForTests(): void {
  pending.length = 0;
  lastPageViewPath = null;
  if (searchTimer !== null) clearTimeout(searchTimer);
  searchTimer = null;
  lastSearch = "";
  lastContactAt = 0;
}

// ---------------- Search ----------------

let searchTimer: ReturnType<typeof setTimeout> | null = null;
let lastSearch = "";

/**
 * Wyszukiwanie w witrynie. Pisanie frazy ("eu" -> "euro" -> "europa") daje
 * JEDNO zdarzenie: wysyłamy ostatnią frazę po 1,5 s bezczynności, a ta sama
 * fraza drugi raz z rzędu nie liczy się ponownie. Sama fraza nie wychodzi.
 */
export function trackMetaSearch(query: string, source: string = "site_search"): void {
  const normalized = query.trim().toLowerCase().replace(/\s+/g, " ");
  if (normalized.length < 2) return;
  if (searchTimer !== null) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    searchTimer = null;
    if (normalized === lastSearch) return;
    lastSearch = normalized;
    trackMetaEvent("Search", { content_category: source });
  }, META_SEARCH_IDLE_MS);
}

// ---------------- Contact ----------------

let lastContactAt = 0;

/** Kanał kontaktu z adresu odnośnika: `mailto:` -> email, `tel:` -> phone. */
export function contactChannel(href: string | null | undefined): "email" | "phone" | null {
  const value = (href ?? "").trim().toLowerCase();
  if (value.startsWith("mailto:")) return "email";
  if (value.startsWith("tel:")) return "phone";
  return null;
}

/**
 * Kliknięcie w odnośnik e-mail/telefon = zdarzenie Contact (bez samego
 * adresu). Nasłuch zakłada `ConsentScriptInjector` po starcie piksela i zdejmuje
 * go przy wycofaniu zgody; zwraca funkcję sprzątającą.
 */
export function installMetaContactListener(): () => void {
  if (typeof document === "undefined") return () => undefined;
  const onClick = (event: MouseEvent): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const anchor = target.closest("a[href]");
    const channel = contactChannel(anchor?.getAttribute("href"));
    if (!channel) return;
    const now = Date.now();
    if (now - lastContactAt < CONTACT_DEDUPE_MS) return;
    lastContactAt = now;
    trackMetaEvent("Contact", { content_category: channel });
  };
  document.addEventListener("click", onClick, { capture: true });
  return () => document.removeEventListener("click", onClick, { capture: true });
}
