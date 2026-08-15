// PostListEditor: trzy naprawy "panel klamie / panel oferuje martwe pole".
//
//  1. LICZNIK. Zapytanie liczace "pasujace wpisy" mialo kategorie, tagi i daty
//     w KLUCZU react-query, ale queryFn ich nie stosowal - panel pokazywal
//     liczbe wszystkich opublikowanych wpisow (np. "142" przy kategorii z
//     trzema wpisami) i wprowadzal redakcje w blad.
//  2. PODGLAD MINIATUR. Sortowal po wlasnej kopii mapowania kolumn, wiec dla
//     "created_at" pokazywal inna kolejnosc niz realny widget. Kolumna
//     pochodzi teraz z warstwy zapytania (`postListOrderColumn`).
//  3. USTAWIENIE AUTORA. Bylo widoczne w kazdym wariancie, takze w tych, ktore
//     bylinu nie rysuja. Widocznosc pola pochodzi teraz z tej samej listy, na
//     ktorej opiera sie zapytanie (`postListVariantHasByline`).
//
// Plus: kontrolka autoodtwarzania karuzeli (dotad pole istnialo wylacznie w
// martwym schemacie) jest w panelu i zapisuje PRAWDZIWY boolean.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
// Prawdziwe zasoby i18n: bez tego `t()` zwraca GOŁY KLUCZ, a asercje na
// widoczny tekst przechodziły wyłącznie dzięki `defaultValue` wpisanemu przy
// wywołaniu - czyli test sprawdzał kopię napisu z kodu, a nie to, co widzi
// użytkownik. Import wciąga rdzeń słownika (nakładki `i18n-*` dociąga sam
// komponent), więc asercja mierzy teraz wartość ze słownika.
import "@/lib/i18n";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Json, WidgetContent } from "@/lib/builder/types";

interface RecordedCall {
  table: string;
  ops: Array<{ method: string; args: unknown[] }>;
}

const db = vi.hoisted(() => ({
  calls: [] as RecordedCall[],
  rows: {} as Record<string, unknown[]>,
  count: 0,
}));

vi.mock("@/integrations/supabase/client", () => {
  const makeBuilder = (table: string) => {
    const record: RecordedCall = { table, ops: [] };
    db.calls.push(record);
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "in", "not", "order", "range", "limit", "gte", "lte"]) {
      b[m] = (...args: unknown[]) => {
        record.ops.push({ method: m, args });
        return b;
      };
    }
    b.then = (resolve: (v: unknown) => unknown) =>
      resolve({ data: db.rows[table] ?? [], error: null, count: db.count });
    return b;
  };
  return {
    supabase: {
      from: (t: string) => makeBuilder(t),
      rpc: async () => ({ data: [], error: null }),
    },
  };
});

// BEZ atrapy `react-i18next`: prawdziwy hak na prawdziwym słowniku (import
// `@/lib/i18n` wyżej). Atrapa zwracała `opts.defaultValue ?? key`, czyli test
// czytał kopię napisu wpisaną w kodzie komponentu, a nie wartość ze słownika -
// po zdjęciu zapasowych tekstów nie miała już czego zwracać. Mockować się jej
// nie da: `@/lib/i18n` sam importuje `react-i18next`, więc atrapa sięgająca po
// słownik zamyka cykl importów i test wisi bez komunikatu.

import { PostListEditor } from "../PostListEditor";
import { postListOrderColumn, postListVariantHasByline } from "@/lib/builder/postListQuery";

const VARIANTS = [
  "card",
  "boxed-grid",
  "minimal",
  "classic",
  "flex-grid",
  "overlay",
  "list",
  "boxed-list",
  "numbered",
  "ranked",
] as const;

function renderEditor(
  c: WidgetContent,
  opts: { lang?: "pl" | "en"; widgetType?: "post-list" | "carousel" } = {},
) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const setContent = vi.fn<(k: string, v: Json) => void>();
  const view = render(
    <QueryClientProvider client={qc}>
      <PostListEditor
        c={c}
        lang={opts.lang ?? "pl"}
        setContent={setContent}
        widgetType={opts.widgetType}
      />
    </QueryClientProvider>,
  );
  return { ...view, setContent };
}

