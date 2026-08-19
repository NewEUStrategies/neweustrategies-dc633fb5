// Menedżer przekierowań `/admin/redirects` (668 linii, 0% przed zmianą) -
// dyżurka migracji z WordPressa: CRUD nad tabelą `redirects`, import/eksport
// CSV mapy permalinków, licznik trafień i monitor 404 z jednym kliknięciem
// „zrób przekierowanie”.
//
// DLACZEGO TA TRASA MA SWÓJ TEST, choć reguły ścieżek są już dowiedzione w
// `src/lib/seo/redirects.test.ts`: bo SEO całego serwisu zależy od tego, co ta
// trasa WYŚLE do bazy, a nie od tego, co funkcja normalizująca umie policzyć.
// Reguł z `lib/seo/redirects` tu nie powtarzamy - używamy ich PRAWDZIWYCH, żeby
// podgląd „→ /nowa-sciezka” i bramka zapisu zgadzały się z serwerem.
//
// SIEDEM RZECZY, KTÓRE MAJĄ TU DOWÓD:
//   1. CEL POZA WŁASNYMI DOMENAMI NIE PRZECHODZI. Przekierowanie na obcy host
//      to open redirect - phishing z autorytetem naszej domeny. Lista domen
//      tenanta jest tu jedynym źródłem prawdy i musi dojechać do walidacji.
//   2. ZAPIS JEST ZABLOKOWANY, DOPÓKI ŚCIEŻKI SIĘ NIE NORMALIZUJĄ. Inaczej
//      redaktor zapisuje regułę, która nigdy się nie dopasuje, i dowiaduje się
//      o tym z ruchu w Search Console.
//   3. 410 GONE NIE MA CELU. Pole celu znika, a bramka zapisu przestaje go
//      wymagać - inaczej „usunięte na zawsze” byłoby niezapisywalne.
//   4. NIEZNANY KOD STATUSU Z BAZY SPADA DO 301. Edytor z kodem 418 wysłałby
//      do serwera wartość, której walidator nie przyjmie.
//   5. BŁĄD ZAPISU NIE ZAMYKA EDYTORA. Zamknięcie zabrałoby redaktorowi
//      wpisaną ścieżkę razem z komunikatem, co poprawić.
//   6. MONITOR 404 ROBI PRZEKIEROWANIE JEDNYM KLIKNIĘCIEM - ścieżka z 404
//      wchodzi do pola źródła; bez tego trzeba ją przepisywać ręcznie.
//   7. KAŻDA MUTACJA UNIEWAŻNIA OBA ZAPYTANIA (reguły i 404), bo nowa reguła
//      zdejmuje pozycję z monitora - inaczej ta sama ścieżka wisi tam dalej.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  rows: [] as unknown[],
  hits: [] as unknown[],
  domains: [] as unknown[],
  upsert: null as unknown,
  remove: null as unknown,
  toggle: null as unknown,
  importCsv: null as unknown,
  dismiss: null as unknown,
  toast: null as unknown,
  db: null as unknown,
  confirm: null as unknown,
  language: "pl" as string,
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
  const db = supabaseFromStub();
  h.db = db;
  return { supabase: { from: db.from } };
});

// Server fns jako szpiedzy; `useServerFn` w produkcji oddaje wołalny wrapper
// tej samej funkcji, więc tożsamość jest wierna.
vi.mock("@/lib/redirects.functions", async () => {
  const { vi: v } = await import("vitest");
  h.upsert = v.fn(async () => ({ id: "r-new" }));
  h.remove = v.fn(async () => undefined);
  h.toggle = v.fn(async () => undefined);
  h.importCsv = v.fn(async () => ({ imported: 3, issues: [] as string[] }));
  h.dismiss = v.fn(async () => undefined);
  return {
    upsertRedirect: h.upsert,
    deleteRedirects: h.remove,
    toggleRedirects: h.toggle,
    importRedirectsCsv: h.importCsv,
    dismissSeo404: h.dismiss,
  };
});
vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-start")>();
  return { ...actual, useServerFn: (fn: unknown) => fn };
});

// Radix `Tabs` montuje tylko aktywną zakładkę i nie przełącza jej pod
// happy-dom; oba panele są tu potrzebne naraz.
vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children }: { children: unknown }) => <div>{children as never}</div>,
  TabsList: ({ children }: { children: unknown }) => <div role="tablist">{children as never}</div>,
  TabsTrigger: ({ children }: { children: unknown }) => (
    <button role="tab">{children as never}</button>
  ),
  TabsContent: ({ value, children }: { value: string; children: unknown }) => (
    <div data-tab={value}>{children as never}</div>
  ),
}));

// `Select` jako natywny `<select>` - ten sam wzorzec, co w testach molekuł
// edytora. Zachowanie widżetu Radiksa nie jest regułą tej trasy; regułą jest
// to, CO trasa robi z wybraną wartością.
vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  type Node = React.ReactNode;
  return {
    Select: ({
      value,
      onValueChange,
      children,
    }: {
      value?: string;
      onValueChange?: (v: string) => void;
      children?: Node;
    }) =>
      React.createElement(
        "select",
        {
          value,
          onChange: (e: { target: { value: string } }) => onValueChange?.(e.target.value),
        },
        children as never,
      ),
    SelectTrigger: () => null,
    SelectValue: () => null,
    SelectContent: ({ children }: { children?: Node }) =>
      React.createElement(React.Fragment, null, children as never),
    SelectItem: ({ value, children }: { value: string; children?: Node }) =>
      React.createElement("option", { value }, children as never),
  };
});

