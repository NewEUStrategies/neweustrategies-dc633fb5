// RAPORT DLA SPONSORÓW - warstwa RPC panelu (studio wydarzenia i karta firmy).
//
// AUTORYZACJA SIEDZI W SQL. Każda funkcja zaczyna od
// `assert_event_admin_tenant()` (admin albo super_admin, nigdy redaktor), a
// najemca to najemca DOMOWY wołającego - tutaj nie ma ani jednego `tenant_id`.
//
// TYPY WIERSZY WYPROWADZAMY Z `Database`, nie piszemy ich ręcznie (bramka
// `check:db-row-casts`). Generator oznacza pola RETURNS TABLE jako niepuste -
// to znane kłamstwo, więc model (`sponsorReportModel.ts`) czyta liczby
// defensywnie, a brak oceny (`leads_avg_rating` = NULL) zostaje brakiem.
//
// TOKEN LINKU WRACA RAZ. `issueSponsorReportLink` oddaje jawny token wyłącznie
// w odpowiedzi na wydanie - lista linków zna tylko prefiks. Token nie trafia
// do cache zapytań: wydanie jest mutacją, a nie zapytaniem z kluczem.
import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";
import type { SponsorPlacement } from "@/lib/events/sponsorExposure";

type Fns = Database["public"]["Functions"];

export type SponsorReportSummaryRow = Fns["admin_event_sponsor_report_summary"]["Returns"][number];
export type SponsorReportSeriesRow = Fns["admin_event_sponsor_report_series"]["Returns"][number];
export type SponsorReportLeadsSeriesRow =
  Fns["admin_event_sponsor_report_leads_series"]["Returns"][number];
export type SponsorReportLinkRow = Fns["admin_event_sponsor_report_links_list"]["Returns"][number];
export type CompanySponsorshipRow = Fns["admin_event_company_sponsorships"]["Returns"][number];

export interface SponsorReportQuery {
  eventId: string;
  /** Pierwszy dzień (YYYY-MM-DD, strefa wydarzenia) albo `null` = od początku. */
  from: string | null;
  /** Ostatni dzień włącznie albo `null` = do dziś. */
  to: string | null;
  /** Filtr miejsca (tylko ekspozycje) albo `null` = wszystkie. */
  placement: SponsorPlacement | null;
  /** Filtr sponsora (szeregi) albo `null` = wszyscy. */
  sponsorId: string | null;
}

/** Argumenty opcjonalne: `null` znaczy „bez filtra", więc klucz wypada. */
function optional<T extends Record<string, string | null>>(input: T): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== null) out[key] = value;
  }
  return out;
}

function fail(error: { message: string }): never {
  throw new Error(error.message);
}

export async function fetchSponsorReportSummary(
  query: SponsorReportQuery,
): Promise<SponsorReportSummaryRow[]> {
  const { data, error } = await supabase.rpc("admin_event_sponsor_report_summary", {
    p_event_id: query.eventId,
    ...optional({ p_from: query.from, p_to: query.to, p_placement: query.placement }),
  });
  if (error) fail(error);
  return data ?? [];
}

export async function fetchSponsorReportSeries(
  query: SponsorReportQuery,
): Promise<SponsorReportSeriesRow[]> {
  const { data, error } = await supabase.rpc("admin_event_sponsor_report_series", {
    p_event_id: query.eventId,
    ...optional({
      p_from: query.from,
      p_to: query.to,
      p_sponsor_id: query.sponsorId,
      p_placement: query.placement,
    }),
  });
  if (error) fail(error);
  return data ?? [];
}

export async function fetchSponsorReportLeadsSeries(
  query: SponsorReportQuery,
): Promise<SponsorReportLeadsSeriesRow[]> {
  const { data, error } = await supabase.rpc("admin_event_sponsor_report_leads_series", {
    p_event_id: query.eventId,
    ...optional({ p_from: query.from, p_to: query.to, p_sponsor_id: query.sponsorId }),
  });
  if (error) fail(error);
  return data ?? [];
}

export async function fetchSponsorReportLinks(eventId: string): Promise<SponsorReportLinkRow[]> {
  const { data, error } = await supabase.rpc("admin_event_sponsor_report_links_list", {
    p_event_id: eventId,
  });
  if (error) fail(error);
  return data ?? [];
}

