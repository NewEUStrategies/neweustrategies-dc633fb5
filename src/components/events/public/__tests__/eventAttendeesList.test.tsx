// UCZESTNICY na froncie: to, co po zepsuciu ujawnia nazwisko albo zabiera
// człowiekowi kontrolę nad własną widocznością.
//
// SPRAWDZAMY KONTRAKT, NIE NAPISY. i18n jest zamockowane kluczami (parytetu
// PL/EN pilnuje osobna bramka słowników), więc asercje czytają klucze - a klucz
// jest tym, co realnie decyduje, KTÓRE zdanie zobaczy czytelnik.
//
// PIĘĆ RZECZY, KTÓRE MUSZĄ TRZYMAĆ:
// 1. gość NIE PYTA BAZY i dostaje zaproszenie do zalogowania (RPC ma REVOKE
//    dla `anon`, więc zapytanie byłoby błędem uprawnień, nie pustą listą),
// 2. niezapisany dostaje zdanie „zapisz się”, a nie pustą listę,
// 3. przy Chatham House NIE MA siatki osób ANI wyszukiwarki, a JEST liczba
//    i skład grup - to jest cała treść tej reguły na froncie,
// 4. przełącznik wysyła DOKŁADNIE stan docelowy (`true`/`false`), bo RPC
//    przyjmuje `listed`, a nie „przełącz”,
// 5. wyłączona widoczność profilu ZABIERA przełącznik i mówi, gdzie ją włączyć
//    - cichy przełącznik bez efektu byłby gorszy od jego braku,
// 6. karta otwiera OKNO profilu osoby, a nazwa firmy - okno instytucji z osobami
//    z tej firmy; nazwy przycisków niosą nazwisko i nazwę firmy.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { AttendeeDirectory } from "@/lib/events/publicEventApi";

const fetchAttendees = vi.fn<() => Promise<AttendeeDirectory>>();
const setVisibility = vi.fn<(input: { slug: string; listed: boolean }) => Promise<boolean>>();

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options === undefined ? key : `${key}:${JSON.stringify(options)}`,
    i18n: { language: "pl", exists: () => true, changeLanguage: () => Promise.resolve() },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const authState = { user: null as { id: string } | null };
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => authState }));

// Trasa profilu członka (`/people/$slug`) jest cudzą powierzchnią - w teście
// komponentu wystarczy, że odnośnik powstaje z właściwą trasą i slugiem.
// `useRouter` bez routera to `null`: `AppLink` w oknie profilu rysuje wtedy
// zwykłe `<a href>` bez przechwytywania nawigacji.
vi.mock("@tanstack/react-router", () => ({
  useRouter: () => null,
  Link: ({
    to,
    params,
    children,
    ...rest
  }: {
    to: string;
    params?: Record<string, string>;
    children?: unknown;
  }) => (
    <a href={`${to}:${JSON.stringify(params ?? {})}`} {...rest}>
      {children as never}
    </a>
  ),
}));

vi.mock("@/lib/events/publicEventApi", async () => {
  const actual = await vi.importActual<typeof import("@/lib/events/publicEventApi")>(
    "@/lib/events/publicEventApi",
  );
  return {
    ...actual,
    fetchEventAttendees: () => fetchAttendees(),
    setEventAttendeeVisibility: (input: { slug: string; listed: boolean }) => setVisibility(input),
    // Źródła wzbogacające okno (program, partnerzy) budzi pierwszy klik w kartę -
    // w teście są puste, bo okno uczestnika stoi na wierszu listy.
    fetchEventAgenda: () => Promise.resolve([]),
    fetchEventSponsors: () => Promise.resolve([]),
  };
});

// Identyfikator wydarzenia dla katalogu okien - bez sieci; `null` wyłącza też
// zapytanie o prelegentów (czeka na identyfikator).
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

const { EventAttendeesList } =
  await import("@/components/events/public/organisms/EventAttendeesList");

type Row = AttendeeDirectory["rows"][number];

function row(over: Partial<Row> & { registrationId: string; name: string }): Row {
  return {
    userId: null,
    jobTitle: null,
    company: null,
    avatarUrl: null,
    profileSlug: null,
    companyLogoUrl: null,
    companyWebsite: null,
    industry: null,
    specialization: null,
    seekingPl: null,
    seekingEn: null,
    offeringPl: null,
    offeringEn: null,
    bioPl: null,
    bioEn: null,
    socialLinks: {},
    groups: [],
    ...over,
  };
}

