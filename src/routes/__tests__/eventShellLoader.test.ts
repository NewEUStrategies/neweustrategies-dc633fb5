// KONTRAKT LOADERA POWŁOKI WYDARZENIA (`/events/$slug`).
//
// CO NAPRAWIAMY I CZEGO TEN PLIK PILNUJE
//
// Do 2026-09-01 ta trasa NIE MIAŁA loadera. `useQuery` nie startuje na serwerze
// fetcha, więc SSR-owy HTML CAŁEGO modułu (powłoka + siedem podstron) nie
// zawierał ani wydarzenia, ani `<Outlet />`, ani węzła `schema.org/Event` -
// a `head()` był zahardkodowany, więc KAŻDE wydarzenie serwisu dzieliło jeden
// tytuł, jeden opis i jeden obraz społecznościowy. Ten HTML wchodził potem do
// NES Edge Cache na 24 h.
//
// NAJWAŻNIEJSZA ASERCJA JEST BEZPIECZEŃSTWOWA, nie wydajnościowa: `notFound()`
// wolno oprzeć WYŁĄCZNIE na `event_page_header`, bo to funkcja SECURITY DEFINER
// - oddaje wiersz każdemu, kto zna slug opublikowanego wydarzenia tego najemcy,
// a bramkę warstwy tylko etykietuje. Pusty wynik znaczy tam „wydarzenia nie ma".
// Oparcie 404 na `fetchPublicEventBySlug` (pod RLS) zamieniłoby KAŻDE
// wydarzenie `visibility='members'` w twarde 404 dla uprawnionego czytelnika,
// bo odczyt serwerowy jest zawsze anonimowy. Test poniżej ustawia dokładnie ten
// układ: nagłówek JEST, wiersz pod RLS jest `null` - i wymaga strony 200.
//
// Testujemy loader jako funkcję, bez montowania drzewa - ten sam kod, który
// wykona framework, tylko bez kosztu całego drzewa (ta sama doktryna co
// `archiveRoutes.test.ts`).
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  /** Wynik RPC `event_page_header` - `null` = wydarzenia nie ma. */
  header: null as Record<string, unknown> | null,
  /** Wynik odczytu pod RLS - `null` = brak dostępu przy ISTNIEJĄCYM wydarzeniu. */
  event: null as Record<string, unknown> | null,
  /** Rzut z RPC nagłówka - ścieżka degradacji transportu. */
  headerThrows: false,
  eventThrows: false,
  eventsEnabled: true,
  /** Nagłówek `Cache-Control`, jaki loader ustawił na odpowiedzi. */
  cacheControl: [] as string[],
  /** Wartości nagłówka HTTP `Link` - dowód, że preload LCP wyszedł na drut. */
  linkHeaders: [] as string[],
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

vi.mock("@/lib/community/publicQueries", () => ({
  publicEventBySlugQueryOptions: (slug: string) => ({
    queryKey: ["public-event", slug],
    queryFn: async () => {
      if (h.eventThrows) throw new Error("events padło");
      return h.event;
    },
  }),
  eventPageHeaderQueryOptions: (slug: string, viewer: string) => ({
    queryKey: ["event-page-header", slug, viewer],
    queryFn: async () => {
      if (h.headerThrows) throw new Error("event_page_header padło");
      return h.header;
    },
  }),
}));

vi.mock("@/lib/useSiteSetting", () => ({
  siteSettingsQueryOptions: {
    queryKey: ["site_settings_public", "all"],
    queryFn: async () => ({}),
  },
  resolveSetting: () => ({ events_enabled: h.eventsEnabled }),
}));

vi.mock("@/lib/http/responseHeaders", () => ({
  setCacheControlHeader: (value: string) => void h.cacheControl.push(value),
  appendLinkHeader: (value: string) => void h.linkHeaders.push(value),
  readRouteCacheDirective: () => null,
}));

vi.mock("@/lib/seo/request", () => ({ getRequestUrl: () => "https://nes.eu/events/szczyt" }));

import { QueryClient } from "@tanstack/react-query";
import { Route as EventShellRoute } from "@/routes/events.$slug";

interface ShellLoaderData {
  readonly headEvent: {
    readonly slug: string;
    readonly titlePl: string;
    readonly titleEn: string;
    readonly descriptionPl: string | null;
    readonly descriptionEn: string | null;
    readonly cover: string | null;
    readonly publishedAt: string | null;
  } | null;
  readonly degraded: boolean;
  readonly coverPreload: { readonly href: string } | null;
}

type LoaderCtx = {
  context: { queryClient: QueryClient };
  params: { slug: string };
  location: { pathname: string };
};
type Loader = (ctx: LoaderCtx) => Promise<ShellLoaderData>;

