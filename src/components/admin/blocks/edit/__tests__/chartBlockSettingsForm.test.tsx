// EDYTOR BLOKU WYKRESU - USTAWIENIA FORMY: to, co pole POKAZUJE, i to, co
// pole ZAPISUJE.
//
// PO CO OSOBNY PLIK. Arkusz danych (`chartBlockDataGrid`), odniesienia
// (`chartReferenceEditor`), zalecenia formy (`chartFormAdvice`) i zależność
// pól od rodzaju (`chartBlockKindCaps`) mają własne dowody. Reszta formy -
// rodzaj, teksty, przełączniki, suwaki, prognoza, `n`, kierunek, źródło
// pasma, wyjaśnienie wskaźnika, wiarygodność źródła, import z pliku - nie
// miała żadnego: około połowy funkcji `DataVizBlocks.tsx` nikt nie wywołał.
//
// ZASADA, KTÓREJ TU DOWODZIMY. Podgląd nad formą to „dokładnie ten sam
// render, który trafi na stronę publiczną", więc forma MUSI czytać te same
// wartości, co parser (`parseChartConfig`): rodzaj, wysokość i wygładzenie
// pokazują to, co narysuje wykres - także dla treści spoza dziedziny
// (`variant: "minimal"` odziedziczony po innym bloku, wygładzenie jako napis).
// Pole liczby nie może też zapisać `NaN`: JSON utrwala go jako `null`, a pole
// pokazuje redaktorowi „NaN".
//
// GRANICE. Mocki i render niesie moduł wspólny tabeli edytorów, dlatego jego
// import jest PIERWSZY. Podgląd wykresu (`Chart`) jest PRAWDZIWY - to
// warstwa, z którą forma ma się zgadzać. i18n PRAWDZIWE (polski panel).
import { describe, expect, it } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";

import { renderEditor } from "./blockEditMatrix.shared";
import type { Block, Json } from "@/lib/blocks/types";
import { ChartBlock } from "../DataVizBlocks";

const ID = "blk-chart-form";

function wykres(data: Record<string, Json> = {}): Block {
  return {
    id: ID,
    type: "chart",
    data: {
      categories: ["2024", "2025"],
      series: [{ name: "Marża", values: [2, 3] }],
      ...data,
    },
  };
}

function ostatnie(changes: readonly Block[]): Record<string, Json> {
  const zapis = changes.at(-1);
  if (!zapis) throw new Error("edytor nie zapisał niczego");
  expect({ id: zapis.id, type: zapis.type }).toEqual({ id: ID, type: "chart" });
  return zapis.data;
}

/** Lista rodzaju wykresu - nie ma etykiety, rozpoznajemy ją po opcjach. */
function listaRodzaju(): HTMLSelectElement {
  const lista = screen
    .getAllByRole<HTMLSelectElement>("combobox")
    .find((el) => Array.from(el.options).some((o) => o.value === "waterfall"));
  if (!lista) throw new Error("brak listy rodzaju wykresu");
  return lista;
}

const pole = (nazwa: string) => screen.getByRole<HTMLInputElement>("textbox", { name: nazwa });

describe("rodzaj wykresu - forma pokazuje to, co narysuje parser", () => {
  it("pierścień z odziedziczonym `variant: minimal` stoi w liście jako pierścień, z ostrzeżeniem tarczy", () => {
    // `variant` jest generycznym polem stylu innych bloków; parser bierze go
    // tylko wtedy, gdy jest ZNANYM rodzajem. Forma czytała go zawsze, więc
    // pokazywała „Kolumny" (pierwszą opcję) i gubiła ostrzeżenia pierścienia,
    // choć podgląd obok rysował pierścień.
    renderEditor(ChartBlock, wykres({ kind: "donut", variant: "minimal" }));
    expect(listaRodzaju().value).toBe("donut");
    expect(screen.getByText(/Pierścień z dwoma albo trzema segmentami/)).toBeInTheDocument();
  });

  it("nieznany rodzaj pokazuje „Kolumny” - tak, jak narysuje go parser", () => {
    renderEditor(ChartBlock, wykres({ kind: "nie-ma-takiego" }));
    expect(listaRodzaju().value).toBe("bar");
  });

  it("zmiana rodzaju zapisuje `kind` i `variant` RAZEM, jednym zapisem", () => {
    // Oba klucze naraz - inaczej stary `variant` z paska szybkiego przełączania
    // wygrałby z nowym wyborem w liście.
    const { changes } = renderEditor(ChartBlock, wykres({ kind: "bar", variant: "bar" }));
    fireEvent.change(listaRodzaju(), { target: { value: "line" } });
    expect(changes).toHaveLength(1);
    expect(ostatnie(changes)).toMatchObject({ kind: "line", variant: "line" });
  });
});

