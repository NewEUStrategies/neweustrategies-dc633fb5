// Dostep do zgloszen klubowych (RPC).
//
// Zapis idzie WYLACZNIE przez `club_apply_submit` (SECURITY DEFINER): to tam
// jest twarda bramka "PRO+ wymagane" i tam powstaje slad w CRM. Klient nie
// pisze do tabeli bezposrednio - RLS daje mu wylacznie odczyt wlasnych
// zgloszen, zeby formularz mogl pokazac historie.
import { supabase } from "@/integrations/supabase/client";
import type { ClubApplyValues } from "@/lib/clubs/applyValidation";

export type ClubApplicationStatus =
  | "pending"
  | "review"
  | "accepted"
  | "rejected"
  | "needs_info";

/** Stan synchronizacji zgloszenia z kartoteka CRM. */
export type ClubApplicationCrmStatus = "pending" | "ok" | "error";

export interface ClubApplicationAdminRow {
  id: string;
  created_at: string;
  user_id: string;
  specialization_slug: string;
  club_id: string | null;
  // Dwie nazwy, nie jedna: panel admina renderuje w jezyku operatora, a
  // wczesniej RPC podawalo tylko `c.name_pl` - admin w EN widzial polskie nazwy.
  club_name_pl: string | null;
  club_name_en: string | null;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  company: string;
  job_position: string;
  seniority: string;
  industry: string;
  country: string;
  city: string;
  linkedin_url: string;
  years_experience: number | null;
  expertise: string;
  languages: string;
  motivation: string;
  goals: string;
  contribution: string;
  availability: string;
  referral_source: string;
  marketing_consent: boolean;
  tier_key: string;
  tier_rank: number;
  status: ClubApplicationStatus;
  admin_note: string;
  reviewed_at: string | null;
  lang: string;
  crm_lead_id: string | null;
  crm_sync_status: ClubApplicationCrmStatus;
  crm_synced_at: string | null;
  crm_last_attempt_at: string | null;
  crm_error: string | null;
  notified_status: ClubApplicationStatus | null;
  notified_at: string | null;
  notify_error: string | null;
}

export interface ClubApplicationCrmRetryResult {
  crm_sync_status: ClubApplicationCrmStatus;
  crm_error: string | null;
  crm_synced_at: string | null;
  crm_last_attempt_at: string | null;
}

export interface ClubApplicationCountRow {
  specialization_slug: string;
  total: number;
  pending: number;
}

/**
 * Wlasne zgloszenie widziane przez kandydata (`club_my_applications`).
 *
 * Swiadomie WEZSZY zestaw kolumn niz wiersz admina: `admin_note` to notatka
 * komisji, nie dana dostarczona przez osobe - nie ma jej w tym RPC i nie wolno
 * jej tu dopisywac.
 */
export interface ClubMyApplicationRow {
  id: string;
  created_at: string;
  specialization_slug: string;
  club_id: string | null;
  club_name_pl: string | null;
  club_name_en: string | null;
  status: ClubApplicationStatus;
  reviewed_at: string | null;
}

/** Bledy RPC mapujemy na klucze i18n - komunikat powstaje w widoku. */
export type ClubApplySubmitError =
  | "auth_required"
  | "pro_required"
  | "club_tier_too_low"
  | "consent_required"
  | "email_required"
  | "motivation_required"
  | "specialization_required"
  | "years_invalid"
  | "duplicate_open"
  | "unknown";

export function clubApplyErrorCode(message: string): ClubApplySubmitError {
  // Kolejnosc ma znaczenie, bo dopasowujemy przez `includes`: bardziej
  // szczegolowe kody ida pierwsze, zeby ogolniejszy nigdy nie przechwycil
  // komunikatu, ktory dotyczy progu konkretnego klubu.
  const known: ClubApplySubmitError[] = [
    "auth_required",
    "club_tier_too_low",
    "pro_required",
    "consent_required",
    "email_required",
    "motivation_required",
    "specialization_required",
    "years_invalid",
    "duplicate_open",
  ];
  return known.find((code) => message.includes(code)) ?? "unknown";
}

