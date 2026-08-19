// Karta „Seria / dossier" edytora wpisu: przypięcie wpisu do serii z numerem
// części, odpięcie i utworzenie serii w miejscu.
//
// CO TU DOWODZIMY:
//   * odczyt przypięcia jest ZAWĘŻONY do tego wpisu (`eq("post_id", ...)`) -
//     bez tego filtra karta pokazywałaby serię losowego wpisu,
//   * przypięcie idzie przez `upsert` z konfliktem na `post_id`, więc jeden wpis
//     ma najwyżej JEDNO miejsce w serii (nie dubluje się przy zmianie),
//   * odpięcie (wybór „brak") USUWA wiersz, a nie zapisuje puste przypięcie,
//   * numer części jest przycinany do zakresu 1-999 także dla wpisu ręcznego,
//   * utworzenie serii dostaje slug z nazwy, czyści pole, unieważnia listę serii
//     i NATYCHMIAST przypina wpis do nowej serii, zachowując numer części,
//   * unieważniany jest też cache PUBLICZNY - inaczej czytelnik widzi starą serię,
//   * każdy błąd zapisu trafia do toastu, także taki, który nie jest `Error`.
//
// DLACZEGO TO WAŻNE: seria buduje nawigację „część 2 z 5" na stronie publicznej.
// Zgubiony filtr po wpisie albo brak `onConflict` daje dwa wiersze i sprzeczną
// numerację, a cicho zjedzony błąd zapisu wygląda dla redakcji jak sukces:
// dossier zostaje bez odcinka, o którym wszyscy myślą, że jest przypięty.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { EDITOR_IDS } from "@/test/post-editor/fixtures";
import { ok, fail, type SupabaseFromStub, type SupabaseResult } from "@/test/supabaseChain";

const stubs = vi.hoisted(() => ({ from: null as unknown, toast: null as unknown }));

vi.mock("react-i18next", async () =>
  (await import("@/test/post-editor/fixtures")).reactI18nextStub(),
);
vi.mock("@/lib/i18n-admin-post-panes", () => ({}));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabaseChain");
  const from = supabaseFromStub();
  stubs.from = from;
  return { supabase: { from: from.from, rpc: vi.fn(async () => ({ data: null, error: null })) } };
});

vi.mock("sonner", async () => {
  const { toastStub } = await import("@/test/post-editor/fixtures");
  const toast = toastStub();
  stubs.toast = toast;
  return { toast, Toaster: () => null };
});

// Radixowy <Select> nie otwiera listy w happy-dom - atrapa oddaje natywny
// <select> z tymi samymi opcjami, bo reguła siedzi w `onValueChange`.
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

import { SeriesCard } from "../SeriesCard";

const db = () => stubs.from as SupabaseFromStub;
const toast = () =>
  stubs.toast as ReturnType<typeof import("@/test/post-editor/fixtures").toastStub>;

const POST = EDITOR_IDS.post;
const SERIES_A = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const SERIES_B = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
const NEW_SERIES = "cccccccc-3333-4333-8333-cccccccccccc";
const NONE = "__none__";

const SERIES_ROWS = [
  { id: SERIES_A, slug: "rozszerzenie-ue", name_pl: "Rozszerzenie UE", name_en: "EU enlargement" },
  // Seria bez nazwy PL - etykieta musi spaść na wersję EN, a nie zostać pusta.
  { id: SERIES_B, slug: "green-deal", name_pl: "", name_en: "Green Deal" },
];

interface Plan {
  series?: SupabaseResult | null;
  link?: { series_id: string; part_number: number } | null;
  linkError?: string;
  writeError?: string | "nie-error";
  insertError?: string;
}

/**
 * Plan odpowiedzi atrapy PostgREST. Jedna tabela obsługuje i odczyt, i zapis,
 * więc responder rozpoznaje ogniwo (`insert` / `upsert` / `delete`) - dzięki
 * temu test może zepsuć WYŁĄCZNIE zapis, zostawiając odczyt zdrowy.
 */
