// PRZEGLĄD WYDARZENIA: `/events/<slug>` (`src/routes/events.$slug.index.tsx`).
//
// TO JEST STRONA, NA KTÓREJ UCZESTNIK PODEJMUJE DECYZJĘ. Osiemset linii trasy
// sprowadza się do jednego pytania - „co ten człowiek może teraz zrobić" - i do
// czterech odpowiedzi, które muszą być prawdziwe JEDNOCZEŚNIE:
//
//   1. BLOK ZAPISÓW. Kontrolka powstaje WYŁĄCZNIE wtedy, gdy reguła
//      (`resolveRegistrationSurface`) mówi, że wywołanie ma szansę przejść.
//      Przycisk pokazany wbrew regule prowadzi w ścianę: uczestnik klika,
//      baza odmawia, a on nie wie, czego zabrakło. Trasa nie składa już
//      własnych warunków z kolumn - i ten plik pilnuje, żeby nie zaczęła
//      od nowa.
//
//   2. PIENIĄDZE ALBO ZAPIS, NIGDY OBOJE. Na wydarzeniu PŁATNYM zakup
//      wejściówki ZASTĘPUJE kontrolkę bezpłatnego zapisu - ale tylko wtedy, gdy
//      decyzja reguły dotyczy ścieżki legacy. Przy trybie `form`, `external`
//      i przy przepływie `approval` uczestnik ma dostać zdanie reguły, a nie
//      przycisk zakupu prowadzący w tę samą ścianę.
//
//   3. ODMOWA MA MIEĆ WYJŚCIE. Bramka warstwy, kolejka rezerwowa i bramka
//      nagrania kończą się nazwą wymaganej warstwy i odnośnikiem do cennika.
//      Odmowa bez wyjścia to ślepy zaułek na stronie sprzedażowej.
//
//   4. ZAMEK SEKCJI TO NIE PUSTKA. Sekcja zamknięta pokazuje kartę zaproszenia
//      pod SWOIM nagłówkiem (także nadpisanym w panelu), a nie znika - inaczej
//      gość widzi stronę, z której nie wynika, że jest tam więcej treści.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Fallbacku języka w opisie - to
// `eventOverviewDescriptionFallback.test.tsx` obok, i jego przypadków tu nie
// powtarzam. (2) Reguły zapisów jako takiej - `lib/events/__tests__`
// (`registrationSurface`); tutaj dowodzę, że TRASA jej słucha. (3) Wnętrz
// organizmów (agenda, partnerzy, prelegenci, wejściówki) - każdy ma własny
// plik, a tutaj stoją atrapy zapisujące to, co trasa im podała. (4) Kontraktu
// węzła `schema.org/Event` - `lib/seo/__tests__/eventsJsonld.test.ts`; tutaj
// dowodzę tylko, że węzeł JEST i niesie TO wydarzenie.
//
// WZORZEC ATRAP przejęty z `eventOverviewDescriptionFallback.test.tsx` (ten sam
// komplet granic dla tej trasy) i z `eventParticipantRoutes.test.tsx` (montaż
// przez `@/test/routeHarness`).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

import { ok, supabaseFromStub, type SupabaseFromStub } from "@/test/supabase";
import { publicEventRow } from "@/test/events/publicEventRow";
import type { PublicEvent, EventAccess, EventPageHeader } from "@/lib/community/publicQueries";
import type { EventSection } from "@/lib/events/eventSections";

/** Warstwa członkostwa w kształcie, którego dotyka trasa. */
interface TierRow {
  id: string;
  rank: number;
  name_pl: string;
  name_en: string;
  features: Record<string, unknown> | null;
}

const h = vi.hoisted(() => ({
  lang: "pl",
  user: null as { id: string } | null,
  from: null as SupabaseFromStub | null,
  /** Nadpisania wiersza wydarzenia i nagłówka - ustawiane per przypadek. */
  event: {} as Record<string, unknown>,
  header: {} as Record<string, unknown>,
  headerNull: false,
  access: null as Record<string, unknown> | null,
  counts: null as { going: number; interested: number; waitlist: number } | null,
  waitlistPosition: null as number | null,
  sections: [] as EventSection[],
  tiers: [] as Record<string, unknown>[],
  currentTier: null as { rank: number } | null,
  seats: null as { seatsLeft: number | null; isFull: boolean } | null,
  /** Wywołania `rsvp_event` przez warstwę zapytań - para (id, status). */
  rsvpCalls: [] as { eventId: string; status: string }[],
  rsvpResult: { status: "going", going: 1, waitlist: 0, waitlist_position: null } as {
    status: string;
    going: number;
    waitlist: number;
    waitlist_position: number | null;
  },
  rsvpError: null as string | null,
  /** Potwierdzenia mailowe - liczba wywołań i to, czy transport odmawia. */
  mailCalls: [] as Record<string, unknown>[],
  mailRejects: false,
  toastOk: [] as string[],
  toastErr: [] as string[],
}));

vi.mock("react-i18next", async () => {
  const { reactI18nextStub } = await import("@/test/i18nStub");
  return reactI18nextStub(() => h.lang);
});
vi.mock("@/lib/i18n-community", () => ({ ensureI18n: () => undefined }));
vi.mock("@/lib/i18n-event-front", () => ({ ensureI18n: () => undefined }));

vi.mock("sonner", () => ({
  toast: {
    success: (message: string) => void h.toastOk.push(message),
    error: (message: string) => void h.toastErr.push(message),
    info: () => undefined,
  },
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: h.user }) }));

