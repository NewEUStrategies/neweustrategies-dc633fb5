// Model PUBLICZNEJ listy partnerów wydarzenia (`event_sponsors_public`,
// `event_sponsor_materials_public`).
//
// TO JEST MIGAWKA, NIE KARTOTEKA. Baza oddaje `snapshot_*` przepisane z CRM
// w chwili przypięcia - i tak ma być: nazwa firmy w programie kongresu ma
// zostać taka, jaka była na afiszu, nawet jeśli kartoteka zmieni się w lutym.
// Front NIE dołącza tu niczego z `crm_companies`.
//
// POZIOM TRZYMA PORZĄDEK, NIE ALFABET. Kolejność bierze się z rangi poziomu
// i `sort_order` przypięcia, bo to jest umowa sponsorska, a nie lista.
// Sponsorzy BEZ poziomu (grupa `tierId === null`) idą na koniec - baza już ich
// tak ustawia, my tylko tego nie psujemy.
//
// LOGOTYP MA TRZY ROZMIARY, A NIE JEDEN. `logo_size` jest kolumną poziomu,
// więc „złoty" jest większy od „brązowego" wszędzie tam, gdzie się pojawia -
// bez tego różnica pakietów przestaje być widoczna.
import type { Database, Json } from "@/integrations/supabase/types";

type Fns = Database["public"]["Functions"];

export type EventSponsorTierRow = Fns["event_sponsors_public"]["Returns"][number];
export type EventSponsorMaterialRow = Fns["event_sponsor_materials_public"]["Returns"][number];

export const SPONSOR_ROLES = ["sponsor", "partner", "media_partner", "exhibitor"] as const;
export type SponsorRole = (typeof SPONSOR_ROLES)[number];

export const SPONSOR_LOGO_SIZES = ["sm", "md", "lg"] as const;
export type SponsorLogoSize = (typeof SPONSOR_LOGO_SIZES)[number];

export const SPONSOR_MATERIAL_KINDS = [
  "document",
  "presentation",
  "video",
  "link",
  "logo_pack",
] as const;
export type SponsorMaterialKind = (typeof SPONSOR_MATERIAL_KINDS)[number];

export interface PublicSponsor {
  id: string;
  name: string;
  logoUrl: string | null;
  websiteUrl: string | null;
  descriptionPl: string | null;
  descriptionEn: string | null;
  country: string | null;
  role: SponsorRole;
  boothLabel: string | null;
  sortOrder: number;
}

export interface SponsorTierBenefit {
  id: string;
  labelPl: string | null;
  labelEn: string | null;
}

export interface PublicSponsorTier {
  /** `null` = grupa „bez poziomu", zawsze na końcu listy. */
  tierId: string | null;
  key: string | null;
  namePl: string | null;
  nameEn: string | null;
  descriptionPl: string | null;
  descriptionEn: string | null;
  rank: number;
  accentColor: string | null;
  logoSize: SponsorLogoSize;
  benefits: SponsorTierBenefit[];
  sponsors: PublicSponsor[];
}

