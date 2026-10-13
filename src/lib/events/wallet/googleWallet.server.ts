// Google Wallet: klasa wydarzenia, obiekt biletu i link „Dodaj do Google Wallet”.
//
// PRZEPŁYW. (1) Token OAuth konta usługi (JWT RS256 wymieniany na
// `oauth2.googleapis.com/token` - wzór `getServiceAccountToken` z
// `analytics/ga4.server.ts`, zakres `wallet_object.issuer`). (2) Upsert klasy
// `<issuer>.evt_<eventId>` i obiektu `<issuer>.reg_<registrationId>.<kod>`
// przez REST. (3) „Chudy” JWT `savetowallet` z samym identyfikatorem obiektu ->
// `https://pay.google.com/gp/v/save/<jwt>`. Chudy, bo pełny obiekt w JWT
// wydłużałby adres ponad limity przeglądarek, a obiekt i tak istnieje po (2).
//
// OBIEKT NA KOD, NIE NA ZGŁOSZENIE (OPS-14). Sufiks identyfikatora to 12 znaków
// SHA-256 kodu biletu (w osobnej domenie skrótu, więc to NIE jest prefiks
// `qr_token_hash` z bazy). Nowy kod (ponowna wysyłka, unieważnienie
// zgubionego) to nowy obiekt; obiekt starego kodu zadanie
// `walletRevocationJob.server.ts` ustawia jako INACTIVE i nic go już nie
// reaktywuje: dodanie wymaga WAŻNEGO kodu, a ten prowadzi do nowego obiektu.
// Ktoś, kto zapisał stary obiekt w swoim koncie Google (przekazany mail), nie
// dostaje więc nowego kodu, a zadanie i ponowne dodanie przez uczestnika nie
// piszą do tego samego obiektu. Wyjątek: przed migracją 20261012130000 trasa
// wydaje obiekt w starym kształcie `<issuer>.reg_<registrationId>`
// (`legacyGoogleObjectId`) - inaczej stara funkcja dziennika nadpisałaby jego
// wiersz i obiekt sprzed OPS-14 nigdy nie trafiłby do dezaktywacji.
//
// KOSZT JEDNEGO „DODAJ” (OPS-14). Dotąd każde kliknięcie importowało klucz
// i robiło PATCH klasy i obiektu. Teraz: klucz jest importowany raz na izolat
// (`rsa.ts`), klasa jest zapisywana raz na izolat i treść (pamięć po
// identyfikatorze klasy i SHA-256 treści, ważna 15 minut), a obiekt - tylko gdy
// baza nie zna go jako aktywnego z TĄ SAMĄ treścią (`_event_wallet_pass_state`,
// skrót treści w `event_wallet_passes.content_hash`). Obiekt, którego baza nie
// zna, jest wstawiany od razu (POST), bez PATCH kończącego się 404.
//
// UPSERT BEZ WYŚCIGU: PATCH (zasób zwykle istnieje), na 404 POST, a na 409
// z POST (ktoś wstawił równolegle) jeszcze raz PATCH; przy wstawianiu od razu
// - POST, na 409 PATCH. Każdy inny status to `GoogleWalletError`.
//
// DATY Z PRZESUNIĘCIEM STREFY WYDARZENIA. Google pokazuje czas „lokalny”
// z przesunięcia w znaczniku - znacznik w UTC pokazałby uczestnikowi godzinę
// o dwie godziny za wcześnie. `isoInTimeZone` liczy przesunięcie numerycznie
// (bez zależności od formatu nazw stref w danym silniku).
//
// Moduł serwerowy: klucz prywatny konta usługi z konfiguracji.
import { importRsaSigningKey, sha256, signRsaSha256, toHex } from "./rsa";
import type { GoogleServiceAccount, GoogleWalletConfig } from "./walletConfig.server";
import { WALLET_COPY, type WalletLang } from "./walletCopy";
import { eventPageUrl, type WalletText, type WalletTicket } from "./walletTicket";

export const GOOGLE_WALLET_API = "https://walletobjects.googleapis.com/walletobjects/v1";
export const GOOGLE_WALLET_SAVE_URL = "https://pay.google.com/gp/v/save/";
const WALLET_SCOPE = "https://www.googleapis.com/auth/wallet_object.issuer";
const FETCH_TIMEOUT_MS = 8_000;
const DAY_MS = 24 * 60 * 60 * 1000;

export class GoogleWalletError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "GoogleWalletError";
  }
}

// ── JWT ────────────────────────────────────────────────────────────────────

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

