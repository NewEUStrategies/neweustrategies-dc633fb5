// TRASA `/admin/tags` ZAMONTOWANA w prawdziwym routerze. Do wydania 13 raportu
// pokrycia: 36 linii na zerze - a to jedyny ekran, który tworzy i kasuje tagi
// całego serwisu (archiwa `/tag/*`, podpowiedzi w edytorze wpisu, graf
// powiązanych wpisów).
//
// OSIEM REGUŁ, KTÓRYCH ZŁAMANIE KOSZTUJE:
//
//   1. NAGŁÓWEK JEST SEKCYJNY. Bez `head()` trasa dziedziczyła ogólne „Admin”
//      z layoutu - karta przeglądarki i historia nie mówiły, gdzie jest
//      redaktor, a ekran nie niósł własnego `noindex` (AGENTS.md).
//   2. ODCZYT BIERZE TRZY KOLUMNY I WŁASNY KLUCZ CACHE. Ekran używa `id`,
//      `name`, `slug`; `select("*")` ciągnął resztę wiersza. Klucz
//      `["tags", tenant]` dzielił z edytorem wpisu, który kładzie tam wiersze
//      BEZ sluga - przy globalnym `staleTime` 5 min ekran wyświetlał te wiersze
//      i wyszukiwanie po slugu przestawało działać.
//   3. WCZYTYWANIE I BŁĄD TO NIE „PUSTO”. Oba stany pokazywały „Brak
//      elementów”, czyli informację fałszywą: redaktor dodawał tag, który
//      istniał, albo uznawał bazę za wyczyszczoną.
//   4. DODANIE JEST JEDNO NA RAZ. Enter wciśnięty w trakcie żądania wysyłał
//      drugie `createTag` - powstawał duplikat (`ai`, `ai-2`) albo błąd
//      unikalności sluga. Blokada trwa aż do odświeżenia listy: wcześniej
//      kontrola duplikatu (reguła 5) nie widzi jeszcze nowego tagu.
//   5. TAG O ISTNIEJĄCEJ NAZWIE NIE TRAFIA NA SERWER. Serwer dokleja do sluga
//      sufiks, więc drugi „AI” stawał się osobnym tagiem `ai-2` o tej samej
//      nazwie - nieodróżnialnym w każdym selektorze tagów.
//   6. USUNIĘCIE PYTA, I TO Z NAZWĄ. `post_tags` kasuje się kaskadowo, więc
//      jedno kliknięcie w × odpinało tag od wszystkich wpisów bez cofnięcia.
//      Siostrzane ekrany (kategorie, custom meta) pytają `confirmDialog`.
//   7. PRZYCISKI IKONOWE MAJĄ NAZWĘ. „+” nie miał żadnej, a każde × nazywało
//      się „Usuń” - czytnik ekranu nie mówił, KTÓRY tag zniknie.
//   8. USUNIĘCIE UNIEWAŻNIA RELACJĘ W EDYTORZE WPISU. Kaskada zdejmuje tag
//      z `post_tags`, ale edytor trzyma `["post-tags", wpis]` w cache przez
//      5 min. Wczytana stamtąd relacja wysyłała przy autozapisie usunięte id:
//      `updatePost` kasował wszystkie tagi wpisu, a insert padał na kluczu
//      obcym - przy tym i każdym kolejnym zapisie.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE: walidacji, sluga i strażnika częstotliwości
// `createTag`/`deleteTag` - to kontrakt serwera; tu atrapą jest `useServerFn`.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import type { AnyRoute } from "@tanstack/react-router";

interface Row {
  id: string;
  name: string;
  slug: string;
}

