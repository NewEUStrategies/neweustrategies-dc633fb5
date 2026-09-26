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
//  6. ZAKŁADKA JEST STEROWANA Z ADRESU (`?tab=`). Panel otwiera zakładkę
//     z właściwości `tab`, a klik zgłasza zmianę przez `onTabChange` - trasa
//     zapisuje ją w adresie. Dopóki sesja się rozstrzyga, panel rysuje
//     WYŁĄCZNIE szkielet (tak samo na serwerze), więc HTML nie zależy od `tab`.
//
//  7. GNIAZDA TORÓW (spec B.11, BLK-5). Harmonogram i „Po wydarzeniu" to
//     gniazda torów A i C. Ten plik zastępuje KAŻDY moduł gniazda atrapą z
//     `data-testid`, która zapisuje właściwości - i sprawdza wyłącznie MIEJSCE
//     montażu i właściwości. Zachowanie gniazda mieszka w jego własnym teście
//     (`slots/__tests__/EventMeScheduleSlot.test.tsx` przejął stąd asercje
//     harmonogramu, w tym dawny `it.fails` o odmowie agendy).
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Formularza kartoteki (`MyEventProfileForm`),
// karty katalogowej (`MyEventPublicPreview`), giełdy spotkań
// (`MeetingExchangeBoard`), panelu biletów (`ParticipantTicketsPanel`)
// i gniazd - każdy ma WŁASNY plik testowy, więc tutaj stoją atrapy
// zapisujące otrzymane właściwości. Przedmiotem dowodu jest KOMPOZYCJA, nie
// ich wnętrze. Plakietka stanu (`RegistrationStatusBadge`) jedzie prawdziwa -
// to atom, a jej zdanie jest częścią dowodu nr 3.
//
// Asercje idą po KLUCZACH i18n oraz po właściwościach przekazanych dzieciom.
import { createContext, useContext, useState, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";

import type { EventMeSlotProps } from "@/components/events/participant/slots/slotTypes";
import type { EventMeTab } from "@/lib/events/eventMeTabs";
import type { MyEventPanelState, MyEventProfile } from "@/lib/events/myEventProfileApi";
import type { EventParticipantOptions } from "@/lib/events/participantOptionsApi";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { axeViolations, summarize } from "@/test/axe";
import { makeEventParticipantOptions } from "@/test/events/participantFixtures";

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
  /** `useAuth().loading` - sesja jeszcze się nie rozstrzygnęła. */
  laduje: { current: false },
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
  pobierzOpcje: vi.fn<(slug: string) => Promise<EventParticipantOptions | null>>(),
  /** Właściwości, które panel podał swoim dzieciom - w kolejności renderu. */
  formularz: [] as { slug: string; maProfil: boolean; maKonto: boolean; loading: boolean }[],
  podglad: [] as { self: boolean }[],
  gielda: [] as string[],
  bilety: [] as { slugFilter: string | undefined; hideHeader: boolean }[],
  /** Właściwości gniazd - kontrakt BLK-5: host sprawdza tylko montaż i właściwości. */
  gniazdoHarmonogramu: [] as EventMeSlotProps[],
  gniazdoPoWydarzeniu: [] as EventMeSlotProps[],
  /** Zakładki zgłoszone przez `onTabChange`. */
  zmianyZakladki: [] as EventMeTab[],
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.jezyk.current),
);

vi.mock("@/lib/i18n-cart", () => ({ ensureI18n: () => {} }));
vi.mock("@/lib/i18n-event-participant", () => ({ ensureI18n: () => {} }));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    session: h.sesja.current,
    user: h.sesja.current?.user ?? null,
    loading: h.laduje.current,
  }),
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
// „która jest wybrana” inaczej niż tym, co narysował. Atrapa zachowuje tę samą
// semantykę STEROWANĄ (`value` + `onValueChange`), a dodatkowo wystawia jeden
// przycisk testowy, który zgłasza wartość spoza listy zakładek - tak dowodzimy,
// że panel nie przekaże trasie zakładki, której adres nie zna.
const Ctx = createContext<{ value: string; set: (next: string) => void }>({
  value: "",
  set: () => {},
});

vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (next: string) => void;
    children?: ReactNode;
  }) => (
    <Ctx.Provider value={{ value, set: onValueChange }}>
      <div data-testid="zakladki" data-wybrana={value}>
        {children}
        <button type="button" data-testid="obca-zakladka" onClick={() => onValueChange("obca")}>
          obca
        </button>
      </div>
    </Ctx.Provider>
  ),
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