export interface SponsorReportLinkInput {
  sponsorId: string;
  label: string;
  /** Chwila wygaśnięcia (ISO) albo `null` = domyślna bazy. */
  expiresAt: string | null;
  includeLeads: boolean;
}

export interface IssuedSponsorReportLink {
  id: string;
  sponsorId: string;
  /** Jawny token - pokazywany RAZ, nigdzie nie zapisywany. */
  token: string;
  tokenPrefix: string;
  expiresAt: string;
  includeLeads: boolean;
}

function record(value: Json | null): Record<string, Json | undefined> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function text(value: Json | undefined): string {
  return typeof value === "string" ? value : "";
}

export async function issueSponsorReportLink(
  input: SponsorReportLinkInput,
): Promise<IssuedSponsorReportLink> {
  const payload: Record<string, Json> = {
    sponsor_id: input.sponsorId,
    label: input.label.trim(),
    include_leads: input.includeLeads,
  };
  if (input.expiresAt !== null) payload.expires_at = input.expiresAt;
  const { data, error } = await supabase.rpc("admin_event_sponsor_report_link_issue", {
    p_payload: payload,
  });
  if (error) fail(error);
  const row = record(data);
  return {
    id: text(row.id),
    sponsorId: text(row.sponsor_id),
    token: text(row.token),
    tokenPrefix: text(row.token_prefix),
    expiresAt: text(row.expires_at),
    includeLeads: row.include_leads === true,
  };
}

export async function revokeSponsorReportLink(linkId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("admin_event_sponsor_report_link_revoke", {
    p_link_id: linkId,
  });
  if (error) fail(error);
  return data === true;
}

export async function fetchCompanySponsorships(
  companyId: string,
): Promise<CompanySponsorshipRow[]> {
  const { data, error } = await supabase.rpc("admin_event_company_sponsorships", {
    p_company_id: companyId,
  });
  if (error) fail(error);
  return data ?? [];
}

export interface PushLeadsInput {
  eventId: string;
  /** `null` = kontakty wszystkich sponsorów wydarzenia. */
  sponsorId: string | null;
}

export interface PushLeadsResult {
  persons: number;
  created: number;
  updated: number;
  skippedNoEmail: number;
  skippedNoConsent: number;
  failed: number;
}

function count(value: Json | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Przeniesienie kontaktów do CRM - STRONA PO STRONIE aż do końca.
 *
 * Baza przenosi najwyżej 500 osób w jednym wywołaniu i oddaje kursor
 * (`has_more` + `next_after`). Każda strona to osobna, krótka transakcja, więc
 * duże wydarzenie nie wpada w `statement_timeout`, a żadna osoba nie zostaje
 * pominięta po cichu (dawniej sztywny limit 5000 przenosił w kółko te same
 * pierwsze osoby). Liczniki stron sumujemy w jeden wynik dla komunikatu.
 * Kursor, który się nie przesuwa, kończy pętlę - zamiast wołać bazę bez końca.
 */
export async function pushLeadScansToCrm(input: PushLeadsInput): Promise<PushLeadsResult> {
  const total: PushLeadsResult = {
    persons: 0,
    created: 0,
    updated: 0,
    skippedNoEmail: 0,
    skippedNoConsent: 0,
    failed: 0,
  };
  let after: string | null = null;
  for (;;) {
    const payload: Record<string, Json> = { event_id: input.eventId };
    if (input.sponsorId !== null) payload.sponsor_id = input.sponsorId;
    if (after !== null) payload.after_person_id = after;
    const { data, error } = await supabase.rpc("admin_event_lead_scans_push_to_crm", {
      p_payload: payload,
    });
    if (error) fail(error);
    const row = record(data);
    total.persons += count(row.persons);
    total.created += count(row.created);
    total.updated += count(row.updated);
    total.skippedNoEmail += count(row.skipped_no_email);
    total.skippedNoConsent += count(row.skipped_no_consent);
    total.failed += count(row.failed);
    const next =
      row.has_more === true && typeof row.next_after === "string" ? row.next_after : null;
    if (next === null || next === after) return total;
    after = next;
  }
}
