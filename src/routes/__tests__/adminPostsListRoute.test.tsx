// Lista wpisów `/admin/posts` (768 linii, 0% przed zmianą) - główny ekran
// redakcji i najgęstszy węzeł modułu 2: filtry serwerowe, stronicowanie, kosz
// z przywracaniem i trwałym usuwaniem, akcje masowe, licznik parytetu PL/EN.
//
// CZEGO TU NIE MA. Molekuły (`AdminListToolbar`, `AdminPagination`,
// `BulkActionsBar`) i atomy (`StatusBadge`, `LangCoverageBadges`) mają własne
// testy - tutaj są atrapowane do sond, żeby test mógł WYWOŁAĆ ich callbacki i
// sprawdzić, co trasa robi z wynikiem. `escapeLike`, `authorLabel` i
// `toastBulkResult` zostają PRAWDZIWE: to one decydują o zapytaniu i o treści
// komunikatu, więc ich podmiana wydrążyłaby test.
//
// OSIEM RZECZY, KTÓRE MAJĄ TU DOWÓD:
//   1. KAŻDE ZAPYTANIE JEST TENANTOWE. Lista, licznik kosza, licznik parytetu
//      i licznik widoku - cztery zapytania, cztery filtry `tenant_id`. Jedno
//      pominięcie pokazuje archiwum innej firmy.
//   2. FILTRY IDĄ NA SERWER, nie do filtrowania w przeglądarce. Fraza jest
//      ESCAPE'OWANA (`%` i `_` w tytule nie mogą zmienić zapytania), a każdy
//      wariant pokrycia językowego ma swój warunek.
//   3. KOSZ TO INNY WIDOK, NIE INNY FILTR: inne sortowanie (`deleted_at`),
//      inne akcje (przywróć / usuń trwale), zakres dat po dacie usunięcia z
//      DOMKNIĘTĄ granicą dnia.
//   4. ZMIANA FILTRA WRACA NA PIERWSZĄ STRONĘ. Bez tego filtr zawężający wynik
//      do 3 wpisów pokazywałby pustą stronę 7.
//   5. JĘZYK LISTY STERUJE EDYTOREM. Filtr „tylko EN” otwiera wpis w wersji
//      EN (`?lang=en`) - inaczej redaktor poprawia wersję, której nie szukał.
//   6. PUBLIKOWANIE MASOWE TYLKO DLA ADMINA (serwer też tego pilnuje, ale UI
//      nie ma prawa proponować akcji, która się odbije).
//   7. WYNIK MASOWY JEST UCZCIWY: 0 zmienionych to BŁĄD, część to
//      OSTRZEŻENIE - nie „zrobiono N” liczone z żądania.
//   8. PUSTKA MA DWA ZNACZENIA: „nic tu nie ma” i „filtry wykluczyły
//      wszystko". Licznik widoku je rozdziela.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";

interface Counts {
  trash: number;
  view: number;
  missingEn: number;
}

const h = vi.hoisted(() => ({
  auth: { tenantId: "tenant-1" as string | null, isAdmin: true },
  rows: [] as unknown[],
  total: 0,
  counts: { trash: 0, view: 0, missingEn: 0 } as Counts,
  authors: [] as unknown[],
  rpcFails: false,
  language: "pl" as string,
  routerPath: null as string | null,
  db: null as unknown,
  rpc: null as unknown,
  toast: null as unknown,
  navigate: null as unknown,
  captured: {} as Record<string, unknown>,
  fns: {} as Record<string, unknown>,
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/post-editor/fixtures")).reactI18nextStub(() => h.language),
);

vi.mock("sonner", async () => {
  const { toastStub } = await import("@/test/post-editor/fixtures");
  const toast = toastStub();
  h.toast = toast;
  return { toast, Toaster: () => null };
});

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabaseChain");
  const { vi: v } = await import("vitest");
  const db = supabaseFromStub();
  h.db = db;
  h.rpc = v.fn(async () => {
    if (h.rpcFails) throw new Error("brak funkcji publish_due_posts");
    return { data: null, error: null };
  });
  return { supabase: { from: db.from, rpc: h.rpc } };
});

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => h.auth }));

// Server fns jako szpiedzy; `useServerFn` oddaje w produkcji wołalny wrapper
// tej samej funkcji, więc tożsamość jest wierna.
vi.mock("@/lib/content.functions", async () => {
  const { vi: v } = await import("vitest");
  h.fns = {
    deletePost: v.fn(async () => undefined),
    duplicatePost: v.fn(async () => ({ slug: "kopia-wpisu" })),
    bulkDeletePosts: v.fn(async () => ({ count: 2, requested: 2 })),
    bulkUpdatePosts: v.fn(async () => ({ count: 2, requested: 2 })),
    restorePosts: v.fn(async () => ({ count: 1, requested: 1 })),
    purgePosts: v.fn(async () => ({ count: 1, requested: 1 })),
  };
  return h.fns;
});
vi.mock("@/lib/posts-migrate.functions", async () => {
  const { vi: v } = await import("vitest");
  h.fns.bulkMigratePostsToBlocks = v.fn(async () => ({ total: 2, migrated: 2, results: [] }));
  return { bulkMigratePostsToBlocks: h.fns.bulkMigratePostsToBlocks };
});
vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-start")>();
  return { ...actual, useServerFn: (fn: unknown) => fn };
});

// `Link` i `useNavigate` bez pełnego drzewa tras. `useRouterState` zostaje
// PRAWDZIWY (to on decyduje o przełączniku layout/lista); `h.routerPath`
// pozwala tylko udać wejście na trasę potomną, której harness nie montuje.
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  const React = await import("react");
  const { vi: v } = await import("vitest");
  h.navigate = v.fn();
  // Własna atrapa `Link` (a nie współdzielony `RouterLinkStub`), bo regułą tej
  // trasy jest PARAMETR `search` przekazany do edytora - a zwykły `<a>` go nie
  // pokazuje. Atrapa wystawia go w `data-search`.
  const Link = ({
    to,
    params,
    search,
    children,
    ...rest
  }: {
    to?: string;
    params?: Record<string, string>;
    search?: unknown;
    children?: React.ReactNode;
  } & Record<string, unknown>) => {
    let href = typeof to === "string" ? to : "#";
    for (const [key, value] of Object.entries(params ?? {})) href = href.replace(`$${key}`, value);
    return React.createElement(
      "a",
      { href, "data-search": JSON.stringify(search ?? null), ...rest },
      children as never,
    );
  };
  return {
    ...actual,
    Link,
    useNavigate: () => h.navigate,
    useRouterState: (options: { select: (s: { location: { pathname: string } }) => unknown }) =>
      h.routerPath === null
        ? actual.useRouterState(options as never)
        : options.select({ location: { pathname: h.routerPath } }),
  };
});

