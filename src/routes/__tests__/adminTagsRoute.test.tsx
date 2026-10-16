// TRASA TAGÓW `/admin/tags`. Do 16.10.2026 na zerze - najmniejszy ekran
// taksonomii, a jedyny, z którego usunięcie jednego elementu odpina go od
// WSZYSTKICH wpisów naraz (`post_tags.tag_id ... ON DELETE CASCADE`).
//
// Reguły pod testem:
//
//   1. NAGŁÓWEK SEKCJI. Prywatny ekran panelu ma tytuł karty z nazwą sekcji
//      (wspólne `adminPageHead`, AGENTS.md) i `noindex` - wcześniej trasa nie
//      miała `head()` wcale, więc karta nosiła ogólny tytuł panelu.
//   2. KSZTAŁT ZAPYTANIA. Lista pyta tylko o `id, name, slug` (bez `*`), w
//      obrębie dzierżawy z sesji, alfabetycznie - i trzyma się WŁASNEGO klucza
//      cache: pod gołym `["tags", tenant]` edytor wpisu zostawia wiersze bez
//      sluga, a przy `staleTime` 5 min ekran tagów brał je bez pobrania, przez
//      co szukanie po slugu nie znajdowało nic.
//   3. TRZY STANY PUSTKI. „Brak elementów” wolno pokazać dopiero po
//      wczytaniu; w trakcie ładowania jest „Ładowanie…”, a błąd zapytania
//      jest komunikatem błędu (`role="alert"`), nie fałszywą pustką.
//   4. DODAWANIE. Nazwa idzie do `createTag` przycięta, pole się czyści, lista
//      się odświeża; pusta nazwa nie wywołuje serwera; drugi Enter w trakcie
//      żądania NIE tworzy duplikatu; błąd serwera zostawia nazwę w polu.
//      Czyści się tylko nazwa, która poszła na serwer - pole jest edytowalne
//      w trakcie żądania, więc zaczęty już kolejny tag nie może zniknąć.
//   5. USUWANIE wymaga potwierdzenia (`confirmDialog({ destructive: true })`
//      jak w kategoriach) z nazwą tagu w treści; anulowanie nie dotyka serwera.
//   6. DUPLIKAT NAZWY NIE TRAFIA NA SERWER. `createTag` dokleja do sluga
//      sufiks, więc drugi „NATO” stawał się osobnym tagiem `nato-2` o tej samej
//      nazwie - nieodróżnialnym w selektorach tagów. Kontrola (przycięta nazwa,
//      bez wielkości liter) patrzy na CAŁĄ wczytaną listę, nie na wynik
//      szukajki, dlatego blokada dodawania trwa do jej ODŚWIEŻENIA, a nie
//      tylko do odpowiedzi `createTag`.
//   7. USUNIĘCIE ZDEJMUJE RELACJE WPISÓW Z CACHE. `post_tags` kasuje się
//      kaskadowo, a edytor wpisu trzyma `["post-tags", wpis]` w cache
//      (`staleTime` 5 min). Jego zapis (`updatePost`: delete relacji, potem
//      insert) z usuniętym id padał na kluczu obcym - już PO skasowaniu
//      wszystkich tagów wpisu. Samo unieważnienie nie wystarcza: przemontowany
//      edytor dostaje unieważnioną relację NAJPIERW, zanim wróci odczyt bazy.
//   8. KAŻDE × MA NAZWĘ Z TAGIEM. Rząd identycznych „Usuń” nie mówi
//      czytnikowi ekranu, KTÓRY tag zniknie.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { AnyRoute } from "@tanstack/react-router";

type Row = { id: string; name: string; slug: string };

const h = vi.hoisted(() => ({
  rows: [] as { id: string; name: string; slug: string }[] | null,
  loadError: null as { message: string } | null,
  /** Gdy ustawione - zapytanie listy czeka na tę obietnicę (stan ładowania). */
  loadGate: null as Promise<void> | null,
  queries: [] as { table: string; calls: [string, unknown[]][] }[],
  creates: [] as unknown[],
  createImpl: null as null | ((payload: unknown) => Promise<unknown>),
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
vi.mock("@/lib/content.functions", () => ({ createTag: "create", deleteTag: "delete" }));
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: (fn: unknown) => async (payload: unknown) => {
    if (fn === "create") {
      h.creates.push(payload);
      return h.createImpl ? h.createImpl(payload) : { id: "new", slug: "new", name: "new" };
    }
    h.deletes.push(payload);
    if (h.deleteError) throw h.deleteError;
    return { ok: true };
  },
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      const q = { table, calls: [] as [string, unknown[]][] };
      h.queries.push(q);
      const chain = {
        select: (...a: unknown[]) => (q.calls.push(["select", a]), chain),
        eq: (...a: unknown[]) => (q.calls.push(["eq", a]), chain),
        order: async (...a: unknown[]) => {
          q.calls.push(["order", a]);
          if (h.loadGate) await h.loadGate;
          return { data: h.rows, error: h.loadError };
        },
      };
      return chain;
    },
  },
}));

