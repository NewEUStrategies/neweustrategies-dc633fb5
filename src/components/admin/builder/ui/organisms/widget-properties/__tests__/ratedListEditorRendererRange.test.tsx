// RatedListEditor: pola liczbowe pokazują i zapisują to, co RYSUJE renderer.
//
// `RatedListView` (oraz `ratedListQuery` dla zapytania trybu dynamicznego)
// domyka każdą liczbę `asNumInRange`, a panel zapisywał `Number(v) || domyślna`
// bez klamry: rozmiar numeru 500 w panelu był na kanwie rysowany jako 240,
// przesunięcie -3 jako 0, a ocena 15 rysowała pełny pasek „na 10". Wyczyszczenie
// pola w trakcie pisania od razu wstawiało wartość domyślną, więc liczby
// wielocyfrowej nie dało się wpisać od zera.
//
// Pola idą teraz przez wspólny atom `ClampedNumberInput` (szkic, zapis w locie
// dla wartości w zakresie, klamra przy opuszczeniu pola).
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { useState } from "react";
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

function renderEditor(initial: WidgetContent) {
  const written: Array<[string, Json]> = [];
  function Host() {
    const [content, setContent] = useState<WidgetContent>(initial);
    return (
      <RatedListEditor
        c={content}
        lang="pl"
        setContent={(k, v) => {
          written.push([k, v]);
          setContent((prev) => ({ ...prev, [k]: v }));
        }}
      />
    );
  }
  renderWithQueryClient(<Host />);
  const writesOf = (key: string): Json[] => written.filter(([k]) => k === key).map(([, v]) => v);
  return { written, writesOf };
}

/** Sekcja panelu po fragmencie tytułu (zwinięta jest rozwijana). */
function section(title: RegExp): HTMLElement {
  const toggle = screen
    .getAllByRole("button")
    .find((b) => b.hasAttribute("aria-expanded") && title.test(b.textContent ?? ""));
  if (!toggle) throw new Error(`test: brak sekcji ${String(title)}`);
  if (toggle.getAttribute("aria-expanded") === "false") fireEvent.click(toggle);
  return toggle.parentElement as HTMLElement;
}

/** Pole spod etykiety `PropField` (etykieta i kontrolka są rodzeństwem). */
function fieldIn(box: HTMLElement, label: string): HTMLInputElement {
  const node = within(box).getByText(label, { selector: "label" });
  const input = node.parentElement?.querySelector("input");
  if (!input) throw new Error(`test: brak pola pod „${label}"`);
  return input;
}

beforeEach(() => {
  db.current = supabaseFromStub();
  for (const table of ["categories", "tags", "post_categories", "post_tags"]) {
    db.current.setResponse(table, ok([]));
  }
});
afterEach(cleanup);

describe("RatedListEditor - panel pokazuje wartość domkniętą jak w rendererze", () => {
  it.each([
    // [sekcja, etykieta, klucz, zapis, co rysuje renderer]
    [/Index Counter/, "Rozmiar (px)", "numberSizePx", 500, "240"],
    [/Entry Category/, "Rozmiar (px)", "categorySizePx", 2, "8"],
    [/Entry Meta/, "Rozmiar (px)", "metaSizePx", 99, "20"],
    [/Excerpt/, "Linie (clamp)", "excerptLines", 40, "10"],
    [/Bookmark/, "Rozmiar (px)", "bookmarkSizePx", 64, "32"],
    [/Columns/, "Desktop", "columnsDesktop", 12, "6"],
    [/Columns/, "Mobile", "columnsMobile", 5, "3"],
    [/Columns/, "Column gap (px)", "columnGapPx", 400, "120"],
    [/Grid Borders/, "Grubość (px)", "gridBorderWidthPx", 30, "8"],
  ])(
    "%s / „%s”: %s=%s pokazuje %s, bez zapisu przy renderze",
    (title, label, key, stored, drawn) => {
      const { written } = renderEditor({ source: "manual", items: [], [key]: stored });
      expect(fieldIn(section(title), label).value).toBe(drawn);
      expect(written).toEqual([]);
    },
  );

  it("tryb dynamiczny: liczba wpisów i przesunięcie domknięte jak w zapytaniu", () => {
    renderEditor({ source: "dynamic", numberOfPosts: 90, postOffset: -4 });
    const box = screen.getByText("Query Settings").parentElement as HTMLElement;
    expect(fieldIn(box, "Number of Posts").value).toBe("50");
    expect(fieldIn(box, "Post Offset").value).toBe("0");
  });
});

describe("RatedListEditor - zapis domknięty przy wyjściu z pola", () => {
  it("rozmiar numeru spoza zakresu: nic w trakcie pisania, klamra przy wyjściu", () => {
    const { writesOf } = renderEditor({ source: "manual", items: [], numberSizePx: 52 });
    const size = fieldIn(section(/Index Counter/), "Rozmiar (px)");
    fireEvent.focus(size);
    fireEvent.change(size, { target: { value: "500" } });
    expect(size.value).toBe("500");
    expect(writesOf("numberSizePx")).toEqual([]);
    fireEvent.blur(size);
    expect(writesOf("numberSizePx")).toEqual([240]);
    expect(size.value).toBe("240");
  });

  it("przesunięcie ujemne ląduje jako zero - zapytanie i tak bierze `max(0, …)`", () => {
    const { writesOf } = renderEditor({ source: "dynamic", postOffset: 2 });
    const box = screen.getByText("Query Settings").parentElement as HTMLElement;
    const offset = fieldIn(box, "Post Offset");
    fireEvent.focus(offset);
    fireEvent.change(offset, { target: { value: "-3" } });
    fireEvent.keyDown(offset, { key: "Enter" });
    expect(writesOf("postOffset")).toEqual([0]);
  });

  it("wyczyszczenie maksymalnej wysokości nie wstawia 400 - da się wpisać 720 od zera", () => {
    const { writesOf } = renderEditor({
      source: "manual",
      items: [],
      scrollingMode: "scroll",
      scrollMaxHeightPx: 500,
    });
    const height = fieldIn(section(/Scrolling Mode/), "Max wysokość (px)");
    fireEvent.focus(height);
    fireEvent.change(height, { target: { value: "" } });
    expect(height.value).toBe("");
    for (const typed of ["7", "72", "720"]) {
      fireEvent.change(height, { target: { value: typed } });
      expect(height.value).toBe(typed);
    }
    // „7" i „72" są poniżej 120 px - zapisem jest dopiero pełna liczba.
    expect(writesOf("scrollMaxHeightPx")).toEqual([720]);
  });

  it("ocena pozycji: ułamek zapisany w locie, 15 domknięte do 10 (pasek renderera kończy się na 10)", () => {
    const { writesOf } = renderEditor({ source: "manual", items: [{ title_pl: "A", rating: 4 }] });
    const rating = fieldIn(
      screen.getByText("Pozycja #1").parentElement?.parentElement as HTMLElement,
      "Ocena (0–10)",
    );
    fireEvent.focus(rating);
    fireEvent.change(rating, { target: { value: "7.5" } });
    const ratings = () =>
      writesOf("items").map((items) => (items as Array<Record<string, Json>>)[0]?.rating);
    expect(ratings()).toEqual([7.5]);
    fireEvent.change(rating, { target: { value: "15" } });
    expect(ratings()).toEqual([7.5]);
    fireEvent.blur(rating);
    expect(ratings()).toEqual([7.5, 10]);
    expect(rating.value).toBe("10");
  });
});
