// Kawałek „part1" tabeli edytorów treści widgetów: AccordionEditor, AccountLinkEditor,
// AnimatedHeadingEditor, AuthorProfileCardEditor, CircularCarouselEditor.
//
// Cała logika przejazdu (bloki, fixture'y, podmiany) siedzi w
// `editorMatrix.shared.tsx` - tu jest tylko wybór podzbioru edytorów. PO CO
// PODZIAŁ i skąd budżet pamięci na plik: patrz nagłówek tamtego modułu.
//
// Import modułu wspólnego MUSI być pierwszy: to on niesie fabryki `vi.mock`.
import { defineEditorMatrix, editorsOf } from "./editorMatrix.shared";

defineEditorMatrix(editorsOf("part1"), { sharedPreviews: true });

// ── AnimatedHeadingEditor: gałęzie ODMOWY i brzegi, których tabela nie rusza ──
//
// Tabela przejeżdża każdy edytor tym samym zestawem bloków, więc dotyka
// wyłącznie kontrolek WIDOCZNYCH przy jej treściach. W nagłówku animowanym
// zostają poza nią cztery powierzchnie, każda za warunkiem:
//   1. `handleModeChange` - zmiana trybu MUSI przestawić kształt, jeśli stary
//      kształt nie należy do nowego trybu (kształty „hover-*" nie istnieją
//      w trybie wyróżnienia i odwrotnie);
//   2. tryb „rotate" - pole rotujących słów jest TEKSTAREĄ, a nie polem
//      jednolinijkowym, i ma własny parser (linia = słowo);
//   3. wstawiacz tagów dynamicznych (`DynamicTagInserter`) - siedzi
//      w rozwijanej warstwie, więc żaden przejazd po `input`/`select` go nie
//      otwiera;
//   4. czas trwania w trybach „hover-*" - inne pole niż w trybie wyróżnienia
//      (inny zakres i inna wartość zapasowa).
//
// Atrapy (i18n, Select, Supabase) przychodzą z modułu wspólnego zaimportowanego
// WYŻEJ - dlatego ten blok stoi w kawałku tabeli, a nie w osobnym pliku.
//
// ŚWIADOMIE BEZ TESTU zostaje JEDNA gałąź edytora: prawa strona
// `accentColor || "var(--foreground)"` w miniaturce kształtu. Jest NIEOSIĄGALNA
// i nie jest to defekt: `accentColor` liczy się wyżej jako
// `(typeof c.accentColor === "string" ? c.accentColor : "") || "#f97316"`, więc
// nigdy nie jest pustym łańcuchem. Zapasowa wartość `var(--foreground)` to
// martwa asekuracja po tamtej wartości domyślnej, a nie druga ścieżka
// zachowania - autor, który skasuje kolor akcentu, dostaje #f97316 tak samo
// w miniaturkach, jak w podglądzie na żywo. Zapisane, żeby następna osoba nie
// szukała scenariusza, którego nie ma.
import { describe, it, expect } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import type { Json, WidgetNode } from "@/lib/builder/types";
import { AnimatedHeadingEditor } from "../AnimatedHeadingEditor";

function renderAnimated(c: WidgetNode["content"], lang: "pl" | "en" = "pl") {
  const written: Array<[string, Json]> = [];
  const view = renderWithQueryClient(
    <AnimatedHeadingEditor c={c} lang={lang} setContent={(k, v) => written.push([k, v])} />,
  );
  const wrote = (key: string): Json | undefined => written.filter(([k]) => k === key).at(-1)?.[1];
  return { ...view, written, wrote };
}

/** Lista trybów: jedyny `<select>` z opcją „hover-allsides". */
const modeSelect = (): HTMLSelectElement => {
  const found = Array.from(document.querySelectorAll<HTMLSelectElement>("select")).find((s) =>
    s.querySelector('option[value="hover-allsides"]'),
  );
  if (!found) throw new Error("test: brak listy trybów nagłówka animowanego");
  return found;
};

/**
 * Otwiera n-ty wstawiacz tagów dynamicznych i klika pierwszy token z katalogu.
 * Zwraca wstawiony token, żeby asercja nie powtarzała jego treści.
 */
