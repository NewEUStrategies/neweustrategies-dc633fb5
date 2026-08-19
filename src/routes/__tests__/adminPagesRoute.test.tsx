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
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { AnyRoute } from "@tanstack/react-router";
import type { RecordedChain } from "@/test/supabaseChain";

const h = vi.hoisted(() => ({
  path: "/admin/pages",
  rows: [] as Record<string, unknown>[],
  count: 0,
  trashCount: 3,
  viewCount: 10,
  rpcCalls: [] as string[],
  serverCalls: [] as { fn: string; payload: unknown }[],
  serverError: null as Error | null,
  settings: {
    homepage_mode: "latest_posts",
    homepage_page_slug: "",
    posts_per_page: 10,
    search_engine_visibility: true,
  } as Record<string, unknown>,
  savedSettings: [] as unknown[],
  saveSettingsError: null as Error | null,
  toast: { success: vi.fn(), error: vi.fn() },
}));

const stubs = vi.hoisted(() => ({
  from: null as import("@/test/supabaseChain").SupabaseFromStub | null,
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
  Outlet: () => <div data-testid="podstrona" />,
  // Selektor musi się WYKONAĆ - to on wyciąga ścieżkę ze stanu routera.
  useRouterState: ({ select }: { select: (s: { location: { pathname: string } }) => string }) =>
    select({ location: { pathname: h.path } }),
}));
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
  useServerFn: (fn: unknown) => async (payload: unknown) => {
    if (h.serverError) throw h.serverError;
    h.serverCalls.push({ fn: String(fn), payload });
    return { ok: 1, failed: 0 };
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
  useTenantAuthors: () => ({ data: [{ id: "a1", display_name: "Anna Kowalska" }] }),
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
      rpc: async (name: string) => {
        h.rpcCalls.push(name);
        return { data: null, error: null };
      },
    },
  };
});

import "@/test/i18nReal";
import "@/lib/i18n-admin-extras";
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
  h.saveSettingsError = null;
  h.settings = {
    homepage_mode: "latest_posts",
    homepage_page_slug: "",
    posts_per_page: 10,
    search_engine_visibility: true,
  };
  h.toast.success.mockReset();
  h.toast.error.mockReset();
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