// Własny wiersz RSVP idzie łańcuchem PostgREST (RLS "rsvps owner read"),
// a nie RPC - to jedyne zapytanie tabelaryczne tej trasy.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      if (h.from === null) throw new Error("test: atrapa łańcucha nie została ustawiona");
      return h.from.from(table);
    },
  },
}));

// Atrapa CZĄSTKOWA: `@tanstack/react-start` niesie też `createIsomorphicFn`,
// z którego żyje runtime języka. Podmieniamy sam `useServerFn`.
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: () => (payload: Record<string, unknown>) => {
    h.mailCalls.push(payload);
    return h.mailRejects ? Promise.reject(new Error("poczta padła")) : Promise.resolve(null);
  },
}));
vi.mock("@/lib/events/rsvp-email.functions", () => ({ confirmFreeRsvpEmail: vi.fn() }));

vi.mock("@/lib/community/useCommunityModules", () => ({
  useCommunityModules: () => ({ events_enabled: true }),
}));

vi.mock("@/hooks/useEventSeatsRealtime", () => ({
  useEventSeatsRealtime: () => ({ seats: h.seats }),
}));

// Atrapa CZĄSTKOWA warstwy warstw: podmieniamy WYŁĄCZNIE hooki (chodzą do bazy),
// a `tierName` i `tierHasFeature` zostają PRAWDZIWE - to one rozstrzygają, którą
// warstwę trasa nazwie w odmowie, i to jest przedmiotem dowodu.
vi.mock("@/lib/billing/tiers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/billing/tiers")>()),
  useMembershipTiers: () => ({ data: h.tiers }),
  useCurrentTier: () => ({ data: h.currentTier }),
}));

vi.mock("@/lib/events/publicEventApi", () => ({
  fetchEventAgenda: vi.fn(async () => []),
  fetchEventMenu: vi.fn(async () => []),
  fetchEventSections: vi.fn(async () => h.sections),
  fetchEventSponsors: vi.fn(async () => []),
  fetchEventSponsorMaterials: vi.fn(async () => []),
  fetchMyBookmarks: vi.fn(async () => []),
  fetchSessionAccess: vi.fn(async () => null),
  submitSessionSignup: vi.fn(),
  toggleEventBookmark: vi.fn(),
}));

vi.mock("@/lib/community/publicQueries", async () => {
  const { publicEventRow: rowFactory } = await import("@/test/events/publicEventRow");
  const { eventPageHeaderRow: headerFactory } = await import("@/test/events/eventPageHeaderRow");
  return {
    // Fabryki kluczy oddają DOKŁADNIE te klucze, których używa produkcja -
    // rozjechany klucz dałby test przechodzący na cudzym wpisie cache'a.
    publicEventBySlugQueryOptions: (slug: string) => ({
      queryKey: ["public-event", slug],
      queryFn: async () => rowFactory(h.event),
    }),
    eventPageHeaderQueryOptions: (slug: string, viewer: string) => ({
      queryKey: ["event-page-header", slug, viewer],
      queryFn: async () => (h.headerNull ? null : headerFactory(h.header)),
    }),
    fetchEventAccess: vi.fn(async () => h.access),
    fetchEventRsvpCounts: vi.fn(async (ids: string[]) => {
      const map = new Map<string, Record<string, unknown>>();
      if (h.counts !== null) map.set(ids[0], { event_id: ids[0], ...h.counts });
      return map;
    }),
    fetchEventWaitlistPosition: vi.fn(async () => h.waitlistPosition),
    rsvpEvent: vi.fn(async (eventId: string, status: string) => {
      h.rsvpCalls.push({ eventId, status });
      if (h.rsvpError !== null) throw new Error(h.rsvpError);
      return h.rsvpResult;
    }),
  };
});

// Powierzchnie z własnymi zapytaniami i własnym zakresem. Zapisują to, co
// trasa im podała - bo to jest jedyna część ich kontraktu, za którą trasa
// odpowiada.
vi.mock("@/components/network/EventGroupButton", () => ({
  EventGroupButton: ({ eventId }: { eventId: string }) => (
    <div data-testid="krag-czatu" data-event-id={eventId} />
  ),
}));
vi.mock("@/components/events/EventSpeakersSection", () => ({
  EventSpeakersSection: ({ section }: { section: { headingPl: string | null } | null }) => (
    <div data-testid="prelegenci" data-heading={section?.headingPl ?? ""} />
  ),
}));
vi.mock("@/components/community/AddToCalendar", () => ({
  AddToCalendar: () => <div data-testid="do-kalendarza" />,
}));
vi.mock("@/components/community/EventTicketCard", () => ({
  EventTicketCard: ({ enabled }: { enabled: boolean }) => (
    <div data-testid="wejsciowka" data-enabled={String(enabled)} />
  ),
}));
vi.mock("@/components/community/EventTicketPurchase", () => ({
  EventTicketPurchase: ({
    priceCents,
    currency,
    isFull,
    hasTicket,
  }: {
    priceCents: number;
    currency: string;
    isFull: boolean;
    hasTicket: boolean;
  }) => (
    <div
      data-testid="zakup-biletu"
      data-price={priceCents}
      data-currency={currency}
      data-full={String(isFull)}
      data-has-ticket={String(hasTicket)}
    />
  ),
}));
vi.mock("@/components/events/public/molecules/EventVideoHeader", () => ({
  EventVideoHeader: ({ title }: { title: string }) => (
    <div data-testid="naglowek-wideo" data-title={title} />
  ),
}));
vi.mock("@/components/events/public/molecules/EventBookmarkButton", () => ({
  EventBookmarkButton: ({ isBookmarked }: { isBookmarked: boolean }) => (
    <div data-testid="zapamietaj" data-on={String(isBookmarked)} />
  ),
}));
vi.mock("@/components/events/public/molecules/SectionLockCard", () => ({
  SectionLockCard: ({ reason, sectionKey }: { reason: string; sectionKey: string }) => (
    <div data-testid={`zamek-${sectionKey}`} data-reason={reason} />
  ),
}));
vi.mock("@/components/events/public/organisms/EventViewerProfile", () => ({
  EventViewerProfile: () => <div data-testid="profil-widza" />,
}));
vi.mock("@/components/events/public/organisms/EventMenuNav", () => ({
  EventMenuNav: ({ displayMode }: { displayMode: string }) => (
    <div data-testid="spis-kafelkowy" data-mode={displayMode} />
  ),
}));
vi.mock("@/components/events/public/organisms/EventHomeSectionLinks", () => ({
  EventHomeSectionLinks: () => <div data-testid="spis-listowy" />,
}));
vi.mock("@/components/events/public/organisms/EventSponsorTiers", () => ({
  EventSponsorTiers: () => <div data-testid="poziomy-partnerow" />,
}));
vi.mock("@/components/events/public/organisms/EventPageSections", () => ({
  EventPageSections: ({ sections }: { sections: readonly EventSection[] }) => (
    <div data-testid="sekcje-strony" data-count={sections.length} />
  ),
}));

