// Dostep do JEDNEGO wydarzenia w studiu (RPC).
//
// RPC, A NIE SELECT NA TABELI - z tego samego powodu, co lista modulu:
// `join_url` i `recording_url` sa odciete od klienckiego SELECT-a grantem
// kolumnowym, a studio musi wiedziec, CZY transmisja i nagranie istnieja.
// RPC oddaje dwie flagi i nic wiecej.
import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";

type Fns = Database["public"]["Functions"];

/**
 * Payload RPC jako `Json`. Ten sam wzorzec, co w `termsGroupsApi`: generator
 * typuje argument `jsonb` jako `Json`, a slownik pol formularza jest zwyklym
 * obiektem napisow - konwersja stoi w JEDNYM miejscu, nie przy kazdym wywolaniu.
 */
function asJson(payload: Record<string, string | string[]>): Json {
  return payload as Json;
}

/** Wiersz studia - kształt WPROST z sygnatury RPC, nie przepisany recznie. */
export type AdminEventDetailRow = Fns["admin_event_detail"]["Returns"][number];

export async function fetchAdminEventDetail(eventId: string): Promise<AdminEventDetailRow | null> {
  const { data, error } = await supabase.rpc("admin_event_detail", { p_event_id: eventId });
  if (error) throw error;
  const rows = data ?? [];
  return rows.length === 0 ? null : rows[0];
}

export async function saveEventGeneral(
  payload: Record<string, string | string[]>,
): Promise<string> {
  const { data, error } = await supabase.rpc("admin_event_general_save", {
    p_payload: asJson(payload),
  });
  if (error) throw error;
  return String(data);
}

export async function saveEventBranding(
  eventId: string,
  branding: Record<string, string>,
): Promise<void> {
  const { error } = await supabase.rpc("admin_event_branding_save", {
    p_event_id: eventId,
    p_branding: asJson(branding),
  });
  if (error) throw error;
}

export type EventStatus = "draft" | "published" | "cancelled";

export async function setEventStatus(eventId: string, status: EventStatus): Promise<EventStatus> {
  const { data, error } = await supabase.rpc("admin_event_set_status", {
    p_event_id: eventId,
    p_status: status,
  });
  if (error) throw error;
  return String(data) as EventStatus;
}
