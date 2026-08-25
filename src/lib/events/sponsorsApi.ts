// Dostep panelu organizatora do modulu SPONSORZY: poziomy sponsorskie, przypiecia
// firm z CRM, kontakty, materialy i odswiezanie migawek.
//
// JEDEN PLIK NA CALY MODUL. Poziom bez firm nic nie znaczy, firma bez poziomu nie
// moze byc opublikowana (`event_sponsors_published_needs_tier`), a kontakty i
// materialy wisza na przypieciu. Rozbicie na cztery pliki zdublowaloby typ
// wiersza sponsora - a zdublowany typ rozjezdza sie przy pierwszej migracji.
//
// TYPY WYPROWADZAMY Z WYGENEROWANYCH `Database`. `admin_event_sponsors_list`
// zwraca kolumny wyliczane w SQL-u (`crm_drift`, `contacts_count`,
// `published_materials_count`, `total_count`); recznie pisany interfejs bylby
// prawdziwy do najblizszej zmiany kolumny.
//
// KLUCZE POMINIETE (`undefined`) NIE WCHODZA DO PAYLOADU. SQL czyta
// `p_payload ? 'tier_id'`, wiec brak klucza znaczy „zostaw jak bylo", a jawny
// `null` znaczy „odczep poziom". Sklejenie obu odbieraloby organizatorowi
// mozliwosc wyczyszczenia pola.
import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";

type Fns = Database["public"]["Functions"];

export type EventSponsorRow = Fns["admin_event_sponsors_list"]["Returns"][number];
export type EventSponsorDetailRow = Fns["admin_event_sponsor_detail"]["Returns"][number];
export type EventSponsorTierRow = Fns["admin_event_sponsor_tiers_list"]["Returns"][number];
export type SponsorCompanyRow = Fns["admin_event_sponsor_companies_search"]["Returns"][number];

/** `event_sponsors_role_values` z migracji, jeden do jednego. */
export const SPONSOR_ROLES = ["sponsor", "partner", "media_partner", "exhibitor"] as const;
export type SponsorRole = (typeof SPONSOR_ROLES)[number];

/** Filtr listy; `all` nie jest wartoscia w bazie, tylko brakiem filtra. */
export type SponsorRoleFilter = SponsorRole | "all";
export type SponsorPublishedFilter = "all" | "published" | "draft";

/** `event_sponsor_contacts_role_values`. */
export const SPONSOR_CONTACT_ROLES = ["primary", "marketing", "billing", "onsite"] as const;
export type SponsorContactRole = (typeof SPONSOR_CONTACT_ROLES)[number];

/** `event_sponsor_materials_kind_values`. */
export const SPONSOR_MATERIAL_KINDS = [
  "document",
  "presentation",
  "video",
  "link",
  "logo_pack",
] as const;
export type SponsorMaterialKind = (typeof SPONSOR_MATERIAL_KINDS)[number];

/** `event_sponsor_tiers_logo_size_values`. */
export const SPONSOR_TIER_LOGO_SIZES = ["sm", "md", "lg"] as const;
export type SponsorTierLogoSize = (typeof SPONSOR_TIER_LOGO_SIZES)[number];

type PayloadInput = Record<string, Json | undefined>;

function args<T extends Record<string, unknown>>(input: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) out[key] = value;
  }
  return out as T;
}

function payload(input: PayloadInput): Json {
  const out: Record<string, Json> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) out[key] = value;
  }
  return out as Json;
}

function unwrap<T>(data: T | null, error: { message: string } | null): T {
  if (error) throw new Error(error.message);
  return (data ?? []) as T;
}

/* ---------------------------------------------------------------- poziomy --- */

export interface SponsorTierInput {
  id?: string;
  eventId?: string;
  key?: string;
  namePl: string;
  nameEn: string;
  descriptionPl?: string;
  descriptionEn?: string;
  rank?: number;
  /** `null` = brak koloru akcentu; `undefined` = nie ruszaj. */
  accentColor?: string | null;
  logoSize?: SponsorTierLogoSize;
  /** `null` = bez limitu firm. */
  maxCompanies?: number | null;
  sortOrder?: number;
  isActive?: boolean;
  benefits?: Array<{ labelPl: string; labelEn: string; isHighlighted?: boolean }>;
}

