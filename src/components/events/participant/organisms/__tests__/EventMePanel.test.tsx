// PANEL UCZESTNIKA NA WYDARZENIU (`/events/<slug>/me`) - pięć pytań, jeden ekran.
//
// CO TEN PLIK DOWODZI I DLACZEGO TO WAŻNE:
//
//  1. GOŚĆ DOSTAJE ZAPROSZENIE DO LOGOWANIA, A NIE PUSTY EKRAN ANI PRZEKIEROWANIE.
//     Trasa celowo nie ma bramki: uczestnik przychodzi tu z maila i ma zobaczyć,
//     GDZIE jest, zanim się zaloguje. Przy okazji: niezalogowany NIE WYSYŁA
//     ŻADNEGO zapytania o kartotekę - RPC i tak odmówiłoby, a próba kosztuje
//     limit i zostawia ślad w logu.
//
//  2. PANEL SKŁADA, A NIE KOPIUJE. Kartoteka, harmonogram, kontakty, networking
//     i bilety to PIĘĆ istniejących organizmów; każdy dostaje slug TEGO
//     wydarzenia. Przekazany zły slug (albo brak sluga) pokazuje uczestnikowi
//     cudze bilety i cudze spotkania, a wygląda dokładnie tak samo.
//
//  3. PLAKIETKA STANU ZGŁOSZENIA MÓWI PRAWDĘ. „Potwierdzone” i „oczekujące” to
//     dwa różne zdania; brak zgłoszenia to BRAK plakietki, a nie „oczekujące” -
//     bo ktoś, kto się nie zapisał, niczego nie oczekuje.
//
//  4. PODGLĄD PUBLICZNY JEST SPOSOBEM PATRZENIA, NIE DRUGĄ KARTOTEKĄ. Przycisk
//     pojawia się WYŁĄCZNIE wtedy, gdy jest co pokazać, a przełączenie zamienia
//     formularz na kartę katalogową i z powrotem - bez zapisu i bez utraty tego,
//     co formularz trzyma.
//
//  5. KONTAKTY BEZ KONTAKTÓW MAJĄ NASTĘPNY KROK. Puste „nie masz jeszcze
//     kontaktów” z odnośnikiem do sieci to co innego niż pusty prostokąt.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Formularza kartoteki (`MyEventProfileForm`),
// karty katalogowej (`MyEventPublicPreview`), giełdy spotkań
// (`MeetingExchangeBoard`) i panelu biletów (`ParticipantTicketsPanel`) - każdy
// ma WŁASNY plik testowy, więc tutaj stoją atrapy zapisujące otrzymane
// właściwości. Przedmiotem dowodu jest KOMPOZYCJA, nie ich wnętrze.
// `MyAgendaList` jedzie prawdziwy, bo to on rozstrzyga o różnicy między
// „wczytujemy” a „pusto” na zakładce harmonogramu.
//
// Asercje idą po KLUCZACH i18n oraz po właściwościach przekazanych dzieciom.
import { createContext, useContext, useState, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";

import type {
  MyAgendaSession,
  MyEventPanelState,
  MyEventProfile,
} from "@/lib/events/myEventProfileApi";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { axeViolations, summarize } from "@/test/axe";

/**
 * Wiersz `my_connections` W ZAKRESIE, KTÓREGO DOTYKA TEN EKRAN. RPC oddaje
 * kilkanaście kolumn (liczniki, stopnie oddalenia, znaczniki czasu), a panel
 * czyta z nich PIĘĆ. Lokalny typ zamiast wygenerowanego wiersza jest tu
 * świadomy: atrapa ma nieść dokładnie to, o co komponent pyta, i nie wymaga
 * ANI JEDNEGO rzutowania - reszta kolumn nie ma jak wpłynąć na ten ekran.
 */
interface KontaktWiersz {
  connection_id: string;
  display_name: string;
  job_title: string | null;
  current_company: string | null;
  slug: string | null;
}

const h = vi.hoisted(() => ({
  jezyk: { current: "pl" },
  sesja: { current: null as { user: { id: string } } | null },
  wizytowka: {
    current: null as {
      name: string;
      jobTitle: string;
      company: string;
      avatarUrl: string | null;
    } | null,
  },
  kontakty: { rows: [] as KontaktWiersz[], loading: false },
  pobierzProfil: vi.fn<(slug: string) => Promise<MyEventPanelState>>(),
  pobierzAgende: vi.fn<(slug: string) => Promise<MyAgendaSession[]>>(),
  /** Właściwości, które panel podał swoim dzieciom - w kolejności renderu. */
  formularz: [] as { slug: string; maProfil: boolean; maKonto: boolean; loading: boolean }[],
  podglad: [] as { self: boolean }[],
  gielda: [] as string[],
  bilety: [] as { slugFilter: string | undefined; hideHeader: boolean }[],
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.jezyk.current),
);

vi.mock("@/lib/i18n-cart", () => ({ ensureI18n: () => {} }));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ session: h.sesja.current, user: h.sesja.current?.user ?? null }),
}));

