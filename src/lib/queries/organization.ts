// Warstwa danych publicznego profilu organizacji (/organization/$slug).
//
// DLACZEGO OSOBNY PLIK, A NIE `archives.ts`. Archiwum taksonomii odpowiada na
// jedno pytanie: „jakie wpisy niesie ten term". Profil organizacji odpowiada na
// trzy różne: kim jest ten byt (term), jaką ma markę (kartoteka CRM) i kto z nim
// pracuje (profile publiczne). Ostatnie dwa nie mają NIC wspólnego z listą
// wpisów - mają inne źródła, inne cykle życia i inne miejsce na ścieżce żądania
// (marka jedzie w loaderze, ludzie dopiero po hydratacji). Wsadzenie ich do
// `archives.ts` zaciągnęłoby kartotekę i profile do chunka każdego archiwum.
// Listę wpisów ta trasa bierze z `archives.ts` bez zmian - `post_categories` to
// ten sam pivot, a wyszukanie termu filtruje wyłącznie po slugu.
//
// DWA BYTY POD JEDNYM ADRESEM - ŚWIADOMIE. Trasa obsługuje dwa różne źródła,
// bo w serwisie istnieją dwa różne pojęcia „organizacji":
//   * TERM TAKSONOMII (`categories` z `kind = 'organization'`): NATO, UE, ONZ -
//     to nimi tagowane są publikacje, więc profil ma sekcję treści;
//   * FIRMA Z KARTOTEKI (`crm_companies`, slug `org-<uuid>`): pracodawca
//     wpisany w profilu osoby i cel @wzmianki firmy - ma logo, branżę i stronę,
//     ale nie ma powiązanych publikacji.
// Rozstrzyga sam slug: prefiks `org-` znaczy kartotekę, wszystko inne - term.
// Rozdzielanie tego na dwie trasy dałoby dwa adresy dla jednego pojęcia
// „strona organizacji" i zmusiłoby wzmiankę do zgadywania, dokąd prowadzi.
//
// Filtr po `kind` przy termie jest ISTOTNY, a nie kosmetyczny: bez niego
// `/organization/gospodarka` otwierałoby profil zwykłej kategorii treści
// i dublowało archiwum pod drugim adresem.
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { CompanyBrand } from "@/lib/mentions/useCompanyBrand";
import { decodeOrganizationMentionSlug } from "@/lib/mentions/mentionTargets";

/** Rozmiar strony listy publikacji na profilu organizacji. Mniejszy niż pełne
 *  archiwum - profil to wizytówka, a nie katalog całego dorobku. */
export const ORGANIZATION_PAGE_SIZE = 12;

/** Twardy limit sekcji osób. Kolumna `profiles.current_company` NIE MA INDEKSU,
 *  więc ten filtr nigdy nie może urosnąć do skanu całej tabeli na potrzeby
 *  jednej sekcji - i nigdy nie stoi na ścieżce TTFB (sekcja hydratuje się po
 *  stronie klienta). */
export const ORGANIZATION_PEOPLE_LIMIT = 12;

/** Term organizacji - dokładnie te kolumny `categories`, które widać na stronie. */
export interface OrganizationTerm {
  id: string;
  slug: string;
  name_pl: string;
  name_en: string;
  description_pl: string | null;
  description_en: string | null;
  logo_url: string | null;
  color: string | null;
}

/** Komplet tożsamości profilu: term + (opcjonalna) marka z kartoteki CRM. */
export interface OrganizationData {
  term: OrganizationTerm;
  /** `null` = kartoteka nie zna tej nazwy. To NIE jest błąd - patrz useCompanyBrand. */
  brand: CompanyBrand | null;
}

/** Osoba przypisana do organizacji przez snapshot `profiles.current_company`. */
export interface OrganizationPerson {
  slug: string;
  name: string;
  avatarUrl: string | null;
  jobTitle: string | null;
  verified: boolean;
}

const TERM_COLS = "id, slug, name_pl, name_en, description_pl, description_en, logo_url, color";

const PEOPLE_COLS =
  "slug, display_name, first_name, last_name, avatar_url, job_title, specialization, verified_at";

function clean(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  return text === "" ? null : text;
}

/** Nazwa organizacji w języku strony, z fallbackiem na drugi wariant. */
export function organizationName(term: OrganizationTerm, lang: "pl" | "en"): string {
  const primary = lang === "en" ? term.name_en : term.name_pl;
  const secondary = lang === "en" ? term.name_pl : term.name_en;
  return clean(primary) ?? clean(secondary) ?? term.slug;
}

/** Opis w języku strony. `null` = element opisu znika w całości. */
export function organizationDescription(term: OrganizationTerm, lang: "pl" | "en"): string | null {
  const primary = lang === "en" ? term.description_en : term.description_pl;
  const secondary = lang === "en" ? term.description_pl : term.description_en;
  return clean(primary) ?? clean(secondary);
}

/**
 * Nazwy, pod którymi ta organizacja może stać w snapshocie `current_company`.
 * Dopasowanie jest ŚCISŁE (`in`), bo kolumna nie ma indeksu, a `ilike` po
 * milionie profili to skan sekwencyjny na każde wejście na stronę. Zwracamy
 * wszystkie znane warianty nazwy: polski, angielski i nazwę z kartoteki CRM
 * (bywa inna niż term - „NATO" kontra „Organizacja Traktatu Północnoatlantyckiego").
 */
