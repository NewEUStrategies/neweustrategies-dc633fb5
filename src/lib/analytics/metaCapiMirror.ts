// Przeglądarkowa kolejka kopii serwerowych zdarzeń piksela Meta (CAPI).
//
// Każde zdarzenie przekazane do `fbq` trafia tu z TYM SAMYM `eventID` i nazwą,
// więc Meta deduplikuje parę piksel + serwer. Zdarzenia zbieramy przez krótką
// chwilę (pierwsza odsłona czeka, aż piksel zapisze `_fbp`) i wysyłamy
// paczkami do 10; schowanie karty wysyła resztę od razu.
//
// Zgoda marketingowa jest sprawdzana przy kolejkowaniu i ponownie przy wysyłce
// - wycofanie zgody czyści kolejkę bez wysyłki.
import { hasCategoryConsent } from "@/lib/ads/consent";
import {
  META_CAPI_MAX_BATCH,
  metaEventSourceUrl,
  readMetaBrowserIds,
  type MetaCapiCustomData,
  type MetaCapiEvent,
  type MetaStandardEventName,
} from "./metaCapiContract";
import { redactTrackedHref } from "./redactTrackedUrl";

export const META_CAPI_FLUSH_DELAY_MS = 1_200;
const MAX_QUEUE = 50;

const queue: MetaCapiEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let listening = false;
let firstFbclid: string | null = null;

type Sender = (batch: {
  events: MetaCapiEvent[];
  fbp?: string;
  fbc?: string;
}) => Promise<unknown>;

let senderOverride: Sender | null = null;

async function defaultSender(batch: Parameters<Sender>[0]): Promise<unknown> {
  const { sendMetaCapiEvents } = await import("./metaCapi.functions");
  return sendMetaCapiEvents({ data: batch });
}

function rememberFbclid(): void {
  if (firstFbclid !== null || typeof window === "undefined") return;
  try {
    const value = new URL(window.location.href).searchParams.get("fbclid");
    if (value && /^[A-Za-z0-9_-]{1,500}$/.test(value)) firstFbclid = value;
  } catch {
    /* nieczytelny adres - bez fbclid */
  }
}

function listen(): void {
  if (listening || typeof document === "undefined") return;
  listening = true;
  const onHide = () => {
    if (document.visibilityState === "hidden") void flushMetaCapiQueue();
  };
  document.addEventListener("visibilitychange", onHide);
  window.addEventListener("pagehide", () => void flushMetaCapiQueue());
}

function schedule(): void {
  if (timer !== null) return;
  timer = setTimeout(() => {
    timer = null;
    void flushMetaCapiQueue();
  }, META_CAPI_FLUSH_DELAY_MS);
}

export interface MetaCapiMirrorInput {
  name: MetaStandardEventName;
  eventId: string;
  params: MetaCapiCustomData;
  /** Moment zdarzenia (ms) - dla zdarzeń z kolejki startowej wcześniejszy niż wysyłka. */
  occurredAt: number;
  /** Adres strony w chwili zdarzenia. */
  href: string;
}

/** Dokłada kopię serwerową zdarzenia piksela. Bez zgody - nic. */
export function mirrorMetaEventToCapi(input: MetaCapiMirrorInput): void {
  if (typeof window === "undefined") return;
  if (!hasCategoryConsent("marketing")) return;
  const sourceUrl = metaEventSourceUrl(redactTrackedHref(input.href));
  if (!sourceUrl) return;
  rememberFbclid();
  listen();
  const hasCustom = Object.keys(input.params).length > 0;
  if (queue.length >= MAX_QUEUE) queue.shift();
  queue.push({
    event_name: input.name,
    event_id: input.eventId,
    event_time: Math.floor(input.occurredAt / 1000),
    event_source_url: sourceUrl,
    ...(hasCustom ? { custom_data: input.params } : {}),
  });
  if (queue.length >= META_CAPI_MAX_BATCH) {
    void flushMetaCapiQueue();
    return;
  }
  schedule();
}

/** Wysyła kolejkę paczkami. Błędy sieci są ciche - piksel i tak wysłał swoją kopię. */
export async function flushMetaCapiQueue(): Promise<number> {
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
    const events = queue.splice(0, META_CAPI_MAX_BATCH);
    const ids = readMetaBrowserIds(document.cookie, firstFbclid, Date.now());
    try {
      await send({ events, ...ids });
      sent += events.length;
    } catch {
      /* bez ponowień: zdarzenie przeglądarkowe już poszło */
    }
  }
  return sent;
}

/** Tylko testy. */
export function setMetaCapiSenderForTests(sender: Sender | null): void {
  senderOverride = sender;
}

/** Tylko testy. */
export function resetMetaCapiMirrorForTests(): void {
  queue.length = 0;
  if (timer !== null) clearTimeout(timer);
  timer = null;
  firstFbclid = null;
}