function insertFirstToken(index: number): string {
  const triggers = screen.getAllByLabelText("builder.dynamicTag.trigger");
  fireEvent.click(triggers[index]);
  const option = document.querySelectorAll<HTMLButtonElement>("ul button")[0];
  const token = option.querySelector("code")?.textContent ?? "";
  fireEvent.click(option);
  return token;
}

describe("AnimatedHeadingEditor - zmiana trybu pilnuje kształtu", () => {
  it("wejście w tryb „hover - podkreślenie” przestawia kształt na hover-line-1", () => {
    const { wrote } = renderAnimated({ mode: "highlight", shape: "underline" });
    fireEvent.change(modeSelect(), { target: { value: "hover-underline" } });
    expect(wrote("mode")).toBe("hover-underline");
    // Kształt „underline" nie istnieje w trybie hover - zostawienie go
    // dawałoby nagłówek bez ani jednej widocznej animacji.
    expect(wrote("shape")).toBe("hover-line-1");
  });

  it("wejście w tryb „hover - ramka” przestawia kształt na hover-allsides-1", () => {
    const { wrote } = renderAnimated({ mode: "highlight", shape: "underline" });
    fireEvent.change(modeSelect(), { target: { value: "hover-allsides" } });
    expect(wrote("shape")).toBe("hover-allsides-1");
  });

  it("wyjście z trybu hover wraca do kształtu „underline”", () => {
    const { wrote } = renderAnimated({ mode: "hover-underline", shape: "hover-line-3" });
    fireEvent.change(modeSelect(), { target: { value: "rotate" } });
    expect(wrote("mode")).toBe("rotate");
    // Kształt „hover-line-3" w trybie rotacji nie rysuje nic - panel musi
    // oddać kształt, który ten tryb umie pokazać.
    expect(wrote("shape")).toBe("underline");
  });

  it("kształt zgodny z nowym trybem zostaje nietknięty", () => {
    const { written } = renderAnimated({ mode: "hover-underline", shape: "hover-line-5" });
    fireEvent.change(modeSelect(), { target: { value: "hover-underline" } });
    // Jedyny zapis to sam tryb - przestawianie zgodnego kształtu kasowałoby
    // wybór redakcji bez powodu.
    expect(written.map(([k]) => k)).toEqual(["mode"]);
  });

  it("lista kształtów pokazuje TYLKO kształty aktualnego trybu", () => {
    const hover = renderAnimated({ mode: "hover-underline", shape: "hover-line-1" });
    const hoverShapes = Array.from(
      hover.container.querySelectorAll<HTMLButtonElement>("button[title]"),
    ).map((b) => b.getAttribute("title"));
    expect(hoverShapes.length).toBeGreaterThan(0);
    expect(hoverShapes.some((title) => title === "Podkreślenie")).toBe(false);
    hover.unmount();

    const plain = renderAnimated({ mode: "highlight", shape: "underline" });
    const plainShapes = Array.from(
      plain.container.querySelectorAll<HTMLButtonElement>("button[title]"),
    ).map((b) => b.getAttribute("title"));
    expect(plainShapes.some((title) => title === "Podkreślenie")).toBe(true);
    expect(plainShapes.some((title) => (title ?? "").startsWith("Hover:"))).toBe(false);
  });
});

describe("AnimatedHeadingEditor - tryb rotacji słów", () => {
  it("czyta słowa z tablicy treści i odrzuca pozycje nienapisowe", () => {
    // Dokumenty po imporcie mają w tej tablicy liczby i `null` - pokazanie ich
    // w textarei dałoby redakcji „7" jako słowo do rotacji.
    const { container } = renderAnimated({
      mode: "rotate",
      rotateWords_pl: ["Alfa", 7, null, "Beta"] as unknown as Json,
    });
    const area = container.querySelector("textarea");
    expect(area?.value).toBe("Alfa\nBeta");
  });

  it("każda linia textarei staje się osobnym słowem, a puste linie znikają", () => {
    const { container, wrote } = renderAnimated({ mode: "rotate" });
    const area = container.querySelector("textarea");
    if (!area) throw new Error("test: brak pola rotujących słów");
    fireEvent.change(area, { target: { value: "  Pierwsze  \n\n Drugie \n   " } });
    expect(wrote("rotateWords_pl")).toEqual(["Pierwsze", "Drugie"]);
  });

  it("pusta textarea zapisuje pustą tablicę, nie pustą linię", () => {
    const { container, wrote } = renderAnimated({
      mode: "rotate",
      rotateWords_pl: ["Alfa"] as unknown as Json,
    });
    const area = container.querySelector("textarea");
    if (!area) throw new Error("test: brak pola rotujących słów");
    fireEvent.change(area, { target: { value: "" } });
    // Tablica z jednym pustym napisem rotowałaby pustkę - renderer pokazałby
    // dziurę w nagłówku.
    expect(wrote("rotateWords_pl")).toEqual([]);
  });

  it("wstawiacz tagów dokłada token jako NOWE słowo listy", () => {
    const { wrote } = renderAnimated(
      {
        mode: "rotate",
        rotateWords_en: ["Alpha"] as unknown as Json,
      },
      "en",
    );
    const token = insertFirstToken(2);
    expect(wrote("rotateWords_en")).toEqual(["Alpha", token]);
  });

  it("tryb rotacji nie pokazuje pola wyróżnionego słowa", () => {
    const { container } = renderAnimated({ mode: "rotate" });
    expect(container.querySelector("textarea")).not.toBeNull();
    const rotateLabel = "builder.animatedHeadingEditor.highlight(lang=PL)";
    expect(container.textContent?.includes(rotateLabel)).toBe(false);
  });
});