export function organizationCompanyNames(
  term: OrganizationTerm,
  brand: CompanyBrand | null,
): string[] {
  const seen = new Set<string>();
  for (const candidate of [term.name_pl, term.name_en, brand?.name ?? null]) {
    const value = clean(candidate);
    if (value !== null) seen.add(value);
  }
  return [...seen];
}

/** Wiersz `profiles_public` -> osoba w siatce. `null` przy wierszu bez sluga. */
export function personFromProfileRow(row: Record<string, unknown>): OrganizationPerson | null {
  const slug = clean(row.slug);
  if (slug === null) return null;
  const name =
    clean(row.display_name) ??
    clean([row.first_name, row.last_name].filter(Boolean).join(" ")) ??
    slug;
  return {
    slug,
    name,
    avatarUrl: clean(row.avatar_url),
    jobTitle: clean(row.job_title) ?? clean(row.specialization),
    verified: typeof row.verified_at === "string" && row.verified_at.length > 0,
  };
}

/**
 * Marka z publicznego RPC `crm_company_brand`. Pytamy kolejno o warianty nazwy,
 * bo kartoteka trzyma JEDNĄ formę, a term ma dwie - wersja angielska profilu
 * ma pokazać to samo logo, co polska. Pierwsze trafienie kończy pętlę, brak
 * trafienia to `null`, a nie błąd (kartoteka nie jest rejestrem organizacji).
 */
async function fetchCompanyBrand(names: readonly string[]): Promise<CompanyBrand | null> {
  for (const name of names) {
    const { data, error } = await supabase.rpc("crm_company_brand", { p_name: name });
    if (error) throw error;
    const row = (data ?? [])[0];
    if (row === undefined) continue;
    return {
      name: clean(row.name) ?? name,
      logoUrl: clean(row.logo_url),
      website: clean(row.website),
      branch: clean(row.branch),
    };
  }
  return null;
}

/**
 * Tożsamość organizacji: term + marka. `null` = takiego termu nie ma (trasa
 * robi z tego 404). Awaria zapytania LECI W GÓRĘ - o tym, czy profil istnieje,
 * decyduje wynik, nigdy fallback; trasa rozróżnia te stany przez `loadResilient`.
 */
export const organizationQueryOptions = (slug: string, lang: "pl" | "en") =>
  queryOptions({
    queryKey: ["public", "organization", slug, lang] as const,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<OrganizationData | null> => {
      // FIRMA Z KARTOTEKI. Slug niesie stabilny identyfikator rekordu, więc
      // pytamy publiczny RPC wzmianek - ten sam, którym rozwiązuje się dymek.
      if (decodeOrganizationMentionSlug(slug) !== null) {
        const { data, error } = await supabase.rpc("get_mention_target", { _slug: slug });
        if (error) throw error;
        const row = (data ?? [])[0];
        if (row === undefined || row.kind !== "organization") return null;
        const name = clean(row.label) ?? slug;
        return {
          term: {
            id: row.id as string,
            slug,
            name_pl: name,
            name_en: name,
            description_pl: null,
            description_en: null,
            logo_url: clean(row.logo_url),
            color: null,
          },
          // Kartoteka oddała już markę w tym samym wierszu - drugie zapytanie
          // o to samo byłoby marnotrawstwem.
          brand: {
            name,
            logoUrl: clean(row.logo_url),
            website: clean(row.website),
            branch: clean(row.subtitle),
          },
        };
      }

      const { data, error } = await supabase
        .from("categories")
        .select(TERM_COLS)
        .eq("kind", "organization")
        .eq("slug", slug)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const term: OrganizationTerm = {
        id: data.id as string,
        slug: data.slug as string,
        name_pl: data.name_pl as string,
        name_en: data.name_en as string,
        description_pl: (data.description_pl as string | null) ?? null,
        description_en: (data.description_en as string | null) ?? null,
        logo_url: (data.logo_url as string | null) ?? null,
        color: (data.color as string | null) ?? null,
      };
      // Kolejność wariantów zależy od języka strony - w EN najpierw pytamy o
      // nazwę angielską, żeby przy dwóch wpisach w kartotece wygrał właściwy.
      const primary = lang === "en" ? term.name_en : term.name_pl;
      const secondary = lang === "en" ? term.name_pl : term.name_en;
      const candidates = organizationCompanyNames(
        { ...term, name_pl: primary, name_en: secondary },
        null,
      );
      // Marka jest DEKORACJĄ tożsamości - jej awaria nie może wywrócić profilu.
      const brand = await fetchCompanyBrand(candidates).catch(() => null);
      return { term, brand };
    },
  });

/**
 * Osoby przypisane do organizacji. ŚWIADOMIE poza loaderem: filtr po
 * nieindeksowanej kolumnie nie ma prawa siedzieć na ścieżce TTFB. Pusta lista
 * nazw wyłącza zapytanie - sekcja znika, zamiast pytać o nic.
 */
export const organizationPeopleQueryOptions = (names: readonly string[]) => {
  const wanted = [...new Set(names.map((n) => n.trim()).filter((n) => n !== ""))].sort();
  return queryOptions({
    queryKey: ["public", "organization-people", wanted] as const,
    enabled: wanted.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<OrganizationPerson[]> => {
      const { data, error } = await supabase
        .from("profiles_public")
        .select(PEOPLE_COLS)
        .in("current_company", wanted)
        .limit(ORGANIZATION_PEOPLE_LIMIT);
      if (error) throw error;
      const rows = data ?? [];
      return rows
        .map(personFromProfileRow)
        .filter((person): person is OrganizationPerson => person !== null);
    },
  });
};