export interface PublicSponsorMaterial {
  id: string;
  sponsorId: string;
  sponsorName: string;
  sponsorLogoUrl: string | null;
  tierId: string | null;
  tierNamePl: string | null;
  tierNameEn: string | null;
  tierRank: number;
  titlePl: string | null;
  titleEn: string | null;
  kind: SponsorMaterialKind;
  url: string;
  sortOrder: number;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function int(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback;
}

function roleOf(value: unknown): SponsorRole {
  const raw = text(value);
  return raw !== null && (SPONSOR_ROLES as readonly string[]).includes(raw)
    ? (raw as SponsorRole)
    : "sponsor";
}

function logoSizeOf(value: unknown): SponsorLogoSize {
  const raw = text(value);
  return raw !== null && (SPONSOR_LOGO_SIZES as readonly string[]).includes(raw)
    ? (raw as SponsorLogoSize)
    : "md";
}

function materialKindOf(value: unknown): SponsorMaterialKind {
  const raw = text(value);
  return raw !== null && (SPONSOR_MATERIAL_KINDS as readonly string[]).includes(raw)
    ? (raw as SponsorMaterialKind)
    : "link";
}

function parseSponsors(value: Json | null): PublicSponsor[] {
  if (!Array.isArray(value)) return [];
  const out: PublicSponsor[] = [];
  value.forEach((item, index) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return;
    const row = item as Record<string, unknown>;
    const id = text(row.id);
    const name = text(row.name);
    // Bez nazwy nie ma czego pokazać ani czego przeczytać czytnikowi ekranu -
    // samo logo jest obrazkiem bez treści, więc taki wiersz wypada.
    if (id === null || name === null) return;
    out.push({
      id,
      name,
      logoUrl: text(row.logo),
      websiteUrl: text(row.url),
      descriptionPl: text(row.description_pl),
      descriptionEn: text(row.description_en),
      country: text(row.country),
      role: roleOf(row.role),
      boothLabel: text(row.booth_label),
      sortOrder: int(row.sort_order, index),
    });
  });
  return out.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

function parseBenefits(value: Json | null): SponsorTierBenefit[] {
  if (!Array.isArray(value)) return [];
  const out: SponsorTierBenefit[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const id = text(row.id);
    if (id === null) continue;
    out.push({ id, labelPl: text(row.label_pl), labelEn: text(row.label_en) });
  }
  return out;
}

/** Wiersze RPC -> poziomy z listą partnerów. Poziom bez partnerów nie wraca. */
export function parseSponsorTiers(
  rows: readonly EventSponsorTierRow[] | null,
): PublicSponsorTier[] {
  if (rows === null) return [];
  const out: PublicSponsorTier[] = [];
  for (const row of rows) {
    const sponsors = parseSponsors(row.sponsors);
    if (sponsors.length === 0) continue;
    out.push({
      tierId: text(row.tier_id),
      key: text(row.tier_key),
      namePl: text(row.tier_name_pl),
      nameEn: text(row.tier_name_en),
      descriptionPl: text(row.tier_description_pl),
      descriptionEn: text(row.tier_description_en),
      rank: int(row.tier_rank, 0),
      accentColor: text(row.tier_accent_color),
      logoSize: logoSizeOf(row.tier_logo_size),
      benefits: parseBenefits(row.benefits),
      sponsors,
    });
  }
  // Ranga malejąco, grupa bez poziomu na końcu - lustro `ORDER BY` z RPC,
  // domknięte tutaj, żeby widok nie zależał od porządku z sieci.
  return out.sort((a, b) => {
    if (a.tierId === null && b.tierId !== null) return 1;
    if (b.tierId === null && a.tierId !== null) return -1;
    return b.rank - a.rank || (a.key ?? "").localeCompare(b.key ?? "");
  });
}

export function parseSponsorMaterials(
  rows: readonly EventSponsorMaterialRow[] | null,
): PublicSponsorMaterial[] {
  if (rows === null) return [];
  const out: PublicSponsorMaterial[] = [];
  for (const row of rows) {
    const id = text(row.id);
    const url = text(row.url);
    // Materiał bez adresu jest linkiem donikąd - lepiej go nie pokazać, niż
    // dać uczestnikowi przycisk, który nic nie robi.
    if (id === null || url === null) continue;
    out.push({
      id,
      sponsorId: text(row.sponsor_id) ?? "",
      sponsorName: text(row.sponsor_name) ?? "",
      sponsorLogoUrl: text(row.sponsor_logo_url),
      tierId: text(row.tier_id),
      tierNamePl: text(row.tier_name_pl),
      tierNameEn: text(row.tier_name_en),
      tierRank: int(row.tier_rank, 0),
      titlePl: text(row.title_pl),
      titleEn: text(row.title_en),
      kind: materialKindOf(row.kind),
      url,
      sortOrder: int(row.sort_order, 0),
    });
  }
  return out;
}

export interface SponsorMaterialGroup {
  sponsorId: string;
  sponsorName: string;
  sponsorLogoUrl: string | null;
  materials: PublicSponsorMaterial[];
}

/** Materiały pogrupowane po partnerze - inaczej lista jest ścianą linków. */
export function groupSponsorMaterials(
  materials: readonly PublicSponsorMaterial[],
): SponsorMaterialGroup[] {
  const groups = new Map<string, SponsorMaterialGroup>();
  for (const material of materials) {
    const group = groups.get(material.sponsorId);
    if (group === undefined) {
      groups.set(material.sponsorId, {
        sponsorId: material.sponsorId,
        sponsorName: material.sponsorName,
        sponsorLogoUrl: material.sponsorLogoUrl,
        materials: [material],
      });
      continue;
    }
    group.materials.push(material);
  }
  return [...groups.values()];
}

const LOGO_SIZE_CLASS: Record<SponsorLogoSize, string> = {
  sm: "h-10 sm:h-12",
  md: "h-14 sm:h-16",
  lg: "h-20 sm:h-24",
};

/** Wysokość logotypu wg poziomu - jedna mapa zamiast trzech w komponentach. */
export function sponsorLogoClass(size: SponsorLogoSize): string {
  return LOGO_SIZE_CLASS[size];
}

export function sponsorRoleKey(role: SponsorRole): string {
  return `eventFront.sponsors.roles.${role === "media_partner" ? "mediaPartner" : role}`;
}

const MATERIAL_KIND_CAMEL: Record<SponsorMaterialKind, string> = {
  document: "document",
  presentation: "presentation",
  video: "video",
  link: "link",
  logo_pack: "logoPack",
};

export function sponsorMaterialKindKey(kind: SponsorMaterialKind): string {
  return `eventFront.materials.kinds.${MATERIAL_KIND_CAMEL[kind]}`;
}