// `<Link>` prowadzi do `/pricing` i `/events/$slug/register` - tras, których
// w drzewie zmontowanym przez harness nie ma. Atrapa zostawia prawdziwy `href`.
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

const { renderRoute } = await import("@/test/routeHarness");
const { Route: EventOverviewRoute } = await import("@/routes/events.$slug.index");

const SLUG = "kongres-strategii";
const EVENT_ID = publicEventRow().id;
const USER = { id: "5d1c9a20-0000-4000-8000-0000000000ff" };
const PRZESZLOSC = "2024-05-10T09:00:00.000Z";

/** Sekcja strony wydarzenia w kształcie, jaki oddaje `fetchEventSections`. */
function section(overrides: Partial<EventSection> & Pick<EventSection, "key">): EventSection {
  return {
    sortOrder: 10,
    headingPl: null,
    headingEn: null,
    visibility: "public",
    minTierRank: 0,
    isLocked: false,
    lockReason: "none",
    hasContent: true,
    ...overrides,
  };
}

function tier(overrides: Partial<TierRow> & { rank: number }): Record<string, unknown> {
  return {
    id: `tier-${overrides.rank}`,
    name_pl: `Warstwa ${overrides.rank}`,
    name_en: `Tier ${overrides.rank}`,
    features: null,
    ...overrides,
  };
}

function access(overrides: Partial<EventAccess>): Record<string, unknown> {
  return {
    can_join: false,
    join_url: null,
    can_watch: false,
    recording_url: null,
    reason: "ok",
    watch_reason: "none",
    ...overrides,
  };
}

/** Nadpisania wiersza wydarzenia - skrót zawężający typ przy wywołaniu. */
function event(overrides: Partial<PublicEvent>): Record<string, unknown> {
  return { ...overrides };
}

/** Nadpisania nagłówka strony wydarzenia. */
function header(overrides: Partial<EventPageHeader>): Record<string, unknown> {
  return { ...overrides };
}

/** Blok zapisów - jedyny region `group` na tej stronie. */
function blokZapisow(): HTMLElement {
  return screen.getByRole("group");
}

async function renderOverview() {
  const utils = await renderRoute({
    route: EventOverviewRoute,
    path: "/events/$slug/",
    initialEntry: `/events/${SLUG}`,
  });
  // Harness montuje SAM przegląd, bez loadera powłoki, który w produkcji grzeje
  // `["public-event", slug]` przed renderem - więc pierwszy render to pustka.
  await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toBeTruthy());
  return utils;
}

beforeEach(() => {
  h.lang = "pl";
  h.user = null;
  h.from = supabaseFromStub();
  h.from.setResponse("event_rsvps", ok(null));
  h.event = {};
  h.header = {};
  h.headerNull = false;
  h.access = null;
  h.counts = null;
  h.waitlistPosition = null;
  h.sections = [];
  h.tiers = [];
  h.currentTier = null;
  h.seats = null;
  h.rsvpCalls = [];
  h.rsvpResult = { status: "going", going: 1, waitlist: 0, waitlist_position: null };
  h.rsvpError = null;
  h.mailCalls = [];
  h.mailRejects = false;
  h.toastOk = [];
  h.toastErr = [];
});

afterEach(cleanup);

