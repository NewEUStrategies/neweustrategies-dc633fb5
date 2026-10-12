// Publiczny zapis na wydarzenie - logika server-only dla
// `eventRegistration.functions.ts` (REG-04, decyzje D2/D3).
//
// SKĄD TOŻSAMOŚĆ. Nic z ciała żądania:
//   * najemca - zaufany host (`resolveTenantIdForHost(currentTenantHost())`);
//     host bez najemcy to awaria hosta, odpowiadamy `unknown` BEZ pytania bazy;
//   * konto - zweryfikowana sesja (`optionalUserIdFromRequest`, `getClaims`);
//     podrobiony albo wygasły token to gość, nie cudze konto;
//   * adres - solony skrót (`requestRateSubject`, `ip:<32 hex>`), nigdy surowy
//     adres i nigdy nagłówek czytany tutaj (jedyną definicją „kto dzwoni" jest
//     `clientIpFromHeaders` - `check:client-ip-source`);
//   * przeglądarka - nagłówek `user-agent` przycięty do 400 znaków (metadana
//     dowodu zgody, sufit kolumny w bazie).
// Baza (`event_register_for_client`, tylko `service_role`) liczy kubełek adresu
// i konta i oddaje odmowy WARTOŚCIĄ - żadna próba nie cofa licznika.
//
// DO PRZEGLĄDARKI WRACA WYŁĄCZNIE `client`. Odpowiedź bazy ma dwie części:
// `client` (to, co wolno pokazać wołającemu) i `delivery` (adres, klucz
// samoobsługi, kod QR, token zgody - wyłącznie dla serwera). Niezweryfikowany
// wołający dostaje stałe `{ ok: true, outcome: "check_email" }` - identyczne dla
// „utworzono" i „już zapisany" - a wynik dostaje SKRZYNKA: serwer wysyła
// potwierdzenie z linkiem samoobsługi albo wiadomość do właściciela adresu.
//
// DOSTAWA PO ODPOWIEDZI (`runAfterResponse`). Maile, bilet i atrybucja biegną
// po wysłaniu odpowiedzi, pod `waitUntil` workera. Dwa powody:
//   1. CZAS ODPOWIEDZI NIE ZDRADZA GAŁĘZI. „Utworzono" wysyła potwierdzenie,
//      bilet i atrybucję, „już zapisany" - jedną wiadomość; czekanie na nie
//      przed odpowiedzią byłoby wyrocznią członkostwa mierzoną zegarkiem.
//   2. FAIL-SOFT Z KONSTRUKCJI. Awaria poczty nie może zmienić odpowiedzi
//      zapisu, który już stoi w bazie - każdy krok ma własny `try` i log.
//
// BILET Z KODEM QR OD RAZU. Zgłoszenie zatwierdzone i rozliczone przy zapisie
// (bezpłatne, bez akceptacji) ma w bazie kod z chwili zapisu, którego NIKT nie
// wysyła - `_event_issue_ticket_codes` (cron `_event_ticket_codes_pending`,
// co minutę) wydaje świeży kod i dopiero ten trafia do maila (ROTACJA skrótu).
// Wołamy to samo wydanie od razu, żeby działający kod nie czekał na cron ani
// nie zależał od jego zdrowia. Rotacja nie unieważnia niczego, co ktoś widzi:
// ekran potwierdzenia nie rysuje kodu z odpowiedzi zapisu (bilet otwiera się
// z maila, `ticketLinkPath`), a cron i tak zrotowałby go w ciągu minuty.
//
// OKNO WDROŻENIA („najpierw kod"). Dopóki funkcji `event_register_for_client`
// nie ma (PGRST202/42883), wołamy starą `event_register` klientem anonimowym
// z nagłówkiem hosta i tokenem wołającego, a jej odpowiedź mapujemy na nowy
// kształt (`registered` + dostawa „utworzono"). Stara funkcja nie zna
// weryfikacji adresu, więc w tym oknie wynik idzie do przeglądarki jak dotąd -
// znika razem z migracją. Każdy inny błąd bazy to `unknown` z logiem.
import { getRequest } from "@tanstack/react-start/server";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