// GNIAZDA TORÓW - atrapy zapisujące właściwości (BLK-5).
vi.mock("@/components/events/participant/slots/EventMeScheduleSlot", () => ({
  EventMeScheduleSlot: (props: EventMeSlotProps) => {
    h.gniazdoHarmonogramu.push(props);
    return <div data-testid="gniazdo-harmonogram" data-slug={props.slug} />;
  },
}));

vi.mock("@/components/events/participant/slots/EventMeFollowUpSlot", () => ({
  EventMeFollowUpSlot: (props: EventMeSlotProps) => {
    h.gniazdoPoWydarzeniu.push(props);
    return <div data-testid="gniazdo-po-wydarzeniu" data-slug={props.slug} />;
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

// Warstwa odczytu jest atrapą; hooki `useMyEventProfile` /
// `useEventParticipantOptions` jadą PRAWDZIWE, bo to one decydują o `enabled`
// (gość nie pyta bazy) i o stanach „wczytywanie” / „błąd” widocznych na ekranie.
vi.mock("@/lib/events/myEventProfileApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/events/myEventProfileApi")>()),
  fetchMyEventProfile: (slug: string) => h.pobierzProfil(slug),
}));

vi.mock("@/lib/events/participantOptionsApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/events/participantOptionsApi")>()),
  fetchEventParticipantOptions: (slug: string) => h.pobierzOpcje(slug),
}));

const { EventMePanel } = await import("@/components/events/participant/organisms/EventMePanel");

/**
 * Panel z zakładką trzymaną tak, jak trzyma ją trasa: `tab` z „adresu”,
 * `onTabChange` zapisuje nową wartość (i zapamiętuje ją do asercji).
 */
function PanelZAdresem({ poczatkowa }: { poczatkowa?: EventMeTab }) {
  const [tab, setTab] = useState<EventMeTab | undefined>(poczatkowa);
  return (
    <EventMePanel
      slug={SLUG}
      tab={tab}
      onTabChange={(next) => {
        h.zmianyZakladki.push(next);
        setTab(next);
      }}
    />
  );
}