function runLoader(slug = "szczyt", pathname?: string): Promise<ShellLoaderData> {
  return runLoaderWithClient(slug, pathname).then(({ data }) => data);
}

/**
 * Ten sam przebieg, ale oddaje też KLIENT ZAPYTAŃ - bo część kontraktu tego
 * loadera nie jest widoczna w jego wartości zwrotnej, tylko w STEMPLU CZASU
 * wpisu cache'a (patrz przypadki o wpisie anonimowym niżej).
 */
async function runLoaderWithClient(
  slug = "szczyt",
  // Domyślnie PRZEGLĄD wydarzenia - to jedyna zakładka, która maluje okładkę,
  // więc tylko na niej loader dokłada deskryptor preloadu LCP.
  pathname = `/events/${slug}`,
): Promise<{ data: ShellLoaderData; queryClient: QueryClient }> {
  const loader = (EventShellRoute as unknown as { options: { loader: Loader } }).options.loader;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const data = await loader({
    context: { queryClient },
    params: { slug },
    location: { pathname },
  });
  return { data, queryClient };
}

/** Stempel czasu wpisu `["public-event", slug]` - `null`, gdy wpisu nie ma. */
function eventEntryUpdatedAt(queryClient: QueryClient, slug = "szczyt"): number | null {
  const state = queryClient.getQueryState<unknown>(["public-event", slug]);
  return state ? state.dataUpdatedAt : null;
}

const HEADER_ROW = {
  id: "e1",
  slug: "szczyt",
  title_pl: "Szczyt strategiczny",
  title_en: "Strategic summit",
  description_pl: "Opis po polsku.",
  description_en: null,
  cover_url: "https://cdn.nes.eu/szczyt.jpg",
  published_at: "2026-08-01T10:00:00Z",
};

beforeEach(() => {
  h.header = null;
  h.event = null;
  h.headerThrows = false;
  h.eventThrows = false;
  h.eventsEnabled = true;
  h.cacheControl = [];
  h.linkHeaders = [];
});

