// ZAKŁADKA „AGENDA" - okna profilu osoby i instytucji nad tablicą programu.
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW.
//   1. NIEMY PRZYCISK. Wiersz prelegenta i znaczek partnera są przyciskami,
//      a ich nazwa dostępna MUSI nieść nazwisko / nazwę firmy - kilkanaście
//      „Otwórz profil" to dla czytnika ekranu lista nierozróżnialnych pozycji.
//   2. OKNO BEZ PROGRAMU. Okno osoby otwarte z agendy pokazuje WSZYSTKIE jej
//      sesje (także z innego dnia, którego tablica w tej chwili nie rysuje) -
//      to jest pytanie, z którym ktoś klika w nazwisko w programie.
//   3. KLIK W SESJĘ, KTÓRY NIGDZIE NIE PROWADZI. Wiersz sesji w oknie zamyka
//      okno i odsłania blok: zakładka dnia, zdjęte filtry, przewinięcie i fokus
//      na tytule. Zwrot fokusu do przycisku, który okno otworzył, przewijałby
//      stronę z powrotem - test pilnuje, że fokus zostaje na sesji.
//   4. ODNOŚNIK Z INNEJ ZAKŁADKI (`#event-session-<id>`) trafiał w próżnię,
//      gdy sesja stała w innym dniu niż pierwszy.
//   5. PRZEGLĄD WYDARZENIA rysuje ten sam organizm BEZ okien - tam przycisk,
//      który niczego nie otwiera, byłby atrapą; wzbogacające zapytania też
//      nie mogą tam ruszyć.
//
// ATRAPY TYLKO NA GRANICACH: dwa fetchery RPC tej powierzchni, wydarzenie po
// slugu (identyfikator do materiałów) i tożsamość. Parser, hooki zapytań,
// katalog, dostawca i leniwe okno są prawdziwe.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgendaSession, AgendaSpeaker } from "@/lib/events/agendaSurface";
import type { PublicSponsorTier } from "@/lib/events/sponsorsSurface";

const fetchAgenda = vi.fn<(slug: string) => Promise<AgendaSession[]>>();
const fetchSponsors = vi.fn<(slug: string) => Promise<PublicSponsorTier[]>>();

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: null }) }));

vi.mock("@/lib/events/publicEventApi", async () => {
  const actual = await vi.importActual<typeof import("@/lib/events/publicEventApi")>(
    "@/lib/events/publicEventApi",
  );
  return {
    ...actual,
    fetchEventAgenda: (slug: string) => fetchAgenda(slug),
    fetchEventSponsors: (slug: string) => fetchSponsors(slug),
    submitSessionSignup: vi.fn(),
  };
});

// Wydarzenie po slugu bez sieci; `null` zostawia zapytanie o prelegentów
// uśpione (czeka na identyfikator wydarzenia).
vi.mock("@/lib/community/publicQueries", async () => {
  const actual = await vi.importActual<typeof import("@/lib/community/publicQueries")>(
    "@/lib/community/publicQueries",
  );
  return {
    ...actual,
    publicEventBySlugQueryOptions: (slug: string) => ({
      queryKey: ["public-event", slug],
      queryFn: () => Promise.resolve(null),
    }),
  };
});

const { EventAgendaSection } =
  await import("@/components/events/public/organisms/EventAgendaSection");

const DIALOG_WAIT = { timeout: 5000 };
const SP_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OPEN_ANNA = "eventFront.directory.openPerson(name=Anna Zablocka)";
const OPEN_NORDWIND = "eventFront.directory.openCompany(name=Nordwind Analytics)";

function speaker(over: Partial<AgendaSpeaker> & { userId: string }): AgendaSpeaker {
  return {
    slug: null,
    displayName: "Anna Zablocka",
    avatarUrl: null,
    headlinePl: "Glowna ekonomistka, PwC",
    headlineEn: null,
    role: "speaker",
    sortOrder: 0,
    ...over,
  };
}

function session(over: Partial<AgendaSession>): AgendaSession {
  return {
    id: "s1",
    eventId: "e1",
    parentSessionId: null,
    titlePl: "Sesja otwarcia",
    titleEn: null,
    descriptionPl: null,
    descriptionEn: null,
    startsAt: "2026-09-01T08:00:00Z",
    endsAt: "2026-09-01T09:00:00Z",
    timezone: "Europe/Warsaw",
    format: "onsite",
    status: "published",
    sortOrder: 1,
    chathamHouse: false,
    minTierRank: 0,
    requiresSignup: false,
    capacity: null,
    registeredCount: 0,
    seatsLeft: null,
    track: null,
    room: null,
    hasStream: false,
    hasRecording: false,
    mySignupStatus: null,
    accessState: "open",
    speakers: [],
    ...over,
    affiliationPl: over.affiliationPl ?? null,
    affiliationEn: over.affiliationEn ?? null,
    sponsor: over.sponsor ?? null,
  };
}

