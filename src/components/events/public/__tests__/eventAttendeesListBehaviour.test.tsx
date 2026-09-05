// UCZESTNICY, DRUGA warstwa: dane osobowe i okno zapytania.
//
// PO CO OSOBNY PLIK. Sąsiad (`eventAttendeesList.test.tsx`) pilnuje bramek
// dostępu - gość, niezapisany, Chatham House, przełącznik widoczności. Tutaj
// stoi to, co po zepsuciu POKAZUJE CZŁOWIEKA, KTÓRY SIĘ NA TO NIE ZGODZIŁ,
// albo każe przeglądarce trzymać listę, której nie powinna zobaczyć.
//
// FIXTURE'Y SĄ SYNTETYCZNE. Żadnego prawdziwego nazwiska, żadnej prawdziwej
// firmy, adresy wyłącznie w domenach dokumentacyjnych - lista uczestników to
// dokładnie ten zbiór danych, którego nie wolno wpisać do repozytorium.
//
// SZEŚĆ RZECZY, KTÓRE MUSZĄ TRZYMAĆ:
// 1. SIATKA RYSUJE DOKŁADNIE WIERSZE Z BAZY - ani jednej osoby więcej. Kto
//    wypadł z `event_attendees` (zgoda platformowa, `directory_opt_out`,
//    Chatham House), ten nie ma jak wrócić przez front; własna karta wołającego
//    też się nie dokleja, choć `my_registration_id` przyjeżdża w tej samej
//    odpowiedzi,
// 2. FRAZA I GRUPA IDĄ DO BAZY, a nie filtrują wierszy w przeglądarce - filtr
//    po stronie klienta wymagałby ściągnięcia CAŁEJ listy do przeglądarki,
// 3. stronicowanie przesuwa OKNO zapytania (`offset`), a nie tnie tablicę,
// 4. odmowa i pustka mają OSOBNE zdania - „nikogo tu nie ma" po wpisaniu frazy
//    byłoby nieprawdą o wydarzeniu,
// 5. niepełna kartoteka (bez stanowiska, bez firmy, bez profilu) nie zostawia
//    pustych wierszy ani odnośników donikąd,
// 6. odmowa zapisu widoczności wraca ZDANIEM, a nie cichym powrotem
//    przełącznika - człowiek musi wiedzieć, że nadal jest widoczny.
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { AttendeeDirectory, AttendeeEntry } from "@/lib/events/publicEventApi";
import type { SpeakerSessionEntry } from "@/lib/events/participantTicketsApi";

interface AttendeesInput {
  slug: string;
  q?: string;
  groupId?: string | null;
  limit: number;
  offset: number;
}

const fetchAttendees = vi.fn<(input: AttendeesInput) => Promise<AttendeeDirectory>>();
const setVisibility = vi.fn<(input: { slug: string; listed: boolean }) => Promise<boolean>>();
const fetchSpeakerSessions = vi.fn<(slug: string) => Promise<Map<string, SpeakerSessionEntry[]>>>();
const errorToast = vi.fn<(message: string) => void>();

const language = { current: "pl" };

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options === undefined ? key : `${key}:${JSON.stringify(options)}`,
    i18n: {
      get language() {
        return language.current;
      },
      exists: () => true,
      changeLanguage: () => Promise.resolve(),
    },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: (message: string) => errorToast(message), info: vi.fn() },
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
    children?: ReactNode;
    className?: string;
  }) => (
    <a href={`${to}:${JSON.stringify(params ?? {})}`} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/events/publicEventApi", async () => {
  const actual = await vi.importActual<typeof import("@/lib/events/publicEventApi")>(
    "@/lib/events/publicEventApi",
  );
  return {
    ...actual,
    fetchEventAttendees: (input: AttendeesInput) => fetchAttendees(input),
    setEventAttendeeVisibility: (input: { slug: string; listed: boolean }) => setVisibility(input),
  };
});