describe("loader powłoki /events/$slug", () => {
  it("rzuca notFound(), gdy CZYSTY odczyt nagłówka definerowego jest pusty", async () => {
    await expect(runLoader()).rejects.toBeTruthy();
  });

  it("NIE rzuca 404, gdy nagłówek istnieje, a RLS ucięło wiersz - to bramka warstwy", async () => {
    // Ten przypadek jest sednem: wydarzenie `members` widziane anonimowo.
    // 404 tutaj wyrzuciłoby żywe wydarzenie z indeksu i odcięło uprawnionego
    // czytelnika po przeładowaniu strony.
    h.header = HEADER_ROW;
    h.event = null;
    const data = await runLoader();
    expect(data.degraded).toBe(false);
    expect(data.headEvent?.slug).toBe("szczyt");
  });

  // ── WPIS ANONIMOWY NIE MOŻE ZOSTAĆ WYDANY ZALOGOWANEMU JAKO ŚWIEŻY ────────
  //
  // Defekt zgłoszony w recenzji PR #314 (P1) i potwierdzony sondą na
  // query-core: klucz `["public-event", slug]` NIE niesie widza, a `staleTime`
  // to 60 s. Odczyt serwerowy jest anonimowy, więc dla wydarzenia za bramką
  // warstwy dehydratuje się `null` ze stemplem czasu serwera - i uprawniony
  // członek po odtworzeniu sesji czyta ten `null`, dostając zaproszenie do
  // planów PRZED `<Outlet />`, czyli tracąc wszystkie zakładki naraz. Nic tego
  // nie unieważnia: `reauthorizeContent` tego klucza nie obejmuje, a przy
  // przeładowaniu leci `INITIAL_SESSION`, dla którego jest ono pomijane.
  // ZMIERZONE: dokument w wieku 5 s i 59 s -> zero refetchów, dane zostają
  // `null` NA ZAWSZE.
  //
  // Te trzy przypadki pilnują naprawy po STEMPLU, a nie po wartości - bo
  // wartość (`null`) jest w obu wariantach identyczna i test na niej
  // przechodziłby przed naprawą i po niej.
  it("wpis anonimowy dla wydarzenia ZA BRAMKĄ rodzi się PRZETERMINOWANY", async () => {
    h.header = HEADER_ROW;
    h.event = null;
    const { queryClient } = await runLoaderWithClient();
    expect(
      eventEntryUpdatedAt(queryClient),
      "bez `updatedAt: 0` uprawniony członek czyta anonimowy null przez 60 s",
    ).toBe(0);
  });

  it("wydarzenie PUBLICZNE zachowuje normalny stempel - ścieżka szczęśliwa nic nie płaci", async () => {
    h.header = HEADER_ROW;
    h.event = { id: "e1", slug: "szczyt" };
    const { queryClient } = await runLoaderWithClient();
    const stamp = eventEntryUpdatedAt(queryClient);
    expect(stamp).not.toBeNull();
    expect(
      stamp,
      "przeterminowanie ścieżki szczęśliwej kosztowałoby refetch na każdym wejściu",
    ).toBeGreaterThan(0);
  });

  it("przy DEGRADACJI transportu wpis też jest przeterminowany - ale robi to `loadResilient`", async () => {
    // TEN PRZYPADEK NAPISAŁEM NAJPIERW ŹLE i zostawiam ślad, bo pomyłka jest
    // pouczająca. Zakładałem, że gałąź degradacji stempla nie rusza, więc
    // asercja brzmiała `not.toBe(0)`. Pomiar pokazał `0`: `loadResilient`
    // ZASIEWA swój fallback z `{ updatedAt: 0 }` (`lib/ssr/resilientLoad.ts`),
    // więc wpis rodzi się przeterminowany niezależnie od nowej gałęzi wyżej.
    //
    // Wniosek jest mocniejszy niż moja pierwotna teza: obie ścieżki „nie wiem"
    // - brak dostępu i awaria transportu - kończą się wpisem, który klient
    // dociągnie po hydratacji, tylko robią to DWA różne mechanizmy. Ten test
    // pilnuje, żeby wypadnięcie któregokolwiek z nich było widoczne.
    h.header = HEADER_ROW;
    h.eventThrows = true;
    const { data, queryClient } = await runLoaderWithClient();
    expect(data.degraded).toBe(true);
    expect(eventEntryUpdatedAt(queryClient)).toBe(0);
  });

  it("NIE rzuca 404 przy degradacji transportu - 404 z niewiedzy jest gorsze", async () => {
    h.headerThrows = true;
    const data = await runLoader();
    expect(data.degraded).toBe(true);
    expect(h.cacheControl.at(-1)).toBe("private, no-store");
  });

  it("czysty render deklaruje politykę treści, nie no-store", async () => {
    h.header = HEADER_ROW;
    h.event = { id: "e1", slug: "szczyt" };
    const data = await runLoader();
    expect(data.degraded).toBe(false);
    expect(h.cacheControl.at(-1)).toContain("s-maxage=900");
  });

  it("wyłączony moduł nie grzeje ani nagłówka, ani wydarzenia", async () => {
    h.eventsEnabled = false;
    h.headerThrows = true;
    h.eventThrows = true;
    const data = await runLoader();
    expect(data).toEqual({ headEvent: null, degraded: false, coverPreload: null });
    expect(h.cacheControl).toEqual([]);
  });

  it("projekcja nagłówka niesie oba języki, okładkę i datę publikacji", async () => {
    h.header = HEADER_ROW;
    h.event = { id: "e1", slug: "szczyt" };
    const { headEvent } = await runLoader();
    expect(headEvent).toEqual({
      slug: "szczyt",
      titlePl: "Szczyt strategiczny",
      titleEn: "Strategic summit",
      descriptionPl: "Opis po polsku.",
      descriptionEn: null,
      cover: "https://cdn.nes.eu/szczyt.jpg",
      publishedAt: "2026-08-01T10:00:00Z",
    });
  });
});

type HeadFn = (ctx: { params: { slug: string }; loaderData?: ShellLoaderData }) => {
  meta?: { title?: string; name?: string; property?: string; content?: string }[];
};

function head(loaderData?: ShellLoaderData) {
  const fn = (EventShellRoute as unknown as { options: { head: HeadFn } }).options.head;
  return fn({ params: { slug: "szczyt" }, loaderData });
}

function titleOf(out: ReturnType<HeadFn>): string {
  return out.meta?.find((m) => typeof m.title === "string")?.title ?? "";
}

function metaByProperty(out: ReturnType<HeadFn>, property: string): string {
  return out.meta?.find((m) => m.property === property)?.content ?? "";
}

