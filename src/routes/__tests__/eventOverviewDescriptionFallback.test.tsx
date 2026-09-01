// `/events/$slug` (przegląd) - OPIS WYDARZENIA MA FALLBACK JĘZYKA.
//
// CO TEN PLIK DOWODZI
//
// Stało w trasie `lang === "en" ? ev.description_en : ev.description_pl` - bez
// drugiego członu, w przeciwieństwie do tytułu w linii WYŻEJ, który fallback
// miał. Skutek był cichy i asymetryczny: każde wydarzenie opisane tylko po
// polsku (a tak powstaje każde, bo panel nie wymaga wersji angielskiej) miało
// dla czytelnika z interfejsem EN opis NIEWIDOCZNY - blok `prose` nie
// renderował się wcale, bo trasa sprawdza `desc ? … : null`. Na ekranie
// zostawał polski tytuł (ten fallback miał) nad pustką.
//
// TEST MIERZY ZACHOWANIE, NIE KSZTAŁT KODU. Montuje PRAWDZIWĄ trasę pliku
// w routerze pamięciowym, ustawia interfejs na EN, oddaje z warstwy zapytań
// wiersz z `description_en: null` i sprawdza, że czytelnik WIDZI polski tekst.
// Nie ma tu ani jednej asercji o tym, jakim wyrażeniem fallback jest napisany -
// zamiana `a || b` na `pickLocalized` (albo odwrotnie) tego testu nie rusza,
// a usunięcie fallbacku czerwieni go natychmiast.
//
// DRUGI BOK, bez którego pierwszy nie znaczy nic: przy interfejsie EN i OBU
// wersjach wpisanych czytelnik dostaje ANGIELSKĄ. Bez tej asercji „naprawa"
// mogłaby polegać na twardym wybraniu polszczyzny dla wszystkich.
//
// CZEGO TEN PLIK NIE SPRAWDZA
//   * nie sprawdza układu trójkolumnowego ani parytetu z podglądem studia -
//     to `eventPreviewPublicParity.gate.test.tsx`;
//   * nie sprawdza zapisów, RSVP, biletów ani bramek warstwy - trasa niesie
//     ich sześć i każda ma własny zakres; tutaj wszystkie są atrapami
//     oddającymi NAJUBOŻSZĄ prawdziwą odpowiedź;
//   * nie sprawdza węzła `schema.org/Event`. Ten sam `desc` jedzie do
//     `publicEventJsonLd`, ale kontrakt JSON-LD ma własne testy
//     (`lib/seo/__tests__/eventsJsonld.test.ts`);
//   * nie sprawdza słownika - `t` jest funkcją tożsamościową na kluczu, bo
//     przedmiotem dowodu jest tekst Z BAZY, a nie napis interfejsu.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";

/** Język interfejsu przestawiany per przypadek - trasa czyta `i18n.language`. */
const h = vi.hoisted(() => ({ lang: "en" }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: h.lang, exists: () => true, changeLanguage: () => Promise.resolve() },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: null }) }));

// Klient bazy wymaga zmiennych środowiska przy imporcie, a w tym teście nie
// leci ani jedno zapytanie - wszystko idzie z atrap warstwy zapytań.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

// Atrapa CZĄSTKOWA: `@tanstack/react-start` niesie także `createIsomorphicFn`,
// z którego żyje runtime języka. Podmieniamy sam `useServerFn`.
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: () => vi.fn(),
}));

vi.mock("@/lib/events/rsvp-email.functions", () => ({ confirmFreeRsvpEmail: vi.fn() }));
vi.mock("@/lib/community/useCommunityModules", () => ({
  useCommunityModules: () => ({ events_enabled: true }),
}));
vi.mock("@/hooks/useEventSeatsRealtime", () => ({
  useEventSeatsRealtime: () => ({ seats: null }),
}));
vi.mock("@/lib/billing/tiers", () => ({
  useMembershipTiers: () => ({ data: [] }),
  useCurrentTier: () => ({ data: null }),
  tierName: () => "",
  tierHasFeature: () => false,
}));

// SEKCJA `description` MUSI BYĆ OTWARTA, bo trasa rysuje opis tylko wtedy:
// przy `isLocked` w jej miejscu staje karta zaproszenia, a przy braku wiersza
// sekcji - nic. Bez tej atrapy test mierzyłby zamek, a nie fallback języka.
vi.mock("@/lib/events/publicEventApi", () => ({
  fetchEventAgenda: vi.fn(async () => []),
  fetchEventMenu: vi.fn(async () => []),
  fetchEventSections: vi.fn(async () => [
    {
      key: "description",
      sortOrder: 10,
      headingPl: null,
      headingEn: null,
      visibility: "public",
      minTierRank: 0,
      isLocked: false,
      lockReason: "none",
      hasContent: true,
    },
  ]),
  fetchEventSponsors: vi.fn(async () => []),
  fetchEventSponsorMaterials: vi.fn(async () => []),
  fetchMyBookmarks: vi.fn(async () => []),
  fetchSessionAccess: vi.fn(async () => null),
  submitSessionSignup: vi.fn(),
  toggleEventBookmark: vi.fn(),
}));

/** Nadpisania wiersza wydarzenia, ustawiane per przypadek. */
const row = vi.hoisted(() => ({
  overrides: {} as Record<string, unknown>,
}));