describe("blok zapisów - kontrolka powstaje TYLKO tam, gdzie zapis ma szansę przejść", () => {
  it("gość dostaje ZDANIE bez kontrolki wołającej bazę", async () => {
    // Nagłówek mówi „zapisy otwarte", ale wołający nie ma konta. Przycisk
    // zapisu dałby mu tu odmowę `authentication required` zamiast wskazówki.
    await renderOverview();

    const blok = blokZapisow();
    expect(within(blok).queryByRole("button")).toBeNull();
    // KONKRETNE zdanie reguły, nie „jakikolwiek tekst": pusty blok i blok
    // z podpowiedzią „zaloguj się, żeby się zapisać" to dla wołającego bez
    // konta różnica między ślepym zaułkiem a jednym kliknięciem do celu.
    expect(blok.textContent).toContain("eventFront.registrationSurface.signInHint");
  });

  it("zalogowany przy otwartych zapisach klika i zapisuje się - JEDNYM wywołaniem", async () => {
    h.user = USER;

    await renderOverview();
    await act(async () => {
      fireEvent.click(within(blokZapisow()).getByRole("button"));
    });

    await waitFor(() => expect(h.rsvpCalls).toEqual([{ eventId: EVENT_ID, status: "going" }]));
    expect(h.toastOk).toEqual(["community.events.toastGoing"]);
  });

  it("zapisany klika PONOWNIE i to WYCOFUJE zapis, a nie zapisuje drugi raz", async () => {
    // Ten sam przycisk w dwóch stanach. Bez cofnięcia uczestnik nie ma z tej
    // strony żadnej drogi wypisania się - a miejsce zostaje zajęte.
    h.user = USER;
    h.header = header({ my_rsvp_status: "going" });
    h.rsvpResult = { status: "cancelled", going: 0, waitlist: 0, waitlist_position: null };
    h.from?.setResponse("event_rsvps", ok({ id: "r1", status: "going" }));

    await renderOverview();
    await waitFor(() => expect(within(blokZapisow()).getByRole("button")).toBeTruthy());
    await act(async () => {
      fireEvent.click(within(blokZapisow()).getByRole("button"));
    });

    await waitFor(() => expect(h.rsvpCalls).toEqual([{ eventId: EVENT_ID, status: "cancelled" }]));
    expect(h.toastOk).toEqual(["community.events.toastCancelled"]);
  });

  it("komplet miejsc: klient wysyła `going`, a KOLEJKĘ nadaje serwer", async () => {
    // Kolejka rezerwowa NIE jest osobnym żądaniem - `rsvp_event` degraduje
    // wynik pod blokadą wiersza. Osobne żądanie „zapisz na kolejkę" ścigałoby
    // się z ostatnim zwolnionym miejscem.
    h.user = USER;
    h.header = header({ seats_left: 0, registration_state: "sold_out" });
    h.rsvpResult = { status: "waitlist", going: 10, waitlist: 3, waitlist_position: 3 };

    await renderOverview();
    await act(async () => {
      fireEvent.click(within(blokZapisow()).getByRole("button"));
    });

    await waitFor(() => expect(h.rsvpCalls.at(-1)?.status).toBe("going"));
    expect(h.toastOk).toEqual(["community.events.toastWaitlist(position=3)"]);
  });

  it("kolejka BEZ znanej pozycji dostaje własne zdanie, a nie „pozycja: null”", async () => {
    h.user = USER;
    h.header = header({ seats_left: 0, registration_state: "sold_out" });
    h.rsvpResult = { status: "waitlist", going: 10, waitlist: 3, waitlist_position: null };

    await renderOverview();
    await act(async () => {
      fireEvent.click(within(blokZapisow()).getByRole("button"));
    });

    await waitFor(() => expect(h.toastOk).toEqual(["community.events.toastWaitlistNoPosition"]));
  });

  it("odmowa bazy dostaje ZDANIE ODPOWIADAJĄCE POWODOWI, a nie ogólny błąd", async () => {
    // Uczestnik z otwartą kartą w chwili, gdy organizator zmienia tryb zapisów:
    // jego przycisk pochodzi z migawki, która przestała być prawdą. Ma dostać
    // zdanie prawdziwe, a nie „coś poszło nie tak".
    h.user = USER;
    h.rsvpError = "events: full";

    await renderOverview();
    await act(async () => {
      fireEvent.click(within(blokZapisow()).getByRole("button"));
    });

    await waitFor(() => expect(h.toastErr).toEqual(["community.events.rsvpFull"]));
  });

  it("odmowa NIEROZPOZNANA nadal kończy się zdaniem po ludzku", async () => {
    h.user = USER;
    h.rsvpError = "23505 duplicate key value";

    await renderOverview();
    await act(async () => {
      fireEvent.click(within(blokZapisow()).getByRole("button"));
    });

    await waitFor(() => expect(h.toastErr).toEqual(["community.events.rsvpError"]));
  });

  it("potwierdzenie mailowe leci po zapisie i jest FAIL-SOFT", async () => {
    // Mail jest dodatkiem: jego awaria nie unieważnia zapisu, więc uczestnik
    // ma dalej zobaczyć potwierdzenie na ekranie. Odwrotnie byłoby kłamstwem -
    // miejsce jest zajęte niezależnie od tego, czy list doszedł.
    h.user = USER;
    h.mailRejects = true;

    await renderOverview();
    await act(async () => {
      fireEvent.click(within(blokZapisow()).getByRole("button"));
    });

    await waitFor(() => expect(h.mailCalls).toEqual([{ data: { eventId: EVENT_ID } }]));
    expect(h.toastOk).toEqual(["community.events.toastGoing"]);
    expect(h.toastErr).toEqual([]);
  });

  it("mail NIE leci przy wycofaniu zapisu ani przy „zainteresowany”", async () => {
    h.user = USER;
    h.rsvpResult = { status: "interested", going: 0, waitlist: 0, waitlist_position: null };

    await renderOverview();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "community.events.rsvpInterested" }));
    });

    await waitFor(() => expect(h.toastOk).toEqual(["community.events.toastInterested"]));
    expect(h.mailCalls).toEqual([]);
  });

  it("nazwa bloku zapisów bierze NADPISANIE z panelu, a nie napis ze słownika", async () => {
    // Organizator zmienia nazwę sekcji „Zapisy" w studiu; dopóki szła wprost ze
    // słownika, czytnik ekranu ogłaszał starą nazwę, a redakcja nie miała jak
    // się o tym dowiedzieć.
    h.sections = [section({ key: "registration", headingPl: "Rejestracja delegacji" })];

    await renderOverview();

    expect(screen.getByRole("group", { name: "Rejestracja delegacji" })).toBeTruthy();
  });
});

