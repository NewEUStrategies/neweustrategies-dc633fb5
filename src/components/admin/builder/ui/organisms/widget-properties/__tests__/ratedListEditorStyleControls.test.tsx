// RatedListEditor: sekcje stylu, układu i pozycje listy ręcznej.
//
// Plik-brat `ratedListEditor.test.tsx` pilnuje źródła danych, linku pozycji,
// kolumn tabletu i trybów przewijania. Tutaj stoi reszta panelu - każda
// kontrolka ma JEDEN klucz w treści i JEDNĄ wartość domyślną, a obie muszą
// zgadzać się z rendererem (`RatedListView`):
//  1. przełącznik bez zapisanej wartości stoi tak, jak renderer go stosuje,
//     a starsza treść z wartością logiczną zapisaną napisem jest czytana,
//  2. pole liczbowe (wspólny atom `ClampedNumberInput`) zapisuje liczbę
//     z zakresu renderera; pusty szkic nie jest zapisem (wyjście z pola
//     przywraca wartość dokumentu), a zero jest zapisem tam, gdzie mieści się
//     w zakresie (odstęp, grubość ramki), i domyka się do minimum tam, gdzie
//     nie jest rozmiarem,
//  3. pozycja listy ręcznej przyjmuje edycję pod kluczem edytowanej wersji
//     językowej, nie ruszając pozostałych pozycji.
//
// Atrapy: Radix Select (happy-dom nie otwiera warstwy) i Supabase (podpowiedzi
// taksonomii trybu dynamicznego). Słownik jest PRAWDZIWY - asercje mierzą
// napisy, które widzi redakcja.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { ok, supabaseFromStub, type SupabaseFromStub } from "@/test/supabaseChain";
import type { Json, WidgetContent } from "@/lib/builder/types";
import { RatedListEditor } from "../RatedListEditor";

const db: { current: SupabaseFromStub } = { current: supabaseFromStub() };

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => db.current.from(table) },
}));
vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const { radixSelectStub } = await import("@/test/reactStubs");
  return radixSelectStub(React);
});

type Row = Record<string, Json>;

function renderEditor(content: WidgetContent, lang: "pl" | "en" = "pl") {
  const calls: Array<[string, Json]> = [];
  renderWithQueryClient(
    <RatedListEditor c={content} lang={lang} setContent={(k, v) => void calls.push([k, v])} />,
  );
  const last = (key: string): Json | undefined => calls.filter(([k]) => k === key).at(-1)?.[1];
  const items = (): Row[] => (last("items") ?? []) as Row[];
  return { calls, last, items };
}

/**
 * Sekcja panelu po fragmencie tytułu. Zwinięta sekcja jest rozwijana - pola
 * o tej samej etykiecie („Kolor (light)", „Rozmiar (px)") powtarzają się
 * w kilku sekcjach, więc każda asercja patrzy tylko w swoją.
 */
function section(title: RegExp): HTMLElement {
  const toggle = screen
    .getAllByRole("button")
    .find((b) => b.hasAttribute("aria-expanded") && title.test(b.textContent ?? ""));
  if (!toggle) throw new Error(`test: brak sekcji ${String(title)}`);
  if (toggle.getAttribute("aria-expanded") === "false") fireEvent.click(toggle);
  return toggle.parentElement as HTMLElement;
}

function fieldIn(box: HTMLElement, label: string): HTMLInputElement & HTMLSelectElement {
  const node = within(box).getByText(label, { selector: "label" });
  const field = node.parentElement?.querySelector("input, select");
  if (!field) throw new Error(`test: brak pola pod „${label}"`);
  return field as HTMLInputElement & HTMLSelectElement;
}

beforeEach(() => {
  db.current = supabaseFromStub();
  for (const table of ["categories", "tags", "post_categories", "post_tags"]) {
    db.current.setResponse(table, ok([]));
  }
});
afterEach(cleanup);

