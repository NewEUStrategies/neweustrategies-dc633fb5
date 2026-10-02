// ODCZYT TREŚCI DLA KOKPITU SEO - jedno źródło dla `/admin/seo/` (kafelki
// kokpitu) i `/admin/seo/content` (tabela).
//
// PO CO WSPÓLNY MODUŁ. Oba ekrany miały własną kopię zapytania: te same klucze
// cache (`["admin-seo-posts", tenantId]`), ale RÓŻNE ciała - tabela sortowała
// wpisy po dacie publikacji, kokpit nie sortował wcale. Przy tym samym kluczu
// wygrywało to zapytanie, które pobiegło pierwsze, więc zawartość cache
// zależała od kolejności wejść na zakładki. Limity (1000 wpisów, 500 stron)
// były skopiowane w czterech miejscach.
//
// LISTA BYWA PRZYCIĘTA - I TERAZ TO WIDAĆ. `.limit()` bez liczności oznaczał,
// że serwis z 1200 wpisami dostawał kafelki policzone z 1000 i żadnej
// wzmianki o brakujących 200. Zapytanie prosi teraz o `count: "exact"` W TYM
// SAMYM żądaniu (PostgREST oddaje liczność w nagłówku `Content-Range` -
// zero dodatkowych podróży do bazy), a `seoContentCoverage` mówi ekranom, czy
// lista jest pełna, przycięta, czy nie da się tego ustalić.
//
// DLACZEGO NIE `head: true` I LICZENIE W SQL. Każdy licznik kokpitu poza
// „łącznie" (bez opisu, domyślna karta, gotowe) wynika z oceny WIERSZA
// (`seoContentStatus`). Policzenie ich w bazie wymagałoby drugiej kopii tej
// reguły w SQL - dokładnie ten rozjazd, przed którym chroni nagłówek
// `admin.seo.index.tsx`. Wiersze są więc potrzebne i tak, a kokpit oraz tabela
// dzielą ten sam wpis cache: przejście z kokpitu do tabeli nie pobiera ich
// drugi raz.
import { supabase } from "@/integrations/supabase/client";
import type { SeoStatusInput } from "@/lib/seo/contentStatus";
import { SEO_FIELDS_SELECT } from "@/lib/seo/fields";

/** Kolumny wiersza treści - te same dla kokpitu i tabeli. */
export const SEO_CONTENT_SELECT = `id, slug, status, title_pl, title_en, excerpt_pl, excerpt_en, cover_image_url, ${SEO_FIELDS_SELECT}`;

/**
 * Górne granice pobrania. Strażnik przed pobraniem całej bazy do przeglądarki,
 * nie zakres raportu - gdy serwis je przekroczy, ekrany mówią to wprost
 * (`seoContentCoverage`).
 */
export const SEO_CONTENT_LIMITS = { posts: 1000, pages: 500 } as const;

export type SeoContentTable = keyof typeof SEO_CONTENT_LIMITS;

/** Wiersz treści w kształcie, w jakim czytają go oba ekrany. */
export interface SeoContentRow extends SeoStatusInput {
  id: string;
  slug: string;
  status: string;
}

/** Pobrany wycinek tabeli + łączna liczba pasujących wierszy w bazie. */
export interface SeoContentPage {
  rows: SeoContentRow[];
  /** `null` = baza nie podała liczności (nieznane - NIE „komplet"). */
  total: number | null;
}

/**
 * Klucz cache. Prefiks `admin-seo-posts` / `admin-seo-pages` jest kontraktem
 * z `src/lib/seo/invalidate.ts` - zapis wpisu unieważnia oba ekrany naraz.
 */
export function seoContentQueryKey(table: SeoContentTable, tenantId: string) {
  return [table === "posts" ? "admin-seo-posts" : "admin-seo-pages", tenantId] as const;
}

/**
 * Jedno żądanie: wiersze w kolejności tabeli + liczność. Kolejność ma
 * znaczenie właśnie przy przycięciu - decyduje, KTÓRE wiersze się zmieściły
 * (najświeższe wpisy, strony w kolejności menu), więc nie może zależeć od tego,
 * który ekran pytał pierwszy.
 */
export async function fetchSeoContentPage(
  table: SeoContentTable,
  tenantId: string,
): Promise<SeoContentPage> {
  if (table === "posts") {
    const { data, error, count } = await supabase
      .from("posts")
      .select(SEO_CONTENT_SELECT, { count: "exact" })
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .order("published_at", { ascending: false, nullsFirst: false })
      .limit(SEO_CONTENT_LIMITS.posts);
    if (error) throw error;
    return { rows: data ?? [], total: typeof count === "number" ? count : null };
  }
  const { data, error, count } = await supabase
    .from("pages")
    .select(SEO_CONTENT_SELECT, { count: "exact" })
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .order("menu_order")
    .limit(SEO_CONTENT_LIMITS.pages);
  if (error) throw error;
  return { rows: data ?? [], total: typeof count === "number" ? count : null };
}

/** Opcje `useQuery` - jedna definicja, więc kokpit i tabela dzielą cache. */
export function seoContentQueryOptions(table: SeoContentTable, tenantId: string) {
  return {
    queryKey: seoContentQueryKey(table, tenantId),
    enabled: !!tenantId,
    queryFn: () => fetchSeoContentPage(table, tenantId),
  };
}

/**
 * Kompletność listy, z której ekran liczy kafelki.
 *
 *   * `complete`  - pobrano wszystko, liczby są pełne;
 *   * `truncated` - baza ma więcej wierszy niż pobrano: liczby dotyczą części;
 *   * `unknown`   - któraś tabela nie podała liczności albo nie dojechała:
 *                   nie wiemy, więc NIE twierdzimy, że lista jest pełna.
 */
export type SeoContentCoverage =
  | { readonly state: "complete"; readonly shown: number; readonly total: number }
  | { readonly state: "truncated"; readonly shown: number; readonly total: number }
  | { readonly state: "unknown"; readonly shown: number; readonly total: null };

export function seoContentCoverage(
  pages: readonly (SeoContentPage | undefined)[],
): SeoContentCoverage {
  let shown = 0;
  let total = 0;
  let unknown = false;
  for (const page of pages) {
    if (!page) {
      unknown = true;
      continue;
    }
    shown += page.rows.length;
    if (page.total === null) {
      unknown = true;
      continue;
    }
    // Liczność mniejsza od liczby pobranych wierszy to wyścig (wiersz dodany
    // między zliczeniem a odczytem) - pobrane wiersze są faktem, więc łącznie
    // nie może być ich mniej.
    total += Math.max(page.total, page.rows.length);
  }
  if (unknown) return { state: "unknown", shown, total: null };
  return { state: total > shown ? "truncated" : "complete", shown, total };
}