vi.mock("@/lib/profile/useViewerCard", () => ({
  useViewerCardFacts: () => h.wizytowka.current,
}));

vi.mock("@/lib/network/useConnections", () => ({
  useMyConnections: () => ({
    data: h.kontakty.loading ? undefined : { pages: [h.kontakty.rows] },
    isLoading: h.kontakty.loading,
  }),
}));

// ZAKŁADKI JAKO ATRAPA. Radix montuje tylko aktywną zawartość i nie wystawia
// „która jest domyślna” inaczej niż tym, co narysował. Atrapa zachowuje tę samą
// semantykę, a dodatkowo pozwala przełączyć zakładkę jednym kliknięciem.
const Ctx = createContext<{ value: string; set: (next: string) => void }>({
  value: "",
  set: () => {},
});

vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ defaultValue, children }: { defaultValue: string; children?: ReactNode }) => {
    const [value, setValue] = useState(defaultValue);
    return (
      <Ctx.Provider value={{ value, set: setValue }}>
        <div data-testid="zakladki" data-domyslna={defaultValue} data-wybrana={value}>
          {children}
        </div>
      </Ctx.Provider>
    );
  },
  TabsList: ({ children }: { children?: ReactNode }) => <div role="tablist">{children}</div>,
  TabsTrigger: ({ value, children }: { value: string; children?: ReactNode }) => {
    const ctx = useContext(Ctx);
    return (
      <button
        type="button"
        role="tab"
        aria-selected={ctx.value === value}
        onClick={() => ctx.set(value)}
      >
        {children}
      </button>
    );
  },
  TabsContent: ({ value, children }: { value: string; children?: ReactNode }) => {
    const ctx = useContext(Ctx);
    return ctx.value === value ? <div data-zakladka={value}>{children}</div> : null;
  },
}));

vi.mock("@/components/events/public/molecules/EventViewerCard", () => ({
  EventViewerCard: ({ name, editSlot }: { name: string; editSlot?: ReactNode }) => (
    <div data-testid="wizytowka">
      <span>{name}</span>
      {editSlot}
    </div>
  ),
}));

vi.mock("@/components/events/participant/molecules/MyEventProfileForm", () => ({
  MyEventProfileForm: (props: {
    slug: string;
    profile: MyEventProfile | null;
    account: unknown;
    loading: boolean;
  }) => {
    h.formularz.push({
      slug: props.slug,
      maProfil: props.profile !== null,
      maKonto: props.account !== null,
      loading: props.loading,
    });
    return <div data-testid="formularz-kartoteki" data-loading={String(props.loading)} />;
  },
}));

vi.mock("@/components/events/participant/molecules/MyEventPublicPreview", () => ({
  MyEventPublicPreview: (props: { actions: { self: boolean } }) => {
    h.podglad.push({ self: props.actions.self });
    return <div data-testid="podglad-publiczny" />;
  },
}));

vi.mock("@/components/events/meetings/MeetingExchangeBoard", () => ({
  MeetingExchangeBoard: ({ slug }: { slug: string }) => {
    h.gielda.push(slug);
    return <div data-testid="gielda-spotkan" data-slug={slug} />;
  },
}));