// ConfirmDialog atrapowany do przycisku wołającego `onConfirm` - jego własne
// zachowanie (Radix AlertDialog) ma testy przy komponencie; tutaj liczy się
// treść potwierdzenia i to, co dzieje się PO nim.
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
  }) => {
    h.confirm = state;
    return state ? (
      <div data-testid="confirm" data-destructive={String(!!state.destructive)}>
        <span>{state.title}</span>
        <span>{state.description}</span>
        <button
          type="button"
          onClick={async () => {
            // Dokładnie tak samo jak prawdziwy `ConfirmDialog`: najpierw akcja,
            // potem zamknięcie. Odwrotna kolejność gubiłaby błędy akcji.
            await state.onConfirm();
            onOpenChange(false);
          }}
        >
          {state.confirmLabel}
        </button>
      </div>
    ) : null;
  },
}));

import { renderRoute, routeMeta } from "@/test/routeHarness";
import { Route as RedirectsRoute } from "@/routes/admin.redirects";
import { fail, ok, type SupabaseFromStub } from "@/test/supabaseChain";

type Mock = ReturnType<typeof vi.fn>;
const PATH = "/admin/redirects";
const db = () => h.db as SupabaseFromStub;
const toast = () => h.toast as Record<string, Mock>;
const upsert = () => h.upsert as Mock;
const remove = () => h.remove as Mock;
const toggle = () => h.toggle as Mock;
const importCsv = () => h.importCsv as Mock;
const dismiss = () => h.dismiss as Mock;

function redirect(overrides: Record<string, unknown> = {}) {
  return {
    id: "r-1",
    source_path: "/2023/05/stary-wpis/",
    target_path: "/analizy/nowy-wpis",
    status_code: 301,
    is_enabled: true,
    source: "wp_import",
    note: "mapa permalinków",
    hit_count: 12,
    last_hit_at: "2026-08-18T09:30:00.000Z",
    created_at: "2026-08-01T10:00:00.000Z",
    ...overrides,
  };
}

function hit404(overrides: Record<string, unknown> = {}) {
  return {
    path: "/2019/07/zapomniany/",
    hits: 42,
    first_seen: "2026-08-01T08:00:00.000Z",
    last_seen: "2026-08-19T07:15:00.000Z",
    last_referrer: "https://google.com/",
    ...overrides,
  };
}

function render() {
  return renderRoute({
    route: RedirectsRoute,
    path: PATH,
    initialEntry: PATH,
    queryClient: new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }),
  });
}

/** Czeka na tabelę reguł - znak, że zapytania się rozwiązały. */
async function renderList() {
  const view = await render();
  await waitFor(() => expect(screen.getByText("admin.redirects.title")).toBeInTheDocument());
  await waitFor(() => expect(db().chainsFor("redirects").length).toBeGreaterThan(0));
  return view;
}

/**
 * Filtr statusu na liście. Uwaga: gdy otwarty jest edytor, Radix ustawia
 * `aria-hidden` na resztę strony, więc pod dialogiem ten `<select>` przestaje
 * istnieć dla zapytań po roli - i dobrze, bo wtedy jest niedostępny także dla
 * czytnika ekranu.
 */
const filterSelect = () => screen.getAllByRole("combobox")[0] as HTMLSelectElement;
const dialog = () => screen.getByRole("dialog");
/** Kod odpowiedzi - jedyny `<select>` w otwartym edytorze. */
const codeSelect = () => within(dialog()).getByRole("combobox") as HTMLSelectElement;

beforeEach(() => {
  h.rows = [];
  h.hits = [];
  h.domains = [{ domain: "neweustrategies.com" }, { domain: null }];
  h.language = "pl";
  h.confirm = null;
  db().reset();
  db().setResponse("redirects", () => ok(h.rows));
  db().setResponse("seo_404_hits", () => ok(h.hits));
  db().setResponse("tenants", () => ok(h.domains));
  upsert().mockClear();
  upsert().mockResolvedValue({ id: "r-new" });
  remove().mockClear();
  remove().mockResolvedValue(undefined);
  toggle().mockClear();
  toggle().mockResolvedValue(undefined);
  importCsv().mockClear();
  importCsv().mockResolvedValue({ imported: 3, issues: [] });
  dismiss().mockClear();
  dismiss().mockResolvedValue(undefined);
  for (const fn of Object.values(toast())) fn.mockReset();
});

afterEach(cleanup);

// ---------------------------------------------------------------------------
// Zapytania i lista
// ---------------------------------------------------------------------------