import type { Database, Json } from "@/integrations/supabase/types";
import {
  optionalBearerFromRequest,
  optionalUserIdFromRequest,
} from "@/lib/auth/optionalUser.server";
import {
  EVENT_CONSENT_PURPOSE_COPY,
  txCopy,
  type EventConsentConfirmPurpose,
} from "@/lib/email-templates/tx-copy";
import type { EmailLang } from "@/lib/email-templates/nes-layout";
import type { TxDetail } from "@/lib/email-templates/transactional";
import { currentTenantHost } from "@/lib/http/requestHost";
import { runAfterResponse } from "@/lib/http/waitUntil.server";
import { requestRateSubject, hashedRateSubject } from "@/lib/server/rateSubject.server";
import { resolveTenantIdForHost } from "@/lib/server/tenant.server";
import { isMigrationPending } from "@/lib/supabase/migrationPending";
import {
  registrationPayload,
  UNKNOWN_REGISTRATION_REFUSAL,
  type EventRegisterClient,
  type EventRegistrationRequest,
  type RegistrationAttribution,
  type RegistrationPayload,
  type RegistrationRefusalClient,
} from "@/lib/events/registrationPayload";
import { hostAnonClient } from "@/lib/events/registrationSelfNotify.server";

/** Sufit nagłówka `user-agent` - ten sam, co kolumny dowodu zgody w bazie. */
export const USER_AGENT_MAX = 400;

/** Kubełek maila double opt-in na ODBIORCĘ: 3 wiadomości na 60 minut. */
export const CONSENT_CONFIRM_RECIPIENT_LIMIT = { max: 3, windowMinutes: 60 } as const;

/** Jedyne kody, przy których baza dokłada ogon (`detail`) - listy pól i zgód. */
const DETAIL_CODES: ReadonlySet<string> = new Set([
  "missing_required_fields",
  "missing_required_consents",
  "terms_required",
]);

/** Kod odmowy z głowy komunikatu plpgsql - wszystko inne to `unknown`. */
const CODE_RE = /^[a-z][a-z0-9_]*$/;

/** Stała odpowiedź neutralna - NOWY obiekt, żeby żaden klucz z bazy się nie doczepił. */
const CHECK_EMAIL: EventRegisterClient = { ok: true, outcome: "check_email" };

type RegisterArgs = Database["public"]["Functions"]["event_register_for_client"]["Args"];

export interface RegistrationDeliveryRecipient {
  email: string | null;
  firstName: string | null;
  lang: EmailLang;
}

export interface RegistrationDeliveryEvent {
  id: string | null;
  slug: string | null;
  titlePl: string | null;
  titleEn: string | null;
  startsAt: string | null;
}

export interface RegistrationConsentConfirmation {
  token: string;
  purposes: EventConsentConfirmPurpose[];
  lang: EmailLang;
}

/** `delivery` z odpowiedzi bazy - WYŁĄCZNIE dla serwera, nigdy do przeglądarki. */
export interface RegistrationDelivery {
  kind: "created" | "already_registered";
  registrationId: string;
  /** Klucz samoobsługi jawnym tekstem - tylko „utworzono". */
  manageToken: string | null;
  /** Kod QR z chwili zapisu - tylko zgłoszenie zatwierdzone i rozliczone. */
  qrToken: string | null;
  status: string | null;
  recipient: RegistrationDeliveryRecipient | null;
  event: RegistrationDeliveryEvent | null;
  consentConfirmation: RegistrationConsentConfirmation | null;
}

interface RegisterOutcome {
  client: EventRegisterClient;
  delivery: RegistrationDelivery | null;
}

type JsonBag = { [key: string]: Json | undefined };