function directory(over: Partial<AttendeeDirectory> = {}): AttendeeDirectory {
  return {
    blocked: null,
    chathamHouse: false,
    myRegistrationId: "r1",
    myListed: true,
    myDiscoverable: true,
    myOptOut: false,
    totalCount: 1,
    rows: [
      {
        registrationId: "r1",
        userId: "u2",
        name: "Anna Adamska",
        jobTitle: "Dyrektorka",
        company: "Alfa",
        avatarUrl: null,
        profileSlug: "anna-adamska",
        companyLogoUrl: null,
        companyWebsite: null,
        industry: null,
        specialization: null,
        seekingPl: null,
        seekingEn: null,
        offeringPl: null,
        offeringEn: null,
        bioPl: null,
        bioEn: null,
        socialLinks: {},
        groups: [{ id: "g1", namePl: "Uczestnicy", nameEn: "Attendees", color: "#2563eb" }],
      },
    ],
    groups: [
      { id: "g1", namePl: "Uczestnicy", nameEn: "Attendees", color: "#2563eb", count: 1 },
      { id: "g2", namePl: "Prelegenci", nameEn: "Speakers", color: "#7c3aed", count: 0 },
    ],
    ...over,
  };
}

function renderList() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <EventAttendeesList slug="kongres" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  authState.user = { id: "u1" };
  fetchAttendees.mockResolvedValue(directory());
  setVisibility.mockResolvedValue(true);
});

describe("EventAttendeesList", () => {
  it("gość NIE PYTA BAZY i dostaje zaproszenie do zalogowania", async () => {
    authState.user = null;
    renderList();

    expect(await screen.findByText("eventFront.attendees.signInTitle")).toBeInTheDocument();
    expect(fetchAttendees).not.toHaveBeenCalled();
  });

  it("niezapisany dostaje zdanie o zapisie, a nie pustą listę", async () => {
    fetchAttendees.mockResolvedValue(
      directory({ blocked: "requester_not_participating", rows: [], totalCount: 0 }),
    );
    renderList();

    expect(await screen.findByText("eventFront.attendees.notRegisteredTitle")).toBeInTheDocument();
    expect(screen.queryByText("Anna Adamska")).not.toBeInTheDocument();
  });

  it("zapisany widzi osobę, jej grupę i odnośnik do profilu", async () => {
    renderList();

    expect(await screen.findByText("Anna Adamska")).toBeInTheDocument();
    expect(screen.getByText("Dyrektorka")).toBeInTheDocument();
    expect(screen.getByText("Uczestnicy")).toBeInTheDocument();
    // Karta jest WIZYTÓWKĄ: odnośnik do profilu stoi w oknie, a nie na karcie -
    // na karcie byłby drugim celem kliku obok przycisku, którym jest cała karta.
    expect(screen.queryByRole("link")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Anna Adamska/ }));
    const okno = await screen.findByRole("dialog");
    // Uczestnik to CZŁONEK, nie z definicji autor: profil każdej osoby stoi pod
    // `/people/<slug>`, a `/author` jest tylko dla roli/zaproszenia autora
    // (nie-autora odsyła 301 na `/people`, autora `/people` sam linkuje do huba).
    expect(within(okno).getByRole("link")).toHaveAttribute("href", "/people/anna-adamska");
  });

  it("Chatham House zabiera siatkę osób i wyszukiwarkę, a zostawia liczbę i grupy", async () => {
    fetchAttendees.mockResolvedValue(
      directory({ blocked: "chatham_house", chathamHouse: true, rows: [], totalCount: 120 }),
    );
    renderList();

    expect(await screen.findByText("eventFront.attendees.chathamTitle")).toBeInTheDocument();
    expect(screen.getByText("eventFront.attendees.groupsHeading")).toBeInTheDocument();
    // Liczba WYCHODZI - to jedyna rzecz, którą reguła pozwala powiedzieć.
    expect(screen.getByText('eventFront.attendees.count:{"count":120}')).toBeInTheDocument();
    // Nazwiska, wyszukiwarki i listy nie ma.
    expect(screen.queryByText("Anna Adamska")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("eventFront.attendees.searchLabel")).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "eventFront.attendees.listLabel" })).toBeNull();
  });

  it("przełącznik wysyła STAN DOCELOWY, nie prośbę o przełączenie", async () => {
    renderList();
    await screen.findByText("Anna Adamska");

    fireEvent.click(screen.getByRole("switch"));
    await waitFor(() => expect(setVisibility).toHaveBeenCalledTimes(1));
    expect(setVisibility).toHaveBeenCalledWith({ slug: "kongres", listed: false });
  });

  it("wyłączona widoczność profilu zabiera przełącznik i mówi, gdzie ją włączyć", async () => {
    fetchAttendees.mockResolvedValue(
      directory({ myDiscoverable: false, myListed: false, rows: [], totalCount: 0 }),
    );
    renderList();

    expect(await screen.findByText("eventFront.attendees.profileHiddenLabel")).toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });

  it("grupa z zerem osób nie jest filtrem - klikać w nią nie ma po co", async () => {
    renderList();
    await screen.findByText("Anna Adamska");

    // Dwie grupy w odpowiedzi, jedna z zerem - filtry nie pokazują ani jednej,
    // bo po odrzuceniu pustej zostaje jedna, a jedna grupa to nie wybór.
    expect(screen.queryByText("eventFront.attendees.allGroups")).not.toBeInTheDocument();
  });
});

