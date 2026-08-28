// Wyszukiwarka uczestnikow do dialogu "Umow spotkanie" w panelu organizatora.
//
// GIELDA OPEROWANIA IDZIE PO `registration_id`, NIE PO `person_id`. Ta sama
// osoba moze byc zapisana na kilka wydarzen; spotkanie wiaze zgloszenie, wiec
// dialog musi podawac do RPC identyfikator zgloszenia, a nie osoby.
//
// FILTRUJEMY DO ZGLOSZEN POTWIERDZONYCH. Baza i tak odrzuci osobe anulowana
// albo z listy rezerwowej, ale odmowa po kliknieciu "Umow" jest gorsza niz
// nieobecnosc na liscie - organizator nie zrozumie, dlaczego widzi kogos,
// z kim nie da sie nic zrobic.
//
// DWA STATUSY, NIE JEDEN - I TO NIE JEST DROBIAZG. `admin_event_meeting_arrange`
// dopuszcza `r.status IN ('approved', 'attended')`, a odprawa na miejscu
// PRZESTAWIA `approved` -> `attended` (migracja `20260823180000`, jedyna sciezka
// nadajaca ten status). Filtr na samym `approved` pokazywalby wiec pusta liste
// dokladnie w tym momencie, w ktorym gielda spotkan jest potrzebna: w trakcie
// wydarzenia, gdy wszyscy obecni sa juz odprawieni.
//
// DLACZEGO FILTR JEST PO STRONIE KLIENTA. `admin_event_registrations_list`
// przyjmuje JEDEN status (`p_status = 'all' | <status>`), a my potrzebujemy
// dwoch. Zamiast dwoch zapytan i sklejania stron bierzemy `all` i odsiewamy
// u siebie, pobierajac z zapasem (`OVERFETCH`), zeby po odsianiu zostalo tyle
// pozycji, ile dialog obiecuje pokazac.
//
// LISTA STATUSOW JEST ZWIAZANA Z BAZA BRAMKA, NIE KOMENTARZEM. Poprzednia wersja
// miala tu `"confirmed"` - wartosc, ktorej CHECK na `event_registrations.status`
// NIE ZNA, wiec wyszukiwarka nie zwracala NIGDY ani jednego wiersza, a kompilator
// nie mial jak tego zobaczyc (kolumna jest typu `text`). Zeby ta klasa bledu nie
// wrocila, `__tests__/meetingParticipants.test.ts` czyta migracje i porownuje
// `ARRANGEABLE_STATUSES` z lista z `admin_event_meeting_arrange`.
import { supabase } from "@/integrations/supabase/client";

/** Wiersz listy wyboru - tylko to, co dialog naprawde pokazuje. */
export interface MeetingParticipantOption {
  registrationId: string;
  firstName: string;
  lastName: string;
  company: string;
  jobTitle: string;
  groupId: string | null;
  /** Gotowa etykieta, zeby kazdy ekran skladal nazwe tak samo. */
  label: string;
}

/**
 * Statusy zgloszen, ktore gielda w ogole dopuszcza do umawiania.
 *
 * Odwzorowanie `r.status IN (...)` z `admin_event_meeting_arrange` jeden do
 * jednego - pilnuje tego bramka w tescie tego modulu.
 */
export const ARRANGEABLE_STATUSES = ["approved", "attended"] as const;

/**
 * Ile wierszy brac z bazy na jedna pozycje, ktora dialog ma pokazac.
 *
 * Zapytanie idzie bez filtra statusu, wiec w odpowiedzi sa takze zgloszenia
 * odrzucone, anulowane i z listy rezerwowej. Mnoznik jest kompromisem: przy
 * wydarzeniu, w ktorym wiekszosc zgloszen czeka na decyzje, czterokrotny zapas
 * wystarcza, zeby lista nie byla pusta, a przy typowym - nie sciaga sie
 * niepotrzebnie tysiaca wierszy.
 */
const OVERFETCH = 4;

/** Gorna granica pobrania - zeby mnoznik nie zamienil sie w skan tabeli. */
const MAX_FETCH = 200;

/** Czy zgloszenie o tym statusie da sie umowic. */
export function isArrangeableStatus(status: unknown): boolean {
  return typeof status === "string" && (ARRANGEABLE_STATUSES as readonly string[]).includes(status);
}

function text(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

/** `Imie Nazwisko - Firma - Stanowisko`, z pominieciem pustych czesci. */
export function participantLabel(row: {
  first_name?: string | null;
  last_name?: string | null;
  company_name?: string | null;
  company_text?: string | null;
  job_title?: string | null;
}): string {
  const name = [text(row.first_name), text(row.last_name)].filter((part) => part.length > 0);
  const company = text(row.company_name) || text(row.company_text);
  const parts = [name.join(" "), company, text(row.job_title)].filter((part) => part.length > 0);
  return parts.join(" - ");
}

export function toParticipantOption(row: {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  company_name?: string | null;
  company_text?: string | null;
  job_title?: string | null;
  group_id?: string | null;
}): MeetingParticipantOption {
  return {
    registrationId: row.id,
    firstName: text(row.first_name),
    lastName: text(row.last_name),
    company: text(row.company_name) || text(row.company_text),
    jobTitle: text(row.job_title),
    groupId: typeof row.group_id === "string" && row.group_id.length > 0 ? row.group_id : null,
    label: participantLabel(row),
  };
}

export async function searchMeetingParticipants(input: {
  eventId: string;
  query?: string;
  limit?: number;
}): Promise<MeetingParticipantOption[]> {
  const limit = input.limit ?? 20;
  const { data, error } = await supabase.rpc("admin_event_registrations_list", {
    p_event_id: input.eventId,
    p_q: input.query !== undefined && input.query.length > 0 ? input.query : undefined,
    // Bez filtra statusu - potrzebujemy DWOCH, a RPC przyjmuje jeden.
    p_status: undefined,
    p_limit: Math.min(limit * OVERFETCH, MAX_FETCH),
    p_offset: 0,
  });
  if (error) throw error;
  return (data ?? [])
    .filter((row) => isArrangeableStatus((row as { status?: unknown }).status))
    .slice(0, limit)
    .map(toParticipantOption);
}
