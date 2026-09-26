// Google Wallet: klasa wydarzenia, obiekt biletu i link „Dodaj do Google Wallet”.
//
// PRZEPŁYW. (1) Token OAuth konta usługi (JWT RS256 wymieniany na
// `oauth2.googleapis.com/token` - wzór `getServiceAccountToken` z
// `analytics/ga4.server.ts`, zakres `wallet_object.issuer`). (2) Upsert klasy
// `<issuer>.evt_<eventId>` i obiektu `<issuer>.reg_<registrationId>` przez
// REST. (3) „Chudy” JWT `savetowallet` z samym identyfikatorem obiektu ->
// `https://pay.google.com/gp/v/save/<jwt>`. Chudy, bo pełny obiekt w JWT
// wydłużałby adres ponad limity przeglądarek, a obiekt i tak istnieje po (2).
//
// UPSERT BEZ WYŚCIGU: najpierw PATCH (najczęstszy przypadek przy klasie -
// istnieje od pierwszego biletu), na 404 POST, a na 409 z POST (ktoś wstawił
// równolegle) jeszcze raz PATCH. Każdy inny status to `GoogleWalletError`.
//
// DATY Z PRZESUNIĘCIEM STREFY WYDARZENIA. Google pokazuje czas „lokalny”
// z przesunięcia w znaczniku - znacznik w UTC pokazałby uczestnikowi godzinę
// o dwie godziny za wcześnie. `isoInTimeZone` liczy przesunięcie numerycznie
// (bez zależności od formatu nazw stref w danym silniku).
//
// PRZEPUSTKI MOŻNA PÓŹNIEJ AKTUALIZOWAĆ/DEZAKTYWOWAĆ (`state: INACTIVE`) po
// identyfikatorze z dziennika `event_wallet_passes` - to jest następny krok,
// nie część tej wersji.
//
// Moduł serwerowy: klucz prywatny konta usługi z konfiguracji.
import { importRsaSigningKey, signRsaSha256 } from "./rsa";
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

function localized(value: WalletText, lang: WalletLang): LocalizedString {
  const other: WalletLang = lang === "pl" ? "en" : "pl";
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

export function googleObjectId(issuerId: string, registrationId: string): string {
  return `${issuerId}.reg_${registrationId}`;
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

/** `eventTicketObject` - jeden bilet jednej osoby. */
export function buildEventTicketObject(
  ticket: WalletTicket,
  issuerId: string,
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
    id: googleObjectId(issuerId, ticket.registrationId),
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

/** Idempotentny zapis zasobu: PATCH -> (404) POST -> (409) PATCH. */
export async function upsertWalletResource(
  resource: WalletResource,
  id: string,
  body: Record<string, unknown>,
  token: string,
): Promise<void> {
  const itemUrl = `${GOOGLE_WALLET_API}/${resource}/${encodeURIComponent(id)}`;
  let status = await call("PATCH", itemUrl, token, body);
  if (status === 404) {
    status = await call("POST", `${GOOGLE_WALLET_API}/${resource}`, token, body);
    if (status === 409) status = await call("PATCH", itemUrl, token, body);
  }
  if (status < 200 || status >= 300) {
    throw new GoogleWalletError(status, `google wallet ${resource} upsert failed`);
  }
}

export interface GoogleSaveInput {
  readonly ticket: WalletTicket;
  readonly config: GoogleWalletConfig;
  readonly publicOrigin: string | null;
  readonly nowMs: number;
}

/** Klasa + obiekt w Google i link zapisu do portfela. */
export async function createGoogleWalletSave(
  input: GoogleSaveInput,
): Promise<{ saveUrl: string; objectId: string }> {
  const { ticket, config, publicOrigin, nowMs } = input;
  const token = await walletAccessToken(config.serviceAccount, nowMs);
  await upsertWalletResource(
    "eventTicketClass",
    googleClassId(config.issuerId, ticket.event.id),
    buildEventTicketClass(ticket, config.issuerId, publicOrigin),
    token,
  );
  const objectId = googleObjectId(config.issuerId, ticket.registrationId);
  await upsertWalletResource(
    "eventTicketObject",
    objectId,
    buildEventTicketObject(ticket, config.issuerId),
    token,
  );

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
  return { saveUrl: `${GOOGLE_WALLET_SAVE_URL}${jwt}`, objectId };
}
