// @vitest-environment node
//
// KONTRAKT ODPORNOŚCI LOADERÓW ARCHIWUM TAKSONOMII (`/category/$slug`,
// `/tag/$slug`).
//
// PO CO TU ŚRODOWISKO `node`. Budżet czasowy `loadResilient` obowiązuje
// WYŁĄCZNIE w renderze serwerowym (`lib/ssr/isSsrRequest.ts`: brak `document`);
// w przeglądarce loader czeka na zapytanie do skutku, bo wynik loadera jest
// niezmienny i degradacja „z zegara" zamarzłaby jako fałszywy komunikat awarii.
// Pod globalnym happy-dom te loadery biegłyby więc ścieżką przeglądarki, a
// przypadek ZWISU KONFIGURACJI wisiałby do limitu testu zamiast dowodzić
// czegokolwiek. Ten plik nie dotyka DOM (loader jako funkcja + atrapy zapytań),
// więc modeluje serwer wprost.
//
// CO NAPRAWIAMY. Do 2026-09-20 oba loadery robiły DWA gołe `ensureQueryData`
// SZEREGOWO i BEZ budżetu (`category.$slug.tsx:50,:53`, `tag.$slug.tsx:43-44`):
//   * blip backendu -> rzut z loadera -> HTTP 500 na archiwum, które w indeksie
//     jest żywe (CDN nie zapisze odpowiedzi, monitor widzi awarię serwisu);
//   * konfiguracja (`archive_layout_settings`) blokowała TREŚĆ, choć jej jedyna
//     rola w kluczu listy to `posts_per_page`, a ten ma domyślkę w kodzie;
//   * `/tag/$slug` nie ustawiał `Cache-Control` W OGÓLE, więc render niepełny
//     brał domyślną politykę treści i mógł zamarznąć na brzegu na 15 minut
//     świeżości plus dobę okna `stale-while-revalidate`.
//
// CO PILNUJEMY DODATKOWO (uwaga P1 z przeglądu PR #382). Trasa ma DWIE
// niezależne degradacje i tylko jedna z nich zabiera czytelnikowi treść:
// `degraded` w ładunku loadera niesie WYŁĄCZNIE odczyt archiwum, bo to na nim
// komponent podmienia całą stronę na `DegradedDataNotice`; degradację samego
// layoutu widać w `layoutDegraded` i w nagłówku. Zlepienie obu flag zamieniałoby
// zimny odczyt `archive_layout_settings` w komunikat „dane niedostępne" na
// archiwum z kompletną listą wpisów.
//
// Testujemy loader jako FUNKCJĘ, bez montowania drzewa (ta sama doktryna co
// `eventShellLoader.test.ts`) - render tych tras ma własny plik
// (`archiveRoutesRender.test.tsx`).
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  /** Wynik odczytu archiwum; `null` = taksonomii nie ma. */
  archive: null as Record<string, unknown> | null,
  /** Rzut z odczytu archiwum - ścieżka degradacji transportu. */
  archiveThrows: false,
  /** Konfiguracja layoutu; `hang` = nigdy się nie rozstrzyga (zwis backendu). */
  layout: null as Record<string, unknown> | null,
  layoutHangs: false,
  /** `pageSize`, z jakim loader zbudował klucz listy - parytet z komponentem. */
  pageSizes: [] as number[],
  /** Nagłówki `Cache-Control`, jakie loader ustawił na odpowiedzi. */
  cacheControl: [] as string[],
  linkHeaders: [] as string[],
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

vi.mock("@/lib/queries/archives", () => ({
  taxonomyArchiveQueryOptions: (
    kind: string,
    slug: string,
    params: { page: number; pageSize: number; sort: string },
  ) => {
    h.pageSizes.push(params.pageSize);
    return {
      queryKey: ["public", "archive", kind, slug, params],
      queryFn: async () => {
        if (h.archiveThrows) throw new Error("baza taksonomii padła");
        return h.archive;
      },
    };
  },
}));

vi.mock("@/lib/archive-layout-settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/archive-layout-settings")>()),
  archiveLayoutQueryOptions: (kind: string) => ({
    queryKey: ["archive-layout-settings", kind],
    queryFn: () =>
      h.layoutHangs ? new Promise(() => {}) : Promise.resolve(h.layout ?? { posts_per_page: 7 }),
  }),
}));

vi.mock("@/lib/http/responseHeaders", () => ({
  setCacheControlHeader: (value: string) => void h.cacheControl.push(value),
  appendLinkHeader: (value: string) => void h.linkHeaders.push(value),
  readRouteCacheDirective: () => null,
}));