describe("teksty i przełączniki", () => {
  it.each([
    ["Jednostka (np. %, mld EUR)", "unit"],
    ["Tytuł wykresu", "title"],
    ["Opis (podtytuł)", "description"],
    ["Źródło danych (np. Źródło: Eurostat 2026)", "source"],
    ["Data danych (np. 2026-06-30)", "sourceDate"],
    ["Co pokazuje", "notesShows"],
    ["Co jest zaskakujące", "notesSurprising"],
    ["Czego NIE pokazuje", "notesHidden"],
  ])("pole „%s” zapisuje się pod `%s`, bez ruszania danych", (placeholder, klucz) => {
    const { changes } = renderEditor(ChartBlock, wykres());
    fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value: "wpis" } });
    expect(changes).toHaveLength(1);
    expect(ostatnie(changes)).toEqual({ ...wykres().data, [klucz]: "wpis" });
  });

  it("teksty zapisane jako OBIEKTY dają puste pola, a nie „[object Object]”", () => {
    renderEditor(
      ChartBlock,
      wykres({
        title: { pl: "Tytuł" },
        unit: ["%"],
        source: { a: 1 },
        notesShows: { pl: "x" },
        metric: { name: { pl: "ROIC" } },
      }),
    );
    for (const placeholder of [
      "Tytuł wykresu",
      "Jednostka (np. %, mld EUR)",
      "Źródło danych (np. Źródło: Eurostat 2026)",
      "Co pokazuje",
      "Skrót (np. ROIC)",
    ]) {
      expect(screen.getByPlaceholderText<HTMLInputElement>(placeholder).value, placeholder).toBe(
        "",
      );
    }
  });

  it("brak zdania „czego nie pokazuje” daje ostrzeżenie, wpisane zdanie je zdejmuje", () => {
    const ostrzezenie = /Podpis bez zdania „czego nie pokazuje”/;
    const bez = renderEditor(ChartBlock, wykres());
    expect(screen.getByText(ostrzezenie)).toBeInTheDocument();
    bez.unmount();
    renderEditor(ChartBlock, wykres({ notesHidden: "Nie pokazuje inflacji" }));
    expect(screen.queryByText(ostrzezenie)).toBeNull();
  });

  it("przełączniki mają domyślne parsera i zapisują wartość logiczną pod swoim kluczem", () => {
    const { changes } = renderEditor(ChartBlock, wykres());
    const przelaczniki: ReadonlyArray<[string, string, boolean]> = [
      ["Skumulowany (stacked)", "stacked", false],
      ["Legenda", "showLegend", true],
      ["Siatka", "showGrid", true],
      ["Etykiety wartości", "showValues", false],
      ["Animacja wejścia", "animate", true],
    ];
    for (const [nazwa, klucz, domyslnie] of przelaczniki) {
      const box = screen.getByRole<HTMLInputElement>("checkbox", { name: nazwa });
      expect(box.checked, nazwa).toBe(domyslnie);
      fireEvent.click(box);
      expect(ostatnie(changes)[klucz], nazwa).toBe(!domyslnie);
    }
    expect(changes).toHaveLength(przelaczniki.length);
  });
});