function bagOf(value: Json | undefined): JsonBag | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
}

function text(value: Json | undefined): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function langOf(value: Json | undefined): EmailLang {
  return value === "en" ? "en" : "pl";
}

function requestHeaders(): Headers | null {
  try {
    return getRequest().headers;
  } catch {
    return null;
  }
}

async function requestTenantId(): Promise<string | null> {
  try {
    return await resolveTenantIdForHost(await currentTenantHost());
  } catch {
    return null;
  }
}

/** Odmowa z komunikatu `RAISE EXCEPTION 'kod: ogon'` - kształt wartości z bazy. */
function refusalFromMessage(message: string): RegistrationRefusalClient {
  const separator = message.indexOf(":");
  const head = (separator === -1 ? message : message.slice(0, separator)).trim();
  if (!CODE_RE.test(head)) return UNKNOWN_REGISTRATION_REFUSAL;
  const tail = separator === -1 ? "" : message.slice(separator + 1).trim();
  return DETAIL_CODES.has(head) && tail !== ""
    ? { ok: false, error: head, detail: tail }
    : { ok: false, error: head };
}

/**
 * `client` z bazy -> odpowiedź dla przeglądarki. Odmowa niesie tylko kod (i ogon
 * trzech kodów z listami), odpowiedź neutralna jest STAŁĄ, a zapis
 * zweryfikowanego właściciela przechodzi tak, jak złożyła go baza.
 */
function clientOf(value: Json | undefined): EventRegisterClient {
  const bag = bagOf(value);
  if (bag === null) return UNKNOWN_REGISTRATION_REFUSAL;
  if (bag.ok === false) {
    const error = typeof bag.error === "string" && CODE_RE.test(bag.error) ? bag.error : "unknown";
    const detail = typeof bag.detail === "string" ? bag.detail.trim() : "";
    return DETAIL_CODES.has(error) && detail !== ""
      ? { ok: false, error, detail }
      : { ok: false, error };
  }
  if (bag.ok === true && bag.outcome === "check_email") return { ...CHECK_EMAIL };
  if (bag.ok === true && bag.outcome === "registered") {
    return { ...bag, ok: true, outcome: "registered" };
  }
  return UNKNOWN_REGISTRATION_REFUSAL;
}

function consentConfirmationOf(value: Json | undefined): RegistrationConsentConfirmation | null {
  const bag = bagOf(value);
  const token = bag === null ? null : text(bag.token);
  if (bag === null || token === null) return null;
  const purposes = (Array.isArray(bag.purposes) ? bag.purposes : []).filter(
    (purpose): purpose is EventConsentConfirmPurpose =>
      purpose === "marketing" || purpose === "partner_sharing",
  );
  if (purposes.length === 0) return null;
  return { token, purposes: [...new Set(purposes)], lang: langOf(bag.lang) };
}

/** `delivery` z bazy albo `null`, gdy nie ma czego dostarczyć. */
function deliveryOf(value: Json | undefined): RegistrationDelivery | null {
  const bag = bagOf(value);
  if (bag === null) return null;
  const kind = bag.kind === "created" || bag.kind === "already_registered" ? bag.kind : null;
  const registrationId = text(bag.registration_id);
  if (kind === null || registrationId === null) return null;
  const recipient = bagOf(bag.recipient);
  const event = bagOf(bag.event);
  return {
    kind,
    registrationId,
    manageToken: kind === "created" ? text(bag.manage_token) : null,
    qrToken: kind === "created" ? text(bag.qr_token) : null,
    status: text(bag.status),
    recipient:
      recipient === null
        ? null
        : {
            email: text(recipient.email),
            firstName: text(recipient.first_name),
            lang: langOf(recipient.lang),
          },
    event:
      event === null
        ? null
        : {
            id: text(event.id),
            slug: text(event.slug),
            titlePl: text(event.title_pl),
            titleEn: text(event.title_en),
            startsAt: text(event.starts_at),
          },
    consentConfirmation: consentConfirmationOf(bag.consent_confirmation),
  };
}

