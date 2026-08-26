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
//    - cichy przełącznik bez efektu byłby gorszy od jego braku.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

// Trasa profilu autora jest cudzą powierzchnią - w teście komponentu wystarczy,
// że odnośnik powstaje z właściwym slugiem.
vi.mock("@tanstack/react-router", () => ({
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
  };
});

const { EventAttendeesList } =
  await import("@/components/events/public/organisms/EventAttendeesList");

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
        name: "Anna Adamska",
        jobTitle: "Dyrektorka",
        company: "Alfa",
        avatarUrl: null,
        profileSlug: "anna-adamska",
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
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      '/author/$slug:{"slug":"anna-adamska"}',
    );
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