describe("RatedListEditor - przełączniki widoczności", () => {
  it.each([
    [/Entry Category/, "Pokazuj kategorię nad tytułem", "showCategory", false],
    [/Entry Category/, "UPPERCASE", "categoryUppercase", true],
    [/Entry Meta/, "Pokazuj datę publikacji", "showDate", false],
    [/Excerpt/, "Pokazuj zajawkę", "showExcerpt", true],
    [/Read More/, "Pokazuj „Czytaj więcej”", "showReadMore", false],
    [/Bookmark/, "Pokazuj ikonę zakładki", "showBookmark", false],
    [/Post Format/, "Pokazuj ikonę formatu (wideo / galeria itd.)", "showPostFormat", false],
  ])(
    "„%s / %s” bez zapisu stoi jak w rendererze i zapisuje odwrotność",
    (title, label, key, def) => {
      const { last } = renderEditor({ source: "manual", items: [] });
      const box = section(title);
      const toggle = within(box).getByLabelText(label) as HTMLInputElement;
      expect(toggle.checked).toBe(def);
      fireEvent.click(toggle);
      expect(last(key)).toBe(!def);
    },
  );

  it("ocena listy ręcznej jest domyślnie włączona i zapisuje wyłączenie", () => {
    const { last } = renderEditor({ source: "manual", items: [] });
    const toggle = screen.getByLabelText("Pokazuj ocenę (paski + liczba)") as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    fireEvent.click(toggle);
    expect(last("showRating")).toBe(false);
  });

  it("wartość logiczna zapisana napisem w starszej treści jest czytana jak w rendererze", () => {
    renderEditor({ source: "manual", items: [], showExcerpt: "false", showDate: "true" });
    expect(
      (within(section(/Excerpt/)).getByLabelText("Pokazuj zajawkę") as HTMLInputElement).checked,
    ).toBe(false);
    expect(
      (within(section(/Entry Meta/)).getByLabelText("Pokazuj datę publikacji") as HTMLInputElement)
        .checked,
    ).toBe(true);
  });
});

describe("RatedListEditor - pola liczbowe sekcji stylu i układu", () => {
  // [sekcja, etykieta, klucz, zapis (w zakresie renderera), wpis, zero ->]
  // Ostatnia kolumna: co zapisuje „0" - zero tam, gdzie mieści się w zakresie
  // (odstęp 0 px i ramka bez grubości to świadomy wybór), minimum renderera
  // tam, gdzie zero nie jest rozmiarem.
  const FIELDS = [
    [/Index Counter/, "Rozmiar (px)", "numberSizePx", 60, "80", 80, 12],
    [/Entry Category/, "Rozmiar (px)", "categorySizePx", 12, "14", 14, 8],
    [/Entry Meta/, "Rozmiar (px)", "metaSizePx", 10, "13", 13, 8],
    [/Excerpt/, "Linie (clamp)", "excerptLines", 4, "5", 5, 1],
    [/Bookmark/, "Rozmiar (px)", "bookmarkSizePx", 18, "20", 20, 10],
    [/Columns/, "Desktop", "columnsDesktop", 4, "3", 3, 1],
    [/Columns/, "Tablet", "columnsTablet", 3, "2", 2, 1],
    [/Columns/, "Mobile", "columnsMobile", 2, "3", 3, 1],
    [/Columns/, "Column gap (px)", "columnGapPx", 7, "32", 32, 0],
    [/Columns/, "Row gap (px)", "rowGapPx", 7, "40", 40, 0],
    [/Grid Borders/, "Grubość (px)", "gridBorderWidthPx", 7, "2", 2, 0],
  ] as const;

  it.each(FIELDS)(
    "%s / „%s” zapisuje liczbę pod %s; pusty szkic przywraca zapis dokumentu",
    (title, label, key, stored, typed, expected) => {
      const { calls, last } = renderEditor({ source: "manual", items: [], [key]: stored });
      const field = fieldIn(section(title), label);
      expect(field.value).toBe(String(stored));
      fireEvent.focus(field);
      fireEvent.change(field, { target: { value: typed } });
      expect(last(key)).toBe(expected);
      const writes = calls.length;
      fireEvent.change(field, { target: { value: "" } });
      fireEvent.blur(field);
      // Panel testowy nie odświeża treści, więc „dokument" to wciąż `stored`.
      expect(calls).toHaveLength(writes);
      expect(field.value).toBe(String(stored));
    },
  );

  it.each(FIELDS)(
    "%s / „%s”: wpis „0” pod %s ląduje jako %s",
    (title, label, key, stored, _typed, _expected, onZero) => {
      const { last } = renderEditor({ source: "manual", items: [], [key]: stored });
      const field = fieldIn(section(title), label);
      fireEvent.focus(field);
      fireEvent.change(field, { target: { value: "0" } });
      fireEvent.blur(field);
      expect(last(key)).toBe(onZero);
    },
  );

  it("bez zapisu pola pokazują wartości domyślne renderera", () => {
    renderEditor({ source: "manual", items: [] });
    expect(fieldIn(section(/Index Counter/), "Rozmiar (px)").value).toBe("52");
    expect(fieldIn(section(/Entry Category/), "Rozmiar (px)").value).toBe("11");
    expect(fieldIn(section(/Columns/), "Column gap (px)").value).toBe("24");
    expect(fieldIn(section(/Columns/), "Row gap (px)").value).toBe("28");
    expect(fieldIn(section(/Grid Borders/), "Grubość (px)").value).toBe("1");
  });

  it("etykieta przezroczystości pokazuje procent bieżącej wartości", () => {
    renderEditor({ source: "manual", items: [], numberOpacity: 0.35 });
    expect(within(section(/Index Counter/)).getByText("Przezroczystość (35%)")).toBeTruthy();
  });

  it("etykiety suwaków odstępu i wypełnienia pokazują bieżącą wartość", () => {
    renderEditor({ source: "manual", items: [], itemSpacingPx: 12 });
    const box = section(/Spacing/);
    expect(within(box).getByText("Odstęp między pozycjami (px) - 12")).toBeTruthy();
    expect(within(box).getByText("Padding wewnątrz pozycji (px) - 0")).toBeTruthy();
  });
});

