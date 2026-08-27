// Ekran „Strony i menu" - PIEC ZAWSZE OBECNYCH POZYCJI I ICH ZESTAW AKCJI.
//
// CO TEN PLIK DOWODZI.
//   1. POZYCJA MODULOWA NIE MA AKCJI ODPIECIA - ani w zakladce „W menu", ani
//      w „Pozostalych", gdzie laduje po ukryciu. `admin_event_page_detach`
//      odmawia jej wyjatkiem `module_page` (migracja 20260826181500, krok 5),
//      wiec przycisk, ktory zawsze konczy sie bledem, byl by obietnica bez
//      pokrycia. Zwykla pozycja ten przycisk MA - bez tego kontrapunktu test
//      nie odroznia „ukrylismy jednej akcji" od „ukrylismy wszystkim".
//   2. STAN „STALA POZYCJA" JEST NAZWANY. Wiersz z jednym przyciskiem mniej
//      i bez wyjasnienia czyta sie jak awaria panelu.
//   3. PRZELACZENIE OBECNOSCI W MENU NIE WYSYLA ZNACZNIKA. Klient wysyla CALY
//      wiersz przy kazdej zmianie, wiec to jest miejsce, w ktorym znacznik da
//      sie zgubic po cichu - a zgubiony znacznik znaczy szosta strone przy
//      nastepnym zasiewie.
//   4. TRZY STANY PUSTEJ LISTY MAJA TRZY ROZNE NAPISY. „Jeszcze nie wiem",
//      „nie udalo sie" i „nic tu nie ma" to trzy rozne informacje: pierwsza
//      kaze czekac, druga odswiezyc, trzecia sprawdzic, czy wydarzenie istnieje.
//   5. ZASIANE POZYCJE LADUJA W PIERWSZEJ ZAKLADCE, w kolejnosci z bazy.
//
// CZEGO SWIADOMIE NIE DUBLUJE. (1) Regul czystych (`splitEventPages`,
// `eventPageLabel`, `isModuleEventPage`, `eventPageInput`) - tabele przypadkow
// sa w `lib/events/__tests__/eventPagesApi.test.ts`; tutaj dowodzimy, ze
// organizm ich UZYWA. (2) Zachowania bazy (zasiew, odmowa odpiecia,
// idempotencja) - to `scripts/events-harness/runtime_test.d/90_module_pages.sql`
// na zywym Postgresie. (3) Hookow - sa zamockowane na poziomie MODULU, bo
// przedmiotem dowodu jest to, CO organizm do nich wysyla.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type { AdminEventDetailRow } from "@/lib/events/eventDetailApi";
import type { EventPageInput, EventPageRow } from "@/lib/events/eventPagesApi";

const h = vi.hoisted(() => ({
  rows: [] as unknown[],
  isLoading: false,
  isError: false,
  saveInputs: [] as unknown[],
  detachIds: [] as string[],
  reorderCalls: [] as (readonly string[])[],
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-admin-events", () => ({ ensureI18n: () => undefined }));
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
  useNavigate: () => () => undefined,
}));

// Selektor ikony ciagnie caly katalog Lucide - tutaj liczy sie wylacznie NAZWA
// ikony, ktora wiersz probuje narysowac.
vi.mock("@/lib/icons/DynamicIcon", () => ({
  DynamicIcon: ({ name }: { name: string }) => <span data-testid={`ikona-${name}`} />,
}));

// Podglad na zywo i dwa dialogi sa poza przedmiotem dowodu: pierwszy nie
// renderuje niczego w tym drzewie, dwa pozostale otwieraja sie na zadanie.
vi.mock("@/components/admin/events/studio/EventStudioPreviewContext", () => ({
  useSyncEventPreview: () => undefined,
}));
vi.mock("@/components/admin/events/molecules/EventPageCreateDialog", () => ({
  EventPageCreateDialog: () => null,
}));
vi.mock("@/components/admin/events/molecules/EventPageEntrySheet", () => ({
  EventPageEntrySheet: () => null,
}));

vi.mock("@/lib/events/useEventTermsGroups", () => ({
  useEventGroups: () => ({ data: [] }),
}));
vi.mock("@/lib/events/useAdminEventDetail", () => ({
  useSaveEventGeneral: () => ({ mutate: () => undefined, isPending: false }),
}));

