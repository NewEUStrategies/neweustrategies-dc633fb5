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
//    pustych wierszy ani odnośników donikąd - ani na karcie, ani w oknie,
// 6. odmowa zapisu widoczności wraca ZDANIEM, a nie cichym powrotem
//    przełącznika - człowiek musi wiedzieć, że nadal jest widoczny.
//
// FAKTY Z OKNA SPRAWDZAMY W OKNIE. Biogram, intencje, sieci, panele i strona
// firmy wyjechały z karty do okna profilu (`directory/`) - asercja, która
// kiedyś czytała kartę, otwiera teraz okno i czyta je.
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { buildEventDirectory } from "@/lib/events/eventDirectory";
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

// Okno osoby bez stanowiska albo firmy dopytuje profil członka - tu bez sieci.
vi.mock("@/lib/profile/memberProfile", async () => {
  const actual = await vi.importActual<typeof import("@/lib/profile/memberProfile")>(
    "@/lib/profile/memberProfile",
  );
  return {
    ...actual,
    memberProfileQueryOptions: (slug: string, userId: string | null) => ({
      queryKey: ["member-profile", slug, userId],
      queryFn: () => Promise.resolve(null),
    }),
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
const { EventDirectoryProvider } =
  await import("@/components/events/public/directory/EventDirectoryContext");
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

/** Klik w kartę osoby i okno profilu, które otwiera (dialog dojeżdża leniwie). */
async function openPerson(name: string): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(name) }));
  return screen.findByRole("dialog");
}