describe("lista reguł", () => {
  it("czyta reguły od najnowszej, z limitem partii", async () => {
    await renderList();

    const chain = db().lastChain("redirects");
    expect(chain?.argsOf("order")).toEqual(["created_at", { ascending: false }]);
    expect(chain?.argsOf("limit")).toEqual([2000]);
  });

  it("monitor 404 sortuje po LICZBIE trafień - najboleśniejsze najpierw", async () => {
    await renderList();

    await waitFor(() => expect(db().chainsFor("seo_404_hits").length).toBeGreaterThan(0));
    const chain = db().lastChain("seo_404_hits");
    expect(chain?.argsOf("order")).toEqual(["hits", { ascending: false }]);
    expect(chain?.argsOf("limit")).toEqual([300]);
  });

  it("puste dane bazy nie wywracają ekranu, a mówią wprost, że nie ma reguł", async () => {
    db().setResponse("redirects", () => ok(null));
    db().setResponse("seo_404_hits", () => ok(null));
    await renderList();

    expect(screen.getByText("admin.redirects.empty")).toBeInTheDocument();
    expect(screen.getByText("admin.redirects.empty404")).toBeInTheDocument();
  });

  it("BŁĄD zapytania nie zabiera ekranu (nagłówek i akcje zostają)", async () => {
    db().setResponse("redirects", () => fail("statement timeout"));
    db().setResponse("seo_404_hits", () => fail("statement timeout"));
    await renderList();

    expect(screen.getByText("admin.new")).toBeInTheDocument();
    expect(screen.getByText("admin.redirects.empty")).toBeInTheDocument();
  });

  it("wiersz pokazuje ścieżki, licznik trafień i SKRÓCONĄ datę", async () => {
    // Pełny ISO zajmowałby pół kolumny; skrót „YYYY-MM-DD HH:MM” wystarcza,
    // żeby ocenić, czy reguła jeszcze żyje.
    h.rows = [redirect()];
    await renderList();

    await waitFor(() => expect(screen.getByText("/2023/05/stary-wpis/")).toBeInTheDocument());
    expect(screen.getByText("/analizy/nowy-wpis")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("2026-08-18 09:30")).toBeInTheDocument();
  });

  it("reguła BEZ trafień pokazuje kreskę, nie pustą komórkę", async () => {
    h.rows = [redirect({ last_hit_at: null, hit_count: 0 })];
    await renderList();

    await waitFor(() => expect(screen.getAllByText("-").length).toBeGreaterThan(0));
  });

  it("410 Gone zamiast celu - i to on jest wyróżniony na czerwono", async () => {
    // Cel przy 410 nie ma znaczenia; pokazanie go sugerowałoby, że gdzieś
    // prowadzi.
    h.rows = [redirect({ status_code: 410, target_path: "/nieistotne" })];
    await renderList();

    await waitFor(() => expect(screen.getByText("410 Gone")).toBeInTheDocument());
    expect(screen.queryByText("/nieistotne")).toBeNull();
  });

  it("źródło reguły ma etykietę w języku panelu, a nieznane zostaje surowe", async () => {
    h.rows = [redirect({ source: "wp_import" }), redirect({ id: "r-2", source: "nieznane" })];
    await renderList();

    await waitFor(() => expect(screen.getByText("import WP")).toBeInTheDocument());
    expect(screen.getByText("nieznane")).toBeInTheDocument();

    cleanup();
    h.language = "en";
    await renderList();
    await waitFor(() => expect(screen.getByText("WP import")).toBeInTheDocument());
  });
});

// ---------------------------------------------------------------------------
// Filtrowanie
// ---------------------------------------------------------------------------