vi.mock("@/lib/events/participantTicketsApi", async () => {
  const actual = await vi.importActual<typeof import("@/lib/events/participantTicketsApi")>(
    "@/lib/events/participantTicketsApi",
  );
  return { ...actual, fetchEventSpeakerSessions: (slug: string) => fetchSpeakerSessions(slug) };
});

const { EventAttendeesList, EventAttendeesGridView } =
  await import("@/components/events/public/organisms/EventAttendeesList");
const i18n = (await import("@/lib/i18n")).default;

function entry(
  over: Partial<AttendeeEntry> & { registrationId: string; name: string },
): AttendeeEntry {
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
    myRegistrationId: "reg-wolajacy",
    myListed: true,
    myDiscoverable: true,
    myOptOut: false,
    totalCount: 1,
    rows: [entry({ registrationId: "reg-1", name: "Marta Kowalik" })],
    groups: [],
    ...over,
  };
}

function renderList(heading = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <EventAttendeesList slug="kongres" heading={heading} />
    </QueryClientProvider>,
  );
}

/** Sama siatka, bez zapytania - tak rysuje ją podgląd studia. */
function renderGrid(entries: AttendeeEntry[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <EventAttendeesGridView entries={entries} lang="pl" />
    </QueryClientProvider>,
  );
}

/** Siatka osób - jedyna lista z tą etykietą; karty mają własne listy w środku. */
function grid(): HTMLElement {
  return screen.getByRole("list", { name: "eventFront.attendees.listLabel" });
}

beforeEach(() => {
  vi.clearAllMocks();
  language.current = "pl";
  authState.user = { id: "u-wolajacy" };
  fetchAttendees.mockResolvedValue(directory());
  setVisibility.mockResolvedValue(true);
  fetchSpeakerSessions.mockResolvedValue(new Map());
});

describe("EventAttendeesList - kto trafia na listę", () => {
  it("siatka rysuje DOKŁADNIE wiersze z bazy - ukryty uczestnik nie ma jak wrócić", async () => {
    // „Bogumił Zawadzki" wypadł z `event_attendees` w SQL (wyłączona widoczność
    // w katalogu). Front nie zna go z żadnego innego źródła i NIE MOŻE go
    // dorysować - dlatego w tym pliku nie ma ani jednej gałęzi o widoczności
    // cudzych danych, a ten test pilnuje, żeby żadna nie przyszła.
    fetchAttendees.mockResolvedValue(
      directory({
        totalCount: 2,
        rows: [
          entry({ registrationId: "reg-1", name: "Marta Kowalik" }),
          entry({ registrationId: "reg-2", name: "Igor Wiśniewski" }),
        ],
      }),
    );
    renderList();

    await screen.findByText("Marta Kowalik");
    expect(grid().children).toHaveLength(2);
    expect(screen.queryByText("Bogumił Zawadzki")).not.toBeInTheDocument();
  });

  it("wołający, który nie jest na liście, nie dokleja się do siatki z własnego zgłoszenia", async () => {
    // `my_registration_id` wraca w tej samej odpowiedzi co wiersze - to jest
    // kandydat na „a mnie pokażmy zawsze", czyli na ujawnienie osoby, która
    // się wypisała.
    fetchAttendees.mockResolvedValue(
      directory({
        myListed: false,
        myRegistrationId: "reg-wolajacy",
        totalCount: 1,
        rows: [entry({ registrationId: "reg-1", name: "Marta Kowalik" })],
      }),
    );
    renderList();

    await screen.findByText("Marta Kowalik");
    expect(grid().children).toHaveLength(1);
    // Wypisany widzi WPROST, że go na liście nie ma - inaczej nie wie, czy
    // przełącznik zadziałał.
    expect(screen.getByText("eventFront.attendees.listedOff")).toBeInTheDocument();
  });

  it("uczestnik bez profilu publicznego nie dostaje odnośnika donikąd", async () => {
    fetchAttendees.mockResolvedValue(
      directory({
        totalCount: 2,
        rows: [
          entry({ registrationId: "reg-1", name: "Marta Kowalik", profileSlug: null }),
          entry({
            registrationId: "reg-2",
            name: "Igor Wiśniewski",
            profileSlug: "igor-wisniewski",
          }),
        ],
      }),
    );
    renderList();

    await screen.findByText("Marta Kowalik");
    const links = within(grid()).getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", '/author/$slug:{"slug":"igor-wisniewski"}');
  });
});