import "@/test/i18nReal";
// `admin.list.*` (szukajka, „Wyczyść”, „Brak wyników”) mieszka w nakładce,
// którą w aplikacji rejestruje layout `/admin`, a nie sama trasa.
import "@/lib/i18n-admin-extras";
import { routeHead } from "@/test/routeHarness";
import { axeViolations, summarize } from "@/test/axe";
import { Route } from "@/routes/admin.tags";

let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

const tag = (id: string, name: string, slug: string): Row => ({ id, name, slug });

async function setup(rows: Row[] | null = []) {
  h.rows = rows;
  const Component = (Route as AnyRoute).options.component as () => ReactNode;
  const view = render(<Component />, { wrapper });
  if (rows?.length) await screen.findByText(rows[0].name);
  else await screen.findByText("Brak elementów");
  return view;
}

const nameInput = () => screen.getByPlaceholderText("Nazwa tagu i Enter") as HTMLInputElement;
const searchInput = () => screen.getByPlaceholderText("Szukaj tagów…") as HTMLInputElement;
const addButton = () => screen.getByRole("button", { name: "Dodaj" });
const counter = () => screen.getByRole("heading", { level: 1 }).nextElementSibling as HTMLElement;
const chip = (name: string) => screen.getByText(name).closest("span") as HTMLElement;
// Chip ma jeden przycisk; jego dostępną nazwę sprawdza osobny test (reguła 8).
const deleteButtonOf = (name: string) => within(chip(name)).getByRole("button");

function submitName(value: string) {
  fireEvent.change(nameInput(), { target: { value } });
  fireEvent.submit(nameInput().closest("form") as HTMLFormElement);
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  h.rows = [];
  h.loadError = null;
  h.loadGate = null;
  h.queries.length = 0;
  h.creates.length = 0;
  h.createImpl = null;
  h.deletes.length = 0;
  h.deleteError = null;
  h.confirmAnswer = true;
  h.confirmCalls.length = 0;
  h.toast.success.mockReset();
  h.toast.error.mockReset();
});

describe("/admin/tags - nagłówek sekcji", () => {
  it("head() daje tytuł karty z nazwą sekcji i trzyma ekran poza indeksem", () => {
    const { meta } = routeHead(Route as AnyRoute);
    expect(meta).toEqual(
      expect.arrayContaining([
        { title: "Tags | New European Strategies" },
        { property: "og:title", content: "Tags | New European Strategies" },
        { name: "robots", content: "noindex, nofollow" },
      ]),
    );
    const description = meta?.find((m) => (m as { name?: string }).name === "description") as {
      content: string;
    };
    expect(description.content).toMatch(/tags/i);
  });
});