vi.mock("@/lib/community/publicQueries", async () => {
  const { publicEventRow } = await import("@/test/events/publicEventRow");
  const fetchPublicEventBySlug = vi.fn(async () => publicEventRow(row.overrides));
  const fetchEventPageHeader = vi.fn(async () => null);
  return {
    fetchPublicEventBySlug,
    fetchEventPageHeader,
    // Fabryki queryOptions - trasa czyta je od 2026-09-01 zamiast składać klucz
    // literałem, bo ten sam klucz grzeje teraz loader powłoki. Atrapa oddaje
    // DOKŁADNIE te klucze, których używa produkcja, żeby test nie przechodził
    // dzięki rozjechanemu kluczowi.
    publicEventBySlugQueryOptions: (slug: string) => ({
      queryKey: ["public-event", slug],
      queryFn: fetchPublicEventBySlug,
    }),
    eventPageHeaderQueryOptions: (slug: string, viewer: string) => ({
      queryKey: ["event-page-header", slug, viewer],
      queryFn: fetchEventPageHeader,
    }),
    fetchEventAccess: vi.fn(async () => null),
    fetchEventRsvpCounts: vi.fn(async () => new Map()),
    fetchEventWaitlistPosition: vi.fn(async () => null),
    rsvpEvent: vi.fn(),
  };
});

// Powierzchnie z własnymi zapytaniami i własnym zakresem. Do dowodu o opisie
// nie wnoszą nic, a wnoszą pół tuzina zapytań.
vi.mock("@/components/network/EventGroupButton", () => ({ EventGroupButton: () => null }));
vi.mock("@/components/events/EventSpeakersSection", () => ({ EventSpeakersSection: () => null }));
vi.mock("@/components/community/AddToCalendar", () => ({ AddToCalendar: () => null }));
vi.mock("@/components/community/EventTicketCard", () => ({ EventTicketCard: () => null }));
vi.mock("@/components/community/EventTicketPurchase", () => ({
  EventTicketPurchase: () => null,
}));

import { renderRoute } from "@/test/routeHarness";
import { publicEventRow } from "@/test/events/publicEventRow";
import { Route as EventOverviewRoute } from "@/routes/events.$slug.index";

const EVENT_SLUG = "kongres-strategii";
// Oczekiwane napisy BIERZEMY Z FIKSTURY, a nie przepisujemy. Przepisany napis
// jest kopia: rozjezdza sie przy pierwszej zmianie fikstury i - co gorsza -
// przechodzi albo oblewa sie z powodu polskiego znaku diakrytycznego, a nie
// z powodu zachowania, ktore mierzymy.
const OPIS_PL = publicEventRow().description_pl ?? "";
const OPIS_EN = publicEventRow().description_en ?? "";

/** Montuje przegląd i czeka, aż migawka wydarzenia zejdzie z ekranu ładowania. */
async function renderOverview() {
  const route = await renderRoute({
    route: EventOverviewRoute,
    path: "/events/$slug/",
    initialEntry: `/events/${EVENT_SLUG}`,
  });
  // Ten harness montuje SAM przegląd, bez loadera powłoki (`events.$slug.tsx`),
  // który w produkcji grzeje `["public-event", slug]` przed renderem - więc tu
  // pierwszy render to jeszcze pustka. Asercja bez oczekiwania mierzyłaby ją.
  await waitFor(() => expect(screen.getByText(/Kongres|European/)).toBeTruthy());
  return route;
}

afterEach(() => {
  cleanup();
  row.overrides = {};
  h.lang = "en";
});

describe("przeglad wydarzenia - fallback jezyka w opisie", () => {
  it("interfejs EN, opis tylko po polsku: czytelnik WIDZI polski tekst", async () => {
    h.lang = "en";
    row.overrides = { description_en: null };

    await renderOverview();

    expect(screen.getByText(OPIS_PL)).toBeTruthy();
  });

  it("interfejs EN, opis tylko po polsku podany jako PUSTY NAPIS - to samo", async () => {
    // Panel zapisuje niewypełnione pole jako `""`, nie `null`. Fallback, który
    // reaguje tylko na `null`, pokazałby tu pustkę - a to ten sam defekt.
    h.lang = "en";
    row.overrides = { description_en: "" };

    await renderOverview();

    expect(screen.getByText(OPIS_PL)).toBeTruthy();
  });

  it("DRUGI BOK: interfejs EN i oba opisy - czytelnik dostaje ANGIELSKI", async () => {
    h.lang = "en";

    await renderOverview();

    expect(screen.getByText(OPIS_EN)).toBeTruthy();
    expect(screen.queryByText(OPIS_PL)).toBeNull();
  });

  it("interfejs PL, opis tylko po angielsku: czytelnik WIDZI angielski tekst", async () => {
    // Symetria fallbacku. Bez tej asercji naprawa mogłaby dotyczyć jednego
    // kierunku, a wydarzenie opisane tylko po angielsku (import z zewnątrz)
    // byłoby niewidoczne dla polskiego czytelnika.
    h.lang = "pl";
    row.overrides = { description_pl: null };

    await renderOverview();

    expect(screen.getByText(OPIS_EN)).toBeTruthy();
  });

  it("oba opisy puste: bloku opisu NIE MA (pustka to nie napis)", async () => {
    h.lang = "en";
    row.overrides = { description_pl: null, description_en: null };

    await renderOverview();

    expect(screen.queryByText(OPIS_PL)).toBeNull();
    expect(screen.queryByText(OPIS_EN)).toBeNull();
  });
});
