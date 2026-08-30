// RAMA STUDIA WYDARZENIA - JEDYNA BRAMKA ROLI I MODULOW dla 38 tras studia.
//
// PO CO TEN PLIK ISTNIEJE. Wszystkie ekrany studia montuja sie WEWNATRZ tej
// ramy: to ona pyta o wiersz wydarzenia, ona liczy zbior sekcji ukrytych
// przelacznikami modulow i ona rozstrzyga, czy redaktor w ogole zobaczy
// zawartosc. Sekcje same z siebie NICZEGO nie sprawdzaja - `EventStudioSection`
// jest warstwa wizualna, a trasy sa cienkie (patrz naglowek
// `adminEventStudioSectionRoutes.test.tsx`). Rama, ktora po cichu przepusci
// zbyt wiele, otwiera cala reszte naraz.
//
// CO KONKRETNIE PSUJE SIE BEZ TYCH TESTOW.
//   1. BRAMKA ROLI ZNIKA NIEZAUWAZENIE. `canWrite` liczy sie z `isAdmin` ALBO
//      `editor`; rozszerzenie warunku o czwarta role albo zamiana `&&` na `||`
//      nie wywraca zadnego ekranu - po prostu autor bez uprawnien widzi panel
//      wydarzenia. Odmowa bazy przyjdzie dopiero przy pierwszym zapisie, czyli
//      po tym, jak ktos zobaczy liste zgloszen.
//   2. BRAMKA ROLI JEST WEZSZA NIZ BRAMKA STUDIA - i to jest osobna rzecz do
//      zepsucia. Podstrony czyta `admin_event_pages_list`, ktore stoi na
//      `assert_event_admin_tenant()` (NIGDY editor). Zamiana `isAdmin` na
//      `canWrite` w tej jednej linii wysyla redaktora po pytanie, na ktore
//      z gory znamy odpowiedz „forbidden" - i zamienia wejscie do studia
//      w czerwony blad zamiast w brakujacy pasek zakladek w podgladzie.
//   3. „NIE WIEM" ZLEWA SIE Z „NIE WOLNO". Wczytywanie, brak wiersza i brak
//      uprawnien to TRZY rozne odpowiedzi. Sklejone w jedna („nie masz
//      dostepu") kaza redaktorowi pisac do wsparcia w sprawie zerwanego
//      polaczenia, a administratorowi szukac uprawnien, ktorych nie brakuje.
//   4. PRZELACZNIK MODULU PRZESTAJE BRAMKOWAC EKRAN. Wylaczony modul ma znikac
//      Z NAWIGACJI, ale jego ADRES ma nadal dzialac i tlumaczyc sie zdaniem.
//      Zgubiony `hiddenFeature` daje panel spotkan w webinarze, zgubiony
//      `hiddenSections` - pozycje w sidebarze, ktore prowadza na ten ekran.
//
// KAZDA PARA JEST PARA: rola/modul, ktory MOZE, i rola/modul, ktory NIE MOZE.
// Sam happy path nie jest dowodem bramki - przechodzi rowniez wtedy, gdy bramki
// nie ma wcale.
//
// CZEGO SWIADOMIE NIE DUBLUJE. (1) Czystych funkcji `eventFeatures`
// i `eventStudioNav` - maja wlasne pliki. (2) Zawartosci sidebara (wyszukiwarka,
// grupy) - `EventStudioSidebar.test.tsx`. (3) Nakladki podgladu -
// `EventStudioPreview.test.tsx`; tutaj stoi atrapa, bo przedmiotem dowodu jest
// to, KIEDY rama ja otwiera. (4) Gornego paska - atrapa oddaje jego dwie
// krawedzie (zmiana statusu, przelacznik podgladu).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { axeViolations, summarize } from "@/test/axe";
import { supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase/rpc";
import { adminEventDetailRow, STUDIO_EVENT_ID } from "@/test/events/adminEventStudioRows";
import type { AdminEventDetailRow } from "@/lib/events/eventDetailApi";
import type { EventStatus } from "@/lib/events/eventDetailApi";

const h = vi.hoisted(() => ({
  rpc: null as SupabaseRpcStub | null,
  /**
   * Tryb „odpowiedz nigdy nie przychodzi" - jedyny sposob na ZATRZYMANIE
   * zapytania w stanie oczekiwania. Bez niego nie da sie udowodnic, ze ekran
   * wczytywania jest ODROZNIALNY od odmowy, bo atrapa odpowiada natychmiast.
   */
  wiecznePending: false,
  isAdmin: true,
  role: "admin",
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args?: Record<string, unknown>) => {
      if (h.wiecznePending) return new Promise(() => {});
      if (h.rpc === null) throw new Error("test: atrapa RPC nie zostala ustawiona");
      return h.rpc.rpc(name, args);
    },
  },
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-admin-events", () => ({ ensureI18n: () => undefined }));
vi.mock("@/lib/i18n-admin-event-agenda", () => ({ ensureAgendaI18n: () => undefined }));
vi.mock("@/lib/i18n-admin-event-meetings", () => ({ ensureI18n: () => undefined }));
vi.mock("@/lib/i18n-admin-event-onsite", () => ({ ensureOnsiteI18n: () => undefined }));
vi.mock("@/lib/i18n-admin-event-registration", () => ({ ensureI18n: () => undefined }));

vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));