/** JWT RS256 podpisany kluczem konta usługi. */
export async function signServiceAccountJwt(
  claims: Record<string, unknown>,
  account: GoogleServiceAccount,
): Promise<string> {
  const encoder = new TextEncoder();
  const header = base64Url(encoder.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const body = base64Url(encoder.encode(JSON.stringify(claims)));
  const input = `${header}.${body}`;
  const key = await importRsaSigningKey(account.privateKeyPem);
  return `${input}.${base64Url(await signRsaSha256(key, encoder.encode(input)))}`;
}

// Token per izolat i per konto; odświeżany 60 s przed wygaśnięciem.
let tokenCache: { email: string; token: string; exp: number } | null = null;

/** Token dostępu OAuth z zakresem wystawcy Google Wallet. */
export async function walletAccessToken(account: GoogleServiceAccount, nowMs: number) {
  const now = Math.floor(nowMs / 1000);
  if (
    tokenCache !== null &&
    tokenCache.email === account.clientEmail &&
    tokenCache.exp - 60 > now
  ) {
    return tokenCache.token;
  }
  const assertion = await signServiceAccountJwt(
    {
      iss: account.clientEmail,
      scope: WALLET_SCOPE,
      aud: account.tokenUri,
      iat: now,
      exp: now + 3600,
    },
    account,
  );
  const response = await fetch(account.tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }).toString(),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const payload: unknown = await response.json().catch(() => null);
  const record = typeof payload === "object" && payload !== null ? payload : {};
  const token = "access_token" in record ? record.access_token : undefined;
  if (!response.ok || typeof token !== "string" || token === "") {
    throw new GoogleWalletError(response.status, "google wallet token exchange failed");
  }
  const expiresIn = "expires_in" in record ? Number(record.expires_in) : Number.NaN;
  tokenCache = { email: account.clientEmail, token, exp: now + expiresIn };
  return token;
}

// ── Treść klasy i obiektu ─────────────────────────────────────────────────

/** `Date` w strefie -> `YYYY-MM-DDTHH:mm:ss±HH:MM` (przesunięcie tej strefy w tej chwili). */
export function isoInTimeZone(iso: string, timeZone: string): string {
  const instant = Math.floor(new Date(iso).getTime() / 1000) * 1000;
  const parts: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instant))) {
    parts[part.type] = part.value;
  }
  const wall = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  const offsetMinutes = Math.round((wall - instant) / 60_000);
  const sign = offsetMinutes < 0 ? "-" : "+";
  const abs = Math.abs(offsetMinutes);
  const offset = `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset}`;
}

interface LocalizedString {
  defaultValue: { language: WalletLang; value: string };
  translatedValues: { language: WalletLang; value: string }[];
}

/** Drugi język przepustki - wartość tłumaczenia obok domyślnej. */
const OTHER_LANG: Record<WalletLang, WalletLang> = { pl: "en", en: "pl" };

function localized(value: WalletText, lang: WalletLang): LocalizedString {
  const other = OTHER_LANG[lang];
  return {
    defaultValue: { language: lang, value: value[lang] },
    translatedValues: [{ language: other, value: value[other] }],
  };
}

function same(value: string): WalletText {
  return { pl: value, en: value };
}

function copyText(key: "group" | "info" | "infoText"): WalletText {
  return { pl: WALLET_COPY.pl[key], en: WALLET_COPY.en[key] };
}

export function googleClassId(issuerId: string, eventId: string): string {
  return `${issuerId}.evt_${eventId}`;
}

/**
 * Sufiks obiektu z kodu biletu: 12 znaków szesnastkowych SHA-256 w domenie
 * `nes-wallet-object:` (nie prefiks skrótu kodu z bazy). 48 bitów wystarcza,
 * żeby kody JEDNEGO zgłoszenia się nie zderzyły.
 */
export async function walletObjectSuffix(qrToken: string): Promise<string> {
  const digest = await sha256(new TextEncoder().encode(`nes-wallet-object:${qrToken}`));
  return toHex(digest).slice(0, 12);
}

/**
 * Identyfikator obiektu sprzed OPS-14: jeden obiekt na zgłoszenie. Trasa
 * wydaje go już tylko wtedy, gdy baza nie ma migracji 20261012130000 (stara
 * funkcja dziennika trzyma JEDEN wiersz na zgłoszenie i nadpisuje jego
 * identyfikator - obiekt z kodem zgubiłby ten wiersz). Jest prefiksem
 * identyfikatora z kodem, więc migracja 20261012170000 wyprowadza go z wiersza
 * dziennika (`_event_wallet_pass_queue_legacy_google_objects`).
 */
export function legacyGoogleObjectId(issuerId: string, registrationId: string): string {
  return `${issuerId}.reg_${registrationId}`;
}

export function googleObjectId(issuerId: string, registrationId: string, suffix: string): string {
  return `${legacyGoogleObjectId(issuerId, registrationId)}.${suffix}`;
}