function planDb(plan: Plan = {}): void {
  db().reset();
  db().setResponse("series", (chain) => {
    if (chain.has("insert")) {
      return plan.insertError ? fail(plan.insertError) : ok({ id: NEW_SERIES });
    }
    return plan.series ?? ok(SERIES_ROWS);
  });
  db().setResponse("post_series", (chain) => {
    if (chain.has("upsert") || chain.has("delete")) {
      if (plan.writeError === "nie-error") {
        // PostgREST zwykle zwraca Error, ale warstwa danych ma być odporna też
        // na wyjątek bez klasy - inaczej redakcja zobaczy „[object Object]".
        return { data: null, error: "awaria sieci" as unknown as Error } as SupabaseResult;
      }
      return plan.writeError ? fail(plan.writeError) : ok(null);
    }
    if (plan.linkError) return fail(plan.linkError);
    return ok(plan.link ?? null);
  });
}

const seriesSelect = () => screen.getByRole("combobox") as HTMLSelectElement;
const partInput = (container: HTMLElement) =>
  container.querySelector('input[type="number"]') as HTMLInputElement | null;
const newNameInput = () =>
  screen.getByPlaceholderText("adminPostPanes.series.newPlaceholder") as HTMLInputElement;
const createButton = () =>
  screen.getByRole("button", { name: "adminPostPanes.series.create" }) as HTMLButtonElement;

/**
 * Łańcuch ZAPISU dla tabeli. Nie `lastChain`: unieważnienie cache'u natychmiast
 * dokłada łańcuch ODCZYTU (refetch), więc ostatni łańcuch tabeli to zwykle
 * `select`, a nie zapis, który testujemy.
 */
function writeChain(table: string, method: string) {
  return db()
    .chainsFor(table)
    .filter((c) => c.has(method))
    .at(-1);
}

/** Czeka, aż lista serii dojedzie z bazy (opcje poza pozycją „brak"). */
async function waitForSeriesList(): Promise<void> {
  await screen.findByRole("option", { name: "Rozszerzenie UE" });
}

beforeEach(() => {
  planDb();
  toast().success.mockReset();
  toast().error.mockReset();
});

describe("SeriesCard - odczyt przypięcia", () => {
  it("czyta serie posortowane po nazwie PL i podpisuje je czytelnie", async () => {
    renderWithQueryClient(<SeriesCard postId={POST} />);
    await waitForSeriesList();

    expect(db().lastChain("series")?.argsOf("order")).toEqual(["name_pl"]);
    // Seria bez nazwy PL spada na wersję EN - żadnej pustej pozycji na liście.
    expect(screen.getByRole("option", { name: "Green Deal" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "adminPostPanes.series.none" })).toBeInTheDocument();
  });

  it("odczyt przypięcia jest zawężony do TEGO wpisu", async () => {
    renderWithQueryClient(<SeriesCard postId={POST} />);
    await waitForSeriesList();

    const read = db()
      .chainsFor("post_series")
      .find((c) => c.has("select"));
    expect(read?.argsOf("eq")).toEqual(["post_id", POST]);
    expect(read?.has("maybeSingle")).toBe(true);
  });

  it("wpis bez serii stoi na pozycji brak i nie pyta o numer czesci", async () => {
    const { container } = renderWithQueryClient(<SeriesCard postId={POST} />);
    await waitForSeriesList();

    expect(seriesSelect().value).toBe(NONE);
    expect(partInput(container)).toBeNull();
    expect(screen.getByText("adminPostPanes.series.hint")).toBeInTheDocument();
  });

  it("wpis w serii pokazuje serię i numer części", async () => {
    planDb({ link: { series_id: SERIES_A, part_number: 3 } });
    const { container } = renderWithQueryClient(<SeriesCard postId={POST} />);
    await waitFor(() => expect(seriesSelect().value).toBe(SERIES_A));

    expect(partInput(container)?.value).toBe("3");
    expect(screen.getByText("adminPostPanes.series.partLabel")).toBeInTheDocument();
  });

  it("blad odczytu przypiecia nie wywraca karty - zostaje stan bez serii", async () => {
    planDb({ linkError: "RLS: brak dostępu" });
    const { container } = renderWithQueryClient(<SeriesCard postId={POST} />);
    await waitForSeriesList();

    expect(seriesSelect().value).toBe(NONE);
    expect(partInput(container)).toBeNull();
  });
});