describe("RatedListEditor - listy wyboru i kolory", () => {
  it.each([
    [/Index Counter/, "Font", "numberFont", "display", "serif"],
    [/Index Counter/, "Grubość", "numberWeight", "700", "900"],
    [/Index Counter/, "Pozycja", "numberPosition", "behind", "top"],
    [/Entry Category/, "Grubość", "categoryWeight", "700", "500"],
    [/Post Title/, "Grubość", "titleWeight", "700", "400"],
    [/Post Title/, "Font", "titleFont", "display", "mono"],
    [/Text Color Scheme/, "Schemat", "colorScheme", "auto", "dark"],
    [/Grid Borders/, "Tryb", "gridBorders", "none", "between"],
    [/Scrolling Mode/, "Tryb", "scrollingMode", "none", "carousel"],
  ])("%s / „%s” pokazuje %s domyślnie i zapisuje wybór pod %s", (title, label, key, def, pick) => {
    const { last } = renderEditor({ source: "manual", items: [] });
    const select = fieldIn(section(title), label);
    expect(select.value).toBe(def);
    fireEvent.change(select, { target: { value: pick } });
    expect(last(key)).toBe(pick);
  });

  it.each([
    [/Index Counter/, "Kolor (light)", "numberColor"],
    [/Index Counter/, "Kolor (dark)", "numberColorDark"],
    [/Entry Category/, "Kolor tekstu", "categoryColor"],
    [/Entry Category/, "Kolor (dark)", "categoryColorDark"],
    [/Post Title/, "Kolor (light)", "titleColor"],
    [/Post Title/, "Kolor (dark)", "titleColorDark"],
    [/Post Title/, "Hover", "titleHoverColor"],
    [/Entry Meta/, "Kolor (light)", "metaColor"],
    [/Entry Meta/, "Kolor (dark)", "metaColorDark"],
    [/Excerpt/, "Kolor (light)", "excerptColor"],
    [/Excerpt/, "Kolor (dark)", "excerptColorDark"],
    [/Read More/, "Kolor (light)", "readMoreColor"],
    [/Read More/, "Kolor (dark)", "readMoreColorDark"],
    [/Bookmark/, "Kolor", "bookmarkColor"],
    [/Bookmark/, "Kolor (dark)", "bookmarkColorDark"],
    [/Post Format/, "Kolor ikony", "postFormatColor"],
    [/Post Format/, "Kolor (dark)", "postFormatColorDark"],
    [/Grid Borders/, "Kolor", "gridBorderColor"],
  ])("%s / „%s” zapisuje kolor pod %s, a wyczyszczony - PUSTY napis", (title, label, key) => {
    const { last } = renderEditor({ source: "manual", items: [], [key]: "#101010" });
    const field = fieldIn(section(title), label);
    expect(field.value).toBe("#101010");
    fireEvent.change(field, { target: { value: "#abcdef" } });
    expect(last(key)).toBe("#abcdef");
    fireEvent.change(field, { target: { value: "" } });
    expect(last(key)).toBe("");
  });

  it("tekst „Czytaj więcej” ma domyślną wartość wersji językowej i zapisuje się pod jej kluczem", () => {
    const { last } = renderEditor({ source: "manual", items: [] }, "en");
    const field = fieldIn(section(/Read More/), "Tekst (EN)");
    expect(field.value).toBe("Read more");
    fireEvent.change(field, { target: { value: "Continue" } });
    expect(last("readMoreText_en")).toBe("Continue");
  });

  it("tryb dynamiczny: format wpisów i kolejność zapisują wybraną opcję", () => {
    const { last } = renderEditor({ source: "dynamic" });
    const box = screen.getByText("Query Settings").parentElement as HTMLElement;
    const format = fieldIn(box, "Post Format");
    const order = fieldIn(box, "Order By");
    expect(format.value).toBe("all");
    expect(order.value).toBe("last_published");
    fireEvent.change(format, { target: { value: "video" } });
    fireEvent.change(order, { target: { value: "random" } });
    expect(last("postFormatFilter")).toBe("video");
    expect(last("orderBy")).toBe("random");
  });

  it("zmiana źródła zapisuje się w dokumencie", () => {
    const { last } = renderEditor({ source: "manual", items: [] });
    fireEvent.change(fieldIn(document.body, "Skąd brać materiały"), {
      target: { value: "dynamic" },
    });
    expect(last("source")).toBe("dynamic");
  });
});