describe("suwaki - wysokość i wygładzenie", () => {
  it("suwak wysokości zapisuje LICZBĘ pikseli, a etykieta pokazuje wysokość wykresu", () => {
    const { changes } = renderEditor(ChartBlock, wykres({ height: 400 }));
    expect(screen.getByText("400px")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("slider", { name: "Wysokość wykresu" }), {
      target: { value: "480" },
    });
    expect(ostatnie(changes).height).toBe(480);
  });

  it("wygładzenie zapisane NAPISEM „0.3” pokazuje 30% - tyle, ile narysuje linia", () => {
    // Parser czyta napis liczbowy; forma czytała wyłącznie liczbę i pokazywała
    // domyślne 55%, choć podgląd obok rysował 30%.
    renderEditor(ChartBlock, wykres({ smoothing: "0.3" }));
    expect(screen.getByRole<HTMLInputElement>("slider", { name: "Wygładzenie linii" }).value).toBe(
      "30",
    );
    expect(screen.getByText("30%")).toBeInTheDocument();
  });

  it("brak wygładzenia to domyślne 55%, a suwak zapisuje UŁAMEK 0-1", () => {
    const { changes } = renderEditor(ChartBlock, wykres());
    const suwak = screen.getByRole<HTMLInputElement>("slider", { name: "Wygładzenie linii" });
    expect(suwak.value).toBe("55");
    fireEvent.change(suwak, { target: { value: "40" } });
    expect(ostatnie(changes).smoothing).toBe(0.4);
  });
});

describe("pola liczbowe nie zapisują NaN", () => {
  it("pasmo niepewności: przecinek dziesiętny to liczba, śmieć i pustka zapisują 0", () => {
    const { changes } = renderEditor(ChartBlock, wykres({ forecastBandPct: 5 }));
    const pasmo = pole("Pasmo niepewności ±%");
    expect(pasmo.value).toBe("5");

    fireEvent.change(pasmo, { target: { value: "7,5" } });
    expect(ostatnie(changes).forecastBandPct).toBe(7.5);

    // Pole zostawia wpis redaktora (szkic), a dokument dostaje 0 - nie `NaN`.
    fireEvent.change(pasmo, { target: { value: "abc" } });
    expect(ostatnie(changes).forecastBandPct).toBe(0);
    expect(pasmo.value).toBe("abc");

    fireEvent.change(pasmo, { target: { value: "" } });
    expect(ostatnie(changes).forecastBandPct).toBe(0);
  });

  it("`n`: liczba zapisuje się liczbą, literówka zapisuje BRAK, a pole nie pokazuje „NaN”", () => {
    const { changes } = renderEditor(ChartBlock, wykres());
    const n = pole("n - liczba obserwacji");
    fireEvent.change(n, { target: { value: "120" } });
    expect(ostatnie(changes).sampleSize).toBe(120);
    fireEvent.change(n, { target: { value: "12a" } });
    expect(ostatnie(changes).sampleSize).toBeNull();
    expect(n.value).toBe("12a");
    expect(n.value).not.toContain("NaN");
  });

  it("`n` zapisane jako OBIEKT pokazuje puste pole, a liczba - swoją wartość", () => {
    const obiekt = renderEditor(ChartBlock, wykres({ sampleSize: { n: 5 } }));
    expect(pole("n - liczba obserwacji").value).toBe("");
    obiekt.unmount();
    renderEditor(ChartBlock, wykres({ sampleSize: 1200 }));
    expect(pole("n - liczba obserwacji").value).toBe("1200");
  });

  it("szkic pola liczby przeżywa własny zapis, a ustępuje zmianie Z ZEWNĄTRZ (cofnięcie)", () => {
    // Pole sterowane samą liczbą zjadałoby znaki w trakcie pisania („2,50"
    // wracałoby jako „2.5"); szkic ustępuje tylko treści, która mówi już co
    // innego niż on.
    const { changes, rerender, queryClient } = renderEditor(
      ChartBlock,
      wykres({ target: { value: 5 } }),
    );
    const zamontuj = (b: Block) =>
      rerender(
        <QueryClientProvider client={queryClient}>
          <ChartBlock block={b} onChange={(next) => changes.push(next)} />
        </QueryClientProvider>,
      );
    const cel = () => pole("Linia celu - wartość (puste = brak)");
    fireEvent.change(cel(), { target: { value: "2,50" } });
    const zapis = changes.at(-1);
    if (!zapis) throw new Error("brak zapisu celu");
    expect(zapis.data.target).toEqual({ value: 2.5 });

    zamontuj(zapis);
    expect(cel().value).toBe("2,50");

    zamontuj(wykres({ target: { value: 7 } }));
    expect(cel().value).toBe("7");

    // Cofnięcie do bloku BEZ celu czyści pole - nie zostawia starej liczby.
    zamontuj(wykres());
    expect(cel().value).toBe("");
  });

  it("cel zapisany gołą LICZBĄ albo NAPISEM z przecinkiem pokazuje się jako liczba", () => {
    // Starsze treści trzymały cel jako `5` albo `"2,5"`, nie `{ value }` -
    // pole czyta je tą samą koercją, co parser, który rysuje linię celu.
    const liczba = renderEditor(ChartBlock, wykres({ target: 5 }));
    expect(pole("Linia celu - wartość (puste = brak)").value).toBe("5");
    liczba.unmount();
    renderEditor(ChartBlock, wykres({ target: "2,5" }));
    expect(pole("Linia celu - wartość (puste = brak)").value).toBe("2.5");
  });
});