describe("AnimatedHeadingEditor - wstawianie tagów dynamicznych do pól tekstowych", () => {
  it.each([
    ["pole puste - token bez odstępu", "", (token: string) => token],
    ["pole kończy się spacją - token bez drugiego odstępu", "Ala ", (t: string) => `Ala ${t}`],
    ["pole kończy się literą - token po odstępie", "Ala", (t: string) => `Ala ${t}`],
  ])("tekst przed: %s", (_label, before, expected) => {
    const { wrote } = renderAnimated({ mode: "highlight", textBefore_pl: before });
    const token = insertFirstToken(0);
    expect(wrote("textBefore_pl")).toBe(expected(token));
  });

  it("token trafia do pola tekstu PO nagłówku, nie do pola przed", () => {
    const { wrote } = renderAnimated({ mode: "highlight", textAfter_pl: "koniec" });
    const token = insertFirstToken(1);
    expect(wrote("textAfter_pl")).toBe(`koniec ${token}`);
    expect(wrote("textBefore_pl")).toBeUndefined();
  });

  it("token trafia do wyróżnionego słowa w języku treści", () => {
    const { wrote } = renderAnimated({ mode: "highlight", highlight_en: "Report" }, "en");
    const token = insertFirstToken(2);
    expect(wrote("highlight_en")).toBe(`Report ${token}`);
  });
});

describe("AnimatedHeadingEditor - czas trwania i zapętlenie", () => {
  it("tryby hover mają własne pole czasu z wartością zapasową 300 ms", () => {
    const { container, wrote } = renderAnimated({ mode: "hover-underline", durationMs: 800 });
    const numbers = container.querySelectorAll<HTMLInputElement>('input[type="number"]');
    // W trybie hover panel pokazuje JEDNO pole czasu - bez opóźnienia
    // i zapętlenia, których ten tryb nie ma.
    expect(numbers).toHaveLength(1);
    expect(numbers[0].value).toBe("800");
    fireEvent.change(numbers[0], { target: { value: "450" } });
    expect(wrote("durationMs")).toBe(450);
    // Zero to nie „bez animacji", tylko brak wartości - pole oddaje minimum
    // trybu hover, a nie 1600 ms z trybu wyróżnienia.
    fireEvent.change(numbers[0], { target: { value: "0" } });
    expect(wrote("durationMs")).toBe(300);
  });

  it("zapętlenie zapisane jako fałsz pokazuje się jako wyłączone", () => {
    const { container } = renderAnimated({ mode: "highlight", loop: false });
    const loopSelect = Array.from(container.querySelectorAll<HTMLSelectElement>("select")).find(
      (s) => s.querySelector('option[value="off"]'),
    );
    expect(loopSelect?.value).toBe("off");
  });

  it("zapętlenie brakujące w treści jest WŁĄCZONE (jak w rendererze)", () => {
    const { container } = renderAnimated({ mode: "highlight" });
    const loopSelect = Array.from(container.querySelectorAll<HTMLSelectElement>("select")).find(
      (s) => s.querySelector('option[value="off"]'),
    );
    expect(loopSelect?.value).toBe("on");
  });
});
