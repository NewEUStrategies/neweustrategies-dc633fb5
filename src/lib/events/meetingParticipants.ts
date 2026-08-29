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
// FILTR IDZIE DO BAZY, JEDNO ZAPYTANIE NA STATUS - I TO JEST NAPRAWA, NIE STYL.
// `admin_event_registrations_list` przyjmuje JEDEN status, a my potrzebujemy
// dwoch, wiec pierwsza wersja brala liste BEZ filtra i odsiewala u siebie,
// pobierajac z zapasem. To bylo bledne, bo ta RPC sortuje LISTE REZERWOWA NA
// POCZATEK (`ORDER BY CASE WHEN r.status = 'waitlist' THEN 0 ELSE 1 END`).
// Osiemdziesiat zgloszen z rezerwy wypelnialo caly zapas, odsiew zostawial
// zero pozycji i wyszukiwarka pokazywala PUSTO, choc uczestnicy do umowienia
// byli - tylko dalej na liscie. Zapas nie da sie tego naprawic: przy dosc
// dlugiej rezerwie kazdy mnoznik jest za maly, a `p_limit` i tak stoi na 200.
// Dwa zapytania z `p_status` odsiewaja po stronie bazy, wiec ani jeden wiersz
// rezerwy nie wchodzi do wyniku.
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
 * Gorna granica pobrania na JEDEN status - tyle, ile RPC i tak przycina
 * (`LEAST(GREATEST(p_limit, 1), 200)`). Prosimy o `limit`, bo filtr dziala juz
 * w bazie i nic sie po drodze nie odsiewa.
 */
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

/**
 * Porzadek scalonych stron: najnowsze zgloszenia na gorze.
 *
 * Kazde z zapytan wraca posortowane przez baze, ale SCALENIE dwoch takich list
 * porzadku nie dziedziczy - bez tego kolejnosc zalezalaby od tego, ktora
 * odpowiedz przyszla pierwsza. `created_at DESC, id DESC` odwzorowuje ogon
 * `ORDER BY` tej RPC dla wierszy spoza rezerwy (rezerwy tu nie ma), wiec lista
 * wyglada tak samo jak przed rozbiciem na dwa zapytania.
 */
function byNewestFirst(
  a: { created_at?: string | null; id: string },
  b: { created_at?: string | null; id: string },
): number {
  const left = typeof a.created_at === "string" ? a.created_at : "";
  const right = typeof b.created_at === "string" ? b.created_at : "";
  if (left !== right) return left < right ? 1 : -1;
  return a.id < b.id ? 1 : -1;
}

export async function searchMeetingParticipants(input: {
  eventId: string;
  query?: string;
  limit?: number;
}): Promise<MeetingParticipantOption[]> {
  const limit = input.limit ?? 20;
  const query = input.query !== undefined && input.query.length > 0 ? input.query : undefined;

  const pages = await Promise.all(
    ARRANGEABLE_STATUSES.map(async (status) => {
      const { data, error } = await supabase.rpc("admin_event_registrations_list", {
        p_event_id: input.eventId,
        p_q: query,
        p_status: status,
        p_limit: Math.min(limit, MAX_FETCH),
        p_offset: 0,
      });
      if (error) throw error;
      return data ?? [];
    }),
  );

  // Zabezpieczenie na wypadek, gdyby ten sam wiersz wrocil z dwoch stron.
  // Dzis nie moze - zgloszenie ma jeden status - ale scalanie stron BEZ
  // odsiewu duplikatow to blad, ktory ujawnia sie dopiero po zmianie po
  // drugiej stronie i wyglada wtedy jak podwojony uczestnik na liscie.
  const seen = new Set<string>();
  return pages
    .flat()
    .filter((row) => {
      const id = (row as { id?: unknown }).id;
      if (typeof id !== "string" || seen.has(id)) return false;
      seen.add(id);
      return isArrangeableStatus((row as { status?: unknown }).status);
    })
    .sort(byNewestFirst)
    .slice(0, limit)
    .map(toParticipantOption);
}