/**
 * Stara `event_register` (okno wdrożenia) -> nowy kształt. Konto idzie dalej
 * tokenem wołającego TYLKO wtedy, gdy serwer go zweryfikował - nieważny token
 * dałby 401 zamiast zapisu gościa.
 */
async function legacyRegister(
  payload: RegistrationPayload,
  userId: string | null,
): Promise<RegisterOutcome> {
  const bearer = userId === null ? null : await optionalBearerFromRequest();
  const legacy = await hostAnonClient(bearer);
  if (legacy === null) return { client: UNKNOWN_REGISTRATION_REFUSAL, delivery: null };
  const { data, error } = await legacy.rpc("event_register", { p_payload: payload });
  if (error) return { client: refusalFromMessage(error.message), delivery: null };

  const bag = bagOf(data);
  if (bag !== null && bag.ok === false) return { client: clientOf(bag), delivery: null };
  const registrationId = bag === null ? null : text(bag.registration_id);
  if (bag === null || registrationId === null) {
    return { client: UNKNOWN_REGISTRATION_REFUSAL, delivery: null };
  }
  return {
    client: { ...bag, ok: true, outcome: "registered" },
    delivery: {
      kind: "created",
      registrationId,
      manageToken: text(bag.manage_token),
      qrToken: text(bag.qr_token),
      status: text(bag.status),
      recipient: null,
      event: null,
      consentConfirmation: null,
    },
  };
}

/**
 * Zapis z tożsamością z serwera. Zwraca WYŁĄCZNIE odpowiedź dla przeglądarki;
 * dostawa (maile, bilet, atrybucja) biegnie po odpowiedzi.
 */
export async function submitEventRegistrationForRequest(
  input: EventRegistrationRequest,
): Promise<EventRegisterClient> {
  const tenantId = await requestTenantId();
  // Bez najemcy nie ma gdzie zapisać - to awaria hosta, nie odmowa zapisu.
  if (!tenantId) {
    console.error("[events] registration: tenant unresolved for host");
    return UNKNOWN_REGISTRATION_REFUSAL;
  }

  const headers = requestHeaders();
  const userId = await optionalUserIdFromRequest();
  // Podmiot ADRESU (bez konta): kubełek konta liczy baza osobno, po `_user_id`.
  const ipSubject = requestRateSubject(headers);
  const userAgent = headers?.get("user-agent")?.trim().slice(0, USER_AGENT_MAX) || null;
  const payload = registrationPayload(input);

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("event_register_for_client", {
    _tenant_id: tenantId,
    // NULL jest tu POPRAWNĄ wartością (gość, brak nagłówka) - wygenerowany typ
    // argumentu jej nie zna, więc zawężamy jawnie, jak `club_set_cover`.
    // Pominięcie klucza znaczyłoby inną sygnaturę (PGRST202), a to byłoby
    // fałszywe „okno wdrożenia".
    _user_id: userId as RegisterArgs["_user_id"],
    _ip_subject: ipSubject,
    _user_agent: userAgent as RegisterArgs["_user_agent"],
    p_payload: payload,
  });

  let outcome: RegisterOutcome;
  if (error) {
    if (!isMigrationPending(error)) {
      console.error("[events] registration rpc failed", error.code ?? "", error.message);
      return UNKNOWN_REGISTRATION_REFUSAL;
    }
    outcome = await legacyRegister(payload, userId);
  } else {
    const bag = bagOf(data);
    outcome = { client: clientOf(bag?.client), delivery: deliveryOf(bag?.delivery) };
  }

  // Baza zamienia nieoczekiwany wyjątek rdzenia na `unknown` (z RAISE WARNING) -
  // bez tego śladu po stronie serwera awaria wyglądałaby jak odmowa.
  if (outcome.client.ok === false && outcome.client.error === "unknown") {
    console.error("[events] registration refused as unknown", tenantId);
  }

  if (outcome.delivery !== null) {
    runAfterResponse(
      deliverRegistration({
        tenantId,
        delivery: outcome.delivery,
        attribution: input.attribution ?? null,
      }),
    );
  }
  return outcome.client;
}