describe("/admin/tags - lista i stany pustki", () => {
  it("pyta tylko o id, nazwę i slug tagów bieżącej dzierżawy, alfabetycznie", async () => {
    await setup([tag("t1", "Energetyka", "energetyka"), tag("t2", "NATO", "nato")]);

    expect(h.queries).toEqual([
      {
        table: "tags",
        calls: [
          ["select", ["id, name, slug"]],
          ["eq", ["tenant_id", "tenant-1"]],
          ["order", ["name"]],
        ],
      },
    ]);
    expect(screen.getByRole("heading", { level: 1, name: "Tagi" })).toBeInTheDocument();
    expect(screen.getByText("Energetyka")).toBeInTheDocument();
    expect(screen.getByText("NATO")).toBeInTheDocument();
    // Bez filtra licznik to SAMA liczba - bez „/ łącznie”.
    expect(counter().textContent).toBe("2");
    expect(screen.queryByText("Brak elementów")).toBeNull();
  });

  it("pusta baza (także `data: null`) mówi „Brak elementów”", async () => {
    await setup(null);
    expect(counter().textContent).toBe("0");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("w trakcie ładowania mówi „Ładowanie…”, a NIE „Brak elementów”", async () => {
    const gate = deferred<void>();
    h.loadGate = gate.promise;
    h.rows = [tag("t1", "Energetyka", "energetyka")];
    const Component = (Route as AnyRoute).options.component as () => ReactNode;
    render(<Component />, { wrapper });

    expect(await screen.findByText("Ładowanie…")).toBeInTheDocument();
    expect(screen.queryByText("Brak elementów")).toBeNull();

    gate.resolve();
    expect(await screen.findByText("Energetyka")).toBeInTheDocument();
    expect(screen.queryByText("Ładowanie…")).toBeNull();
  });

  it("błąd zapytania jest komunikatem błędu, a nie fałszywą pustką", async () => {
    // Dawniej panel mówił wtedy „Brak elementów” - redaktor dodawał tag
    // „od nowa” i dostawał duplikat ze slugiem „-2”.
    h.loadError = { message: "permission denied for table tags" };
    const Component = (Route as AnyRoute).options.component as () => ReactNode;
    render(<Component />, { wrapper });

    expect(await screen.findByRole("alert")).toHaveTextContent("permission denied for table tags");
    expect(screen.queryByText("Brak elementów")).toBeNull();
    expect(screen.queryByText("Ładowanie…")).toBeNull();
  });
});

describe("/admin/tags - wyszukiwanie", () => {
  const rows = [
    tag("t1", "Energetyka", "energetyka"),
    tag("t2", "Szczyt NATO", "nato-summit"),
    tag("t3", "Ukraina", "ukraina"),
  ];

  it("szuka po nazwie i po slugu, bez wielkości liter i spacji na brzegach", async () => {
    await setup(rows);

    fireEvent.change(searchInput(), { target: { value: "  SZCZYT " } });
    expect(screen.queryByText("Energetyka")).toBeNull();
    expect(screen.getByText("Szczyt NATO")).toBeInTheDocument();
    expect(counter().textContent).toBe("1 / 3");

    // Slugu nie widać na ekranie, ale szukajka go obejmuje.
    fireEvent.change(searchInput(), { target: { value: "summit" } });
    expect(screen.getByText("Szczyt NATO")).toBeInTheDocument();
    expect(screen.queryByText("Ukraina")).toBeNull();
  });

  it("brak trafień mówi „Brak wyników dla filtrów”, a „Wyczyść” wraca do pełnej listy", async () => {
    await setup(rows);
    expect(screen.queryByRole("button", { name: /Wyczyść/ })).toBeNull();

    fireEvent.change(searchInput(), { target: { value: "zzz" } });
    expect(screen.getByText("Brak wyników dla filtrów")).toBeInTheDocument();
    expect(screen.queryByText("Brak elementów")).toBeNull();
    expect(counter().textContent).toBe("0 / 3");

    fireEvent.click(screen.getByRole("button", { name: /Wyczyść/ }));
    expect(searchInput().value).toBe("");
    expect(screen.getByText("Energetyka")).toBeInTheDocument();
    expect(counter().textContent).toBe("3");
    expect(screen.queryByRole("button", { name: /Wyczyść/ })).toBeNull();
  });

  it("wiersze bez sluga z cache edytora wpisu nie psują szukania po slugu", async () => {
    // Odtworzenie ścieżki z aplikacji: edytor wpisu (usePostEditorData) pisze do
    // ["tags", tenant] wiersze `id, name`, a QueryClient aplikacji ma
    // staleTime 5 min. Pod tym samym kluczem ekran tagów nie pytał bazy wcale.
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 5 * 60_000 } },
    });
    queryClient.setQueryData(["tags", "tenant-1"], [{ id: "t2", name: "Szczyt NATO" }]);
    await setup(rows);

    expect(h.queries).toHaveLength(1);
    fireEvent.change(searchInput(), { target: { value: "nato-summit" } });
    expect(screen.getByText("Szczyt NATO")).toBeInTheDocument();
    expect(screen.queryByText("Brak wyników dla filtrów")).toBeNull();
  });
});