// Zakładki muszą PRZEŁĄCZAĆ widok - Radix pod happy-dom tego nie robi.
vi.mock("@/components/ui/tabs", async () => {
  const React = await import("react");
  type Node = React.ReactNode;
  const Ctx = React.createContext<(v: string) => void>(() => {});
  return {
    Tabs: ({
      value,
      onValueChange,
      children,
    }: {
      value?: string;
      onValueChange?: (v: string) => void;
      children?: Node;
    }) =>
      React.createElement(
        Ctx.Provider,
        { value: onValueChange ?? (() => {}) },
        React.createElement("div", { "data-view": value }, children as never),
      ),
    TabsList: ({ children }: { children?: Node }) =>
      React.createElement("div", { role: "tablist" }, children as never),
    TabsTrigger: ({ value, children }: { value: string; children?: Node }) => {
      const set = React.useContext(Ctx);
      return React.createElement(
        "button",
        { role: "tab", onClick: () => set(value) },
        children as never,
      );
    },
    TabsContent: ({ children }: { children?: Node }) =>
      React.createElement(React.Fragment, null, children as never),
  };
});

/** Sonda: zapisuje propy, żeby test mógł wywołać callbacki molekuły. */
function probe(name: string) {
  return (props: Record<string, unknown>) => {
    h.captured[name] = props;
    return <div data-testid={name} />;
  };
}

vi.mock("@/components/admin/molecules/AdminListToolbar", () => ({
  AdminListToolbar: probe("toolbar"),
}));
vi.mock("@/components/admin/molecules/AdminPagination", () => ({
  AdminPagination: probe("pagination"),
}));
vi.mock("@/components/admin/BulkActionsBar", () => ({ BulkActionsBar: probe("bulk") }));
vi.mock("@/components/admin/ConfirmDialog", () => ({
  ConfirmDialog: ({
    state,
    onOpenChange,
  }: {
    state: {
      title: string;
      description?: string;
      confirmLabel?: string;
      destructive?: boolean;
      onConfirm: () => void | Promise<void>;
    } | null;
    onOpenChange: (open: boolean) => void;
  }) =>
    state ? (
      <div data-testid="confirm" data-destructive={String(!!state.destructive)}>
        <span>{state.title}</span>
        <span>{state.description}</span>
        <button
          type="button"
          onClick={async () => {
            await state.onConfirm();
            onOpenChange(false);
          }}
        >
          {state.confirmLabel}
        </button>
      </div>
    ) : null,
}));

import { renderRoute } from "@/test/routeHarness";
import { Route as PostsRoute } from "@/routes/admin.posts";
import { fail, ok, okCount, type RecordedChain, type SupabaseFromStub } from "@/test/supabaseChain";

type Mock = ReturnType<typeof vi.fn>;
const PATH = "/admin/posts";
const db = () => h.db as SupabaseFromStub;
const toast = () => h.toast as Record<string, Mock>;
const fn = (name: string) => h.fns[name] as Mock;
const props = (name: string) => h.captured[name] as Record<string, unknown>;

function post(overrides: Record<string, unknown> = {}) {
  return {
    id: "p-1",
    slug: "moj-wpis",
    title_pl: "Mój wpis",
    title_en: "My post",
    excerpt_pl: "Zajawka",
    excerpt_en: "Excerpt",
    status: "published",
    published_at: "2026-08-01T10:00:00.000Z",
    publish_at: null,
    updated_at: "2026-08-18T09:00:00.000Z",
    author_id: "a-1",
    deleted_at: null,
    ...overrides,
  };
}

const AUTHOR = { id: "a-1", display_name: "Anna Nowak", slug: "anna-nowak", avatar_url: null };

/** Wszystkie argumenty ogniwa (`argsOf` oddaje tylko pierwsze wystąpienie). */
function allArgs(chain: RecordedChain | undefined, method: string): unknown[][] {
  return (chain?.calls ?? []).filter((c) => c.method === method).map((c) => [...c.args]);
}

/**
 * Dwa kształty rzutu, ktore musi obsłużyć KAŻDY `catch` tej trasy: instancja
 * `Error` (błąd serwera z komunikatem) i cokolwiek innego (zerwane połączenie).
 * Drugi przypadek bez `String(e)` pokazałby redaktorowi „[object Object]”.
 */
const THROWS: ReadonlyArray<{ boom: unknown; message: string }> = [
  { boom: new Error("odmowa serwera"), message: "odmowa serwera" },
  { boom: "brak sieci", message: "brak sieci" },
];

/** Zapytanie LISTY - jedyne stronicowane (`range`). */
const listChain = () =>
  db()
    .chainsFor("posts")
    .filter((c) => c.has("range"))
    .at(-1);

function render() {
  return renderRoute({
    route: PostsRoute,
    path: PATH,
    initialEntry: PATH,
    queryClient: new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }),
  });
}

/** Czeka na pierwsze zapytanie listy - dalej test już wie, że render doszedł. */
async function renderList() {
  const view = await render();
  await waitFor(() => expect(listChain()).toBeDefined());
  return view;
}

async function renderWithRows(rows: unknown[] = [post()], total = rows.length) {
  h.rows = rows;
  h.total = total;
  h.counts = { ...h.counts, view: h.counts.view || total };
  const view = await renderList();
  await waitFor(() => expect(screen.queryByTestId("pagination")).not.toBeNull());
  return view;
}

/** Przełącza listę w widok kosza (zakładka „Kosz” jest drugą). */
async function switchToTrash() {
  fireEvent.click(screen.getAllByRole("tab")[1]);
  await waitFor(() =>
    expect(listChain()?.argsOf("order")).toEqual(["deleted_at", { ascending: false }]),
  );
}

beforeEach(() => {
  h.auth = { tenantId: "tenant-1", isAdmin: true };
  h.rows = [];
  h.total = 0;
  h.counts = { trash: 0, view: 0, missingEn: 0 };
  h.authors = [AUTHOR];
  h.rpcFails = false;
  h.language = "pl";
  h.routerPath = null;
  h.captured = {};
  db().reset();
  (h.rpc as Mock).mockClear();
  db().setResponse("profiles", () => ok(h.authors));
  db().setResponse("posts", (chain) => {
    // Cztery zapytania na jednej tabeli, rozpoznawane po kształcie łańcucha.
    if (chain.has("range")) return { ...ok(h.rows), count: h.total };
    const eqs = allArgs(chain, "eq");
    if (eqs.some((a) => a[0] === "status")) return okCount(h.counts.missingEn);
    // Licznik kosza i licznik widoku „kosz” mają IDENTYCZNY kształt
    // (`not(deleted_at, is, null)`), więc atrapa oddaje im tę samą liczbę.
    if (chain.has("not")) return okCount(h.counts.trash);
    return okCount(h.counts.view);
  });
  for (const name of Object.keys(h.fns)) fn(name).mockClear();
  fn("deletePost").mockResolvedValue(undefined);
  fn("duplicatePost").mockResolvedValue({ slug: "kopia-wpisu" });
  fn("bulkDeletePosts").mockResolvedValue({ count: 2, requested: 2 });
  fn("bulkUpdatePosts").mockResolvedValue({ count: 2, requested: 2 });
  fn("restorePosts").mockResolvedValue({ count: 1, requested: 1 });
  fn("purgePosts").mockResolvedValue({ count: 1, requested: 1 });
  fn("bulkMigratePostsToBlocks").mockResolvedValue({ total: 2, migrated: 2, results: [] });
  (h.navigate as Mock).mockClear();
  for (const f of Object.values(toast())) f.mockReset();
});