describe("sygnał zainteresowania - OSOBNA decyzja, nie odmiana zapisu", () => {
  it("gość go nie widzi - nie ma czego zasygnalizować bez konta", async () => {
    await renderOverview();

    expect(screen.queryByRole("button", { name: "community.events.rsvpInterested" })).toBeNull();
  });

  it("zalogowany widzi go OBOK zapisu i klik wysyła `interested`", async () => {
    h.user = USER;

    await renderOverview();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "community.events.rsvpInterested" }));
    });

    await waitFor(() => expect(h.rsvpCalls).toEqual([{ eventId: EVENT_ID, status: "interested" }]));
  });

  it("wydarzenie ZAKOŃCZONE zdejmuje go razem z zapisem - nie ma czym się zainteresować", async () => {
    // Bramki wspólne dla wszystkich statusów (koniec, warstwa, Chatham House)
    // obejmują też ten przycisk - inaczej prowadziłby w tę samą ścianę.
    h.user = USER;
    h.header = header({ has_ended: true });
    h.event = event({ starts_at: PRZESZLOSC, ends_at: PRZESZLOSC });

    await renderOverview();

    expect(screen.queryByRole("button", { name: "community.events.rsvpInterested" })).toBeNull();
  });
});

describe("wydarzenie PŁATNE - wejściówka zastępuje zapis, ale nie zawsze", () => {
  it("zakup wejściówki ZASTĘPUJE kontrolkę bezpłatnego zapisu", async () => {
    h.user = USER;
    h.event = event({ ticket_price_cents: 12_000, ticket_currency: "PLN" });

    await renderOverview();

    const zakup = screen.getByTestId("zakup-biletu");
    expect(zakup.dataset.price).toBe("12000");
    expect(zakup.dataset.currency).toBe("PLN");
    expect(within(blokZapisow()).queryByRole("button")).toBeNull();
  });

  it("zakup też NALEŻY DO SEKCJI - czytnik ekranu dostaje jej nazwę", async () => {
    // Na wydarzeniu płatnym blok zapisów nie nazywał się wcale, a redakcyjne
    // nadpisanie nagłówka było tam martwe: działało wyłącznie przy zapisie
    // bezpłatnym, formularzu i rejestracji obcej.
    h.user = USER;
    h.event = event({ ticket_price_cents: 12_000 });
    h.sections = [section({ key: "registration", headingPl: "Bilety i wejściówki" })];

    await renderOverview();

    expect(
      within(screen.getByRole("group", { name: "Bilety i wejściówki" })).getByTestId(
        "zakup-biletu",
      ),
    ).toBeTruthy();
  });

  it("tryb FORMULARZA na wydarzeniu płatnym daje ZDANIE REGUŁY, nie przycisk zakupu", async () => {
    // Najważniejsza asercja tego bloku. Zakup pod trybem `form` prowadzi w tę
    // samą ścianę, co przycisk zapisu: zgłoszenie i tak wymaga formularza.
    h.user = USER;
    h.event = event({ ticket_price_cents: 12_000 });
    h.header = header({ registration_mode: "form" });

    await renderOverview();

    expect(screen.queryByTestId("zakup-biletu")).toBeNull();
    // Zdanie reguły MUSI być tym o formularzu. Blok z dowolnym innym napisem
    // (albo z pustką) zostawia uczestnika bez informacji, czego brakuje -
    // a to jest ekran, na którym ma zdecydować o wydaniu pieniędzy.
    expect(blokZapisow().textContent).toContain("eventFront.registrationSurface.formRequired");
  });

  it("cena stoi w karcie „co, kiedy, gdzie” - uczestnik nie musi jej szukać", async () => {
    h.event = event({ ticket_price_cents: 12_000, ticket_currency: "PLN" });

    await renderOverview();

    const wiersz = screen.getByText("eventFront.header.priceLabel").closest("div");
    // ZŁOTE, NIE GROSZE. Wzorzec `/120/` przechodził także na „12000 zł",
    // czyli na dokładnie tym błędzie, przed którym ten przypadek ma bronić:
    // cena zawyżona stokrotnie odstrasza uczestnika, zanim ktokolwiek ją zgłosi.
    expect(wiersz?.textContent ?? "").toContain("120,00");
    expect(wiersz?.textContent ?? "").not.toContain("12000");
  });

  it("wydarzenie BEZPŁATNE nie pokazuje ani ceny, ani zakupu", async () => {
    await renderOverview();

    expect(screen.queryByTestId("zakup-biletu")).toBeNull();
    expect(screen.queryByText("eventFront.header.priceLabel")).toBeNull();
  });
});

describe("bramka warstwy - odmowa MUSI mieć wyjście", () => {
  it("odmowa warstwy nazywa WYMAGANĄ warstwę i prowadzi do cennika", async () => {
    h.event = event({ visibility: "members" });
    h.access = access({ reason: "tier_required" });
    h.tiers = [tier({ rank: 2, name_pl: "Partner" }), tier({ rank: 1, name_pl: "Członek" })];

    await renderOverview();

    // Najniższa warstwa spełniająca próg, a nie pierwsza z listy: propozycja
    // droższego planu, gdy tańszy wystarcza, jest po prostu nieuczciwa.
    await waitFor(() =>
      expect(screen.getByText("community.events.tierRequired(tier=Członek)")).toBeTruthy(),
    );
    expect(
      screen.getByRole("link", { name: "community.events.tierUpgradeCta" }).getAttribute("href"),
    ).toBe("/pricing");
  });

  it("gdy żadna warstwa nie spełnia progu, zdanie jest OGÓLNE, a nie puste", async () => {
    // Katalog warstw bywa niekompletny (świeży najemca, wyłączony plan).
    // Zdanie z pustą nazwą czyta się jak awaria, a wyjście musi zostać.
    h.event = event({ visibility: "members", min_tier_rank: 9 });
    h.access = access({ reason: "tier_required" });
    h.tiers = [tier({ rank: 1 })];

    await renderOverview();

    await waitFor(() =>
      expect(screen.getByText("community.events.tierRequiredGeneric")).toBeTruthy(),
    );
  });

  it("briefing Pro wskazuje warstwę Z FLAGĄ `pro_briefings`, a nie po randze", async () => {
    // Briefing Pro nie jest „wyżej w cenniku" - jest osobnym benefitem. Warstwa
    // wskazana po randze mogłaby nie mieć do niego prawa mimo wyższej ceny.
    h.event = event({ visibility: "members", kind: "briefing" });
    h.access = access({ reason: "tier_required" });
    h.tiers = [
      tier({ rank: 3, name_pl: "Premium", features: {} }),
      tier({ rank: 1, name_pl: "Pro", features: { pro_briefings: true } }),
    ];

    await renderOverview();

    await waitFor(() =>
      expect(screen.getByText("community.events.tierRequired(tier=Pro)")).toBeTruthy(),
    );
  });
});