const h = vi.hoisted(() => ({
  rows: [] as Row[],
  readError: null as { message: string } | null,
  /** Odpowiedź `{ data: null, error: null }` - klient Supabase jej nie wyklucza. */
  readNull: false,
  /** Zapora odczytu: dopóki nie zwolniona, lista „się wczytuje”. */
  readGate: null as Promise<void> | null,
  reads: [] as { table: string; columns: string; eq: [string, unknown]; order: string }[],
  creates: [] as unknown[],
  createError: null as unknown,
  /** Zapora zapisu: dopóki nie zwolniona, `createTag` „trwa”. */
  createGate: null as Promise<void> | null,
  deletes: [] as unknown[],
  deleteError: null as unknown,
  confirmAnswer: true,
  confirmCalls: [] as Record<string, unknown>[],
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/hooks/useAuth", () => ({ useRequiredTenant: () => "tenant-1" }));
vi.mock("sonner", () => ({ toast: h.toast }));
vi.mock("@/lib/appDialogs", () => ({
  confirmDialog: async (opts: Record<string, unknown>) => {
    h.confirmCalls.push(opts);
    return h.confirmAnswer;
  },
}));
vi.mock("@/lib/content.functions", () => ({
  createTag: "createTag",
  deleteTag: "deleteTag",
}));
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: (fn: unknown) => async (payload: { data: { name?: string; id?: string } }) => {
    if (fn === "createTag") {
      h.creates.push(payload);
      if (h.createGate) await h.createGate;
      if (h.createError !== null) throw h.createError;
      const name = payload.data.name ?? "";
      const row = {
        id: `new-${h.creates.length}`,
        name,
        slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      };
      h.rows = [...h.rows, row].sort((a, b) => a.name.localeCompare(b.name));
      return row;
    }
    h.deletes.push(payload);
    if (h.deleteError !== null) throw h.deleteError;
    h.rows = h.rows.filter((r) => r.id !== payload.data.id);
    return { ok: true };
  },
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => ({
      select: (columns: string) => ({
        eq: (col: string, value: unknown) => ({
          order: async (orderBy: string) => {
            h.reads.push({ table, columns, eq: [col, value], order: orderBy });
            if (h.readGate) await h.readGate;
            if (h.readError) return { data: null, error: h.readError };
            if (h.readNull) return { data: null, error: null };
            return { data: h.rows.map((r) => ({ ...r })), error: null };
          },
        }),
      }),
    }),
  },
}));

import "@/test/i18nReal";
// Etykiety wyszukiwarki, „Brak wyników” i klucze `admin.tags.*` mieszkają
// w nakładce, którą w aplikacji rejestruje layout `/admin`, nie sama trasa.
import "@/lib/i18n-admin-extras";
import { renderRoute, routeMeta, type RenderedRoute } from "@/test/routeHarness";
import { Route } from "@/routes/admin.tags";

function tag(id: string, name: string, slug: string): Row {
  return { id, name, slug };
}