describe("RatedListEditor - pozycje listy ręcznej", () => {
  const item = (n: number, over: Row = {}): Row => ({
    title_pl: `Pozycja ${n}`,
    title_en: `Item ${n}`,
    excerpt_pl: "",
    excerpt_en: "",
    author: "",
    rating: 0,
    href: "",
    ...over,
  });
  const box = (n: number) =>
    screen.getByText(`Pozycja #${n}`).parentElement?.parentElement as HTMLElement;

  it.each([
    ["Tytuł (EN)", "title_en", "Report"],
    ["Zajawka (EN)", "excerpt_en", "Short lead"],
    ["Kategoria (EN)", "category_en", "Analysis"],
    ["Autor", "author", "Jan Nowak"],
    ["Data (YYYY-MM-DD)", "date", "2026-10-01"],
  ])("pole „%s” drugiej pozycji zapisuje %s, nie ruszając pierwszej", (label, key, value) => {
    const { items } = renderEditor({ source: "manual", items: [item(1), item(2)] }, "en");
    const row = box(2);
    const field = within(row)
      .getByText(label, { selector: "label" })
      .parentElement?.querySelector("input, textarea") as HTMLInputElement;
    fireEvent.change(field, { target: { value } });
    expect(items()).toEqual([item(1), item(2, { [key]: value })]);
  });

  it("format pozycji: brak zapisu to „standard”, wybór zapisuje się w pozycji", () => {
    const { items } = renderEditor({ source: "manual", items: [item(1)] });
    const select = fieldIn(box(1), "Format");
    expect(select.value).toBe("standard");
    fireEvent.change(select, { target: { value: "gallery" } });
    expect(items()[0]).toEqual(item(1, { format: "gallery" }));
  });

  it("ocena wpisana śmieciem nie trafia ani do pola, ani do dokumentu (żadnego NaN)", () => {
    const { calls } = renderEditor({ source: "manual", items: [item(1, { rating: 8 })] });
    const rating = fieldIn(box(1), "Ocena (0–10)");
    fireEvent.focus(rating);
    fireEvent.change(rating, { target: { value: "abc" } });
    fireEvent.blur(rating);
    expect(rating.value).toBe("8");
    expect(calls).toEqual([]);
  });

  it("usunięcie pozycji zostawia pozostałe w kolejności", () => {
    const { items } = renderEditor({ source: "manual", items: [item(1), item(2), item(3)] });
    fireEvent.click(within(box(2)).getByRole("button", { name: "Usuń" }));
    expect(items()).toEqual([item(1), item(3)]);
  });

  it("dodanie seeduje pozycję ze wszystkimi polami listy", () => {
    const { items } = renderEditor({ source: "manual", items: [item(1)] });
    fireEvent.click(
      within(screen.getByText("Pozycje listy").parentElement as HTMLElement).getByRole("button"),
    );
    expect(items()).toEqual([item(1), item(1, { title_pl: "Nowa pozycja", title_en: "New item" })]);
  });
});
