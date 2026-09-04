// Ekran „Strony i menu" - USTAWIENIA, PRZYPIECIE, TWORZENIE I PODGLAD.
//
// PO CO TRZECI PLIK OBOK DWOCH ISTNIEJACYCH. Podzial idzie po ODPOWIEDZIALNOSCI
// ekranu, nie po wygodzie:
//   * `admin/events/__tests__/EventPagesMenuPanel.test.tsx` - PIATKA POZYCJI
//     MODULOWYCH: brak odpiecia, znacznik „stala pozycja", trzy stany pustej
//     listy, przestawienie strzalka w gore, przywrocenie ukrytej pozycji.
//   * `EventPagesMenuPanelDetach.test.tsx` (obok) - ODMOWA ODPIECIA: co widzi
//     redaktor, gdy baza odmowi, i czym rozni sie odmowa znana od nieznanej.
//   * TEN PLIK - cala reszta ekranu, ktorej tamte dwa nie ruszaja: PASEK ZAPISU
//     ustawien ukladu i trybu prezentacji, PRZYPIECIE strony nieprzypietej
//     (obie drogi), UTWORZENIE strony razem z droga do jej tresci, PODGLAD
//     na zywo, SZUFLADA edycji pozycji, przestawienie w DOL i puste zakladki.
//
// ATRAPA STOI NA GRANICY SIECI, NIE NA HOOKACH. Tamte dwa pliki podmieniaja
// `useAdminEventPages` i siostry, wiec dowodza, CO ekran wysyla do hooka. Tutaj
// atrapa jest o warstwe nizej - `@/integrations/supabase/client` - wiec przez
// pomiar przechodzi PRAWDZIWY hook, PRAWDZIWY `eventPagesApi` i prawdziwe
// uniewaznienie zapytan. Dzieki temu widac rzeczy, ktorych atrapa hooka pokazac
// nie moze: ze utworzenie strony NAPRAWDE czyta liste drugi raz i ze slug do
// edytora tresci bierze sie z tego drugiego odczytu, a nie z odpowiedzi RPC.
//
// ZAWEZENIE NAJEMCEM. Wszystkie operacje tego ekranu ida przez RPC
// `admin_event_*`, wiec asertujemy NAZWE FUNKCJI i LADUNEK; samo zawezenie
// tenantem siedzi w SQL (`assert_editor_tenant`) i pilnuje go bramka
// `check:sql-tenant-scope`. Jedyny wyjatek to odczyt `pages` (korzen i dokument
// podgladu) - tam zawezenie robi RLS tabeli.
//
// CZEGO SWIADOMIE NIE DUBLUJE. (1) Regul czystych (`splitEventPages`,
// `moveEventPage`, `nextEventPageSortOrder`, `eventPageInput`) - tabele
// przypadkow sa w `lib/events/__tests__/eventPagesApi.test.ts`. (2) Wnetrza
// dwoch dialogow (`EventPageCreateDialog`, `EventPageEntrySheet`) - maja wlasne
// pliki; tutaj stoja atrapy oddajace ich KONTRAKT, bo przedmiotem dowodu jest
// to, co ekran robi z ich odpowiedzia. (3) Mapowania odmow bazy - to
// `EventPagesMenuPanelDetach.test.tsx`.
//
// RODO: zadnych prawdziwych danych osobowych, adresy wylacznie `example.org`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { fail, ok, supabaseFromStub, type SupabaseFromStub } from "@/test/supabase/chain";
import { supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase/rpc";
import { adminEventDetailRow, STUDIO_EVENT_ID } from "@/test/events/adminEventStudioRows";
import type { AdminEventDetailRow } from "@/lib/events/eventDetailApi";
import type { EventPageRow } from "@/lib/events/eventPagesApi";
import { eventPagesKeys } from "@/lib/events/useAdminEventPages";

/** Ksztalt argumentu, ktory szuflada pozycji oddaje przez `onSubmit`. */
interface WejscieZapisuPozycji {
  id?: string;
  menuLabelPl?: string;
  inMenu?: boolean;
  sortOrder?: number;
  icon?: string | null;
  color?: string | null;
  visibleToGroups?: readonly string[];
}

/** Drugi argument `toast.success` - opcjonalna akcja obok komunikatu. */
interface AkcjaToastu {
  action?: { label: string; onClick: () => void };
}

const h = vi.hoisted(() => ({
  rpc: null as SupabaseRpcStub | null,
  from: null as SupabaseFromStub | null,
  /** Odpowiedz `admin_event_pages_list` - podmieniana takze MIEDZY odczytami. */
  rows: [] as unknown[],
  /** `true` = odczyt dokumentu podgladu wisi, dopoki test go nie uwolni. */
  dokumentWisi: false,
  /** `true` = odczyt dokumentu podgladu konczy sie odmowa RLS. */
  dokumentOdmawia: false,
  uwolnijDokument: null as (() => void) | null,
  /** Szkice wpisane do podgladu na zywo, w kolejnosci renderow. */
  podglady: [] as Record<string, unknown>[],
  /** Cele nawigacji - akcja toastu prowadzi do edytora tresci. */
  nawigacje: [] as unknown[],
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args?: Record<string, unknown>) => {
      if (h.rpc === null) throw new Error("test: atrapa RPC nie zostala ustawiona");
      return h.rpc.rpc(name, args);
    },
    from: (table: string) => {
      if (h.from === null) throw new Error("test: atrapa tabel nie zostala ustawiona");
      return h.from.from(table);
    },
  },
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-admin-events", () => ({ ensureI18n: () => undefined }));
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
vi.mock("@/lib/events/adminEventStudioErrors", () => ({
  adminEventStudioErrorMessage: (error: unknown) =>
    `odmowa:${error instanceof Error ? error.message : String(error)}`,
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
  useNavigate: () => (options: unknown) => {
    h.nawigacje.push(options);
  },
}));

vi.mock("@/lib/icons/DynamicIcon", () => ({
  DynamicIcon: ({ name }: { name: string }) => <span data-testid={`ikona-${name}`} />,
}));

// PODGLAD NA ZYWO JEST TU PRZEDMIOTEM DOWODU, nie tlem: kanwa mieszka w ramie
// studia, wiec w tym drzewie nie ma jej wcale. Atrapa zapisuje SZKIC, ktory
// ekran do niej wpisuje - i to jest jedyny sposob zobaczenia, co redaktor ma
// zobaczyc po kliknieciu w nazwe pozycji.
vi.mock("@/components/admin/events/studio/EventStudioPreviewContext", () => ({
  useSyncEventPreview: (partial: Record<string, unknown>) => {
    h.podglady.push(partial);
  },
}));

// Dialog tworzenia strony ma wlasny plik testowy - tutaj zostaje z niego
// KONTRAKT: istnieje wylacznie otwarty i oddaje jedno wejscie utworzenia.
vi.mock("@/components/admin/events/molecules/EventPageCreateDialog", () => ({
  EventPageCreateDialog: ({
    open,
    eventId,
    isSaving,
    onSubmit,
  }: {
    open: boolean;
    eventId: string;
    isSaving: boolean;
    onSubmit: (input: {
      eventId: string;
      titlePl: string;
      titleEn: string;
      icon?: string;
      inMenu?: boolean;
      templateId?: string | null;
    }) => void;
  }) =>
    open ? (
      <div data-testid="dialog-tworzenia">
        <span data-testid="dialog-tworzenia-zapisuje">{isSaving ? "tak" : "nie"}</span>
        <button
          type="button"
          onClick={() =>
            onSubmit({
              eventId,
              titlePl: "Dla prasy",
              titleEn: "Press room",
              icon: "newspaper",
              inMenu: true,
              templateId: null,
            })
          }
        >
          utworz-strone
        </button>
      </div>
    ) : null,
}));

// Szuflada edycji pozycji - z kontraktu zostaje IDENTYFIKATOR pozycji, nad
// ktora jest otwarta (to jest cala tresc komentarza „szuflada trzyma
// IDENTYFIKATOR, nie wiersz") i jedno wejscie zapisu.
vi.mock("@/components/admin/events/molecules/EventPageEntrySheet", () => ({
  EventPageEntrySheet: ({
    open,
    entry,
    groups,
    onOpenChange,
    onSubmit,
  }: {
    open: boolean;
    entry: {
      id: string;
      in_menu: boolean;
      sort_order: number;
      icon: string | null;
      color: string | null;
      visible_to_groups: string[];
      title_pl: string;
    } | null;
    groups: readonly { id: string }[];
    onOpenChange: (open: boolean) => void;
    onSubmit: (input: WejscieZapisuPozycji) => void;
  }) =>
    open && entry !== null ? (
      <div data-testid="szuflada-pozycji">
        <span data-testid="szuflada-pozycja-id">{entry.id}</span>
        <span data-testid="szuflada-liczba-grup">{groups.length}</span>
        <button
          type="button"
          onClick={() =>
            onSubmit({
              id: entry.id,
              menuLabelPl: "Dla prasy",
              inMenu: entry.in_menu,
              sortOrder: entry.sort_order,
              icon: entry.icon,
              color: entry.color,
              visibleToGroups: entry.visible_to_groups,
            })
          }
        >
          zapisz-pozycje
        </button>
        <button type="button" onClick={() => onOpenChange(false)}>
          zamknij-szuflade
        </button>
      </div>
    ) : null,
}));

const { EventPagesMenuPanel } =
  await import("@/components/admin/events/organisms/EventPagesMenuPanel");

const LISTA = "admin_event_pages_list";
const ZAPIS_POZYCJI = "admin_event_page_upsert";
const ODPIECIE = "admin_event_page_detach";
const KOLEJNOSC = "admin_event_pages_reorder";
const UTWORZENIE = "admin_event_page_create";
const ZAPIS_USTAWIEN = "admin_event_general_save";
const GRUPY = "admin_event_groups_list";

/** Wiersz listy podstron. `module: null` = zwykla pozycja zalozona przez redakcje. */
function strona(overrides: Partial<EventPageRow> & { page_slug: string }): EventPageRow {
  return {
    id: `entry-${overrides.page_slug}`,
    page_id: `page-${overrides.page_slug}`,
    page_path: `kongres/${overrides.page_slug}`,
    page_status: "published",
    title_pl: overrides.page_slug,
    title_en: overrides.page_slug,
    menu_label_pl: null,
    menu_label_en: null,
    icon: "file-text",
    color: null,
    in_menu: true,
    sort_order: 10,
    visible_to_groups: [],
    module: null,
    updated_at: "2026-08-26T10:00:00.000Z",
    ...overrides,
  };
}

/** Strona z poddrzewa korzenia BEZ mapowania - `id` z `LEFT JOIN`-a jest pusty. */
function stronaNieprzypieta(slug: string): EventPageRow {
  return strona({ page_slug: slug, id: null, in_menu: false, sort_order: 0, icon: null });
}

/**
 * Klient zapytan ZYJE POZA komponentem otoczki.
 *
 * Nie jest to wygoda: test defektu podgladu musi poznac moment, w ktorym odczyt
 * dokumentu SIE ZAKONCZYL. Bez dostepu do pamieci zapytan jedynym sygnalem
 * bylby skutek badanego defektu - a asercja, ktora czeka na defekt, przestaje
 * cokolwiek dowodzic w dniu, w ktorym defekt zniknie.
 */
let klient: QueryClient | null = null;

function Otoczka({ children }: { children: ReactNode }) {
  if (klient === null) throw new Error("test: klient zapytan nie zostal ustawiony");
  return <QueryClientProvider client={klient}>{children}</QueryClientProvider>;
}

/** Renderuje ekran i czeka, az pierwszy odczyt listy dojedzie do drzewa. */
async function panel(row: AdminEventDetailRow = adminEventDetailRow()) {
  const wynik = render(
    <Otoczka>
      <EventPagesMenuPanel row={row} />
    </Otoczka>,
  );
  await waitFor(() => expect(screen.queryByText("adminEvents.studio.pages.loading")).toBeNull());
  return wynik;
}

/** Wiersz listy po widocznej etykiecie. */
function wiersz(label: string): HTMLElement {
  const found = screen.getAllByText(label).find((node) => node.closest("li") !== null);
  const li = found?.closest("li") ?? null;
  if (li === null) throw new Error(`brak wiersza „${label}” na ekranie`);
  return li;
}

/**
 * Przelacza na zakladke „Pozostale".
 *
 * `mouseDown`, nie `click`: Radix wybiera zakladke wlasnie na `mouseDown`,
 * a happy-dom nie rozwija `click` w pelna sekwencje zdarzen wskaznika.
 */
function otworzPozostale(): void {
  fireEvent.mouseDown(screen.getByText(/pages\.otherPages/));
}

/** Przelacznik ustawien po stalym identyfikatorze - etykieta niesie caly akapit. */
function przelacznik(id: string): HTMLInputElement {
  const node = document.getElementById(id);
  if (!(node instanceof HTMLInputElement)) throw new Error(`brak przelacznika „${id}”`);
  return node;
}

/**
 * Widoczna kolejnosc wierszy otwartej zakladki - po tytulach.
 *
 * Czytamy ja Z EKRANU, a nie z odpowiedzi bazy: to ekran jest tym, co redaktor
 * bierze za skutek swojego klikniecia, i to on musi sie zgadzac z tym, co widzi
 * uczestnik na stronie publicznej.
 */
function kolejnoscNaEkranie(): string[] {
  return screen.getAllByRole("listitem").map((li) => {
    const tytul = li.querySelector("button span");
    if (tytul === null) throw new Error("wiersz listy bez tytulu");
    return tytul.textContent ?? "";
  });
}

/** Ostatni szkic wpisany do podgladu na zywo. */
function ostatniPodglad(): Record<string, unknown> {
  const last = h.podglady.at(-1);
  if (last === undefined) throw new Error("podglad nie dostal ani jednego szkicu");
  return last;
}

beforeEach(() => {
  klient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  h.rows = [];
  h.dokumentWisi = false;
  h.dokumentOdmawia = false;
  h.uwolnijDokument = null;
  h.podglady = [];
  h.nawigacje = [];
  h.toastSuccess.mockClear();
  h.toastError.mockClear();

  h.rpc = supabaseRpcStub();
  h.rpc.setResponse(LISTA, () => ok(h.rows));
  h.rpc.setData(GRUPY, []);
  h.rpc.setData(ZAPIS_POZYCJI, "entry-zapisany");
  h.rpc.setData(ODPIECIE, true);
  h.rpc.setData(KOLEJNOSC, 2);
  h.rpc.setData(UTWORZENIE, "entry-prasa");
  h.rpc.setData(ZAPIS_USTAWIEN, STUDIO_EVENT_ID);

  h.from = supabaseFromStub();
  h.from.setResponse("pages", (chain) => {
    const kolumny = String(chain.argsOf("select")?.[0] ?? "");
    // Dwa rozne odczyty tej samej tabeli: korzen wydarzenia (dla slugu
    // „Dostosuj w builderze") i dokument strony podgladanej.
    if (!kolumny.includes("builder_data")) {
      return ok({
        id: "root",
        slug: "kongres-energetyczny",
        title_pl: "Kongres Energetyczny",
        title_en: "Energy Congress",
        status: "published",
      });
    }
    if (h.dokumentOdmawia) return fail("permission denied for table pages", "42501");
    if (h.dokumentWisi) {
      return new Promise((resolve) => {
        h.uwolnijDokument = () => resolve(ok({ builder_data: null }));
      });
    }
    return ok({ builder_data: null });
  });
});

afterEach(cleanup);

describe("uklad strony glownej i tryb prezentacji - jeden pasek zapisu", () => {
  // PASEK POJAWIA SIE DOPIERO PRZY ZMIANIE. Pasek stojacy zawsze uczy, zeby go
  // nie zauwazac - a wtedy nie zauwaza sie go takze wtedy, gdy cos naprawde
  // czeka na zapis.
  it("bez zmiany nie ma czego zapisywac, wiec paska nie ma", async () => {
    h.rows = [strona({ page_slug: "prasa" })];
    await panel();

    expect(screen.queryByText("adminEvents.studio.actions.save")).toBeNull();
    expect(przelacznik("event-home-standard").checked).toBe(true);
    expect(przelacznik("event-display-list").checked).toBe(true);
  });

  // OBIE WARTOSCI JADA W JEDNYM LADUNKU, RAZEM Z `id`. Ladunek bez
  // identyfikatora nie ma czego zaktualizowac, a ladunek z jedna kolumna
  // zostawia druga w stanie sprzed zmiany - a redaktor widzi „zapisano".
  it("zapis wysyla OBIE wybrane wartosci razem z identyfikatorem wydarzenia", async () => {
    h.rows = [strona({ page_slug: "prasa" })];
    await panel();

    fireEvent.click(przelacznik("event-home-advanced"));
    fireEvent.click(przelacznik("event-display-grid"));
    fireEvent.click(screen.getByText("adminEvents.studio.actions.save"));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    const ladunek = h.rpc?.lastCall(ZAPIS_USTAWIEN)?.arg("p_payload");
    expect(ladunek).toEqual({
      id: STUDIO_EVENT_ID,
      home_design: "advanced",
      pages_display_mode: "grid",
    });
    expect(h.toastSuccess).toHaveBeenCalledWith("adminEvents.studio.toasts.pagesSaved");
  });

  // ODRZUCENIE MA WROCIC DO STANU Z BAZY, a nie tylko schowac pasek. Pasek
  // schowany nad zmienionym szkicem znaczy „nie ma nic do zapisania" nad
  // ekranem, ktory pokazuje co innego niz wydarzenie.
  it("odrzucenie wraca do zapisanego wyboru i nic nie idzie do bazy", async () => {
    h.rows = [strona({ page_slug: "prasa" })];
    await panel();

    fireEvent.click(przelacznik("event-display-grid"));
    expect(przelacznik("event-display-grid").checked).toBe(true);

    fireEvent.click(screen.getByText("adminEvents.studio.actions.discard"));

    expect(przelacznik("event-display-list").checked).toBe(true);
    expect(screen.queryByText("adminEvents.studio.actions.save")).toBeNull();
    expect(h.rpc?.callsFor(ZAPIS_USTAWIEN)).toHaveLength(0);
  });

  // POWROT DO STANU WYJSCIOWEGO GASI PASEK. Pasek swiecacy nad wyborem
  // identycznym z zapisanym zaprasza do zapisu, ktory nic nie zmienia - a zapis
  // bez zmiany i tak dotyka wiersza wydarzenia i uniewaznia jego zapytania.
  it("klik z powrotem na pierwotny wybor gasi pasek zapisu", async () => {
    h.rows = [strona({ page_slug: "prasa" })];
    await panel();

    fireEvent.click(przelacznik("event-home-advanced"));
    fireEvent.click(przelacznik("event-display-grid"));
    expect(screen.getByText("adminEvents.studio.actions.save")).toBeTruthy();

    fireEvent.click(przelacznik("event-home-standard"));
    fireEvent.click(przelacznik("event-display-list"));

    expect(screen.queryByText("adminEvents.studio.actions.save")).toBeNull();
    expect(h.rpc?.callsFor(ZAPIS_USTAWIEN)).toHaveLength(0);
  });

  // ODMOWA NIE JEST ZAPISEM. Toast sukcesu obok odmowy znaczylby dla redaktora,
  // ze uklad strony glownej jest juz zmieniony - a on zostal, jaki byl.
  it("odmowa zapisu mowi o odmowie i NIE mowi jednoczesnie, ze zapisano", async () => {
    h.rows = [strona({ page_slug: "prasa" })];
    h.rpc?.setError(ZAPIS_USTAWIEN, "permission denied for function admin_event_general_save");
    await panel();

    fireEvent.click(przelacznik("event-home-advanced"));
    fireEvent.click(screen.getByText("adminEvents.studio.actions.save"));

    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(h.toastError.mock.calls[0][0]).toContain("odmowa:");
    expect(h.toastSuccess).not.toHaveBeenCalled();
    // Szkic ZOSTAJE - inaczej redaktor traci wybor przy kazdej awarii sieci.
    expect(przelacznik("event-home-advanced").checked).toBe(true);
  });

  // WIERSZ Z BAZY WYGRYWA Z NIEZAPISANYM SZKICEM. Wydarzenie zmienione w innej
  // karcie przychodzi tu nowym wierszem; ekran, ktory zostalby przy swoim
  // szkicu, pokazywalby uklad, ktorego juz nie ma.
  it("nowy wiersz wydarzenia nadpisuje szkic przelacznikow", async () => {
    h.rows = [strona({ page_slug: "prasa" })];
    const { rerender } = await panel();

    fireEvent.click(przelacznik("event-display-grid"));
    expect(przelacznik("event-display-grid").checked).toBe(true);

    rerender(
      <Otoczka>
        <EventPagesMenuPanel
          row={adminEventDetailRow({ home_design: "advanced", pages_display_mode: "grid" })}
        />
      </Otoczka>,
    );

    expect(przelacznik("event-home-advanced").checked).toBe(true);
    expect(przelacznik("event-display-grid").checked).toBe(true);
    // Szkic zgadza sie ze stanem zapisanym, wiec pasek nie ma czego oferowac.
    expect(screen.queryByText("adminEvents.studio.actions.save")).toBeNull();
  });

  // ODSYLACZ DO BUILDERA WYMAGA SLUGU KORZENIA. Wydarzenie bez strony glownej
  // dostalo by odsylacz do `/admin/pages/undefined` - czyli przycisk, ktory
  // prowadzi donikad. Zamiast niego ma stac zdanie o braku strony glownej.
  it("wydarzenie bez strony glownej nie dostaje odsylacza do buildera", async () => {
    h.rows = [strona({ page_slug: "prasa" })];
    await panel(adminEventDetailRow({ root_page_id: "" }));

    expect(screen.getByText("adminEvents.studio.pages.noRootPage")).toBeTruthy();
    expect(screen.queryByText("adminEvents.studio.pages.customize")).toBeNull();
  });

  it("wydarzenie ze strona glowna prowadzi do NIEJ, a nie do listy stron", async () => {
    h.rows = [strona({ page_slug: "prasa" })];
    await panel();

    const odsylacz = await screen.findByText("adminEvents.studio.pages.customize");
    expect(odsylacz.closest("a")?.getAttribute("href")).toBe("/admin/pages/kongres-energetyczny");
  });
});

describe("kolejnosc pozycji menu", () => {
  // KAZDE NACISNIECIE ZAPISUJE CALA KOLEJNOSC. Seria osobnych zapisow po jednym
  // `sort_order` zostawia menu w stanie posrednim, gdy ktorys z nich padnie -
  // a menu w stanie posrednim widza uczestnicy na stronie publicznej.
  it("strzalka w dol wysyla CALA liste identyfikatorow w nowej kolejnosci", async () => {
    h.rows = [
      strona({ page_slug: "agenda", sort_order: 10 }),
      strona({ page_slug: "prasa", sort_order: 20 }),
      strona({ page_slug: "partnerzy", sort_order: 30 }),
    ];
    await panel();

    fireEvent.click(within(wiersz("agenda")).getByLabelText(/rowActions\.moveDown/));

    await waitFor(() => expect(h.rpc?.callsFor(KOLEJNOSC)).toHaveLength(1));
    const wolanie = h.rpc?.lastCall(KOLEJNOSC);
    expect(wolanie?.arg("p_event_id")).toBe(STUDIO_EVENT_ID);
    expect(wolanie?.arg("p_ids")).toEqual(["entry-prasa", "entry-agenda", "entry-partnerzy"]);
    expect(h.toastSuccess).toHaveBeenCalledWith("adminEvents.studio.toasts.pageOrderSaved");
  });

  // KRANCE LISTY NIE MAJA DOKAD ISC. Przycisk czynny na krancu wyslalby do bazy
  // kolejnosc identyczna z obecna - czyli zapis bez skutku, ktory redaktor
  // czyta jako „przestawilem", choc nic sie nie ruszylo.
  it("pierwsza pozycja nie idzie w gore, ostatnia nie idzie w dol", async () => {
    h.rows = [
      strona({ page_slug: "agenda", sort_order: 10 }),
      strona({ page_slug: "prasa", sort_order: 20 }),
    ];
    await panel();

    const pierwsza = within(wiersz("agenda")).getByLabelText(/rowActions\.moveUp/);
    const ostatnia = within(wiersz("prasa")).getByLabelText(/rowActions\.moveDown/);
    expect(pierwsza).toBeDisabled();
    expect(ostatnia).toBeDisabled();

    fireEvent.click(pierwsza);
    fireEvent.click(ostatnia);
    expect(h.rpc?.callsFor(KOLEJNOSC)).toHaveLength(0);
  });

  // ODPIECIE Z ZAKLADKI „W MENU" ZDEJMUJE MAPOWANIE, a nie tresc: wiersz
  // `pages` z historia i SEO zostaje w `/admin/pages`, bo pomylkowe odpiecie
  // kosztuje jedno klikniecie, a pomylkowe usuniecie strony kosztuje tresc.
  it("odpiecie pozycji menu adresuje MAPOWANIE, nie strone", async () => {
    h.rows = [strona({ page_slug: "prasa" })];
    await panel();

    fireEvent.click(within(wiersz("prasa")).getByLabelText(/rowActions\.detach/));

    await waitFor(() => expect(h.rpc?.callsFor(ODPIECIE)).toHaveLength(1));
    expect(h.rpc?.lastCall(ODPIECIE)?.arg("p_id")).toBe("entry-prasa");
    expect(h.rpc?.lastCall(ODPIECIE)?.has("p_page_id")).toBe(false);
  });

  // ODMOWA KOLEJNOSCI MA DOJECHAC DO REDAKTORA. Lista czyta stan z bazy, wiec
  // po cichej odmowie wiersze wracaja na stare miejsca bez slowa wyjasnienia.
  it("odmowa przestawienia nazywa PRZYCZYNE i zostawia kolejnosc nietknieta", async () => {
    h.rows = [
      strona({ page_slug: "agenda", sort_order: 10 }),
      strona({ page_slug: "prasa", sort_order: 20 }),
    ];
    h.rpc?.setError(KOLEJNOSC, "permission denied for function admin_event_pages_reorder");
    await panel();

    fireEvent.click(within(wiersz("agenda")).getByLabelText(/rowActions\.moveDown/));

    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    // SAMO „nie udalo sie" NIE WYSTARCZY. Odmowa uprawnien i zerwana siec
    // prowadza do dwoch roznych ruchow redaktora - pierwsza do administratora,
    // druga do powtorzenia klikniecia. Komunikat bez przyczyny kaze zgadywac.
    expect(h.toastError.mock.calls[0][0]).toBe(
      "odmowa:permission denied for function admin_event_pages_reorder",
    );
    expect(h.toastSuccess).not.toHaveBeenCalled();
    // WIERSZE ZOSTAJA TAM, GDZIE BYLY. Kolejnosc przestawiona na ekranie mimo
    // odmowy bazy to menu, ktore redaktor uwaza za zapisane, a uczestnik widzi
    // w starym ukladzie - rozjazd wychodzi dopiero przy nastepnym wejsciu.
    expect(kolejnoscNaEkranie()).toEqual(["agenda", "prasa"]);
  });
});

describe("strona NIEPRZYPIETA - dwa wejscia, dwa rozne ladunki", () => {
  // NOWA POZYCJA LADUJE NA KONCU MENU. Kolejnosc licza `sort_order`, wiec
  // pozycja przypieta z zerem wskoczylaby PRZED wszystkie istniejace - czyli
  // dopisanie strony przestawialoby menu, ktorego nikt nie prosil o zmiane.
  it("„Dodaj do menu” przypina z kolejnoscia ZA ostatnia pozycja menu", async () => {
    h.rows = [
      strona({ page_slug: "agenda", sort_order: 10 }),
      strona({ page_slug: "partnerzy", sort_order: 40 }),
      stronaNieprzypieta("prasa"),
    ];
    await panel();
    otworzPozostale();

    fireEvent.click(
      within(wiersz("prasa")).getByText("adminEvents.studio.pages.rowActions.addToMenu"),
    );

    await waitFor(() => expect(h.rpc?.callsFor(ZAPIS_POZYCJI)).toHaveLength(1));
    const wolanie = h.rpc?.lastCall(ZAPIS_POZYCJI);
    expect(wolanie?.arg("p_payload")).toEqual({
      event_id: STUDIO_EVENT_ID,
      page_id: "page-prasa",
      in_menu: true,
      sort_order: 50,
      visible_to_groups: [],
    });
    // Mapowania jeszcze nie ma, wiec `id` nie ma prawa pojechac: RPC z `id`
    // szukalby wiersza, ktorego nie ma, zamiast go zalozyc.
    expect(Object.keys(wolanie?.arg("p_payload") as Record<string, unknown>)).not.toContain("id");
    expect(h.toastSuccess).toHaveBeenCalledWith("adminEvents.studio.toasts.pageEntrySaved");
  });

  // „SWIADOMIE POZA MENU" TO TEZ PRZYPIECIE, tyle ze bez pozycji w pasku.
  // Strona przypieta poza menu ma juz ikone, kolor i widocznosc - i dopiero
  // wtedy da sie ja edytowac; bez tego wejscia jedyna droga do edycji pozycji
  // wiodlaby przez wstawienie jej najpierw do menu uczestnika.
  it("„Zostaw poza menu” przypina z `in_menu = false` i zerowa kolejnoscia", async () => {
    h.rows = [strona({ page_slug: "agenda", sort_order: 10 }), stronaNieprzypieta("prasa")];
    await panel();
    otworzPozostale();

    fireEvent.click(
      within(wiersz("prasa")).getByText("adminEvents.studio.pages.rowActions.keepOutOfMenu"),
    );

    await waitFor(() => expect(h.rpc?.callsFor(ZAPIS_POZYCJI)).toHaveLength(1));
    expect(h.rpc?.lastCall(ZAPIS_POZYCJI)?.arg("p_payload")).toEqual({
      event_id: STUDIO_EVENT_ID,
      page_id: "page-prasa",
      in_menu: false,
      sort_order: 0,
      visible_to_groups: [],
    });
  });

  // STRONA BEZ MAPOWANIA NIE MA CZEGO EDYTOWAC ANI ODPINAC. Olowek nad wierszem
  // bez `event_pages.id` otwieralby szuflade nad pozycja, ktorej nie ma jak
  // zapisac (`admin_event_page_upsert` adresuje pozycje przez `id`).
  it("strona nieprzypieta nie ma ani edycji pozycji, ani odpiecia", async () => {
    h.rows = [stronaNieprzypieta("prasa")];
    await panel();
    otworzPozostale();

    const li = wiersz("prasa");
    expect(within(li).queryByLabelText(/rowActions\.edit\(/)).toBeNull();
    expect(within(li).queryByLabelText(/rowActions\.detach/)).toBeNull();
    expect(within(li).getByText("adminEvents.studio.pages.states.unattached")).toBeTruthy();
  });

  // POZYCJA PRZYPIETA POZA MENU MA OBA PRZYCISKI - i to jest kontrapunkt dla
  // asercji wyzej: gdyby zniknely wszystkim, tamta przechodzilaby na regresji,
  // ktora odbiera redakcji dzialajace akcje.
  it("pozycja przypieta poza menu odpina sie stad, bez wracania do menu", async () => {
    h.rows = [strona({ page_slug: "prasa", in_menu: false })];
    await panel();
    otworzPozostale();

    fireEvent.click(within(wiersz("prasa")).getByLabelText(/rowActions\.detach/));

    await waitFor(() => expect(h.rpc?.callsFor(ODPIECIE)).toHaveLength(1));
    expect(h.rpc?.lastCall(ODPIECIE)?.arg("p_id")).toBe("entry-prasa");
    expect(h.toastSuccess).toHaveBeenCalledWith("adminEvents.studio.toasts.pageDetached");
  });
});

describe("utworzenie podstrony prowadzi DO TRESCI", () => {
  // STRONA POWSTAJE JAKO SZKIC BEZ ANI JEDNEGO BLOKU, wiec sama pozycja w menu
  // nie jest jeszcze niczym, co uczestnik moze otworzyc. Toast bez drogi do
  // edytora konczy sie pozycja w menu, ktora pokazuje pusta strone.
  it("po utworzeniu toast niesie akcje prowadzaca do edytora TEJ strony", async () => {
    h.rows = [strona({ page_slug: "agenda" })];
    await panel();

    fireEvent.click(screen.getByRole("button", { name: /pages\.createPage/ }));
    // Odswiezona lista zna juz nowa pozycje - stad bierze sie slug do edytora.
    h.rows = [strona({ page_slug: "agenda" }), strona({ page_slug: "prasa" })];
    fireEvent.click(screen.getByText("utworz-strone"));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    const [komunikat, opcje] = h.toastSuccess.mock.calls[0] as [string, AkcjaToastu];
    expect(komunikat).toBe("adminEvents.studio.toasts.pageCreated");
    expect(opcje.action?.label).toBe("adminEvents.studio.pages.rowActions.editContent");

    opcje.action?.onClick();
    expect(h.nawigacje).toEqual([{ to: "/admin/pages/$slug", params: { slug: "prasa" } }]);
  });

  it("ladunek utworzenia niesie tytuly w obu jezykach i wydarzenie", async () => {
    h.rows = [strona({ page_slug: "agenda" })];
    await panel();

    fireEvent.click(screen.getByRole("button", { name: /pages\.createPage/ }));
    h.rows = [strona({ page_slug: "agenda" }), strona({ page_slug: "prasa" })];
    fireEvent.click(screen.getByText("utworz-strone"));

    await waitFor(() => expect(h.rpc?.callsFor(UTWORZENIE)).toHaveLength(1));
    expect(h.rpc?.lastCall(UTWORZENIE)?.arg("p_payload")).toEqual({
      event_id: STUDIO_EVENT_ID,
      title_pl: "Dla prasy",
      title_en: "Press room",
      icon: "newspaper",
      in_menu: true,
    });
  });

  // LISTA CZYTA SIE PONOWNIE, BO RPC ODDAJE IDENTYFIKATOR POZYCJI, A EDYTOR
  // STRON ADRESUJE SLUGIEM. Bez drugiego odczytu slug bylby zgadywany z tytulu.
  it("dialog zamyka sie, a lista jest odczytana DRUGI raz", async () => {
    h.rows = [strona({ page_slug: "agenda" })];
    await panel();
    const odczytowNaStarcie = h.rpc?.callsFor(LISTA).length ?? 0;

    fireEvent.click(screen.getByRole("button", { name: /pages\.createPage/ }));
    h.rows = [strona({ page_slug: "agenda" }), strona({ page_slug: "prasa" })];
    fireEvent.click(screen.getByText("utworz-strone"));

    await waitFor(() => expect(screen.queryByTestId("dialog-tworzenia")).toBeNull());
    await waitFor(() =>
      expect(h.rpc?.callsFor(LISTA).length ?? 0).toBeGreaterThan(odczytowNaStarcie),
    );
    expect(wiersz("prasa")).toBeTruthy();
  });

  // ODSYLACZ DO NIEZNANEGO SLUGU PROWADZI DONIKAD. Gdy odswiezona lista nie zna
  // jeszcze nowej pozycji, toast ma zostac SAM - przycisk „edytuj tresc",
  // ktory otwiera pusta trase, jest gorszy od braku przycisku.
  it("gdy odswiezona lista nie zna nowej pozycji, toast jest BEZ akcji", async () => {
    h.rows = [strona({ page_slug: "agenda" })];
    await panel();

    fireEvent.click(screen.getByRole("button", { name: /pages\.createPage/ }));
    fireEvent.click(screen.getByText("utworz-strone"));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    expect(h.toastSuccess.mock.calls[0][1]).toBeUndefined();
    expect(h.nawigacje).toEqual([]);
  });

  // ODMOWA ZOSTAWIA DIALOG OTWARTY z wpisana trescia: zamkniety kazalby
  // redaktorowi wpisac wszystko od nowa, zeby zobaczyc ten sam blad.
  it("odmowa utworzenia zostawia dialog otwarty i nie mowi o sukcesie", async () => {
    h.rows = [strona({ page_slug: "agenda" })];
    h.rpc?.setError(UTWORZENIE, 'duplicate key value violates unique constraint "pages_slug_key"');
    await panel();

    fireEvent.click(screen.getByRole("button", { name: /pages\.createPage/ }));
    fireEvent.click(screen.getByText("utworz-strone"));

    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    // ZAJETY ADRES TO INNA ROBOTA NIZ BRAK UPRAWNIEN: pierwszy kaze zmienic
    // tytul, drugi - poprosic o dostep. Komunikat bez przyczyny zrownuje oba.
    expect(h.toastError.mock.calls[0][0]).toBe(
      'odmowa:duplicate key value violates unique constraint "pages_slug_key"',
    );
    expect(screen.getByTestId("dialog-tworzenia")).toBeTruthy();
    // DIALOG WRACA DO STANU CZYNNEGO. Zablokowany na „zapisuje" po odmowie
    // zostawia redaktora z formularzem, ktorego nie da sie wyslac drugi raz -
    // czyli z trescia do przepisania od zera po przeladowaniu ekranu.
    expect(screen.getByTestId("dialog-tworzenia-zapisuje").textContent).toBe("nie");
    expect(h.toastSuccess).not.toHaveBeenCalled();
    // Nieudane utworzenie nie prowadzi do edytora strony, ktorej nie ma.
    expect(h.nawigacje).toEqual([]);
  });
});

describe("podglad na zywo", () => {
  // KLIK W NAZWE JEST JEDYNYM GESTEM, KTOREGO NIE TRZEBA TLUMACZYC - i musi
  // przelaczyc kanwe na TE strone. Kanwa dostaje `key` z przestrzeni
  // identyfikatorow pozycji menu, zeby porownywala identyfikatory, a nie napisy.
  it("klik w nazwe pozycji przelacza kanwe na te strone", async () => {
    h.rows = [strona({ page_slug: "agenda" }), strona({ page_slug: "prasa", sort_order: 20 })];
    await panel();

    fireEvent.click(within(wiersz("prasa")).getByText("prasa"));

    await waitFor(() => expect(ostatniPodglad().selectedPage).not.toBeNull());
    expect(ostatniPodglad().selectedPage).toEqual({
      key: "entry-prasa",
      label: "prasa",
      path: "kongres/prasa",
      module: null,
      document: null,
    });
  });

  it("drugi klik w te sama nazwe wraca na strone glowna wydarzenia", async () => {
    h.rows = [strona({ page_slug: "prasa" })];
    await panel();

    fireEvent.click(within(wiersz("prasa")).getByText("prasa"));
    await waitFor(() => expect(ostatniPodglad().selectedPage).not.toBeNull());

    fireEvent.click(within(wiersz("prasa")).getByText("prasa"));
    await waitFor(() => expect(ostatniPodglad().selectedPage).toBeNull());
  });

  // DOPOKI TRESC SIE WCZYTUJE, KANWA ZOSTAJE NA STRONIE GLOWNEJ. Kanwa
  // przelaczona na strone bez dokumentu klamalaby, ze strona jest pusta -
  // a redaktor odpowiada na to, dopisujac tresc, ktora juz tam jest.
  it("w trakcie wczytywania tresci kanwa NIE pokazuje jeszcze tej strony", async () => {
    h.rows = [strona({ page_slug: "prasa" })];
    h.dokumentWisi = true;
    await panel();

    fireEvent.click(within(wiersz("prasa")).getByText("prasa"));

    await waitFor(() => expect(h.uwolnijDokument).not.toBeNull());
    expect(ostatniPodglad().selectedPage).toBeNull();

    h.uwolnijDokument?.();
    await waitFor(() => expect(ostatniPodglad().selectedPage).not.toBeNull());
  });

  // TRYB PREZENTACJI JEST SZKICEM, ktory kanwa pokazuje PRZED zapisem - to jest
  // caly sens tego przelacznika: redaktor ma zobaczyc kafle, zanim zdecyduje.
  it("przelacznik trybu zmienia podglad bez zapisu", async () => {
    h.rows = [strona({ page_slug: "prasa" })];
    await panel();

    expect(ostatniPodglad().pagesDisplayMode).toBe("list");
    fireEvent.click(przelacznik("event-display-grid"));
    expect(ostatniPodglad().pagesDisplayMode).toBe("grid");
    expect(h.rpc?.callsFor(ZAPIS_USTAWIEN)).toHaveLength(0);
  });

  // MENU PODGLADU NIE JEST DRUGA LISTA. Gdyby ekran liczyl pozycje po swojemu,
  // wejscie na „Strony i menu" zmienialoby wyglad menu w kanwie bez zadnej
  // zmiany danych - a to jest dokladnie ten rozjazd, ktory kanwa ma wykluczyc.
  it("menu kanwy niesie WYLACZNIE pozycje w menu, w kolejnosci z bazy", async () => {
    h.rows = [
      strona({ page_slug: "agenda", sort_order: 10 }),
      strona({ page_slug: "prasa", sort_order: 20 }),
      strona({ page_slug: "archiwum", in_menu: false, sort_order: 30 }),
    ];
    await panel();

    const menu = ostatniPodglad().menu as { key: string; label: string }[];
    expect(menu.map((pozycja) => pozycja.label)).toEqual(["agenda", "prasa"]);
    expect(menu.map((pozycja) => pozycja.key)).toEqual(["entry-agenda", "entry-prasa"]);
  });
});

describe("szuflada edycji pozycji", () => {
  // SZUFLADA TRZYMA IDENTYFIKATOR, NIE WIERSZ. Otwarta nad starym obiektem
  // pokazywalaby wartosci sprzed ostatniego zapisu.
  it("olowek otwiera szuflade nad TA pozycja i podaje jej grupy widocznosci", async () => {
    h.rows = [strona({ page_slug: "agenda" }), strona({ page_slug: "prasa", sort_order: 20 })];
    h.rpc?.setData(GRUPY, [{ id: "grupa-1" }, { id: "grupa-2" }]);
    await panel();

    fireEvent.click(within(wiersz("prasa")).getByLabelText(/rowActions\.edit\(/));

    expect(screen.getByTestId("szuflada-pozycja-id").textContent).toBe("entry-prasa");
    await waitFor(() => expect(screen.getByTestId("szuflada-liczba-grup").textContent).toBe("2"));
  });

  it("zapis z szuflady idzie do bazy i zamyka szuflade", async () => {
    h.rows = [strona({ page_slug: "prasa", icon: "newspaper", color: "#1D4ED8" })];
    await panel();

    fireEvent.click(within(wiersz("prasa")).getByLabelText(/rowActions\.edit\(/));
    fireEvent.click(screen.getByText("zapisz-pozycje"));

    await waitFor(() => expect(screen.queryByTestId("szuflada-pozycji")).toBeNull());
    expect(h.rpc?.lastCall(ZAPIS_POZYCJI)?.arg("p_payload")).toEqual({
      id: "entry-prasa",
      menu_label_pl: "Dla prasy",
      in_menu: true,
      sort_order: 10,
      icon: "newspaper",
      color: "#1D4ED8",
      visible_to_groups: [],
    });
    expect(h.toastSuccess).toHaveBeenCalledWith("adminEvents.studio.toasts.pageEntrySaved");
  });

  // ODMOWA ZOSTAWIA SZUFLADE OTWARTA - zamknieta kazalaby wpisac poprawki
  // drugi raz, zeby zobaczyc ten sam blad.
  it("odmowa zapisu pozycji zostawia szuflade otwarta", async () => {
    h.rows = [strona({ page_slug: "prasa" })];
    h.rpc?.setError(ZAPIS_POZYCJI, 'new row violates check constraint "event_pages_icon_check"');
    await panel();

    fireEvent.click(within(wiersz("prasa")).getByLabelText(/rowActions\.edit\(/));
    fireEvent.click(screen.getByText("zapisz-pozycje"));

    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    // ODMOWA CHECK-A NIE WSKAZUJE POLA, wiec jedyne, co redaktor ma, to tresc
    // komunikatu - bez niej ma martwa szuflade i osiemnascie pol do sprawdzenia.
    expect(h.toastError.mock.calls[0][0]).toBe(
      'odmowa:new row violates check constraint "event_pages_icon_check"',
    );
    expect(h.toastSuccess).not.toHaveBeenCalled();
    // SZUFLADA ZOSTAJE NAD TA SAMA POZYCJA. Przesunieta na inny wiersz
    // zapisalaby poprawki redaktora do cudzej pozycji menu.
    expect(screen.getByTestId("szuflada-pozycja-id").textContent).toBe("entry-prasa");
  });

  it("zamkniecie szuflady bez zapisu nie wysyla niczego", async () => {
    h.rows = [strona({ page_slug: "prasa" })];
    await panel();

    fireEvent.click(within(wiersz("prasa")).getByLabelText(/rowActions\.edit\(/));
    fireEvent.click(screen.getByText("zamknij-szuflade"));

    expect(screen.queryByTestId("szuflada-pozycji")).toBeNull();
    expect(h.rpc?.callsFor(ZAPIS_POZYCJI)).toHaveLength(0);
  });

  // POZYCJA POZA MENU TEZ SIE EDYTUJE. Bez tego wejscia jedyna droga do zmiany
  // ikony strony ukrytej wiodlaby przez wstawienie jej najpierw do menu
  // uczestnika - czyli przez pokazanie mu strony, ktorej nie mial zobaczyc.
  it("pozycja spoza menu otwiera te sama szuflade", async () => {
    h.rows = [strona({ page_slug: "prasa", in_menu: false })];
    await panel();
    otworzPozostale();

    fireEvent.click(within(wiersz("prasa")).getByLabelText(/rowActions\.edit\(/));

    expect(screen.getByTestId("szuflada-pozycja-id").textContent).toBe("entry-prasa");
  });
});

describe("puste zakladki mowia, ktora polowa jest pusta", () => {
  // „NIE MA STRON" I „NIE MA ICH W MENU" TO DWIE ROZNE INFORMACJE. Pierwsza
  // kaze zalozyc strone, druga - przypiac istniejaca. Jeden napis na oba stany
  // kaze redaktorowi zgadywac, ktora z dwoch rzeczy sie stala.
  it("wszystkie strony poza menu - pusta jest PIERWSZA zakladka", async () => {
    h.rows = [strona({ page_slug: "prasa", in_menu: false }), stronaNieprzypieta("archiwum")];
    await panel();

    expect(screen.getByText(/pages\.menuPages \(0\)/)).toBeTruthy();
    expect(screen.getByText("adminEvents.studio.pages.menuEmpty")).toBeTruthy();
    expect(screen.queryByText("adminEvents.studio.pages.noPagesYet")).toBeNull();
  });

  it("wszystkie strony w menu - pusta jest DRUGA zakladka", async () => {
    h.rows = [strona({ page_slug: "prasa" })];
    await panel();
    otworzPozostale();

    expect(screen.getByText(/pages\.otherPages \(0\)/)).toBeTruthy();
    expect(screen.getByText("adminEvents.studio.pages.otherEmpty")).toBeTruthy();
  });
});

describe("defekty zarejestrowane", () => {
  // DEFEKT: ODMOWA ODCZYTU TRESCI JEST POKAZYWANA JAKO PUSTA STRONA.
  //
  // Warunek `documentQ.isPending` chroni WYLACZNIE stan „jeszcze nie wiem".
  // Zapytanie zakonczone BLEDEM (RLS na `pages`, zerwana siec, strona skasowana
  // w innej karcie) nie jest juz `pending`, wiec kanwa przelacza sie na ta
  // strone z `document: null` - czyli mowi „ta strona nie ma jeszcze tresci".
  // To jest dokladnie to klamstwo, ktoremu komentarz nad `useSyncEventPreview`
  // obiecuje zapobiegac, i konczy sie tak samo jak brak tego warunku w ogole:
  // redaktor dopisuje tresc do strony, ktora tresc juz ma.
  //
  // NAPRAWA (nie robimy jej tutaj): warunek ma brzmiec
  // `documentQ.isPending || documentQ.isError`, a przy bledzie kanwa powinna
  // dostac osobny stan „nie udalo sie wczytac tresci" - inaczej trzeci raz
  // powtarza sie ta sama pomylka co przy pustej liscie podstron.
  it.fails(
    "defekt: odmowa odczytu tresci pokazuje strone jako PUSTA, zamiast zostawic kanwe na stronie glownej",
    async () => {
      h.rows = [strona({ page_slug: "prasa" })];
      h.dokumentOdmawia = true;
      await panel();

      fireEvent.click(within(wiersz("prasa")).getByText("prasa"));

      // Czekamy na ZAKONCZENIE odczytu, a nie na skutek defektu: dopoki odczyt
      // trwa, kanwa i tak stoi na stronie glownej i asercja nizej przechodzila
      // by z zupelnie innego powodu.
      await waitFor(() =>
        expect(klient?.getQueryState(eventPagesKeys.document("page-prasa"))?.status).toBe("error"),
      );
      // Kanwa ma zostac na stronie glownej: „nie udalo sie wczytac" nie jest
      // tym samym, co „ta strona jest pusta".
      expect(ostatniPodglad().selectedPage).toBeNull();
    },
  );
});
