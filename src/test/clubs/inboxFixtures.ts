// Atomy testowe SKRZYNKI ZGŁOSZEŃ klubowych - wiersz `admin_club_applications_list`
// i wiersz liczników `admin_club_applications_counts`.
//
// DLACZEGO OSOBNY PLIK, A NIE DOPISEK DO `fixtures.ts`. Tamten moduł opisuje
// wiersze RPC KLUBU (lista, widok, grupy, członkowie, wątki, moderacja); tu
// mieszka powierzchnia ZGŁOSZEŃ, która ma własny incydent produkcyjny
// w historii (`source_type='club_application'` złamał CHECK na `crm_leads`,
// stąd bramka `check:pg-harness`) i własny zestaw kolumn - w tym CZTERY pola
// o stanie synchronizacji z CRM i TRZY o stanie poczty do kandydata.
//
// Świadomie BEZ rzutowań: kształt jest wzięty z `ClubApplicationAdminRow`,
// więc rozjazd kolumny w migracji wychodzi na typach w każdym teście, który
// wiersza używa - a nie dopiero w runtime.
//
// DOMYŚLNY WIERSZ jest wierszem KOMPLETNYM (wszystkie pola wypełnione, CRM
// zsynchronizowany, poczta wysłana). Stany brakujące - pole opcjonalne puste,
// CRM w błędzie, poczta nietknięta - robi się przez `overrides`, bo test ma
// mówić WPROST, którego braku dotyczy.
import { CLUB_BASE_ISO, CLUB_IDS, clubIsoOffset } from "@/test/clubs/fixtures";
import type {
  ClubApplicationAdminRow,
  ClubApplicationCountRow,
  ClubApplicationCrmRetryResult,
} from "@/lib/clubs/applyApi";

export const APPLICATION_IDS = {
  first: "application-1",
  second: "application-2",
  third: "application-3",
} as const;

export function clubApplicationAdminRow(
  overrides: Partial<ClubApplicationAdminRow> = {},
): ClubApplicationAdminRow {
  return {
    id: APPLICATION_IDS.first,
    created_at: CLUB_BASE_ISO,
    user_id: CLUB_IDS.member,
    specialization_slug: "energia-klimat",
    club_id: CLUB_IDS.club,
    club_name_pl: "Klub energetyczny",
    club_name_en: "Energy club",
    first_name: "Anna",
    last_name: "Kowalska",
    email: "anna.kowalska@example.org",
    phone: "+48 600 100 200",
    company: "Instytut Energii",
    job_position: "Analityczka",
    seniority: "senior",
    industry: "energetyka",
    country: "Polska",
    city: "Warszawa",
    linkedin_url: "https://www.linkedin.com/in/anna-kowalska",
    years_experience: 9,
    expertise: "Rynek mocy i taksonomia",
    languages: "pl, en",
    motivation: "Chcę pracować nad rekomendacjami dla KE.",
    goals: "Publikacja stanowiska w I kwartale.",
    contribution: "Dane z rynku bilansującego.",
    availability: "wtorki po 17",
    referral_source: "newsletter",
    marketing_consent: true,
    tier_key: "pro",
    tier_rank: 20,
    status: "pending",
    admin_note: "",
    reviewed_at: null,
    lang: "pl",
    crm_lead_id: "lead-1",
    crm_sync_status: "ok",
    crm_synced_at: clubIsoOffset(5),
    crm_last_attempt_at: clubIsoOffset(5),
    crm_error: null,
    notified_status: "needs_info",
    notified_at: clubIsoOffset(10),
    notify_error: null,
    ...overrides,
  };
}

export function clubApplicationCountRow(
  overrides: Partial<ClubApplicationCountRow> = {},
): ClubApplicationCountRow {
  return {
    specialization_slug: "energia-klimat",
    total: 4,
    pending: 2,
    ...overrides,
  };
}

export function clubApplicationCrmRetryResult(
  overrides: Partial<ClubApplicationCrmRetryResult> = {},
): ClubApplicationCrmRetryResult {
  return {
    crm_sync_status: "ok",
    crm_error: null,
    crm_synced_at: clubIsoOffset(15),
    crm_last_attempt_at: clubIsoOffset(15),
    ...overrides,
  };
}
