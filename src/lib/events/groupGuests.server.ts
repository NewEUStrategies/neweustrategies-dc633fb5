// Dopisanie gości do zgłoszenia prowadzącego - logika server-only dla
// `groupGuests.functions.ts` (przegląd R38, REG-04).
//
// SKĄD TOŻSAMOŚĆ. Nic z ciała żądania:
//   * najemca - zaufany host (`resolveTenantIdForHost(currentTenantHost())`);
//     host bez najemcy to awaria hosta, odpowiadamy `unknown` BEZ pytania bazy;
//   * konto - zweryfikowana sesja (`optionalUserIdFromRequest`); bez konta
//     gości nie ma komu dopisać (`account_required`, bez bazy i bez kubełka);
//   * adres - solony skrót (`requestRateSubject`, `ip:<32 hex>`), nigdy surowy.
// Baza (`event_register_group_guests_for_client`, tylko `service_role`) liczy
// kubełek adresu (`event_register.ip`, wspólny z zapisem) i konta, a odmowy
// oddaje WARTOŚCIĄ - żadna próba nie cofa licznika.
//
// DO PRZEGLĄDARKI WRACA WYŁĄCZNIE `client`: `{ok:true, added}` albo
// `{ok:false, error}` - nigdy adres gościa. Gość, który ma już zapis na
// wydarzenie, jest pomijany i liczony jako przyjęty; jego adres i zgłoszenie
// przychodzą w `delivery` (tylko dla serwera), a serwer wysyła mu tę samą
// wiadomość co zapis na zajęty adres (`event_registration_already_registered`,
// `deliverRegistration`). Wysyłka biegnie PO odpowiedzi (`runAfterResponse`):
// czas odpowiedzi nie zdradza, czy ktoś został pominięty, a awaria poczty nie
// zmienia odpowiedzi.
//
// OKNO WDROŻENIA („najpierw kod"). Dopóki nowej funkcji nie ma
// (PGRST202/42883), wołamy starą `event_register_group_guests` klientem z
// nagłówkiem hosta i tokenem wołającego (stara baza ma jeszcze GRANT
// authenticated). Jej odmowa może nieść adres gościa w ogonie - oddajemy sam
// kod. Każdy inny błąd bazy to `unknown` z logiem.
import { getRequest } from "@tanstack/react-start/server";

import type { Json } from "@/integrations/supabase/types";
import {
  optionalBearerFromRequest,
  optionalUserIdFromRequest,
} from "@/lib/auth/optionalUser.server";
import { currentTenantHost } from "@/lib/http/requestHost";
import { runAfterResponse } from "@/lib/http/waitUntil.server";
import { requestRateSubject } from "@/lib/server/rateSubject.server";
import { resolveTenantIdForHost } from "@/lib/server/tenant.server";
import { isMigrationPending } from "@/lib/supabase/migrationPending";
import {
  deliverRegistration,
  parseRegistrationDelivery,
  type RegistrationDelivery,
} from "@/lib/events/eventRegistration.server";
import { hostAnonClient } from "@/lib/events/registrationSelfNotify.server";

/**
 * Gość w kształcie ładunku bazy (`guestsToPayload`). Alias typu, nie interfejs:
 * tylko alias jest przypisywalny do `Json` bez rzutowania.
 */
export type GroupGuestPayload = {
  first_name: string;
  last_name: string;
  email: string;
};

/** Wejście funkcji serwerowej - po schemacie Zod. */
export type GroupGuestsRequest = {
  leadRegistrationId: string;
  guests: GroupGuestPayload[];
};

/** Odpowiedź dla przeglądarki - bez adresu gościa w żadnej gałęzi. */
export type GroupGuestsClient = { ok: true; added: number } | { ok: false; error: string };

const UNKNOWN: GroupGuestsClient = { ok: false, error: "unknown" };

/** Kod odmowy z głowy komunikatu albo pola `error` - wszystko inne to `unknown`. */
const CODE_RE = /^[a-z][a-z0-9_]*$/;

