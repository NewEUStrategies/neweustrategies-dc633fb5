// Dziennik doręczeń uczestnika po stronie serwera: rezerwacja przed wysyłką,
// potwierdzenie po niej (`_event_delivery_claim` / `_event_delivery_confirm`).
//
// REZERWACJA JEST BRAMKĄ DUPLIKATÓW. Trzy harmonogramy (jobs-tick, cron
// społeczności, ręczne `workflow_dispatch`) potrafią ruszyć to samo zadanie
// naraz. UNIKALNY `(tenant_id, dedupe_key)` sprawia, że wiadomość dostaje
// dokładnie jeden z nich: drugi dostaje `null` i nie wysyła nic. Wpis
// porzucony (`claimed` > 15 min) albo `failed` (< 3 próby) wolno przejąć
// ponownie - poza kanałem `inapp`, który jest „raz i koniec".
//
// NIGDY NIE RZUCA. Awaria dziennika nie może wywrócić całej porcji zadania:
// `null` z rezerwacji znaczy „nie wysyłaj", `false` z potwierdzenia - „wpis
// zostanie przejęty ponownie po 15 minutach". W logu tylko rodzaj, kanał
// i komunikat błędu - bez klucza deduplikacji i bez danych odbiorcy.
import type { Json } from "@/integrations/supabase/types";
import type { DeliveryChannel, DeliveryKind } from "@/lib/events/participantDeliveryKinds";

export interface DeliveryClaimInput {
  tenantId: string;
  eventId: string;
  kind: DeliveryKind;
  channel: DeliveryChannel;
  dedupeKey: string;
  registrationId?: string | null;
  personId?: string | null;
  userId?: string | null;
  sessionId?: string | null;
  leadMinutes?: number | null;
  startsAt?: string | null;
}

export type DeliveryOutcome = "sent" | "skipped" | "failed";

/** CHECK `event_message_deliveries_detail_len`: szczegół najwyżej 500 znaków. */
const DETAIL_MAX = 500;

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Identyfikator zarezerwowanego wpisu albo `null` (duplikat, błąd, zły ładunek). */
export async function claimDelivery(input: DeliveryClaimInput): Promise<string | null> {
  const payload: { [key: string]: Json } = {
    tenant_id: input.tenantId,
    event_id: input.eventId,
    kind: input.kind,
    channel: input.channel,
    dedupe_key: input.dedupeKey,
  };
  const optional: ReadonlyArray<readonly [string, string | number | null | undefined]> = [
    ["registration_id", input.registrationId],
    ["person_id", input.personId],
    ["user_id", input.userId],
    ["session_id", input.sessionId],
    ["lead_minutes", input.leadMinutes],
    ["starts_at", input.startsAt],
  ];
  for (const [key, value] of optional) {
    if (value !== null && value !== undefined) payload[key] = value;
  }
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.rpc("_event_delivery_claim", {
      p_payload: payload,
    });
    if (error) {
      console.warn("[participantDelivery] claim failed", {
        kind: input.kind,
        channel: input.channel,
        error: error.message,
      });
      return null;
    }
    return typeof data === "string" && data !== "" ? data : null;
  } catch (err) {
    console.warn("[participantDelivery] claim threw", {
      kind: input.kind,
      channel: input.channel,
      error: messageOf(err),
    });
    return null;
  }
}

/** Wynik wysyłki; `true`, gdy wpis był w stanie `claimed` i został zamknięty. */
export async function confirmDelivery(
  id: string,
  status: DeliveryOutcome,
  detail?: string | null,
): Promise<boolean> {
  const args: { p_id: string; p_status: string; p_detail?: string } = {
    p_id: id,
    p_status: status,
  };
  if (typeof detail === "string" && detail !== "") args.p_detail = detail.slice(0, DETAIL_MAX);
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.rpc("_event_delivery_confirm", args);
    if (error) {
      console.warn("[participantDelivery] confirm failed", { status, error: error.message });
      return false;
    }
    return data === true;
  } catch (err) {
    console.warn("[participantDelivery] confirm threw", { status, error: messageOf(err) });
    return false;
  }
}
