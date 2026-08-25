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

/** Statusy zgloszen, ktore giełda w ogóle dopuszcza do umawiania. */
const ARRANGEABLE_STATUS = "confirmed";

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
  const { data, error } = await supabase.rpc("admin_event_registrations_list", {
    p_event_id: input.eventId,
    p_q: input.query !== undefined && input.query.length > 0 ? input.query : undefined,
    p_status: ARRANGEABLE_STATUS,
    p_limit: input.limit ?? 20,
    p_offset: 0,
  });
  if (error) throw error;
  return (data ?? []).map(toParticipantOption);
}
