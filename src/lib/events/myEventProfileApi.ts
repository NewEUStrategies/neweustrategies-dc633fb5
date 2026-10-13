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
import type { AttendeeGroupTag } from "@/lib/events/publicEventApi";
import { isMigrationPending } from "@/lib/supabase/migrationPending";

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

export const SOCIAL_KEYS = [
  "linkedin",
  "x",
  "facebook",
  "instagram",
  "youtube",
  "website",
] as const;

export type SocialKey = (typeof SOCIAL_KEYS)[number];

export type SocialLinks = Partial<Record<SocialKey, string>>;

export interface MyEventProfile {
  personId: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  /** Zgoda właściciela: e-mail widoczny dla innych uczestników. */
  emailVisible: boolean;
  /** Zgoda właściciela: telefon widoczny dla innych uczestników. */
  phoneVisible: boolean;
  jobTitle: string | null;
  companyId: string | null;
  companyText: string | null;
  industry: string | null;
  specialization: string | null;
  seekingPl: string | null;
  seekingEn: string | null;
  offeringPl: string | null;
  offeringEn: string | null;
  socialProfileUrl: string | null;
  socialLinks: SocialLinks;
  photoUrl: string | null;
  bioPl: string | null;
  bioEn: string | null;
}

/** Migawka danych konta platformy - źródło dla „Uzupełnij z konta". */
export interface MyAccountSnapshot {
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  jobTitle: string | null;
  companyId: string | null;
  companyText: string | null;
  specialization: string | null;
  seekingPl: string | null;
  seekingEn: string | null;
  offeringPl: string | null;
  offeringEn: string | null;
  photoUrl: string | null;
  bioPl: string | null;
  bioEn: string | null;
  socialLinks: SocialLinks;
}

function parseSocialLinks(raw: unknown): SocialLinks {
  const row = bag(raw);
  if (row === null) return {};
  const out: SocialLinks = {};
  for (const key of SOCIAL_KEYS) {
    const value = text(row, key);
    if (value !== null) out[key] = value;
  }
  return out;
}

export interface MyEventRegistrationState {
  registrationId: string;
  status: string;
  paymentStatus: string | null;
  directoryOptOut: boolean;
  notifyEmail: boolean;
  notifySms: boolean;
  /**
   * GRUPY UCZESTNIKA (przepustka). Te same wiersze `event_groups`, które
   * katalog przypina do cudzych kart - właściciel widzi więc dokładnie te
   * etykiety, które widzą inni.
   */
  groups: AttendeeGroupTag[];
}

export interface MyEventPanelState {
  profile: MyEventProfile | null;
  account: MyAccountSnapshot | null;
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
    emailVisible: bool(row, "email_visible"),
    phoneVisible: bool(row, "phone_visible"),
    jobTitle: text(row, "job_title"),
    companyId: text(row, "company_id"),
    companyText: text(row, "company_text"),
    industry: text(row, "industry"),
    specialization: text(row, "specialization"),
    seekingPl: text(row, "seeking_pl"),
    seekingEn: text(row, "seeking_en"),
    offeringPl: text(row, "offering_pl"),
    offeringEn: text(row, "offering_en"),
    socialProfileUrl: text(row, "social_profile_url"),
    socialLinks: parseSocialLinks(row["social_links"]),
    photoUrl: text(row, "photo_url"),
    bioPl: text(row, "bio_pl"),
    bioEn: text(row, "bio_en"),
  };
}

function parseGroupTags(raw: unknown): AttendeeGroupTag[] {
  if (!Array.isArray(raw)) return [];
  const out: AttendeeGroupTag[] = [];
  for (const item of raw) {
    const row = bag(item);
    const id = row === null ? null : text(row, "id");
    if (row === null || id === null) continue;
    out.push({
      id,
      namePl: text(row, "name_pl") ?? "",
      nameEn: text(row, "name_en") ?? "",
      color: text(row, "color"),
    });
  }
  return out;
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
    groups: parseGroupTags(row["groups"]),
  };
}