// Widok archiwum ciągnie rejestr sześciu layoutów - dla kontraktu LOADERA jest
// martwym kosztem importu.
vi.mock("@/components/archive/TaxonomyPage", () => ({ TaxonomyPage: () => null }));

vi.mock("@/lib/seo/request", () => ({ getRequestUrl: () => "https://nes.eu/category/gospodarka" }));

import { QueryClient } from "@tanstack/react-query";
import { isNotFound } from "@tanstack/react-router";
import { DEFAULT_ARCHIVE_LAYOUT } from "@/lib/archive-layout-settings";
import { chromeDegradedCacheControl, contentCacheControl } from "@/lib/http/cachePolicy";
import { documentStorePolicy } from "@/lib/http/documentCache";
import { Route as CategoryRoute } from "@/routes/category.$slug";
import { Route as TagRoute } from "@/routes/tag.$slug";

const NO_STORE = "private, no-store";

/**
 * Czy NES Edge Cache (`lib/http/documentCache.ts`) zapisze dokument z takim
 * nagłówkiem. Asercja na samym napisie dowodziłaby tylko, że ktoś przepisał
 * stałą; tu pytamy o SKUTEK, czyli o to, po co ta polityka istnieje.
 */
function storedByEdge(header: string | undefined): boolean {
  return documentStorePolicy(200, "text/html", header ?? null).store;
}

interface ArchiveLoaderData {
  readonly taxonomy: { readonly name_pl: string } | null;
  readonly posts: readonly { readonly slug: string }[];
  readonly total: number;
  readonly pageSize: number;
  /** Degradacja TREŚCI - to ona podmienia stronę na komunikat. */
  readonly degraded: boolean;
  /** Degradacja PREZENTACJI - layout z domyślek, treść nietknięta. */
  readonly layoutDegraded: boolean;
}

type Loader = (ctx: {
  context: { queryClient: QueryClient };
  params: { slug: string };
  deps: { page: number; sort: string };
}) => Promise<ArchiveLoaderData>;

function loaderOf(route: unknown): Loader {
  return (route as { options: { loader: Loader } }).options.loader;
}

function runLoader(route: unknown, slug = "gospodarka"): Promise<ArchiveLoaderData> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return loaderOf(route)({
    context: { queryClient },
    params: { slug },
    deps: { page: 1, sort: "newest" },
  });
}

const TAXONOMY = {
  taxonomy: { id: "tax-1", slug: "gospodarka", name_pl: "Gospodarka", name_en: "Economy" },
  // Wpisy są tu PO COŚ: kontrakt „zwis konfiguracji nie kasuje treści" da się
  // udowodnić tylko na niepustej liście. `cover_image_url: null` trzyma
  // `archiveFirstCardPreload` przy `null`, więc fixture nie dokłada nagłówka
  // `Link` do asercji pozostałych przypadków.
  posts: [
    { id: "p1", slug: "pkb-2026", cover_image_url: null },
    { id: "p2", slug: "inflacja-2026", cover_image_url: null },
  ],
  total: 2,
  page: 1,
  pageSize: 7,
  sort: "newest",
};