describe("EventAttendeesList - okno zapytania zamiast filtra w przeglądarce", () => {
  it("wpisana fraza idzie DO BAZY i to baza decyduje, kto pasuje", async () => {
    // Baza szuka także po firmie i stanowisku, więc odpowiedź na „alfa" ma
    // prawo zawierać nazwisko bez tej litery. Filtr dorobiony w przeglądarce
    // schowałby ten wiersz - i wymagałby wcześniej ściągnięcia CAŁEJ listy.
    fetchAttendees.mockImplementation((input) =>
      Promise.resolve(
        input.q === "alfa"
          ? directory({
              totalCount: 1,
              rows: [
                entry({
                  registrationId: "reg-9",
                  name: "Zbigniew Małecki",
                  company: "Alfa Consulting",
                }),
              ],
            })
          : directory(),
      ),
    );
    renderList();
    await screen.findByText("Marta Kowalik");

    fireEvent.change(screen.getByLabelText("eventFront.attendees.searchLabel"), {
      target: { value: "alfa" },
    });

    expect(await screen.findByText("Zbigniew Małecki")).toBeInTheDocument();
    expect(screen.queryByText("Marta Kowalik")).not.toBeInTheDocument();
    expect(fetchAttendees).toHaveBeenLastCalledWith({
      slug: "kongres",
      q: "alfa",
      groupId: null,
      limit: 24,
      offset: 0,
    });
  });

  it("przeładowanie listy po frazie ZOSTAWIA FOKUS w polu wyszukiwania", async () => {
    // CO JEST ZŁE. Nowa fraza to nowy klucz cache, a nowy klucz nie ma
    // danych, więc `attendees.isLoading` jest prawdą i CAŁE ciało sekcji -
    // razem z `Filters`, czyli z polem wyszukiwania - zostaje zastąpione
    // szkieletami. Pole znika z drzewa i wraca jako NOWY węzeł, więc fokus
    // ląduje na `body`.
    //
    // DLACZEGO TO BOLI. Uczestnik szukający nazwiska pisze dłużej niż 300 ms
    // debouncingu: po pierwszej pauzie traci kursor, a kolejne znaki nie
    // trafiają nigdzie. Wpisanie „kowalik" wymaga wtedy kliknięcia w pole
    // po każdej pauzie w pisaniu.
    //
    // JAK JEST NAPRAWIONE: lista trzyma OSTATNIĄ odpowiedź na ekranie do czasu,
    // aż przyjdzie następna, więc szkielety zastępują ciało sekcji tylko przy
    // PIERWSZYM wczytaniu - pole wyszukiwania nie znika i nie wraca jako nowy
    // węzeł DOM.
    renderList();
    const pole = await screen.findByLabelText("eventFront.attendees.searchLabel");
    (pole as HTMLInputElement).focus();
    expect(document.activeElement).toBe(pole);

    fireEvent.change(pole, { target: { value: "kow" } });
    await waitFor(() =>
      expect(fetchAttendees).toHaveBeenLastCalledWith(expect.objectContaining({ q: "kow" })),
    );
    await screen.findByText("Marta Kowalik");

    // Tak POWINNO być: kursor zostaje w polu, w które uczestnik pisze.
    expect(document.activeElement).toBe(screen.getByLabelText("eventFront.attendees.searchLabel"));
  });

  it("wybór grupy pyta bazę o grupę i wraca na pierwszą stronę", async () => {
    const groups = [
      { id: "g1", namePl: "Uczestnicy", nameEn: "Attendees", color: null, count: 30 },
      { id: "g2", namePl: "Prelegenci", nameEn: "Speakers", color: null, count: 8 },
    ];
    fetchAttendees.mockImplementation((input) =>
      Promise.resolve(
        directory({
          groups,
          totalCount: input.groupId === "g2" ? 8 : 38,
          rows: [entry({ registrationId: "reg-1", name: "Marta Kowalik" })],
        }),
      ),
    );
    renderList();
    await screen.findByText("Marta Kowalik");

    // Najpierw druga strona, żeby było widać, że wybór grupy ZERUJE okno:
    // trzecia strona wyników sprzed filtra nie opisuje wyników po filtrze.
    fireEvent.click(screen.getByText("eventFront.attendees.nextPage"));
    await waitFor(() =>
      expect(fetchAttendees).toHaveBeenLastCalledWith(
        expect.objectContaining({ offset: 24, groupId: null }),
      ),
    );
    // Nowe okno to nowy klucz cache, więc siatka wraca dopiero po odpowiedzi -
    // filtry są wtedy z powrotem na ekranie.
    await screen.findByText("Marta Kowalik");

    fireEvent.click(screen.getByRole("button", { name: "Prelegenci" }));
    await waitFor(() =>
      expect(fetchAttendees).toHaveBeenLastCalledWith({
        slug: "kongres",
        q: "",
        groupId: "g2",
        limit: 24,
        offset: 0,
      }),
    );

    await screen.findByText("Marta Kowalik");
    fireEvent.click(screen.getByRole("button", { name: "eventFront.attendees.allGroups" }));
    await waitFor(() =>
      expect(fetchAttendees).toHaveBeenLastCalledWith(expect.objectContaining({ groupId: null })),
    );
  });

  it("stronicowanie przesuwa OKNO zapytania i mówi, który zakres widać", async () => {
    const rows = Array.from({ length: 24 }, (_unused, index) =>
      entry({ registrationId: `reg-${index}`, name: `Osoba Testowa ${index}` }),
    );
    fetchAttendees.mockImplementation((input) =>
      Promise.resolve(
        directory({ totalCount: 50, rows: input.offset === 0 ? rows : rows.slice(0, 24) }),
      ),
    );
    renderList();
    await screen.findByText("Osoba Testowa 0");

    // Na pierwszej stronie „wstecz" nie ma dokąd prowadzić.
    expect(screen.getByText("eventFront.attendees.prevPage")).toBeDisabled();
    expect(
      screen.getByText('eventFront.attendees.pageRange:{"from":1,"to":24,"total":50}'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByText("eventFront.attendees.nextPage"));
    await waitFor(() =>
      expect(fetchAttendees).toHaveBeenLastCalledWith(
        expect.objectContaining({ offset: 24, limit: 24 }),
      ),
    );
    expect(
      await screen.findByText('eventFront.attendees.pageRange:{"from":25,"to":48,"total":50}'),
    ).toBeInTheDocument();

    // Powrót też jest OKNEM, a nie cofnięciem w przeglądarce - inaczej „wstecz"
    // pokazywałoby wiersze sprzed zmiany na liście.
    fireEvent.click(screen.getByText("eventFront.attendees.prevPage"));
    await waitFor(() =>
      expect(fetchAttendees).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 0 })),
    );
  });

  it("lista mieszcząca się na jednej stronie nie dostaje przycisków stronicowania", async () => {
    renderList();
    await screen.findByText("Marta Kowalik");

    // Licznik JEST, i to on odróżnia „cała lista mieści się na stronie" od
    // „lista się nie doczytała".
    expect(screen.getByText('eventFront.attendees.count:{"count":1}')).toBeInTheDocument();
    // Para przycisków nad jedną stroną obiecuje wiersze, których nie ma, a
    // zakres „1-1 z 1" jest zdaniem o niczym.
    expect(screen.queryByText("eventFront.attendees.nextPage")).not.toBeInTheDocument();
    expect(screen.queryByText("eventFront.attendees.prevPage")).not.toBeInTheDocument();
    expect(screen.queryByText(/eventFront\.attendees\.pageRange/)).not.toBeInTheDocument();
  });
});