/** SHA-256 (hex) treści zasobu - `JSON.stringify` budowniczych jest deterministyczny. */
export async function walletContentHash(body: Record<string, unknown>): Promise<string> {
  return toHex(await sha256(new TextEncoder().encode(JSON.stringify(body))));
}

/** `eventTicketClass` - wspólna dla wszystkich biletów wydarzenia. */
export function buildEventTicketClass(
  ticket: WalletTicket,
  issuerId: string,
  publicOrigin: string | null,
): Record<string, unknown> {
  const { event, lang } = ticket;
  const page = eventPageUrl(publicOrigin, event.slug);
  return {
    id: googleClassId(issuerId, event.id),
    issuerName: ticket.organizationName,
    reviewStatus: "UNDER_REVIEW",
    eventId: event.id,
    eventName: localized(event.title, lang),
    dateTime: {
      start: isoInTimeZone(event.startsAt, event.timezone),
      ...(event.endsAt === null ? {} : { end: isoInTimeZone(event.endsAt, event.timezone) }),
    },
    ...(event.location === null ? {} : { venue: { name: localized(same(event.location), lang) } }),
    ...(event.coverUrl === null
      ? {}
      : {
          heroImage: {
            sourceUri: { uri: event.coverUrl },
            contentDescription: localized(event.title, lang),
          },
        }),
    ...(page === null ? {} : { homepageUri: { uri: page, description: event.title[lang] } }),
    hexBackgroundColor: ticket.colors.background,
  };
}

/** `eventTicketObject` - jeden bilet (jeden kod) jednej osoby. */
export function buildEventTicketObject(
  ticket: WalletTicket,
  issuerId: string,
  objectId: string,
): Record<string, unknown> {
  const { event, lang } = ticket;
  const lastDay = new Date(new Date(event.endsAt ?? event.startsAt).getTime() + DAY_MS);
  const modules = [
    ...(ticket.groupName === null
      ? []
      : [
          {
            id: "group",
            header: WALLET_COPY[lang].group,
            body: ticket.groupName[lang],
            localizedHeader: localized(copyText("group"), lang),
            localizedBody: localized(ticket.groupName, lang),
          },
        ]),
    {
      id: "info",
      header: WALLET_COPY[lang].info,
      body: WALLET_COPY[lang].infoText,
      localizedHeader: localized(copyText("info"), lang),
      localizedBody: localized(copyText("infoText"), lang),
    },
  ];
  return {
    id: objectId,
    classId: googleClassId(issuerId, event.id),
    state: "ACTIVE",
    barcode: { type: "QR_CODE", value: ticket.qrToken, alternateText: ticket.qrToken },
    ...(ticket.holderName === null ? {} : { ticketHolderName: ticket.holderName }),
    ...(ticket.ticketName === null ? {} : { ticketType: localized(ticket.ticketName, lang) }),
    hexBackgroundColor: ticket.colors.background,
    validTimeInterval: { end: { date: isoInTimeZone(lastDay.toISOString(), event.timezone) } },
    textModulesData: modules,
  };
}

// ── REST ───────────────────────────────────────────────────────────────────

type WalletResource = "eventTicketClass" | "eventTicketObject";

async function call(
  method: "PATCH" | "POST",
  url: string,
  token: string,
  body: Record<string, unknown>,
): Promise<number> {
  const response = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  return response.status;
}

function isSuccess(status: number): boolean {
  return status >= 200 && status < 300;
}

/**
 * Idempotentny zapis zasobu: PATCH -> (404) POST -> (409) PATCH, a przy
 * `insertFirst` (zasobu nie ma w dzienniku) od razu POST -> (409) PATCH.
 */
export async function upsertWalletResource(
  resource: WalletResource,
  id: string,
  body: Record<string, unknown>,
  token: string,
  options: { insertFirst?: boolean } = {},
): Promise<void> {
  const itemUrl = `${GOOGLE_WALLET_API}/${resource}/${encodeURIComponent(id)}`;
  const collectionUrl = `${GOOGLE_WALLET_API}/${resource}`;
  let status: number;
  if (options.insertFirst === true) {
    status = await call("POST", collectionUrl, token, body);
    if (status === 409) status = await call("PATCH", itemUrl, token, body);
  } else {
    status = await call("PATCH", itemUrl, token, body);
    if (status === 404) {
      status = await call("POST", collectionUrl, token, body);
      if (status === 409) status = await call("PATCH", itemUrl, token, body);
    }
  }
  if (!isSuccess(status)) {
    throw new GoogleWalletError(status, `google wallet ${resource} upsert failed`);
  }
}

