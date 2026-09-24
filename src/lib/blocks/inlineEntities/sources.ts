// Źródła danych encji inline dla edytora: kartoteka CRM (firmy) i profile
// autorów (osoby). Wyłącznie ODCZYT - wynik jest mapowany na kopię należącą do
// materiału (`InlineEntity`), a zapis w artykule nigdy nie wraca do źródła.
//
// Funkcje RPC (SECURITY DEFINER, tenant z bazy, rola redakcyjna):
//   * `crm_company_inline_lookup`   - migracja 20260924120000,
//   * `editor_inline_author_lookup` - migracja 20260924120100.
// Moduł używany tylko przez panel (edytor bloków) - nie trafia do bundla
// publicznego.

import { supabase } from "@/integrations/supabase/client";
import { getAlpha2Code, getNames } from "@/lib/countries";
import {
  newInlineEntityId,
  normalizeExternalUrl,
  SOCIAL_NETWORKS,
  type InlineCompanyEntity,
  type InlineEntityCountry,
  type InlineEntityImage,
  type InlinePersonEntity,
  type SocialLinks,
} from "./model";

export const INLINE_ENTITY_SEARCH_LIMIT = 8;

export interface CrmCompanyRow {
  id: string;
  name: string | null;
  country: string | null;
  branch: string | null;
  specialization: string | null;
  website: string | null;
  domain: string | null;
  logo_url: string | null;
  social_links: unknown;
}

export interface AuthorRow {
  id: string;
  slug: string | null;
  first_name: string | null;
  last_name: string | null;
  display_name: string | null;
  job_title: string | null;
  company: string | null;
  website_url: string | null;
  linkedin_url: string | null;
  x_url: string | null;
  facebook_url: string | null;
  instagram_url: string | null;
  avatar_url: string | null;
  specialization: string | null;
}

// ---------------------------------------------------------------------------
// Kraj: CRM trzyma nazwę wpisaną ręcznie („Polska", „Poland", „PL")
// ---------------------------------------------------------------------------

/** Rozpoznaje kraj po kodzie ISO albo nazwie PL/EN; `null`, gdy pusto. */
export function resolveCountry(raw: string | null | undefined): InlineEntityCountry | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  const upper = value.toUpperCase();
  const plNames = getNames("pl");
  const enNames = getNames("en");
  const code =
    upper.length === 2 && plNames[upper]
      ? upper
      : (getAlpha2Code(value, "pl") ?? getAlpha2Code(value, "en") ?? "");
  if (code && plNames[code]) {
    return { code, pl: plNames[code], en: enNames[code] ?? plNames[code] };
  }
  return { code: "", pl: value, en: value };
}

/** Lista krajów do podpowiedzi w polu (język interfejsu). */
export function countryNameOptions(lang: "pl" | "en"): string[] {
  return Object.values(getNames(lang)).sort((a, b) => a.localeCompare(b, lang));
}

// ---------------------------------------------------------------------------
// Mapowanie wierszy źródłowych na kopię w materiale
// ---------------------------------------------------------------------------

function clean(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function socialsFrom(value: unknown): SocialLinks {
  const out: SocialLinks = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  const record = value as Record<string, unknown>;
  for (const network of SOCIAL_NETWORKS) {
    const url = normalizeExternalUrl(record[network]);
    if (url) out[network] = url;
  }
  return out;
}

/**
 * Firma z CRM -> encja. Branża i specjalizacja w kartotece są jednojęzyczne,
 * więc trafiają do obu wersji; redakcja może je potem przetłumaczyć w materiale.
 */
/**
 * Pola zachowywane przy odświeżaniu ze źródła: identyfikator (odwołania
 * w treści) i - gdy podany - obraz (własny kadr redakcji). `image: undefined`
 * oznacza „weź obraz ze źródła".
 */
export interface SourceMergeBase {
  id?: string;
  image?: InlineEntityImage | null;
}

function pickImage(base: SourceMergeBase | undefined, sourceUrl: string): InlineEntityImage | null {
  if (base && base.image !== undefined && base.image !== null) return base.image;
  if (sourceUrl) return { src: sourceUrl, original: sourceUrl };
  return base?.image ?? null;
}

export function companyEntityFromCrm(
  row: CrmCompanyRow,
  now: string,
  base?: SourceMergeBase,
): InlineCompanyEntity {
  const industry = clean(row.branch);
  const specialization = clean(row.specialization);
  const logo = normalizeExternalUrl(row.logo_url);
  return {
    id: base?.id ?? newInlineEntityId(),
    kind: "company",
    name: clean(row.name),
    country: resolveCountry(row.country),
    industry: { pl: industry, en: industry },
    specialization: { pl: specialization, en: specialization },
    website: normalizeExternalUrl(row.website || row.domain),
    socials: socialsFrom(row.social_links),
    image: pickImage(base, logo),
    source: { type: "crm", id: row.id, syncedAt: now },
    updatedAt: now,
  };
}

function splitDisplayName(display: string): { firstName: string; lastName: string } {
  const parts = display.split(" ").filter(Boolean);
  if (parts.length <= 1) return { firstName: parts[0] ?? "", lastName: "" };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts[parts.length - 1] };
}

/** Autor -> encja osoby. Profil autora zostaje nietknięty (to tylko odczyt). */
export function personEntityFromAuthor(
  row: AuthorRow,
  now: string,
  base?: SourceMergeBase,
): InlinePersonEntity {
  let firstName = clean(row.first_name);
  let lastName = clean(row.last_name);
  if (!firstName && !lastName)
    ({ firstName, lastName } = splitDisplayName(clean(row.display_name)));
  const position = clean(row.job_title);
  const avatar = normalizeExternalUrl(row.avatar_url);
  return {
    id: base?.id ?? newInlineEntityId(),
    kind: "person",
    firstName,
    lastName,
    position: { pl: position, en: position },
    company: clean(row.company),
    website: normalizeExternalUrl(row.website_url),
    socials: socialsFrom({
      linkedin: row.linkedin_url,
      x: row.x_url,
      facebook: row.facebook_url,
      instagram: row.instagram_url,
    }),
    image: pickImage(base, avatar),
    source: { type: "author", id: row.id, slug: clean(row.slug) || null, syncedAt: now },
    updatedAt: now,
  };
}

/** Etykieta wiersza autora w wynikach wyszukiwania. */
export function authorRowLabel(row: AuthorRow): string {
  return (
    clean(row.display_name) ||
    [clean(row.first_name), clean(row.last_name)].filter(Boolean).join(" ")
  );
}

// ---------------------------------------------------------------------------
// Zapytania (RPC)
// ---------------------------------------------------------------------------

export async function lookupCrmCompanies(
  query: { q?: string; id?: string },
  signal?: AbortSignal,
): Promise<CrmCompanyRow[]> {
  const request = supabase.rpc("crm_company_inline_lookup", {
    p_query: query.q ?? "",
    p_id: query.id,
    p_limit: INLINE_ENTITY_SEARCH_LIMIT,
  });
  const { data, error } = await (signal ? request.abortSignal(signal) : request);
  if (error) throw error;
  return data ?? [];
}

export async function lookupAuthors(
  query: { q?: string; id?: string },
  signal?: AbortSignal,
): Promise<AuthorRow[]> {
  const request = supabase.rpc("editor_inline_author_lookup", {
    p_query: query.q ?? "",
    p_id: query.id,
    p_limit: INLINE_ENTITY_SEARCH_LIMIT,
  });
  const { data, error } = await (signal ? request.abortSignal(signal) : request);
  if (error) throw error;
  return data ?? [];
}