describe("po wydarzeniu - bramka nagrania", () => {
  const przeszle = () => {
    h.event = event({ starts_at: PRZESZLOSC, ends_at: PRZESZLOSC });
    h.header = header({ has_ended: true });
  };

  it("uprawniony dostaje ODNOŚNIK do nagrania", async () => {
    przeszle();
    h.access = access({
      can_watch: true,
      recording_url: "https://video.example.org/nagranie",
      watch_reason: "ok",
    });

    await renderOverview();

    await waitFor(() =>
      expect(screen.getByRole("link", { name: /watchRecording/ }).getAttribute("href")).toBe(
        "https://video.example.org/nagranie",
      ),
    );
  });

  it("niezalogowany dostaje ZDANIE o logowaniu, a nie martwy przycisk", async () => {
    przeszle();
    h.access = access({ watch_reason: "auth_required" });

    await renderOverview();

    await waitFor(() =>
      expect(screen.getByText("community.events.recordingSignInHint")).toBeTruthy(),
    );
    expect(screen.queryByRole("link", { name: /watchRecording/ })).toBeNull();
  });

  it("brak warstwy z benefitem nagrań kończy się NAZWĄ warstwy i cennikiem", async () => {
    przeszle();
    h.access = access({ watch_reason: "tier_required" });
    h.tiers = [
      tier({ rank: 3, name_pl: "Premium", features: { recordings: true } }),
      tier({ rank: 1, name_pl: "Podstawowa", features: {} }),
    ];

    await renderOverview();

    await waitFor(() =>
      expect(screen.getByText("community.events.recordingTierRequired(tier=Premium)")).toBeTruthy(),
    );
    expect(screen.getAllByRole("link", { name: "community.events.tierUpgradeCta" })).toHaveLength(
      1,
    );
  });

  it("wydarzenie BEZ nagrania nie pokazuje sekcji wcale", async () => {
    // Sekcja z pustą treścią czyta się jak nagranie, które się nie wczytało.
    przeszle();
    h.access = access({ watch_reason: "none" });

    await renderOverview();

    expect(screen.queryByText("community.events.recordingGateTitle")).toBeNull();
  });

  it("wydarzenie PRZYSZŁE nie pokazuje bramki nagrania, nawet gdy dostęp ją zna", async () => {
    h.access = access({ watch_reason: "tier_required" });

    await renderOverview();

    expect(screen.queryByText("community.events.recordingGateTitle")).toBeNull();
  });
});

describe("sekcje treści - zamek pokazuje ZAPROSZENIE, nie pustkę", () => {
  it("zamknięty OPIS zostawia nagłówek sekcji i kartę zaproszenia", async () => {
    h.sections = [
      section({
        key: "description",
        isLocked: true,
        lockReason: "tier_required",
        headingPl: "O czym",
      }),
    ];

    await renderOverview();

    expect(screen.getByRole("heading", { level: 2, name: "O czym" })).toBeTruthy();
    // POWÓD ZAMKA JEDZIE DO KARTY, bo od niego zależy wyjście: „dołącz do
    // planu" i „zaloguj się" to dwa różne przyciski dla dwóch różnych osób.
    expect(screen.getByTestId("zamek-description").dataset.reason).toBe("tier_required");
  });

  it("zamknięci PRELEGENCI nie znikają - sekcja ma nagłówek i kartę", async () => {
    h.sections = [
      section({ key: "speakers", isLocked: true, lockReason: "registration_required" }),
    ];

    await renderOverview();

    expect(screen.getByTestId("zamek-speakers").dataset.reason).toBe("registration_required");
    expect(screen.queryByTestId("prelegenci")).toBeNull();
  });

  it("OTWARCI prelegenci dostają wiersz sekcji - nagłówek rysuje organizm", async () => {
    // Wiersz jedzie DO komponentu, bo nagłówek sekcji otwartej rysuje on;
    // inaczej nadpisanie z bazy widzieliby wyłącznie goście bez dostępu.
    h.sections = [section({ key: "speakers", headingPl: "Nasi goście" })];

    await renderOverview();

    expect(screen.getByTestId("prelegenci").dataset.heading).toBe("Nasi goście");
  });

  it("brak wiersza sekcji znaczy BRAK sekcji, a nie sekcję pustą", async () => {
    await renderOverview();

    expect(screen.queryByTestId("prelegenci")).toBeNull();
    expect(screen.queryByTestId("zamek-speakers")).toBeNull();
  });
});