describe("EventAttendeesList - odmowy, pustka i niepełna kartoteka", () => {
  it("nieosiągalny katalog mówi zdaniem ze słownika, a nie komunikatem bazy", async () => {
    fetchAttendees.mockRejectedValue(new Error("permission denied for function event_attendees"));
    renderList();

    expect(await screen.findByText(i18n.t("eventFront.errors.unknown"))).toBeInTheDocument();
    expect(screen.queryByText(/permission denied/)).not.toBeInTheDocument();
  });

  it("pusty katalog bez filtrów mówi co innego niż katalog opróżniony frazą", async () => {
    fetchAttendees.mockResolvedValue(directory({ totalCount: 0, rows: [], groups: [] }));
    renderList();

    expect(await screen.findByText("eventFront.attendees.empty")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("eventFront.attendees.searchLabel"), {
      target: { value: "kowalik" },
    });
    // Po wpisaniu frazy zdanie „nikogo tu nie ma" byłoby nieprawdą o wydarzeniu.
    expect(await screen.findByText("eventFront.attendees.emptyFiltered")).toBeInTheDocument();
  });

  it("odmowa zapisu widoczności wraca zdaniem, a nie cichym powrotem przełącznika", async () => {
    setVisibility.mockRejectedValue(new Error("requester_not_participating: nope"));
    renderList();
    await screen.findByText("Marta Kowalik");
    // Przełącznik startuje w pozycji „jestem na liście" - dopiero to czyni
    // z kliknięcia decyzję o ZEJŚCIU z listy.
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");

    fireEvent.click(screen.getByRole("switch"));
    await waitFor(() => expect(errorToast).toHaveBeenCalledTimes(1));
    expect(errorToast).toHaveBeenCalledWith(i18n.t("eventFront.errors.requesterNotParticipating"));
    // Zapis idzie ze SLUGIEM wydarzenia: bez niego RPC
    // `event_meeting_directory_visibility_set` zdjąłby człowieka z listy INNEGO
    // wydarzenia, na które też jest zapisany. Zawężenie najemcem siedzi w SQL -
    // pilnuje go bramka `check:sql-tenant-scope`.
    expect(setVisibility).toHaveBeenCalledWith({ slug: "kongres", listed: false });
    // Po odmowie człowiek NADAL JEST WIDOCZNY i przełącznik ma to mówić. Samo
    // zdanie bez powrotu kontrolki zostawiłoby go w przekonaniu, że zszedł
    // z listy - czyli w nieprawdzie o własnych danych.
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("eventFront.attendees.listedOn")).toBeInTheDocument();
  });

  it("kartoteka bez stanowiska, firmy i intencji nie zostawia pustych wierszy", async () => {
    const view = renderList();
    await screen.findByText("Marta Kowalik");

    // Wiersz niepełny NADAL JEST WIERSZEM: osoba, której organizator nie wpisał
    // stanowiska, ma zostać na liście - to jej uczestnik tu szuka.
    expect(grid().children).toHaveLength(1);
    // Pusta linia podpisu w siatce czyta się jak uszkodzone dane, a nie jak
    // brak danych - dlatego nagłówków „szukam"/„oferuję" ma NIE BYĆ.
    expect(screen.queryByText("eventMe.fields.seeking")).not.toBeInTheDocument();
    expect(screen.queryByText("eventMe.fields.offering")).not.toBeInTheDocument();
    // ...ani odnośnika, który nie ma dokąd prowadzić (brak profilu i brak
    // strony firmy), ani kafelka loga, którego nie ma z czego zrobić.
    expect(within(grid()).queryAllByRole("link")).toHaveLength(0);
    expect(view.container.querySelector("img")).toBeNull();
  });

  it("pełna kartoteka pokazuje stanowisko, branżę i intencje w języku interfejsu", async () => {
    fetchAttendees.mockResolvedValue(
      directory({
        rows: [
          entry({
            registrationId: "reg-1",
            name: "Marta Kowalik",
            jobTitle: "Dyrektorka ds. regulacji",
            company: "Alfa Consulting",
            companyWebsite: "https://example.org/alfa",
            industry: "Energetyka",
            specialization: "Prawo klimatyczne",
            bioPl: "Zajmuje sie regulacjami rynku energii.",
            bioEn: "Works on energy market regulation.",
            seekingPl: "Partnerzy do projektu wodorowego",
            offeringPl: "Doradztwo regulacyjne",
          }),
        ],
      }),
    );
    renderList();

    expect(await screen.findByText("Dyrektorka ds. regulacji")).toBeInTheDocument();
    expect(screen.getByText("Energetyka")).toBeInTheDocument();
    expect(screen.getByText("Prawo klimatyczne")).toBeInTheDocument();
    // Język interfejsu to „pl", więc wychodzi biografia polska, nie angielska.
    expect(screen.getByText("Zajmuje sie regulacjami rynku energii.")).toBeInTheDocument();
    expect(screen.queryByText("Works on energy market regulation.")).not.toBeInTheDocument();
    expect(screen.getByText("eventMe.fields.seeking")).toBeInTheDocument();

    // Strona firmy otwiera się w nowej karcie i NIE wychodzi z serwisu
    // z nagłówkiem odsyłającym - to jest odnośnik na cudzy host.
    const site = screen.getByRole("link", { name: "Alfa Consulting" });
    expect(site).toHaveAttribute("target", "_blank");
    expect(site).toHaveAttribute("rel", "noreferrer noopener");
  });

  it("prelegent na liście mówi, w którym panelu go szukać", async () => {
    fetchAttendees.mockResolvedValue(
      directory({
        rows: [entry({ registrationId: "reg-1", name: "Marta Kowalik" })],
      }),
    );
    fetchSpeakerSessions.mockResolvedValue(
      new Map([
        [
          "reg-1",
          [
            {
              sessionId: "ses-1",
              titlePl: "Panel o wodorze",
              titleEn: "Hydrogen panel",
              startsAt: "2026-09-01T08:00:00Z",
              endsAt: "2026-09-01T09:00:00Z",
              role: "speaker",
            },
          ],
        ],
      ]),
    );
    renderList();

    // Sama plakietka „prelegent" nie układa nikomu planu dnia - dopiero tytuł
    // panelu zamienia kartę w decyzję.
    expect(await screen.findByText("Panel o wodorze")).toBeInTheDocument();
    expect(screen.getByText("eventFront.attendees.speakerSessions")).toBeInTheDocument();
  });
});