const ANNA = "u-anna";

/** Dwa dni programu; Anna występuje rano i w południe pierwszego dnia oraz drugiego dnia. */
const PROGRAMME: AgendaSession[] = [
  session({
    id: "a",
    titlePl: "Panel otwarcia",
    speakers: [speaker({ userId: ANNA, role: "moderator" })],
    sponsor: { id: SP_A, name: "Nordwind Analytics", logoUrl: null, role: "partner" },
  }),
  session({
    id: "b",
    titlePl: "Rynek pracy",
    startsAt: "2026-09-01T12:00:00Z",
    endsAt: "2026-09-01T13:00:00Z",
    speakers: [speaker({ userId: ANNA, role: "panelist" })],
  }),
  session({
    id: "c",
    titlePl: "Energia jutra",
    startsAt: "2026-09-02T08:00:00Z",
    endsAt: "2026-09-02T09:00:00Z",
    speakers: [speaker({ userId: ANNA, role: "panelist" })],
  }),
];

const NORDWIND_TIER: PublicSponsorTier = {
  tierId: "tier-gold",
  key: "gold",
  namePl: "Złoty Partner",
  nameEn: null,
  descriptionPl: null,
  descriptionEn: null,
  rank: 30,
  accentColor: null,
  logoSize: "md",
  benefits: [],
  sponsors: [
    {
      id: SP_A,
      name: "Nordwind Analytics",
      logoUrl: null,
      websiteUrl: null,
      linkMode: "none",
      href: null,
      descriptionPl: "Analityka ryzyka dla infrastruktury krytycznej.",
      descriptionEn: null,
      country: "Polska",
      role: "partner",
      boothLabel: null,
      sortOrder: 0,
    },
  ],
};

function renderAgenda(profiles: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <EventAgendaSection slug="kongres" profiles={profiles} />
    </QueryClientProvider>,
  );
}

/** Fokus i klik jak u człowieka - fokus zapamiętuje przycisk jako cel zwrotu fokusu. */
function press(element: HTMLElement) {
  act(() => element.focus());
  fireEvent.click(element);
}

beforeEach(() => {
  fetchAgenda.mockResolvedValue(PROGRAMME);
  fetchSponsors.mockResolvedValue([NORDWIND_TIER]);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  fetchAgenda.mockReset();
  fetchSponsors.mockReset();
  window.history.replaceState(null, "", window.location.pathname);
});