vi.mock("@/lib/events/useAdminEventPages", () => ({
  useAdminEventPages: () => ({
    data: h.rows,
    isLoading: h.isLoading,
    isError: h.isError,
    refetch: async () => ({ data: h.rows }),
  }),
  useEventRootPage: () => ({
    data: {
      id: "root",
      slug: "kongres",
      title_pl: "Kongres",
      title_en: "Congress",
      status: "published",
    },
  }),
  useEventPageDocument: () => ({ data: null, isPending: false }),
  useSaveEventPage: () => ({
    mutate: (input: unknown, opts?: { onSuccess?: (value: string) => void }) => {
      h.saveInputs.push(input);
      opts?.onSuccess?.("entry-1");
    },
    isPending: false,
  }),
  useDetachEventPage: () => ({
    mutate: (id: string, opts?: { onSuccess?: (value: boolean) => void }) => {
      h.detachIds.push(id);
      opts?.onSuccess?.(true);
    },
    isPending: false,
  }),
  useReorderEventPages: () => ({
    mutate: (ids: readonly string[], opts?: { onSuccess?: (value: number) => void }) => {
      h.reorderCalls.push(ids);
      opts?.onSuccess?.(ids.length);
    },
    isPending: false,
  }),
  useCreateEventPage: () => ({ mutate: () => undefined, isPending: false }),
}));

const { EventPagesMenuPanel } =
  await import("@/components/admin/events/organisms/EventPagesMenuPanel");

/** Wiersz listy podstron. `module: null` = zwykla pozycja zalozona przez redakcje. */
function page(overrides: Partial<EventPageRow> & { page_slug: string }): EventPageRow {
  return {
    id: `entry-${overrides.page_slug}`,
    page_id: `page-${overrides.page_slug}`,
    page_path: `kongres/${overrides.page_slug}`,
    page_status: "published",
    title_pl: overrides.page_slug,
    title_en: overrides.page_slug,
    menu_label_pl: null,
    menu_label_en: null,
    icon: "users",
    color: "#D73953",
    in_menu: true,
    sort_order: 10,
    visible_to_groups: [],
    module: null,
    updated_at: "2026-08-26T10:00:00.000Z",
    ...overrides,
  };
}

/**
 * Wiersz studia - 49 kolumn sygnatury `admin_event_detail`, z ktorych ten ekran
 * czyta trzy. Reszta jest wypelniona wartosciami pustymi, zeby ksztalt zgadzal
 * sie z typem: atrapa wezsza od sygnatury przestalaby sie kompilowac przy
 * pierwszej nowej kolumnie i to jest ZALETA, nie koszt.
 */
function detailRow(overrides: Partial<AdminEventDetailRow> = {}): AdminEventDetailRow {
  return {
    branding: {},
    cancelled_at: "",
    capacity: 0,
    chatham_house: false,
    city: "",
    country: "",
    cover_url: "",
    created_at: "",
    description_en: "",
    description_pl: "",
    early_rsvp_rank: 0,
    ends_at: "",
    event_type_id: "",
    external_registration_url: "",
    features: {},
    format: "onsite",
    guest_mode: "full",
    has_recording: false,
    has_stream: false,
    home_design: "standard",
    id: "event-1",
    join_url: "",
    kind: "in_person",
    languages: [],
    location: "",
    min_tier_rank: 0,
    pages_display_mode: "list",
    postal_code: "",
    published_at: "",
    recording_url: "",
    region: "",
    registration_flow: "direct",
    registration_mode: "internal",
    root_page_id: "root",
    rsvp_opens_at: "",
    slug: "kongres",
    social_hashtag: "",
    starts_at: "",
    status: "published",
    street_address: "",
    support_email: "",
    ticket_currency: "PLN",
    ticket_price_cents: 0,
    timezone: "Europe/Warsaw",
    title_en: "Congress",
    title_pl: "Kongres",
    type_accent_color: "",
    type_icon: "",
    type_key: "in_person",
    type_name_en: "",
    type_name_pl: "",
    updated_at: "",
    video_header_id: "",
    video_header_platform: "",
    visibility: "public",
    ...overrides,
  };
}

/** Piatka zasiana migracja, w kolejnosci wzorca. */
const PIATKA: readonly EventPageRow[] = [
  page({ page_slug: "uczestnicy", module: "participants", sort_order: 10 }),
  page({ page_slug: "prelegenci", module: "speakers", sort_order: 20, icon: "mic" }),
  page({ page_slug: "partnerzy", module: "partners", sort_order: 30, icon: "handshake" }),
  page({ page_slug: "agenda", module: "agenda", sort_order: 40, icon: "calendar-days" }),
  page({ page_slug: "dyskusje", module: "discussions", sort_order: 50, icon: "messages-square" }),
];

function renderPanel(node: ReactNode = <EventPagesMenuPanel row={detailRow()} />) {
  return render(node);
}

/**
 * Przelacza na zakladke „Pozostale".
 *
 * Radix montuje TRESC WYLACZNIE aktywnej zakladki, wiec wiersza spoza menu nie
 * ma w drzewie, dopoki ktos jej nie otworzy. `mouseDown`, nie `click`: Radix
 * wybiera zakladke wlasnie na `mouseDown`, a happy-dom nie rozwija `click`
 * w pelna sekwencje zdarzen wskaznika.
 */