describe("filtrowanie listy", () => {
  beforeEach(() => {
    h.rows = [
      redirect({ id: "a", source_path: "/stara/oferta", target_path: "/oferta", note: null }),
      redirect({
        id: "b",
        source_path: "/blog/2019/tekst",
        target_path: "/analizy/tekst",
        is_enabled: false,
        note: "z migracji",
      }),
    ];
  });

  it("szukanie działa po ŹRÓDLE, CELU i NOTATCE, bez względu na wielkość liter", async () => {
    // Redakcja szuka raz starego adresu, raz nowego, raz notatki z migracji.
    await renderList();
    await waitFor(() => expect(screen.getByText("/stara/oferta")).toBeInTheDocument());
    const box = screen.getByPlaceholderText("admin.redirects.searchPlaceholder");

    fireEvent.change(box, { target: { value: "STARA" } });
    expect(screen.queryByText("/blog/2019/tekst")).toBeNull();

    fireEvent.change(box, { target: { value: "/analizy/" } });
    expect(screen.getByText("/blog/2019/tekst")).toBeInTheDocument();
    expect(screen.queryByText("/stara/oferta")).toBeNull();

    fireEvent.change(box, { target: { value: "migracji" } });
    expect(screen.getByText("/blog/2019/tekst")).toBeInTheDocument();
  });

  it("filtr aktywności rozdziela reguły włączone od wyłączonych", async () => {
    await renderList();
    await waitFor(() => expect(screen.getByText("/stara/oferta")).toBeInTheDocument());

    fireEvent.change(filterSelect(), { target: { value: "disabled" } });
    expect(screen.getByText("/blog/2019/tekst")).toBeInTheDocument();
    expect(screen.queryByText("/stara/oferta")).toBeNull();

    fireEvent.change(filterSelect(), { target: { value: "enabled" } });
    expect(screen.getByText("/stara/oferta")).toBeInTheDocument();
    expect(screen.queryByText("/blog/2019/tekst")).toBeNull();

    fireEvent.change(filterSelect(), { target: { value: "all" } });
    expect(screen.getByText("/stara/oferta")).toBeInTheDocument();
    expect(screen.getByText("/blog/2019/tekst")).toBeInTheDocument();
  });

  it("licznik pokazuje ILE Z ILU, więc widać, że filtr coś ukrywa", async () => {
    await renderList();
    await waitFor(() => expect(screen.getByText("2 / 2")).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText("admin.redirects.searchPlaceholder"), {
      target: { value: "stara" },
    });
    expect(screen.getByText("1 / 2")).toBeInTheDocument();
  });

  it("pusty wynik filtra mówi „brak wyników”, a nie „brak reguł”", async () => {
    // Dwa różne komunikaty: pusta tabela to problem migracji, pusty filtr to
    // literówka w szukajce.
    await renderList();
    fireEvent.change(screen.getByPlaceholderText("admin.redirects.searchPlaceholder"), {
      target: { value: "nie-ma-takiej" },
    });

    expect(screen.getByText("admin.list.noResults")).toBeInTheDocument();
    expect(screen.queryByText("admin.redirects.empty")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Edytor reguły
// ---------------------------------------------------------------------------

describe("edytor reguły", () => {
  const openNew = async () => {
    await renderList();
    fireEvent.click(screen.getByText("admin.new"));
    await waitFor(() => expect(screen.getByText("admin.redirects.newTitle")).toBeInTheDocument());
  };

  const sourceInput = () => screen.getByPlaceholderText("/2023/05/stary-wpis/ lub /stara-sekcja/*");
  const targetInput = () => screen.getByPlaceholderText("/nowa-sekcja/nowy-wpis lub https://…");
  const saveButton = () => screen.getByText("admin.save").closest("button") as HTMLButtonElement;

  it("nowa reguła startuje pusta, z 301 i włączona", async () => {
    await openNew();

    expect(sourceInput()).toHaveValue("");
    expect(targetInput()).toHaveValue("");
    expect(codeSelect().value).toBe("301");
  });

  it("EDYCJA wypełnia formularz wierszem, a nieznany kod spada do 301", async () => {
    // Kod 418 z bazy (albo z ręcznego SQL-a) nie przejdzie walidacji serwera -
    // edytor nie ma prawa go podać dalej.
    h.rows = [redirect({ status_code: 418, note: null })];
    await renderList();
    await waitFor(() => expect(screen.getByText("/2023/05/stary-wpis/")).toBeInTheDocument());

    fireEvent.click(
      screen.getAllByRole("button").find((b) => b.querySelector("svg.lucide-pencil"))!,
    );

    await waitFor(() => expect(screen.getByText("admin.redirects.editTitle")).toBeInTheDocument());
    expect(sourceInput()).toHaveValue("/2023/05/stary-wpis/");
    expect(codeSelect().value).toBe("301");
  });

  it("podgląd pokazuje ZNORMALIZOWANĄ ścieżkę, a przy błędnej - komunikat", async () => {
    // To jedyne miejsce, gdzie redaktor widzi, że „//a/b” i „/a/b” to jedno,
    // a gwiazdka w środku ścieżki nie jest wzorcem.
    await openNew();

    fireEvent.change(sourceInput(), { target: { value: "//2023/05/stary-wpis/" } });
    await waitFor(() => expect(screen.getByText("→ /2023/05/stary-wpis")).toBeInTheDocument());

    fireEvent.change(sourceInput(), { target: { value: "/stara/*/glupota" } });
    await waitFor(() =>
      expect(screen.getByText("admin.redirects.invalidSource")).toBeInTheDocument(),
    );
  });

  it("CEL POZA własnymi domenami jest odrzucany - to open redirect", async () => {
    // Przekierowanie na obcy host pożycza autorytet naszej domeny phishingowi.
    // Lista domen tenanta z zapytania musi tu dojechać, inaczej nawet własna
    // domena byłaby odrzucona.
    await openNew();
    fireEvent.change(sourceInput(), { target: { value: "/stary" } });

    fireEvent.change(targetInput(), { target: { value: "https://zly.example/phishing" } });
    await waitFor(() =>
      expect(screen.getByText("admin.redirects.invalidTarget")).toBeInTheDocument(),
    );
    expect(saveButton()).toBeDisabled();

    fireEvent.change(targetInput(), { target: { value: "https://neweustrategies.com/nowy" } });
    await waitFor(() =>
      expect(screen.getByText("→ https://neweustrategies.com/nowy")).toBeInTheDocument(),
    );
    expect(saveButton()).not.toBeDisabled();
  });

  it("ZAPIS jest zablokowany bez poprawnego źródła i celu", async () => {
    await openNew();
    expect(saveButton()).toBeDisabled();

    fireEvent.change(sourceInput(), { target: { value: "/stary" } });
    // Samo źródło nie wystarcza - reguła bez celu nigdzie nie prowadzi.
    expect(saveButton()).toBeDisabled();

    fireEvent.change(targetInput(), { target: { value: "/nowy" } });
    await waitFor(() => expect(saveButton()).not.toBeDisabled());
  });

  it("410 GONE nie ma pola celu i nie wymaga go do zapisu", async () => {
    await openNew();
    fireEvent.change(sourceInput(), { target: { value: "/usuniety" } });
    fireEvent.change(codeSelect(), { target: { value: "410" } });

    await waitFor(() =>
      expect(screen.queryByPlaceholderText("/nowa-sekcja/nowy-wpis lub https://…")).toBeNull(),
    );
    expect(saveButton()).not.toBeDisabled();
  });

  it("410 z pustym celem zapisuje „/” - kolumna celu nie może zostać pusta", async () => {
    // Kolumna `target_path` jest NOT NULL; przy 410 i tak nie ma znaczenia,
    // więc idzie tam strona główna, a nie łańcuch pusty.
    await openNew();
    fireEvent.change(sourceInput(), { target: { value: "/usuniety" } });
    fireEvent.change(codeSelect(), { target: { value: "410" } });
    await waitFor(() => expect(saveButton()).not.toBeDisabled());

    fireEvent.click(saveButton());

    await waitFor(() => expect(upsert()).toHaveBeenCalledTimes(1));
    const fields = (upsert().mock.calls[0][0] as { data: { fields: Record<string, unknown> } }).data
      .fields;
    expect(fields.target_path).toBe("/");
    expect(fields.status_code).toBe(410);
  });

  it("BRAK listy domen tenanta odrzuca KAŻDY adres absolutny", async () => {
    // Fail-closed: gdy zapytanie o domeny nic nie zwróci (null), walidacja nie
    // ma z czym porównać hosta - i wtedy nie wolno przepuścić żadnego.
    db().setResponse("tenants", () => ok(null));
    await openNew();
    fireEvent.change(sourceInput(), { target: { value: "/stary" } });
    fireEvent.change(targetInput(), { target: { value: "https://neweustrategies.com/nowy" } });

    await waitFor(() =>
      expect(screen.getByText("admin.redirects.invalidTarget")).toBeInTheDocument(),
    );
    expect(saveButton()).toBeDisabled();
  });

  it("nieznany kod z listy rozwijanej też spada do 301", async () => {
    await openNew();
    fireEvent.change(codeSelect(), { target: { value: "418" } });
    expect(codeSelect().value).toBe("301");
  });

  it("zapis wysyła znormalizowane pola, PUSTY cel jako „/” i pustą notatkę jako null", async () => {
    // `note: ""` w bazie to śmieć nieodróżnialny od braku notatki, a pusty cel
    // musi znaczyć stronę główną, nie łańcuch pusty.
    await openNew();
    fireEvent.change(sourceInput(), { target: { value: "/stary" } });
    fireEvent.change(targetInput(), { target: { value: "/nowy" } });
    await waitFor(() => expect(saveButton()).not.toBeDisabled());

    fireEvent.click(saveButton());

    await waitFor(() => expect(upsert()).toHaveBeenCalledTimes(1));
    expect(upsert().mock.calls[0][0]).toEqual({
      data: {
        id: undefined,
        fields: {
          source_path: "/stary",
          target_path: "/nowy",
          status_code: 301,
          is_enabled: true,
          note: null,
        },
      },
    });
    await waitFor(() => expect(toast().success).toHaveBeenCalledWith("admin.saved"));
    expect(screen.queryByText("admin.redirects.newTitle")).toBeNull();
  });

  it("edycja wysyła ID - inaczej powstałaby DRUGA reguła na tę samą ścieżkę", async () => {
    h.rows = [redirect()];
    await renderList();
    await waitFor(() => expect(screen.getByText("/2023/05/stary-wpis/")).toBeInTheDocument());
    fireEvent.click(
      screen.getAllByRole("button").find((b) => b.querySelector("svg.lucide-pencil"))!,
    );
    await waitFor(() => expect(screen.getByText("admin.redirects.editTitle")).toBeInTheDocument());

    // Wiersz ma poprawne ścieżki, więc zapis jest odblokowany bez edycji.
    await waitFor(() => expect(saveButton()).not.toBeDisabled());
    fireEvent.click(saveButton());

    await waitFor(() => expect(upsert()).toHaveBeenCalledTimes(1));
    const arg = upsert().mock.calls[0][0] as { data: { id?: string } };
    expect(arg.data.id).toBe("r-1");
  });

  it("BŁĄD zapisu pokazuje komunikat serwera i NIE zamyka edytora", async () => {
    // Zamknięcie zabrałoby wpisaną ścieżkę razem z informacją, co poprawić.
    upsert().mockRejectedValue(new Error("źródło już zajęte"));
    await openNew();
    fireEvent.change(sourceInput(), { target: { value: "/stary" } });
    fireEvent.change(targetInput(), { target: { value: "/nowy" } });
    await waitFor(() => expect(saveButton()).not.toBeDisabled());

    fireEvent.click(saveButton());

    await waitFor(() => expect(toast().error).toHaveBeenCalledWith("źródło już zajęte"));
    expect(screen.getByText("admin.redirects.newTitle")).toBeInTheDocument();
  });

  it("rzut NIE będący instancją Error też ma czytelny komunikat", async () => {
    upsert().mockRejectedValue("brak sieci");
    await openNew();
    fireEvent.change(sourceInput(), { target: { value: "/stary" } });
    fireEvent.change(targetInput(), { target: { value: "/nowy" } });
    await waitFor(() => expect(saveButton()).not.toBeDisabled());

    fireEvent.click(saveButton());

    await waitFor(() => expect(toast().error).toHaveBeenCalledWith("brak sieci"));
  });

  it("anulowanie zamyka edytor bez zapisu", async () => {
    await openNew();
    fireEvent.click(screen.getByText("admin.cancel"));

    await waitFor(() => expect(screen.queryByText("admin.redirects.newTitle")).toBeNull());
    expect(upsert()).not.toHaveBeenCalled();
  });

  it("ESCAPE też zamyka edytor - i też bez zapisu", async () => {
    // Klawiatura jest tu pełnoprawną drogą wyjścia; okno, którego nie da się
    // zamknąć Escapem, blokuje panel dla osób pracujących bez myszy.
    await openNew();

    fireEvent.keyDown(document.body, { key: "Escape", code: "Escape" });

    await waitFor(() => expect(screen.queryByText("admin.redirects.newTitle")).toBeNull());
    expect(upsert()).not.toHaveBeenCalled();
  });

  it("notatka i przełącznik aktywności trafiają do zapisu", async () => {
    await openNew();
    fireEvent.change(sourceInput(), { target: { value: "/stary" } });
    fireEvent.change(targetInput(), { target: { value: "/nowy" } });
    const note = dialog().querySelector("textarea") as HTMLTextAreaElement;
    fireEvent.change(note, { target: { value: "po audycie" } });
    fireEvent.click(within(dialog()).getByRole("switch"));

    await waitFor(() => expect(saveButton()).not.toBeDisabled());
    fireEvent.click(saveButton());

    await waitFor(() => expect(upsert()).toHaveBeenCalledTimes(1));
    const fields = (upsert().mock.calls[0][0] as { data: { fields: Record<string, unknown> } }).data
      .fields;
    expect(fields.note).toBe("po audycie");
    expect(fields.is_enabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Usuwanie i przełączanie
// ---------------------------------------------------------------------------

describe("usuwanie i przełączanie", () => {
  beforeEach(() => {
    h.rows = [redirect()];
  });

  it("usunięcie PYTA, pokazując którą regułę, i jest oznaczone jako niszczące", async () => {
    await renderList();
    await waitFor(() => expect(screen.getByText("/2023/05/stary-wpis/")).toBeInTheDocument());

    fireEvent.click(
      screen.getAllByRole("button").find((b) => b.querySelector("svg.lucide-trash2"))!,
    );

    const box = await waitFor(() => screen.getByTestId("confirm"));
    expect(box.dataset.destructive).toBe("true");
    expect(within(box).getByText("admin.redirects.confirmDelete")).toBeInTheDocument();
    expect(within(box).getByText("/2023/05/stary-wpis/ → /analizy/nowy-wpis")).toBeInTheDocument();
    expect(remove()).not.toHaveBeenCalled();
  });

  it("potwierdzone usunięcie wysyła ID i odświeża OBA zapytania", async () => {
    const view = await renderList();
    await waitFor(() => expect(screen.getByText("/2023/05/stary-wpis/")).toBeInTheDocument());
    fireEvent.click(
      screen.getAllByRole("button").find((b) => b.querySelector("svg.lucide-trash2"))!,
    );
    const box = await waitFor(() => screen.getByTestId("confirm"));
    const invalidate = vi.spyOn(view.queryClient, "invalidateQueries");

    fireEvent.click(within(box).getByText("admin.delete"));

    await waitFor(() => expect(remove()).toHaveBeenCalledWith({ data: { ids: ["r-1"] } }));
    await waitFor(() => expect(toast().success).toHaveBeenCalledWith("admin.deleted"));
    const keys = invalidate.mock.calls.map((c) => JSON.stringify(c[0]));
    expect(keys).toContain(JSON.stringify({ queryKey: ["admin-redirects"] }));
    expect(keys).toContain(JSON.stringify({ queryKey: ["admin-seo-404"] }));
  });

  it("po potwierdzeniu okno pytania SIĘ ZAMYKA", async () => {
    // Otwarte okno po wykonanej akcji wygląda jak akcja, która się nie udała.
    await renderList();
    await waitFor(() => expect(screen.getByText("/2023/05/stary-wpis/")).toBeInTheDocument());
    fireEvent.click(
      screen.getAllByRole("button").find((b) => b.querySelector("svg.lucide-trash2"))!,
    );
    const box = await waitFor(() => screen.getByTestId("confirm"));

    fireEvent.click(within(box).getByText("admin.delete"));

    await waitFor(() => expect(screen.queryByTestId("confirm")).toBeNull());
  });

  it("nieudane usunięcie pokazuje komunikat serwera", async () => {
    remove().mockRejectedValue(new Error("reguła w użyciu"));
    await renderList();
    await waitFor(() => expect(screen.getByText("/2023/05/stary-wpis/")).toBeInTheDocument());
    fireEvent.click(
      screen.getAllByRole("button").find((b) => b.querySelector("svg.lucide-trash2"))!,
    );
    const box = await waitFor(() => screen.getByTestId("confirm"));

    fireEvent.click(within(box).getByText("admin.delete"));

    await waitFor(() => expect(toast().error).toHaveBeenCalledWith("reguła w użyciu"));
  });

  it("rzut NIE będący instancją Error przy usuwaniu też ma komunikat", async () => {
    remove().mockRejectedValue("brak sieci");
    await renderList();
    await waitFor(() => expect(screen.getByText("/2023/05/stary-wpis/")).toBeInTheDocument());
    fireEvent.click(
      screen.getAllByRole("button").find((b) => b.querySelector("svg.lucide-trash2"))!,
    );
    const box = await waitFor(() => screen.getByTestId("confirm"));

    fireEvent.click(within(box).getByText("admin.delete"));

    await waitFor(() => expect(toast().error).toHaveBeenCalledWith("brak sieci"));
  });

  it("przełącznik w wierszu wyłącza regułę BEZ pytania (odwracalne jednym klikiem)", async () => {
    await renderList();
    await waitFor(() => expect(screen.getByText("/2023/05/stary-wpis/")).toBeInTheDocument());

    fireEvent.click(screen.getAllByRole("switch")[0]);

    await waitFor(() =>
      expect(toggle()).toHaveBeenCalledWith({ data: { ids: ["r-1"], is_enabled: false } }),
    );
  });

  it("nieudane przełączenie pokazuje komunikat, a nie ciszę", async () => {
    toggle().mockRejectedValue(new Error("brak uprawnień"));
    await renderList();
    await waitFor(() => expect(screen.getByText("/2023/05/stary-wpis/")).toBeInTheDocument());

    fireEvent.click(screen.getAllByRole("switch")[0]);

    await waitFor(() => expect(toast().error).toHaveBeenCalledWith("brak uprawnień"));
  });

  it("rzut NIE będący instancją Error przy przełączaniu też ma komunikat", async () => {
    toggle().mockRejectedValue("brak sieci");
    await renderList();
    await waitFor(() => expect(screen.getByText("/2023/05/stary-wpis/")).toBeInTheDocument());

    fireEvent.click(screen.getAllByRole("switch")[0]);

    await waitFor(() => expect(toast().error).toHaveBeenCalledWith("brak sieci"));
  });
});

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

describe("import i eksport CSV", () => {
  it("eksport jest ZABLOKOWANY, gdy nie ma czego eksportować", async () => {
    await renderList();
    expect(screen.getByText("admin.redirects.exportCsv").closest("button")).toBeDisabled();
  });

  it("eksport zbiera plik CSV z nagłówkiem i wierszami", async () => {
    h.rows = [redirect()];
    const blobs: string[] = [];
    const createObjectURL = vi.fn((blob: Blob) => {
      void blob.text().then((text) => blobs.push(text));
      return "blob:redirects";
    });
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const anchors: HTMLAnchorElement[] = [];
    const create = document.createElement.bind(document);
    const spy = vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
      const el = create(tag);
      if (tag === "a") {
        (el as HTMLAnchorElement).click = vi.fn();
        anchors.push(el as HTMLAnchorElement);
      }
      return el;
    }) as typeof document.createElement);

    try {
      await renderList();
      await waitFor(() => expect(screen.getByText("/2023/05/stary-wpis/")).toBeInTheDocument());
      fireEvent.click(screen.getByText("admin.redirects.exportCsv"));

      const anchor = anchors.at(-1)!;
      expect(anchor.download).toBe("redirects.csv");
      expect(anchor.click).toHaveBeenCalled();
      // Adres obiektowy jest zwalniany - inaczej blob zostaje w pamięci karty.
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:redirects");
      await waitFor(() => expect(blobs[0]).toContain("source,target,status,note"));
      expect(blobs[0]).toContain("/2023/05/stary-wpis/");
    } finally {
      spy.mockRestore();
    }
  });

  it("import czyta plik i melduje LICZBĘ zaimportowanych reguł", async () => {
    const view = await renderList();
    const invalidate = vi.spyOn(view.queryClient, "invalidateQueries");
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;

    fireEvent.change(input, {
      target: { files: [new File(["source,target\n/a,/b\n"], "mapa.csv", { type: "text/csv" })] },
    });

    await waitFor(() => expect(importCsv()).toHaveBeenCalledTimes(1));
    expect(importCsv().mock.calls[0][0]).toEqual({ data: { csv: "source,target\n/a,/b\n" } });
    await waitFor(() =>
      expect(toast().success).toHaveBeenCalledWith('admin.redirects.imported {"count":3}'),
    );
    expect(invalidate).toHaveBeenCalled();
  });

  it("pominięte wiersze są DOPISANE do komunikatu - w języku panelu", async () => {
    // Import, który cicho zjada 40 wierszy, jest groźniejszy niż import, który
    // się nie udał.
    importCsv().mockResolvedValue({ imported: 2, issues: ["wiersz 3", "wiersz 7"] });
    await renderList();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;

    fireEvent.change(input, {
      target: { files: [new File(["x"], "mapa.csv", { type: "text/csv" })] },
    });

    await waitFor(() =>
      expect(toast().success).toHaveBeenCalledWith(
        'admin.redirects.imported {"count":2} (2 pominiętych wierszy)',
      ),
    );

    cleanup();
    h.language = "en";
    toast().success.mockReset();
    await renderList();
    const inputEn = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(inputEn, {
      target: { files: [new File(["x"], "mapa.csv", { type: "text/csv" })] },
    });
    await waitFor(() =>
      expect(toast().success).toHaveBeenCalledWith(
        'admin.redirects.imported {"count":2} (2 rows skipped)',
      ),
    );
  });

  it("nieudany import pokazuje komunikat i ZWALNIA pole pliku", async () => {
    // Bez wyczyszczenia `value` wybranie tego samego pliku po poprawce nie
    // wywołałoby zdarzenia `change` - redaktor klika i „nic się nie dzieje”.
    importCsv().mockRejectedValue(new Error("zły nagłówek CSV"));
    await renderList();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;

    fireEvent.change(input, {
      target: { files: [new File(["x"], "mapa.csv", { type: "text/csv" })] },
    });

    await waitFor(() => expect(toast().error).toHaveBeenCalledWith("zły nagłówek CSV"));
    expect(input.value).toBe("");
  });

  it("rzut NIE będący instancją Error przy imporcie też ma komunikat", async () => {
    importCsv().mockRejectedValue("plik zbyt duży");
    await renderList();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;

    fireEvent.change(input, {
      target: { files: [new File(["x"], "mapa.csv", { type: "text/csv" })] },
    });

    await waitFor(() => expect(toast().error).toHaveBeenCalledWith("plik zbyt duży"));
  });

  it("puste zdarzenie wyboru pliku niczego nie wysyła", async () => {
    await renderList();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;

    fireEvent.change(input, { target: { files: [] } });

    expect(importCsv()).not.toHaveBeenCalled();
  });

  it("przycisk importu otwiera ukryte pole pliku", async () => {
    await renderList();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const click = vi.spyOn(input, "click");

    fireEvent.click(screen.getByText("admin.redirects.importCsv"));

    expect(click).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Monitor 404
// ---------------------------------------------------------------------------

describe("monitor 404", () => {
  beforeEach(() => {
    h.hits = [hit404()];
  });

  it("pokazuje ścieżkę, liczbę trafień, datę i źródło ruchu", async () => {
    await renderList();

    await waitFor(() => expect(screen.getByText("/2019/07/zapomniany/")).toBeInTheDocument());
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("2026-08-19 07:15")).toBeInTheDocument();
    expect(screen.getByText("https://google.com/")).toBeInTheDocument();
  });

  it("brak referera pokazuje kreskę", async () => {
    h.hits = [hit404({ last_referrer: null })];
    await renderList();

    await waitFor(() => expect(screen.getByText("/2019/07/zapomniany/")).toBeInTheDocument());
    expect(screen.getAllByText("-").length).toBeGreaterThan(0);
  });

  it("„zrób przekierowanie” wstawia ścieżkę 404 do pola źródła", async () => {
    // Bez tego redaktor przepisuje adres ręcznie - a literówka daje regułę,
    // która nigdy się nie dopasuje.
    await renderList();
    await waitFor(() => expect(screen.getByText("/2019/07/zapomniany/")).toBeInTheDocument());

    fireEvent.click(screen.getByText("admin.redirects.create"));

    await waitFor(() => expect(screen.getByText("admin.redirects.newTitle")).toBeInTheDocument());
    expect(screen.getByPlaceholderText("/2023/05/stary-wpis/ lub /stara-sekcja/*")).toHaveValue(
      "/2019/07/zapomniany/",
    );
  });

  it("odrzucenie pozycji wysyła JEJ ścieżkę i odświeża listy", async () => {
    await renderList();
    await waitFor(() => expect(screen.getByText("/2019/07/zapomniany/")).toBeInTheDocument());
    const row = screen.getByText("/2019/07/zapomniany/").closest("tr") as HTMLElement;

    fireEvent.click(within(row).getAllByRole("button").at(-1)!);

    await waitFor(() =>
      expect(dismiss()).toHaveBeenCalledWith({ data: { paths: ["/2019/07/zapomniany/"] } }),
    );
  });

  it("rzut NIE będący instancją Error przy odrzuceniu też ma komunikat", async () => {
    dismiss().mockRejectedValue("brak sieci");
    await renderList();
    await waitFor(() => expect(screen.getByText("/2019/07/zapomniany/")).toBeInTheDocument());
    const row = screen.getByText("/2019/07/zapomniany/").closest("tr") as HTMLElement;

    fireEvent.click(within(row).getAllByRole("button").at(-1)!);

    await waitFor(() => expect(toast().error).toHaveBeenCalledWith("brak sieci"));
  });

  it("nieudane odrzucenie pokazuje komunikat", async () => {
    dismiss().mockRejectedValue(new Error("brak uprawnień"));
    await renderList();
    await waitFor(() => expect(screen.getByText("/2019/07/zapomniany/")).toBeInTheDocument());
    const row = screen.getByText("/2019/07/zapomniany/").closest("tr") as HTMLElement;

    fireEvent.click(within(row).getAllByRole("button").at(-1)!);

    await waitFor(() => expect(toast().error).toHaveBeenCalledWith("brak uprawnień"));
  });
});

// ---------------------------------------------------------------------------
// Nagłówek strony
// ---------------------------------------------------------------------------

describe("nagłówek dokumentu", () => {
  it("strona ma własny tytuł", async () => {
    const meta = await routeMeta(RedirectsRoute);
    expect(meta).toEqual([{ title: "Przekierowania - Admin" }]);
  });
});