describe("SeriesCard - przypięcie i odpięcie", () => {
  it("wybór serii zapisuje przypięcie z konfliktem na post_id (jedno miejsce na wpis)", async () => {
    renderWithQueryClient(<SeriesCard postId={POST} />);
    await waitForSeriesList();

    fireEvent.change(seriesSelect(), { target: { value: SERIES_A } });

    await waitFor(() => expect(writeChain("post_series", "upsert")).toBeTruthy());
    expect(writeChain("post_series", "upsert")?.argsOf("upsert")).toEqual([
      { post_id: POST, series_id: SERIES_A, part_number: 1 },
      { onConflict: "post_id" },
    ]);
  });

  it("wybor pozycji brak USUWA wiersz przypiecia tego wpisu", async () => {
    planDb({ link: { series_id: SERIES_A, part_number: 2 } });
    renderWithQueryClient(<SeriesCard postId={POST} />);
    await waitFor(() => expect(seriesSelect().value).toBe(SERIES_A));

    fireEvent.change(seriesSelect(), { target: { value: NONE } });

    await waitFor(() => expect(writeChain("post_series", "delete")).toBeTruthy());
    const write = writeChain("post_series", "delete");
    expect(write?.argsOf("eq")).toEqual(["post_id", POST]);
    expect(write?.has("upsert")).toBe(false);
  });

  it("zmiana serii zachowuje numer części, który wpis już miał", async () => {
    planDb({ link: { series_id: SERIES_A, part_number: 4 } });
    renderWithQueryClient(<SeriesCard postId={POST} />);
    await waitFor(() => expect(seriesSelect().value).toBe(SERIES_A));

    fireEvent.change(seriesSelect(), { target: { value: SERIES_B } });

    await waitFor(() => expect(writeChain("post_series", "upsert")).toBeTruthy());
    expect(writeChain("post_series", "upsert")?.argsOf("upsert")?.[0]).toEqual({
      post_id: POST,
      series_id: SERIES_B,
      part_number: 4,
    });
  });

  it("unieważnia cache redakcyjny I PUBLICZNY po zapisie", async () => {
    const { queryClient } = renderWithQueryClient(<SeriesCard postId={POST} />);
    await waitForSeriesList();
    const spy = vi.spyOn(queryClient, "invalidateQueries");

    fireEvent.change(seriesSelect(), { target: { value: SERIES_A } });

    await waitFor(() => expect(spy).toHaveBeenCalled());
    const keys = spy.mock.calls.map(([arg]) => JSON.stringify(arg?.queryKey));
    expect(keys).toContain(JSON.stringify(["admin", "post-series", POST]));
    expect(keys).toContain(JSON.stringify(["public", "post-series", POST]));
  });
});

describe("SeriesCard - numer części", () => {
  it.each([
    ["7", 7],
    ["0", 1],
    ["-3", 1],
    ["1500", 999],
    ["", 1],
    ["abc", 1],
  ])("wpisane %s zapisuje się jako część %i", async (typed, expected) => {
    planDb({ link: { series_id: SERIES_A, part_number: 2 } });
    const { container } = renderWithQueryClient(<SeriesCard postId={POST} />);
    await waitFor(() => expect(seriesSelect().value).toBe(SERIES_A));

    fireEvent.change(partInput(container) as HTMLInputElement, { target: { value: typed } });

    await waitFor(() => expect(writeChain("post_series", "upsert")).toBeTruthy());
    expect(writeChain("post_series", "upsert")?.argsOf("upsert")?.[0]).toEqual({
      post_id: POST,
      series_id: SERIES_A,
      part_number: expected,
    });
  });
});