function pokaz(poczatkowa?: EventMeTab) {
  return renderWithQueryClient(<PanelZAdresem poczatkowa={poczatkowa} />);
}

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
      status: "approved",
      paymentStatus: "paid",
      directoryOptOut: false,
      notifyEmail: true,
      notifySms: false,
      groups: [],
    },
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
  h.laduje.current = false;
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
  h.gniazdoHarmonogramu.length = 0;
  h.gniazdoPoWydarzeniu.length = 0;
  h.zmianyZakladki.length = 0;
  h.pobierzProfil.mockResolvedValue(stan());
  h.pobierzOpcje.mockResolvedValue(makeEventParticipantOptions());
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
    pokaz();

    expect(screen.getByText("eventMe.signedOut")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "eventMe.title" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "eventMe.signIn" }).getAttribute("href")).toBe(
      "/login",
    );
  });

  it("NIE pyta bazy o kartotekę ani o flagi wydarzenia - RPC i tak odmówiłoby", () => {
    pokaz();

    expect(h.pobierzProfil).not.toHaveBeenCalled();
    expect(h.pobierzOpcje).not.toHaveBeenCalled();
  });

  it("nie pokazuje ANI JEDNEJ zakładki - nie ma czego pokazać bez tożsamości", () => {
    pokaz();

    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByTestId("panel-biletow")).toBeNull();
  });

  it("ekran gościa nie ma naruszeń axe", async () => {
    const { container } = pokaz();

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

describe("EventMePanel - sesja w trakcie rozstrzygania (i render serwerowy)", () => {
  beforeEach(() => {
    h.laduje.current = true;
  });

  it("rysuje WYŁĄCZNIE szkielet z ogłoszeniem stanu - bez zakładek i bez zaproszenia do logowania", () => {
    const { container } = pokaz("schedule");

    expect(screen.getByRole("status").textContent).toBe("eventParticipant.loading");
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByText("eventMe.signedOut")).toBeNull();
    expect(screen.queryByTestId("gniazdo-harmonogram")).toBeNull();
  });

  it("NIE pyta bazy, dopóki nie wiadomo, czyja to sesja", () => {
    pokaz();

    expect(h.pobierzProfil).not.toHaveBeenCalled();
    expect(h.pobierzOpcje).not.toHaveBeenCalled();
  });

  it("szkielet jest taki sam dla każdej zakładki z adresu", () => {
    const html = (["profile", "schedule", "follow-up"] as const).map((tab) => {
      const { container, unmount } = pokaz(tab);
      const out = container.innerHTML;
      unmount();
      return out;
    });

    expect(new Set(html).size).toBe(1);
  });

  it("szkielet nie ma naruszeń axe", async () => {
    const { container } = pokaz();

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

describe("EventMePanel - plakietka stanu zgłoszenia (D0-5)", () => {
  it("zgłoszenie zaakceptowane (`approved`) dostaje plakietkę stanu AKTYWNEGO", async () => {
    pokaz();

    expect(await screen.findByText("eventParticipant.status.active")).toBeTruthy();
  });

  it("obecność odnotowana na bramce (`attended`) też jest stanem aktywnym", async () => {
    h.pobierzProfil.mockResolvedValue(
      stan({
        registration: {
          registrationId: "22222222-2222-4222-8222-222222222222",
          status: "attended",
          paymentStatus: "paid",
          directoryOptOut: false,
          notifyEmail: true,
          notifySms: false,
          groups: [],
        },
      }),
    );
    pokaz();

    expect(await screen.findByText("eventParticipant.status.active")).toBeTruthy();
    expect(screen.queryByText("eventParticipant.status.pending")).toBeNull();
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
    pokaz();

    expect(await screen.findByText("eventParticipant.status.pending")).toBeTruthy();
    expect(screen.queryByText("eventParticipant.status.active")).toBeNull();
  });

  it("brak zgłoszenia to BRAK plakietki, a nie „oczekujące”", async () => {
    h.pobierzProfil.mockResolvedValue(stan({ registration: null }));
    pokaz();

    await screen.findByTestId("zakladki");
    await waitFor(() => expect(h.formularz.at(-1)?.loading).toBe(false));
    expect(screen.queryByText(/eventParticipant\.status\./)).toBeNull();
  });
});

describe("EventMePanel - zakładka kartoteki", () => {
  it("pokazuje wizytówkę widza z odnośnikiem do edycji profilu platformy", async () => {
    pokaz();

    const wizytowka = await screen.findByTestId("wizytowka");
    expect(within(wizytowka).getByText("Anna Kowalska")).toBeTruthy();
    expect(
      within(wizytowka).getByRole("link", { name: "eventMe.editProfile" }).getAttribute("href"),
    ).toBe("/profile/edit");
  });

  it("bez danych wizytówki karta się NIE rysuje - pusta karta to gorsze niż jej brak", async () => {
    h.wizytowka.current = null;
    pokaz();

    await screen.findByTestId("formularz-kartoteki");
    expect(screen.queryByTestId("wizytowka")).toBeNull();
  });

  it("formularz kartoteki dostaje SLUG TEGO wydarzenia i wczytany profil", async () => {
    pokaz();

    await waitFor(() => expect(h.pobierzProfil).toHaveBeenCalledWith(SLUG));
    await waitFor(() => expect(h.formularz.at(-1)?.maProfil).toBe(true));
    expect(h.formularz.at(-1)?.slug).toBe(SLUG);
    expect(h.formularz.at(-1)?.loading).toBe(false);
  });

  it("dopóki kartoteka się wczytuje, formularz DOSTAJE `loading` - nie udaje pustej kartoteki", () => {
    h.pobierzProfil.mockReturnValue(new Promise<MyEventPanelState>(() => {}));
    pokaz();

    expect(h.formularz.at(-1)?.loading).toBe(true);
    expect(h.formularz.at(-1)?.maProfil).toBe(false);
  });

  it("podgląd publiczny pojawia się TYLKO wtedy, gdy jest co pokazać", async () => {
    h.pobierzProfil.mockResolvedValue(stan({ profile: null }));
    pokaz();

    await screen.findByTestId("formularz-kartoteki");
    expect(screen.queryByRole("button", { name: /eventMe\.publicPreview\.open/ })).toBeNull();
  });

  it("przełącznik podglądu zamienia formularz na kartę katalogową i z powrotem", async () => {
    pokaz();

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

describe("EventMePanel - zakładki sterowane adresem", () => {
  it("bez `tab` w adresie otwiera kartotekę", async () => {
    pokaz();

    expect((await screen.findByTestId("zakladki")).getAttribute("data-wybrana")).toBe("profile");
    expect(screen.getByTestId("formularz-kartoteki")).toBeTruthy();
  });

  it("`tab` z adresu otwiera WSKAZANĄ zakładkę od pierwszego renderu", async () => {
    pokaz("networking");

    expect((await screen.findByTestId("zakladki")).getAttribute("data-wybrana")).toBe("networking");
    expect(screen.getByTestId("gielda-spotkan")).toBeTruthy();
  });

  it("klik w zakładkę zgłasza ją trasie przez `onTabChange`", async () => {
    pokaz();

    await screen.findByTestId("zakladki");
    zakladka("contacts");

    expect(h.zmianyZakladki).toEqual(["contacts"]);
    expect(await screen.findByText("eventMe.contactsEmpty")).toBeTruthy();
  });

  it("wartość spoza listy zakładek NIE trafia do adresu", async () => {
    pokaz();

    fireEvent.click(await screen.findByTestId("obca-zakladka"));

    expect(h.zmianyZakladki).toEqual([]);
    expect(screen.getByTestId("zakladki").getAttribute("data-wybrana")).toBe("profile");
  });
});

describe("EventMePanel - gniazdo harmonogramu (tor A)", () => {
  it("zakładka harmonogramu montuje gniazdo z SLUGIEM, zgłoszeniem i flagami wydarzenia", async () => {
    pokaz("schedule");

    await screen.findByTestId("gniazdo-harmonogram");
    await waitFor(() => expect(h.gniazdoHarmonogramu.at(-1)?.options).not.toBeNull());
    const props = h.gniazdoHarmonogramu.at(-1);
    expect(props?.slug).toBe(SLUG);
    expect(props?.registration?.registrationId).toBe("22222222-2222-4222-8222-222222222222");
    expect(props?.options).toEqual(makeEventParticipantOptions());
    expect(h.pobierzOpcje).toHaveBeenCalledWith(SLUG);
  });

  it("zanim flagi i zgłoszenie przyjdą, gniazdo dostaje `null`, a nie zgadnięte wartości", () => {
    h.pobierzProfil.mockReturnValue(new Promise<MyEventPanelState>(() => {}));
    h.pobierzOpcje.mockReturnValue(new Promise<EventParticipantOptions | null>(() => {}));
    pokaz("schedule");

    expect(h.gniazdoHarmonogramu.at(-1)).toEqual({ slug: SLUG, registration: null, options: null });
  });

  it("gniazdo stoi TYLKO na zakładce harmonogramu", async () => {
    pokaz();

    await screen.findByTestId("formularz-kartoteki");
    expect(screen.queryByTestId("gniazdo-harmonogram")).toBeNull();
  });
});

describe("EventMePanel - zakładka „Po wydarzeniu” (tor C)", () => {
  it("przycisk zakładki pojawia się, gdy organizator włączył certyfikat", async () => {
    h.pobierzOpcje.mockResolvedValue(makeEventParticipantOptions({ certificateEnabled: true }));
    pokaz();

    expect(await screen.findByRole("tab", { name: "eventParticipant.tabs.followUp" })).toBeTruthy();
  });

  it("przycisk zakładki pojawia się, gdy organizator włączył ankietę", async () => {
    h.pobierzOpcje.mockResolvedValue(makeEventParticipantOptions({ surveyEnabled: true }));
    pokaz();

    expect(await screen.findByRole("tab", { name: "eventParticipant.tabs.followUp" })).toBeTruthy();
  });

  it("bez certyfikatu i ankiety przycisku NIE ma - pusta zakładka to gorsze niż jej brak", async () => {
    pokaz();

    await waitFor(() => expect(h.pobierzOpcje).toHaveBeenCalled());
    await screen.findByTestId("formularz-kartoteki");
    expect(screen.queryByRole("tab", { name: "eventParticipant.tabs.followUp" })).toBeNull();
  });

  it("klik w przycisk otwiera gniazdo z flagami wydarzenia", async () => {
    const flagi = makeEventParticipantOptions({ surveyEnabled: true });
    h.pobierzOpcje.mockResolvedValue(flagi);
    pokaz();

    fireEvent.click(await screen.findByRole("tab", { name: "eventParticipant.tabs.followUp" }));

    expect(h.zmianyZakladki).toEqual(["follow-up"]);
    await screen.findByTestId("gniazdo-po-wydarzeniu");
    expect(h.gniazdoPoWydarzeniu.at(-1)?.options).toEqual(flagi);
    expect(h.gniazdoPoWydarzeniu.at(-1)?.slug).toBe(SLUG);
  });

  it("`?tab=follow-up` renderuje TREŚĆ zakładki, zanim flagi przyjdą (MIN-16)", () => {
    h.pobierzOpcje.mockReturnValue(new Promise<EventParticipantOptions | null>(() => {}));
    pokaz("follow-up");

    expect(screen.getByTestId("gniazdo-po-wydarzeniu")).toBeTruthy();
    expect(h.gniazdoPoWydarzeniu.at(-1)?.options).toBeNull();
    // Przycisk czeka na flagi - ale treść już stoi.
    expect(screen.queryByRole("tab", { name: "eventParticipant.tabs.followUp" })).toBeNull();
  });

  it("odmowa flag mówi o tym zdaniem, a gniazdo i tak dostaje miejsce (z `options: null`)", async () => {
    h.pobierzOpcje.mockRejectedValue(new Error("network: offline"));
    pokaz("follow-up");

    expect(await screen.findByText("eventParticipant.options.loadError")).toBeTruthy();
    expect(screen.getByTestId("gniazdo-po-wydarzeniu")).toBeTruthy();
    expect(h.gniazdoPoWydarzeniu.at(-1)?.options).toBeNull();
  });
});

describe("EventMePanel - zakładka kontaktów", () => {
  it("brak kontaktów ma NASTĘPNY KROK, a nie pusty prostokąt", async () => {
    pokaz();

    await screen.findByTestId("zakladki");
    zakladka("contacts");

    expect(await screen.findByText("eventMe.contactsEmpty")).toBeTruthy();
    expect(screen.getByRole("link", { name: "eventMe.openNetwork" }).getAttribute("href")).toBe(
      "/network",
    );
  });

  it("wczytywanie kontaktów pokazuje szkielet, a nie zdanie o pustce", async () => {
    h.kontakty = { rows: [], loading: true };
    const { container } = pokaz();

    await screen.findByTestId("zakladki");
    zakladka("contacts");

    await waitFor(() =>
      expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0),
    );
    expect(screen.queryByText("eventMe.contactsEmpty")).toBeNull();
  });

  it("kontakt z profilem publicznym dostaje odnośnik do SWOJEJ wizytówki", async () => {
    h.kontakty = { rows: [kontakt()], loading: false };
    pokaz();

    await screen.findByTestId("zakladki");
    zakladka("contacts");

    expect(await screen.findByText("Marek Nowak")).toBeTruthy();
    expect(screen.getByRole("link", { name: "eventMe.openProfile" }).getAttribute("href")).toBe(
      "/author/marek-nowak",
    );
  });

  it("kontakt bez publicznego profilu nie dostaje martwego odnośnika", async () => {
    h.kontakty = { rows: [kontakt({ slug: null })], loading: false };
    pokaz();

    await screen.findByTestId("zakladki");
    zakladka("contacts");

    expect(await screen.findByText("Marek Nowak")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "eventMe.openProfile" })).toBeNull();
  });
});

describe("EventMePanel - networking i bilety", () => {
  it("giełda spotkań dostaje SLUG TEGO wydarzenia", async () => {
    pokaz();

    await screen.findByTestId("zakladki");
    zakladka("networking");

    const gielda = await screen.findByTestId("gielda-spotkan");
    expect(gielda.getAttribute("data-slug")).toBe(SLUG);
    expect(h.gielda).toContain(SLUG);
  });

  it("panel biletów jest ZAWĘŻONY do tego wydarzenia i NIE powtarza nagłówka", async () => {
    pokaz();

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
    const { container, queryClient } = pokaz();

    await screen.findByTestId("formularz-kartoteki");
    // OBA zapytania panelu (kartoteka i agenda) muszą się ustabilizować przed
    // audytem: agenda jedzie niezależnie od otwartej zakładki, a jej późniejsze
    // rozstrzygnięcie zmieniałoby drzewo w trakcie skanowania.
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