vi.mock("@/components/profile/ParticipantTicketsPanel", () => ({
  ParticipantTicketsPanel: (props: { slugFilter?: string; hideHeader?: boolean }) => {
    h.bilety.push({ slugFilter: props.slugFilter, hideHeader: props.hideHeader === true });
    return <div data-testid="panel-biletow" data-slug={props.slugFilter ?? ""} />;
  },
}));

// Warstwa odczytu jest atrapą; hooki `useMyEventProfile` / `useMyAgenda` jadą
// PRAWDZIWE, bo to one decydują o `enabled` (gość nie pyta bazy) i o stanach
// „wczytywanie” / „błąd” widocznych na ekranie.
vi.mock("@/lib/events/myEventProfileApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/events/myEventProfileApi")>()),
  fetchMyEventProfile: (slug: string) => h.pobierzProfil(slug),
  fetchMyAgenda: (slug: string) => h.pobierzAgende(slug),
}));

const { EventMePanel } = await import("@/components/events/participant/organisms/EventMePanel");

const SLUG = "kongres-cee-2026";

function profil(over: Partial<MyEventProfile> = {}): MyEventProfile {
  return {
    personId: "11111111-1111-4111-8111-111111111111",
    firstName: "Anna",
    lastName: "Kowalska",
    email: "anna.kowalska@example.com",
    phone: null,
    emailVisible: false,
    phoneVisible: false,
    jobTitle: "Dyrektorka ds. energii",
    companyId: null,
    companyText: "Instytut Bałtycki",
    industry: null,
    specialization: null,
    bioPl: "Zajmuję się transformacją energetyczną.",
    bioEn: null,
    seekingPl: null,
    seekingEn: null,
    offeringPl: null,
    offeringEn: null,
    socialProfileUrl: null,
    socialLinks: {},
    photoUrl: null,
    ...over,
  };
}

function stan(over: Partial<MyEventPanelState> = {}): MyEventPanelState {
  return {
    profile: profil(),
    account: null,
    registration: {
      registrationId: "22222222-2222-4222-8222-222222222222",
      status: "confirmed",
      paymentStatus: "paid",
      directoryOptOut: false,
      notifyEmail: true,
      notifySms: false,
      groups: [],
    },
    ...over,
  };
}

function sesjaAgendy(over: Partial<MyAgendaSession> = {}): MyAgendaSession {
  return {
    sessionId: "33333333-3333-4333-8333-333333333333",
    titlePl: "Panel: sieci przesyłowe",
    titleEn: "Panel: transmission grids",
    startsAt: "2026-09-15T08:30:00.000Z",
    endsAt: "2026-09-15T09:30:00.000Z",
    format: "panel",
    streamUrl: null,
    roomNamePl: "Sala Bałtycka",
    roomNameEn: "Baltic Hall",
    trackNamePl: null,
    trackNameEn: null,
    signupStatus: "registered",
    ...over,
  };
}

function kontakt(over: Partial<KontaktWiersz> = {}): KontaktWiersz {
  return {
    connection_id: "44444444-4444-4444-8444-444444444444",
    display_name: "Marek Nowak",
    job_title: "Analityk",
    current_company: "Fundacja Wschodnia",
    slug: "marek-nowak",
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.jezyk.current = "pl";
  h.sesja.current = { user: { id: "u-1" } };
  h.wizytowka.current = {
    name: "Anna Kowalska",
    jobTitle: "Dyrektorka ds. energii",
    company: "Instytut Bałtycki",
    avatarUrl: null,
  };
  h.kontakty = { rows: [], loading: false };
  h.formularz.length = 0;
  h.podglad.length = 0;
  h.gielda.length = 0;
  h.bilety.length = 0;
  h.pobierzProfil.mockResolvedValue(stan());
  h.pobierzAgende.mockResolvedValue([sesjaAgendy()]);
});

/** Przełącza zakładkę panelu po kluczu i18n na przycisku. */
function zakladka(klucz: string): void {
  fireEvent.click(screen.getByRole("tab", { name: `eventMe.tabs.${klucz}` }));
}

