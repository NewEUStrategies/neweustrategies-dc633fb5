// POWŁOKA WYDARZENIA (`/events/$slug`) - DWA POMIARY W JEDNEJ POWŁOCE.
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW:
//
//  * ATRYBUCJA KAMPANII (lejek Google Ads, f3). `AdAttributionCapture` stoi
//    OBOK ciała powłoki, nie w nim - krok „wizyta” i zapis atrybucji mają
//    zadziałać także wtedy, gdy ciało jest zdegradowane (blip backendu).
//    Atom przeniesiony do środka ciała gubiłby wizyty z kampanii dokładnie
//    w chwilach, w których strona ma kłopot - i nikt by tego nie zobaczył.
//  * POMIAR EKSPOZYCJI SPONSORÓW (raport dla sponsora, f6).
//    `SponsorTrackingProvider` obejmuje WYŁĄCZNIE zakładki (`<Outlet />`)
//    wewnątrz powłoki portalu. Zdegradowane ciało nie rysuje kart sponsorów,
//    więc dostawca się nie montuje; dostawca postawiony nad całą trasą
//    liczyłby wyświetlenia komunikatu o awarii.
//  * OBA DOSTAJĄ SLUG TEGO WYDARZENIA. Zły slug to wizyta z kampanii albo
//    wyświetlenie sponsora zaksięgowane na cudzym wydarzeniu.
//
// Oba komponenty mają własne testy (`AdAttributionCapture*.test.tsx`,
// `sponsorTrackingReact.test.tsx`) - tu stoją atrapy zapisujące właściwości,
// a przedmiotem dowodu jest KOMPOZYCJA powłoki.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

const h = vi.hoisted(() => ({
  event: null as Record<string, unknown> | null,
  header: null as Record<string, unknown> | null,
  /** `true` = odczyt wydarzenia pada (blip backendu) - ciało zdegradowane. */
  eventThrows: false,
  atrybucja: [] as (string | undefined)[],
  pomiar: [] as string[],
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

vi.mock("@/lib/community/publicQueries", () => ({
  publicEventBySlugQueryOptions: (slug: string) => ({
    queryKey: ["public-event", slug],
    queryFn: async () => {
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
  siteSettingsQueryOptions: {
    queryKey: ["site_settings_public", "all"],
    queryFn: async () => ({}),
  },
  resolveSetting: () => ({ events_enabled: true }),
}));

vi.mock("@/lib/community/useCommunityModules", () => ({
  useCommunityModules: () => ({ events_enabled: true }),
}));

vi.mock("@/lib/http/responseHeaders", () => ({
  setCacheControlHeader: () => {},
  appendLinkHeader: () => {},
  readRouteCacheDirective: () => null,
}));

vi.mock("@/lib/seo/request", () => ({
  getRequestUrl: () => "https://nes.example.org/events/szczyt",
  getOrigin: () => "https://nes.example.org",
}));

vi.mock("@/components/events/public/organisms/EventPortalShell", () => ({
  EventPortalShell: ({ children }: { children?: ReactNode }) => (
    <div data-testid="powloka-wydarzenia">{children}</div>
  ),
}));
vi.mock("@/components/events/public/organisms/EventTabsNav", () => ({
  EventTabsNav: () => null,
}));

vi.mock("@/components/events/public/atoms/AdAttributionCapture", () => ({
  AdAttributionCapture: ({ eventSlug }: { eventSlug?: string }) => {
    h.atrybucja.push(eventSlug);
    return <span data-testid="atrybucja-kampanii" />;
  },
}));

vi.mock("@/lib/events/sponsorTrackingReact", () => ({
  SponsorTrackingProvider: ({
    eventSlug,
    children,
  }: {
    eventSlug: string;
    children?: ReactNode;
  }) => {
    h.pomiar.push(eventSlug);
    return <div data-testid="pomiar-sponsorow">{children}</div>;
  },
}));

import "@/test/i18nReal";
import { cleanup, screen } from "@testing-library/react";
import i18n from "@/lib/i18n";
import { renderRoute } from "@/test/routeHarness";
import { freezeClock } from "@/test/time";
import { Route as EventShellRoute } from "@/routes/events.$slug";

// Fixture niesie literał daty publikacji - zegar zamrożony (bramka clock-freeze).
freezeClock();

const SLUG = "szczyt";
const NOTICE = "Ta sekcja chwilowo nie ma danych";

async function mount() {
  return renderRoute({
    route: EventShellRoute,
    path: "/events/$slug",
    initialEntry: `/events/${SLUG}`,
  });
}

beforeEach(async () => {
  await i18n.changeLanguage("pl");
  h.event = {
    id: "11111111-1111-4111-8111-111111111111",
    slug: SLUG,
    title_pl: "Szczyt energetyczny 2026",
    title_en: "Energy summit 2026",
    branding: null,
  };
  h.header = {
    slug: SLUG,
    title_pl: "Szczyt energetyczny 2026",
    title_en: "Energy summit 2026",
    description_pl: null,
    description_en: null,
    cover_url: null,
    published_at: "2026-01-01T10:00:00.000Z",
  };
  h.eventThrows = false;
  h.atrybucja = [];
  h.pomiar = [];
  // `loadResilient` loguje każdą degradację - w teście to szum, nie sygnał.
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("pl");
  vi.restoreAllMocks();
});

describe("powłoka /events/$slug - atrybucja kampanii i pomiar sponsorów", () => {
  it("oba pomiary dostają slug TEGO wydarzenia", async () => {
    await mount();

    expect(await screen.findByTestId("pomiar-sponsorow")).toBeInTheDocument();
    expect(screen.getByTestId("atrybucja-kampanii")).toBeInTheDocument();
    expect(new Set(h.atrybucja)).toEqual(new Set([SLUG]));
    expect(new Set(h.pomiar)).toEqual(new Set([SLUG]));
  });

  it("pomiar sponsorów siedzi W powłoce portalu, atrybucja - obok niej", async () => {
    await mount();

    const powloka = await screen.findByTestId("powloka-wydarzenia");
    expect(powloka.contains(screen.getByTestId("pomiar-sponsorow"))).toBe(true);
    expect(powloka.contains(screen.getByTestId("atrybucja-kampanii"))).toBe(false);
  });

  it("zdegradowane ciało: atrybucja NADAL działa, pomiar sponsorów się nie montuje", async () => {
    h.eventThrows = true;
    await mount();

    expect(await screen.findByText(NOTICE)).toBeInTheDocument();
    expect(screen.getByTestId("atrybucja-kampanii")).toBeInTheDocument();
    expect(h.atrybucja).toContain(SLUG);
    expect(screen.queryByTestId("pomiar-sponsorow")).toBeNull();
    expect(h.pomiar).toEqual([]);
  });
});
