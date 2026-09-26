// Warstwa danych panelu "Lejek Google Ads" - wywolania RPC z przegladarki.
//
// AUTORYZACJA ZYJE W SQL. Kazda funkcja `admin_event_ad*` zaczyna od
// `assert_event_admin_tenant()` (admin albo super_admin, nigdy redaktor) i pisze
// wylacznie w najemcy wolajacego; ten modul jest tylko transportem.
//
// KONWENCJA LADUNKU (jak w `sponsorsApi.ts`): klucz pominiety = "bez zmian",
// jawny `null` = "wyczysc". Mapowanie camelCase -> snake_case jest TUTAJ i nigdzie
// indziej. Bledy wychodza jako `new Error(error.message)`, zeby glowa komunikatu
// plpgsql (`campaign_exists: ...`) dotarla do `adminAdsFunnelErrors.ts`.
//
// Wiersze list sa WYPROWADZONE z wygenerowanych typow, a odpowiedzi `jsonb`
// (raport, eksport) przechodza przez czyste parsery w `adsFunnel.ts` - zadnego
// recznego ksztaltu za rzutowaniem.
import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";
import {
  parseAdsConversionsExport,
  parseAdsFunnelReport,
  type AdsConversionsExport,
  type AdsFunnelReport,
} from "@/lib/events/adsFunnel";

type Fns = Database["public"]["Functions"];
export type AdCampaignDbRow = Fns["admin_event_ad_campaigns_list"]["Returns"][number];
export type AdCostDbRow = Fns["admin_event_ad_costs_list"]["Returns"][number];

/** Rodzaje dopasowania kampanii - 1:1 z CHECK `event_ad_campaigns_match_kind_values`. */
export const AD_CAMPAIGN_MATCH_KINDS = ["utm_campaign", "google_ads_campaign_id"] as const;
export type AdCampaignMatchKind = (typeof AD_CAMPAIGN_MATCH_KINDS)[number];

/** Zrodla kosztu - 1:1 z CHECK `event_ad_campaign_costs_source_values`. */
export const AD_COST_SOURCES = ["manual", "csv"] as const;
export type AdCostSource = (typeof AD_COST_SOURCES)[number];

export interface AdCampaignCostSummary {
  currency: string;
  costMicros: number;
  days: number;
}

export interface AdCampaign {
  id: string;
  matchKind: AdCampaignMatchKind;
  matchValue: string;
  label: string;
  conversionActionName: string | null;
  costs: AdCampaignCostSummary[];
}

export interface AdCost {
  day: string;
  costMicros: number;
  currency: string;
  clicks: number | null;
  impressions: number | null;
  source: AdCostSource;
}

function asMatchKind(value: string): AdCampaignMatchKind {
  return value === "google_ads_campaign_id" ? "google_ads_campaign_id" : "utm_campaign";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function costSummaries(raw: Json): AdCampaignCostSummary[] {
  const out: AdCampaignCostSummary[] = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    if (!isRecord(item)) continue;
    out.push({
      currency: String(item.currency),
      costMicros: Number(item.cost_micros),
      days: Number(item.days),
    });
  }
  return out;
}

/** `RETURNS TABLE` oddaje w typach pola "zawsze niepuste" - baza zwraca jednak NULL. */
function numberOrNull(value: number | null): number | null {
  return typeof value === "number" ? value : null;
}

export function toAdCampaign(row: AdCampaignDbRow): AdCampaign {
  const conversion: string | null = row.conversion_action_name;
  return {
    id: row.id,
    matchKind: asMatchKind(row.match_kind),
    matchValue: row.match_value,
    label: row.label,
    conversionActionName: conversion === null || conversion === "" ? null : conversion,
    costs: costSummaries(row.costs),
  };
}

export function toAdCost(row: AdCostDbRow): AdCost {
  return {
    day: row.day,
    costMicros: Number(row.cost_micros),
    currency: row.currency,
    clicks: numberOrNull(row.clicks),
    impressions: numberOrNull(row.impressions),
    source: row.source === "csv" ? "csv" : "manual",
  };
}

