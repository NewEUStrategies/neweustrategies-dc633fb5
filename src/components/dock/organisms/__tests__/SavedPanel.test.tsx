// PANEL ZAPISANYCH ELEMENTÓW DOKU - do tego przebiegu pokryty w ~5 %, choć to
// jedyne miejsce w repozytorium, które SCALA dwa niezależne źródła (zakładki
// wpisów, stron i wydarzeń plus kolejkę „do przeczytania") w jedną listę.
// Warstwa danych ma własne dowody w `src/lib/dock/__tests__/dockData.test.tsx`;
// tutaj liczy się wyłącznie to, co z nich robi panel i co widzi użytkownik.
//
//   1. KOLEJNOŚĆ GAŁĘZI: błąd -> oczekiwanie -> puste -> lista, przy czym
//      `isPending` i `isError` to ALTERNATYWY dwóch zapytań (SavedPanel.tsx:82-83).
//      Domknięte jedno źródło nie wystarcza: panel, który by o tym zapomniał,
//      pisałby „Nic jeszcze nie zapisałeś" nad danymi będącymi w drodze -
//      czyli podawałby nieprawdę zamiast przyznać, że jeszcze nie wie.
//      Dowodzimy więc osobno przypadku, w którym JEDNO z dwóch zapytań wciąż
//      biegnie, i osobno błędu z KAŻDEGO ze źródeł.
//   2. SCALENIE JEST POSORTOWANE PO DACIE ZAPISU W DÓŁ, ponad granicą źródła,
//      a adres wiersza zależy od rodzaju (`/slug`, `/events/slug`, adres
//      z kolejki albo BRAK adresu - wtedy wiersz nie jest linkiem).
//   3. FILTR RODZAJU I WYSZUKIWARKA. Fraza idzie przez `useDeferredValue`,
//      więc lista przerysowuje się w niskim priorytecie - stąd `waitFor`
//      przy każdej asercji po wpisaniu tekstu.
//   4. AKCJE KOLEJKI CZYTANIA tylko przy wierszach kolejki, z ładunkiem,
//      który naprawdę idzie do bazy, i z odświeżeniem, które ODWRACA etykietę
//      przycisku. Atrapa Supabase odgrywa tu pełną rundę (zapis -> unieważnienie
//      -> ponowny odczyt), więc test mierzy skutek, a nie samo wywołanie.
//   5. `lang` JEST WŁASNOŚCIĄ TREŚCI, NIE CHROMU. Przełącza tytuł materiału
//      i NIC poza nim: napisy panelu zostają polskie (język interfejsu bierze
//      się z i18n, nie z tej właściwości), a zapytanie NIE leci drugi raz,
//      bo klucz zapisanych jest językowo neutralny (useSaved.ts:6-14).
//
// Napisy czytamy ze słownika (`dockPl`/`dockEn`), nigdy z literału - inaczej
// asercja mierzy to, co ktoś wpisał w komponencie, a nie to, co jest
// w tłumaczeniach. Treść wierszy jest zmyślona.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/test/i18nReal";
import { dockEn, dockPl } from "@/lib/i18n-dock";
import { DZIEN, FIXED_NOW_ISO, freezeClock, relativeIso } from "@/test/time";
import { axeViolations, summarize } from "@/test/axe";
// Kanoniczny atom atrapy łańcucha (`src/test/supabase/chain.ts`), a nie starsza
// ścieżka zgodnościowa: tylko ten wariant pozwala ODDAĆ OBIETNICĘ z respondera,
// czyli przytrzymać jedno z dwóch zapytań otwarte i dowieść punktu 1.
import { fail, ok, supabaseFromStub, type RecordedChain } from "@/test/supabase/chain";
import type { SupabaseResult } from "@/test/supabase/chain";
import type { ReadLaterItem, ReadLaterState } from "@/lib/dock/types";

// Panel zegara nie czyta, ale `useSetReadLaterState` stempluje `read_at`
// przez `new Date().toISOString()` - zamrożenie pozwala asertować DOKŁADNĄ
// wartość zamiast „jakiegoś napisu", a daty wierszy liczyć względem „teraz".
freezeClock();

const auth = vi.hoisted(() => ({ user: { id: "member" } as { id: string } | null }));
const db = supabaseFromStub();

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => db.from(table) },
}));

