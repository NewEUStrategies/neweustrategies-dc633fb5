// TRASA LISTY STRON. Do 19.08.2026 na zerze (774 instrukcje) - druga co do
// wielkości trasa modułu 4.
//
// Ekran nie renderuje treści: buduje ZAPYTANIE. Filtry (widok, szukanie,
// status, pokrycie językowe, autor, temat, zakres dat kosza) i paginacja
// składają się w jeden łańcuch PostgREST, a każdy z nich potrafi zawieść po
// cichu - lista wygląda poprawnie, tylko pokazuje nie te wiersze. Dlatego
// większość przypadków niżej czyta ŁAŃCUCH, a nie tabelę.
//
// Trzy reguły są przy tym ważniejsze od pozostałych:
//   1. WIDOK KOSZA to inny zbiór (`deleted_at` nie-null) i inne sortowanie.
//      Pomylenie ich pokazuje skasowane strony wśród żywych.
//   2. GRANICA TENANTA jest w każdym zapytaniu. Bez niej lista przecieka
//      między redakcjami.
//   3. OPERACJE NIEODWRACALNE (kosz, trwałe usunięcie) przechodzą przez
//      potwierdzenie z nazwą strony.
//
// Dopisane 16.10.2026 (audyt pokrycia „Zarządzanie stronami CMS”) - sześć
// defektów naprawionych w trasie, każdy z testem, który na starym kodzie jest
// czerwony:
//   4. ZAZNACZENIE PO OPERACJI NA WIERSZU. Wiersz przywrócony, przeniesiony
//      do kosza albo usunięty pojedynczo zostawał w zaznaczeniu - „przywróć
//      jeden, potem usuń trwale zaznaczone” kasował nieodwracalnie stronę,
//      która właśnie wróciła na listę.
//   5. STRONA POZA ZBIOREM. Po skasowaniu ostatnich wierszy ostatniej strony
//      lista pytała dalej o zakres za końcem zbioru: pusta tabela bez drogi
//      powrotu (strzałka „dalej” wyłączona, „wstecz” przeskakiwała stronę).
//   6. LOKALNA DOBA W KOSZU. Daty z pola były czytane jako północ UTC, więc
//      w Warszawie zakres „usunięto od/do” przesuwał się o 1-2 h.
//   7. BŁĄD ODCZYTU NIE UDAJE PUSTKI. Po błędzie zapytania lista mówiła
//      „Brak stron” albo „Brak wyników dla filtrów”.
//   8. STRONA GŁÓWNA CZEKA NA USTAWIENIA. Bez wczytanej sekcji „reading” klik
//      zapisywał wartości domyślne: liczbę wpisów na stronie i widoczność dla
//      wyszukiwarek witryny celowo ukrytej.
//   9. LICZNIKI TEMATÓW. Mutacje nie unieważniały klucza zakładek tematów,
//      więc „Wszystkie (10)” zostawało po przeniesieniu strony do kosza.
// Do tego optymalizacja: kosz nie wysyła już drugiego, identycznego zapytania
// liczącego (licznik widoku = licznik zakładki), oraz `head()` ze wspólnego
// `adminPageHead` (AGENTS.md).
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { AnyRoute } from "@tanstack/react-router";
import { pgError, type RecordedChain } from "@/test/supabaseChain";

const h = vi.hoisted(() => ({
  path: "/admin/pages",
  rows: [] as Record<string, unknown>[],
  count: 0,
  trashCount: 3,
  viewCount: 10,
  rpcCalls: [] as string[],
  serverCalls: [] as { fn: string; payload: unknown }[],
  // `unknown`, nie `Error`: funkcja serwerowa potrafi odrzucić czymkolwiek.
  serverError: null as unknown,
  /** Własny wynik akcji serwerowej; domyślnie uczciwy BulkResult „wszystko przeszło”. */
  serverResult: null as ((fn: string, payload: { data: { ids?: string[] } }) => unknown) | null,
  rpcError: null as Error | null,
  listError: null as Error | null,
  authors: [{ id: "a1", display_name: "Anna Kowalska" }] as
    { id: string; display_name: string }[] | undefined,
  settings: {
    homepage_mode: "latest_posts",
    homepage_page_slug: "",
    posts_per_page: 10,
    search_engine_visibility: true,
  } as Record<string, unknown> | undefined,
  savedSettings: [] as unknown[],
  saveSettingsError: null as Error | null,
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

const stubs = vi.hoisted(() => ({
  from: null as import("@/test/supabaseChain").SupabaseFromStub | null,
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const { RouterLinkStub } = await import("@/test/routerLinkStub");
  type StubProps = import("@/test/routerLinkStub").RouterLinkStubProps;
  return {
    ...(await importOriginal<typeof import("@tanstack/react-router")>()),
    // Wspólna atrapa gubi `search`, a to w nim jedzie język otwieranego
    // edytora - wystawiamy go na atrybucie, żeby test mógł go przeczytać.
    Link: (props: StubProps) => (
      <RouterLinkStub
        {...props}
        data-search-lang={(props.search as { lang?: string } | undefined)?.lang}
      />
    ),
    Outlet: () => <div data-testid="podstrona" />,
    // Selektor musi się WYKONAĆ - to on wyciąga ścieżkę ze stanu routera.
    useRouterState: ({ select }: { select: (s: { location: { pathname: string } }) => string }) =>
      select({ location: { pathname: h.path } }),
  };
});
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ tenantId: "tenant-1" }) }));
vi.mock("sonner", () => ({ toast: h.toast }));
vi.mock("@/lib/content.functions", () => ({
  deletePage: "deletePage",
  bulkDeletePages: "bulkDeletePages",
  bulkUpdatePages: "bulkUpdatePages",
  restorePages: "restorePages",
  purgePages: "purgePages",
}));
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: (fn: unknown) => async (payload: { data: { ids?: string[] } }) => {
    if (h.serverError) throw h.serverError;
    h.serverCalls.push({ fn: String(fn), payload });
    if (h.serverResult) return h.serverResult(String(fn), payload);
    const ids = payload.data.ids;
    return ids ? { ok: true, count: ids.length, requested: ids.length } : { ok: true };
  },
}));
vi.mock("@/lib/admin/useSettings", () => ({
  useSettings: () => ({
    query: { data: h.settings },
    save: {
      isPending: false,
      mutateAsync: async (next: unknown) => {
        if (h.saveSettingsError) throw h.saveSettingsError;
        h.savedSettings.push(next);
      },
    },
  }),
}));
vi.mock("@/components/admin/hooks/useTenantAuthors", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/admin/hooks/useTenantAuthors")>()),
  useTenantAuthors: () => ({ data: h.authors }),
}));
// Zakładki tematów i import z WordPressa mają własne testy; tutaj są tylko
// sąsiadami listy i ciągnęłyby własne zapytania.
vi.mock("@/components/admin/molecules/TopicTabs", () => ({
  TopicTabs: ({ onChange }: { onChange: (v: string) => void }) => (
    <>
      <button type="button" onClick={() => onChange("other")}>
        temat: inne
      </button>
      <button type="button" onClick={() => onChange("events")}>
        temat: wydarzenia
      </button>
    </>
  ),
}));
vi.mock("@/components/admin/WordPressImportDialog", () => ({
  WordPressImportDialog: ({ trigger }: { trigger: ReactNode }) => <>{trigger}</>,
}));
vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabaseChain");
  const from = supabaseFromStub();
  stubs.from = from;
  return {
    supabase: {
      from: from.from,
      rpc: (name: string) => {
        h.rpcCalls.push(name);
        return h.rpcError
          ? Promise.reject(h.rpcError)
          : Promise.resolve({ data: null, error: null });
      },
    },
  };
});