describe("odniesienia - kierunek, pochodzenie, demo, podpis, pasmo, wiarygodność", () => {
  it("kierunek: wybór zapisuje wartość, „brak” USUWA klucz z treści", () => {
    const { changes } = renderEditor(ChartBlock, wykres({ direction: "lower" }));
    const kierunek = screen.getByRole<HTMLSelectElement>("combobox", {
      name: "Kierunek wskaźnika",
    });
    expect(kierunek.value).toBe("lower");
    fireEvent.change(kierunek, { target: { value: "higher" } });
    expect(ostatnie(changes).direction).toBe("higher");
    fireEvent.change(kierunek, { target: { value: "" } });
    expect("direction" in ostatnie(changes)).toBe(false);
  });

  it("pochodzenie spoza dziedziny pokazuje „brak”; wybór zapisuje literę, „brak” usuwa klucz", () => {
    const { changes } = renderEditor(ChartBlock, wykres({ provenance: "Z" }));
    const pochodzenie = screen.getByRole<HTMLSelectElement>("combobox", {
      name: "Pochodzenie liczb",
    });
    expect(pochodzenie.value).toBe("");
    fireEvent.change(pochodzenie, { target: { value: "B" } });
    expect(ostatnie(changes).provenance).toBe("B");
    fireEvent.change(pochodzenie, { target: { value: "" } });
    expect("provenance" in ostatnie(changes)).toBe(false);
  });

  it("flaga demo i podpis pod wykresem zapisują się pod swoimi kluczami", () => {
    const { changes } = renderEditor(ChartBlock, wykres());
    fireEvent.click(screen.getByRole("checkbox", { name: "Dane demonstracyjne (odznaka „demo”)" }));
    expect(ostatnie(changes).demo).toBe(true);
    fireEvent.change(screen.getByRole("textbox", { name: "Podpis pod wykresem (opcjonalny)" }), {
      target: { value: "Dane za 2025" },
    });
    expect(ostatnie(changes).caption).toBe("Dane za 2025");
  });

  it("lista źródła pasma oferuje TYLKO źródła, które przeżyją parsowanie (z tytułem albo adresem)", () => {
    const { changes } = renderEditor(
      ChartBlock,
      wykres({
        band: { min: 2, max: 4 },
        sources: [
          { id: "s1", author: "Eurostat", title: "Raport" },
          { id: "s2", title: "", url: "" },
        ],
      }),
    );
    const lista = screen.getByRole<HTMLSelectElement>("combobox", { name: "Źródło pasma optimum" });
    expect(Array.from(lista.options, (o) => o.text)).toEqual([
      "Pasmo bez źródła",
      "Eurostat - Raport",
    ]);
    fireEvent.change(lista, { target: { value: "s1" } });
    expect(ostatnie(changes).band).toEqual({ min: 2, max: 4, sourceId: "s1", demo: false });
  });

  it("wskazanie źródła, którego nie ma na liście, ZOSTAJE wybrane i opisane", () => {
    // Inaczej lista pokazałaby „bez źródła", a pierwsza zmiana innego pola
    // pasma zgubiłaby wskazanie bez słowa.
    const { changes } = renderEditor(
      ChartBlock,
      wykres({ band: { min: 2, max: 4, sourceId: "s9" } }),
    );
    const lista = screen.getByRole<HTMLSelectElement>("combobox", { name: "Źródło pasma optimum" });
    expect(lista.value).toBe("s9");
    expect(
      within(lista).getByRole("option", { name: "s9 - nie ma go na liście źródeł" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Pasmo demonstracyjne" }));
    expect(ostatnie(changes).band).toEqual({ min: 2, max: 4, sourceId: "s9", demo: true });
  });

  it("górna krawędź pasma zapisuje cały obiekt pasma z nową górną granicą", () => {
    const { changes } = renderEditor(
      ChartBlock,
      wykres({ band: { min: 2, max: 4, sourceId: "", demo: true } }),
    );
    fireEvent.change(pole("Pasmo optimum - do"), { target: { value: "6,5" } });
    expect(ostatnie(changes).band).toEqual({ min: 2, max: 6.5, sourceId: "", demo: true });
  });

  it("źródło pasma bez tytułu podpisuje się adresem, a autor stoi przed nim", () => {
    renderEditor(
      ChartBlock,
      wykres({
        band: { min: 2, max: 4 },
        sources: [
          { id: "s1", url: "https://ec.europa.eu" },
          { id: "s2", author: "GUS", url: "https://stat.gov.pl" },
        ],
      }),
    );
    const lista = screen.getByRole<HTMLSelectElement>("combobox", { name: "Źródło pasma optimum" });
    expect(Array.from(lista.options, (o) => o.text)).toEqual([
      "Pasmo bez źródła",
      "https://ec.europa.eu",
      "GUS - https://stat.gov.pl",
    ]);
  });

  it("pasmo bez krawędzi, źródła i flagi demo ZNIKA z treści, zamiast zostać pustym obiektem", () => {
    const { changes } = renderEditor(ChartBlock, wykres({ band: { min: 2 } }));
    fireEvent.change(pole("Pasmo optimum - od"), { target: { value: "" } });
    expect("band" in ostatnie(changes)).toBe(false);
  });

  it("wiarygodność źródła: wybór zapisuje stopień, „nie oceniono” zapisuje `null`", () => {
    const { changes } = renderEditor(
      ChartBlock,
      wykres({ sources: [{ id: "s1", title: "Raport" }] }),
    );
    const ocena = screen.getByRole<HTMLSelectElement>("combobox", { name: "Wiarygodność źródła" });
    fireEvent.change(ocena, { target: { value: "A" } });
    expect((ostatnie(changes).sources as Json[])[0]).toMatchObject({ id: "s1", reliability: "A" });
    fireEvent.change(ocena, { target: { value: "" } });
    expect((ostatnie(changes).sources as Json[])[0]).toMatchObject({ id: "s1", reliability: null });
  });

  it("edycja jednego z dwóch źródeł zostawia drugie bez zmian - także jego ocenę", () => {
    const { changes } = renderEditor(
      ChartBlock,
      wykres({
        sources: [
          { id: "s1", title: "Pierwsze", reliability: "B" },
          { id: "s2", title: "Drugie" },
        ],
      }),
    );
    const oceny = screen.getAllByRole<HTMLSelectElement>("combobox", {
      name: "Wiarygodność źródła",
    });
    expect(oceny.map((el) => el.value)).toEqual(["B", ""]);

    fireEvent.change(oceny[1], { target: { value: "C" } });
    const [s1, s2] = ostatnie(changes).sources as Json[];
    expect(s1).toMatchObject({ id: "s1", title: "Pierwsze", reliability: "B" });
    expect(s2).toMatchObject({ id: "s2", title: "Drugie", reliability: "C" });

    fireEvent.change(screen.getAllByRole("textbox", { name: "Tytuł" })[0], {
      target: { value: "Pierwsze, wyd. 2" },
    });
    const [p1, p2] = ostatnie(changes).sources as Json[];
    expect(p1).toMatchObject({ id: "s1", title: "Pierwsze, wyd. 2", reliability: "B" });
    expect(p2).toMatchObject({ id: "s2", title: "Drugie", reliability: null });
  });

  it("źródło bez tytułu i autora ma przycisk usuwania nazwany NUMEREM wiersza", () => {
    const { changes } = renderEditor(ChartBlock, wykres({ sources: [{ id: "s1", url: "" }] }));
    fireEvent.click(screen.getByRole("button", { name: "Usuń źródło 1" }));
    expect("sources" in ostatnie(changes)).toBe(false);
  });
});

describe("wyjaśnienie wskaźnika", () => {
  const PUSTY = {
    name: "",
    expansion: "",
    formula: "",
    measures: "",
    reading: "",
    levers: "",
    caution: "",
  };

  it("bez skrótu forma pokazuje tylko pole skrótu; wpisany skrót zapisuje KOMPLET pól", () => {
    const { changes } = renderEditor(ChartBlock, wykres());
    expect(screen.queryByPlaceholderText("Wzór")).toBeNull();
    fireEvent.change(screen.getByPlaceholderText("Skrót (np. ROIC)"), {
      target: { value: "ROIC" },
    });
    expect(ostatnie(changes).metric).toEqual({ ...PUSTY, name: "ROIC" });
  });

  it.each([
    ["Rozwinięcie i tłumaczenie", "expansion"],
    ["Wzór", "formula"],
    ["Mierzy", "measures"],
    ["Czytanie - z czym porównywać", "reading"],
    ["Dźwignie", "levers"],
    ["Uwaga", "caution"],
  ])("pole „%s” pojawia się po skrócie i zapisuje się pod `metric.%s`", (placeholder, klucz) => {
    const { changes } = renderEditor(ChartBlock, wykres({ metric: { name: "ROIC" } }));
    fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value: "wpis" } });
    expect(ostatnie(changes).metric).toEqual({ ...PUSTY, name: "ROIC", [klucz]: "wpis" });
  });
});

