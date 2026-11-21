// Przeglądarkowa kolejka kopii serwerowych zdarzeń piksela X (Conversion API).
//
// Każde zdarzenie przekazane do `twq('event')` trafia tu z TYM SAMYM
// `conversion_id`, więc X deduplikuje parę piksel + serwer. Zdarzenia zbieramy
// przez krótką chwilę i wysyłamy paczkami do 10; schowanie karty wysyła resztę.
// Zgoda marketingowa jest sprawdzana przy kolejkowaniu i ponownie przy wysyłce
// - wycofanie zgody czyści kolejkę bez wysyłki. `twclid` pamiętamy tylko
// w pamięci karty (z adresu strony wejścia), bez własnych ciasteczek.
import { hasCategoryConsent } from "@/lib/ads/consent";
import {
  X_CAPI_MAX_BATCH,
  readXClickId,
  xEventSourceUrl,
  type XCapiBatch,
  type XCapiEvent,
} from "./xCapiContract";
import { redactTrackedHref } from "./redactTrackedUrl";

export const X_CAPI_FLUSH_DELAY_MS = 1_200;
const MAX_QUEUE = 50;

const queue: XCapiEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let listening = false;
let landingHref: string | null = null;

type Sender = (batch: XCapiBatch) => Promise<unknown>;
let senderOverride: Sender | null = null;

async function defaultSender(batch: XCapiBatch): Promise<unknown> {
  const { sendXCapiEvents } = await import("./xCapi.functions");
  return sendXCapiEvents({ data: batch });
}

function rememberLanding(): void {
  if (landingHref !== null || typeof window === "undefined") return;
  landingHref = window.location.href;
}

function listen(): void {
  if (listening || typeof document === "undefined") return;
  listening = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flushXCapiQueue();
  });
  window.addEventListener("pagehide", () => void flushXCapiQueue());
}

function schedule(): void {
  if (timer !== null) return;
  timer = setTimeout(() => {
    timer = null;
    void flushXCapiQueue();
  }, X_CAPI_FLUSH_DELAY_MS);
}

export interface XCapiMirrorInput {
  eventId: string;
  conversionId: string;
  occurredAt: number;
  href: string;
  value?: number;
  currency?: string;
}

/** Pamięta adres wejścia (dla `twclid`) zanim router go zmieni. */
export function noteXLanding(): void {
  rememberLanding();
}

/** Dokłada kopię serwerową zdarzenia piksela X. Bez zgody - nic. */
export function mirrorXEventToCapi(input: XCapiMirrorInput): void {
  if (typeof window === "undefined") return;
  if (!hasCategoryConsent("marketing")) return;
  const sourceUrl = xEventSourceUrl(redactTrackedHref(input.href));
  if (!sourceUrl) return;
  rememberLanding();
  listen();
  if (queue.length >= MAX_QUEUE) queue.shift();
  queue.push({
    event_id: input.eventId,
    conversion_id: input.conversionId,
    occurred_at: Math.floor(input.occurredAt),
    event_source_url: sourceUrl,
    ...(input.value !== undefined && input.currency
      ? { value: input.value, currency: input.currency }
      : {}),
  });
  if (queue.length >= X_CAPI_MAX_BATCH) {
    void flushXCapiQueue();
    return;
  }
  schedule();
}

/** Wysyła kolejkę paczkami. Błędy sieci są ciche - piksel i tak wysłał swoją kopię. */
export async function flushXCapiQueue(): Promise<number> {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  if (typeof document === "undefined") return 0;
  if (!hasCategoryConsent("marketing")) {
    queue.length = 0;
    return 0;
  }
  const send = senderOverride ?? defaultSender;
  let sent = 0;
  while (queue.length > 0) {
    const events = queue.splice(0, X_CAPI_MAX_BATCH);
    const twclid = readXClickId(document.cookie, landingHref);
    try {
      await send({ events, ...(twclid ? { twclid } : {}) });
      sent += events.length;
    } catch {
      /* bez ponowień: zdarzenie przeglądarkowe już poszło */
    }
  }
  return sent;
}

/** Wycofanie zgody: kolejka znika bez wysyłki. */
export function clearXCapiQueue(): void {
  queue.length = 0;
  if (timer !== null) clearTimeout(timer);
  timer = null;
}

/** Tylko testy. */
export function setXCapiSenderForTests(sender: Sender | null): void {
  senderOverride = sender;
}

/** Tylko testy. */
export function resetXCapiMirrorForTests(): void {
  clearXCapiQueue();
  landingHref = null;
}
