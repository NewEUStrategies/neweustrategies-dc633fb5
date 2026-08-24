// Dostep do katalogu rodzajow wydarzen (RPC).
//
// Odczyt publiczny idzie przez `event_types_active` - anon tez go widzi, bo
// nazwa rodzaju jest trescia strony wydarzenia i filtrem na liscie. Zapis
// WYLACZNIE przez RPC z bramka `assert_admin_tenant()`, zeby panel nie polegal
// na samym RLS: SECURITY DEFINER daje jedno miejsce, w ktorym sprawdzamy role
// i tenanta, zamiast czterech polityk, ktore musza sie zgadzac miedzy soba.
//
// PAYLOAD JEST jsonb. `admin_event_type_upsert` przyjmuje jeden argument
// `p_payload`, bo katalog ma osiemnascie pol redakcyjnych - kazde nowe pole
// w sygnaturze pozycyjnej to NOWA funkcja w bazie (Postgres przeciaza po
// sygnaturze) i drugi grant do utrzymania.
import { supabase } from "@/integrations/supabase/client";
import type { EventTypeAdminRow, EventTypeOption } from "@/lib/events/eventTypes";

export async function fetchActiveEventTypes(): Promise<EventTypeOption[]> {
  const { data, error } = await supabase.rpc("event_types_active");
  if (error) throw error;
  return data ?? [];
}

export async function fetchAdminEventTypes(): Promise<EventTypeAdminRow[]> {
  const { data, error } = await supabase.rpc("admin_event_types_list");
  if (error) throw error;
  return data ?? [];
}

/**
 * Wejscie mutacji zapisu. `id === null` znaczy NOWY wpis; wartosc znaczy edycje,
 * w ktorej klucz jest zamrozony (zmieniony klucz osierocilby wydarzenia czytajace
 * legacy `events.kind`).
 *
 * Pola opcjonalne z `null` sa ROZROZNIALNE od pominietych: RPC czyta `p_payload ?
 * 'default_capacity'`, wiec jawny `null` czysci wartosc, a brak klucza ja
 * zachowuje. Dlatego typ ma `| null`, a nie tylko `?`.
 */
export interface EventTypeUpsertInput {
  id: string | null;
  key: string;
  namePl: string;
  nameEn: string;
  descriptionPl: string;
  descriptionEn: string;
  icon: string;
  accentColor: string | null;
  defaultFormat: string;
  defaultRegistrationMode: string;
  defaultRegistrationFlow: string;
  defaultGuestMode: string;
  defaultCapacity: number | null;
  defaultDurationMinutes: number | null;
  defaultMinTierRank: number;
  defaultChathamHouse: boolean;
  requiresTicket: boolean;
  sortOrder: number;
  isActive: boolean;
}

/**
 * Przepisanie wejscia na payload RPC. Klucze sa snake_case, bo to kontrakt bazy,
 * a nie kontrakt formularza - tlumaczenie zyje w JEDNYM miejscu, zeby nowe pole
 * nie wymagalo szukania po trzech plikach.
 *
 * `null` w liczbach jedzie jako `null`, nie jako pusty napis: `NULLIF(x, '')::integer`
 * w RPC obsluguje oba, ale pusty napis w jsonb jest nieodroznialny od "pole
 * pominiete" po stronie czytajacego payload czlowieka.
 */
function toPayload(input: EventTypeUpsertInput): Record<string, string | number | boolean | null> {
  return {
    id: input.id,
    key: input.key,
    name_pl: input.namePl,
    name_en: input.nameEn,
    description_pl: input.descriptionPl,
    description_en: input.descriptionEn,
    icon: input.icon,
    accent_color: input.accentColor,
    default_format: input.defaultFormat,
    default_registration_mode: input.defaultRegistrationMode,
    default_registration_flow: input.defaultRegistrationFlow,
    default_guest_mode: input.defaultGuestMode,
    default_capacity: input.defaultCapacity,
    default_duration_minutes: input.defaultDurationMinutes,
    default_min_tier_rank: input.defaultMinTierRank,
    default_chatham_house: input.defaultChathamHouse,
    requires_ticket: input.requiresTicket,
    sort_order: input.sortOrder,
    is_active: input.isActive,
  };
}

export async function upsertEventType(input: EventTypeUpsertInput): Promise<string> {
  const { data, error } = await supabase.rpc("admin_event_type_upsert", {
    p_payload: toPayload(input),
  });
  if (error) throw error;
  return String(data);
}

export async function setEventTypeActive(id: string, isActive: boolean): Promise<boolean> {
  const { error } = await supabase.rpc("admin_event_type_set_active", {
    _id: id,
    _is_active: isActive,
  });
  if (error) throw error;
  return true;
}

export async function deleteEventType(id: string): Promise<boolean> {
  const { error } = await supabase.rpc("admin_event_type_delete", { _id: id });
  if (error) throw error;
  return true;
}

/**
 * Przepiecie wydarzen z jednego rodzaju na inny. Zwraca liczbe przepietych
 * wierszy - i ta liczba jest TRESCIA potwierdzenia dla redaktora, a nie
 * dekoracja: bez niej "przepieto" po operacji na czterdziestu wydarzeniach jest
 * nieodroznialne od "przepieto" na zerze.
 */
export async function reassignEventType(fromId: string, toId: string): Promise<number> {
  const { data, error } = await supabase.rpc("admin_event_type_reassign", {
    _from_id: fromId,
    _to_id: toId,
  });
  if (error) throw error;
  return Number(data ?? 0);
}