/** Zapytanie licznika: `posts` + select z `{ count: "exact", head: true }`. */
const countCall = (): RecordedCall | undefined =>
  db.calls.find(
    (call) =>
      call.table === "posts" &&
      call.ops.some(
        (op) =>
          op.method === "select" &&
          typeof op.args[1] === "object" &&
          op.args[1] !== null &&
          (op.args[1] as { head?: boolean }).head === true,
      ),
  );

/** Zapytanie podgladu miniatur: `posts` + select z lista kolumn. */
const previewCall = (): RecordedCall | undefined =>
  db.calls.find(
    (call) =>
      call.table === "posts" &&
      call.ops.some((op) => op.method === "select" && op.args[1] === undefined),
  );

const opsOf = (call: RecordedCall | undefined) =>
  (call?.ops ?? []).map((op) => [op.method, ...op.args]);

beforeEach(() => {
  db.calls = [];
  db.rows = {};
  db.count = 7;
});
afterEach(cleanup);

describe("PostListEditor - licznik pasujacych wpisow stosuje WSZYSTKIE filtry", () => {
  it("zawęża po kategoriach, tagach, datach, formacie i autorze", async () => {
    db.rows.categories = [{ id: "cat-1", slug: "polityka", name_pl: "Polityka" }];
    db.rows.post_categories = [{ post_id: "p1" }, { post_id: "p2" }];
    db.rows.tags = [{ id: "tag-1", slug: "ue", name: "UE" }];
    db.rows.post_tags = [{ post_id: "p2" }];

    renderEditor({
      categoriesCsv: "polityka",
      tagsCsv: "ue",
      dateFrom: "2026-01-01",
      dateTo: "2026-02-01",
      postFormat: "video",
      authorId: "author-9",
    });

    await waitFor(() => expect(countCall()).toBeDefined());
    const ops = opsOf(countCall());

    // Przeciecie zbiorow kategorii ({p1, p2}) i tagow ({p2}) zostawia p2.
    expect(ops).toContainEqual(["in", "id", ["p2"]]);
    expect(ops).toContainEqual(["gte", "published_at", "2026-01-01T00:00:00Z"]);
    expect(ops).toContainEqual(["lte", "published_at", "2026-02-01T23:59:59Z"]);
    expect(ops).toContainEqual(["eq", "post_format", "video"]);
    expect(ops).toContainEqual(["eq", "author_id", "author-9"]);
    // Ten sam warunek co realne zapytanie widgetu: bez wpisow w koszu.
    expect(ops).toContainEqual(["is", "deleted_at", null]);
  });

  it("wyklucza kategorie i konkretne ID", async () => {
    db.rows.categories = [{ id: "cat-9", slug: "sport", name_pl: "Sport" }];
    db.rows.post_categories = [{ post_id: "x1" }];

    renderEditor({ excludeCategoriesCsv: "sport", excludeIdsCsv: "manual-1, manual-2" });

    await waitFor(() => expect(countCall()).toBeDefined());
    const notOp = (countCall()?.ops ?? []).find((op) => op.method === "not");
    expect(notOp).toBeDefined();
    const clause = String(notOp?.args[2]);
    expect(clause).toContain("x1");
    expect(clause).toContain("manual-1");
    expect(clause).toContain("manual-2");
  });

  it("pokazuje zero, gdy filtry nie moga dac zadnego wyniku", async () => {
    // Kategoria istnieje, ale nie ma w niej ani jednego wpisu.
    db.rows.categories = [{ id: "cat-empty", slug: "pusta", name_pl: "Pusta" }];
    db.rows.post_categories = [];
    db.count = 142;

    renderEditor({ categoriesCsv: "pusta" });

    // Asercja na WYRENDEROWANY napis ze słownika (`builder.postListEditor.matchCount`),
    // a nie na syntetyczne `klucz:licznik` z dawnej atrapy `t`. Dopasowanie po
    // regexie, bo licznik stoi w środku zdania z drugą interpolacją (język podglądu).
    expect(await screen.findByText(/Pasujących wpisów:\s*0\b/)).toBeInTheDocument();
  });
});