/**
 * Bledy `admin_club_application_set_status` mapowane na klucze i18n.
 *
 * `duplicate_open` przychodzi z bazy przy COFANIU decyzji: indeks czesciowy
 * dopuszcza tylko jedno OTWARTE zgloszenie tej samej osoby w tej samej
 * specjalizacji, wiec powrot z `accepted`/`rejected` do `pending`/`review`/
 * `needs_info` moze naruszyc unikalnosc. RPC zamienia surowe 23505 na ten kod -
 * panel musi go nazwac, inaczej operator widzi wylacznie ogolne "nie udalo sie
 * zapisac statusu" i nie ma pojecia, ze przeszkoda jest drugie zgloszenie.
 */
export type ClubApplicationStatusError = "duplicate_open" | "unknown";

export function clubApplicationStatusErrorCode(message: string): ClubApplicationStatusError {
  return message.includes("duplicate_open") ? "duplicate_open" : "unknown";
}

export async function submitClubApplication(
  values: ClubApplyValues,
  lang: "pl" | "en",
): Promise<string> {
  const { data, error } = await supabase.rpc("club_apply_submit", {
    p: {
      specialization_slug: values.specialization,
      club_id: values.clubId,
      first_name: values.firstName,
      last_name: values.lastName,
      email: values.email,
      phone: values.phone,
      company: values.company,
      job_position: values.jobPosition,
      seniority: values.seniority,
      industry: values.industry,
      country: values.country,
      city: values.city,
      linkedin_url: values.linkedinUrl,
      years_experience: values.yearsExperience,
      expertise: values.expertise,
      languages: values.languages,
      motivation: values.motivation,
      goals: values.goals,
      contribution: values.contribution,
      availability: values.availability,
      referral_source: values.referralSource,
      consent: values.consent,
      marketing_consent: values.marketingConsent,
      lang,
    },
  });
  if (error) throw new Error(error.message);
  return String(data);
}

/**
 * Historia wlasnych zgloszen. RPC jest zakresowane po `auth.uid()`, wiec
 * formularz moze pokazac status decyzji bez zadnego filtra po stronie klienta -
 * inaczej kandydat po wyslaniu nigdy wiecej nie widzi swojego zgloszenia
 * i po tygodniu ciszy sklada je drugi raz.
 */
export async function fetchMyClubApplications(): Promise<ClubMyApplicationRow[]> {
  const { data, error } = await supabase.rpc("club_my_applications");
  if (error) throw new Error(error.message);
  return (data ?? []) as ClubMyApplicationRow[];
}

export async function fetchAdminClubApplications(filters: {
  specialization?: string | null;
  clubId?: string | null;
  status?: ClubApplicationStatus | null;
  search?: string | null;
}): Promise<ClubApplicationAdminRow[]> {
  const { data, error } = await supabase.rpc("admin_club_applications_list", {
    p_specialization: filters.specialization ?? undefined,
    p_club_id: filters.clubId ?? undefined,
    p_status: filters.status ?? undefined,
    p_search: filters.search ?? undefined,
    p_limit: 200,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as ClubApplicationAdminRow[];
}

export async function fetchAdminClubApplicationCounts(): Promise<ClubApplicationCountRow[]> {
  const { data, error } = await supabase.rpc("admin_club_applications_counts");
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    specialization_slug: row.specialization_slug,
    total: Number(row.total),
    pending: Number(row.pending),
  }));
}

export async function setClubApplicationStatus(
  id: string,
  status: ClubApplicationStatus,
  note?: string,
): Promise<void> {
  const { error } = await supabase.rpc("admin_club_application_set_status", {
    p_id: id,
    p_status: status,
    p_note: note ?? undefined,
  });
  if (error) throw new Error(error.message);
}

/**
 * Ponowienie synchronizacji z CRM dla jednego zgloszenia.
 *
 * Blad synchronizacji nie moze byc niewidzialny: RPC zapisuje jego tresc przy
 * zgloszeniu i zwraca aktualny stan, zeby panel od razu pokazal wynik proby.
 */
export async function retryClubApplicationCrmSync(
  id: string,
): Promise<ClubApplicationCrmRetryResult> {
  const { data, error } = await supabase.rpc("admin_club_application_crm_retry", { p_id: id });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : null;
  if (!row) throw new Error("not_found");
  return {
    crm_sync_status: row.crm_sync_status as ClubApplicationCrmStatus,
    crm_error: row.crm_error,
    crm_synced_at: row.crm_synced_at,
    crm_last_attempt_at: row.crm_last_attempt_at,
  };
}
