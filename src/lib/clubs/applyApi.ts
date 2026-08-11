// Dostep do zgloszen klubowych (RPC).
//
// Zapis idzie WYLACZNIE przez `club_apply_submit` (SECURITY DEFINER): to tam
// jest twarda bramka "PRO+ wymagane" i tam powstaje slad w CRM. Klient nie
// pisze do tabeli bezposrednio - RLS daje mu wylacznie odczyt wlasnych
// zgloszen, zeby formularz mogl pokazac historie.
import { supabase } from "@/integrations/supabase/client";
import type { ClubApplyValues } from "@/lib/clubs/applyValidation";

export type ClubApplicationStatus = "pending" | "review" | "accepted" | "rejected";

export interface ClubApplicationAdminRow {
  id: string;
  created_at: string;
  user_id: string;
  specialization_slug: string;
  club_id: string | null;
  club_name: string | null;
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
}

export interface ClubApplicationCountRow {
  specialization_slug: string;
  total: number;
  pending: number;
}

/** Bledy RPC mapujemy na klucze i18n - komunikat powstaje w widoku. */
export type ClubApplySubmitError =
  | "auth_required"
  | "pro_required"
  | "consent_required"
  | "email_required"
  | "motivation_required"
  | "specialization_required"
  | "unknown";

export function clubApplyErrorCode(message: string): ClubApplySubmitError {
  const known: ClubApplySubmitError[] = [
    "auth_required",
    "pro_required",
    "consent_required",
    "email_required",
    "motivation_required",
    "specialization_required",
  ];
  return known.find((code) => message.includes(code)) ?? "unknown";
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