describe("/admin/tags - dodawanie", () => {
  it("wysyła przyciętą nazwę, czyści pole i odświeża listę", async () => {
    await setup([tag("t1", "Energetyka", "energetyka")]);
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    h.createImpl = async () => {
      h.rows = [tag("t1", "Energetyka", "energetyka"), tag("t9", "Klimat", "klimat")];
      return { id: "t9", slug: "klimat", name: "Klimat" };
    };

    submitName("  Klimat  ");

    expect(await screen.findByText("Klimat")).toBeInTheDocument();
    expect(h.creates).toEqual([{ data: { name: "Klimat" } }]);
    expect(nameInput().value).toBe("");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["tags"] });
    expect(counter().textContent).toBe("2");
    expect(h.toast.error).not.toHaveBeenCalled();
  });

  it("pusta albo biała nazwa nie wywołuje serwera", async () => {
    await setup();
    submitName("   ");
    fireEvent.click(addButton());
    expect(h.creates).toEqual([]);
  });

  it("drugi Enter w trakcie żądania nie tworzy duplikatu; przycisk jest wtedy zablokowany", async () => {
    await setup();
    const pending = deferred<unknown>();
    h.createImpl = () => pending.promise;

    submitName("Klimat");
    fireEvent.submit(nameInput().closest("form") as HTMLFormElement);
    fireEvent.submit(nameInput().closest("form") as HTMLFormElement);

    expect(h.creates).toEqual([{ data: { name: "Klimat" } }]);
    expect(addButton()).toBeDisabled();

    pending.resolve({ id: "t9", slug: "klimat", name: "Klimat" });
    await waitFor(() => expect(addButton()).not.toBeDisabled());
    expect(nameInput().value).toBe("");
  });

  it("nazwa wpisana W TRAKCIE żądania nie znika po jego sukcesie", async () => {
    // Reguła 4: pole zostaje edytowalne, więc redaktor zaczyna kolejny tag od
    // razu - czyszczenie dotyczy wyłącznie nazwy, która właśnie poszła.
    await setup();
    const pending = deferred<unknown>();
    h.createImpl = () => pending.promise;

    submitName("Klimat");
    fireEvent.change(nameInput(), { target: { value: "Energ" } });
    pending.resolve({ id: "t9", slug: "klimat", name: "Klimat" });

    await waitFor(() => expect(addButton()).not.toBeDisabled());
    expect(h.creates).toEqual([{ data: { name: "Klimat" } }]);
    expect(nameInput().value).toBe("Energ");
  });

  it("nazwa istniejącego tagu (inne litery, spacje) nie trafia na serwer", async () => {
    // Reguła 6: serwer zrobiłby z tego osobny tag `nato-2` o nazwie „NATO”.
    await setup([tag("t1", "Energetyka", "energetyka"), tag("t2", "NATO", "nato")]);
    // Szukajka ukrywa „NATO”, ale kontrola patrzy na całą listę.
    fireEvent.change(searchInput(), { target: { value: "energ" } });
    expect(screen.queryByText("NATO")).toBeNull();

    submitName("  nato ");

    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith("Tag „NATO” już istnieje."));
    expect(h.creates).toEqual([]);
    // Nazwa zostaje w polu do poprawki, przycisk nie wisi zablokowany.
    expect(nameInput().value).toBe("  nato ");
    expect(addButton()).not.toBeDisabled();
  });

  it("blokada trwa do ODŚWIEŻENIA listy, więc ta sama nazwa nie przejdzie drugi raz", async () => {
    // Reguły 4 i 6 razem. Między sukcesem `createTag` a odświeżeniem listy
    // kontrola duplikatu widzi starą listę - blokada zwolniona wcześniej
    // przepuszczała ponowny Enter z tą samą nazwą (drugi „Klimat”, `klimat-2`).
    await setup();
    const refetch = deferred<void>();
    h.loadGate = refetch.promise;
    h.createImpl = async () => {
      h.rows = [tag("t9", "Klimat", "klimat")];
      return { id: "t9", slug: "klimat", name: "Klimat" };
    };

    submitName("Klimat");
    await waitFor(() => expect(nameInput().value).toBe(""));
    expect(addButton()).toBeDisabled();
    submitName("Klimat");
    expect(h.creates).toHaveLength(1);

    refetch.resolve();
    expect(await screen.findByText("Klimat")).toBeInTheDocument();
    await waitFor(() => expect(addButton()).not.toBeDisabled());
    fireEvent.submit(nameInput().closest("form") as HTMLFormElement);

    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith("Tag „Klimat” już istnieje."));
    expect(h.creates).toHaveLength(1);
  });

  it("błąd serwera trafia do toastu, a nazwa zostaje w polu do poprawki", async () => {
    await setup();
    h.createImpl = async () => {
      throw new Error("Too many requests");
    };

    submitName("Klimat");

    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith("Too many requests"));
    expect(nameInput().value).toBe("Klimat");
    await waitFor(() => expect(addButton()).not.toBeDisabled());
  });

  it("błąd niebędący `Error` też trafia do toastu jako tekst", async () => {
    await setup();
    h.createImpl = async () => {
      throw "network down";
    };

    submitName("Klimat");

    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith("network down"));
  });

  it("przycisk dodawania (sama ikona) ma dostępną nazwę - ekran bez naruszeń axe", async () => {
    // Bez `aria-label` czytnik ekranu ogłaszał samo „przycisk” (axe: button-name).
    const { container } = await setup([tag("t1", "Energetyka", "energetyka")]);
    const violations = await axeViolations(container);
    expect(summarize(violations)).toBe("");
    expect(addButton()).toHaveAttribute("type", "submit");
  });
});