// Mapowanie odmow bazy ma wlasny plik testowy, a jego prawdziwa wersja ciagnie
// pelna instancje i18n. Tutaj liczy sie wylacznie to, ze rama pokazuje TO,
// co mapowanie zwrocilo.
vi.mock("@/lib/events/adminEventStudioErrors", () => ({
  adminEventStudioErrorMessage: (error: unknown) =>
    `odmowa:${error instanceof Error ? error.message : String(error)}`,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    isAdmin: h.isAdmin,
    roles: [h.role],
    user: { id: "11111111-1111-4111-8111-111111111111" },
    tenantId: "22222222-2222-4222-8222-222222222222",
    session: null,
  }),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

vi.mock("@/lib/icons/DynamicIcon", () => ({
  DynamicIcon: ({ name }: { name: string }) => <span data-testid={`ikona-${name}`} />,
}));

// Pasek gorny ma wlasne zachowanie (droplista statusu na Radix Popover) i nie
// jest przedmiotem tego dowodu. Atrapa oddaje jego DWIE krawedzie stykajace sie
// z rama: zmiane statusu i przelacznik podgladu.
vi.mock("@/components/admin/events/studio/EventStudioTopBar", () => ({
  EventStudioTopBar: ({
    status,
    section,
    onStatusChange,
    onTogglePreview,
  }: {
    status: string;
    section: string | null;
    onStatusChange: (next: EventStatus) => void;
    onTogglePreview: () => void;
  }) => (
    <div data-testid="pasek" data-status={status} data-section={section ?? ""}>
      <button type="button" onClick={() => onStatusChange("published")}>
        opublikuj
      </button>
      <button type="button" onClick={onTogglePreview}>
        przelacz-podglad
      </button>
    </div>
  ),
}));

// Nakladka podgladu ma wlasny plik testowy i wlasny komplet zapytan. Tutaj
// przedmiotem dowodu jest to, KIEDY rama ja otwiera - nie jak ona rysuje.
vi.mock("@/components/admin/events/studio/EventStudioPreview", () => ({
  EventStudioPreview: ({ open, publicHref }: { open: boolean; publicHref: string | null }) =>
    open ? <div data-testid="podglad" data-public-href={publicHref ?? ""} /> : null,
}));

const { EventStudioShell } = await import("@/components/admin/events/studio/EventStudioShell");

const TRESC = "tresc-sekcji";
const ODMOWA_ROLI = "adminEvents.list.adminOnly";
const NIE_ZNALEZIONO = "adminEvents.studio.errors.notFound";
const WYLACZONY_MODUL = "adminEvents.studio.features.disabled.title";

function stub(): SupabaseRpcStub {
  if (h.rpc === null) throw new Error("test: atrapa RPC nie zostala ustawiona");
  return h.rpc;
}

function Provider({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function sciezka(ogon: string): string {
  return `/admin/events/${STUDIO_EVENT_ID}/${ogon}`;
}

/** Montuje rame na wskazanym adresie; tresc sekcji jest znacznikiem. */
function rama(pathname = sciezka("overview")) {
  return render(
    <Provider>
      <EventStudioShell eventId={STUDIO_EVENT_ID} pathname={pathname}>
        <p>{TRESC}</p>
      </EventStudioShell>
    </Provider>,
  );
}

/** Planuje wiersz wydarzenia i pusta liste podstron - stan „wszystko dziala". */
function planuj(overrides: Partial<AdminEventDetailRow> = {}): void {
  stub().setData("admin_event_detail", [adminEventDetailRow(overrides)]);
  stub().setData("admin_event_pages_list", []);
}

/** Adres odnosnika o podanej tresci - `null`, gdy odnosnika nie ma. */
function href(tekst: string): string | null {
  const link = screen.queryByRole("link", { name: tekst });
  return link === null ? null : link.getAttribute("href");
}

beforeEach(() => {
  h.rpc = supabaseRpcStub();
  h.wiecznePending = false;
  h.isAdmin = true;
  h.role = "admin";
  h.toastSuccess.mockClear();
  h.toastError.mockClear();
});

afterEach(cleanup);

describe("EventStudioShell - bramka ROLI", () => {
  it("administrator MOZE: rama wczytuje wydarzenie i oddaje tresc sekcji", async () => {
    planuj();
    rama();

    expect(await screen.findByText(TRESC)).toBeInTheDocument();
    expect(stub().lastCall("admin_event_detail")?.arg("p_event_id")).toBe(STUDIO_EVENT_ID);
    expect(screen.queryByText(ODMOWA_ROLI)).not.toBeInTheDocument();
  });

  it("autor NIE MOZE: dostaje ZDANIE o odmowie, a nie tresc - i nie leci ani jedno zapytanie", async () => {
    // Druga polowa pary. Sam happy path przechodzilby takze wtedy, gdyby bramki
    // nie bylo wcale. Brak zapytania jest tu rownie wazny, co brak tresci:
    // pytanie, na ktore z gory znamy odpowiedz „forbidden", nie ma leciec.
    h.isAdmin = false;
    h.role = "author";
    planuj();
    rama();

    expect(await screen.findByText(ODMOWA_ROLI)).toBeInTheDocument();
    expect(screen.queryByText(TRESC)).not.toBeInTheDocument();
    expect(stub().names()).toEqual([]);
  });

  it("zwykly uzytkownik NIE MOZE, redaktor MOZE - granica biegnie po roli `editor`", async () => {
    h.isAdmin = false;
    h.role = "user";
    planuj();
    const { unmount } = rama();
    expect(await screen.findByText(ODMOWA_ROLI)).toBeInTheDocument();
    unmount();
    cleanup();

    h.role = "editor";
    rama();
    expect(await screen.findByText(TRESC)).toBeInTheDocument();
    expect(screen.queryByText(ODMOWA_ROLI)).not.toBeInTheDocument();
  });
});

describe("EventStudioShell - bramka ROLI dla PODSTRON jest wezsza", () => {
  it("administrator MOZE pytac o podstrony - `admin_event_pages_list` leci po TO wydarzenie", async () => {
    planuj();
    rama();

    await screen.findByText(TRESC);
    await waitFor(() => expect(stub().lastCall("admin_event_pages_list")).toBeDefined());
    expect(stub().lastCall("admin_event_pages_list")?.arg("p_event_id")).toBe(STUDIO_EVENT_ID);
  });

  it("redaktor NIE MOZE pytac o podstrony - RPC stoi na `assert_event_admin_tenant()`", async () => {
    // `admin_event_pages_list` odmawia redaktorowi (migracja 20260824090000),
    // wiec rama ma go o to NIE PYTAC. Widac to wylacznie po liscie wywolan:
    // ekran wyglada tak samo, a redaktor dostawalby czerwony blad na wejsciu.
    h.isAdmin = false;
    h.role = "editor";
    planuj();
    rama();

    await screen.findByText(TRESC);
    await waitFor(() => expect(stub().lastCall("admin_event_detail")).toBeDefined());
    expect(stub().callsFor("admin_event_pages_list")).toHaveLength(0);
  });
});

describe("EventStudioShell - bramka MODULOW", () => {
  it("modul WLACZONY: adres sekcji spotkan oddaje tresc", async () => {
    planuj({ features: {} });
    rama(sciezka("meetings/tables"));

    expect(await screen.findByText(TRESC)).toBeInTheDocument();
    expect(screen.queryByText(WYLACZONY_MODUL)).not.toBeInTheDocument();
  });

  it("modul WYLACZONY: ten sam adres oddaje ZDANIE o module, a nie panel", async () => {
    // Druga polowa pary. Adres nadal dziala - to jest cala idea
    // `EventStudioDisabledSection` - ale panel spotkan sie NIE montuje.
    planuj({ features: { meetings: false } });
    rama(sciezka("meetings/tables"));

    expect(await screen.findByText(WYLACZONY_MODUL)).toBeInTheDocument();
    expect(screen.queryByText(TRESC)).not.toBeInTheDocument();
    // Zdanie nazywa modul po imieniu, zeby nie kazac szukac po siedmiu
    // przelacznikach - i prowadzi do „Funkcji dodatkowych".
    expect(href("adminEvents.studio.features.disabled.action")).toBe(sciezka("features"));
  });

  it("wylaczony modul znika Z NAWIGACJI - grupa bez widocznych dzieci nie zostaje naglowkiem", async () => {
    planuj({ features: { meetings: false } });
    rama(sciezka("overview"));

    await screen.findByText(TRESC);
    expect(href("adminEvents.studio.groups.meetings")).toBeNull();
    // Pozostale grupy stoja nietkniete - wylaczenie jest punktowe.
    expect(href("adminEvents.studio.groups.onsite")).toBe(sciezka("onsite/desk"));
  });

  it("wylaczenie POJEDYNCZEJ sekcji zabiera jej pozycje, a reszte grupy zostawia", async () => {
    // „Bilety" chowaja JEDNA podstrone rejestracji, a nie cala grupe - mapa
    // funkcji nie jest bijekcja i to jest decyzja, nie przeoczenie.
    planuj({ features: { tickets: false } });
    rama(sciezka("registration/list"));

    await screen.findByText(TRESC);
    expect(href("adminEventRegistration.nav.registrations")).toBe(sciezka("registration/list"));
    expect(href("adminEventRegistration.nav.tickets")).toBeNull();
  });

  it("smiec w kolumnie `features` NIE zabiera studia - degraduje do „wszystko wlaczone”", async () => {
    // Tablica pod `features` znaczy „nie wiemy, co tam jest". Wyjatek zabralby
    // redaktorowi cale studio, a domysl „wszystko wylaczone" schowalby przed
    // nim polowe panelu bez zadnego powodu.
    planuj({ features: ["nonsens"] });
    rama(sciezka("meetings/tables"));

    expect(await screen.findByText(TRESC)).toBeInTheDocument();
    expect(screen.queryByText(WYLACZONY_MODUL)).not.toBeInTheDocument();
  });
});

describe("EventStudioShell - trzy rozne odpowiedzi zamiast jednej", () => {
  it("WCZYTYWANIE nie jest nieodroznialne od odmowy: krecidlo, zadnego zdania o dostepie", async () => {
    // „Nie wiem" i „nie wolno" to rozne odpowiedzi. Sklejone w jedna kaza
    // redaktorowi pisac do wsparcia w sprawie zerwanego polaczenia.
    h.wiecznePending = true;
    const { container } = rama();

    await waitFor(() => expect(container.querySelector(".animate-spin")).not.toBeNull());
    expect(screen.queryByText(ODMOWA_ROLI)).not.toBeInTheDocument();
    expect(screen.queryByText(NIE_ZNALEZIONO)).not.toBeInTheDocument();
    expect(screen.queryByText(TRESC)).not.toBeInTheDocument();
  });

  it("WYDARZENIE NIEISTNIEJACE dostaje wlasne zdanie, inne niz odmowa roli", async () => {
    stub().setData("admin_event_detail", []);
    stub().setData("admin_event_pages_list", []);
    rama();

    expect(await screen.findByText(NIE_ZNALEZIONO)).toBeInTheDocument();
    expect(screen.queryByText(ODMOWA_ROLI)).not.toBeInTheDocument();
    expect(screen.queryByText(TRESC)).not.toBeInTheDocument();
  });

  it("ODMOWA BAZY konczy wczytywanie zdaniem „nie znaleziono”, a nie wiecznym krecidlem", async () => {
    // Wiersza nie ma z innego powodu niz brak rekordu, ale odpowiedz dla
    // redaktora jest ta sama: nie ma czego edytowac. Krecidlo bez konca byloby
    // trzecia, klamliwa odpowiedzia.
    stub().setError("admin_event_detail", "forbidden: not an event admin", "42501");
    stub().setData("admin_event_pages_list", []);
    const { container } = rama();

    expect(await screen.findByText(NIE_ZNALEZIONO)).toBeInTheDocument();
    expect(container.querySelector(".animate-spin")).toBeNull();
  });
});

describe("EventStudioShell - tozsamosc wydarzenia i podglad", () => {
  it("naglowek sidebara dostaje GOTOWE napisy: nazwe w jezyku panelu i termin w strefie WYDARZENIA", async () => {
    planuj();
    rama();

    expect(await screen.findByText("Kongres Energetyczny")).toBeInTheDocument();
    // 09:00 UTC to 11:00 w Warszawie - gdyby termin liczyl sie w strefie
    // przegladarki, organizator w innej strefie zaplanowalby odprawe o zlej
    // porze. Asercja czyta godzine, a nie caly napis daty.
    expect(screen.getByText(/11:00/)).toBeInTheDocument();
  });

  it("wydarzenie bez terminu dostaje ZDANIE, a nie pusty wiersz", async () => {
    planuj({ starts_at: "" });
    rama();

    expect(await screen.findByText("adminEvents.list.row.noDate")).toBeInTheDocument();
  });

  it("SZKIC nie ma strony publicznej - odnosnik „otworz wydarzenie” nie prowadzi na 404", async () => {
    planuj({ status: "draft" });
    rama();

    await screen.findByText(TRESC);
    expect(href("adminEvents.studio.nav.openEvent")).toBeNull();
    expect(screen.getByText("adminEvents.studio.nav.openEventDraft")).toBeInTheDocument();
  });

  it("wydarzenie OPUBLIKOWANE dostaje odnosnik do swojej strony", async () => {
    planuj({ status: "published", slug: "kongres-energetyczny" });
    rama();

    await screen.findByText(TRESC);
    expect(href("adminEvents.studio.nav.openEvent")).toBe("/events/kongres-energetyczny");
  });

  it("PODGLAD JEST ZAMKNIETY NA WEJSCIU i otwiera go dopiero przycisk paska", async () => {
    // Otwarty domyslnie zaslanial caly panel i po utworzeniu szkicu wygladal
    // jak jedyny dostepny ekran.
    planuj();
    rama();

    await screen.findByText(TRESC);
    expect(screen.queryByTestId("podglad")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "przelacz-podglad" }));
    expect(screen.getByTestId("podglad")).toBeInTheDocument();
  });

  it("pasek gorny dostaje SEKCJE policzona przez rame, a nie liczy jej drugi raz z adresu", async () => {
    planuj();
    rama(sciezka("registration/form"));

    await screen.findByText(TRESC);
    expect(screen.getByTestId("pasek").getAttribute("data-section")).toBe("registrationForm");
  });
});

describe("EventStudioShell - zmiana statusu", () => {
  it("udana publikacja melduje sie kluczem statusu, a nie ogolnym „zapisano”", async () => {
    planuj({ status: "draft" });
    stub().setData("admin_event_set_status", "published");
    rama();

    await screen.findByText(TRESC);
    fireEvent.click(screen.getByRole("button", { name: "opublikuj" }));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    expect(h.toastSuccess).toHaveBeenCalledWith("adminEvents.studio.toasts.status.published");
    expect(stub().lastCall("admin_event_set_status")?.arg("p_status")).toBe("published");
    expect(stub().lastCall("admin_event_set_status")?.arg("p_event_id")).toBe(STUDIO_EVENT_ID);
  });

  it("odmowa bazy idzie przez mapowanie odmow, a nie wprost do toasta", async () => {
    planuj({ status: "draft" });
    stub().setError("admin_event_set_status", "missing_title_en: publish requires both titles");
    rama();

    await screen.findByText(TRESC);
    fireEvent.click(screen.getByRole("button", { name: "opublikuj" }));

    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(h.toastError.mock.calls[0][0]).toContain("odmowa:missing_title_en");
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });
});

describe("EventStudioShell - dostepnosc", () => {
  it("rama nie ma naruszen axe ani przy odmowie roli, ani przy pelnej tresci", async () => {
    planuj();
    const { container, unmount } = rama();
    await screen.findByText(TRESC);
    const pelna = await axeViolations(container);
    expect(pelna, summarize(pelna)).toEqual([]);
    unmount();
    cleanup();

    h.isAdmin = false;
    h.role = "author";
    const odmowa = rama();
    await screen.findByText(ODMOWA_ROLI);
    const naruszenia = await axeViolations(odmowa.container);
    expect(naruszenia, summarize(naruszenia)).toEqual([]);
  });
});