import { realT } from "@/test/i18nReal";
import "@/lib/i18n-admin-extras";
import i18n from "@/lib/i18n";
import { routeHead } from "@/test/routeHarness";
import { Route } from "@/routes/admin.pages";

let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function page(overrides: Record<string, unknown> = {}) {
  return {
    id: "p1",
    slug: "o-nas",
    title_pl: "O nas",
    title_en: "About us",
    status: "published",
    updated_at: "2026-08-01T10:00:00.000Z",
    deleted_at: null,
    author_id: "a1",
    ...overrides,
  };
}

const stub = () => stubs.from!;

/** Ostatni łańcuch odczytu listy - ten z `range`, nie liczniki `head: true`. */
function listChain(): RecordedChain {
  const chains = stub()
    .chainsFor("pages")
    .filter((c) => c.has("range"));
  return chains[chains.length - 1];
}

/** Argumenty pierwszego `or(...)` w łańcuchu listy. */
const orArgs = () =>
  listChain()
    .calls.filter((c) => c.method === "or")
    .map((c) => c.args[0]);

async function setup(rows = h.rows, count = rows.length) {
  h.rows = rows;
  h.count = count;
  stub().setResponse("pages", (chain) => {
    if (!chain.has("range")) {
      return { data: null, error: null, count: chain.has("not") ? h.trashCount : h.viewCount };
    }
    if (h.listError) return { data: null, error: h.listError, count: null };
    return { data: h.rows, error: null, count: h.count };
  });
  const Component = (Route as AnyRoute).options.component as () => ReactNode;
  const view = render(<Component />, { wrapper });
  await waitFor(() =>
    expect(
      stub()
        .chainsFor("pages")
        .some((c) => c.has("range")),
    ).toBe(true),
  );
  return view;
}

const rowOf = (slug: string) => screen.getByText(`/${slug}`).closest("tr") as HTMLElement;

/**
 * Przełącza na widok kosza. Zakładki Radiksa aktywują się FOKUSEM (tryb
 * automatyczny), więc samo kliknięcie nie wystarcza.
 */
async function switchToTrash(): Promise<void> {
  const tab = screen.getByRole("tab", { name: /kosz|trash/i });
  fireEvent.mouseDown(tab);
  fireEvent.focus(tab);
  fireEvent.click(tab);
  await waitFor(() => expect(listChain().has("not")).toBe(true));
}

/**
 * Pasek operacji zbiorczych - pojawia się dopiero z niepustym zaznaczeniem.
 * Etykieta odmienia się przez liczbę („1 zaznaczony”, „2 zaznaczone”), więc
 * dopasowujemy rdzeń wyrazu.
 */
const bulkBar = () => screen.getByText(/^\d+ (zaznacz|selected)/i).closest("div") as HTMLElement;

/** Zaznacza wszystkie wiersze bieżącej strony wyników. */
const selectAll = () => fireEvent.click(screen.getByLabelText(/zaznacz wszystk|select all/i));
const confirmButton = () =>
  within(screen.getByRole("alertdialog")).getAllByRole("button").at(-1) as HTMLElement;

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  stub().reset();
  h.path = "/admin/pages";
  h.rows = [];
  h.count = 0;
  h.trashCount = 3;
  h.viewCount = 10;
  h.rpcCalls.length = 0;
  h.serverCalls.length = 0;
  h.savedSettings.length = 0;
  h.serverError = null;
  h.serverResult = null;
  h.rpcError = null;
  h.listError = null;
  h.authors = [{ id: "a1", display_name: "Anna Kowalska" }];
  h.saveSettingsError = null;
  h.settings = {
    homepage_mode: "latest_posts",
    homepage_page_slug: "",
    posts_per_page: 10,
    search_engine_visibility: true,
  };
  h.toast.success.mockReset();
  h.toast.error.mockReset();
  h.toast.warning.mockReset();
  h.toast.info.mockReset();
});

afterEach(async () => {
  vi.unstubAllEnvs();
  if (i18n.language !== "pl") await i18n.changeLanguage("pl");
});

describe("lista stron - warstwa trasy", () => {
  it("pod ADRESEM LISTY renderuje listę", async () => {
    await setup([page()]);
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.queryByTestId("podstrona")).toBeNull();
  });

  it("pod adresem PODSTRONY oddaje miejsce edytorowi", () => {
    // Lista owinięta wokół edytora dublowałaby pasek filtrów nad każdą stroną.
    h.path = "/admin/pages/o-nas";
    const Component = (Route as AnyRoute).options.component as () => ReactNode;
    render(<Component />, { wrapper });

    expect(screen.getByTestId("podstrona")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });
});

describe("lista stron - kształt zapytania", () => {
  it("KAŻDE zapytanie jest zawężone do tenanta", async () => {
    // Bez tego warunku lista przecieka między redakcjami.
    await setup([page()]);
    for (const chain of stub().chainsFor("pages")) {
      expect(chain.argsOf("eq")).toEqual(["tenant_id", "tenant-1"]);
    }
  });

  it("widok AKTYWNY pomija wiersze z kosza, kosz pomija żywe", async () => {
    await setup([page()]);
    expect(listChain().argsOf("is")).toEqual(["deleted_at", null]);

    await switchToTrash();
    expect(listChain().argsOf("not")).toEqual(["deleted_at", "is", null]);
  });

  it("kosz sortuje po dacie USUNIĘCIA, lista po dacie zmiany", async () => {
    // Sortowanie po `updated_at` w koszu miesza kolejność kasowania.
    await setup([page()]);
    expect(listChain().argsOf("order")?.[0]).toBe("updated_at");

    await switchToTrash();
    expect(listChain().argsOf("order")?.[0]).toBe("deleted_at");
  });

  it("pobiera DOKŁADNIE jedną stronę wyników", async () => {
    // Bez `range` pierwsze wejście ściąga całą tabelę stron.
    await setup([page()]);
    expect(listChain().argsOf("range")).toEqual([0, 49]);
  });

  it("odświeża zaplanowane publikacje przy każdym odczycie", async () => {
    // Bez tego kroku strona zaplanowana na wczoraj wisi jako „zaplanowana”
    // wszędzie tam, gdzie nie działa pg_cron.
    await setup([page()]);
    expect(h.rpcCalls).toContain("publish_due_pages");
  });
});