describe("SeriesCard - tworzenie serii w miejscu", () => {
  it("bez nazwy nie da się utworzyć serii (także dla samych spacji)", async () => {
    renderWithQueryClient(<SeriesCard postId={POST} />);
    await waitForSeriesList();
    expect(createButton().disabled).toBe(true);

    fireEvent.change(newNameInput(), { target: { value: "   " } });

    expect(createButton().disabled).toBe(true);
  });

  it("nowa seria dostaje slug z nazwy i tę samą nazwę w obu językach", async () => {
    renderWithQueryClient(<SeriesCard postId={POST} />);
    await waitForSeriesList();

    fireEvent.change(newNameInput(), { target: { value: "Dossier: Rozszerzenie UE" } });
    fireEvent.click(createButton());

    await waitFor(() => expect(writeChain("series", "insert")).toBeTruthy());
    expect(writeChain("series", "insert")?.argsOf("insert")).toEqual([
      {
        name_pl: "Dossier: Rozszerzenie UE",
        name_en: "Dossier: Rozszerzenie UE",
        slug: "dossier-rozszerzenie-ue",
      },
    ]);
  });

  it("po utworzeniu serii wpis JEST od razu do niej przypięty i pole się czyści", async () => {
    renderWithQueryClient(<SeriesCard postId={POST} />);
    await waitForSeriesList();

    fireEvent.change(newNameInput(), { target: { value: "Nowe dossier" } });
    fireEvent.click(createButton());

    await waitFor(() => expect(writeChain("post_series", "upsert")).toBeTruthy());
    expect(writeChain("post_series", "upsert")?.argsOf("upsert")?.[0]).toEqual({
      post_id: POST,
      series_id: NEW_SERIES,
      part_number: 1,
    });
    expect(toast().success).toHaveBeenCalledWith("adminPostPanes.series.created");
    expect(newNameInput().value).toBe("");
  });

  it("utworzenie serii dla wpisu z numerem części zachowuje ten numer", async () => {
    planDb({ link: { series_id: SERIES_A, part_number: 5 } });
    renderWithQueryClient(<SeriesCard postId={POST} />);
    await waitFor(() => expect(seriesSelect().value).toBe(SERIES_A));

    fireEvent.change(newNameInput(), { target: { value: "Kolejne dossier" } });
    fireEvent.click(createButton());

    await waitFor(() => expect(writeChain("post_series", "upsert")).toBeTruthy());
    expect(writeChain("post_series", "upsert")?.argsOf("upsert")?.[0]).toEqual({
      post_id: POST,
      series_id: NEW_SERIES,
      part_number: 5,
    });
  });

  it("unieważnia listę serii, żeby nowa pozycja była od razu do wyboru", async () => {
    const { queryClient } = renderWithQueryClient(<SeriesCard postId={POST} />);
    await waitForSeriesList();
    const spy = vi.spyOn(queryClient, "invalidateQueries");

    fireEvent.change(newNameInput(), { target: { value: "Nowe dossier" } });
    fireEvent.click(createButton());

    await waitFor(() =>
      expect(spy.mock.calls.map(([a]) => JSON.stringify(a?.queryKey))).toContain(
        JSON.stringify(["admin", "series-list"]),
      ),
    );
  });
});

describe("SeriesCard - błędy zapisu są widoczne", () => {
  it("nieudane przypięcie pokazuje komunikat błędu z bazy", async () => {
    planDb({ writeError: "naruszenie klucza obcego" });
    renderWithQueryClient(<SeriesCard postId={POST} />);
    await waitForSeriesList();

    fireEvent.change(seriesSelect(), { target: { value: SERIES_A } });

    await waitFor(() => expect(toast().error).toHaveBeenCalledWith("naruszenie klucza obcego"));
    expect(toast().success).not.toHaveBeenCalled();
  });

  it("nieudane odpięcie też krzyczy (usuwanie nie jest ciche)", async () => {
    planDb({ link: { series_id: SERIES_A, part_number: 1 }, writeError: "RLS: brak prawa" });
    renderWithQueryClient(<SeriesCard postId={POST} />);
    await waitFor(() => expect(seriesSelect().value).toBe(SERIES_A));

    fireEvent.change(seriesSelect(), { target: { value: NONE } });

    await waitFor(() => expect(toast().error).toHaveBeenCalledWith("RLS: brak prawa"));
  });

  it("awaria bez klasy Error trafia do toastu jako tekst, nie jako [object Object]", async () => {
    planDb({ writeError: "nie-error" });
    renderWithQueryClient(<SeriesCard postId={POST} />);
    await waitForSeriesList();

    fireEvent.change(seriesSelect(), { target: { value: SERIES_A } });

    await waitFor(() => expect(toast().error).toHaveBeenCalledWith("awaria sieci"));
  });

  it("nieudane utworzenie serii nie melduje sukcesu ani nie przypina wpisu", async () => {
    planDb({ insertError: "duplikat sluga" });
    renderWithQueryClient(<SeriesCard postId={POST} />);
    await waitForSeriesList();

    fireEvent.change(newNameInput(), { target: { value: "Nowe dossier" } });
    fireEvent.click(createButton());

    await waitFor(() => expect(toast().error).toHaveBeenCalledWith("duplikat sluga"));
    expect(toast().success).not.toHaveBeenCalled();
    expect(
      db()
        .chainsFor("post_series")
        .some((c) => c.has("upsert")),
    ).toBe(false);
  });
});