export async function fetchSponsorTiers(eventId: string): Promise<EventSponsorTierRow[]> {
  const { data, error } = await supabase.rpc("admin_event_sponsor_tiers_list", {
    p_event_id: eventId,
  });
  return unwrap<EventSponsorTierRow[]>(data, error);
}

export async function saveSponsorTier(input: SponsorTierInput): Promise<string> {
  const { data, error } = await supabase.rpc("admin_event_sponsor_tier_save", {
    p_payload: payload({
      id: input.id,
      event_id: input.eventId,
      key: input.key,
      name_pl: input.namePl,
      name_en: input.nameEn,
      description_pl: input.descriptionPl,
      description_en: input.descriptionEn,
      rank: input.rank,
      accent_color: input.accentColor,
      logo_size: input.logoSize,
      max_companies: input.maxCompanies,
      sort_order: input.sortOrder,
      is_active: input.isActive,
      benefits: input.benefits?.map((b) => ({
        label_pl: b.labelPl,
        label_en: b.labelEn,
        is_highlighted: b.isHighlighted ?? false,
      })),
    }),
  });
  if (error) throw new Error(error.message);
  return String(data);
}

export async function deleteSponsorTier(id: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("admin_event_sponsor_tier_delete", { _id: id });
  if (error) throw new Error(error.message);
  return data === true;
}

export interface SponsorOrderItem {
  id: string;
  sortOrder: number;
  rank?: number;
}

export async function reorderSponsorTiers(items: SponsorOrderItem[]): Promise<number> {
  const { data, error } = await supabase.rpc("admin_event_sponsor_tiers_reorder", {
    p_payload: payload({
      items: items.map((item) =>
        payload({ id: item.id, sort_order: item.sortOrder, rank: item.rank }),
      ),
    }),
  });
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}

/* -------------------------------------------------------------- sponsorzy --- */

export interface SponsorsQuery {
  eventId: string;
  tierId?: string;
  role?: SponsorRoleFilter;
  published?: SponsorPublishedFilter;
  q?: string;
  limit?: number;
  offset?: number;
}

export async function fetchSponsors(query: SponsorsQuery): Promise<EventSponsorRow[]> {
  const { data, error } = await supabase.rpc(
    "admin_event_sponsors_list",
    args({
      p_event_id: query.eventId,
      p_tier_id: query.tierId,
      p_role: query.role === "all" ? undefined : query.role,
      p_published: query.published === "all" ? undefined : query.published,
      p_q: query.q?.trim() === "" ? undefined : query.q,
      p_limit: query.limit,
      p_offset: query.offset,
    }),
  );
  return unwrap<EventSponsorRow[]>(data, error);
}

export async function fetchSponsorDetail(id: string): Promise<EventSponsorDetailRow | null> {
  const { data, error } = await supabase.rpc("admin_event_sponsor_detail", { _id: id });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as EventSponsorDetailRow[];
  return rows[0] ?? null;
}

export async function searchSponsorCompanies(
  eventId: string,
  q: string,
  limit?: number,
): Promise<SponsorCompanyRow[]> {
  const { data, error } = await supabase.rpc(
    "admin_event_sponsor_companies_search",
    args({
      p_event_id: eventId,
      p_q: q.trim() === "" ? undefined : q,
      p_limit: limit,
    }),
  );
  return unwrap<SponsorCompanyRow[]>(data, error);
}

export interface SponsorInput {
  id?: string;
  eventId?: string;
  companyId?: string;
  /** `null` = odczep poziom (mozliwe tylko dla nieopublikowanych sponsorow). */
  tierId?: string | null;
  role?: SponsorRole;
  isPublished?: boolean;
  boothLabel?: string | null;
  sortOrder?: number;
  snapshotName?: string;
  snapshotLogoUrl?: string | null;
  snapshotWebsite?: string | null;
  snapshotCountry?: string | null;
  snapshotDescriptionPl?: string;
  snapshotDescriptionEn?: string;
  internalNote?: string | null;
}