describe("lista stron - filtry", () => {
  const searchBox = () => screen.getByPlaceholderText(/Szukaj stron|Search pages/i);

  it("szukanie obejmuje OBA tytuły i slug", async () => {
    // Redaktor pamięta zwykle jedno z trzech.
    await setup([page()]);
    fireEvent.change(searchBox(), { target: { value: "raport" } });

    await waitFor(() => expect(orArgs().join(" ")).toContain("title_pl.ilike"));
    const or = orArgs().join(" ");
    expect(or).toContain("title_en.ilike");
    expect(or).toContain("slug.ilike");
  });

  it("ESCAPUJE znaki wieloznaczne we frazie", async () => {
    // Bez escapowania fraza „100%” dopasowuje wszystko.
    await setup([page()]);
    fireEvent.change(searchBox(), { target: { value: "100%_" } });

    await waitFor(() => expect(orArgs().join(" ")).toContain("100"));
    expect(orArgs().join(" ")).not.toContain("%100%_%");
  });

  it("filtr statusu działa TYLKO poza koszem", async () => {
    // W koszu status nie ma znaczenia - liczy się data usunięcia.
    await setup([page()]);
    await switchToTrash();

    expect(screen.queryByText(/Opublikowane|Published/)).toBeNull();
  });

  it("filtr TEMATU „inne” wyklucza wzorce pozostałych tematów", async () => {
    // Temat „inne” to negacja - pozytywne ILIKE dałoby pustą listę.
    await setup([page()]);
    fireEvent.click(screen.getByText("temat: inne"));

    await waitFor(() =>
      expect(listChain().calls.some((c) => c.method === "not" && c.args[1] === "ilike")).toBe(true),
    );
  });

  it("filtr TEMATU dopasowuje POZYTYWNIE, gdy temat ma własne wzorce", async () => {
    // Temat z katalogu filtruje przez ILIKE; negacja dałaby wszystko poza nim.
    await setup([page()]);
    fireEvent.click(screen.getByText("temat: wydarzenia"));

    await waitFor(() => expect(orArgs().join(" ")).toContain("slug.ilike"));
  });

  it.each([
    ["Komplet|PL \\+ EN", "complete"],
    ["Brak tłumaczenia|Missing", "missing_any"],
    ["Tylko PL|PL only", "pl_only"],
    ["Tylko EN|EN only", "en_only"],
  ])("filtr pokrycia %s zawęża zapytanie po stronie bazy", async (etykieta, _wariant) => {
    // Filtrowanie w przeglądarce po stronie wyników pokazałoby „brak wyników”
    // za każdym razem, gdy pasujące strony leżą poza bieżącą stroną paginacji.
    await setup([page()]);
    const langSelect = screen.getAllByRole("combobox")[1];
    fireEvent.keyDown(langSelect, { key: "ArrowDown" });
    fireEvent.click(screen.getByRole("option", { name: new RegExp(etykieta as string, "i") }));

    await waitFor(() => {
      const chain = listChain();
      expect(chain.has("not") || chain.has("or")).toBe(true);
    });
  });

  it("zmiana filtra WRACA na pierwszą stronę wyników", async () => {
    // Filtr nałożony na piątej stronie zostawiłby pusty ekran.
    await setup(
      Array.from({ length: 50 }, (_, i) => page({ id: `p${i}`, slug: `s${i}` })),
      120,
    );
    fireEvent.click(screen.getByRole("button", { name: /następn|next/i }));
    await waitFor(() => expect(listChain().argsOf("range")).toEqual([50, 99]));

    fireEvent.change(searchBox(), { target: { value: "cokolwiek" } });
    await waitFor(() => expect(listChain().argsOf("range")).toEqual([0, 49]));
  });
});

describe("lista stron - zaznaczanie", () => {
  const rows = () => [page(), page({ id: "p2", slug: "kontakt", title_pl: "Kontakt" })];

  it("zaznacz wszystko obejmuje CAŁĄ bieżącą stronę wyników", async () => {
    await setup(rows());
    selectAll();

    await waitFor(() => expect(bulkBar().textContent).toContain("2"));
  });

  it("ponowne kliknięcie ODZNACZA wszystko", async () => {
    await setup(rows());
    selectAll();
    await waitFor(() => expect(bulkBar()).toBeInTheDocument());

    selectAll();
    await waitFor(() => expect(screen.queryByText(/^\d+ (zaznacz|selected)/i)).toBeNull());
  });

  it("zaznaczenie POJEDYNCZEGO wiersza nie obejmuje pozostałych", async () => {
    await setup(rows());
    fireEvent.click(within(rowOf("o-nas")).getByLabelText(/^(Zaznacz|Select)$/i));

    await waitFor(() => expect(bulkBar().textContent).toContain("1"));
  });

  it("zmiana widoku CZYŚCI zaznaczenie", async () => {
    // Zaznaczenie przeniesione z listy do kosza celuje w nieistniejące wiersze.
    await setup(rows());
    selectAll();
    await waitFor(() => expect(bulkBar()).toBeInTheDocument());

    await switchToTrash();
    expect(screen.queryByText(/^\d+ (zaznacz|selected)/i)).toBeNull();
  });
});

describe("lista stron - operacje na wierszu", () => {
  it("przeniesienie do kosza PYTA, nazywając stronę", async () => {
    // Kosz jest odwracalny, ale i tak nie może być jednym kliknięciem.
    await setup([page()]);
    fireEvent.click(within(rowOf("o-nas")).getByTitle(/kosz|trash/i));

    expect(screen.getByRole("alertdialog").textContent).toContain("O nas");
  });

  it("potwierdzenie przenosi DOKŁADNIE tę stronę", async () => {
    await setup([page(), page({ id: "p2", slug: "kontakt", title_pl: "Kontakt" })]);
    fireEvent.click(within(rowOf("kontakt")).getByTitle(/kosz|trash/i));
    fireEvent.click(confirmButton());

    await waitFor(() => expect(h.serverCalls).toHaveLength(1));
    expect(h.serverCalls[0]).toMatchObject({ fn: "deletePage", payload: { data: { id: "p2" } } });
  });

  it("PORAŻKA przeniesienia mówi o powodzie", async () => {
    h.serverError = new Error("strona jest stroną główną");
    await setup([page()]);
    fireEvent.click(within(rowOf("o-nas")).getByTitle(/kosz|trash/i));
    fireEvent.click(confirmButton());

    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith("strona jest stroną główną"));
  });

  it("ustawienie strony głównej wymaga OPUBLIKOWANEJ strony", async () => {
    // Szkic ustawiony jako strona główna daje pustą witrynę.
    await setup([page({ status: "draft" })]);
    const home = within(rowOf("o-nas")).getAllByRole("button")[0];

    expect(home).toBeDisabled();
    expect(home.getAttribute("title")).toMatch(/opublikuj|publish/i);
  });

  it("ustawienie strony głównej zapisuje TRYB i slug", async () => {
    // Sam slug bez przełączenia trybu nie zmienia niczego na stronie.
    await setup([page()]);
    fireEvent.click(within(rowOf("o-nas")).getAllByRole("button")[0]);

    await waitFor(() => expect(h.savedSettings).toHaveLength(1));
    expect(h.savedSettings[0]).toMatchObject({
      homepage_mode: "static_page",
      homepage_page_slug: "o-nas",
    });
  });

  it("bieżąca strona główna jest OZNACZONA i nie da się jej ustawić ponownie", async () => {
    h.settings = { ...h.settings, homepage_mode: "static_page", homepage_page_slug: "o-nas" };
    await setup([page()]);

    expect(rowOf("o-nas").textContent).toMatch(/główn|home/i);
    expect(within(rowOf("o-nas")).getAllByRole("button")[0]).toBeDisabled();
  });

  it("PORAŻKA ustawienia strony głównej nie udaje sukcesu", async () => {
    h.saveSettingsError = new Error("brak uprawnień");
    await setup([page()]);
    fireEvent.click(within(rowOf("o-nas")).getAllByRole("button")[0]);

    await waitFor(() => expect(h.toast.error).toHaveBeenCalled());
    expect(h.toast.success).not.toHaveBeenCalled();
  });

  it("odnośnik edycji niesie JĘZYK widoku", async () => {
    // Bez tego edytor otwiera się po polsku, gdy lista pokazuje angielski.
    await setup([page()]);
    const link = within(rowOf("o-nas")).getAllByRole("link")[0];

    expect(link.getAttribute("href")).toContain("/admin/pages/o-nas");
    expect(link.getAttribute("data-search-lang")).toBe("pl");
  });
});