/** Obietnica zwalniana ręcznie - do zapór odczytu i zapisu. */
function gate() {
  let release = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

async function mount(rows: Row[] = [], queryClient?: QueryClient): Promise<RenderedRoute> {
  h.rows = rows.map((r) => ({ ...r }));
  const view = await renderRoute({
    route: Route as AnyRoute,
    path: "/admin/tags",
    initialEntry: "/admin/tags",
    queryClient,
  });
  await screen.findByRole("heading", { level: 1, name: "Tagi" });
  return view;
}

/** Montaż z gotową listą - czeka na chipy albo na komunikat pustej bazy. */
async function mountLoaded(rows: Row[] = [], queryClient?: QueryClient) {
  const view = await mount(rows, queryClient);
  if (rows.length) await waitFor(() => expect(chipNames()).toHaveLength(rows.length));
  else await screen.findByText("Brak elementów");
  return view;
}

const nameField = () => screen.getByPlaceholderText("Nazwa tagu i Enter") as HTMLInputElement;
const searchField = () => screen.getByPlaceholderText("Szukaj tagów…") as HTMLInputElement;
const addForm = () => nameField().closest("form") as HTMLFormElement;
const addButton = () => within(addForm()).getByRole("button");
/** Chip tagu: element z nazwą, w którym siedzi przycisk ×. */
const chip = (name: string) => screen.getByText(name, { selector: "span" });
const deleteButton = (name: string) => within(chip(name)).getByRole("button");
/** Nazwy widocznych chipów, w kolejności renderu. */
const chipNames = () =>
  screen
    .queryAllByRole("button")
    .map((b) => b.closest("span"))
    .filter((s): s is HTMLSpanElement => s !== null)
    .map((s) => s.textContent ?? "");

function typeName(value: string) {
  fireEvent.change(nameField(), { target: { value } });
}
function search(value: string) {
  fireEvent.change(searchField(), { target: { value } });
}

beforeEach(() => {
  h.rows = [];
  h.readError = null;
  h.readNull = false;
  h.readGate = null;
  h.reads.length = 0;
  h.creates.length = 0;
  h.createError = null;
  h.createGate = null;
  h.deletes.length = 0;
  h.deleteError = null;
  h.confirmAnswer = true;
  h.confirmCalls.length = 0;
  h.toast.success.mockReset();
  h.toast.error.mockReset();
});

describe("tagi - sklejenie trasy i odczyt", () => {
  it("nagłówek dokumentu ma SEKCYJNY tytuł, opis i noindex", async () => {
    // REGUŁA 1. Czytamy `head()` wprost i przez router - to drugie jest tym,
    // co trafia do `<HeadContent/>`.
    const expected = expect.arrayContaining([
      { title: "Tags | New European Strategies" },
      { name: "robots", content: "noindex, nofollow" },
      expect.objectContaining({ name: "description", content: expect.stringMatching(/tag/i) }),
    ]);
    expect(await routeMeta(Route as AnyRoute)).toEqual(expected);

    const view = await mountLoaded();
    expect(view.meta()).toEqual(expected);
  });

  it("odczyt bierze TYLKO kolumny ekranu, z filtrem dzierżawy i sortowaniem po nazwie", async () => {
    // REGUŁA 2. Literalna nazwa tabeli zostaje (bramka `generate:ts-sql-contract`).
    await mountLoaded([tag("t1", "AI", "ai")]);

    expect(h.reads).toEqual([
      { table: "tags", columns: "id, name, slug", eq: ["tenant_id", "tenant-1"], order: "name" },
    ]);
  });

  it("lista z cache edytora wpisu (bez sluga) NIE zastępuje własnego odczytu ekranu", async () => {
    // REGUŁA 2. Edytor wpisu kładzie pod `["tags", tenant]` wiersze `{ id, name }`.
    // Przy `staleTime` 5 min z `src/router.tsx` wspólny klucz oznaczał, że ten
    // ekran brał je za swoje i nie pytał bazy - slug był `undefined`.
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 5 * 60_000 } },
    });
    queryClient.setQueryData(["tags", "tenant-1"], [{ id: "t1", name: "Bezpieczeństwo" }]);

    await mountLoaded([tag("t1", "Bezpieczeństwo", "energy-security")], queryClient);
    search("security");

    await waitFor(() => expect(chipNames()).toEqual(["Bezpieczeństwo"]));
    expect(h.reads).toHaveLength(1);
  });
});