describe("EventMePanel - gość", () => {
  beforeEach(() => {
    h.sesja.current = null;
    h.wizytowka.current = null;
  });

  it("dostaje zaproszenie do logowania z odnośnikiem, a nie pusty ekran", () => {
    renderWithQueryClient(<EventMePanel slug={SLUG} />);

    expect(screen.getByText("eventMe.signedOut")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "eventMe.title" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "eventMe.signIn" }).getAttribute("href")).toBe(
      "/login",
    );
  });

  it("NIE pyta bazy o kartotekę ani o agendę - RPC i tak odmówiłoby", () => {
    renderWithQueryClient(<EventMePanel slug={SLUG} />);

    expect(h.pobierzProfil).not.toHaveBeenCalled();
    expect(h.pobierzAgende).not.toHaveBeenCalled();
  });

  it("nie pokazuje ANI JEDNEJ zakładki - nie ma czego pokazać bez tożsamości", () => {
    renderWithQueryClient(<EventMePanel slug={SLUG} />);

    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByTestId("panel-biletow")).toBeNull();
  });

  it("ekran gościa nie ma naruszeń axe", async () => {
    const { container } = renderWithQueryClient(<EventMePanel slug={SLUG} />);

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

describe("EventMePanel - plakietka stanu zgłoszenia", () => {
  it("zgłoszenie potwierdzone dostaje plakietkę stanu aktywnego", async () => {
    renderWithQueryClient(<EventMePanel slug={SLUG} />);

    expect(await screen.findByText("eventMe.statusActive")).toBeTruthy();
  });

  it("zgłoszenie oczekujące ma INNE zdanie niż potwierdzone", async () => {
    h.pobierzProfil.mockResolvedValue(
      stan({
        registration: {
          registrationId: "22222222-2222-4222-8222-222222222222",
          status: "pending",
          paymentStatus: "unpaid",
          directoryOptOut: false,
          notifyEmail: true,
          notifySms: false,
          groups: [],
        },
      }),
    );
    renderWithQueryClient(<EventMePanel slug={SLUG} />);

    expect(await screen.findByText("eventMe.statusPending")).toBeTruthy();
    expect(screen.queryByText("eventMe.statusActive")).toBeNull();
  });

  it("brak zgłoszenia to BRAK plakietki, a nie „oczekujące”", async () => {
    h.pobierzProfil.mockResolvedValue(stan({ registration: null }));
    renderWithQueryClient(<EventMePanel slug={SLUG} />);

    await screen.findByTestId("zakladki");
    expect(screen.queryByText("eventMe.statusPending")).toBeNull();
    expect(screen.queryByText("eventMe.statusActive")).toBeNull();
  });
});

describe("EventMePanel - zakładka kartoteki", () => {
  it("pokazuje wizytówkę widza z odnośnikiem do edycji profilu platformy", async () => {
    renderWithQueryClient(<EventMePanel slug={SLUG} />);

    const wizytowka = await screen.findByTestId("wizytowka");
    expect(within(wizytowka).getByText("Anna Kowalska")).toBeTruthy();
    expect(
      within(wizytowka).getByRole("link", { name: "eventMe.editProfile" }).getAttribute("href"),
    ).toBe("/profile/edit");
  });

  it("bez danych wizytówki karta się NIE rysuje - pusta karta to gorsze niż jej brak", async () => {
    h.wizytowka.current = null;
    renderWithQueryClient(<EventMePanel slug={SLUG} />);

    await screen.findByTestId("formularz-kartoteki");
    expect(screen.queryByTestId("wizytowka")).toBeNull();
  });

  it("formularz kartoteki dostaje SLUG TEGO wydarzenia i wczytany profil", async () => {
    renderWithQueryClient(<EventMePanel slug={SLUG} />);

    await waitFor(() => expect(h.pobierzProfil).toHaveBeenCalledWith(SLUG));
    await waitFor(() => expect(h.formularz.at(-1)?.maProfil).toBe(true));
    expect(h.formularz.at(-1)?.slug).toBe(SLUG);
    expect(h.formularz.at(-1)?.loading).toBe(false);
  });

  it("dopóki kartoteka się wczytuje, formularz DOSTAJE `loading` - nie udaje pustej kartoteki", () => {
    h.pobierzProfil.mockReturnValue(new Promise<MyEventPanelState>(() => {}));
    renderWithQueryClient(<EventMePanel slug={SLUG} />);

    expect(h.formularz.at(-1)?.loading).toBe(true);
    expect(h.formularz.at(-1)?.maProfil).toBe(false);
  });

  it("podgląd publiczny pojawia się TYLKO wtedy, gdy jest co pokazać", async () => {
    h.pobierzProfil.mockResolvedValue(stan({ profile: null }));
    renderWithQueryClient(<EventMePanel slug={SLUG} />);

    await screen.findByTestId("formularz-kartoteki");
    expect(screen.queryByRole("button", { name: /eventMe\.publicPreview\.open/ })).toBeNull();
  });

  it("przełącznik podglądu zamienia formularz na kartę katalogową i z powrotem", async () => {
    renderWithQueryClient(<EventMePanel slug={SLUG} />);

    const otworz = await screen.findByRole("button", {
      name: /eventMe\.publicPreview\.open/,
    });
    fireEvent.click(otworz);

    await waitFor(() => expect(screen.getByTestId("podglad-publiczny")).toBeTruthy());
    expect(screen.queryByTestId("formularz-kartoteki")).toBeNull();
    expect(screen.getByText("eventMe.publicPreview.hint")).toBeTruthy();
    // Karta jest MOJA - akcje kontaktowe muszą wiedzieć, że patrzę na siebie.
    expect(h.podglad.at(-1)?.self).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: /eventMe\.publicPreview\.close/ }));
    await waitFor(() => expect(screen.getByTestId("formularz-kartoteki")).toBeTruthy());
    expect(screen.queryByTestId("podglad-publiczny")).toBeNull();
  });
});