import { SavedPanel } from "../SavedPanel";

// ── Wiersze bazy w kształcie, w jakim czyta je warstwa danych ───────────────
interface BookmarkRow {
  id: string;
  entity_type: string;
  entity_id: string;
  created_at: string;
}
interface EventBookmarkRow {
  id: string;
  event_id: string;
  created_at: string;
}
interface TitledRow {
  id: string;
  slug: string;
  title_pl: string | null;
  title_en: string | null;
}
interface SavedFixtures {
  bookmarks: BookmarkRow[];
  eventBookmarks: EventBookmarkRow[];
  posts: TitledRow[];
  pages: TitledRow[];
  events: TitledRow[];
  readLater: ReadLaterItem[];
}

const data: SavedFixtures = {
  bookmarks: [],
  eventBookmarks: [],
  posts: [],
  pages: [],
  events: [],
  readLater: [],
};

// Treść zmyślona; tytuły PL i EN są rozłączne, żeby asercja języka nie mogła
// przejść przypadkiem.
const RAPORT_PL = "Raport kwartalny o rozszerzeniu";
const RAPORT_EN = "Quarterly enlargement report";
const STRONA_PL = "Strona o zespole";
const STRONA_EN = "Our team page";
const WYDARZENIE_PL = "Śniadanie prasowe w Brukseli";
const WYDARZENIE_EN = "Press breakfast in Brussels";
const KOLEJKA = "Notatka z konsultacji publicznych";
const KOLEJKA_BEZ_ADRESU = "Stenogram posiedzenia komisji";

function readLaterItem(id: string, patch: Partial<ReadLaterItem> = {}): ReadLaterItem {
  return {
    id,
    entity_type: "post",
    entity_id: `entity-${id}`,
    title: KOLEJKA,
    url: "/analizy/konsultacje-publiczne",
    state: "unread",
    note: null,
    read_at: null,
    created_at: relativeIso(-DZIEN),
    ...patch,
  };
}

/** Domyślna zawartość: po jednym wierszu każdego rodzaju, różne daty zapisu. */
function seedAll(): void {
  data.bookmarks = [
    {
      id: "bm-post",
      entity_type: "post",
      entity_id: "post-1",
      created_at: relativeIso(-3 * DZIEN),
    },
    {
      id: "bm-page",
      entity_type: "page",
      entity_id: "page-1",
      created_at: relativeIso(-2 * DZIEN),
    },
  ];
  data.eventBookmarks = [
    { id: "bm-event", event_id: "event-1", created_at: relativeIso(-4 * DZIEN) },
  ];
  data.posts = [
    { id: "post-1", slug: "raport-kwartalny", title_pl: RAPORT_PL, title_en: RAPORT_EN },
  ];
  data.pages = [{ id: "page-1", slug: "zespol", title_pl: STRONA_PL, title_en: STRONA_EN }];
  data.events = [
    { id: "event-1", slug: "sniadanie-prasowe", title_pl: WYDARZENIE_PL, title_en: WYDARZENIE_EN },
  ];
  data.readLater = [readLaterItem("rl-1")];
}

function isStatePatch(value: unknown): value is { state: ReadLaterState; read_at: string | null } {
  return typeof value === "object" && value !== null && "state" in value;
}

/**
 * Kolejka czytania odgrywa PEŁNĄ rundę: zapis zmienia wiersz w atrapie, więc
 * unieważnienie klucza po mutacji przynosi dane PO zmianie. Bez tego test
 * dowodziłby tylko, że przycisk woła mutację, a nie że użytkownik widzi skutek.
 */
function readLaterResponder(chain: RecordedChain): SupabaseResult {
  const id = String(chain.argsOf("eq")?.[1] ?? "");
  if (chain.has("update")) {
    const patch = chain.argsOf("update")?.[0];
    const row = data.readLater.find((item) => item.id === id);
    if (row && isStatePatch(patch)) {
      row.state = patch.state;
      row.read_at = patch.read_at;
    }
    return ok(null);
  }
  if (chain.has("delete")) {
    data.readLater = data.readLater.filter((item) => item.id !== id);
    return ok(null);
  }
  return ok(data.readLater);
}

/**
 * Odpowiedź, którą test rozwiązuje RĘCZNIE - jedyny sposób na przytrzymanie
 * jednego z dwóch zapytań panelu otwartego dłużej niż mikrozadanie.
 */