type JsonBag = { [key: string]: Json | undefined };

function bagOf(value: Json | undefined): JsonBag | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
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

function refusal(code: unknown): GroupGuestsClient {
  return { ok: false, error: typeof code === "string" && CODE_RE.test(code) ? code : "unknown" };
}

/**
 * `client` z bazy (nowej albo starej) -> odpowiedź dla przeglądarki. Odmowa to
 * SAM kod - ogon (`detail`, adres gościa ze starej bazy) nie wychodzi. Stara
 * baza sprzed 20261012150100 oddawała sukces bez `ok`.
 */
function clientOf(value: Json | undefined): GroupGuestsClient {
  const bag = bagOf(value);
  if (bag === null) return UNKNOWN;
  if (bag.ok === false) return refusal(bag.error);
  const added = bag.added;
  if (typeof added === "number" && Number.isInteger(added) && added >= 0) {
    return { ok: true, added };
  }
  return UNKNOWN;
}

/** Wiadomości do pominiętych gości - wyłącznie rodzaj „już zapisany". */
function noticesOf(value: Json | undefined): RegistrationDelivery[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => parseRegistrationDelivery(entry))
    .filter(
      (delivery): delivery is RegistrationDelivery => delivery?.kind === "already_registered",
    );
}

/** Stara funkcja (okno wdrożenia) - token wołającego, najemca z nagłówka hosta. */
async function legacyRegisterGuests(input: GroupGuestsRequest): Promise<GroupGuestsClient> {
  const legacy = await hostAnonClient(await optionalBearerFromRequest());
  if (legacy === null) return UNKNOWN;
  const { data, error } = await legacy.rpc("event_register_group_guests", {
    p_lead_registration_id: input.leadRegistrationId,
    p_guests: input.guests,
  });
  if (error) {
    const separator = error.message.indexOf(":");
    return refusal((separator === -1 ? error.message : error.message.slice(0, separator)).trim());
  }
  return clientOf(data);
}

/** Wiadomości do pominiętych - każda osobno, żadna awaria nie wychodzi wyżej. */
async function sendNotices(tenantId: string, notices: RegistrationDelivery[]): Promise<void> {
  for (const delivery of notices) {
    await deliverRegistration({ tenantId, delivery, attribution: null });
  }
}

/**
 * Dopisanie gości z tożsamością z serwera. Zwraca WYŁĄCZNIE odpowiedź dla
 * przeglądarki; wiadomości do pominiętych gości biegną po odpowiedzi.
 */
export async function registerEventGroupGuestsForRequest(
  input: GroupGuestsRequest,
): Promise<GroupGuestsClient> {
  const tenantId = await requestTenantId();
  if (!tenantId) {
    console.error("[events] group guests: tenant unresolved for host");
    return UNKNOWN;
  }
  const userId = await optionalUserIdFromRequest();
  if (userId === null) return { ok: false, error: "account_required" };

  // Podmiot ADRESU (bez konta): kubełek konta liczy baza osobno, po `_user_id`.
  const ipSubject = requestRateSubject(requestHeaders());
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("event_register_group_guests_for_client", {
    _tenant_id: tenantId,
    _user_id: userId,
    _ip_subject: ipSubject,
    p_lead_registration_id: input.leadRegistrationId,
    p_guests: input.guests,
  });

  if (error) {
    if (!isMigrationPending(error)) {
      console.error("[events] group guests rpc failed", error.code ?? "", error.message);
      return UNKNOWN;
    }
    return legacyRegisterGuests(input);
  }

  const bag = bagOf(data);
  const client = clientOf(bag?.client);
  if (!client.ok && client.error === "unknown") {
    console.error("[events] group guests refused as unknown", tenantId);
  }
  const notices = noticesOf(bag?.delivery);
  if (notices.length > 0) runAfterResponse(sendNotices(tenantId, notices));
  return client;
}
