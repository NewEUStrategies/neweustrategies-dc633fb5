// Konwersje LinkedIn Ads zgłaszane przez LinkedIn Insight Tag
// (`window.lintrk('track', { conversion_id })` - instalacja "event-specific").
//
// SKĄD ID. Każda konwersja ma w Campaign Manager własny numeryczny
// `conversion_id`. Administrator wkleja go (sam numer albo cały fragment
// `window.lintrk(...)`) w Ustawienia -> Marketing; `ConsentScriptInjector`
// przekazuje mapę tutaj przez `configureLinkedInConversions` zaraz po starcie
// tagu. Cel bez ID nie wysyła niczego.
//
// ZGODA. Wyłącznie po zgodzie marketingowej i tylko gdy tag stoi (`lintrk`
// zakłada snippet injectora po tej zgodzie). Wycofanie zgody zatrzymuje
// wysyłkę od razu (ta bramka) i czyści kolejkę (`resetLinkedInConversions`).
//
// KOLEJKA STARTOWA. Wynik potwierdzony przed odczytem ustawień (twarde wejście
// na stronę powrotu z płatności) czeka w pamięci (max 20, 60 s) i wychodzi
// przy konfiguracji. Bez zgody nic nie jest kolejkowane.
//
// MOMENT. Te same, potwierdzone przez serwer/płatność punkty co Google Ads -
// wołane wyłącznie z `trackAdsGoal` i `trackAdsPurchase`. Zakup ma `event_id`
// równy identyfikatorowi transakcji i jest zgłaszany raz na kartę, więc
// przyszła wysyłka serwerowa (Conversions API) może się z nim zdeduplikować.
// Bez danych osobowych: tylko identyfikator konwersji i zdarzenia.
import { hasCategoryConsent } from "@/lib/ads/consent";
import { extractLinkedInConversionId } from "./linkedinConversionId";

export { extractLinkedInConversionId };

export const LINKEDIN_GOALS = [
  "contact_form",
  "club_application",
  "account_signup",
  "newsletter",
  "event_registration",
  "purchase",
] as const;

export type LinkedInGoal = (typeof LINKEDIN_GOALS)[number];
export type LinkedInConversionIds = Readonly<Record<LinkedInGoal, string>>;

type LintrkFn = (action: string, payload?: Record<string, unknown>) => void;

interface PendingLinkedInEvent {
  goal: LinkedInGoal;
  eventId: string;
  queuedAt: number;
}

const MAX_PENDING = 20;
const PENDING_TTL_MS = 60_000;
const MAX_EVENT_ID = 64;

let conversionIds: LinkedInConversionIds | null = null;
const pending: PendingLinkedInEvent[] = [];
const sentPurchases = new Set<string>();

function readLintrk(): LintrkFn | null {
  if (typeof window === "undefined") return null;
  const candidate: unknown = (window as Window & { lintrk?: unknown }).lintrk;
  return typeof candidate === "function" ? (candidate as LintrkFn) : null;
}

function newEventId(goal: LinkedInGoal): string {
  const random =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `li_${goal}_${random}`.slice(0, MAX_EVENT_ID);
}

function send(lintrk: LintrkFn, ids: LinkedInConversionIds, event: PendingLinkedInEvent): boolean {
  const id = ids[event.goal];
  if (!id) return false;
  try {
    lintrk("track", { conversion_id: Number(id), event_id: event.eventId });
    return true;
  } catch {
    return false;
  }
}

/** Ustawia identyfikatory konwersji i wysyła zakolejkowane wyniki. */
export function configureLinkedInConversions(ids: Partial<Record<LinkedInGoal, string>>): void {
  const normalized = {} as Record<LinkedInGoal, string>;
  for (const goal of LINKEDIN_GOALS) {
    normalized[goal] = extractLinkedInConversionId(ids[goal] ?? "");
  }
  conversionIds = normalized;
  const now = Date.now();
  const queued = pending.splice(0, pending.length);
  if (!hasCategoryConsent("marketing")) return;
  const lintrk = readLintrk();
  if (!lintrk) return;
  for (const event of queued) {
    if (now - event.queuedAt <= PENDING_TTL_MS) send(lintrk, normalized, event);
  }
}

/** Wycofanie zgody / brak tagu: zapomina konfigurację i kolejkę. */
export function resetLinkedInConversions(): void {
  conversionIds = null;
  pending.length = 0;
}

export interface LinkedInGoalOptions {
  /** Trwały identyfikator (np. transakcji) - deduplikacja i jedno zgłoszenie zakupu. */
  eventId?: string;
}

/**
 * Zgłasza potwierdzony wynik. Zwraca `true`, gdy konwersja poszła do tagu albo
 * czeka w kolejce startowej na konfigurację.
 */
export function trackLinkedInGoal(goal: LinkedInGoal, options: LinkedInGoalOptions = {}): boolean {
  if (typeof window === "undefined") return false;
  if (!hasCategoryConsent("marketing")) return false;
  const stableId = options.eventId?.trim().slice(0, MAX_EVENT_ID) ?? "";
  if (goal === "purchase") {
    if (!stableId || sentPurchases.has(stableId)) return false;
  }
  const event: PendingLinkedInEvent = {
    goal,
    eventId: stableId || newEventId(goal),
    queuedAt: Date.now(),
  };
  const ids = conversionIds;
  const lintrk = readLintrk();
  if (!ids || !lintrk) {
    if (pending.length >= MAX_PENDING) pending.shift();
    pending.push(event);
    if (goal === "purchase") sentPurchases.add(stableId);
    return true;
  }
  const ok = send(lintrk, ids, event);
  if (ok && goal === "purchase") sentPurchases.add(stableId);
  return ok;
}

/** Tylko testy. */
export function __resetLinkedInInsightForTests(): void {
  resetLinkedInConversions();
  sentPurchases.clear();
}
