// POWŁOKA WYDARZENIA (`/events/$slug`) - RENDER zdegradowany, który LECZY SIĘ SAM.
//
// CO TU BYŁO DO TEJ ZMIANY. Gałąź `degraded` stała NAD odczytem zapytania:
// `EventShell` czytał flagę z `Route.useLoaderData()` i renderował komunikat
// ZAMIAST ciała powłoki. Kosztowało to dwie rzeczy naraz:
//   * ładunek loadera jest NIEZMIENNY przez życie dopasowania trasy, więc
//     komunikat zostawał do kolejnej nawigacji albo przeładowania;
//   * nikt nie był wtedy OBSERWATOREM klucza `public-event` - `refetchOnMount`
//     nie miał czego odpalić, więc zasiew ze stemplem `updatedAt: 0` NIE MIAŁ
//     JAK się wyleczyć nawet wtedy, gdy backend wrócił sekundę później.
// Dlatego komunikat zjechał POD `useSuspenseQuery` (patrz docblock
// `EventShellBody`), a o widoku decyduje stempel zapytania
// (`lib/ssr/useDegradedUntilHealed.ts`).
//
// GRANICE DOWODU. Kontrakt LOADERA (404 wyłącznie z czystego odczytu, nagłówek
// `Cache-Control`, preload okładki) ma własny plik
// `src/routes/__tests__/eventShellLoader.test.ts` - tutaj przedmiotem dowodu
// jest WYŁĄCZNIE to, co widzi czytelnik po zamontowaniu. Mechanizm samego haka
// (parytet hydratacji, kontrola negatywna) dowodzi
// `src/lib/ssr/__tests__/useDegradedUntilHealed.test.tsx`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