function deferred(): {
  promise: Promise<SupabaseResult>;
  resolve: (value: SupabaseResult) => void;
} {
  let settle: (value: SupabaseResult) => void = () => {
    throw new Error("deferred: odpowiedź oddana przed powstaniem obietnicy");
  };
  const promise = new Promise<SupabaseResult>((resolveWith) => {
    settle = resolveWith;
  });
  return { promise, resolve: (value) => settle(value) };
}

let qc: QueryClient;

beforeEach(() => {
  auth.user = { id: "member" };
  db.reset();
  data.bookmarks = [];
  data.eventBookmarks = [];
  data.posts = [];
  data.pages = [];
  data.events = [];
  data.readLater = [];
  // KAŻDA tabela musi być zaplanowana - atrapa zwraca zaplanowany BŁĄD dla
  // tabeli, o której test zapomniał, więc cichy `[]` nie udaje odczytu.
  db.setResponse("user_bookmarks", () => ok(data.bookmarks));
  db.setResponse("event_bookmarks", () => ok(data.eventBookmarks));
  db.setResponse("posts", () => ok(data.posts));
  db.setResponse("pages", () => ok(data.pages));
  db.setResponse("events", () => ok(data.events));
  db.setResponse("user_read_later", readLaterResponder);
  qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
});

afterEach(() => {
  cleanup();
  qc.clear();
  vi.restoreAllMocks();
});

function renderPanel(lang: "pl" | "en" = "pl") {
  const onClose = vi.fn();
  const view = render(
    <QueryClientProvider client={qc}>
      <SavedPanel onClose={onClose} lang={lang} />
    </QueryClientProvider>,
  );
  const show = (next: "pl" | "en") =>
    view.rerender(
      <QueryClientProvider client={qc}>
        <SavedPanel onClose={onClose} lang={next} />
      </QueryClientProvider>,
    );
  return { ...view, onClose, show };
}

/** Widoczne wiersze listy, w kolejności renderowania. */
function titles(): string[] {
  return screen.getAllByRole("listitem").map((item) => item.textContent?.trim() ?? "");
}

/** Wiersz po widocznym tytule - nazwa dostępna linku to zawsze „Otwórz". */
function row(title: string): HTMLLIElement {
  const node = screen.getByText(title).closest("li");
  if (!node) throw new Error(`brak wiersza "${title}"`);
  return node;
}

function filterButton(label: string): HTMLElement {
  return screen.getByRole("button", { name: label });
}

describe("panel zapisanych - stany zapytania", () => {
  it("w oczekiwaniu pokazuje szkielet wierszy, a nie „nic nie zapisałeś”", async () => {
    seedAll();
    const { container } = renderPanel();

    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByText(dockPl.dock.saved.empty)).toBeNull();
    expect(screen.queryByText(dockPl.dock.error)).toBeNull();

    await screen.findByText(RAPORT_PL);
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it("jedno z dwóch zapytań wciąż w drodze trzyma CAŁY panel w oczekiwaniu", async () => {
    seedAll();
    const kolejka = deferred();
    db.setResponse("user_read_later", () => kolejka.promise);
    const { container } = renderPanel();

    // Zakładki są już domknięte (druga runda po tytuły zdążyła polecieć),
    // a mimo to panel nie pokazuje jeszcze ani listy, ani pustego stanu.
    await waitFor(() => expect(db.chainsFor("posts")).toHaveLength(1));
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByText(RAPORT_PL)).toBeNull();
    expect(screen.queryByText(dockPl.dock.saved.empty)).toBeNull();

    kolejka.resolve(ok(data.readLater));
    expect(await screen.findByText(KOLEJKA)).toBeTruthy();
    expect(screen.getByText(RAPORT_PL)).toBeTruthy();
  });

  it("bez zapisanych elementów pokazuje pusty stan", async () => {
    renderPanel();

    expect(await screen.findByText(dockPl.dock.saved.empty)).toBeTruthy();
    expect(screen.queryByRole("listitem")).toBeNull();
    // Wyszukiwarka i filtry są NAD gałęzią - zostają dostępne także pusto.
    expect(screen.getByLabelText(dockPl.dock.saved.searchPlaceholder)).toBeTruthy();
  });

  it.each(["user_bookmarks", "user_read_later"])(
    "błąd z tabeli %s zasłania listę komunikatem o błędzie",
    async (table) => {
      seedAll();
      db.setResponse(table, fail("permission denied"));
      renderPanel();

      expect(await screen.findByText(dockPl.dock.error)).toBeTruthy();
      expect(screen.queryByText(dockPl.dock.saved.empty)).toBeNull();
      expect(screen.queryByRole("listitem")).toBeNull();
    },
  );
});