describe("tagi - lista, licznik i stany", () => {
  it("chipy idą w kolejności z bazy, a licznik pokazuje SAMĄ liczbę", async () => {
    await mountLoaded([tag("t1", "AI", "ai"), tag("t2", "Geopolityka", "geopolityka")]);

    expect(chipNames()).toEqual(["AI", "Geopolityka"]);
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("pusta baza mówi „Brak elementów”", async () => {
    await mountLoaded();

    expect(chipNames()).toEqual([]);
    expect(screen.getByText("Brak elementów")).toBeInTheDocument();
  });

  it("odpowiedź bez wierszy i bez błędu to pusta baza, nie wieczne wczytywanie", async () => {
    h.readNull = true;
    await mount();

    expect(await screen.findByText("Brak elementów")).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("WCZYTYWANIE nie udaje pustej bazy ani zerowego licznika", async () => {
    // REGUŁA 3. „Brak elementów” w trakcie odczytu to fałsz, na podstawie
    // którego redaktor dodaje tag, który już istnieje.
    const read = gate();
    h.readGate = read.promise;
    await mount([tag("t1", "AI", "ai")]);

    expect(await screen.findByText("Ładowanie…")).toBeInTheDocument();
    expect(screen.queryByText("Brak elementów")).toBeNull();
    expect(screen.queryByText("0")).toBeNull();

    read.release();
    await waitFor(() => expect(chipNames()).toEqual(["AI"]));
    expect(screen.queryByText("Ładowanie…")).toBeNull();
  });

  it("BŁĄD odczytu mówi o błędzie w regionie alertu, a nie „pusto”", async () => {
    // REGUŁA 3. Po błędzie RLS albo sieci ekran twierdził, że tagów nie ma.
    h.readError = { message: "permission denied for table tags" };
    await mount();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Nie udało się wczytać tagów. Odśwież stronę.",
    );
    expect(screen.queryByText("Brak elementów")).toBeNull();
    expect(screen.queryByText("0")).toBeNull();
  });
});

describe("tagi - wyszukiwanie", () => {
  const rows = [
    tag("t1", "AI", "ai"),
    tag("t2", "Bezpieczeństwo", "energy-security"),
    tag("t3", "Geopolityka", "geopolityka"),
  ];

  it("szuka po nazwie, bez względu na wielkość liter", async () => {
    await mountLoaded(rows);
    search("GEOPOL");

    await waitFor(() => expect(chipNames()).toEqual(["Geopolityka"]));
  });

  it("szuka też po SLUGU, którego chip nie pokazuje", async () => {
    // Slug to adres archiwum `/tag/<slug>` - redaktor wkleja go z przeglądarki.
    await mountLoaded(rows);
    search("security");

    await waitFor(() => expect(chipNames()).toEqual(["Bezpieczeństwo"]));
  });

  it("licznik pokazuje ODFILTROWANE ze WSZYSTKICH", async () => {
    await mountLoaded(rows);
    search("ai");

    await waitFor(() => expect(screen.getByText("1 / 3")).toBeInTheDocument());
  });

  it("brak trafień mówi „brak wyników”, a nie „brak elementów”", async () => {
    // Dwie różne informacje: puste archiwum kontra zbyt wąska fraza.
    await mountLoaded(rows);
    search("nieistniejący");

    await waitFor(() => expect(screen.getByText("Brak wyników dla filtrów")).toBeInTheDocument());
    expect(screen.queryByText("Brak elementów")).toBeNull();
  });

  it("czyszczenie pojawia się DOPIERO z frazą i przywraca PEŁNĄ listę", async () => {
    await mountLoaded(rows);
    expect(screen.queryByRole("button", { name: /Wyczyść/ })).toBeNull();

    search("ai");
    await waitFor(() => expect(chipNames()).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: /Wyczyść/ }));

    await waitFor(() => expect(chipNames()).toHaveLength(3));
    expect(searchField().value).toBe("");
    expect(screen.queryByRole("button", { name: /Wyczyść/ })).toBeNull();
  });
});

describe("tagi - dodawanie", () => {
  it("wysyła PRZYCIĘTĄ nazwę, czyści pole i pokazuje nowy tag po odświeżeniu listy", async () => {
    await mountLoaded([tag("t1", "Geopolityka", "geopolityka")]);
    typeName("  AI  ");
    fireEvent.submit(addForm());

    await waitFor(() => expect(chipNames()).toEqual(["AI", "Geopolityka"]));
    expect(h.creates).toEqual([{ data: { name: "AI" } }]);
    expect(nameField().value).toBe("");
    expect(h.reads).toHaveLength(2);
  });

  it("udane dodanie potwierdza się komunikatem, jak na siostrzanych ekranach", async () => {
    await mountLoaded();
    typeName("AI");
    fireEvent.submit(addForm());

    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith("Dodano"));
  });

  it("pusta albo biała nazwa NIC nie wysyła", async () => {
    await mountLoaded();
    fireEvent.submit(addForm());
    typeName("   ");
    fireEvent.submit(addForm());

    expect(h.creates).toEqual([]);
    expect(h.toast.error).not.toHaveBeenCalled();
  });

  it("przycisk „+” ma dostępną nazwę", async () => {
    // REGUŁA 7. Sama ikona daje czytnikowi ekranu przycisk bez nazwy.
    await mountLoaded();

    expect(addButton()).toHaveAccessibleName("Dodaj tag");
  });

  it("Enter W TRAKCIE zapisu NIE wysyła drugiego żądania, a przycisk jest zablokowany", async () => {
    // REGUŁA 4. Bez blokady drugi Enter dawał `ai-2` albo błąd unikalności sluga.
    const save = gate();
    h.createGate = save.promise;
    await mountLoaded();
    typeName("AI");
    fireEvent.submit(addForm());
    await waitFor(() => expect(addButton()).toBeDisabled());
    fireEvent.submit(addForm());
    fireEvent.click(addButton());

    expect(h.creates).toHaveLength(1);

    save.release();
    await waitFor(() => expect(chipNames()).toEqual(["AI"]));
    expect(addButton()).toBeEnabled();
    expect(h.creates).toHaveLength(1);
  });

  it("nazwa wpisana W TRAKCIE zapisu NIE znika po jego sukcesie", async () => {
    // Pole zostaje edytowalne, więc kolejny tag można zacząć pisać od razu -
    // czyszczenie dotyczy wyłącznie nazwy, która właśnie została zapisana.
    const save = gate();
    h.createGate = save.promise;
    await mountLoaded();
    typeName("AI");
    fireEvent.submit(addForm());
    typeName("Geopolityka");

    save.release();
    await waitFor(() => expect(chipNames()).toEqual(["AI"]));
    expect(nameField().value).toBe("Geopolityka");
  });

  it("blokada trwa do ODŚWIEŻENIA listy, więc ta sama nazwa nie przejdzie drugi raz", async () => {
    // REGUŁY 4 i 5 razem. Między sukcesem `createTag` a odświeżeniem listy
    // kontrola duplikatu widzi jeszcze starą listę. Gdyby blokada puszczała
    // wcześniej, ponowny Enter z tą samą nazwą dawałby `ai-2`.
    await mountLoaded();
    const refetch = gate();
    h.readGate = refetch.promise;
    typeName("AI");
    fireEvent.submit(addForm());
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith("Dodano"));
    await waitFor(() => expect(nameField().value).toBe(""));

    expect(addButton()).toBeDisabled();
    typeName("AI");
    fireEvent.submit(addForm());
    expect(h.creates).toHaveLength(1);

    refetch.release();
    await waitFor(() => expect(chipNames()).toEqual(["AI"]));
    expect(addButton()).toBeEnabled();
    fireEvent.submit(addForm());

    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith("Tag „AI” już istnieje."));
    expect(h.creates).toHaveLength(1);
  });

  it("tag o ISTNIEJĄCEJ nazwie nie trafia na serwer (wielkość liter bez znaczenia)", async () => {
    // REGUŁA 5. Serwer zrobiłby z tego osobny tag `ai-2` o tej samej nazwie.
    await mountLoaded([tag("t1", "AI", "ai")]);
    typeName(" ai ");
    fireEvent.submit(addForm());

    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith("Tag „AI” już istnieje."));
    expect(h.creates).toEqual([]);
    expect(nameField().value).toBe(" ai ");
  });

  it("PORAŻKA dodania mówi o powodzie i ZOSTAWIA wpisaną nazwę", async () => {
    h.createError = new Error("Too many requests");
    await mountLoaded();
    typeName("AI");
    fireEvent.submit(addForm());

    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith("Too many requests"));
    expect(nameField().value).toBe("AI");
    expect(addButton()).toBeEnabled();
    expect(h.toast.success).not.toHaveBeenCalled();
  });

  it("porażka, która nie jest `Error`, też trafia do komunikatu", async () => {
    h.createError = "rate limited";
    await mountLoaded();
    typeName("AI");
    fireEvent.submit(addForm());

    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith("rate limited"));
  });
});