export async function saveSponsor(input: SponsorInput): Promise<string> {
  const { data, error } = await supabase.rpc("admin_event_sponsor_save", {
    p_payload: payload({
      id: input.id,
      event_id: input.eventId,
      company_id: input.companyId,
      tier_id: input.tierId,
      role: input.role,
      is_published: input.isPublished,
      booth_label: input.boothLabel,
      sort_order: input.sortOrder,
      snapshot_name: input.snapshotName,
      snapshot_logo_url: input.snapshotLogoUrl,
      snapshot_website: input.snapshotWebsite,
      snapshot_country: input.snapshotCountry,
      snapshot_description_pl: input.snapshotDescriptionPl,
      snapshot_description_en: input.snapshotDescriptionEn,
      internal_note: input.internalNote,
    }),
  });
  if (error) throw new Error(error.message);
  return String(data);
}

export async function deleteSponsor(id: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("admin_event_sponsor_delete", { _id: id });
  if (error) throw new Error(error.message);
  return data === true;
}

export async function reorderSponsors(items: SponsorOrderItem[]): Promise<number> {
  const { data, error } = await supabase.rpc("admin_event_sponsors_reorder", {
    p_payload: payload({
      items: items.map((item) => payload({ id: item.id, sort_order: item.sortOrder })),
    }),
  });
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}

export async function setSponsorsPublished(ids: string[], isPublished: boolean): Promise<number> {
  const { data, error } = await supabase.rpc("admin_event_sponsors_set_published", {
    p_payload: payload({ ids, is_published: isPublished }),
  });
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}

export interface SnapshotRefreshInput {
  eventId?: string;
  ids?: string[];
  /** Migawki wpisane recznie zostaja nietkniete, chyba ze organizator poprosi. */
  includeManual?: boolean;
}

export async function refreshSponsorSnapshots(input: SnapshotRefreshInput): Promise<number> {
  const { data, error } = await supabase.rpc("admin_event_sponsor_snapshot_refresh", {
    p_payload: payload({
      event_id: input.eventId,
      ids: input.ids,
      include_manual: input.includeManual,
    }),
  });
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}

/* ---------------------------------------------------- kontakty i materialy --- */

export interface SponsorContactInput {
  leadId: string;
  role?: SponsorContactRole;
  isPrimary?: boolean;
  note?: string | null;
}

export async function setSponsorContacts(
  sponsorId: string,
  items: SponsorContactInput[],
): Promise<number> {
  const { data, error } = await supabase.rpc("admin_event_sponsor_contacts_set", {
    p_payload: payload({
      sponsor_id: sponsorId,
      items: items.map((item) =>
        payload({
          lead_id: item.leadId,
          role: item.role,
          is_primary: item.isPrimary,
          note: item.note,
        }),
      ),
    }),
  });
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}

export interface SponsorMaterialInput {
  id?: string;
  sponsorId?: string;
  kind?: SponsorMaterialKind;
  titlePl: string;
  titleEn: string;
  url?: string;
  sortOrder?: number;
  isPublished?: boolean;
}

export async function saveSponsorMaterial(input: SponsorMaterialInput): Promise<string> {
  const { data, error } = await supabase.rpc("admin_event_sponsor_material_save", {
    p_payload: payload({
      id: input.id,
      sponsor_id: input.sponsorId,
      kind: input.kind,
      title_pl: input.titlePl,
      title_en: input.titleEn,
      url: input.url,
      sort_order: input.sortOrder,
      is_published: input.isPublished,
    }),
  });
  if (error) throw new Error(error.message);
  return String(data);
}

export async function deleteSponsorMaterial(id: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("admin_event_sponsor_material_delete", { _id: id });
  if (error) throw new Error(error.message);
  return data === true;
}

export async function reorderSponsorMaterials(items: SponsorOrderItem[]): Promise<number> {
  const { data, error } = await supabase.rpc("admin_event_sponsor_materials_reorder", {
    p_payload: payload({
      items: items.map((item) => payload({ id: item.id, sort_order: item.sortOrder })),
    }),
  });
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}