function fail(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

export async function fetchAdCampaigns(eventId: string): Promise<AdCampaign[]> {
  const { data, error } = await supabase.rpc("admin_event_ad_campaigns_list", {
    p_event_id: eventId,
  });
  fail(error);
  return (data ?? []).map(toAdCampaign);
}

export interface AdCampaignInput {
  /** Brak = nowa kampania (wtedy `eventId` jest wymagany). */
  id?: string;
  eventId?: string;
  matchKind?: AdCampaignMatchKind;
  matchValue?: string;
  label?: string;
  /** `null` = wyczysc. */
  conversionActionName?: string | null;
}

function payload(input: Record<string, Json | undefined>): Json {
  const out: Record<string, Json> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

export async function saveAdCampaign(input: AdCampaignInput): Promise<string> {
  const { data, error } = await supabase.rpc("admin_event_ad_campaign_save", {
    p_payload: payload({
      id: input.id,
      event_id: input.eventId,
      match_kind: input.matchKind,
      match_value: input.matchValue,
      label: input.label,
      conversion_action_name: input.conversionActionName,
    }),
  });
  fail(error);
  return String(data);
}

export async function deleteAdCampaign(campaignId: string): Promise<void> {
  const { error } = await supabase.rpc("admin_event_ad_campaign_delete", { p_id: campaignId });
  fail(error);
}

export async function fetchAdCosts(campaignId: string): Promise<AdCost[]> {
  const { data, error } = await supabase.rpc("admin_event_ad_costs_list", {
    p_campaign_id: campaignId,
  });
  fail(error);
  return (data ?? []).map(toAdCost);
}

export interface AdCostRowInput {
  day: string;
  costMicros: number;
  currency: string;
  clicks?: number | null;
  impressions?: number | null;
}

export interface AdCostsInput {
  campaignId: string;
  source: AdCostSource;
  rows: readonly AdCostRowInput[];
}

/** Zapis wsadowy (calosc albo nic). Zwraca liczbe zapisanych dni. */
export async function saveAdCosts(input: AdCostsInput): Promise<number> {
  const { data, error } = await supabase.rpc("admin_event_ad_costs_save", {
    p_payload: {
      campaign_id: input.campaignId,
      source: input.source,
      rows: input.rows.map((row) =>
        payload({
          day: row.day,
          cost_micros: row.costMicros,
          currency: row.currency,
          clicks: row.clicks,
          impressions: row.impressions,
        }),
      ),
    },
  });
  fail(error);
  return Number(data);
}

export async function deleteAdCost(campaignId: string, day: string): Promise<void> {
  const { error } = await supabase.rpc("admin_event_ad_cost_delete", {
    p_campaign_id: campaignId,
    p_day: day,
  });
  fail(error);
}

export interface AdsFunnelQuery {
  eventId: string;
  /** Instant ISO (domkniety od dolu) albo `null` = bez granicy. */
  from: string | null;
  /** Instant ISO (otwarty od gory) albo `null` = bez granicy. */
  to: string | null;
}

function windowArgs(query: AdsFunnelQuery): { p_from?: string; p_to?: string } {
  return {
    ...(query.from === null ? {} : { p_from: query.from }),
    ...(query.to === null ? {} : { p_to: query.to }),
  };
}

export async function fetchAdsFunnel(query: AdsFunnelQuery): Promise<AdsFunnelReport> {
  const { data, error } = await supabase.rpc("admin_event_ads_funnel", {
    p_event_id: query.eventId,
    ...windowArgs(query),
  });
  fail(error);
  return parseAdsFunnelReport(data ?? null);
}

export async function fetchAdsConversions(query: AdsFunnelQuery): Promise<AdsConversionsExport> {
  const { data, error } = await supabase.rpc("admin_event_ads_conversions_export", {
    p_event_id: query.eventId,
    ...windowArgs(query),
  });
  fail(error);
  return parseAdsConversionsExport(data ?? null);
}