describe("paleta kolorów", () => {
  it("wybór palety zapisuje `palette`, a wartość spoza listy pokazuje domyślną `focus`", () => {
    const { changes } = renderEditor(ChartBlock, wykres({ palette: "tęcza" }));
    const paleta = screen.getByRole<HTMLSelectElement>("combobox", { name: "Paleta kolorów" });
    expect(paleta.value).toBe("focus");
    fireEvent.change(paleta, { target: { value: "categorical" } });
    expect(ostatnie(changes).palette).toBe("categorical");
  });
});

describe("import z pliku", () => {
  it("plik wymienia kategorie i serie JEDNYM zapisem - dopiero po „Zastosuj”", async () => {
    const { container, changes } = renderEditor(ChartBlock, wykres({ title: "Handel" }));
    const plik = container.querySelector<HTMLInputElement>('input[type="file"]');
    if (!plik) throw new Error("brak pola pliku");
    fireEvent.change(plik, {
      target: { files: [new File([";Eksport;Import\n2021;120;80\n2022;130;90"], "dane.csv")] },
    });
    const okno = await screen.findByRole("dialog", { name: "Import tabeli z pliku" });
    expect(changes).toHaveLength(0);
    fireEvent.click(within(okno).getByRole("button", { name: "Zastosuj" }));
    expect(changes).toHaveLength(1);
    const data = ostatnie(changes);
    expect(data.title).toBe("Handel");
    expect(data.categories).toEqual(["2021", "2022"]);
    expect(data.series).toMatchObject([
      { name: "Eksport", values: [120, 130] },
      { name: "Import", values: [80, 90] },
    ]);
  });
});