describe("lista stron - kosz", () => {
  async function openTrash(rows: Record<string, unknown>[]) {
    await setup(rows);
    await switchToTrash();
  }

  const trashed = (o: Record<string, unknown> = {}) =>
    page({ deleted_at: "2026-08-05T09:00:00.000Z", ...o });

  it("liczba w zakładce pochodzi z osobnego licznika", async () => {
    // Licznik z bieżącej strony wyników pokazywałby maksymalnie rozmiar strony.
    h.trashCount = 42;
    await setup([page()]);

    await waitFor(() =>
      expect(screen.getByRole("tab", { name: /kosz|trash/i }).textContent).toContain("42"),
    );
  });

  it("zakres dat zamyka się na KOŃCU wybranego dnia", async () => {
    // Zwykłe `lte` na północy gubi wszystko skasowane tego dnia po 00:00.
    // Strefa przypięta: granice to LOKALNA doba (przypadek strefy z
    // przesunięciem - niżej), więc „23:59:59” w zapisie ISO zachodzi w UTC.
    vi.stubEnv("TZ", "UTC");
    await openTrash([trashed()]);
    const [odPola, doPola] = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[type="date"]'),
    );
    fireEvent.change(odPola, { target: { value: "2026-08-05" } });
    await waitFor(() => expect(listChain().has("gte")).toBe(true));

    fireEvent.change(doPola, { target: { value: "2026-08-05" } });
    await waitFor(() => expect(listChain().has("lte")).toBe(true));
    // Koniec dnia, nie północ: `lte` na 00:00 gubi wszystko skasowane później.
    expect(String(listChain().argsOf("lte")?.[1])).toContain("23:59:59");
  });

  it("przywrócenie PYTA i przywraca wskazany wiersz", async () => {
    await openTrash([trashed()]);
    fireEvent.click(within(rowOf("o-nas")).getByTitle(/przywróć|restore/i));
    fireEvent.click(confirmButton());

    await waitFor(() => expect(h.serverCalls).toHaveLength(1));
    expect(h.serverCalls[0]).toMatchObject({
      fn: "restorePages",
      payload: { data: { ids: ["p1"] } },
    });
  });

  it("trwałe usunięcie ostrzega, że NIE DA SIĘ go cofnąć", async () => {
    // To jedyna operacja na tym ekranie bez drogi powrotnej.
    await openTrash([trashed()]);
    fireEvent.click(within(rowOf("o-nas")).getByTitle(/trwale|purge/i));

    expect(screen.getByRole("alertdialog").textContent).toMatch(
      /nie można cofnąć|cannot be undone/i,
    );
  });

  it("trwałe usunięcie idzie przez WŁASNĄ akcję, nie przez kosz", async () => {
    await openTrash([trashed()]);
    fireEvent.click(within(rowOf("o-nas")).getByTitle(/trwale|purge/i));
    fireEvent.click(confirmButton());

    await waitFor(() => expect(h.serverCalls).toHaveLength(1));
    expect(h.serverCalls[0].fn).toBe("purgePages");
  });

  it("zbiorcze trwałe usunięcie idzie przez własną akcję", async () => {
    // Ostatnia droga bez powrotu na tym ekranie - i jedyna, która musi trafić
    // w `purgePages`, a nie w kosz.
    await openTrash([trashed(), trashed({ id: "p2", slug: "kontakt" })]);
    selectAll();
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: /trwale|purge/i })).not.toHaveLength(0),
    );
    fireEvent.click(screen.getAllByRole("button", { name: /trwale|purge/i })[0]);
    fireEvent.click(confirmButton());

    await waitFor(() => expect(h.serverCalls).toHaveLength(1));
    expect(h.serverCalls[0]).toMatchObject({
      fn: "purgePages",
      payload: { data: { ids: ["p1", "p2"] } },
    });
  });

  it("zbiorcze przywracanie i usuwanie obejmuje CAŁE zaznaczenie", async () => {
    await openTrash([trashed(), trashed({ id: "p2", slug: "kontakt", title_pl: "Kontakt" })]);
    selectAll();
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: /przywróć|restore/i })).not.toHaveLength(0),
    );

    fireEvent.click(screen.getAllByRole("button", { name: /przywróć|restore/i })[0]);
    fireEvent.click(confirmButton());
    await waitFor(() => expect(h.serverCalls).toHaveLength(1));
    expect(h.serverCalls[0].payload).toMatchObject({ data: { ids: ["p1", "p2"] } });
  });
});

describe("lista stron - operacje zbiorcze poza koszem", () => {
  it("zbiorcze przeniesienie do kosza podaje LICZBĘ w pytaniu", async () => {
    // Bez liczby redaktor nie wie, ile stron właśnie zniknie.
    await setup([page(), page({ id: "p2", slug: "kontakt" })]);
    selectAll();
    await waitFor(() => expect(bulkBar().textContent).toContain("2"));
    fireEvent.click(
      within(bulkBar()).getByRole("button", { name: /usuń zaznaczone|delete selected/i }),
    );

    expect(screen.getByRole("alertdialog").textContent).toContain("2");
  });

  it("potwierdzone przeniesienie zbiorcze niesie WSZYSTKIE zaznaczone identyfikatory", async () => {
    // Droga jest dwustopniowa: pasek pyta o same elementy, trasa - o kosz.
    // Zgubienie identyfikatorów w którymkolwiek kroku kasuje nie te strony.
    await setup([page(), page({ id: "p2", slug: "kontakt" })]);
    selectAll();
    await waitFor(() => expect(bulkBar().textContent).toContain("2"));
    fireEvent.click(
      within(bulkBar()).getByRole("button", { name: /usuń zaznaczone|delete selected/i }),
    );
    fireEvent.click(confirmButton());
    await waitFor(() => expect(screen.getByRole("alertdialog")).toBeInTheDocument());
    fireEvent.click(confirmButton());

    await waitFor(() => expect(h.serverCalls).toHaveLength(1));
    expect(h.serverCalls[0]).toMatchObject({
      fn: "bulkDeletePages",
      payload: { data: { ids: ["p1", "p2"] } },
    });
  });

  it("zbiorcza zmiana statusu wysyła WYBRANY status i czyści zaznaczenie", async () => {
    // Status zastosowany do pustego zaznaczenia to zapytanie bez skutku;
    // niewyczyszczone zaznaczenie po zmianie kusi do powtórzenia operacji.
    await setup([page(), page({ id: "p2", slug: "kontakt" })]);
    selectAll();
    await waitFor(() => expect(bulkBar()).toBeInTheDocument());
    fireEvent.keyDown(within(bulkBar()).getByRole("combobox"), { key: "ArrowDown" });
    fireEvent.click(screen.getByRole("option", { name: /^(Szkic|Draft)$/ }));
    fireEvent.click(within(bulkBar()).getByRole("button", { name: /zastosuj|apply/i }));

    await waitFor(() => expect(h.serverCalls).toHaveLength(1));
    expect(h.serverCalls[0]).toMatchObject({
      fn: "bulkUpdatePages",
      payload: { data: { ids: ["p1", "p2"], status: "draft" } },
    });
    await waitFor(() => expect(screen.queryByText(/^\d+ (zaznacz|selected)/i)).toBeNull());
  });

  it("PORAŻKA zbiorczej zmiany statusu mówi o powodzie", async () => {
    h.serverError = new Error("brak uprawnień do publikacji");
    await setup([page()]);
    selectAll();
    await waitFor(() => expect(bulkBar()).toBeInTheDocument());
    fireEvent.keyDown(within(bulkBar()).getByRole("combobox"), { key: "ArrowDown" });
    fireEvent.click(screen.getByRole("option", { name: /^(Szkic|Draft)$/ }));
    fireEvent.click(within(bulkBar()).getByRole("button", { name: /zastosuj|apply/i }));

    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith("brak uprawnień do publikacji"));
  });

  it("zbiorcza zmiana statusu POMIJA status recenzji", async () => {
    // Strony nie mają cyklu recenzji - to pole dotyczy wyłącznie wpisów.
    await setup([page()]);
    selectAll();
    await waitFor(() => expect(bulkBar()).toBeInTheDocument());
    const opcje = within(bulkBar()).getByRole("combobox");
    fireEvent.keyDown(opcje, { key: "ArrowDown" });

    expect(screen.queryByRole("option", { name: /recenzj|review/i })).toBeNull();
    expect(h.serverCalls).toHaveLength(0);
  });
});