export interface RegistrationDeliveryContext {
  tenantId: string;
  delivery: RegistrationDelivery;
  attribution: RegistrationAttribution | null;
}

/** Krok dostawy - awaria jednego nie zatrzymuje pozostałych ani nie wychodzi wyżej. */
async function step(name: string, registrationId: string, work: () => Promise<void>) {
  try {
    await work();
  } catch (err) {
    console.error(`[events] registration delivery ${name} failed`, registrationId, err);
  }
}

/**
 * Dostawa po zapisie. Nigdy nie rzuca. Kolejność: potwierdzenie (albo
 * wiadomość do właściciela zajętego adresu), bilet, atrybucja, double opt-in.
 */
export async function deliverRegistration(ctx: RegistrationDeliveryContext): Promise<void> {
  const { tenantId, delivery } = ctx;
  const id = delivery.registrationId;
  if (delivery.kind === "created") {
    const manageToken = delivery.manageToken;
    if (manageToken !== null) {
      await step("notice", id, async () => {
        const { sendRegistrationNoticeForManageToken } =
          await import("@/lib/events/registrationSelfNotify.server");
        const result = await sendRegistrationNoticeForManageToken(tenantId, manageToken);
        if (!result.ok) console.error("[events] registration notice not sent", id, result.error);
      });
    }
    if (delivery.status === "approved" && delivery.qrToken !== null) {
      await step("ticket", id, async () => {
        const { issueAndSendTicketCodes } = await import("@/lib/events/ticketCodeNotify.server");
        await issueAndSendTicketCodes(id);
      });
    }
    const attribution = ctx.attribution;
    if (manageToken !== null && attribution !== null) {
      await step("attribution", id, () => attachAttribution(manageToken, attribution));
    }
  } else {
    await step("duplicate", id, () => sendAlreadyRegisteredNotice(tenantId, delivery));
  }
  if (delivery.consentConfirmation !== null) {
    const confirmation = delivery.consentConfirmation;
    await step("consent", id, () => sendConsentConfirmation(tenantId, delivery, confirmation));
  }
}

/**
 * Atrybucja kampanii kluczem samoobsługi - ta sama funkcja bazy, którą do tej
 * pory wołała przeglądarka (bramka zgody została w przeglądarce, baza tnie to
 * samo po swojej stronie).
 */
async function attachAttribution(
  manageToken: string,
  attribution: RegistrationAttribution,
): Promise<void> {
  const client = await hostAnonClient();
  if (client === null) return;
  const { error } = await client.rpc("event_registration_attribution_attach", {
    p_payload: { manage_token: manageToken, ...attribution },
  });
  if (error) console.error("[events] registration attribution failed", error.message);
}

function eventTitle(event: RegistrationDeliveryEvent | null, lang: EmailLang): string {
  if (event === null) return "";
  return (
    (lang === "en" ? (event.titleEn ?? event.titlePl) : (event.titlePl ?? event.titleEn)) ?? ""
  );
}

/** Dzień UTC `RRRR-MM-DD` - okno idempotencji wiadomości o zajętym adresie. */
function dayKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Wiadomość do WŁAŚCICIELA adresu, który już ma zgłoszenie. Bez klucza
 * samoobsługi i bez statusu - przycisk prowadzi na stronę wydarzenia. Klucz
 * idempotencji: zgłoszenie i dzień, więc seria prób to najwyżej jeden mail
 * dziennie.
 */
