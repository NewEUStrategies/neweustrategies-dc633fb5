// Model kanałów SYGNAŁÓW (@wzmianka, prośba o zdanie) - CZYSTY moduł (bez
// Supabase, bez Reacta, bez env), importowalny w przeglądarce i na serwerze.
//
// Sygnał to powiadomienie, które adresuje KONKRETNĄ osobę z imienia: ktoś
// wspomniał o niej w dyskusji albo poprosił ją o zdanie w wątku klubu. Poza
// skrzynką in-app odbiorca może wybrać trzy kanały:
//   - web push (zakres `push_scope`: wszystkie powiadomienia albo tylko sygnały),
//   - natychmiastowy e-mail (`signal_email`, domyślnie WYŁĄCZONY),
//   - osobisty webhook (Slack, Discord albo własny adres https z podpisem HMAC).
//
// Stałe niżej są lustrem SQL migracji 20261120120000_notification_signal_channels
// (producent `enqueue_signal_notification`, claim/raport kolejki) - zmiana
// jednej strony wymaga zmiany drugiej.

export const NOTIFICATION_SIGNALS = ["mention", "expert_ping"] as const;
export type NotificationSignal = (typeof NOTIFICATION_SIGNALS)[number];

export const WEBHOOK_FORMATS = ["standard", "slack", "discord"] as const;
export type WebhookFormat = (typeof WEBHOOK_FORMATS)[number];

export const PUSH_SCOPES = ["all", "signals"] as const;
export type PushScope = (typeof PUSH_SCOPES)[number];

/** Maks. e-maili sygnału na odbiorcę w ciągu godziny (SQL: `v_recent < 12`). */
export const SIGNAL_EMAIL_HOURLY_CAP = 12;
/** Maks. prób dostarczenia zadania kanału (SQL: `attempts < 6`). */
export const SIGNAL_JOB_MAX_ATTEMPTS = 6;
/** Tyle kolejnych porażek wyłącza webhook (SQL: `consecutive_failures + 1 >= 10`). */
export const WEBHOOK_FAILURE_DISABLE_THRESHOLD = 10;
export const WEBHOOK_URL_MIN_LENGTH = 12;
export const WEBHOOK_URL_MAX_LENGTH = 2048;
/** Wersja kontraktu formatu `standard` - podbijana przy zmianie łamiącej. */
export const WEBHOOK_API_VERSION = "2026-11-20";

export function isNotificationSignal(value: unknown): value is NotificationSignal {
  return typeof value === "string" && (NOTIFICATION_SIGNALS as readonly string[]).includes(value);
}

export function isWebhookFormat(value: unknown): value is WebhookFormat {
  return typeof value === "string" && (WEBHOOK_FORMATS as readonly string[]).includes(value);
}

export type WebhookUrlIssue =
  "empty" | "too_long" | "unparseable" | "scheme" | "credentials" | "host" | "port";

export type WebhookUrlCheck = { ok: true; url: string } | { ok: false; issue: WebhookUrlIssue };

const ALLOWED_WEBHOOK_PORTS = new Set(["", "443", "8443"]);
const BLOCKED_HOST_SUFFIXES = [".internal", ".local", ".localhost", ".lan", ".home.arpa"];

function isIpLiteral(host: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.includes(":");
}

/**
 * Walidacja KSZTAŁTU adresu webhooka - wspólna dla formularza, serwera
 * i dyspozytora. Odrzuca wszystko poza https z nazwą hosta (żadnych literałów
 * IP, `localhost`, sufiksów sieci lokalnych, danych logowania w adresie,
 * niestandardowych portów). Właściwą bramkę SSRF (DNS -> wyłącznie publiczne
 * adresy) robi przed KAŻDĄ wysyłką `assertPublicHttpUrl` po stronie serwera.
 */
export function checkWebhookUrl(raw: string | null | undefined): WebhookUrlCheck {
  const value = (raw ?? "").trim();
  if (!value) return { ok: false, issue: "empty" };
  if (value.length > WEBHOOK_URL_MAX_LENGTH) return { ok: false, issue: "too_long" };
  if (value.length < WEBHOOK_URL_MIN_LENGTH || /\s/.test(value)) {
    return { ok: false, issue: "unparseable" };
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, issue: "unparseable" };
  }
  if (url.protocol !== "https:") return { ok: false, issue: "scheme" };
  if (url.username || url.password) return { ok: false, issue: "credentials" };
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (
    !host ||
    !host.includes(".") ||
    host === "localhost" ||
    isIpLiteral(host.replace(/^\[|\]$/g, "")) ||
    BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))
  ) {
    return { ok: false, issue: "host" };
  }
  if (!ALLOWED_WEBHOOK_PORTS.has(url.port)) return { ok: false, issue: "port" };
  return { ok: true, url: value };
}

/** Typ zdarzenia w kontrakcie webhooka. */
export function webhookEventType(signal: NotificationSignal): string {
  return signal === "mention" ? "mention.created" : "expert_ping.created";
}