describe("EventAttendeesList - okna profilu osoby i instytucji", () => {
  it("klik w kartę otwiera okno z nazwiskiem, stanowiskiem, firmą i pełnym profilem", async () => {
    renderList();
    await screen.findByText("Anna Adamska");

    fireEvent.click(
      screen.getByRole("button", {
        name: 'eventFront.directory.openPerson:{"name":"Anna Adamska"}',
      }),
    );
    const okno = await screen.findByRole("dialog");

    expect(within(okno).getByRole("heading", { name: "Anna Adamska" })).toBeInTheDocument();
    expect(within(okno).getByText("Dyrektorka")).toBeInTheDocument();
    // Firma w oknie osoby jest przejściem do okna instytucji, nie martwym tekstem.
    expect(
      within(okno).getByRole("button", {
        name: 'eventFront.directory.openCompany:{"name":"Alfa"}',
      }),
    ).toBeInTheDocument();
    const profil = within(okno).getByRole("link", { name: /eventFront\.directory\.fullProfile/ });
    expect(profil).toHaveAttribute("href", "/people/anna-adamska");
  });

  it("nazwa firmy otwiera okno instytucji z osobami z tej firmy - i tylko z niej", async () => {
    fetchAttendees.mockResolvedValue(
      directory({
        totalCount: 3,
        rows: [
          row({ registrationId: "r1", name: "Anna Adamska", company: "Alfa" }),
          row({ registrationId: "r2", name: "Bartosz Bielecki", company: "ALFA" }),
          row({ registrationId: "r3", name: "Celina Czarnecka", company: "Beta" }),
        ],
      }),
    );
    renderList();
    await screen.findByText("Anna Adamska");

    // Dwie karty z tą samą firmą (wielkość liter nie odróżnia instytucji) -
    // klik w pierwszą z nich.
    const firmy = screen.getAllByRole("button", { name: /eventFront\.directory\.openCompany/ });
    expect(firmy).toHaveLength(3);
    fireEvent.click(firmy[0]);
    const okno = await screen.findByRole("dialog");

    expect(within(okno).getByRole("heading", { name: "Alfa" })).toBeInTheDocument();
    // Klik w firmę NIE otwiera okna osoby z tej samej karty - przycisk firmy
    // leży nad przyciskiem karty, a nie w nim.
    expect(within(okno).queryByRole("heading", { name: "Anna Adamska" })).not.toBeInTheDocument();
    expect(within(okno).getByRole("button", { name: /Anna Adamska/ })).toBeInTheDocument();
    expect(within(okno).getByRole("button", { name: /Bartosz Bielecki/ })).toBeInTheDocument();
    expect(within(okno).queryByText("Celina Czarnecka")).not.toBeInTheDocument();
  });

  it("nazwy przycisków karty niosą nazwisko i nazwę firmy", async () => {
    renderList();
    await screen.findByText("Anna Adamska");

    // Dwadzieścia cztery „Otwórz profil" na stronie to dla czytnika ekranu lista
    // nierozróżnialnych pozycji.
    const osoba = screen.getByRole("button", { name: /Anna Adamska/ });
    expect(osoba).toHaveAttribute("aria-haspopup", "dialog");
    const firma = screen.getByRole("button", { name: /Alfa/ });
    expect(firma).toHaveAttribute("aria-haspopup", "dialog");
    expect(firma).not.toBe(osoba);
    // Firma nie siedzi w przycisku osoby - zagnieżdżone przyciski to błąd HTML.
    expect(osoba.contains(firma)).toBe(false);
  });
});