async function sendAlreadyRegisteredNotice(
  tenantId: string,
  delivery: RegistrationDelivery,
): Promise<void> {
  const to = delivery.recipient?.email ?? null;
  if (to === null) return;
  const lang = delivery.recipient?.lang ?? "pl";
  const title = eventTitle(delivery.event, lang);
  const slug = delivery.event?.slug ?? null;
  const labels = txCopy("event_registration_already_registered", lang).labels;
  const details: TxDetail[] = title === "" ? [] : [{ label: labels.event, value: title }];

  const { sendTxEmail } = await import("@/lib/email/transactional.server");
  const result = await sendTxEmail({
    type: "event_registration_already_registered",
    to,
    lang,
    subjectName: title,
    details,
    ctaPath: slug === null ? "/events" : `/events/${encodeURIComponent(slug)}`,
    metaName: delivery.recipient?.firstName ?? null,
    tenantId,
    idempotencyKey: `event-registration-duplicate:${delivery.registrationId}:${dayKey(new Date())}`,
  });
  if (!result.ok && result.skipped !== "suppressed") {
    console.error(
      "[events] already-registered notice failed",
      delivery.registrationId,
      result.reason ?? result.error,
    );
  }
}

/** Skrót tokenu do klucza idempotencji - sam token nie trafia do dziennika poczty. */
function tokenDigest(token: string): string {
  return bytesToHex(sha256(utf8ToBytes(token))).slice(0, 32);
}

/**
 * Mail double opt-in: jeden wiersz na potwierdzany cel z DOKŁADNYM napisem
 * checkboxa, przycisk na stronę potwierdzenia z tokenem we FRAGMENCIE adresu
 * (nie trafia do logów serwera). Kubełek odbiorcy (3 / 60 min) chroni skrzynkę
 * przed zalewem cudzymi zapisami - ponad nim mail po prostu nie wychodzi.
 */
async function sendConsentConfirmation(
  tenantId: string,
  delivery: RegistrationDelivery,
  confirmation: RegistrationConsentConfirmation,
): Promise<void> {
  const to = delivery.recipient?.email ?? null;
  if (to === null) return;

  const { rateLimit } = await import("@/lib/server/rate-limit.server");
  const allowed = await rateLimit({
    scope: "event.consent.recipient",
    // Solony skrót najemcy i adresu - `rate_limits` nie trzyma e-maili.
    subjectId: hashedRateSubject("recipient", `${tenantId}|${to.toLowerCase()}`),
    max: CONSENT_CONFIRM_RECIPIENT_LIMIT.max,
    windowMinutes: CONSENT_CONFIRM_RECIPIENT_LIMIT.windowMinutes,
    // Awaria licznika nie znosi sufitu: mail z prośbą o zgodę można wysłać
    // później, zalewu skrzynki - nie da się cofnąć.
    failClosed: true,
  });
  if (!allowed) {
    console.warn("[events] consent confirmation over recipient limit", delivery.registrationId);
    return;
  }

  const lang = confirmation.lang;
  const title = eventTitle(delivery.event, lang);
  const labels = txCopy("event_consent_confirm", lang).labels;
  const details: TxDetail[] = [
    ...(title === "" ? [] : [{ label: labels.event, value: title }]),
    ...confirmation.purposes.map((purpose) => ({
      label: labels.consent,
      value: EVENT_CONSENT_PURPOSE_COPY[lang][purpose],
    })),
  ];

  const { sendTxEmail } = await import("@/lib/email/transactional.server");
  const result = await sendTxEmail({
    type: "event_consent_confirm",
    to,
    lang,
    subjectName: title,
    details,
    ctaPath: `/event-consent/confirm#token=${encodeURIComponent(confirmation.token)}`,
    metaName: delivery.recipient?.firstName ?? null,
    tenantId,
    idempotencyKey: `event-consent-confirm:${tokenDigest(confirmation.token)}`,
  });
  if (!result.ok && result.skipped !== "suppressed") {
    console.error(
      "[events] consent confirmation failed",
      delivery.registrationId,
      result.reason ?? result.error,
    );
  }
}