const h = vi.hoisted(() => ({
  /** Wiersz wydarzenia spod RLS - `null` = brak dostępu przy istniejącym wydarzeniu. */
  event: null as Record<string, unknown> | null,
  /** Wynik RPC `event_page_header` - `null` = wydarzenia nie ma. */
  header: null as Record<string, unknown> | null,
  /** `true` = odczyt wydarzenia pada (blip backendu). */
  eventThrows: false,
  /**
   * `true` = odczyt wydarzenia pada TYLKO RAZ - blip, który mija. Loader
   * zasiewa wtedy fallback ze stemplem `updatedAt: 0`, a refetch po
   * zamontowaniu dostaje już prawdziwy wiersz.
   */
  eventThrowsOnce: false,
  /** Liczba wywołań odczytu wydarzenia - podstawa pomiaru ponowień. */
  eventReads: 0,
  /** Nagłówki `Cache-Control` ustawione przez loader. */
  cacheControl: [] as string[],
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

vi.mock("@/lib/community/publicQueries", () => ({
  publicEventBySlugQueryOptions: (slug: string) => ({
    queryKey: ["public-event", slug],
    queryFn: async () => {
      h.eventReads += 1;
      if (h.eventThrowsOnce) {
        h.eventThrowsOnce = false;
        throw new Error("test: odczyt wydarzenia chwilowo niedostepny");
      }
      if (h.eventThrows) throw new Error("test: odczyt wydarzenia niedostepny");
      return h.event;
    },
    retry: false,
  }),
  eventPageHeaderQueryOptions: (slug: string, viewer: string) => ({
    queryKey: ["event-page-header", slug, viewer],
    queryFn: async () => h.header,
    retry: false,
  }),
}));

vi.mock("@/lib/useSiteSetting", () => ({
  siteSettingsQueryOptions: { queryKey: ["site_settings_public", "all"], queryFn: async () => ({}) },
  resolveSetting: () => ({ events_enabled: true }),
}));

vi.mock("@/lib/community/useCommunityModules", () => ({
  useCommunityModules: () => ({ events_enabled: true }),
}));

vi.mock("@/lib/http/responseHeaders", () => ({
  setCacheControlHeader: (value: string) => void h.cacheControl.push(value),
  appendLinkHeader: () => {},
  readRouteCacheDirective: () => null,
}));

vi.mock("@/lib/seo/request", () => ({
  getRequestUrl: () => "https://nes.example.org/events/szczyt",
  getOrigin: () => "https://nes.example.org",
}));

// Chrome powłoki ma własną bramkę parytetu z podglądem studia
// (`eventPreviewPublicParity.gate.test.tsx`) - tutaj wystarczy ŚLAD, że ciało
// powłoki w ogóle się zamontowało.
vi.mock("@/components/events/public/organisms/EventPortalShell", () => ({
  EventPortalShell: ({ children }: { children?: ReactNode }) => (
    <div data-testid="powloka-wydarzenia">{children}</div>
  ),
}));
vi.mock("@/components/events/public/organisms/EventTabsNav", () => ({
  EventTabsNav: () => null,
}));

import "@/test/i18nReal";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import i18n from "@/lib/i18n";
import { renderRoute } from "@/test/routeHarness";
import { Route as EventShellRoute } from "@/routes/events.$slug";

const SLUG = "szczyt";
const PATH = "/events/$slug";
const NOTICE = "Ta sekcja chwilowo nie ma danych";
const RETRY = "Spróbuj ponownie";

/** Wiersz wydarzenia w kształcie, którego dotyka ciało powłoki. */
function event(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    slug: SLUG,
    title_pl: "Szczyt energetyczny 2026",
    title_en: "Energy summit 2026",
    branding: null,
    ...patch,
  };
}

/** Wiersz nagłówka definerowego - jego OBECNOŚĆ znaczy „wydarzenie istnieje". */
function header(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    slug: SLUG,
    title_pl: "Szczyt energetyczny 2026",
    title_en: "Energy summit 2026",
    description_pl: null,
    description_en: null,
    cover_url: null,
    published_at: "2026-01-01T10:00:00.000Z",
    ...patch,
  };
}

async function mount() {
  return renderRoute({ route: EventShellRoute, path: PATH, initialEntry: `/events/${SLUG}` });
}

beforeEach(async () => {
  await i18n.changeLanguage("pl");
  h.event = event();
  h.header = header();
  h.eventThrows = false;
  h.eventThrowsOnce = false;
  h.eventReads = 0;
  h.cacheControl = [];
  // `loadResilient` loguje każdą degradację - w teście to szum, nie sygnał.
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("pl");
  vi.restoreAllMocks();
});

describe("powłoka /events/$slug - degradacja leczy się sama", () => {
  it("KONTROLA DODATNIA: czysty render montuje powłokę i NIE pokazuje komunikatu", async () => {
    await mount();

    expect(screen.getByTestId("powloka-wydarzenia")).toBeInTheDocument();
    expect(screen.queryByText(NOTICE)).toBeNull();
  });

  it("SSR zdegradowany + UDANY refetch: komunikat znika, powłoka się montuje", async () => {
    h.eventThrowsOnce = true;
    const view = await mount();

    // PARYTET Z SSR: pierwszy render niesie jeszcze komunikat - ten sam, który
    // wyszedł z serwera. Przełączenie jest PÓŹNIEJSZE, nie w tym renderze.
    expect(view.getByText(NOTICE)).toBeInTheDocument();

    expect(await screen.findByTestId("powloka-wydarzenia")).toBeInTheDocument();
    expect(screen.queryByText(NOTICE)).toBeNull();
  });

  it("DOWÓD OBSERWATORA: zdegradowana powłoka W OGÓLE pyta backend po zamontowaniu", async () => {
    // Dopóki komunikat stał NAD `useSuspenseQuery`, nikt nie subskrybował tego
    // klucza i licznik zatrzymywał się na odczycie loadera. Bez tej asercji
    // test wyżej przechodziłby też dla wersji, która leczy się przypadkiem.
    h.eventThrows = true;
    await mount();

    expect(await screen.findByText(NOTICE)).toBeInTheDocument();
    expect(h.eventReads).toBeGreaterThan(1);
  });

  it("refetch PADA znowu: komunikat zostaje razem z ponowieniem", async () => {
    h.eventThrows = true;
    await mount();

    expect(await screen.findByText(NOTICE)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: RETRY })).toBeInTheDocument();
    expect(screen.queryByTestId("powloka-wydarzenia")).toBeNull();
  });

  it("ponowienie pyta backend JESZCZE RAZ i leczy powłokę bez nawigacji", async () => {
    h.eventThrows = true;
    await mount();
    const button = await screen.findByRole("button", { name: RETRY });

    h.eventThrows = false;
    fireEvent.click(button);

    expect(await screen.findByTestId("powloka-wydarzenia")).toBeInTheDocument();
    expect(screen.queryByText(NOTICE)).toBeNull();
  });

  it("zdegradowany render NIE udaje 404 ani zaproszenia do planów", async () => {
    // Dwa kłamstwa, które ten ekran zastępuje: „nie ma takiego wydarzenia"
    // (wypisuje adres z indeksu) i „nie masz dostępu" (odsyła uprawnionego
    // czytelnika do cennika). Oba wyglądają jak fakt, a są niewiedzą.
    h.eventThrows = true;
    await mount();

    expect(await screen.findByText(NOTICE)).toBeInTheDocument();
    expect(screen.queryByText(/nie masz dostępu|Przejdź na wyższy/i)).toBeNull();
    expect(h.cacheControl.at(-1)).toBe("private, no-store");
  });
});