function parseAccount(raw: unknown): MyAccountSnapshot | null {
  const row = bag(raw);
  if (row === null) return null;
  return {
    firstName: text(row, "first_name"),
    lastName: text(row, "last_name"),
    email: text(row, "email"),
    phone: text(row, "phone"),
    jobTitle: text(row, "job_title"),
    companyId: text(row, "company_id"),
    companyText: text(row, "company_text"),
    specialization: text(row, "specialization"),
    seekingPl: text(row, "seeking_pl"),
    seekingEn: text(row, "seeking_en"),
    offeringPl: text(row, "offering_pl"),
    offeringEn: text(row, "offering_en"),
    photoUrl: text(row, "photo_url"),
    bioPl: text(row, "bio_pl"),
    bioEn: text(row, "bio_en"),
    socialLinks: parseSocialLinks(row["social_links"]),
  };
}

function parsePanel(raw: unknown): MyEventPanelState {
  const row = bag(raw);
  if (row === null) return { profile: null, account: null, registration: null };
  return {
    profile: parseProfile(row["profile"]),
    account: parseAccount(row["account"]),
    registration: parseRegistration(row["registration"]),
  };
}

export async function fetchMyEventProfile(slug: string): Promise<MyEventPanelState> {
  const { data, error } = await supabase.rpc("event_my_event_profile", { p_payload: { slug } });
  if (error) throw error;
  return parsePanel(data);
}

/**
 * Pola opcjonalne: brak klucza = „nie ruszaj", pusty napis = „wyczyść".
 * `email` wysyłamy WYŁĄCZNIE przy zmianie - i wyłącznie na potwierdzony adres
 * konta (inaczej `email_unverified`, REG-01).
 */
export interface MyEventProfileInput {
  slug: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  email_visible?: boolean;
  phone_visible?: boolean;
  job_title?: string;
  company_id?: string;
  company_text?: string;
  industry?: string;
  specialization?: string;
  seeking_pl?: string;
  seeking_en?: string;
  offering_pl?: string;
  offering_en?: string;
  social_profile_url?: string;
  social_links?: SocialLinks;
  photo_url?: string;
  bio_pl?: string;
  bio_en?: string;
  /**
   * ZAPIS WSTECZ DO KONTA PLATFORMY. `true` = ten sam zapis aktualizuje wiersz
   * `profiles` wołającego (stanowisko, organizacja, specjalizacja, „czego szukam
   * / co oferuję", opis, telefon, zdjęcie, linki). Adres logowania zostaje
   * nietknięty - należy do warstwy uwierzytelnienia, nie do wizytówki.
   */
  push_account?: boolean;
}

export async function saveMyEventProfile(input: MyEventProfileInput): Promise<MyEventPanelState> {
  // RPC przyjmuje JSON - przepisujemy wejście na płaski słownik napisów, żeby
  // typ ładunku był dokładnie tym, co baza dostaje (bez opcjonalnych `undefined`).
  const payload: Record<string, string | boolean | SocialLinks> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string" || typeof value === "boolean") payload[key] = value;
    else if (key === "social_links" && value !== undefined) payload[key] = value as SocialLinks;
  }
  const { data, error } = await supabase.rpc("event_my_event_profile_set", { p_payload: payload });
  if (error) throw error;
  return parsePanel(data);
}

/**
 * ODMOWY ZMIANY ADRESU KARTOTEKI (REG-01, migracja 20261012120000). Adres
 * profilu wydarzenia może być wyłącznie POTWIERDZONYM adresem konta - baza
 * odmawia `email_unverified`, `email_in_use` albo `email_required`. Głowa
 * komunikatu plpgsql -> klucz `eventMe.errors.<camel>`; inne odmowy zostają
 * przy ogólnym zdaniu formularza (`null`).
 */
export const MY_EVENT_PROFILE_ERROR_CODES = [
  "email_unverified",
  "email_in_use",
  "email_required",
] as const;
export type MyEventProfileErrorCode = (typeof MY_EVENT_PROFILE_ERROR_CODES)[number];

export function myEventProfileErrorKey(error: unknown): string | null {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error !== null && "message" in error
        ? String((error as { message: unknown }).message)
        : typeof error === "string"
          ? error
          : "";
  const separator = message.indexOf(":");
  const head = (separator === -1 ? message : message.slice(0, separator)).trim();
  if (!(MY_EVENT_PROFILE_ERROR_CODES as readonly string[]).includes(head)) return null;
  return `eventMe.errors.${head.replace(/_([a-z])/g, (_all, chr: string) => chr.toUpperCase())}`;
}