describe("panel zapisanych - scalona lista", () => {
  it("sortuje oba źródła malejąco po dacie zapisu", async () => {
    seedAll();
    renderPanel();
    await screen.findByText(RAPORT_PL);

    // kolejka (-1 dzień), strona (-2), wpis (-3), wydarzenie (-4)
    expect(titles()).toEqual([KOLEJKA, STRONA_PL, RAPORT_PL, WYDARZENIE_PL]);
  });

  it("buduje adres według rodzaju, a wiersz bez adresu nie jest linkiem", async () => {
    seedAll();
    data.readLater = [
      readLaterItem("rl-1"),
      readLaterItem("rl-2", {
        title: KOLEJKA_BEZ_ADRESU,
        url: null,
        created_at: relativeIso(-5 * DZIEN),
      }),
    ];
    renderPanel();
    await screen.findByText(RAPORT_PL);

    expect(within(row(RAPORT_PL)).getByRole("link").getAttribute("href")).toBe("/raport-kwartalny");
    expect(within(row(STRONA_PL)).getByRole("link").getAttribute("href")).toBe("/zespol");
    expect(within(row(WYDARZENIE_PL)).getByRole("link").getAttribute("href")).toBe(
      "/events/sniadanie-prasowe",
    );
    expect(within(row(KOLEJKA)).getByRole("link").getAttribute("href")).toBe(
      "/analizy/konsultacje-publiczne",
    );
    expect(within(row(KOLEJKA_BEZ_ADRESU)).queryByRole("link")).toBeNull();
    // Nazwą dostępną linku jest „Otwórz”, nie tytuł - to świadoma umowa panelu.
    expect(within(row(RAPORT_PL)).getByLabelText(dockPl.dock.saved.open)).toBeTruthy();
  });

  it("wiersz kolejki bez tytułu spada na adres, a bez adresu - na identyfikator", async () => {
    // Kolejkę wypełniają przyciski „zapisz na później" rozsiane po serwisie
    // i nie każdy z nich ma tytuł pod ręką. Wiersz MUSI wtedy pokazać cokolwiek
    // rozpoznawalnego zamiast pustego miejsca - stąd łańcuch zapasowy
    // tytuł -> adres -> identyfikator (SavedPanel.tsx:97).
    data.readLater = [
      readLaterItem("rl-url", { title: null, url: "/biuletyn/marzec" }),
      readLaterItem("rl-goly", {
        title: null,
        url: null,
        entity_id: "dokument-bez-metadanych",
        created_at: relativeIso(-2 * DZIEN),
      }),
    ];
    renderPanel();

    expect(await screen.findByText("/biuletyn/marzec")).toBeTruthy();
    expect(within(row("/biuletyn/marzec")).getByRole("link").getAttribute("href")).toBe(
      "/biuletyn/marzec",
    );
    expect(screen.getByText("dokument-bez-metadanych")).toBeTruthy();
    expect(within(row("dokument-bez-metadanych")).queryByRole("link")).toBeNull();
  });

  it("filtr rodzaju zawęża listę i przestawia stan wciśnięcia", async () => {
    seedAll();
    renderPanel();
    await screen.findByText(RAPORT_PL);

    fireEvent.click(filterButton(dockPl.dock.saved.filters.page));

    expect(titles()).toEqual([STRONA_PL]);
    expect(filterButton(dockPl.dock.saved.filters.page).getAttribute("aria-pressed")).toBe("true");
    expect(filterButton(dockPl.dock.saved.filters.all).getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(filterButton(dockPl.dock.saved.filters.all));
    expect(titles()).toHaveLength(4);
  });

  it("wyszukiwarka zawęża bez względu na wielkość liter", async () => {
    seedAll();
    renderPanel();
    await screen.findByText(RAPORT_PL);
    const search = screen.getByLabelText(dockPl.dock.saved.searchPlaceholder);

    fireEvent.change(search, { target: { value: "RAPORT" } });
    // `useDeferredValue`: lista przerysowuje się w niskim priorytecie.
    await waitFor(() => expect(titles()).toEqual([RAPORT_PL]));

    // Fraza bez trafień wraca tym samym pustym stanem, co brak zapisów -
    // panel nie ma osobnego napisu „nic nie znaleziono”.
    fireEvent.change(search, { target: { value: "brukselski poniedziałek" } });
    expect(await screen.findByText(dockPl.dock.saved.empty)).toBeTruthy();
  });

  it("filtr „Do przeczytania” ignoruje wpisaną frazę (stan zastany)", async () => {
    seedAll();
    data.readLater = [
      readLaterItem("rl-1"),
      readLaterItem("rl-2", {
        title: KOLEJKA_BEZ_ADRESU,
        url: null,
        created_at: relativeIso(-5 * DZIEN),
      }),
    ];
    renderPanel();
    await screen.findByText(RAPORT_PL);

    fireEvent.change(screen.getByLabelText(dockPl.dock.saved.searchPlaceholder), {
      target: { value: "konsultacji" },
    });
    // Przy filtrze „Wszystko” fraza DZIAŁA - to dowodzi, że przerysowanie
    // z niskiego priorytetu zdążyło wejść, zanim przełączymy filtr.
    await waitFor(() => expect(titles()).toEqual([KOLEJKA]));

    fireEvent.click(filterButton(dockPl.dock.saved.filters.readLater));

    // SavedPanel.tsx:109 wraca PRZED sprawdzeniem frazy, więc oba wiersze
    // kolejki wracają na ekran mimo niepasującej frazy w polu.
    expect(titles()).toEqual([KOLEJKA, KOLEJKA_BEZ_ADRESU]);
    expect(screen.getByLabelText(dockPl.dock.saved.searchPlaceholder)).toHaveValue("konsultacji");
  });

  // DEFEKT. `if (filter === "readLater") return entry.kind === "readLater";`
  // (SavedPanel.tsx:109) wraca z filtru PRZED testem frazy z linii 111, więc
  // wybranie „Do przeczytania” po cichu wyłącza wyszukiwarkę: pole nadal
  // przyjmuje tekst i nadal go pokazuje, ale lista przestaje na niego
  // reagować. Każdy inny filtr frazę respektuje, więc to niespójność, a nie
  // świadomy wyjątek - użytkownik widzi wpisaną frazę i listę, która jej
  // przeczy. Test opisuje zachowanie OCZEKIWANE; do czasu poprawki produkcji
  // ma prawo padać (poprzedni test pilnuje, żeby zmiana była świadoma).
  it.fails("DEFEKT: fraza powinna zawężać także filtr „Do przeczytania”", async () => {
    seedAll();
    data.readLater = [
      readLaterItem("rl-1"),
      readLaterItem("rl-2", {
        title: KOLEJKA_BEZ_ADRESU,
        url: null,
        created_at: relativeIso(-5 * DZIEN),
      }),
    ];
    renderPanel();
    await screen.findByText(RAPORT_PL);

    fireEvent.change(screen.getByLabelText(dockPl.dock.saved.searchPlaceholder), {
      target: { value: "konsultacji" },
    });
    await waitFor(() => expect(titles()).toEqual([KOLEJKA]));

    fireEvent.click(filterButton(dockPl.dock.saved.filters.readLater));
    expect(titles()).toEqual([KOLEJKA]);
  });

  it("język zmienia TYTUŁ materiału, nie napisy panelu, i nie pobiera danych drugi raz", async () => {
    seedAll();
    const { show } = renderPanel("en");

    expect(await screen.findByText(RAPORT_EN)).toBeTruthy();
    expect(screen.getByText(WYDARZENIE_EN)).toBeTruthy();
    expect(screen.queryByText(RAPORT_PL)).toBeNull();
    // Chrom panelu bierze język z i18n (w teście polski), nie z właściwości.
    expect(screen.getByLabelText(dockPl.dock.saved.searchPlaceholder)).toBeTruthy();
    expect(screen.queryByLabelText(dockEn.dock.saved.searchPlaceholder)).toBeNull();

    show("pl");

    expect(await screen.findByText(RAPORT_PL)).toBeTruthy();
    // Klucz zapytania jest językowo neutralny: żadnej drugiej serii zapytań.
    expect(db.chainsFor("user_bookmarks")).toHaveLength(1);
    expect(db.chainsFor("posts")).toHaveLength(1);
  });
});

describe("panel zapisanych - kolejka do przeczytania", () => {
  it("akcje kolejki są tylko przy wierszach kolejki", async () => {
    seedAll();
    renderPanel();
    await screen.findByText(RAPORT_PL);

    const zakladka = within(row(RAPORT_PL));
    expect(zakladka.queryByLabelText(dockPl.dock.readLater.markRead)).toBeNull();
    expect(zakladka.queryByLabelText(dockPl.dock.readLater.archive)).toBeNull();
    expect(zakladka.queryByLabelText(dockPl.dock.readLater.remove)).toBeNull();

    const kolejka = within(row(KOLEJKA));
    expect(kolejka.getByLabelText(dockPl.dock.readLater.markRead)).toBeTruthy();
    expect(kolejka.getByLabelText(dockPl.dock.readLater.archive)).toBeTruthy();
    expect(kolejka.getByLabelText(dockPl.dock.readLater.remove)).toBeTruthy();
  });

  it.each([
    {
      stan: "unread" as ReadLaterState,
      etykieta: dockPl.dock.readLater.markRead,
      ladunek: { state: "read", read_at: FIXED_NOW_ISO },
    },
    {
      stan: "read" as ReadLaterState,
      etykieta: dockPl.dock.readLater.markUnread,
      ladunek: { state: "unread", read_at: null },
    },
    {
      stan: "unread" as ReadLaterState,
      etykieta: dockPl.dock.readLater.archive,
      ladunek: { state: "archived", read_at: null },
    },
  ])("$etykieta - wysyła ładunek i identyfikator wiersza", async ({ stan, etykieta, ladunek }) => {
    seedAll();
    data.readLater = [readLaterItem("rl-1", { state: stan })];
    renderPanel();
    await screen.findByText(KOLEJKA);

    fireEvent.click(within(row(KOLEJKA)).getByLabelText(etykieta));

    await waitFor(() =>
      expect(db.chainsFor("user_read_later").filter((c) => c.has("update"))).toHaveLength(1),
    );
    const zapis = db.chainsFor("user_read_later").filter((c) => c.has("update"))[0];
    expect(zapis.argsOf("update")?.[0]).toEqual(ladunek);
    expect(zapis.argsOf("eq")).toEqual(["id", "rl-1"]);
  });

  it("po odświeżeniu przycisk oferuje akcję odwrotną", async () => {
    seedAll();
    renderPanel();
    await screen.findByText(KOLEJKA);

    fireEvent.click(within(row(KOLEJKA)).getByLabelText(dockPl.dock.readLater.markRead));

    // Unieważnienie klucza po mutacji przynosi wiersz JUŻ przeczytany.
    expect(await screen.findByLabelText(dockPl.dock.readLater.markUnread)).toBeTruthy();
    expect(screen.queryByLabelText(dockPl.dock.readLater.markRead)).toBeNull();
  });

  it("usunięcie z kolejki znika z listy, reszta zapisów zostaje", async () => {
    seedAll();
    renderPanel();
    await screen.findByText(KOLEJKA);

    fireEvent.click(within(row(KOLEJKA)).getByLabelText(dockPl.dock.readLater.remove));

    await waitFor(() => expect(screen.queryByText(KOLEJKA)).toBeNull());
    const usuniecie = db.chainsFor("user_read_later").filter((c) => c.has("delete"));
    expect(usuniecie).toHaveLength(1);
    expect(usuniecie[0].argsOf("eq")).toEqual(["id", "rl-1"]);
    expect(titles()).toEqual([STRONA_PL, RAPORT_PL, WYDARZENIE_PL]);
  });
});

describe("panel zapisanych - powłoka i dostępność", () => {
  it("przycisk zamknięcia woła onClose dokładnie raz", async () => {
    seedAll();
    const { onClose } = renderPanel();
    await screen.findByText(RAPORT_PL);

    fireEvent.click(screen.getByLabelText(dockPl.dock.close));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("wczytana lista nie ma naruszeń dostępności", async () => {
    seedAll();
    const { container } = renderPanel();
    await screen.findByText(RAPORT_PL);

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
