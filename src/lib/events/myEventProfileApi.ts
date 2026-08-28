// PANEL UCZESTNIKA NA WYDARZENIU - własny profil i własna agenda.
//
// DLACZEGO RPC, A NIE TABELE. Profil uczestnika siedzi w `event_people`
// (dane osobowe), a stan zgłoszenia w `event_registrations` - obie tabele mają
// reguły dostępu zawężone do właściciela przez `person_id`, więc złożenie
// odpowiedzi w przeglądarce wymagałoby dwóch zapytań i znajomości `person_id`,
// którego uczestnik nie zna. `event_my_event_profile` składa komplet po stronie
// bazy dla `auth.uid()` i nie przyjmuje żadnej cudzej tożsamości.
//
// AGENDA TO ZAPISY, NIE PROGRAM. `event_my_agenda` oddaje wyłącznie sesje,
// na które wołający jest zapisany (`event_session_signups`) - to jest „mój
// harmonogram", a nie kopia programu wydarzenia.
import { supabase } from "@/integrations/supabase/client";

type Bag = Record<string, unknown>;

function bag(value: unknown): Bag | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Bag)
    : null;
}

function text(source: Bag, key: string): string | null {
  const value = source[key];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function bool(source: Bag, key: string): boolean {
  return source[key] === true;
}

export interface MyEventProfile {
  personId: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  jobTitle: string | null;
  companyText: string | null;
  socialProfileUrl: string | null;
  photoUrl: string | null;
  bioPl: string | null;
  bioEn: string | null;
}

export interface MyEventRegistrationState {
  registrationId: string;
  status: string;
  paymentStatus: string | null;
  directoryOptOut: boolean;
  notifyEmail: boolean;
  notifySms: boolean;
}

export interface MyEventPanelState {
  profile: MyEventProfile | null;
  registration: MyEventRegistrationState | null;
}

function parseProfile(raw: unknown): MyEventProfile | null {
  const row = bag(raw);
  const personId = row === null ? null : text(row, "person_id");
  if (row === null || personId === null) return null;
  return {
    personId,
    firstName: text(row, "first_name"),
    lastName: text(row, "last_name"),
    email: text(row, "email"),
    phone: text(row, "phone"),
    jobTitle: text(row, "job_title"),
    companyText: text(row, "company_text"),
    socialProfileUrl: text(row, "social_profile_url"),
    photoUrl: text(row, "photo_url"),
    bioPl: text(row, "bio_pl"),
    bioEn: text(row, "bio_en"),
  };
}

function parseRegistration(raw: unknown): MyEventRegistrationState | null {
  const row = bag(raw);
  const id = row === null ? null : text(row, "registration_id");
  if (row === null || id === null) return null;
  return {
    registrationId: id,
    status: text(row, "status") ?? "unknown",
    paymentStatus: text(row, "payment_status"),
    directoryOptOut: bool(row, "directory_opt_out"),
    notifyEmail: bool(row, "notify_email"),
    notifySms: bool(row, "notify_sms"),
  };
}

function parsePanel(raw: unknown): MyEventPanelState {
  const row = bag(raw);
  if (row === null) return { profile: null, registration: null };
  return {
    profile: parseProfile(row["profile"]),
    registration: parseRegistration(row["registration"]),
  };
}

export async function fetchMyEventProfile(slug: string): Promise<MyEventPanelState> {
  const { data, error } = await supabase.rpc("event_my_event_profile", { p_payload: { slug } });
  if (error) throw error;
  return parsePanel(data);
}

/** Pola opcjonalne: brak klucza = „nie ruszaj", pusty napis = „wyczyść". */
export interface MyEventProfileInput {
  slug: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  job_title?: string;
  company_text?: string;
  social_profile_url?: string;
  photo_url?: string;
  bio_pl?: string;
  bio_en?: string;
}

export async function saveMyEventProfile(input: MyEventProfileInput): Promise<MyEventPanelState> {
  // RPC przyjmuje JSON - przepisujemy wejście na płaski słownik napisów, żeby
  // typ ładunku był dokładnie tym, co baza dostaje (bez opcjonalnych `undefined`).
  const payload: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string") payload[key] = value;
  }
  const { data, error } = await supabase.rpc("event_my_event_profile_set", { p_payload: payload });
  if (error) throw error;
  return parsePanel(data);
}

export interface MyAgendaSession {
  sessionId: string;
  titlePl: string | null;
  titleEn: string | null;
  startsAt: string | null;
  endsAt: string | null;
  format: string | null;
  streamUrl: string | null;
  roomNamePl: string | null;
  roomNameEn: string | null;
  trackNamePl: string | null;
  trackNameEn: string | null;
  signupStatus: string | null;
}

export async function fetchMyAgenda(slug: string): Promise<MyAgendaSession[]> {
  const { data, error } = await supabase.rpc("event_my_agenda", { p_payload: { slug } });
  if (error) throw error;
  const row = bag(data);
  const list = row === null ? null : row["sessions"];
  if (!Array.isArray(list)) return [];
  const out: MyAgendaSession[] = [];
  for (const raw of list) {
    const entry = bag(raw);
    const id = entry === null ? null : text(entry, "session_id");
    if (entry === null || id === null) continue;
    out.push({
      sessionId: id,
      titlePl: text(entry, "title_pl"),
      titleEn: text(entry, "title_en"),
      startsAt: text(entry, "starts_at"),
      endsAt: text(entry, "ends_at"),
      format: text(entry, "format"),
      streamUrl: text(entry, "stream_url"),
      roomNamePl: text(entry, "room_name_pl"),
      roomNameEn: text(entry, "room_name_en"),
      trackNamePl: text(entry, "track_name_pl"),
      trackNameEn: text(entry, "track_name_en"),
      signupStatus: text(entry, "signup_status"),
    });
  }
  return out;
}