/** Czy adres (po normalizacji jak `event_people.email_norm`) jest ten sam. */
export function sameEmail(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();
}

/** Powód, dla którego `event_my_account_link` nie dowiązał kartoteki. */
export const MY_EVENT_ACCOUNT_LINK_REASONS = [
  "email_unconfirmed",
  "no_record",
  "record_bound_elsewhere",
] as const;
export type MyEventAccountLinkReason = (typeof MY_EVENT_ACCOUNT_LINK_REASONS)[number];

export interface MyEventAccountLink {
  linked: boolean;
  /** Konto było już dowiązane - nic się nie zmieniło. */
  alreadyLinked: boolean;
  personId: string | null;
  reason: MyEventAccountLinkReason | null;
}

/**
 * SAMODZIELNE DOWIĄZANIE KARTOTEKI (REG-01, D14). Baza dowiązuje do konta
 * niedowiązaną osobę najemcy o POTWIERDZONYM adresie konta - gość, który
 * założył konto po zapisie, i osoba odwiązana naprawą historii odzyskują
 * panel bez organizatora. Ładunek pusty: konto z sesji, najemca z hosta.
 * `null` = baza sprzed migracji (PGRST202/42883) - panel zachowuje się jak dotąd.
 */
export async function linkMyEventAccount(): Promise<MyEventAccountLink | null> {
  const { data, error } = await supabase.rpc("event_my_account_link", { p_payload: {} });
  if (error) {
    if (isMigrationPending(error)) return null;
    throw error;
  }
  const row = bag(data);
  if (row === null) return null;
  const reason = text(row, "reason");
  return {
    linked: bool(row, "linked"),
    alreadyLinked: bool(row, "already_linked"),
    personId: text(row, "person_id"),
    reason: (MY_EVENT_ACCOUNT_LINK_REASONS as readonly string[]).includes(reason ?? "")
      ? (reason as MyEventAccountLinkReason)
      : null,
  };
}

/**
 * Uzupełnia kartotekę wydarzenia danymi z konta platformy. Nadpisujemy tylko
 * puste pola po stronie bazy - decyzje o widoczności kontaktu zostają nietknięte.
 * Adres kartoteki bierze baza WYŁĄCZNIE z potwierdzonego adresu logowania
 * (nigdy z profilu konta, który użytkownik zmienia sam - REG-01).
 */
export async function syncMyEventProfileFromAccount(slug: string): Promise<MyEventPanelState> {
  const { data, error } = await supabase.rpc("event_my_event_profile_sync_account", {
    p_payload: { slug },
  });
  if (error) throw error;
  return parsePanel(data);
}

/**
 * Sesja z `event_my_agenda` (po D0-4: sala z `event_rooms.name/floor`, status
 * sesji, strefa wydarzenia, BEZ adresu transmisji - osobisty plan nigdy nie
 * oddaje `stream_url`, D7). `roomNamePl/En` zostają dla zgodności wstecz
 * (RPC oddaje w obu to samo `r.name`).
 */
export interface MyAgendaSession {
  sessionId: string;
  titlePl: string | null;
  titleEn: string | null;
  startsAt: string | null;
  endsAt: string | null;
  format: string | null;
  roomName: string | null;
  roomFloor: string | null;
  roomNamePl: string | null;
  roomNameEn: string | null;
  trackNamePl: string | null;
  trackNameEn: string | null;
  signupStatus: string | null;
  /** `published` | `cancelled` - szkice RPC ukrywa. */
  sessionStatus: string | null;
  /** Strefa wydarzenia, już bezpieczna (`_event_safe_timezone`). */
  timezone: string | null;
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
      roomName: text(entry, "room_name"),
      roomFloor: text(entry, "room_floor"),
      roomNamePl: text(entry, "room_name_pl"),
      roomNameEn: text(entry, "room_name_en"),
      trackNamePl: text(entry, "track_name_pl"),
      trackNameEn: text(entry, "track_name_en"),
      signupStatus: text(entry, "signup_status"),
      sessionStatus: text(entry, "session_status"),
      timezone: text(entry, "timezone"),
    });
  }
  return out;
}