beforeEach(() => {
  h.archive = TAXONOMY;
  h.archiveThrows = false;
  h.layout = { ...DEFAULT_ARCHIVE_LAYOUT, id: "s1", archive_type: "category", posts_per_page: 7 };
  h.layoutHangs = false;
  h.pageSizes = [];
  h.cacheControl = [];
  h.linkHeaders = [];
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("/category/$slug - odporność loadera", () => {
  it("kanarek środowiska: ten plik modeluje SERWER (brak `document`)", () => {
    // Bez tej asercji przypadki zwisu mogłyby po cichu przejechać ścieżką
    // przeglądarki, gdzie budżet jest wyłączony z definicji - i „zielony"
    // przebieg nie mówiłby nic o kontrakcie SSR.
    expect(typeof document).toBe("undefined");
  });

  it("czysty odczyt zostaje przy polityce treści i nie jest zdegradowany", async () => {
    const data = await runLoader(CategoryRoute);
    expect(data.taxonomy?.name_pl).toBe("Gospodarka");
    expect(data.degraded).toBe(false);
    expect(h.cacheControl).toEqual([contentCacheControl()]);
  });

  it("BLIP ODCZYTU degraduje do 200 `no-store` zamiast rzucać (było HTTP 500)", async () => {
    h.archiveThrows = true;
    const data = await runLoader(CategoryRoute);
    expect(data.degraded).toBe(true);
    expect(data.taxonomy).toBeNull();
    expect(h.cacheControl).toEqual([NO_STORE]);
    // Powłoka bez treści nie ma prawa obsłużyć ANI JEDNEGO kolejnego czytelnika.
    expect(storedByEdge(h.cacheControl[0])).toBe(false);
  });

  it("404 leci WYŁĄCZNIE z czystego odczytu i nie utrwala się na brzegu", async () => {
    h.archive = null;
    let thrown: unknown;
    await runLoader(CategoryRoute, "nie-ma").catch((error: unknown) => void (thrown = error));
    expect(isNotFound(thrown)).toBe(true);
    expect(h.cacheControl).toEqual([NO_STORE]);
  });

  it("zwis KONFIGURACJI nie blokuje TREŚCI - lista rusza z domyślką z kodu", async () => {
    // `posts_per_page` wchodzi do KLUCZA listy, więc layout musi rozstrzygnąć
    // się przed treścią - ale ma na to własne 300 ms, a nie cały budżet trasy.
    // Klucz listy MUSI wtedy nieść domyślkę, bo dokładnie tę wartość policzy
    // `TaxonomyPage` z zasianego fallbacku (rozjazd = drugi fetch po hydratacji).
    h.layoutHangs = true;
    const data = await runLoader(CategoryRoute);
    expect(h.pageSizes).toEqual([DEFAULT_ARCHIVE_LAYOUT.posts_per_page]);
    // SEDNO (uwaga P1 z przeglądu PR #382): flaga `degraded` w ładunku loadera
    // podmienia w komponencie CAŁĄ stronę na `DegradedDataNotice`, więc nie
    // wolno jej zlepiać z degradacją layoutu - zimny odczyt
    // `archive_layout_settings` kasowałby wtedy żywe archiwum z kompletną
    // listą wpisów. Degradacja dotyczy PREZENTACJI i widać ją w `layoutDegraded`
    // oraz w nagłówku.
    expect(data.degraded).toBe(false);
    expect(data.layoutDegraded).toBe(true);
    expect(data.taxonomy?.name_pl).toBe("Gospodarka");
    // TREŚĆ dojeżdża w całości - po to powstał `CATEGORY_LAYOUT_FALLBACK`.
    expect(data.posts.map((post) => post.slug)).toEqual(["pkb-2026", "inflacja-2026"]);
    // Render na domyślkach nie ma prawa zamarznąć na brzegu jako wariant
    // wszystkich czytelników: treść prawdziwa, prezentacja domyślna.
    expect(h.cacheControl).toEqual([NO_STORE]);
  });

  it("czysty odczyt nie melduje degradacji layoutu", async () => {
    // Kontrola negatywna dla przypadku wyżej: gdyby `layoutDegraded` było
    // stale `true`, tamten test przechodziłby bez żadnego zwisu.
    const data = await runLoader(CategoryRoute);
    expect(data.layoutDegraded).toBe(false);
    expect(h.pageSizes).toEqual([7]);
  });
});

describe("/tag/$slug - odporność loadera", () => {
  beforeEach(() => {
    h.layout = { ...DEFAULT_ARCHIVE_LAYOUT, id: "s1", archive_type: "tag", posts_per_page: 7 };
  });

  it("ustawia bramkę nagłówka, której ta trasa nie miała w ogóle", async () => {
    const data = await runLoader(TagRoute, "nato");
    expect(data.degraded).toBe(false);
    expect(h.cacheControl).toEqual([contentCacheControl()]);
  });

  it("blip odczytu daje 200 `no-store`, a nie 500 i nie 404", async () => {
    h.archiveThrows = true;
    const data = await runLoader(TagRoute, "nato");
    expect(data.degraded).toBe(true);
    expect(h.cacheControl).toEqual([NO_STORE]);
  });

  it("zwis KONFIGURACJI zostawia wpisy tagu na ekranie", async () => {
    // Ten sam kontrakt co w kategorii - trasa tagu dzieli z nią `TaxonomyPage`,
    // więc zlepienie flag kosztowałoby tu dokładnie tyle samo: żywe archiwum
    // zamienione w komunikat o niedostępności.
    h.layoutHangs = true;
    const data = await runLoader(TagRoute, "nato");
    expect(h.pageSizes).toEqual([DEFAULT_ARCHIVE_LAYOUT.posts_per_page]);
    expect(data.degraded).toBe(false);
    expect(data.layoutDegraded).toBe(true);
    expect(data.posts.map((post) => post.slug)).toEqual(["pkb-2026", "inflacja-2026"]);
    expect(h.cacheControl).toEqual([NO_STORE]);
  });

  it("brak taksonomii tagu nadal kończy się 404", async () => {
    h.archive = null;
    let thrown: unknown;
    await runLoader(TagRoute, "nie-ma").catch((error: unknown) => void (thrown = error));
    expect(isNotFound(thrown)).toBe(true);
  });
});