export type SignalLang = "pl" | "en";

/** Ładunek zadania kanału zapisany przez `enqueue_signal_notification`. */
export interface SignalJobPayload {
  notification_id?: string | null;
  signal?: string | null;
  kind?: string | null;
  title_pl?: string | null;
  title_en?: string | null;
  body_pl?: string | null;
  body_en?: string | null;
  href?: string | null;
  created_at?: string | null;
}

/** Zdarzenie gotowe do wysyłki jednym kanałem - jedno źródło treści. */
export interface SignalEvent {
  id: string;
  signal: NotificationSignal;
  lang: SignalLang;
  title: string;
  body: string;
  /** Absolutny adres W SERWISIE (nigdy obcy origin, nigdy `javascript:`). */
  url: string;
  createdAt: string;
}

const SIGNAL_TITLE_FALLBACK: Readonly<Record<SignalLang, Record<NotificationSignal, string>>> = {
  pl: { mention: "Ktoś wspomniał o Tobie", expert_ping: "Poproszono Cię o zdanie" },
  en: { mention: "Someone mentioned you", expert_ping: "You were asked to weigh in" },
};

function pickText(primary: string | null | undefined, fallback: string | null | undefined): string {
  return (primary ?? "").trim() || (fallback ?? "").trim();
}

/**
 * Absolutny adres w serwisie. Href spoza originu serwisu (albo
 * nieparsowalny) zamienia się w stronę główną - link w mailu i w Slacku nie
 * może prowadzić poza platformę, nawet gdy w bazie znalazł się zły wpis.
 */
export function siteAbsoluteUrl(href: string | null | undefined, siteUrl: string): string {
  const base = new URL(siteUrl);
  if (!href) return base.origin + "/";
  try {
    const url = new URL(href, base);
    return url.origin === base.origin ? url.toString() : base.origin + "/";
  } catch {
    return base.origin + "/";
  }
}

export function signalEventFromPayload(input: {
  jobId: string | number;
  signal: NotificationSignal;
  payload: SignalJobPayload;
  lang: SignalLang;
  siteUrl: string;
}): SignalEvent {
  const { payload, lang, signal } = input;
  const title =
    (lang === "en"
      ? pickText(payload.title_en, payload.title_pl)
      : pickText(payload.title_pl, payload.title_en)) || SIGNAL_TITLE_FALLBACK[lang][signal];
  const body =
    lang === "en"
      ? pickText(payload.body_en, payload.body_pl)
      : pickText(payload.body_pl, payload.body_en);
  return {
    id: (payload.notification_id ?? "").trim() || String(input.jobId),
    signal,
    lang,
    title,
    body,
    url: siteAbsoluteUrl(payload.href, input.siteUrl),
    createdAt: (payload.created_at ?? "").trim() || new Date().toISOString(),
  };
}

/** Escape treści dla mrkdwn Slacka (`&`, `<`, `>` są składnią linków i wzmianek). */
function slackEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Discord: neutralizacja `@everyone`/`@here` i zbyt długiej treści. */
function discordSafe(value: string): string {
  return value.replace(/@(everyone|here)/gi, "@\u200b$1");
}

const DISCORD_CONTENT_LIMIT = 2000;
const SLACK_TEXT_LIMIT = 3000;

function clip(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}

const OPEN_LABEL: Readonly<Record<SignalLang, string>> = {
  pl: "Otwórz dyskusję",
  en: "Open the discussion",
};

/**
 * Ciało żądania webhooka w wybranym formacie. `standard` to stabilny kontrakt
 * JSON z podpisem; `slack` i `discord` to formaty ich "incoming webhooks".
 * Wzmianki masowe w Slacku i Discordzie są neutralizowane - treść pochodzi od
 * innych członków, więc nie może pingować całego kanału odbiorcy.
 */
export function buildWebhookBody(format: WebhookFormat, event: SignalEvent): string {
  if (format === "slack") {
    const lines = [`*${slackEscape(event.title)}*`];
    if (event.body) lines.push(slackEscape(event.body));
    lines.push(`<${event.url}|${slackEscape(OPEN_LABEL[event.lang])}>`);
    return JSON.stringify({ text: clip(lines.join("\n"), SLACK_TEXT_LIMIT), unfurl_links: false });
  }
  if (format === "discord") {
    const lines = [`**${discordSafe(event.title)}**`];
    if (event.body) lines.push(discordSafe(event.body));
    lines.push(event.url);
    return JSON.stringify({
      content: clip(lines.join("\n"), DISCORD_CONTENT_LIMIT),
      allowed_mentions: { parse: [] },
    });
  }
  return JSON.stringify({
    id: event.id,
    type: webhookEventType(event.signal),
    api_version: WEBHOOK_API_VERSION,
    created_at: event.createdAt,
    data: {
      signal: event.signal,
      title: event.title,
      body: event.body || null,
      url: event.url,
      lang: event.lang,
    },
  });
}