describe("EventMePanel - zakładka harmonogramu", () => {
  it("pokazuje sesje z `event_my_agenda` dla TEGO sluga", async () => {
    renderWithQueryClient(<EventMePanel slug={SLUG} />);

    await screen.findByTestId("zakladki");
    zakladka("schedule");

    expect(await screen.findByText("Panel: sieci przesyłowe")).toBeTruthy();
    expect(h.pobierzAgende).toHaveBeenCalledWith(SLUG);
  });

  it("pusta agenda to zdanie o braku zapisów, a nie awaria", async () => {
    h.pobierzAgende.mockResolvedValue([]);
    renderWithQueryClient(<EventMePanel slug={SLUG} />);

    await screen.findByTestId("zakladki");
    zakladka("schedule");

    expect(await screen.findByText("eventMe.agendaEmpty")).toBeTruthy();
  });

  it("dopóki agenda się wczytuje, stoją szkielety - a NIE zdanie o pustce", async () => {
    h.pobierzAgende.mockReturnValue(new Promise<MyAgendaSession[]>(() => {}));
    const { container } = renderWithQueryClient(<EventMePanel slug={SLUG} />);

    await screen.findByTestId("zakladki");
    zakladka("schedule");

    await waitFor(() =>
      expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0),
    );
    expect(screen.queryByText("eventMe.agendaEmpty")).toBeNull();
  });

  it.fails(
    "DEFEKT: odmowa `event_my_agenda` wygląda jak pusta agenda - panel nie ma ANI JEDNEJ gałęzi błędu",
    async () => {
      // `useMyAgenda` to zwykłe `useQuery`; przy odrzuconej obietnicy `data`
      // jest `undefined`, a panel podaje `sessions={agenda.data ?? []}`
      // i `loading={agenda.isLoading}` (fałsz po błędzie). Uczestnik czyta więc
      // „nie masz jeszcze żadnych zapisów” w chwili, w której baza odmówiła
      // odpowiedzi - i zapisuje się na sesje, na których już jest, albo uznaje,
      // że jego wybory przepadły. „Nie wiem” i „nie wolno” muszą być różnymi
      // odpowiedziami; panel nie ma gałęzi `agenda.isError`.
      h.pobierzAgende.mockRejectedValue(new Error("auth_required: sign in to see your agenda"));
      const { container } = renderWithQueryClient(<EventMePanel slug={SLUG} />);

      await screen.findByTestId("zakladki");
      zakladka("schedule");

      // Czekamy WYŁĄCZNIE na ustanie stanu oczekiwania (szkielety znikają
      // zarówno po odmowie, jak i po naprawie) - dzięki temu ten wpis padnie na
      // asercji docelowej, a po dołożeniu gałęzi błędu przestanie padać w ogóle.
      await waitFor(() => expect(h.pobierzAgende).toHaveBeenCalled());
      await waitFor(() => expect(container.querySelectorAll(".animate-pulse")).toHaveLength(0));

      // ASERCJA DOCELOWA: po odmowie ekran NIE MOŻE twierdzić, że agenda jest pusta.
      expect(screen.queryByText("eventMe.agendaEmpty")).toBeNull();
    },
  );
});