describe("spis podstron - jeden, nigdy dwa", () => {
  it("tryb `grid` daje spis KAFELKOWY i wyklucza listowy", async () => {
    // Oba czytają ten sam `event_menu`, więc przełącznik organizatora zmienia
    // WYGLĄD spisu, a nie to, do których podstron czytelnik ma dojście.
    h.event = event({ pages_display_mode: "grid" });

    await renderOverview();

    expect(screen.getByTestId("spis-kafelkowy").dataset.mode).toBe("grid");
    expect(screen.queryByTestId("spis-listowy")).toBeNull();
  });

  it("tryb `list` daje spis LISTOWY i wyklucza kafelkowy", async () => {
    await renderOverview();

    expect(screen.getByTestId("spis-listowy")).toBeTruthy();
    expect(screen.queryByTestId("spis-kafelkowy")).toBeNull();
  });
});

describe("karta „co, kiedy, gdzie” - liczby, które decydują o przyjściu", () => {
  it("miejsca i liczba zapisanych stoją obok siebie, a kolejka tylko gdy istnieje", async () => {
    h.event = event({ capacity: 100 });
    h.counts = { going: 40, interested: 5, waitlist: 7 };

    await renderOverview();

    await waitFor(() => expect(screen.getByText(/capacityLeft\(count=60\)/)).toBeTruthy());
    const tekst = screen.getByText("community.events.capacityLabel").closest("div")?.textContent;
    expect(tekst).toContain("community.events.goingCount(count=40)");
    expect(tekst).toContain("community.events.waitlistCount(count=7)");
  });

  it("pusta kolejka NIE dostaje własnego napisu - zero to nie informacja", async () => {
    h.event = event({ capacity: 100 });
    h.counts = { going: 40, interested: 0, waitlist: 0 };

    await renderOverview();

    await waitFor(() => expect(screen.getByText(/goingCount\(count=40\)/)).toBeTruthy());
    const wiersz = screen.getByText("community.events.capacityLabel").closest("div");
    expect(wiersz?.textContent ?? "").not.toContain("waitlistCount");
  });

  it("STAN MIEJSC Z REALTIME wygrywa z liczbami z listy", async () => {
    // Liczniki RSVP są migawką sprzed chwili; kanał realtime niesie stan
    // autorytatywny. Ostatnie wolne miejsce znika w sekundach, a uczestnik
    // czytający starą liczbę wypełnia formularz na darmo.
    h.event = event({ capacity: 100 });
    h.counts = { going: 40, interested: 0, waitlist: 0 };
    h.seats = { seatsLeft: 0, isFull: true };

    await renderOverview();

    const wiersz = screen.getByText("community.events.capacityLabel").closest("div");
    expect(wiersz?.textContent ?? "").toContain("community.events.capacityFull");
    expect(wiersz?.textContent ?? "").not.toContain("capacityLeft");
  });

  it("wydarzenie BEZ limitu nie pokazuje wiersza miejsc wcale", async () => {
    await renderOverview();

    expect(screen.queryByText("community.events.capacityLabel")).toBeNull();
  });

  it("godzina jest w STREFIE WYDARZENIA, a nazwa strefy stoi obok", async () => {
    // Uczestnik z Brukseli czytał godzinę warszawską jako swoją i przychodził
    // o złej godzinie. Sama godzina bez nazwy strefy jest gorsza niż jej brak.
    //
    // DOWODEM JEST RÓŻNICA, nie sam nawias: godzina liczona strefą PRZEGLĄDARKI
    // (albo UTC) też ma nawias i też wygląda poprawnie - jest po prostu inną
    // godziną niż ta, o której wydarzenie się zaczyna. Ta sama chwila UTC pod
    // dwiema strefami musi dać dwa różne odczyty, inaczej strefa nie działa.
    const wiersz = () => screen.getByText("community.events.whenLabel").closest("div");

    await renderOverview();
    const warszawa = wiersz()?.textContent ?? "";
    cleanup();

    h.event = event({ timezone: "Pacific/Kiritimati" });
    await renderOverview();
    const kiritimati = wiersz()?.textContent ?? "";

    expect(warszawa).not.toBe(kiritimati);
    // Nazwa strefy stoi OBOK godziny - w obu wypadkach i w każdym języku.
    expect(warszawa).toMatch(/\(.+\)/);
    expect(kiritimati).toMatch(/\(.+\)/);
  });

  it("klauzula Chatham House stoi w karcie, gdy wydarzenie jej podlega", async () => {
    h.event = event({ chatham_house: true });

    await renderOverview();

    expect(screen.getByText("community.events.chathamHouse")).toBeTruthy();
  });
});