describe("head() powłoki /events/$slug", () => {
  const headEvent = {
    slug: "szczyt",
    titlePl: "Szczyt strategiczny",
    titleEn: "Strategic summit",
    descriptionPl: "Opis po polsku.",
    descriptionEn: null,
    cover: "https://cdn.nes.eu/szczyt.jpg",
    publishedAt: "2026-08-01T10:00:00Z",
  } as const;

  it("bierze tytuł, opis i obraz Z WYDARZENIA, nie ze stałej", async () => {
    const out = head({ headEvent, degraded: false, coverPreload: null });
    // Do 2026-09-01 tu stało "Wydarzenie - New European Strategies" dla KAŻDEGO
    // wydarzenia w serwisie - jeden tytuł, jeden opis, jeden obraz karty.
    expect(titleOf(out)).toContain("Szczyt strategiczny");
    expect(metaByProperty(out, "og:title")).toBe("Szczyt strategiczny");
    expect(metaByProperty(out, "og:description")).toBe("Opis po polsku.");
    expect(metaByProperty(out, "og:image")).toBe("https://cdn.nes.eu/szczyt.jpg");
  });

  it("bez danych loadera wraca do dwujęzycznej wartości domyślnej, nie do pustki", async () => {
    const out = head({ headEvent: null, degraded: true, coverPreload: null });
    expect(titleOf(out)).toContain("Wydarzenie");
    expect(metaByProperty(out, "og:description")).not.toBe("");
  });
});

// ── PRELOAD LCP OKŁADKI WYDARZENIA ───────────────────────────────────────────
//
// Baner wydarzenia jest największym obrazem nad zgięciem przeglądu, więc jego
// fetch ma ruszyć z nagłówków odpowiedzi, a nie dopiero z `<img>` w body.
// Każdy z trzech warunków odcina POBRANIE, którego nikt nie namaluje - preload
// obrazu, który nie wchodzi do układu, to czysty koszt pasma konkurujący
// z zasobami krytycznymi.
describe("preload okładki przeglądu wydarzenia", () => {
  const PUBLIC_EVENT = {
    id: "e1",
    slug: "szczyt",
    cover_url: "https://cdn.nes.eu/szczyt.jpg",
    video_header_platform: null,
    video_header_id: null,
  };

  it("PRZEGLĄD bez nagłówka wideo: deskryptor i nagłówek HTTP `Link`", async () => {
    h.header = HEADER_ROW;
    h.event = PUBLIC_EVENT;
    const data = await runLoader();
    // PARYTET: komponent maluje `<img src>` BEZ `srcSet`, więc deskryptor
    // niesie sam `href` - inaczej przeglądarka pobrałaby dwa różne warianty.
    expect(data.coverPreload).toEqual({ href: "https://cdn.nes.eu/szczyt.jpg" });
    expect(h.linkHeaders).toHaveLength(1);
    expect(h.linkHeaders[0]).toContain("<https://cdn.nes.eu/szczyt.jpg>");
    expect(h.linkHeaders[0]).toContain("fetchpriority=high");
    expect(h.linkHeaders[0]).not.toContain("imagesrcset");
  });

  it("ZAKŁADKA (np. /agenda) nie preloaduje - okładki tam nie ma", async () => {
    h.header = HEADER_ROW;
    h.event = PUBLIC_EVENT;
    const data = await runLoader("szczyt", "/events/szczyt/agenda");
    expect(data.coverPreload).toBeNull();
    expect(h.linkHeaders).toEqual([]);
  });

  it("prefiks języka NIE psuje rozpoznania przeglądu", async () => {
    h.header = HEADER_ROW;
    h.event = PUBLIC_EVENT;
    const data = await runLoader("szczyt", "/en/events/szczyt");
    expect(data.coverPreload).toEqual({ href: "https://cdn.nes.eu/szczyt.jpg" });
  });

  it("NAGŁÓWEK WIDEO zastępuje okładkę, więc preloadu nie ma", async () => {
    h.header = HEADER_ROW;
    h.event = { ...PUBLIC_EVENT, video_header_platform: "youtube", video_header_id: "abc123" };
    const data = await runLoader();
    expect(data.coverPreload).toBeNull();
  });

  it("BŁĘDNY identyfikator wideo wraca do okładki - i do preloadu", async () => {
    // `videoEmbedUrl` odrzuca identyfikator spoza alfabetu, a komponent maluje
    // wtedy okładkę. Decyzja jest JEDNA i wspólna, więc preload jedzie za nią.
    h.header = HEADER_ROW;
    h.event = { ...PUBLIC_EVENT, video_header_platform: "youtube", video_header_id: "a b/c" };
    const data = await runLoader();
    expect(data.coverPreload).toEqual({ href: "https://cdn.nes.eu/szczyt.jpg" });
  });

  it("WYDARZENIE ZA BRAMKĄ WARSTWY: body rysuje zaproszenie, nie baner", async () => {
    h.header = HEADER_ROW;
    h.event = null;
    const data = await runLoader();
    expect(data.coverPreload).toBeNull();
    expect(h.linkHeaders).toEqual([]);
  });

  it("wydarzenie bez okładki nie generuje pustego preloadu", async () => {
    h.header = HEADER_ROW;
    h.event = { ...PUBLIC_EVENT, cover_url: "   " };
    const data = await runLoader();
    expect(data.coverPreload).toBeNull();
  });
});