describe("zakładka „Agenda” - okno osoby", () => {
  it("wiersz prelegenta jest przyciskiem z nazwiskiem, a okno zna wszystkie sesje osoby", async () => {
    renderAgenda(true);
    const trigger = (await screen.findAllByRole("button", { name: OPEN_ANNA }))[0];
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    // Rola i organizacja zostają TEKSTEM obok przycisku (nie znikają w jego nazwie).
    const row = trigger.closest("li") as HTMLElement;
    expect(within(row).getByText("Glowna ekonomistka, PwC")).toBeInTheDocument();
    expect(within(row).getByText("eventFront.agenda.speakerRole.moderator")).toBeInTheDocument();

    press(trigger);
    const dialog = await screen.findByRole("dialog", {}, DIALOG_WAIT);
    expect(within(dialog).getByRole("heading", { level: 2, name: "Anna Zablocka" })).toBeTruthy();
    expect(within(dialog).getByText("Glowna ekonomistka, PwC")).toBeTruthy();
    expect(within(dialog).getByText("eventFront.directory.sessionsCount(count=3)")).toBeTruthy();
    // Sesja z DRUGIEGO dnia - tablica jej teraz nie rysuje, okno tak.
    expect(screen.queryByRole("heading", { level: 3, name: "Energia jutra" })).toBeNull();
    const rows = within(dialog).getAllByRole("button", {
      name: /Panel otwarcia|Rynek pracy|Energia jutra/,
    });
    expect(rows.map((node) => node.textContent)).toEqual([
      expect.stringContaining("Panel otwarcia"),
      expect.stringContaining("Rynek pracy"),
      expect.stringContaining("Energia jutra"),
    ]);
    // Rola w obsadzie stoi przy KAŻDEJ sesji osobno.
    expect(rows[0]).toHaveTextContent("eventFront.agenda.speakerRole.moderator");
    expect(rows[2]).toHaveTextContent("eventFront.agenda.speakerRole.panelist");
    // Program jest własnym źródłem katalogu - okno nie pyta o niego drugi raz.
    expect(fetchAgenda).toHaveBeenCalledTimes(1);
  });

  it("klik w sesję z innego dnia zamyka okno, przełącza dzień, przewija i stawia fokus na tytule", async () => {
    const scroll = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
    renderAgenda(true);
    press((await screen.findAllByRole("button", { name: OPEN_ANNA }))[0]);
    const dialog = await screen.findByRole("dialog", {}, DIALOG_WAIT);

    fireEvent.click(within(dialog).getByText("Energia jutra").closest("button") as HTMLElement);

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getAllByRole("tab")[1]).toHaveAttribute("aria-selected", "true");
    const target = document.getElementById("event-session-c") as HTMLElement;
    expect(target).not.toBeNull();
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll.mock.contexts[0]).toBe(target);
    expect(document.activeElement).toBe(
      within(target).getByRole("heading", { level: 3, name: "Energia jutra" }),
    );
  });

  it("sesja tego samego dnia: fokus zostaje na sesji, a nie wraca do przycisku, który otworzył okno", async () => {
    vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
    renderAgenda(true);
    const opener = (await screen.findAllByRole("button", { name: OPEN_ANNA }))[0];
    press(opener);
    const dialog = await screen.findByRole("dialog", {}, DIALOG_WAIT);

    fireEvent.click(within(dialog).getByText("Rynek pracy").closest("button") as HTMLElement);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // Zwrot fokusu Radiksa biegnie w `setTimeout` po odmontowaniu okna.
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));

    const target = document.getElementById("event-session-b") as HTMLElement;
    expect(opener.isConnected).toBe(true);
    expect(document.activeElement).not.toBe(opener);
    expect(document.activeElement).toBe(
      within(target).getByRole("heading", { level: 3, name: "Rynek pracy" }),
    );
  });

  it("odnośnik z kotwicą sesji (wiersz okna z innej zakładki) odsłania sesję z drugiego dnia", async () => {
    const scroll = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
    window.history.replaceState(null, "", "#event-session-c");
    renderAgenda(true);

    expect(
      await screen.findByRole("heading", { level: 3, name: "Energia jutra" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("tab")[1]).toHaveAttribute("aria-selected", "true");
    expect(scroll.mock.contexts[0]).toBe(document.getElementById("event-session-c"));
  });
});

describe("zakładka „Agenda” - okno instytucji", () => {
  it("znaczek partnera otwiera okno z nazwą, opisem z listy partnerów i wspieraną sesją", async () => {
    renderAgenda(true);
    const trigger = await screen.findByRole("button", { name: OPEN_NORDWIND });
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    // Lista partnerów śpi do sygnału zamiaru - wejście na zakładkę jej nie woła.
    expect(fetchSponsors).not.toHaveBeenCalled();

    press(trigger);
    await waitFor(() => expect(fetchSponsors).toHaveBeenCalledTimes(1));
    const dialog = await screen.findByRole("dialog", {}, DIALOG_WAIT);
    expect(
      within(dialog).getByRole("heading", { level: 2, name: "Nordwind Analytics" }),
    ).toBeTruthy();
    expect(
      await within(dialog).findByText("Analityka ryzyka dla infrastruktury krytycznej."),
    ).toBeTruthy();
    expect(within(dialog).getByText("eventFront.directory.supportedSessions")).toBeTruthy();
    expect(within(dialog).getByText("Panel otwarcia")).toBeTruthy();
  });
});

describe("przegląd wydarzenia (bez `profiles`)", () => {
  it("ten sam program bez okien: zero przycisków profilu i zero zapytań wzbogacających", async () => {
    const { container } = renderAgenda(false);
    expect(await screen.findByText("Panel otwarcia")).toBeInTheDocument();

    expect(container.querySelector("[aria-haspopup='dialog']")).toBeNull();
    expect(screen.queryByRole("button", { name: /eventFront\.directory\./ })).toBeNull();
    // Nazwisko i partner zostają tekstem, jak przed oknami.
    expect(screen.getAllByText("Anna Zablocka")[0].tagName).toBe("SPAN");
    expect(screen.getByTitle("Nordwind Analytics")).toHaveTextContent("Nordwind Analytics");
    // Tytuł bloku nie łapie fokusu - nic go tu nie przenosi.
    expect(screen.getByRole("heading", { level: 3, name: "Panel otwarcia" })).not.toHaveAttribute(
      "tabindex",
    );

    fireEvent.pointerEnter(screen.getAllByText("Anna Zablocka")[0]);
    fireEvent.focus(screen.getAllByText("Anna Zablocka")[0]);
    expect(fetchSponsors).not.toHaveBeenCalled();
  });
});