describe("/admin/tags - usuwanie", () => {
  const rows = [tag("t1", "Energetyka", "energetyka"), tag("t2", "NATO", "nato")];

  it("pyta o potwierdzenie z nazwą tagu, potem usuwa i odświeża listę", async () => {
    await setup(rows);
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    h.rows = [rows[0]];

    fireEvent.click(deleteButtonOf("NATO"));

    await waitFor(() => expect(screen.queryByText("NATO")).toBeNull());
    expect(h.confirmCalls).toEqual([
      { title: "Na pewno usunąć?", description: "NATO", destructive: true, confirmLabel: "Usuń" },
    ]);
    expect(h.deletes).toEqual([{ data: { id: "t2" } }]);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["tags"] });
    expect(screen.getByText("Energetyka")).toBeInTheDocument();
  });

  it("każde × mówi, KTÓRY tag usuwa", async () => {
    // Reguła 8: rząd identycznych „Usuń” jest dla czytnika ekranu bezużyteczny.
    await setup(rows);
    expect(deleteButtonOf("Energetyka")).toHaveAccessibleName("Usuń tag Energetyka");
    expect(deleteButtonOf("NATO")).toHaveAccessibleName("Usuń tag NATO");
  });

  it("usunięcie zdejmuje relacje `post_tags` z cache edytora wpisu", async () => {
    // Reguła 7. Klient ze `staleTime` aplikacji; edytor przy powrocie na wpis
    // czyta `["post-tags", id]` przez `useQuery` (usePostEditorData).
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 5 * 60_000 } },
    });
    queryClient.setQueryData(["post-tags", "p1"], [{ tag_id: "t2" }]);

    await setup(rows);
    h.rows = [rows[0]];
    fireEvent.click(deleteButtonOf("NATO"));
    await waitFor(() => expect(screen.queryByText("NATO")).toBeNull());
    expect(queryClient.getQueryData(["post-tags", "p1"])).toBeUndefined();

    // Powrót na wpis, odczyt bazy jeszcze w locie: edytor nie może dostać
    // relacji z usuniętym id - uznałby ją za wczytaną i wysłał przy zapisie.
    const editorRead = deferred<{ tag_id: string }[]>();
    const editor = renderHook(
      () => useQuery({ queryKey: ["post-tags", "p1"], queryFn: () => editorRead.promise }),
      { wrapper },
    );
    expect(editor.result.current.data).toBeUndefined();
    editorRead.resolve([]);
    await waitFor(() => expect(editor.result.current.data).toEqual([]));
  });

  it("anulowanie potwierdzenia nie dotyka serwera i zostawia tag", async () => {
    await setup(rows);
    h.confirmAnswer = false;

    fireEvent.click(deleteButtonOf("NATO"));

    await waitFor(() => expect(h.confirmCalls).toHaveLength(1));
    expect(h.deletes).toEqual([]);
    expect(screen.getByText("NATO")).toBeInTheDocument();
  });

  it("błąd usuwania trafia do toastu (także gdy nie jest `Error`)", async () => {
    await setup(rows);
    h.deleteError = new Error("row-level security");
    fireEvent.click(deleteButtonOf("NATO"));
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith("row-level security"));

    h.deleteError = { toString: () => "boom" };
    fireEvent.click(deleteButtonOf("Energetyka"));
    await waitFor(() => expect(h.toast.error).toHaveBeenLastCalledWith("boom"));
    expect(screen.getByText("NATO")).toBeInTheDocument();
  });
});