/** Zamyka okno i czeka, aż zniknie z drzewa. */
async function closeDialog(okno: HTMLElement): Promise<void> {
  fireEvent.click(within(okno).getByRole("button", { name: "eventFront.directory.close" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
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
    // Siatka nie ma odnośników wcale - pełny profil stoi w oknie.
    expect(within(grid()).queryAllByRole("link")).toHaveLength(0);

    const oknoMarty = await openPerson("Marta Kowalik");
    expect(within(oknoMarty).queryByRole("link")).not.toBeInTheDocument();
    await closeDialog(oknoMarty);

    // Jedyny odnośnik prowadzi na profil członka - `event_attendees` oddaje tylko
    // osoby z `profiles.discoverable`, więc `get_member_profile` ma co pokazać.
    const oknoIgora = await openPerson("Igor Wiśniewski");
    const links = within(oknoIgora).getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "/people/igor-wisniewski");
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
    // ...bez odnośnika, który nie ma dokąd prowadzić (brak profilu i brak
    // strony firmy), bez przycisku firmy, której nie ma, i bez kafelka loga,
    // którego nie ma z czego zrobić.
    expect(within(grid()).queryAllByRole("link")).toHaveLength(0);
    expect(within(grid()).getAllByRole("button")).toHaveLength(1);
    expect(view.container.querySelector("img")).toBeNull();

    // Pusta linia podpisu czyta się jak uszkodzone dane, a nie jak brak
    // danych - dlatego nagłówków „szukam"/„oferuję" ma NIE BYĆ także w oknie.
    const okno = await openPerson("Marta Kowalik");
    expect(within(okno).queryByText("eventMe.fields.seeking")).not.toBeInTheDocument();
    expect(within(okno).queryByText("eventMe.fields.offering")).not.toBeInTheDocument();
    expect(within(okno).queryByText("eventFront.directory.about")).not.toBeInTheDocument();
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

    // Karta: stanowisko i firma - po nich człowieka poznaje się na sali.
    expect(await screen.findByText("Dyrektorka ds. regulacji")).toBeInTheDocument();
    expect(screen.getByText("Alfa Consulting")).toBeInTheDocument();
    // Biogram i intencje NIE rozpychają karty - są w oknie.
    expect(screen.queryByText("Zajmuje sie regulacjami rynku energii.")).not.toBeInTheDocument();

    const okno = await openPerson("Marta Kowalik");
    expect(within(okno).getByText("Energetyka · Prawo klimatyczne")).toBeInTheDocument();
    // Język interfejsu to „pl", więc wychodzi biografia polska, nie angielska.
    expect(within(okno).getByText("Zajmuje sie regulacjami rynku energii.")).toBeInTheDocument();
    expect(within(okno).queryByText("Works on energy market regulation.")).not.toBeInTheDocument();
    expect(within(okno).getByText("eventMe.fields.seeking")).toBeInTheDocument();
    expect(within(okno).getByText("Partnerzy do projektu wodorowego")).toBeInTheDocument();

    // Z okna osoby do okna jej firmy - strona firmy otwiera się w nowej karcie
    // i NIE wychodzi z serwisu z nagłówkiem odsyłającym - to jest odnośnik na
    // cudzy host.
    fireEvent.click(within(okno).getByRole("button", { name: /Alfa Consulting/ }));
    expect(
      await within(okno).findByRole("heading", { name: "Alfa Consulting" }),
    ).toBeInTheDocument();
    const site = within(okno).getByRole("link", { name: /example\.org/ });
    expect(site).toHaveAttribute("href", "https://example.org/alfa");
    expect(site).toHaveAttribute("target", "_blank");
    // `nofollow` dochodzi w oknie: adres firmy wpisał uczestnik, a odnośnik
    // z treści użytkownika nie przekazuje rangi (ta sama reguła, co strona
    // partnera w oknie instytucji).
    expect(site.getAttribute("rel")?.split(" ").sort()).toEqual([
      "nofollow",
      "noopener",
      "noreferrer",
    ]);
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

    // Karta mówi, ŻE występuje (i ile razy) - siatka nie rośnie do wysokości
    // najbardziej zajętej osoby.
    expect(
      await screen.findByText(
        /eventFront\.directory\.kind\.speaker · eventFront\.directory\.sessionsCount:\{"count":1\}/,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Panel o wodorze")).not.toBeInTheDocument();

    // Sama plakietka „prelegent" nie układa nikomu planu dnia - dopiero tytuł
    // panelu zamienia kartę w decyzję, więc okno go pokazuje.
    const okno = await openPerson("Marta Kowalik");
    expect(within(okno).getByText("Panel o wodorze")).toBeInTheDocument();
    expect(within(okno).getByText("eventFront.directory.atThisEvent")).toBeInTheDocument();
  });
});

describe("EventAttendeesList - karta osoby i powierzchnie obok listy", () => {
  it("klik w kartę otwiera okno osoby, a klik w firmę - okno instytucji", async () => {
    // Odnośniki wychodzące (strona firmy, LinkedIn) i pasek akcji („dodaj do
    // znajomych") wyjechały z karty do okna - karta ma dwa przyciski: całą
    // powierzchnię (osoba) i nazwę firmy NAD nią (instytucja). Klik w firmę
    // nie może otworzyć osoby: dwie akcje z jednego palca to ta sama wada,
    // przed którą chroniło kiedyś zatrzymanie propagacji.
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
    const view = renderList();
    await screen.findByText("Marta Kowalik");

    // Karta nie ma odnośników na cudze hosty - nic tu nie otworzy cudzego adresu.
    expect(within(grid()).queryAllByRole("link")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: /Alfa Consulting/ }));
    const okno = await screen.findByRole("dialog");
    expect(within(okno).getByRole("heading", { name: "Alfa Consulting" })).toBeInTheDocument();
    expect(within(okno).queryByRole("heading", { name: "Marta Kowalik" })).not.toBeInTheDocument();
    await closeDialog(okno);

    // Sieci osoby są w oknie osoby - z nazwą sieci, nie samą ikoną.
    const oknoOsoby = await openPerson("Marta Kowalik");
    expect(within(oknoOsoby).getByRole("heading", { name: "Marta Kowalik" })).toBeInTheDocument();
    expect(
      within(oknoOsoby).getByRole("link", { name: "eventMe.social.linkedin" }),
    ).toHaveAttribute("href", "https://example.org/in/marta-kowalik");

    // Logo firmy na karcie jest ozdobą wiersza, a nie treścią - czytnik ekranu
    // ma je minąć (nazwa firmy stoi obok tekstem).
    const logo = view.container.querySelector("img");
    expect(logo).not.toBeNull();
    expect(logo).toHaveAttribute("alt", "");
    expect(logo?.closest('[aria-hidden="true"]')).not.toBeNull();
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
    await screen.findByText("Marta Kowalik");

    const okno = await openPerson("Marta Kowalik");
    expect(within(okno).getByText("Works on energy market regulation.")).toBeInTheDocument();
    expect(within(okno).getByText("Partners for a hydrogen project")).toBeInTheDocument();
    expect(within(okno).getByText("Regulatory advice")).toBeInTheDocument();
    expect(within(okno).getByText("Hydrogen panel")).toBeInTheDocument();
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
    await screen.findByText("Marta Kowalik");

    // Pusty wiersz pod nagłówkiem „na tym wydarzeniu" czyta się jak awaria strony.
    const okno = await openPerson("Marta Kowalik");
    expect(within(okno).getByText("ses-bez-tytulu")).toBeInTheDocument();
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
    // Bez mapy wystąpień wzmianka o panelach po prostu nie powstaje: „prelegent
    // · 0 sesji" czytałoby się jak utracone dane o prelegencie.
    expect(screen.queryByText(/eventFront\.directory\.kind\.speaker/)).not.toBeInTheDocument();
  });

  it("siatka bez dostawcy okien jest samym tekstem - żadnego przycisku donikąd", () => {
    // Widok siatki NIE stawia dostawcy sam (robi to lista publiczna albo
    // podgląd studia nad nim). Bez niego przycisk, który niczego nie otwiera,
    // byłby atrapą - a obietnica „Zobacz profil" kłamstwem.
    renderGrid([
      entry({
        registrationId: "reg-1",
        name: "Marta Kowalik",
        jobTitle: "Analityczka",
        company: "Alfa Consulting",
      }),
    ]);

    expect(screen.getByText("Marta Kowalik")).toBeInTheDocument();
    expect(screen.getByText("Analityczka")).toBeInTheDocument();
    expect(screen.getByText("Alfa Consulting")).toBeInTheDocument();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryByText("eventFront.directory.viewProfile")).not.toBeInTheDocument();
  });

  it("siatka pod dostawcą z zewnątrz (podgląd studia) otwiera to samo okno", async () => {
    // Podgląd studia składa katalog z RPC panelu i stawia dostawcę z
    // `live={false}` nad tym widokiem - karta ma wtedy działać tak samo, a
    // odnośnik pełnego profilu ma być tekstem (klik wyprowadziłby ze studia).
    const entries = [
      entry({
        registrationId: "reg-1",
        name: "Marta Kowalik",
        jobTitle: "Analityczka",
        profileSlug: "marta-kowalik",
      }),
    ];
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    render(
      <QueryClientProvider client={client}>
        <EventDirectoryProvider
          directory={buildEventDirectory({ attendees: entries }, "pl")}
          slug={null}
          eventId={null}
          live={false}
        >
          <EventAttendeesGridView entries={entries} lang="pl" />
        </EventDirectoryProvider>
      </QueryClientProvider>,
    );

    const okno = await openPerson("Marta Kowalik");
    expect(within(okno).getByRole("heading", { name: "Marta Kowalik" })).toBeInTheDocument();
    expect(within(okno).getByText("eventFront.directory.fullProfile")).toBeInTheDocument();
    expect(within(okno).queryByRole("link")).not.toBeInTheDocument();
  });
});