function otworzPozostale(): void {
  fireEvent.mouseDown(screen.getByText(/pages\.otherPages/));
}

/** Wiersz listy po widocznej etykiecie. */
function wiersz(label: string): HTMLElement {
  const found = screen.getAllByText(label).find((node) => node.closest("li") !== null);
  if (found === undefined) throw new Error(`brak wiersza „${label}” na ekranie`);
  const li = found.closest("li");
  if (li === null) throw new Error(`etykieta „${label}” nie siedzi w wierszu listy`);
  return li;
}

beforeEach(() => {
  h.rows = [];
  h.isLoading = false;
  h.isError = false;
  h.saveInputs = [];
  h.detachIds = [];
  h.reorderCalls = [];
  h.toastSuccess.mockClear();
  h.toastError.mockClear();
});

describe("piatka stron modulowych w zakladce „W menu”", () => {
  it("wszystkie piec pozycji stoi w PIERWSZEJ zakladce, w kolejnosci z bazy", () => {
    h.rows = [...PIATKA];
    renderPanel();

    // Licznik zakladki jest miejscem, w ktorym rozjazd podzialu widac od razu.
    expect(screen.getByText(/pages\.menuPages \(5\)/)).toBeTruthy();
    expect(screen.getByText(/pages\.otherPages \(0\)/)).toBeTruthy();

    const etykiety = screen
      .getAllByRole("listitem")
      .map((li) => li.querySelector("span.font-medium")?.textContent ?? "");
    expect(etykiety).toEqual(["uczestnicy", "prelegenci", "partnerzy", "agenda", "dyskusje"]);
  });

  it("kazda pozycja modulowa niesie SWOJA ikone", () => {
    h.rows = [...PIATKA];
    renderPanel();
    for (const nazwa of ["users", "mic", "handshake", "calendar-days", "messages-square"]) {
      expect(screen.getByTestId(`ikona-${nazwa}`)).toBeTruthy();
    }
  });

  // TO JEST GLOWNA REGULA TEGO EKRANU. Pozycji modulowej nie da sie odpiac -
  // baza odmawia - wiec przycisk nie ma tu czego obiecywac.
  it("pozycja modulowa NIE MA przycisku odpiecia", () => {
    h.rows = [...PIATKA];
    renderPanel();
    const li = wiersz("agenda");
    expect(within(li).queryByLabelText(/rowActions\.detach/)).toBeNull();
  });

  // KONTRAPUNKT: gdyby przycisk zniknal WSZYSTKIM, asercja wyzej przechodzilaby
  // na regresji, ktora odbiera redakcji dzialajaca akcje.
  it("zwykla pozycja menu NADAL ma przycisk odpiecia i wola mutacje", () => {
    h.rows = [...PIATKA, page({ page_slug: "prasa", sort_order: 60 })];
    renderPanel();
    const li = wiersz("prasa");
    const przycisk = within(li).getByLabelText(/rowActions\.detach/);
    przycisk.click();
    expect(h.detachIds).toEqual(["entry-prasa"]);
  });

  it("stan „stala pozycja” jest nazwany przy wierszu, razem z wyjasnieniem", () => {
    h.rows = [...PIATKA];
    renderPanel();
    const li = wiersz("agenda");
    expect(within(li).getByText("adminEvents.studio.pages.states.module")).toBeTruthy();
    // Wyjasnienie musi trafic takze do czytnika ekranu, nie tylko do `title`.
    expect(within(li).getByText(/rowActions\.moduleLocked\(label=agenda\)/)).toBeTruthy();
  });

  it("zwykla pozycja nie dostaje znacznika stalej pozycji", () => {
    h.rows = [page({ page_slug: "prasa" })];
    renderPanel();
    const li = wiersz("prasa");
    expect(within(li).queryByText("adminEvents.studio.pages.states.module")).toBeNull();
  });

  // AKCJE UKRYTE WZROKOWO, ALE OBECNE W DRZEWIE DOSTEPNOSCI. `opacity-0`
  // zostawia przyciski w kolejnosci fokusa; `display: none` by je wyrzucil
  // i akcja bylaby nieosiagalna z klawiatury. Asercja pilnuje OBU stron:
  // klasa ukrywajaca jest, a przycisk daje sie znalezc i kliknac.
  it("akcje wiersza sa ukryte wzrokowo, ale dostepne z klawiatury i dotyku", () => {
    h.rows = [page({ page_slug: "prasa" })];
    renderPanel();
    const li = wiersz("prasa");
    const grupa = within(li).getByLabelText(/rowActions\.edit\(label=/).parentElement;
    expect(grupa?.className).toContain("opacity-0");
    expect(grupa?.className).toContain("group-hover/row:opacity-100");
    expect(grupa?.className).toContain("group-focus-within/row:opacity-100");
    // Ekran dotykowy nie ma hoveru - bez tego czlonu przyciski byly by
    // niewidoczne, ale klikalne.
    expect(grupa?.className).toContain("[@media(hover:none)]:opacity-100");
  });
});

describe("pozycja modulowa ukryta poza menu", () => {
  it("laduje w drugiej zakladce i TAM tez nie ma odpiecia", () => {
    h.rows = [page({ page_slug: "dyskusje", module: "discussions", in_menu: false })];
    renderPanel();
    expect(screen.getByText(/pages\.menuPages \(0\)/)).toBeTruthy();
    expect(screen.getByText(/pages\.otherPages \(1\)/)).toBeTruthy();

    otworzPozostale();
    const li = wiersz("dyskusje");
    expect(within(li).queryByLabelText(/rowActions\.detach/)).toBeNull();
    // Droga powrotna zostaje: „Dodaj do menu" jest jedyna akcja odwracajaca.
    expect(within(li).getByText("adminEvents.studio.pages.rowActions.addToMenu")).toBeTruthy();
    expect(within(li).getByText("adminEvents.studio.pages.states.module")).toBeTruthy();
  });

  it("zwykla pozycja poza menu zachowuje odpiecie", () => {
    h.rows = [page({ page_slug: "prasa", in_menu: false })];
    renderPanel();
    otworzPozostale();
    const li = wiersz("prasa");
    expect(within(li).getByLabelText(/rowActions\.detach/)).toBeTruthy();
  });
});

describe("zapis pozycji modulowej", () => {
  // KLIENT WYSYLA CALY WIERSZ, wiec to jest miejsce, w ktorym znacznik da sie
  // zgubic po cichu. Gdyby `module` pojechal w payloadzie, ochrona piatki
  // stalaby wylacznie na tym, ze baza go ignoruje.
  it("pozycja modulowa przestawia sie strzalka jak kazda inna", () => {
    h.rows = [...PIATKA];
    renderPanel();

    // KOLEJNOSC ZOSTAJE REDAKCJI. Znacznik odbiera tylko odpiecie - gdyby
    // odebral takze przestawianie, piatka stalaby w kolejnosci, ktorej nikt nie
    // wybieral. Kazde nacisniecie wysyla CALA liste identyfikatorow, bo seria
    // osobnych zapisow zostawia menu w stanie posrednim.
    const li = wiersz("prelegenci");
    within(li)
      .getByLabelText(/rowActions\.moveUp/)
      .click();
    expect(h.reorderCalls).toEqual([
      ["entry-prelegenci", "entry-uczestnicy", "entry-partnerzy", "entry-agenda", "entry-dyskusje"],
    ]);
  });

  it("przywrocenie ukrytej pozycji modulowej do menu nie niesie znacznika", () => {
    h.rows = [page({ page_slug: "dyskusje", module: "discussions", in_menu: false })];
    renderPanel();
    otworzPozostale();
    const li = wiersz("dyskusje");
    within(li).getByText("adminEvents.studio.pages.rowActions.addToMenu").click();

    expect(h.saveInputs).toHaveLength(1);
    const input = h.saveInputs[0] as EventPageInput & Record<string, unknown>;
    expect(Object.keys(input)).not.toContain("module");
    expect(input.id).toBe("entry-dyskusje");
    expect(input.inMenu).toBe(true);
    // Reszta wiersza jedzie razem ze zmiana - inaczej ikona i kolor zniknelyby.
    expect(input.icon).toBe("users");
    expect(input.color).toBe("#D73953");
  });
});

describe("trzy stany pustej listy", () => {
  it("wczytywanie mowi „wczytywanie”", () => {
    h.rows = [];
    h.isLoading = true;
    renderPanel();
    expect(screen.getByText("adminEvents.studio.pages.loading")).toBeTruthy();
  });

  it("awaria mowi „nie udalo sie”", () => {
    h.rows = [];
    h.isError = true;
    renderPanel();
    expect(screen.getByText("adminEvents.studio.pages.loadFailed")).toBeTruthy();
  });

  // TRZECI STAN JEST NOWY. Do zasiewu pusta lista znaczyla „utworz pierwsza
  // strone"; teraz piatka powstaje sama, wiec pustka znaczy cos innego i musi
  // mowic cos innego.
  it("pustka po udanym wczytaniu mowi trzecia rzecz, nie te dwie", () => {
    h.rows = [];
    renderPanel();
    const napis = screen.getByText("adminEvents.studio.pages.noPagesYet");
    expect(napis).toBeTruthy();
    expect(screen.queryByText("adminEvents.studio.pages.loading")).toBeNull();
    expect(screen.queryByText("adminEvents.studio.pages.loadFailed")).toBeNull();
  });
});