describe("EventAttendeesList - karta osoby i powierzchnie obok listy", () => {
  it("odnośniki na karcie nie porywają kliku, który należy do powierzchni nad listą", async () => {
    // Karta stoi w siatce, którą powłoka wydarzenia może opakować własnym
    // klikiem (podgląd, panel boczny). Bez zatrzymania propagacji klik w
    // „LinkedIn" albo w pasek akcji uruchamiałby JESZCZE tamto - dwie akcje
    // z jednego palca, w tym otwarcie cudzego adresu.
    fetchAttendees.mockResolvedValue(
      directory({
        rows: [
          entry({
            registrationId: "reg-1",
            name: "Marta Kowalik",
            company: "Alfa Consulting",
            companyWebsite: "https://example.org/alfa",
            companyLogoUrl: "https://example.com/alfa-logo.png",
            socialLinks: { linkedin: "https://example.org/in/marta-kowalik" },
          }),
        ],
      }),
    );
    const klikPowloki = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const view = render(
      <QueryClientProvider client={client}>
        <div onClick={klikPowloki}>
          <EventAttendeesList slug="kongres" />
        </div>
      </QueryClientProvider>,
    );
    await screen.findByText("Marta Kowalik");

    // Test NIE WYCHODZI DO SIECI: kliknięty odnośnik na cudzy host jest
    // realnym adresem, a happy-dom wykonałby jego domyślną akcję.
    const bezNawigacji = (event: Event) => event.preventDefault();
    document.addEventListener("click", bezNawigacji, true);

    fireEvent.click(screen.getByRole("link", { name: "Alfa Consulting" }));
    fireEvent.click(screen.getByRole("link", { name: "eventMe.social.linkedin" }));
    // Pasek akcji („dodaj do znajomych", „umów spotkanie") jest ostatnim
    // blokiem karty i też nie może przepuszczać kliku wyżej.
    const karta = screen.getByText("Marta Kowalik").closest("div.rounded-md");
    expect(karta).not.toBeNull();
    fireEvent.click((karta as HTMLElement).lastElementChild as HTMLElement);

    expect(klikPowloki).not.toHaveBeenCalled();

    // Kontrola próby: zwykły klik w kartę DOCHODZI wyżej - inaczej ten test
    // przechodziłby także wtedy, gdyby nikt nigdzie nie klikał.
    fireEvent.click(screen.getByText("Marta Kowalik"));
    expect(klikPowloki).toHaveBeenCalledTimes(1);

    document.removeEventListener("click", bezNawigacji, true);

    // Logo firmy jest ozdobą wiersza, a nie treścią - czytnik ekranu ma je minąć.
    const logo = view.container.querySelector("img");
    expect(logo).not.toBeNull();
    expect(logo).toHaveAttribute("alt", "");
    expect(logo).toHaveAttribute("aria-hidden", "true");
  });

  it("język interfejsu wybiera kolumnę biografii, intencji i tytułu panelu", async () => {
    language.current = "en";
    fetchAttendees.mockResolvedValue(
      directory({
        rows: [
          entry({
            registrationId: "reg-1",
            name: "Marta Kowalik",
            bioPl: "Zajmuje sie regulacjami rynku energii.",
            bioEn: "Works on energy market regulation.",
            seekingPl: "Partnerzy do projektu wodorowego",
            seekingEn: "Partners for a hydrogen project",
            offeringPl: "Doradztwo regulacyjne",
            offeringEn: "Regulatory advice",
          }),
        ],
      }),
    );
    fetchSpeakerSessions.mockResolvedValue(
      new Map([
        [
          "reg-1",
          [
            {
              sessionId: "ses-1",
              titlePl: "Panel o wodorze",
              titleEn: "Hydrogen panel",
              startsAt: null,
              endsAt: null,
              role: "speaker",
            },
          ],
        ],
      ]),
    );
    renderList();

    expect(await screen.findByText("Works on energy market regulation.")).toBeInTheDocument();
    expect(screen.getByText("Partners for a hydrogen project")).toBeInTheDocument();
    expect(screen.getByText("Regulatory advice")).toBeInTheDocument();
    expect(screen.getByText("Hydrogen panel")).toBeInTheDocument();
    expect(screen.queryByText("Panel o wodorze")).not.toBeInTheDocument();
  });

  it("panel bez tytułu w żadnym języku pokazuje identyfikator, a nie pustą kropkę", async () => {
    fetchSpeakerSessions.mockResolvedValue(
      new Map([
        [
          "reg-1",
          [
            {
              sessionId: "ses-bez-tytulu",
              titlePl: null,
              titleEn: null,
              startsAt: null,
              endsAt: null,
              role: "speaker",
            },
          ],
        ],
      ]),
    );
    renderList();

    // Pusty wiersz pod nagłówkiem „występuje w" czyta się jak awaria strony.
    expect(await screen.findByText("ses-bez-tytulu")).toBeInTheDocument();
  });

  it("bez własnego nagłówka lista nie wskazuje na nieistniejący węzeł", async () => {
    // Na trasie `/events/<slug>/participants` nagłówek „Uczestnicy" rysuje
    // dokument CMS-a nad listą - drugi byłby tym samym słowem dwa razy, a
    // `aria-labelledby` wskazywałoby wtedy w pustkę.
    const view = renderList(false);
    await screen.findByText("Marta Kowalik");

    expect(screen.queryByText("eventFront.attendees.heading")).not.toBeInTheDocument();
    const sekcja = view.container.querySelector("section");
    expect(sekcja).not.toBeNull();
    expect(sekcja).not.toHaveAttribute("aria-labelledby");
  });

  it("Chatham House bez grup nie rysuje pustej ramki składu sali", async () => {
    fetchAttendees.mockResolvedValue(
      directory({
        blocked: "chatham_house",
        chathamHouse: true,
        rows: [],
        totalCount: 80,
        groups: [],
      }),
    );
    renderList();

    expect(await screen.findByText("eventFront.attendees.chathamTitle")).toBeInTheDocument();
    // Nagłówek „skład sali" nad zerem grup nie jest informacją, tylko ramką.
    expect(screen.queryByText("eventFront.attendees.groupsHeading")).not.toBeInTheDocument();
  });

  it("skład sali przy Chatham House bierze kolor grupy z panelu, gdy jest", async () => {
    fetchAttendees.mockResolvedValue(
      directory({
        blocked: "chatham_house",
        chathamHouse: true,
        rows: [],
        totalCount: 80,
        groups: [
          { id: "g1", namePl: "Uczestnicy", nameEn: "Attendees", color: "#2563eb", count: 72 },
          { id: "g2", namePl: "Partnerzy", nameEn: "Partners", color: null, count: 0 },
        ],
      }),
    );
    renderList();

    await screen.findByText("eventFront.attendees.groupsHeading");
    // Grupa z zerem osób ZOSTAJE: „Partnerzy 0" mówi o składzie sali, a to
    // jedyna rzecz, którą reguła pozwala powiedzieć.
    expect(
      screen.getByText(/Partnerzy.*eventFront\.attendees\.groupCount/, { exact: false }),
    ).toBeInTheDocument();
    expect(screen.getByText('eventFront.attendees.count:{"count":80}')).toBeInTheDocument();
  });

  it("siatka rysowana bez mapy paneli nie udaje, że nikt nie jest prelegentem", async () => {
    // Podgląd studia składa listę z RPC panelu i nie ma mapy wystąpień -
    // ta sama siatka ma wtedy narysować karty bez sekcji paneli, a nie paść.
    renderGrid([
      entry({
        registrationId: "reg-1",
        name: "Marta Kowalik",
        groups: [{ id: "g1", namePl: "Uczestnicy", nameEn: "Attendees", color: "#2563eb" }],
      }),
    ]);

    expect(grid().children).toHaveLength(1);
    expect(screen.getByText("Marta Kowalik")).toBeInTheDocument();
    // Plakietka grupy to przepustka, czyli FAKT o osobie - podgląd studia ma
    // pokazać redaktorowi tę samą kartę, co uczestnikowi, a nie jej zarys.
    expect(screen.getByText("Uczestnicy")).toBeInTheDocument();
    // Bez mapy wystąpień sekcja paneli po prostu nie powstaje: pusty nagłówek
    // „występuje w" czytałby się jak utracone dane o prelegencie.
    expect(screen.queryByText("eventFront.attendees.speakerSessions")).not.toBeInTheDocument();
  });
});