describe("plakietki nad tytułem - stan wydarzenia w jednym rzucie oka", () => {
  it("briefing Pro dostaje SWOJĄ plakietkę, nie ogólną „tylko dla członków”", async () => {
    h.event = event({ visibility: "members", kind: "briefing" });

    await renderOverview();

    expect(screen.getByText("community.events.proBriefing")).toBeTruthy();
    expect(screen.queryByText("community.events.membersOnly")).toBeNull();
  });

  it("wydarzenie członkowskie (nie briefing) dostaje plakietkę członkowską", async () => {
    h.event = event({ visibility: "members" });

    await renderOverview();

    expect(screen.getByText("community.events.membersOnly")).toBeTruthy();
  });

  it("komplet miejsc jest widoczny NAD tytułem, zanim uczestnik doczyta do zapisu", async () => {
    h.seats = { seatsLeft: 0, isFull: true };

    await renderOverview();

    // „NAD tytułem" jest tu CAŁYM dowodem: ten sam napis stoi też w karcie
    // „co, kiedy, gdzie" niżej, więc samo jego istnienie na stronie niczego
    // nie rozstrzyga. Uczestnik, który dowiaduje się o komplecie dopiero po
    // przewinięciu do zapisu, przeczytał wcześniej całą stronę sprzedażową.
    const plakietka = screen.getAllByText("community.events.capacityFull")[0];
    const tytul = screen.getByRole("heading", { level: 1 });

    expect(plakietka.compareDocumentPosition(tytul) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("wcześniejszy dostęp członków jest zapowiedziany PRZED otwarciem zapisów", async () => {
    // Bez tej plakietki członek z pierwszeństwem nie wie, że ma wracać
    // wcześniej niż reszta - a to jest benefit, za który zapłacił.
    h.event = event({ rsvp_opens_at: "2099-01-01T09:00:00.000Z", early_rsvp_rank: 2 });

    await renderOverview();

    expect(screen.getByText("community.events.earlyForMembers")).toBeTruthy();
  });

  it("członek Z PIERWSZEŃSTWEM dostaje zdanie z godziną otwarcia zapisów", async () => {
    h.user = USER;
    h.event = event({ rsvp_opens_at: "2099-01-01T09:00:00.000Z", early_rsvp_rank: 2 });
    h.currentTier = { rank: 3 };

    await renderOverview();

    // DOKŁADNA godzina, nie „jakieś cztery cyfry": zdanie ma powiedzieć
    // członkowi, KIEDY ma wrócić, i ma to zrobić w strefie WYDARZENIA
    // (Europe/Warsaw, czyli 10:00, a nie 09:00 z UTC). Godzina przesunięta
    // o strefę to członek wracający po zapisaniu się wszystkich pozostałych.
    expect(
      screen.getByText("community.events.rsvpEarlyAccessOpen(when=1 stycznia 2099 10:00)"),
    ).toBeTruthy();
  });
});

describe("dane strukturalne i powierzchnie wspólne", () => {
  it("na stronie stoi węzeł `schema.org/Event` TEGO wydarzenia", async () => {
    // Węzeł stoi w TREŚCI, a nie w `head()`, żeby siedem zakładek powłoki nie
    // wysłało siedmiu kopii tego samego wydarzenia pod siedmioma adresami.
    const { container } = await renderOverview();

    const script = container.querySelector('script[type="application/ld+json"]');
    const parsed: unknown = JSON.parse(script?.textContent ?? "{}");
    if (parsed === null || typeof parsed !== "object") throw new Error("test: brak węzła JSON-LD");
    const node = { ...(parsed as Record<string, unknown>) };

    expect(node["@type"]).toBe("Event");
    expect(node.name).toBe(publicEventRow().title_pl);
    expect(String(node.url)).toContain(SLUG);
  });

  it("gwiazdka zapamiętania czyta stan Z NAGŁÓWKA - bez drugiego zapytania", async () => {
    h.header = header({ is_bookmarked: true });

    await renderOverview();

    expect(screen.getByTestId("zapamietaj").dataset.on).toBe("true");
  });

  it("wejściówka w kolumnie decyzji włącza się dopiero dla ZAPISANEGO", async () => {
    h.user = USER;
    h.from?.setResponse("event_rsvps", ok({ id: "r1", status: "going" }));

    await renderOverview();

    await waitFor(() => expect(screen.getByTestId("wejsciowka").dataset.enabled).toBe("true"));
  });

  it("odczyt WŁASNEGO zgłoszenia jest zawężony wydarzeniem I wołającym", async () => {
    // JEDYNE zapytanie tabelaryczne tej trasy - reszta idzie przez RPC i widoki.
    // RLS („rsvps owner read") jest ostatnią linią, ale zawężenie w zapytaniu
    // rozstrzyga, CO ta strona pokaże: bez `user_id` wołający zobaczyłby cudzy
    // wiersz jako swój, czyli przycisk „wypisz się" z cudzego zapisu i włączoną
    // wejściówkę bez zapisu. Bez `event_id` - stan z zupełnie innego wydarzenia.
    h.user = USER;
    h.from?.setResponse("event_rsvps", ok({ id: "r1", status: "going" }));

    await renderOverview();

    await waitFor(() => expect(h.from?.lastChain("event_rsvps")).toBeTruthy());
    const lancuch = h.from?.lastChain("event_rsvps");
    const zawezenia = (lancuch?.calls ?? [])
      .filter((ogniwo) => ogniwo.method === "eq")
      .map((ogniwo) => ogniwo.args);

    expect(zawezenia).toEqual([
      ["event_id", EVENT_ID],
      ["user_id", USER.id],
    ]);
    // Pojedynczy wiersz, nie lista: `maybeSingle` znaczy też „brak zapisu jest
    // stanem normalnym", a nie błędem odczytu.
    expect(lancuch?.has("maybeSingle")).toBe(true);
  });

  it("GOŚĆ nie pyta bazy o cudze zgłoszenie - zapytanie w ogóle nie leci", async () => {
    // Zapytanie bez `user_id` (bo go nie ma) oparłoby cały stan strony
    // o pierwszy wiersz, jaki RLS przepuści. Trasa go po prostu nie wysyła.
    await renderOverview();

    expect(h.from?.chainsFor("event_rsvps")).toEqual([]);
    expect(screen.getByTestId("wejsciowka").dataset.enabled).toBe("false");
  });

  it("sekcje z bazy jadą do organizmu W KOMPLECIE - kolejność liczy baza", async () => {
    h.sections = [
      section({ key: "agenda", sortOrder: 10 }),
      section({ key: "sponsors", sortOrder: 20 }),
      section({ key: "contact", sortOrder: 30 }),
    ];

    await renderOverview();

    expect(screen.getByTestId("sekcje-strony").dataset.count).toBe("3");
  });
});