describe("lista stron - stany puste", () => {
  it("pusty widok mówi „brak stron”", async () => {
    h.viewCount = 0;
    await setup([], 0);
    expect(screen.getByText(/Brak stron|No pages/i)).toBeInTheDocument();
  });

  it("odfiltrowany widok mówi „brak wyników”, a nie „brak stron”", async () => {
    // To dwie różne informacje: pusty dział kontra zbyt wąski filtr.
    h.viewCount = 12;
    await setup([], 0);
    expect(screen.getByText(/Brak wyników|No results/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Dopisane 16.10.2026 - defekty 4-9 z nagłówka i gałęzie, których dotąd nic
// nie sprawdzało (błędy każdej operacji, wynik częściowy, język widoku).
// ---------------------------------------------------------------------------

const trashedPage = (o: Record<string, unknown> = {}) =>
  page({ deleted_at: "2026-08-05T09:00:00.000Z", ...o });

async function openTrashView(rows: Record<string, unknown>[]) {
  await setup(rows);
  await switchToTrash();
}

/** Pasek zaznaczenia w KOSZU („Zaznaczono: N”) - inny niż pasek listy aktywnej. */
const trashBar = () =>
  screen.getByText(/^(Zaznaczono|Selected): \d+$/).closest("div") as HTMLElement;
/** Sam licznik paska kosza, bez etykiet przycisków obok. */
const trashSelection = () => screen.getByText(/^(Zaznaczono|Selected): \d+$/).textContent;

/** Wybiera pozycję z droplisty Radiksa. */
function pick(combobox: HTMLElement, option: RegExp) {
  fireEvent.keyDown(combobox, { key: "ArrowDown" });
  fireEvent.click(screen.getByRole("option", { name: option }));
}

/** Argumenty ogniwa `eq` dla danej kolumny w łańcuchu listy. */
const eqOf = (column: string) =>
  listChain()
    .calls.filter((c) => c.method === "eq" && c.args[0] === column)
    .map((c) => c.args[1]);

describe("lista stron - metadane karty", () => {
  it("head() nazywa SEKCJĘ i trzyma panel poza indeksem", () => {
    // AGENTS.md: prywatne ekrany admina noszą tytuł sekcji, nie ogólny tytuł panelu.
    expect(routeHead(Route as AnyRoute).meta).toEqual(
      expect.arrayContaining([
        { title: "Pages | New European Strategies" },
        { name: "robots", content: "noindex, nofollow" },
      ]),
    );
  });
});

describe("lista stron - błąd odczytu", () => {
  it("BŁĄD zapytania listy jest komunikatem, a nie „brakiem stron”", async () => {
    // Przed naprawą: „Brak wyników dla filtrów” - redakcja szukała winy w filtrach.
    h.listError = pgError("permission denied for table pages", "42501");
    await setup([]);

    expect(await screen.findByRole("alert")).toHaveTextContent("permission denied for table pages");
    expect(screen.queryByText(/Brak stron|Brak wyników/i)).toBeNull();
  });

  it("awaria pomocniczego RPC publikacji NIE blokuje listy", async () => {
    // RPC to tylko „tyknięcie” zegara publikacji - lista ma wyjść i bez niego.
    h.rpcError = new Error("function publish_due_pages() does not exist");
    await setup([page()]);

    expect(await screen.findByText("/o-nas")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("odpowiedź BEZ licznika i wierszy liczy się jako zero, a nie wywraca listy", async () => {
    stub().setResponse("pages", () => ({ data: null, error: null, count: null }));
    const Component = (Route as AnyRoute).options.component as () => ReactNode;
    render(<Component />, { wrapper });

    expect(await screen.findByText(/Brak stron/)).toBeInTheDocument();
    expect(screen.getByText(/^0 stron$/)).toBeInTheDocument();
  });
});

describe("lista stron - zakres dat kosza w strefie redakcji", () => {
  it("„od” i „do” to LOKALNA doba, nie doba UTC", async () => {
    // Kolumna „Usunięto” pokazuje czas lokalny - zakres musi liczyć ten sam.
    // W Warszawie (UTC+2 latem) 5.08 trwa od 4.08 22:00Z do 5.08 21:59:59.999Z.
    vi.stubEnv("TZ", "Europe/Warsaw");
    await openTrashView([trashedPage()]);
    const [odPola, doPola] = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[type="date"]'),
    );

    fireEvent.change(odPola, { target: { value: "2026-08-05" } });
    await waitFor(() =>
      expect(listChain().argsOf("gte")).toEqual(["deleted_at", "2026-08-04T22:00:00.000Z"]),
    );
    fireEvent.change(doPola, { target: { value: "2026-08-05" } });
    await waitFor(() =>
      expect(listChain().argsOf("lte")).toEqual(["deleted_at", "2026-08-05T21:59:59.999Z"]),
    );
  });
});

describe("lista stron - zaznaczenie po operacji na wierszu", () => {
  const kontakt = () => trashedPage({ id: "p2", slug: "kontakt", title_pl: "Kontakt" });

  it("przywrócony wiersz WYPADA z zaznaczenia - trwałe usunięcie go nie dotyka", async () => {
    // Droga do utraty danych: zaznacz dwie, przywróć jedną, „Usuń trwale”
    // zaznaczone - stary kod kasował też stronę, która wróciła na listę.
    await openTrashView([trashedPage(), kontakt()]);
    selectAll();
    await waitFor(() => expect(trashSelection()).toBe("Zaznaczono: 2"));

    h.rows = [kontakt()];
    h.count = 1;
    fireEvent.click(within(rowOf("o-nas")).getByTitle(/przywróć|restore/i));
    fireEvent.click(confirmButton());
    await waitFor(() => expect(trashSelection()).toBe("Zaznaczono: 1"));

    fireEvent.click(within(trashBar()).getByRole("button", { name: /trwale|purge/i }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("1 stron");
    fireEvent.click(confirmButton());

    await waitFor(() => expect(h.serverCalls).toHaveLength(2));
    expect(h.serverCalls[1]).toMatchObject({
      fn: "purgePages",
      payload: { data: { ids: ["p2"] } },
    });
  });

  it("trwale usunięty wiersz WYPADA z zaznaczenia", async () => {
    await openTrashView([trashedPage(), kontakt()]);
    selectAll();
    await waitFor(() => expect(trashSelection()).toBe("Zaznaczono: 2"));

    h.rows = [kontakt()];
    fireEvent.click(within(rowOf("o-nas")).getByTitle(/trwale|purge/i));
    fireEvent.click(confirmButton());

    await waitFor(() => expect(trashSelection()).toBe("Zaznaczono: 1"));
    expect(h.toast.success).toHaveBeenCalledWith(realT()("admin.bulkResult.purgedOne"));
  });

  it.each([
    ["trwałe usunięcie", /trwale|purge/i],
    ["przywrócenie", /przywróć|restore/i],
  ])("ODRZUCONE %s zostawia wiersz w zaznaczeniu i nie udaje sukcesu", async (_op, title) => {
    // RLS odfiltrował cel: 0 wierszy zmienionych. Wiersz nadal leży w koszu,
    // więc zaznaczenie ma go dalej obejmować.
    h.serverResult = () => ({ ok: true, count: 0, requested: 1 });
    await openTrashView([trashedPage(), kontakt()]);
    selectAll();
    await waitFor(() => expect(trashSelection()).toBe("Zaznaczono: 2"));

    fireEvent.click(within(rowOf("o-nas")).getByTitle(title));
    fireEvent.click(confirmButton());

    await waitFor(() =>
      expect(h.toast.error).toHaveBeenCalledWith(realT()("admin.bulkResult.none")),
    );
    expect(h.toast.success).not.toHaveBeenCalled();
    expect(trashSelection()).toBe("Zaznaczono: 2");
  });

  it("wiersz przeniesiony do kosza WYPADA z zaznaczenia - zmiana statusu go nie dotyka", async () => {
    const drugi = page({ id: "p2", slug: "kontakt" });
    await setup([page(), drugi]);
    selectAll();
    await waitFor(() => expect(bulkBar().textContent).toContain("2"));

    h.rows = [drugi];
    fireEvent.click(within(rowOf("o-nas")).getByTitle(/kosz|trash/i));
    fireEvent.click(confirmButton());
    await waitFor(() => expect(bulkBar().textContent).toMatch(/^1 /));
    expect(h.toast.success).toHaveBeenCalledWith(realT()("admin.bulkResult.trashedOne"));

    pick(within(bulkBar()).getByRole("combobox"), /^(Szkic|Draft)$/);
    fireEvent.click(within(bulkBar()).getByRole("button", { name: /zastosuj|apply/i }));

    await waitFor(() => expect(h.serverCalls).toHaveLength(2));
    expect(h.serverCalls[1]).toMatchObject({
      fn: "bulkUpdatePages",
      payload: { data: { ids: ["p2"], status: "draft" } },
    });
  });

  it("ponowne kliknięcie wiersza ODZNACZA go", async () => {
    await setup([page(), page({ id: "p2", slug: "kontakt" })]);
    const box = () => within(rowOf("o-nas")).getByLabelText(/^(Zaznacz|Select)$/i);
    fireEvent.click(box());
    await waitFor(() => expect(bulkBar()).toBeInTheDocument());

    fireEvent.click(box());
    await waitFor(() => expect(screen.queryByText(/^\d+ (zaznacz|selected)/i)).toBeNull());
  });
});

describe("lista stron - strona poza zbiorem wyników", () => {
  it("po skasowaniu jedynego wiersza ostatniej strony lista WRACA na ostatnią istniejącą", async () => {
    // 51 stron po 50: strona 2 ma jeden wiersz. Po jego skasowaniu zbiór ma 50,
    // a stary kod dalej pytał o wiersze 50-99 - pusta tabela, „dalej” wyłączone.
    let all = Array.from({ length: 51 }, (_, i) =>
      page({ id: `p${i}`, slug: `s${i}`, title_pl: `Strona ${i}` }),
    );
    await setup(all.slice(0, 50), 51);
    stub().setResponse("pages", (chain) => {
      if (!chain.has("range")) {
        return { data: null, error: null, count: chain.has("not") ? 0 : all.length };
      }
      const [from, to] = chain.argsOf("range") as [number, number];
      return { data: all.slice(from, to + 1), error: null, count: all.length };
    });
    fireEvent.click(screen.getByRole("button", { name: /następn|next/i }));
    expect(await screen.findByText("/s50")).toBeInTheDocument();

    all = all.slice(0, 50);
    fireEvent.click(within(rowOf("s50")).getByTitle(/kosz|trash/i));
    fireEvent.click(confirmButton());

    await waitFor(() => expect(listChain().argsOf("range")).toEqual([0, 49]));
    expect(await screen.findByText("/s0")).toBeInTheDocument();
  });
});

describe("lista stron - liczniki", () => {
  it("operacja na liście unieważnia LICZNIKI zakładek tematów", async () => {
    // Zakładki tematów mają własny klucz; bez unieważnienia „Wszystkie (10)”
    // zostaje po przeniesieniu strony do kosza.
    await setup([page()]);
    const topicKey = ["admin-pages-topic-slugs", "tenant-1", "active"];
    queryClient.setQueryData(topicKey, ["o-nas"]);

    fireEvent.click(within(rowOf("o-nas")).getByTitle(/kosz|trash/i));
    fireEvent.click(confirmButton());

    await waitFor(() => expect(queryClient.getQueryState(topicKey)?.isInvalidated).toBe(true));
  });

  it("pusty kosz mówi „Kosz jest pusty” i NIE dubluje zapytania liczącego", async () => {
    // Licznik widoku w koszu = licznik zakładki (to samo zapytanie). Drugi,
    // identyczny HEAD przy każdym wejściu do kosza był czystym kosztem.
    h.trashCount = 0;
    await openTrashView([]);

    expect(await screen.findByText(/Kosz jest pusty/)).toBeInTheDocument();
    const trashCounts = stub()
      .chainsFor("pages")
      .filter((c) => !c.has("range") && c.has("not"));
    expect(trashCounts).toHaveLength(1);
  });

  it("awaria zapytań LICZĄCYCH nie wywraca listy - zakładka kosza jest po prostu bez liczby", async () => {
    await setup([page()]);
    stub().setResponse("pages", (chain) =>
      chain.has("range")
        ? { data: h.rows, error: null, count: h.count }
        : { data: null, error: pgError("statement timeout", "57014"), count: null },
    );
    await queryClient.resetQueries({ queryKey: ["admin-pages-trash-count"] });
    await queryClient.resetQueries({ queryKey: ["admin-pages-view-count"] });

    await waitFor(() =>
      expect(queryClient.getQueryState(["admin-pages-trash-count", "tenant-1"])?.status).toBe(
        "error",
      ),
    );
    expect(screen.getByRole("tab", { name: /kosz/i }).textContent).toBe("Kosz");
    expect(screen.getByText("/o-nas")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("kosz z wierszami, które wyciął filtr, mówi „brak wyników”, a nie „kosz pusty”", async () => {
    h.trashCount = 4;
    await openTrashView([]);

    expect(await screen.findByText(/Brak wyników dla filtrów/)).toBeInTheDocument();
    expect(screen.queryByText(/Kosz jest pusty/)).toBeNull();
  });
});

describe("lista stron - strona główna", () => {
  it("bez WCZYTANYCH ustawień czytania przycisk czeka i niczego nie zapisuje", async () => {
    // Stary kod zapisywał wartości domyślne: posts_per_page = 10 i widoczność
    // dla wyszukiwarek = true, nadpisując ustawienia witryny celowo ukrytej.
    h.settings = undefined;
    await setup([page()]);
    const home = within(rowOf("o-nas")).getAllByRole("button")[0];

    expect(home).toBeDisabled();
    fireEvent.click(home);
    expect(h.savedSettings).toHaveLength(0);
  });

  it("zapis zaczyna od WCZYTANEGO stanu - pozostałe ustawienia czytania zostają", async () => {
    h.settings = {
      homepage_mode: "latest_posts",
      homepage_page_slug: "",
      posts_per_page: 25,
      search_engine_visibility: false,
    };
    await setup([page()]);
    fireEvent.click(within(rowOf("o-nas")).getAllByRole("button")[0]);

    await waitFor(() => expect(h.savedSettings).toHaveLength(1));
    expect(h.savedSettings[0]).toEqual({
      homepage_mode: "static_page",
      homepage_page_slug: "o-nas",
      posts_per_page: 25,
      search_engine_visibility: false,
    });
    expect(h.toast.success).toHaveBeenCalledWith('Ustawiono "O nas" jako stronę główną');
  });

  it("strona bez tytułu w języku widoku jest nazwana w komunikacie SLUGIEM", async () => {
    await setup([page({ title_pl: "" })]);
    fireEvent.click(within(rowOf("o-nas")).getAllByRole("button")[0]);

    await waitFor(() =>
      expect(h.toast.success).toHaveBeenCalledWith('Ustawiono "o-nas" jako stronę główną'),
    );
  });
});

describe("lista stron - uczciwy wynik operacji zbiorczych", () => {
  async function applyBulkStatus(label: RegExp) {
    await setup([page(), page({ id: "p2", slug: "kontakt" })]);
    selectAll();
    await waitFor(() => expect(bulkBar()).toBeInTheDocument());
    pick(within(bulkBar()).getByRole("combobox"), label);
    fireEvent.click(within(bulkBar()).getByRole("button", { name: /zastosuj|apply/i }));
  }

  it("CZĘŚCIOWY wynik ostrzega, ile naprawdę przeszło", async () => {
    h.serverResult = (_fn, payload) => ({
      ok: true,
      count: 1,
      requested: payload.data.ids?.length ?? 0,
    });
    await applyBulkStatus(/^(Szkic|Draft)$/);

    await waitFor(() =>
      expect(h.toast.warning).toHaveBeenCalledWith(
        realT()("admin.bulkResult.partial", { count: 1, requested: 2 }),
      ),
    );
    expect(h.toast.success).not.toHaveBeenCalled();
  });

  it("publikacja stron testowych informuje o WYMUSZONYM noindex", async () => {
    // Strona testowa publikuje się wyłącznie z noindex - redakcja ma to wiedzieć.
    h.serverResult = () => ({ ok: true, count: 2, requested: 2, noindexForced: 1 });
    await applyBulkStatus(/^(Opublikowany|Published)$/);

    await waitFor(() =>
      expect(h.toast.info).toHaveBeenCalledWith(
        realT()("admin.bulkResult.testNoindexForced", { count: 1 }),
      ),
    );
    expect(h.serverCalls[0]).toMatchObject({ payload: { data: { status: "published" } } });
  });
});

describe("lista stron - porażka KAŻDEJ operacji podaje powód i niczego nie udaje", () => {
  type Op = { trash: boolean; bulk: boolean; run: () => Promise<void> };
  const bulkTrashBar = async () => {
    selectAll();
    await waitFor(() => expect(trashBar()).toBeInTheDocument());
    return trashBar();
  };
  const ops: Record<string, Op> = {
    "przeniesienie do kosza": {
      trash: false,
      bulk: false,
      run: async () => {
        fireEvent.click(within(rowOf("o-nas")).getByTitle(/kosz|trash/i));
        fireEvent.click(confirmButton());
      },
    },
    "zbiorcze przeniesienie do kosza": {
      trash: false,
      bulk: true,
      run: async () => {
        selectAll();
        await waitFor(() => expect(bulkBar()).toBeInTheDocument());
        fireEvent.click(
          within(bulkBar()).getByRole("button", { name: /usuń zaznaczone|delete selected/i }),
        );
        fireEvent.click(confirmButton());
        await waitFor(() =>
          expect(screen.getByRole("alertdialog")).toHaveTextContent(/kosza 2 stron/),
        );
        fireEvent.click(confirmButton());
      },
    },
    "zbiorcza zmiana statusu": {
      trash: false,
      bulk: true,
      run: async () => {
        selectAll();
        await waitFor(() => expect(bulkBar()).toBeInTheDocument());
        pick(within(bulkBar()).getByRole("combobox"), /^(Zarchiwizowany|Archived)$/);
        fireEvent.click(within(bulkBar()).getByRole("button", { name: /zastosuj|apply/i }));
      },
    },
    przywrócenie: {
      trash: true,
      bulk: false,
      run: async () => {
        fireEvent.click(within(rowOf("o-nas")).getByTitle(/przywróć|restore/i));
        fireEvent.click(confirmButton());
      },
    },
    "trwałe usunięcie": {
      trash: true,
      bulk: false,
      run: async () => {
        fireEvent.click(within(rowOf("o-nas")).getByTitle(/trwale|purge/i));
        fireEvent.click(confirmButton());
      },
    },
    "zbiorcze przywrócenie": {
      trash: true,
      bulk: true,
      run: async () => {
        const bar = await bulkTrashBar();
        fireEvent.click(within(bar).getByRole("button", { name: /przywróć|restore/i }));
        fireEvent.click(confirmButton());
      },
    },
    "zbiorcze trwałe usunięcie": {
      trash: true,
      bulk: true,
      run: async () => {
        const bar = await bulkTrashBar();
        fireEvent.click(within(bar).getByRole("button", { name: /trwale|purge/i }));
        fireEvent.click(confirmButton());
      },
    },
  };

  const cases = Object.keys(ops).flatMap((name) => [
    [name, "Error", new Error("brak uprawnień")] as const,
    // Funkcja serwerowa potrafi odrzucić czymś, co nie jest `Error`.
    [name, "napis", "brak uprawnień"] as const,
  ]);

  it.each(cases)("%s - odrzucenie (%s) trafia do toastu", async (name, _kind, reason) => {
    const op = ops[name];
    const rows = op.trash
      ? [trashedPage(), trashedPage({ id: "p2", slug: "kontakt" })]
      : [page(), page({ id: "p2", slug: "kontakt" })];
    if (op.trash) await openTrashView(rows);
    else await setup(rows);
    h.serverError = reason;

    await op.run();

    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith("brak uprawnień"));
    expect(h.toast.success).not.toHaveBeenCalled();
    expect(h.serverCalls).toHaveLength(0);
    // Zaznaczenie zostaje - redakcja może ponowić tę samą operację.
    if (op.bulk) {
      if (op.trash) expect(trashSelection()).toBe("Zaznaczono: 2");
      else expect(bulkBar().textContent).toMatch(/^2 /);
    }
  });
});

describe("lista stron - język widoku i tytuły", () => {
  it("w panelu ANGIELSKIM lista pokazuje tytuły EN i otwiera edytor po angielsku", async () => {
    await i18n.changeLanguage("en");
    await setup([page()]);
    const row = rowOf("o-nas");

    expect(within(row).getByText("About us")).toBeInTheDocument();
    expect(within(row).getAllByRole("link")[0].getAttribute("data-search-lang")).toBe("en");
  });

  it("filtr „Angielski (EN)” zawęża zapytanie i przełącza tytuły oraz edytor na EN", async () => {
    await setup([page()]);
    pick(screen.getAllByRole("combobox")[1], /^Angielski \(EN\)$/);

    await waitFor(() => expect(listChain().argsOf("neq")).toEqual(["title_en", ""]));
    expect(listChain().argsOf("not")).toEqual(["title_en", "is", null]);
    await waitFor(() => expect(within(rowOf("o-nas")).getByText("About us")).toBeInTheDocument());
    expect(within(rowOf("o-nas")).getAllByRole("link")[0].getAttribute("data-search-lang")).toBe(
      "en",
    );
  });

  it("filtr „Polski (PL)” w panelu angielskim wraca do tytułów i edytora PL", async () => {
    await i18n.changeLanguage("en");
    await setup([page()]);
    pick(screen.getAllByRole("combobox")[1], /^Polish \(PL\)$/);

    await waitFor(() => expect(listChain().argsOf("neq")).toEqual(["title_pl", ""]));
    await waitFor(() => expect(within(rowOf("o-nas")).getByText("O nas")).toBeInTheDocument());
    expect(within(rowOf("o-nas")).getAllByRole("link")[0].getAttribute("data-search-lang")).toBe(
      "pl",
    );
  });

  it("brak tytułu w języku widoku → tytuł drugiego języka; bez obu → „bez tytułu”", async () => {
    await setup([
      page({ id: "p1", slug: "only-en", title_pl: null, title_en: "Only English" }),
      page({ id: "p2", slug: "bez-nazwy", title_pl: "", title_en: null }),
    ]);

    expect(within(rowOf("only-en")).getByText("Only English")).toBeInTheDocument();
    expect(rowOf("bez-nazwy").textContent).toContain("- bez tytułu -");
    // Pytanie o kosz nazywa stronę jednoznacznie - slugiem, gdy brak tytułu PL.
    fireEvent.click(within(rowOf("only-en")).getByTitle(/kosz|trash/i));
    expect(screen.getByRole("alertdialog")).toHaveTextContent('"only-en"');
  });

  it("w KOSZU obowiązuje ta sama kolejność tytułów", async () => {
    await openTrashView([
      trashedPage({ id: "p1", slug: "only-en", title_pl: null, title_en: "Only English" }),
      trashedPage({ id: "p2", slug: "bez-nazwy", title_pl: "", title_en: "" }),
    ]);

    expect(within(rowOf("only-en")).getByText("Only English")).toBeInTheDocument();
    expect(rowOf("bez-nazwy").textContent).toContain("- bez tytułu -");
  });

  it("w panelu angielskim KOSZ pokazuje tytuły EN i tak nazywa stronę w pytaniu", async () => {
    await i18n.changeLanguage("en");
    await openTrashView([
      trashedPage(),
      trashedPage({ id: "p2", slug: "tylko-pl", title_pl: "Tylko PL", title_en: null }),
    ]);

    expect(within(rowOf("o-nas")).getByText("About us")).toBeInTheDocument();
    expect(within(rowOf("tylko-pl")).getByText("Tylko PL")).toBeInTheDocument();
    fireEvent.click(within(rowOf("o-nas")).getByTitle(/restore/i));
    expect(screen.getByRole("alertdialog")).toHaveTextContent('"About us"');
  });

  it("w panelu angielskim strona główna zapisuje slug, a komunikat nazywa tytuł EN", async () => {
    await i18n.changeLanguage("en");
    await setup([page()]);
    fireEvent.click(within(rowOf("o-nas")).getAllByRole("button")[0]);

    await waitFor(() => expect(h.savedSettings).toHaveLength(1));
    expect(h.savedSettings[0]).toMatchObject({ homepage_page_slug: "o-nas" });
    expect(String(h.toast.success.mock.calls[0]?.[0])).toContain('"About us"');
  });

  it("w panelu angielskim brak tytułu EN pokazuje tytuł PL", async () => {
    await i18n.changeLanguage("en");
    await setup([page({ title_en: null })]);

    expect(within(rowOf("o-nas")).getByText("O nas")).toBeInTheDocument();
  });
});

describe("lista stron - kolumny i filtry wiersza", () => {
  it("strona renderowana Z KODU ma plakietkę - w koszu już nie", async () => {
    // Plakietka ostrzega, że builder nie zmieni treści tej strony.
    await setup([page({ slug: "club", title_pl: "Kluby" })]);
    expect(within(rowOf("club")).getByText("Z kodu")).toBeInTheDocument();

    await switchToTrash();
    expect(screen.queryByText("Z kodu")).toBeNull();
  });

  it("autor spoza dzierżawy i strona bez autora pokazują kreskę", async () => {
    await setup([
      page(),
      page({ id: "p2", slug: "kontakt", author_id: null }),
      page({ id: "p3", slug: "obcy", author_id: "nieznany" }),
    ]);

    expect(within(rowOf("o-nas")).getByTitle("Anna Kowalska")).toBeInTheDocument();
    expect(within(rowOf("kontakt")).getByTitle("-")).toHaveTextContent("-");
    expect(within(rowOf("obcy")).getByTitle("-")).toHaveTextContent("-");
  });

  it("lista działa, zanim wczytają się autorzy", async () => {
    h.authors = undefined;
    await setup([page()]);

    expect(within(rowOf("o-nas")).getByTitle("-")).toBeInTheDocument();
  });

  it("filtr STATUSU poza koszem trafia do zapytania", async () => {
    await setup([page()]);
    pick(screen.getAllByRole("combobox")[0], /^Szkic$/);

    await waitFor(() => expect(eqOf("status")).toEqual(["draft"]));
  });

  it("filtr AUTORA trafia do zapytania", async () => {
    await setup([page()]);
    pick(screen.getAllByRole("combobox")[2], /^Anna Kowalska$/);

    await waitFor(() => expect(eqOf("author_id")).toEqual(["a1"]));
  });
});