/**
 * Stan obiektu biletu (`INACTIVE` - unieważniony, `ACTIVE` - przywrócony)
 * częściowym PATCH-em. `missing` = obiektu nie ma (nic do unieważnienia).
 */
export async function setWalletObjectState(
  objectId: string,
  state: "ACTIVE" | "INACTIVE",
  token: string,
): Promise<"updated" | "missing"> {
  const status = await call(
    "PATCH",
    `${GOOGLE_WALLET_API}/eventTicketObject/${encodeURIComponent(objectId)}`,
    token,
    { state },
  );
  if (status === 404) return "missing";
  if (!isSuccess(status)) {
    throw new GoogleWalletError(status, "google wallet eventTicketObject state update failed");
  }
  return "updated";
}

// Klasa zapisana w tym izolacie: identyfikator -> skrót treści i ważność wpisu.
// Wpis wygasa, żeby zmiana po stronie Google (np. ręczna edycja w konsoli
// wystawcy) nie żyła w izolacie bez końca; sufit chroni pamięć przy wielu
// wydarzeniach.
const CLASS_MEMO_TTL_MS = 15 * 60 * 1000;
const CLASS_MEMO_LIMIT = 256;
const classMemo = new Map<string, { hash: string; until: number }>();

/** Tylko testy: czysta pamięć klas. */
export function resetGoogleWalletMemoForTests(): void {
  classMemo.clear();
}

async function ensureEventClass(
  classId: string,
  body: Record<string, unknown>,
  token: string,
  nowMs: number,
): Promise<boolean> {
  const hash = await walletContentHash(body);
  const memo = classMemo.get(classId);
  if (memo !== undefined && memo.hash === hash && memo.until > nowMs) return false;
  await upsertWalletResource("eventTicketClass", classId, body, token);
  classMemo.delete(classId);
  classMemo.set(classId, { hash, until: nowMs + CLASS_MEMO_TTL_MS });
  if (classMemo.size > CLASS_MEMO_LIMIT) {
    const oldest = classMemo.keys().next().value;
    if (oldest !== undefined) classMemo.delete(oldest);
  }
  return true;
}

/**
 * Obiekt w dzienniku (`_event_wallet_pass_state`): `null` = dziennik go nie
 * zna, `undefined` = stanu nie udało się odczytać (zapisujemy jak dawniej).
 */
export interface StoredWalletObject {
  readonly contentHash: string | null;
  readonly active: boolean;
}

export interface GoogleSaveInput {
  readonly ticket: WalletTicket;
  readonly config: GoogleWalletConfig;
  readonly publicOrigin: string | null;
  readonly nowMs: number;
  /** Identyfikator obiektu (`googleObjectId` z sufiksem kodu). */
  readonly objectId: string;
  readonly stored?: StoredWalletObject | null;
}

export interface GoogleSaveResult {
  readonly saveUrl: string;
  readonly objectId: string;
  /** SHA-256 treści obiektu - do dziennika (`p_content_hash`). */
  readonly contentHash: string;
  /** Czy w tym wywołaniu zapisano klasę / obiekt (koszt API). */
  readonly classWritten: boolean;
  readonly objectWritten: boolean;
}

/** Klasa + obiekt w Google (tylko gdy trzeba) i link zapisu do portfela. */
export async function createGoogleWalletSave(input: GoogleSaveInput): Promise<GoogleSaveResult> {
  const { ticket, config, publicOrigin, nowMs, objectId, stored } = input;
  const token = await walletAccessToken(config.serviceAccount, nowMs);
  const classWritten = await ensureEventClass(
    googleClassId(config.issuerId, ticket.event.id),
    buildEventTicketClass(ticket, config.issuerId, publicOrigin),
    token,
    nowMs,
  );

  const objectBody = buildEventTicketObject(ticket, config.issuerId, objectId);
  const contentHash = await walletContentHash(objectBody);
  const unchanged =
    stored !== undefined && stored !== null && stored.active && stored.contentHash === contentHash;
  if (!unchanged) {
    await upsertWalletResource("eventTicketObject", objectId, objectBody, token, {
      insertFirst: stored === null,
    });
  }

  const jwt = await signServiceAccountJwt(
    {
      iss: config.serviceAccount.clientEmail,
      aud: "google",
      typ: "savetowallet",
      iat: Math.floor(nowMs / 1000),
      ...(publicOrigin === null ? {} : { origins: [publicOrigin] }),
      payload: { eventTicketObjects: [{ id: objectId }] },
    },
    config.serviceAccount,
  );
  return {
    saveUrl: `${GOOGLE_WALLET_SAVE_URL}${jwt}`,
    objectId,
    contentHash,
    classWritten,
    objectWritten: !unchanged,
  };
}