describe("tagi - usuwanie", () => {
  const rows = [tag("t1", "AI", "ai"), tag("t2", "Geopolityka", "geopolityka")];

  it("każde × mówi, KTÓRY tag usuwa", async () => {
    // REGUŁA 7. Rząd identycznych „Usuń” jest dla czytnika ekranu bezużyteczny.
    await mountLoaded(rows);

    expect(deleteButton("AI")).toHaveAccessibleName("Usuń tag AI");
    expect(deleteButton("Geopolityka")).toHaveAccessibleName("Usuń tag Geopolityka");
  });

  it("PYTA przed usunięciem - destrukcyjnie i z nazwą tagu", async () => {
    // REGUŁA 6. `post_tags` kasuje się kaskadowo: bez pytania jedno kliknięcie
    // odpinało tag od wszystkich wpisów.
    await mountLoaded(rows);
    fireEvent.click(deleteButton("Geopolityka"));

    await waitFor(() => expect(h.confirmCalls).toHaveLength(1));
    expect(h.confirmCalls[0]).toEqual({
      title: "Usunąć tag „Geopolityka”?",
      description:
        "Tag zniknie ze wszystkich wpisów, do których jest przypięty. Tej operacji nie można cofnąć.",
      destructive: true,
      confirmLabel: "Usuń",
    });
  });

  it("odmowa NIE usuwa", async () => {
    h.confirmAnswer = false;
    await mountLoaded(rows);
    fireEvent.click(deleteButton("AI"));

    await waitFor(() => expect(h.confirmCalls).toHaveLength(1));
    expect(h.deletes).toEqual([]);
    expect(chipNames()).toEqual(["AI", "Geopolityka"]);
  });

  it("zgoda usuwa DOKŁADNIE wskazany tag i zdejmuje go z listy", async () => {
    await mountLoaded(rows);
    fireEvent.click(deleteButton("Geopolityka"));

    await waitFor(() => expect(chipNames()).toEqual(["AI"]));
    expect(h.deletes).toEqual([{ data: { id: "t2" } }]);
  });

  it("usunięcie unieważnia relację `post_tags` z cache edytora wpisu", async () => {
    // REGUŁA 8. Klient z tym samym `staleTime` co aplikacja; `fetchQuery` to
    // odczyt, który robi edytor przy ponownym wejściu na wpis.
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 5 * 60_000 } },
    });
    queryClient.setQueryData(["post-tags", "p1"], [{ tag_id: "t2" }]);
    const editorRead = vi.fn(async () => [] as { tag_id: string }[]);
    const readRelation = () =>
      queryClient.fetchQuery({ queryKey: ["post-tags", "p1"], queryFn: editorRead });
    // Warunek wstępny: świeży cache oddaje relację bez pytania bazy.
    expect(await readRelation()).toEqual([{ tag_id: "t2" }]);
    expect(editorRead).not.toHaveBeenCalled();

    await mountLoaded(rows, queryClient);
    fireEvent.click(deleteButton("Geopolityka"));
    await waitFor(() => expect(chipNames()).toEqual(["AI"]));

    expect(await readRelation()).toEqual([]);
    expect(editorRead).toHaveBeenCalledTimes(1);
  });

  it("udane usunięcie potwierdza się komunikatem", async () => {
    await mountLoaded(rows);
    fireEvent.click(deleteButton("AI"));

    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith("Usunięto"));
  });

  it("PORAŻKA usuwania mówi o powodzie i zostawia tag na liście", async () => {
    h.deleteError = new Error("permission denied");
    await mountLoaded(rows);
    fireEvent.click(deleteButton("AI"));

    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith("permission denied"));
    expect(chipNames()).toEqual(["AI", "Geopolityka"]);
    expect(h.toast.success).not.toHaveBeenCalled();
  });

  it("porażka usuwania, która nie jest `Error`, też trafia do komunikatu", async () => {
    h.deleteError = "network down";
    await mountLoaded(rows);
    fireEvent.click(deleteButton("AI"));

    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith("network down"));
  });
});
