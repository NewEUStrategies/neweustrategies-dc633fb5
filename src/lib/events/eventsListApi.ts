// Dostep do listy wydarzen modulu (RPC).
//
// LISTA JEST RPC-ONLY, choc `events` ma polityke odczytu dla staffa. Powod jest
// konkretny: kolumny `join_url` i `recording_url` zostaly odciete od klienckiego
// SELECT-a GRANT-em kolumnowym (migracja 20260702200000), a lista musi wiedziec,
// CZY transmisja i nagranie istnieja. Zapytanie tabelaryczne dostaloby albo
// odmowe, albo - po dopisaniu kolumn do GRANT-u - odslonilo adresy w kazdej
// odpowiedzi. RPC oddaje dwie FLAGI i nic wiecej.
//
// Drugi powod: licznik calosci do paginacji i liczniki zapisow per wiersz.
// Zapytanie tabelaryczne policzyloby je trzema dodatkowymi round-tripami.
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import type { EventListParams } from "@/lib/events/eventListParams";
import { eventCountsQueryArgs, eventListQueryArgs } from "@/lib/events/eventListParams";

type Fns = Database["public"]["Functions"];

/** Wiersz listy - kształt WPROST z sygnatury RPC, nie przepisany recznie. */
export type AdminEventListRow = Fns["admin_events_list"]["Returns"][number];

/** Liczniki zakladek. RPC oddaje `jsonb`, wiec kształt domyka sie tutaj. */
export interface AdminEventCounts {
  all: number;
  draft: number;
  published: number;
  cancelled: number;
  upcoming: number;
  past: number;
}

const EMPTY_COUNTS: AdminEventCounts = {
  all: 0,
  draft: 0,
  published: 0,
  cancelled: 0,
  upcoming: 0,
  past: 0,
};

export async function fetchAdminEvents(
  params: EventListParams,
  now: Date,
): Promise<AdminEventListRow[]> {
  const { data, error } = await supabase.rpc("admin_events_list", eventListQueryArgs(params, now));
  if (error) throw error;
  return data ?? [];
}

/**
 * Liczniki zakladek. Nieznane pole w odpowiedzi degraduje do zera, a nie
 * wywraca nagłowka listy: `jsonb` z bazy jest z definicji nietypowany, a
 * zakladka bez liczby jest lepsza niz lista, ktora sie nie renderuje.
 */
export async function fetchAdminEventCounts(params: EventListParams): Promise<AdminEventCounts> {
  const { data, error } = await supabase.rpc("admin_events_counts", eventCountsQueryArgs(params));
  if (error) throw error;
  if (data === null || typeof data !== "object" || Array.isArray(data)) return EMPTY_COUNTS;
  const raw = data as Record<string, unknown>;
  const num = (key: keyof AdminEventCounts): number => {
    const value = raw[key];
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
  };
  return {
    all: num("all"),
    draft: num("draft"),
    published: num("published"),
    cancelled: num("cancelled"),
    upcoming: num("upcoming"),
    past: num("past"),
  };
}

/**
 * Wejscie tworzenia wydarzenia. Cztery pola, bo wszystko inne przepisuje RODZAJ
 * po stronie serwera - i to jest cala idea tego ekranu: redaktor podaje tytul,
 * termin i rodzaj, a nie jedenascie ustawien, ktorych jeszcze nie zna.
 */
export interface EventCreateInput {
  eventTypeId: string;
  titlePl: string;
  titleEn: string;
  startsAt: string;
  /** Koniec podany wprost; `null` znaczy „wylicz z czasu trwania rodzaju". */
  endsAt: string | null;
  /** Nazwa IANA strefy wydarzenia; `null` zostawia domyslna organizacji. */
  timezone: string | null;
  /** Format wydarzenia; `null` przepisuje format rodzaju. */
  format: string | null;
  /** Miasto i kraj - baza zeruje je dla wydarzen wylacznie online. */
  city: string | null;
  country: string | null;
  /**
   * Adres zapisow w obcym systemie. Wymagany DOKLADNIE dla rodzajow o trybie
   * `external` - baza odrzuca tworzenie bez niego (`external_url_required`),
   * bo warunek `events_external_mode_requires_url` nie dopuszcza takiego wiersza.
   * Dla pozostalych rodzajow `null`, i serwer i tak go wtedy zeruje.
   */
  externalRegistrationUrl: string | null;
}

export async function createEventFromType(input: EventCreateInput): Promise<string> {
  const { data, error } = await supabase.rpc("admin_event_create", {
    p_payload: {
      event_type_id: input.eventTypeId,
      title_pl: input.titlePl,
      title_en: input.titleEn,
      starts_at: input.startsAt,
      // Klucz pomijany, a nie ustawiany na `null`: payload jest kontraktem
      // czytanym operatorem `->>`, wiec brak klucza i klucz o wartosci null sa
      // dla bazy tym samym, a pominiecie nie klamie, ze cokolwiek podano.
      ...(input.externalRegistrationUrl === null
        ? {}
        : { external_registration_url: input.externalRegistrationUrl }),
      ...(input.endsAt === null ? {} : { ends_at: input.endsAt }),
      ...(input.timezone === null ? {} : { timezone: input.timezone }),
      ...(input.format === null ? {} : { format: input.format }),
      ...(input.city === null ? {} : { city: input.city }),
      ...(input.country === null ? {} : { country: input.country }),
    },
  });
  if (error) throw error;
  return String(data);
}
