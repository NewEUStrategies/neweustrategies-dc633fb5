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
  appendLinkHeader: () => {},
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
}

type LoaderCtx = {
  context: { queryClient: QueryClient };
  params: { slug: string };
};
type Loader = (ctx: LoaderCtx) => Promise<ShellLoaderData>;

function runLoader(slug = "szczyt"): Promise<ShellLoaderData> {
  const loader = (EventShellRoute as unknown as { options: { loader: Loader } }).options.loader;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return loader({ context: { queryClient }, params: { slug } });
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
    expect(data).toEqual({ headEvent: null, degraded: false });
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
    const out = head({ headEvent, degraded: false });
    // Do 2026-09-01 tu stało "Wydarzenie - New European Strategies" dla KAŻDEGO
    // wydarzenia w serwisie - jeden tytuł, jeden opis, jeden obraz karty.
    expect(titleOf(out)).toContain("Szczyt strategiczny");
    expect(metaByProperty(out, "og:title")).toBe("Szczyt strategiczny");
    expect(metaByProperty(out, "og:description")).toBe("Opis po polsku.");
    expect(metaByProperty(out, "og:image")).toBe("https://cdn.nes.eu/szczyt.jpg");
  });

  it("bez danych loadera wraca do dwujęzycznej wartości domyślnej, nie do pustki", async () => {
    const out = head({ headEvent: null, degraded: true });
    expect(titleOf(out)).toContain("Wydarzenie");
    expect(metaByProperty(out, "og:description")).not.toBe("");
  });
});
