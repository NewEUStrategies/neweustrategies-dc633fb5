// Normalizacja zdarzeń dostarczalności dostawcy poczty (Resend) do jednego,
// niezależnego od dostawcy kształtu.
//
// Czysty moduł bez I/O - dzięki temu klasyfikacja odbić (najbardziej ryzykowna
// część całego potoku: pomyłka "twarde vs miękkie" albo trwale kasuje żywego
// odbiorcę, albo w kółko dobija się do martwej skrzynki) jest testowalna
// jednostkowo bez bazy i bez sieci.
//
// Kształt payloadu Resend:
//   { type: "email.bounced", created_at, data: { email_id, to: [], from,
//     subject, bounce?: { type, subType, message }, failed?: { reason },
//     click?: { link }, tags?: {...} | [{name,value}] } }

export type DeliveryEventKind =
  | "sent"
  | "delivered"
  | "delayed"
  | "bounced"
  | "complained"
  | "opened"
  | "clicked"
  | "failed"
  | "other";

export type BounceClass = "hard" | "soft" | "block" | "unknown";

export interface NormalizedDeliveryEvent {
  /** Surowy typ dostawcy, np. "email.bounced" - trzymany do diagnostyki. */
  eventType: string;
  kind: DeliveryEventKind;
  /** Klasa odbicia; null dla zdarzeń, które odbiciem nie są. */
  bounceClass: BounceClass | null;
  email: string | null;
  /** Identyfikator wiadomości u dostawcy - klucz korelacji z odbiorcą kampanii. */
  messageId: string | null;
  occurredAt: string;
  diagnostic: string | null;
  /** Link z kliknięcia (tylko email.clicked). */
  url: string | null;
  /** Tagi wysyłki - niosą tenant/campaign/subscriber, gdy dostawca je zwraca. */
  tags: Readonly<Record<string, string>>;
}

const KIND_BY_TYPE: Readonly<Record<string, DeliveryEventKind>> = {
  "email.sent": "sent",
  "email.delivered": "delivered",
  "email.delivery_delayed": "delayed",
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.opened": "opened",
  "email.clicked": "clicked",
  "email.failed": "failed",
};

/** Zdarzenia, które zmieniają stan listy wykluczeń. */
export const SUPPRESSING_KINDS: readonly DeliveryEventKind[] = ["bounced", "complained"];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

/**
 * Klasyfikacja odbicia. Reguła nadrzędna: gdy dostawca mówi "Permanent",
 * adres jest martwy i nie ma sensu próbować ponownie. "Transient" to problem
 * chwilowy (pełna skrzynka, greylisting) - blokujemy CZASOWO. Wszystko, czego
 * nie umiemy rozstrzygnąć, traktujemy jak miękkie: fałszywe trwałe wykluczenie
 * kosztuje utraconego czytelnika, fałszywe miękkie kosztuje jedną próbę.
 */
export function classifyBounce(type?: string | null, subType?: string | null): BounceClass {
  const t = (type ?? "").trim().toLowerCase();
  const s = (subType ?? "").trim().toLowerCase();

  // Adres już na liście blokad dostawcy albo odrzucony przez reputację -
  // osobna klasa, bo problem leży po stronie relacji z odbiorcą, nie skrzynki.
  if (s.includes("suppress") || s.includes("block") || s.includes("blacklist")) return "block";

  if (t === "permanent") return "hard";
  if (t === "transient") return "soft";
  if (t === "undetermined") return "unknown";

  // Brak pola `type` (starszy payload): rozstrzygamy po podtypie.
  if (s.includes("mailboxfull") || s.includes("messagetoolarge") || s.includes("contentrejected")) {
    return "soft";
  }
  if (s.includes("noemail") || s.includes("general")) return "hard";
  return "unknown";
}

/** Tagi Resend przychodzą jako mapa albo jako lista {name, value}. */
export function parseTags(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (!isRecord(entry)) continue;
      const name = str(entry.name);
      const value = str(entry.value);
      if (name && value) out[name] = value;
    }
    return out;
  }
  if (isRecord(raw)) {
    for (const [k, v] of Object.entries(raw)) {
      const value = str(v);
      if (value) out[k] = value;
    }
  }
  return out;
}

function firstRecipient(data: Record<string, unknown>): string | null {
  const to = data.to;
  if (Array.isArray(to)) {
    for (const entry of to) {
      const v = str(entry);
      if (v) return v.toLowerCase();
    }
    return null;
  }
  const single = str(to);
  return single ? single.toLowerCase() : null;
}

function isoOrNow(...candidates: unknown[]): string {
  for (const candidate of candidates) {
    const raw = str(candidate);
    if (!raw) continue;
    const ts = Date.parse(raw);
    if (Number.isFinite(ts)) return new Date(ts).toISOString();
  }
  return new Date().toISOString();
}

/**
 * Zamienia surowy payload webhooka na znormalizowane zdarzenie. Zwraca null
 * tylko wtedy, gdy payload nie jest zdarzeniem (brak `type`) - nieznane typy
 * przechodzą jako kind='other' i lądują w logu, żeby nowe zdarzenia dostawcy
 * nie znikały bez śladu.
 */
export function normalizeResendEvent(payload: unknown): NormalizedDeliveryEvent | null {
  if (!isRecord(payload)) return null;
  const eventType = str(payload.type);
  if (!eventType) return null;

  const data = isRecord(payload.data) ? payload.data : {};
  const kind = KIND_BY_TYPE[eventType] ?? "other";

  const bounce = isRecord(data.bounce) ? data.bounce : null;
  const failed = isRecord(data.failed) ? data.failed : null;
  const click = isRecord(data.click) ? data.click : null;

  const bounceClass =
    kind === "bounced" ? classifyBounce(str(bounce?.type), str(bounce?.subType)) : null;

  const diagnostic =
    str(bounce?.message) ??
    str(failed?.reason) ??
    (kind === "complained" ? str(data.subject) : null);

  return {
    eventType,
    kind,
    bounceClass,
    email: firstRecipient(data),
    messageId: str(data.email_id) ?? str(data.id),
    occurredAt: isoOrNow(data.created_at, payload.created_at),
    diagnostic: diagnostic ? diagnostic.slice(0, 1000) : null,
    url: kind === "clicked" ? (str(click?.link)?.slice(0, 2048) ?? null) : null,
    tags: parseTags(data.tags),
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Wyciąga UUID z tagu wysyłki; odrzuca wszystko, co nie jest UUID-em. */
export function uuidTag(
  tags: Readonly<Record<string, string>>,
  ...keys: readonly string[]
): string | null {
  for (const key of keys) {
    const value = tags[key];
    if (value && UUID_RE.test(value)) return value;
  }
  return null;
}