afterEach(cleanup);

// ---------------------------------------------------------------------------
// Przełącznik layout / lista
// ---------------------------------------------------------------------------

describe("trasa jako layout", () => {
  it("na `/admin/posts` renderuje LISTĘ", async () => {
    await renderList();
    expect(screen.getByText("admin.posts.title")).toBeInTheDocument();
  });

  it("na trasie POTOMNEJ oddaje miejsce dziecku i NIE odpytuje listy", async () => {
    // Edytor wpisu jest dzieckiem tej trasy. Gdyby lista renderowała się pod
    // nim, każde wejście w edytor ciągnęłoby cztery zapytania listy naraz.
    // `Outlet` zostaje PRAWDZIWY (harness montuje przez niego trasę), więc bez
    // dopasowanego dziecka nie renderuje nic - i o to tu chodzi: lista milczy.
    h.routerPath = "/admin/posts/moj-wpis";
    await render();

    expect(screen.queryByText("admin.posts.title")).toBeNull();
    expect(db().chainsFor("posts")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Kontrakt zapytania
// ---------------------------------------------------------------------------

describe("kontrakt zapytania listy", () => {
  it("jest TENANTOWE, pomija kosz, sortuje po aktualizacji i stronicuje", async () => {
    await renderList();

    const chain = listChain();
    expect(allArgs(chain, "eq")).toEqual([["tenant_id", "tenant-1"]]);
    expect(chain?.argsOf("is")).toEqual(["deleted_at", null]);
    expect(chain?.argsOf("order")).toEqual(["updated_at", { ascending: false }]);
    expect(chain?.argsOf("range")).toEqual([0, 49]);
    // Licznik całości musi przyjść z serwera - inaczej stronicowanie nie wie,
    // ile jest stron.
    expect(chain?.argsOf("select")?.[1]).toEqual({ count: "exact" });
  });

  it("wszystkie CZTERY zapytania mają filtr tenanta", async () => {
    // Lista, licznik kosza, licznik parytetu EN i licznik widoku.
    await renderList();

    await waitFor(() => expect(db().chainsFor("posts").length).toBeGreaterThanOrEqual(4));
    for (const chain of db().chainsFor("posts")) {
      expect(allArgs(chain, "eq")).toContainEqual(["tenant_id", "tenant-1"]);
    }
  });

  it("BEZ tenanta nie leci ani jedno zapytanie", async () => {
    h.auth = { tenantId: null, isAdmin: true };
    await render();

    await waitFor(() => expect(screen.getByText("admin.posts.title")).toBeInTheDocument());
    expect(db().chainsFor("posts")).toHaveLength(0);
  });

  it("dobija zaległe publikacje przed odczytem, a awaria tego kroku NIE psuje listy", async () => {
    // `publish_due_posts` to ratunek na środowiska bez pg_cron. Wpis
    // zaplanowany na wczoraj musi zdążyć się opublikować, ale brak funkcji w
    // bazie nie ma prawa wywrócić listy.
    h.rpcFails = true;
    await renderWithRows();

    expect(h.rpc as Mock).toHaveBeenCalledWith("publish_due_posts");
    expect(screen.getByText("Mój wpis")).toBeInTheDocument();
  });

  it("fraza szukania jest ODKAŻANA i idzie w trzy kolumny", async () => {
    // `escapeLike` USUWA metaznaki (`% _ , ( ) " \`), a nie escape'uje ich.
    // Przecinek jest tu najgroźniejszy: `.or()` rozdziela nim warunki, więc
    // fraza „a,b” bez odkażenia dokładałaby do zapytania WŁASNY warunek.
    await renderList();

    (props("toolbar").onSearch as (v: string) => void)('100% zniżki_ a,b(c)"');

    await waitFor(() => expect(String(listChain()?.argsOf("or")?.[0] ?? "")).toContain("ilike"));
    const or = String(listChain()?.argsOf("or")?.[0]);
    expect(or).toContain("title_pl.ilike.%100 zniżki abc%");
    expect(or).toContain("title_en.ilike.%100 zniżki abc%");
    expect(or).toContain("slug.ilike.%100 zniżki abc%");
    // Trzy warunki, czyli DWA przecinki - ani jeden nie przyszedł z frazy.
    expect(or.split(",")).toHaveLength(3);
  });

  it("filtr statusu i autora dokładają warunki równości", async () => {
    await renderList();

    (props("toolbar").onStatus as (v: string) => void)("scheduled");
    await waitFor(() => expect(allArgs(listChain(), "eq")).toContainEqual(["status", "scheduled"]));

    (props("toolbar").onAuthor as (v: string) => void)("a-1");
    await waitFor(() => expect(allArgs(listChain(), "eq")).toContainEqual(["author_id", "a-1"]));
  });

  it("każdy wariant POKRYCIA JĘZYKOWEGO ma własny warunek", async () => {
    // „Pusty tytuł” i „brak tytułu” to w bazie dwa różne stany - filtr, który
    // sprawdza tylko NULL, przepuszczałby wpisy z pustym stringiem.
    await renderList();
    const setLang = (v: string) => (props("toolbar").onLang as (v: string) => void)(v);

    setLang("complete");
    await waitFor(() => expect(allArgs(listChain(), "neq")).toHaveLength(2));
    expect(allArgs(listChain(), "not")).toEqual([
      ["title_pl", "is", null],
      ["title_en", "is", null],
    ]);

    setLang("has_pl");
    await waitFor(() => expect(allArgs(listChain(), "not")).toEqual([["title_pl", "is", null]]));

    setLang("has_en");
    await waitFor(() => expect(allArgs(listChain(), "not")).toEqual([["title_en", "is", null]]));

    setLang("missing_any");
    await waitFor(() =>
      expect(listChain()?.argsOf("or")).toEqual([
        "title_pl.is.null,title_pl.eq.,title_en.is.null,title_en.eq.",
      ]),
    );

    setLang("pl_only");
    await waitFor(() =>
      expect(listChain()?.argsOf("or")).toEqual(["title_en.is.null,title_en.eq."]),
    );

    setLang("en_only");
    await waitFor(() =>
      expect(listChain()?.argsOf("or")).toEqual(["title_pl.is.null,title_pl.eq."]),
    );
  });

  it("PUSTE odpowiedzi bazy (null) dają zera, nie „undefined” na ekranie", async () => {
    // PostgREST oddaje `data: null` / `count: null` przy zerowym wyniku -
    // wszystkie cztery zapytania muszą to znieść.
    db().setResponse("posts", () => ({ data: null, error: null, count: null }));
    await renderList();

    await waitFor(() => expect(screen.getByText("admin.posts.empty")).toBeInTheDocument());
    expect(screen.getByText(/^0 admin\.posts\.count$/)).toBeInTheDocument();
    expect(screen.getByText("admin.list.tabs.trash")).toBeInTheDocument();
  });

  it("BRAK języka w i18n (przed detekcją) nie wywraca listy", async () => {
    h.language = undefined as unknown as string;
    await renderWithRows();

    expect(screen.getByText("Mój wpis")).toBeInTheDocument();
  });

  it("BŁĄD zapytania nie zabiera ekranu", async () => {
    db().setResponse("posts", () => fail("statement timeout"));
    await render();

    await waitFor(() => expect(screen.getByText("admin.posts.title")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText("admin.posts.empty")).toBeInTheDocument());
  });
});

// ---------------------------------------------------------------------------
// Kosz
// ---------------------------------------------------------------------------

describe("widok kosza", () => {
  it("zmienia FILTR, SORTOWANIE i chowa filtr statusu", async () => {
    await renderWithRows();

    await switchToTrash();

    expect(listChain()?.argsOf("not")).toEqual(["deleted_at", "is", null]);
    expect(listChain()?.has("is")).toBe(false);
    expect(props("toolbar").hideStatus).toBe(true);
  });

  it("zakres dat usunięcia ma DOMKNIĘTĄ granicę dnia", async () => {
    // `lte` na samej dacie ucinałby wszystko po 00:00 - wpisy usunięte tego
    // dnia po południu wypadałyby z zakresu.
    await renderWithRows();
    await switchToTrash();

    const from = screen.getAllByDisplayValue("")[0] as HTMLInputElement;
    const inputs = document.querySelectorAll('input[type="date"]');
    fireEvent.change(inputs[0], { target: { value: "2026-08-01" } });
    fireEvent.change(inputs[1], { target: { value: "2026-08-05" } });
    expect(from).toBeDefined();

    await waitFor(() => expect(listChain()?.has("lte")).toBe(true));
    expect(String(listChain()?.argsOf("gte")?.[1])).toContain("2026-08-01");
    // 5 sierpnia 23:59:59.999 - ostatnia milisekunda dnia.
    expect(String(listChain()?.argsOf("lte")?.[1])).toContain("2026-08-05T23:59:59.999");
  });

  it("licznik kosza jest w zakładce, gdy jest co pokazać", async () => {
    h.counts = { trash: 7, view: 0, missingEn: 0 };
    await renderList();

    await waitFor(() =>
      expect(screen.getByText(/admin.list.tabs.trash \(7\)/)).toBeInTheDocument(),
    );
  });

  it("PUSTY kosz nie dokłada licznika do zakładki", async () => {
    h.counts = { trash: 0, view: 0, missingEn: 0 };
    await renderList();

    await waitFor(() => expect(screen.getByText("admin.list.tabs.trash")).toBeInTheDocument());
  });

  it("w koszu wiersz ma PRZYWRÓĆ i USUŃ TRWALE, nie edycję", async () => {
    await renderWithRows([post({ deleted_at: "2019-07-01T08:00:00.000Z" })]);
    await switchToTrash();

    const row = screen.getByText("/moj-wpis").closest("tr") as HTMLElement;
    expect(within(row).getByTitle("admin.list.restore")).toBeInTheDocument();
    expect(within(row).getByTitle("admin.list.purge")).toBeInTheDocument();
    expect(within(row).queryByTitle("admin.list.duplicate")).toBeNull();
  });

  it("kolumna daty pokazuje datę USUNIĘCIA, nie aktualizacji", async () => {
    // W koszu „kiedy zmieniono” jest bez znaczenia; liczy się „kiedy wyrzucono”.
    await renderWithRows([
      post({ deleted_at: "2019-07-01T08:00:00.000Z", updated_at: "2026-08-18T09:00:00.000Z" }),
    ]);
    expect(screen.getByText(/2026/)).toBeInTheDocument();

    await switchToTrash();

    await waitFor(() => expect(screen.getByText(/2019/)).toBeInTheDocument());
  });

  it("wiersz w koszu BEZ daty usunięcia spada na datę aktualizacji", async () => {
    // Stan przejściowy (wiersz przywrócony w innej karcie) nie ma prawa dać
    // „Invalid Date”.
    await renderWithRows([post({ deleted_at: null, updated_at: "2026-08-18T09:00:00.000Z" })]);
    await switchToTrash();

    await waitFor(() => expect(screen.getByText(/2026/)).toBeInTheDocument());
  });
});

// ---------------------------------------------------------------------------
// Wiersze
// ---------------------------------------------------------------------------

describe("wiersz listy", () => {
  it("tytuł idzie za językiem widoku, spada na drugi język, a na końcu mówi „bez tytułu”", async () => {
    await renderWithRows([
      post({ id: "p-1", slug: "pelny" }),
      post({ id: "p-2", slug: "tylko-en", title_pl: "", title_en: "Only EN" }),
      post({ id: "p-3", slug: "pusty", title_pl: "", title_en: "" }),
    ]);

    expect(screen.getByText("Mój wpis")).toBeInTheDocument();
    // Brak PL - pokazujemy EN, żeby wiersz dał się rozpoznać.
    expect(screen.getByText("Only EN")).toBeInTheDocument();
    expect(screen.getByText(/admin.list.untitled/)).toBeInTheDocument();
  });

  it("EDYTOR OTWIERA SIĘ W JĘZYKU LISTY", async () => {
    // Filtr „tylko EN” znaczy: pracuję nad wersją angielską. Otwarcie wpisu w
    // PL kazałoby redaktorowi przełączać język w edytorze przy każdym wpisie.
    await renderWithRows();
    const titleLink = () => screen.getByRole("link", { name: /Mój wpis|My post/ });

    expect(titleLink().getAttribute("href")).toBe("/admin/posts/moj-wpis");
    expect(titleLink().dataset.search).toBe('{"lang":"pl"}');

    (props("toolbar").onLang as (v: string) => void)("en_only");

    await waitFor(() => expect(screen.getByText("My post")).toBeInTheDocument());
    expect(titleLink().dataset.search).toBe('{"lang":"en"}');
  });

  it("język widoku idzie za FILTREM, a bez filtra za językiem panelu", async () => {
    // Cztery drogi do jednego wyboru: „ma EN”/„tylko EN” wymuszają EN,
    // „ma PL”/„tylko PL” wymuszają PL, a brak filtra oddaje decyzję panelowi.
    h.language = "en";
    await renderWithRows();
    expect(screen.getByText("My post")).toBeInTheDocument();

    (props("toolbar").onLang as (v: string) => void)("has_pl");
    await waitFor(() => expect(screen.getByText("Mój wpis")).toBeInTheDocument());

    (props("toolbar").onLang as (v: string) => void)("has_en");
    await waitFor(() => expect(screen.getByText("My post")).toBeInTheDocument());

    (props("toolbar").onLang as (v: string) => void)("complete");
    await waitFor(() => expect(screen.getByText("My post")).toBeInTheDocument());
  });

  it("autor wiersza jest podpisany NAZWĄ, a nieznany kreską", async () => {
    await renderWithRows([post({ id: "p-1" }), post({ id: "p-2", slug: "obcy", author_id: null })]);

    await waitFor(() => expect(screen.getAllByText("Anna Nowak").length).toBeGreaterThan(0));
    expect(screen.getAllByText("-").length).toBeGreaterThan(0);
  });

  it("wpis ZAPLANOWANY pokazuje TERMIN publikacji, opublikowany nie", async () => {
    // Bez terminu na liście nie da się zauważyć, że wpis czeka od trzech dni.
    await renderWithRows([
      post({
        id: "p-1",
        slug: "zaplanowany",
        status: "scheduled",
        publish_at: "2026-09-01T08:30:00.000Z",
      }),
    ]);

    await waitFor(() => expect(screen.getAllByText(/2026/).length).toBeGreaterThan(0));
    expect(screen.getByText("admin.status.scheduled")).toBeInTheDocument();
  });

  it("zaplanowany BEZ terminu nie próbuje go pokazać", async () => {
    await renderWithRows([post({ status: "scheduled", publish_at: null })]);
    expect(screen.getByText("admin.status.scheduled")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Pustka i stronicowanie
// ---------------------------------------------------------------------------

describe("pustka i stronicowanie", () => {
  it("PUSTY widok i PUSTY WYNIK FILTRA to dwa różne komunikaty", async () => {
    // „Nie masz wpisów” wysłane redaktorowi, który ma 400 wpisów i literówkę w
    // filtrze, to komunikat, po którym zgłasza się awaria.
    h.rows = [];
    h.total = 0;
    h.counts = { trash: 0, view: 0, missingEn: 0 };
    await renderList();
    expect(screen.getByText("admin.posts.empty")).toBeInTheDocument();

    cleanup();
    h.counts = { trash: 0, view: 120, missingEn: 0 };
    await renderList();
    await waitFor(() => expect(screen.getByText("admin.list.noResults")).toBeInTheDocument());
  });

  it("pusty KOSZ też ma swój komunikat", async () => {
    h.rows = [];
    h.total = 0;
    await renderList();
    fireEvent.click(screen.getAllByRole("tab")[1]);

    await waitFor(() => expect(screen.getByText("admin.list.trashEmpty")).toBeInTheDocument());
  });

  it("pusty wynik filtra W KOSZU mówi „brak wyników”", async () => {
    h.rows = [];
    h.total = 0;
    h.counts = { trash: 9, view: 9, missingEn: 0 };
    await renderList();
    fireEvent.click(screen.getAllByRole("tab")[1]);

    await waitFor(() => expect(screen.getByText("admin.list.noResults")).toBeInTheDocument());
  });

  it("zmiana strony przesuwa ZAKRES zapytania", async () => {
    await renderWithRows([post()], 200);

    (props("pagination").onPageChange as (p: number) => void)(3);

    await waitFor(() => expect(listChain()?.argsOf("range")).toEqual([100, 149]));
  });

  it("zmiana ROZMIARU strony wraca na pierwszą stronę", async () => {
    // Strona 7 przy 50 na stronę nie istnieje przy 200 na stronę - bez powrotu
    // na początek lista pokazałaby pustkę.
    await renderWithRows([post()], 500);
    (props("pagination").onPageChange as (p: number) => void)(7);
    await waitFor(() => expect(listChain()?.argsOf("range")).toEqual([300, 349]));

    (props("pagination").onPageSizeChange as (s: number) => void)(20);

    await waitFor(() => expect(listChain()?.argsOf("range")).toEqual([0, 19]));
  });

  it("zmiana FILTRA wraca na pierwszą stronę", async () => {
    await renderWithRows([post()], 500);
    (props("pagination").onPageChange as (p: number) => void)(4);
    await waitFor(() => expect(listChain()?.argsOf("range")).toEqual([150, 199]));

    (props("toolbar").onStatus as (v: string) => void)("draft");

    await waitFor(() => expect(listChain()?.argsOf("range")).toEqual([0, 49]));
  });

  it("licznik wyników i licznik widoku jadą do paska filtrów", async () => {
    h.counts = { trash: 0, view: 120, missingEn: 0 };
    await renderWithRows([post()], 3);

    expect(props("toolbar").resultsCount).toBe(3);
    expect(props("toolbar").totalCount).toBe(120);
  });
});

// ---------------------------------------------------------------------------
// Parytet PL/EN
// ---------------------------------------------------------------------------

describe("licznik parytetu PL/EN", () => {
  it("pokazuje się TYLKO gdy są braki i TYLKO poza koszem", async () => {
    h.counts = { trash: 2, view: 10, missingEn: 4 };
    await renderWithRows();

    await waitFor(() => expect(screen.getByText(/admin.list.enParityGap/)).toBeInTheDocument());

    await switchToTrash();
    expect(screen.queryByText(/admin.list.enParityGap/)).toBeNull();
  });

  it("brak braków = brak alertu", async () => {
    h.counts = { trash: 0, view: 10, missingEn: 0 };
    await renderWithRows();
    expect(screen.queryByText(/admin.list.enParityGap/)).toBeNull();
  });

  it("KLIK przestawia filtry na te właśnie wpisy", async () => {
    // Licznik bez akcji jest wyrzutem sumienia; z akcją jest listą roboczą.
    h.counts = { trash: 0, view: 10, missingEn: 4 };
    await renderWithRows([post()], 10);

    fireEvent.click(screen.getByText(/admin.list.enParityGap/).closest("button")!);

    await waitFor(() => expect(allArgs(listChain(), "eq")).toContainEqual(["status", "published"]));
    expect(listChain()?.argsOf("or")).toEqual(["title_en.is.null,title_en.eq."]);
    expect(props("toolbar").status).toBe("published");
    expect(props("toolbar").lang).toBe("pl_only");
  });

  it("licznik parytetu liczy tylko OPUBLIKOWANE i nie z kosza", async () => {
    await renderList();

    await waitFor(() => expect(db().chainsFor("posts").length).toBeGreaterThanOrEqual(4));
    const parity = db()
      .chainsFor("posts")
      .find((c) => allArgs(c, "eq").some((a) => a[0] === "status"));
    expect(allArgs(parity, "eq")).toContainEqual(["status", "published"]);
    expect(parity?.argsOf("is")).toEqual(["deleted_at", null]);
    expect(parity?.argsOf("or")).toEqual(["title_en.is.null,title_en.eq."]);
  });
});

// ---------------------------------------------------------------------------
// Zaznaczanie
// ---------------------------------------------------------------------------

describe("zaznaczanie", () => {
  const boxes = () => screen.getAllByRole("checkbox");

  it("zaznaczenie pojedyncze DOKŁADA i ZDEJMUJE", async () => {
    await renderWithRows([post({ id: "p-1" }), post({ id: "p-2", slug: "drugi" })]);

    fireEvent.click(boxes()[1]);
    await waitFor(() => expect(props("bulk").count).toBe(1));

    fireEvent.click(boxes()[2]);
    await waitFor(() => expect(props("bulk").count).toBe(2));

    fireEvent.click(boxes()[1]);
    await waitFor(() => expect(props("bulk").count).toBe(1));
  });

  it("„zaznacz wszystko” bierze CAŁĄ STRONĘ i zwalnia ją drugim kliknięciem", async () => {
    await renderWithRows([post({ id: "p-1" }), post({ id: "p-2", slug: "drugi" })]);

    fireEvent.click(screen.getByLabelText("admin.list.selectAll"));
    await waitFor(() => expect(props("bulk").count).toBe(2));

    fireEvent.click(screen.getByLabelText("admin.list.selectAll"));
    await waitFor(() => expect(props("bulk").count).toBe(0));
  });

  it("częściowe zaznaczenie pokazuje stan NIEOKREŚLONY", async () => {
    // Trzeci stan checkboksa jest jedyną informacją „coś jest zaznaczone, ale
    // nie wszystko" - bez niego zaznaczenie strony wygląda jak zaznaczenie nic.
    await renderWithRows([post({ id: "p-1" }), post({ id: "p-2", slug: "drugi" })]);

    fireEvent.click(boxes()[1]);

    await waitFor(() =>
      expect(screen.getByLabelText("admin.list.selectAll")).toHaveAttribute(
        "data-state",
        "indeterminate",
      ),
    );
  });

  it("przełączenie widoku CZYŚCI zaznaczenie", async () => {
    // Wpisy z kosza i wpisy aktywne to inne akcje - zaznaczenie przeniesione
    // między widokami wysłałoby „przywróć” na wpis, który nie jest usunięty.
    await renderWithRows();
    fireEvent.click(screen.getByLabelText("admin.list.selectAll"));
    await waitFor(() => expect(props("bulk").count).toBe(1));

    await switchToTrash();

    expect(screen.queryByText(/admin.list.selected/)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Akcje na jednym wpisie
// ---------------------------------------------------------------------------

describe("akcje na jednym wpisie", () => {
  it("kosz PYTA, podając tytuł, i dopiero potem usuwa", async () => {
    const view = await renderWithRows();
    const invalidate = vi.spyOn(view.queryClient, "invalidateQueries");

    fireEvent.click(screen.getByTitle("admin.list.toTrash"));

    const box = await waitFor(() => screen.getByTestId("confirm"));
    expect(box.dataset.destructive).toBe("true");
    expect(within(box).getByText(/Mój wpis/)).toBeInTheDocument();
    expect(fn("deletePost")).not.toHaveBeenCalled();

    fireEvent.click(within(box).getByText("Przenieś do kosza"));

    await waitFor(() => expect(fn("deletePost")).toHaveBeenCalledWith({ data: { id: "p-1" } }));
    await waitFor(() =>
      expect(toast().success).toHaveBeenCalledWith("admin.bulkResult.trashedOne"),
    );
    const keys = invalidate.mock.calls.map((c) => JSON.stringify(c[0]));
    expect(keys).toContain(JSON.stringify({ queryKey: ["admin-posts"] }));
    expect(keys).toContain(JSON.stringify({ queryKey: ["admin-posts-trash-count"] }));
    expect(keys).toContain(JSON.stringify({ queryKey: ["admin-posts-view-count"] }));
  });

  it("nieudane przeniesienie do kosza pokazuje komunikat - dla OBU kształtów rzutu", async () => {
    for (const { boom, message } of THROWS) {
      cleanup();
      toast().error.mockReset();
      fn("deletePost").mockRejectedValue(boom);
      await renderWithRows();
      fireEvent.click(screen.getByTitle("admin.list.toTrash"));
      const box = await waitFor(() => screen.getByTestId("confirm"));

      fireEvent.click(within(box).getByText("Przenieś do kosza"));

      await waitFor(() => expect(toast().error).toHaveBeenCalledWith(message));
    }
  });

  it("DUPLIKAT otwiera od razu edytor KOPII", async () => {
    // Pętla „powiel i popraw” ma sens tylko wtedy, gdy kopia otwiera się sama.
    await renderWithRows();

    fireEvent.click(screen.getByTitle("admin.list.duplicate"));

    await waitFor(() => expect(fn("duplicatePost")).toHaveBeenCalledWith({ data: { id: "p-1" } }));
    await waitFor(() =>
      expect(h.navigate as Mock).toHaveBeenCalledWith({
        to: "/admin/posts/$slug",
        params: { slug: "kopia-wpisu" },
      }),
    );
    expect(toast().success).toHaveBeenCalledWith("admin.list.duplicated");
  });

  it("przycisk duplikatu JEST WYŁĄCZONY w trakcie kopiowania", async () => {
    // Dwa kliknięcia to dwie kopie - i redaktor sprząta po sobie ręcznie.
    let release: (v: unknown) => void = () => {};
    fn("duplicatePost").mockImplementation(() => new Promise((r) => (release = r)));
    await renderWithRows();

    fireEvent.click(screen.getByTitle("admin.list.duplicate"));
    await waitFor(() => expect(screen.getByTitle("admin.list.duplicate")).toBeDisabled());
    fireEvent.click(screen.getByTitle("admin.list.duplicate"));
    expect(fn("duplicatePost")).toHaveBeenCalledTimes(1);

    release({ slug: "kopia-wpisu" });
    await waitFor(() => expect(h.navigate as Mock).toHaveBeenCalled());
  });

  it("duplikat INNEGO wpisu w trakcie kopiowania też nie przechodzi", async () => {
    // Wyłączony jest tylko przycisk kopiowanego wiersza, więc bramką dla
    // pozostałych jest sprawdzenie stanu w funkcji. Bez niej dwa kliknięcia w
    // dwa różne wiersze dałyby dwie kopie i skok do edytora tej DRUGIEJ.
    let release: (v: unknown) => void = () => {};
    fn("duplicatePost").mockImplementation(() => new Promise((r) => (release = r)));
    await renderWithRows([post({ id: "p-1" }), post({ id: "p-2", slug: "drugi" })]);
    const buttons = screen.getAllByTitle("admin.list.duplicate");

    fireEvent.click(buttons[0]);
    await waitFor(() => expect(fn("duplicatePost")).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getAllByTitle("admin.list.duplicate")[1]);

    expect(fn("duplicatePost")).toHaveBeenCalledTimes(1);
    expect(fn("duplicatePost")).toHaveBeenCalledWith({ data: { id: "p-1" } });
    release({ slug: "kopia-wpisu" });
    await waitFor(() => expect(h.navigate as Mock).toHaveBeenCalled());
  });

  it("wpis BEZ tytułu jest w pytaniu podpisany SLUGIEM", async () => {
    // Pytanie „Wpis "" zostanie przeniesiony" nie mówi o czym jest.
    await renderWithRows([post({ title_pl: "", title_en: "" })]);

    fireEvent.click(screen.getByTitle("admin.list.toTrash"));

    const box = await waitFor(() => screen.getByTestId("confirm"));
    expect(within(box).getByText(/moj-wpis/)).toBeInTheDocument();
  });

  it("nieudany duplikat pokazuje komunikat - dla OBU kształtów rzutu", async () => {
    for (const { boom, message } of THROWS) {
      cleanup();
      toast().error.mockReset();
      (h.navigate as Mock).mockClear();
      fn("duplicatePost").mockRejectedValue(boom);
      await renderWithRows();

      fireEvent.click(screen.getByTitle("admin.list.duplicate"));

      await waitFor(() => expect(toast().error).toHaveBeenCalledWith(message));
      expect(h.navigate as Mock).not.toHaveBeenCalled();
    }
  });

  it("PRZYWRÓCENIE z kosza pyta i wysyła id", async () => {
    await renderWithRows([post({ deleted_at: "2019-07-01T08:00:00.000Z" })]);
    await switchToTrash();

    fireEvent.click(screen.getByTitle("admin.list.restore"));
    const box = await waitFor(() => screen.getByTestId("confirm"));
    // Przywracanie nie jest niszczące - okno nie może straszyć czerwienią.
    expect(box.dataset.destructive).toBe("false");
    fireEvent.click(within(box).getByText("Przywróć"));

    await waitFor(() =>
      expect(fn("restorePosts")).toHaveBeenCalledWith({ data: { ids: ["p-1"] } }),
    );
    expect(toast().success).toHaveBeenCalledWith('admin.bulkResult.restoredOne {"count":1}');
  });

  it("USUNIĘCIE TRWAŁE ostrzega, że nie da się cofnąć", async () => {
    await renderWithRows([post({ deleted_at: "2019-07-01T08:00:00.000Z" })]);
    await switchToTrash();

    fireEvent.click(screen.getByTitle("admin.list.purge"));
    const box = await waitFor(() => screen.getByTestId("confirm"));
    expect(box.dataset.destructive).toBe("true");
    expect(within(box).getByText(/nie można cofnąć/)).toBeInTheDocument();

    fireEvent.click(within(box).getByText("Usuń trwale"));

    await waitFor(() => expect(fn("purgePosts")).toHaveBeenCalledWith({ data: { ids: ["p-1"] } }));
  });

  it("nieudane przywrócenie i usunięcie trwałe pokazują komunikat - OBA kształty rzutu", async () => {
    for (const { boom, message } of THROWS) {
      cleanup();
      toast().error.mockReset();
      fn("restorePosts").mockRejectedValue(boom);
      fn("purgePosts").mockRejectedValue(boom);
      await renderWithRows([post({ deleted_at: "2019-07-01T08:00:00.000Z" })]);
      await switchToTrash();

      fireEvent.click(screen.getByTitle("admin.list.restore"));
      let box = await waitFor(() => screen.getByTestId("confirm"));
      fireEvent.click(within(box).getByText("Przywróć"));
      await waitFor(() => expect(toast().error).toHaveBeenCalledWith(message));

      fireEvent.click(screen.getByTitle("admin.list.purge"));
      box = await waitFor(() => screen.getByTestId("confirm"));
      fireEvent.click(within(box).getByText("Usuń trwale"));
      await waitFor(() => expect(toast().error).toHaveBeenCalledWith(message));
    }
  });
});

// ---------------------------------------------------------------------------
// Akcje masowe
// ---------------------------------------------------------------------------

describe("akcje masowe", () => {
  async function withSelection(rows = [post({ id: "p-1" }), post({ id: "p-2", slug: "drugi" })]) {
    const view = await renderWithRows(rows);
    fireEvent.click(screen.getByLabelText("admin.list.selectAll"));
    await waitFor(() => expect(props("bulk").count).toBe(rows.length));
    return view;
  }

  it("PUBLIKOWANIE masowe jest w ofercie tylko dla admina", async () => {
    // Serwer i tak odmówi, ale UI nie ma prawa proponować akcji, która się
    // odbije - to uczy redaktorów ignorowania błędów.
    await renderWithRows();
    expect(props("bulk").statuses).toEqual(["draft", "pending_review", "published", "archived"]);

    cleanup();
    h.auth = { tenantId: "tenant-1", isAdmin: false };
    await renderWithRows();
    expect(props("bulk").statuses).toEqual(["draft", "pending_review", "archived"]);
  });

  it("zmiana statusu masowo wysyła zaznaczone id i CZYŚCI zaznaczenie", async () => {
    const view = await withSelection();
    const invalidate = vi.spyOn(view.queryClient, "invalidateQueries");

    await (props("bulk").onApplyStatus as (s: string) => Promise<void>)("archived");

    expect(fn("bulkUpdatePosts")).toHaveBeenCalledWith({
      data: { ids: ["p-1", "p-2"], status: "archived" },
    });
    await waitFor(() => expect(props("bulk").count).toBe(0));
    expect(invalidate).toHaveBeenCalled();
  });

  it("wynik masowy 0 zmienionych to BŁĄD, nie sukces", async () => {
    // „Zrobiono 2” po tym, jak RLS odrzuciło oba wiersze, to najgorszy możliwy
    // komunikat - redaktor idzie dalej w przekonaniu, że zapisał.
    fn("bulkUpdatePosts").mockResolvedValue({ count: 0, requested: 2 });
    await withSelection();

    await (props("bulk").onApplyStatus as (s: string) => Promise<void>)("published");

    expect(toast().error).toHaveBeenCalledWith("admin.bulkResult.none");
    expect(toast().success).not.toHaveBeenCalled();
  });

  it("wynik CZĘŚCIOWY to ostrzeżenie z dwiema liczbami", async () => {
    fn("bulkUpdatePosts").mockResolvedValue({ count: 1, requested: 2 });
    await withSelection();

    await (props("bulk").onApplyStatus as (s: string) => Promise<void>)("published");

    expect(toast().warning).toHaveBeenCalledWith(
      'admin.bulkResult.partial {"count":1,"requested":2}',
    );
  });

  it("nieudana zmiana statusu pokazuje komunikat - dla OBU kształtów rzutu", async () => {
    for (const { boom, message } of THROWS) {
      cleanup();
      toast().error.mockReset();
      fn("bulkUpdatePosts").mockRejectedValue(boom);
      await withSelection();

      await (props("bulk").onApplyStatus as (s: string) => Promise<void>)("published");

      expect(toast().error).toHaveBeenCalledWith(message);
    }
  });

  it("masowe przeniesienie do kosza PYTA, podając liczbę wpisów", async () => {
    await withSelection();

    (props("bulk").onDelete as () => void)();

    const box = await waitFor(() => screen.getByTestId("confirm"));
    expect(within(box).getByText(/2 wpisów/)).toBeInTheDocument();
    fireEvent.click(within(box).getByText("Przenieś do kosza"));

    await waitFor(() =>
      expect(fn("bulkDeletePosts")).toHaveBeenCalledWith({ data: { ids: ["p-1", "p-2"] } }),
    );
    await waitFor(() => expect(props("bulk").count).toBe(0));
  });

  it("nieudane masowe przeniesienie do kosza pokazuje komunikat - OBA kształty rzutu", async () => {
    for (const { boom, message } of THROWS) {
      cleanup();
      toast().error.mockReset();
      fn("bulkDeletePosts").mockRejectedValue(boom);
      await withSelection();
      (props("bulk").onDelete as () => void)();
      const box = await waitFor(() => screen.getByTestId("confirm"));

      fireEvent.click(within(box).getByText("Przenieś do kosza"));

      await waitFor(() => expect(toast().error).toHaveBeenCalledWith(message));
    }
  });

  it("KONWERSJA DO BLOKÓW melduje, ilu wpisów naprawdę dotknęła", async () => {
    fn("bulkMigratePostsToBlocks").mockResolvedValue({ total: 2, migrated: 1, results: [] });
    await withSelection();

    await (props("bulk").onMigrateToBlocks as () => Promise<void>)();

    expect(fn("bulkMigratePostsToBlocks")).toHaveBeenCalledWith({
      data: { ids: ["p-1", "p-2"] },
    });
    expect(toast().success).toHaveBeenCalledWith("Skonwertowano: 1/2");
    await waitFor(() => expect(props("bulk").count).toBe(0));
  });

  it("konwersja BEZ zaznaczenia nie leci na serwer", async () => {
    // Konwersja całej bazy „przez przypadek” nadpisałaby treść wszystkich wpisów.
    await renderWithRows();

    await (props("bulk").onMigrateToBlocks as () => Promise<void>)();

    expect(fn("bulkMigratePostsToBlocks")).not.toHaveBeenCalled();
  });

  it("nieudana konwersja pokazuje komunikat - dla OBU kształtów rzutu", async () => {
    for (const { boom, message } of THROWS) {
      cleanup();
      toast().error.mockReset();
      fn("bulkMigratePostsToBlocks").mockRejectedValue(boom);
      await withSelection();

      await (props("bulk").onMigrateToBlocks as () => Promise<void>)();

      expect(toast().error).toHaveBeenCalledWith(message);
    }
  });

  it("masowe przywrócenie i masowe usunięcie trwałe działają Z KOSZA", async () => {
    fn("restorePosts").mockResolvedValue({ count: 2, requested: 2 });
    fn("purgePosts").mockResolvedValue({ count: 2, requested: 2 });
    await renderWithRows([
      post({ id: "p-1", deleted_at: "2019-07-01T08:00:00.000Z" }),
      post({ id: "p-2", slug: "drugi", deleted_at: "2019-07-02T08:00:00.000Z" }),
    ]);
    await switchToTrash();
    fireEvent.click(screen.getByLabelText("admin.list.selectAll"));
    await waitFor(() => expect(screen.getByText(/admin.list.selected/)).toBeInTheDocument());

    fireEvent.click(screen.getByText("admin.list.restore"));
    let box = await waitFor(() => screen.getByTestId("confirm"));
    expect(within(box).getByText(/2 wpisów/)).toBeInTheDocument();
    fireEvent.click(within(box).getByText("Przywróć"));
    await waitFor(() =>
      expect(fn("restorePosts")).toHaveBeenCalledWith({ data: { ids: ["p-1", "p-2"] } }),
    );

    fireEvent.click(screen.getByLabelText("admin.list.selectAll"));
    await waitFor(() => expect(screen.getByText(/admin.list.selected/)).toBeInTheDocument());
    fireEvent.click(screen.getByText("admin.list.purge"));
    box = await waitFor(() => screen.getByTestId("confirm"));
    expect(within(box).getByText(/nie można cofnąć/)).toBeInTheDocument();
    fireEvent.click(within(box).getByText("Usuń trwale"));
    await waitFor(() =>
      expect(fn("purgePosts")).toHaveBeenCalledWith({ data: { ids: ["p-1", "p-2"] } }),
    );
  });

  it("nieudane masowe przywrócenie i usunięcie trwałe - OBA kształty rzutu", async () => {
    for (const { boom, message } of THROWS) {
      cleanup();
      toast().error.mockReset();
      fn("restorePosts").mockRejectedValue(boom);
      fn("purgePosts").mockRejectedValue(boom);
      await renderWithRows([post({ id: "p-1", deleted_at: "2019-07-01T08:00:00.000Z" })]);
      await switchToTrash();
      fireEvent.click(screen.getByLabelText("admin.list.selectAll"));
      await waitFor(() => expect(screen.getByText(/admin.list.selected/)).toBeInTheDocument());

      fireEvent.click(screen.getByText("admin.list.restore"));
      let box = await waitFor(() => screen.getByTestId("confirm"));
      fireEvent.click(within(box).getByText("Przywróć"));
      await waitFor(() => expect(toast().error).toHaveBeenCalledWith(message));

      fireEvent.click(screen.getByText("admin.list.purge"));
      box = await waitFor(() => screen.getByTestId("confirm"));
      fireEvent.click(within(box).getByText("Usuń trwale"));
      await waitFor(() => expect(toast().error).toHaveBeenCalledWith(message));
    }
  });

  it("krzyżyk w pasku kosza zwalnia zaznaczenie", async () => {
    await renderWithRows([post({ id: "p-1", deleted_at: "2019-07-01T08:00:00.000Z" })]);
    await switchToTrash();
    fireEvent.click(screen.getByLabelText("admin.list.selectAll"));
    const bar = await waitFor(() => screen.getByText(/admin.list.selected/));

    const buttons = (bar.closest("div") as HTMLElement).querySelectorAll("button");
    fireEvent.click(buttons[buttons.length - 1]);

    await waitFor(() => expect(screen.queryByText(/admin.list.selected/)).toBeNull());
  });

  it("pasek masowy w koszu pojawia się DOPIERO po zaznaczeniu", async () => {
    await renderWithRows([post({ id: "p-1", deleted_at: "2019-07-01T08:00:00.000Z" })]);
    await switchToTrash();

    expect(screen.queryByText("admin.list.restore")).toBeNull();
    expect(screen.getByTitle("admin.list.restore")).toBeInTheDocument();
  });
});