describe("EventMePanel - zakładka kontaktów", () => {
  it("brak kontaktów ma NASTĘPNY KROK, a nie pusty prostokąt", async () => {
    renderWithQueryClient(<EventMePanel slug={SLUG} />);

    await screen.findByTestId("zakladki");
    zakladka("contacts");

    expect(await screen.findByText("eventMe.contactsEmpty")).toBeTruthy();
    expect(screen.getByRole("link", { name: "eventMe.openNetwork" }).getAttribute("href")).toBe(
      "/network",
    );
  });

  it("wczytywanie kontaktów pokazuje szkielet, a nie zdanie o pustce", async () => {
    h.kontakty = { rows: [], loading: true };
    const { container } = renderWithQueryClient(<EventMePanel slug={SLUG} />);

    await screen.findByTestId("zakladki");
    zakladka("contacts");

    await waitFor(() =>
      expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0),
    );
    expect(screen.queryByText("eventMe.contactsEmpty")).toBeNull();
  });

  it("kontakt z profilem publicznym dostaje odnośnik do SWOJEJ wizytówki", async () => {
    h.kontakty = { rows: [kontakt()], loading: false };
    renderWithQueryClient(<EventMePanel slug={SLUG} />);

    await screen.findByTestId("zakladki");
    zakladka("contacts");

    expect(await screen.findByText("Marek Nowak")).toBeTruthy();
    expect(screen.getByRole("link", { name: "eventMe.openProfile" }).getAttribute("href")).toBe(
      "/author/marek-nowak",
    );
  });

  it("kontakt bez publicznego profilu nie dostaje martwego odnośnika", async () => {
    h.kontakty = { rows: [kontakt({ slug: null })], loading: false };
    renderWithQueryClient(<EventMePanel slug={SLUG} />);

    await screen.findByTestId("zakladki");
    zakladka("contacts");

    expect(await screen.findByText("Marek Nowak")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "eventMe.openProfile" })).toBeNull();
  });
});

describe("EventMePanel - networking i bilety", () => {
  it("giełda spotkań dostaje SLUG TEGO wydarzenia", async () => {
    renderWithQueryClient(<EventMePanel slug={SLUG} />);

    await screen.findByTestId("zakladki");
    zakladka("networking");

    const gielda = await screen.findByTestId("gielda-spotkan");
    expect(gielda.getAttribute("data-slug")).toBe(SLUG);
    expect(h.gielda).toContain(SLUG);
  });

  it("panel biletów jest ZAWĘŻONY do tego wydarzenia i NIE powtarza nagłówka", async () => {
    renderWithQueryClient(<EventMePanel slug={SLUG} />);

    await screen.findByTestId("zakladki");
    zakladka("registration");

    await screen.findByTestId("panel-biletow");
    expect(h.bilety.at(-1)?.slugFilter).toBe(SLUG);
    // Panel osadzony pod cudzym `h1` nie może wnosić drugiego.
    expect(h.bilety.at(-1)?.hideHeader).toBe(true);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });
});

describe("EventMePanel - dostępność", () => {
  it("panel zalogowanego uczestnika nie ma naruszeń axe", async () => {
    h.kontakty = { rows: [kontakt()], loading: false };
    const { container, queryClient } = renderWithQueryClient(<EventMePanel slug={SLUG} />);

    await screen.findByTestId("formularz-kartoteki");
    // OBA zapytania panelu (kartoteka i agenda) muszą się ustabilizować przed
    // audytem: agenda jedzie niezależnie od otwartej zakładki, a jej późniejsze
    // rozstrzygnięcie zmieniałoby drzewo w trakcie skanowania.
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