describe("PostListEditor - podglad sortuje tak samo jak widget", () => {
  it.each(["published_at", "created_at", "title", "popular", "random"] as const)(
    "sortowanie %s uzywa kolumny z warstwy zapytania",
    async (orderBy) => {
      renderEditor({ orderBy });
      await waitFor(() => expect(previewCall()).toBeDefined());
      const orderOp = (previewCall()?.ops ?? []).find((op) => op.method === "order");
      expect(orderOp?.args[0]).toBe(postListOrderColumn(orderBy, "pl"));
    },
  );

  it("created_at nie degraduje juz cicho do published_at", async () => {
    renderEditor({ orderBy: "created_at", orderDir: "asc" });
    await waitFor(() => expect(previewCall()).toBeDefined());
    const orderOp = (previewCall()?.ops ?? []).find((op) => op.method === "order");
    expect(orderOp?.args[0]).toBe("created_at");
    expect(orderOp?.args[1]).toEqual({ ascending: true });
  });

  it("sortowanie po tytule respektuje jezyk podgladu", async () => {
    renderEditor({ orderBy: "title" }, { lang: "en" });
    await waitFor(() => expect(previewCall()).toBeDefined());
    const orderOp = (previewCall()?.ops ?? []).find((op) => op.method === "order");
    expect(orderOp?.args[0]).toBe("title_en");
  });

  it("nieznane sortowanie z tresci degraduje do published_at, nie wysadza zapytania", async () => {
    renderEditor({ orderBy: "sabotage" });
    await waitFor(() => expect(previewCall()).toBeDefined());
    const orderOp = (previewCall()?.ops ?? []).find((op) => op.method === "order");
    expect(orderOp?.args[0]).toBe("published_at");
  });
});

describe("PostListEditor - ustawienie autora tylko tam, gdzie autor sie renderuje", () => {
  const AUTHOR_HINT = "Sposób prezentacji autora pod tytułem.";

  it.each(VARIANTS)("wariant %s: pole autora widoczne dokladnie gdy jest byline", (variant) => {
    const view = renderEditor({ variant });
    const visible = screen.queryByText(AUTHOR_HINT) !== null;
    expect(visible).toBe(postListVariantHasByline(variant));
    view.unmount();
  });

  it("etykieta autora pojawia sie tylko w trybie 'label'", () => {
    const view = renderEditor({ variant: "ranked", authorDisplay: "label" });
    expect(screen.getByText("Etykieta autora (i18n)")).toBeInTheDocument();
    view.unmount();
    renderEditor({ variant: "ranked", authorDisplay: "avatar" });
    expect(screen.queryByText("Etykieta autora (i18n)")).toBeNull();
  });
});

describe("PostListEditor - autoodtwarzanie karuzeli", () => {
  it("sekcja karuzeli nie istnieje dla widgetu post-list", () => {
    renderEditor({}, { widgetType: "post-list" });
    expect(screen.queryByRole("switch", { name: "Autoodtwarzanie" })).toBeNull();
  });

  it("dla karuzeli oferuje przelacznik i zapisuje PRAWDZIWY boolean", () => {
    const { setContent } = renderEditor({}, { widgetType: "carousel" });
    const toggle = screen.getByRole("switch", { name: "Autoodtwarzanie" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    fireEvent.click(toggle);
    expect(setContent).toHaveBeenCalledWith("autoplay", true);
  });

  it("tempo slajdu pojawia sie dopiero po wlaczeniu i jest domykane do zakresu", () => {
    const { setContent } = renderEditor({ autoplay: true }, { widgetType: "carousel" });
    const input = screen.getByDisplayValue("5000");
    fireEvent.change(input, { target: { value: "100" } });
    expect(setContent).toHaveBeenCalledWith("autoplayIntervalMs", 1500);
    fireEvent.change(input, { target: { value: "999999" } });
    expect(setContent).toHaveBeenCalledWith("autoplayIntervalMs", 30000);
  });

  it("wylaczone autoodtwarzanie chowa pole tempa", () => {
    renderEditor({ autoplay: false }, { widgetType: "carousel" });
    expect(screen.queryByDisplayValue("5000")).toBeNull();
  });

  it("czyta historyczna wartosc 'on' ze starego schematu jako wlaczone", () => {
    renderEditor({ autoplay: "on" }, { widgetType: "carousel" });
    expect(screen.getByRole("switch", { name: "Autoodtwarzanie" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });
});
