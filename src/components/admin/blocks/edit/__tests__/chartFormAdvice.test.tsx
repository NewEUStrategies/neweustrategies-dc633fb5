// ZALECENIE FORMY WIDZI AUTOR, NIE CZYTELNIK - dowód od strony edytora.
//
// PO CO. Bramka `src/lib/charts/__tests__/chartAdviceAudience.test.ts` pilnuje
// podziału STATYCZNIE: że render publiczny nie woła klucza `advice.` i że
// worek liczb pokrywa wstawki. Nie odpowiada jednak na pytanie, czy autor
// naprawdę TE ZDANIA WIDZI - a podział, w którym zalecenie zniknęło
// czytelnikowi i nie pojawiło się autorowi, byłby usunięciem funkcji, nie jej
// przeniesieniem. Tu jest dowód, że pojawiło się w panelu bloku.
//
// GRANICE. Mocki (Radix, sonner, router, Supabase) niesie moduł wspólny
// tabeli edytorów, dlatego jego import jest PIERWSZY. i18n jest PRAWDZIWE -
// inaczej test przechodziłby na surowych kluczach.
import { describe, expect, it } from "vitest";

import { renderEditor } from "./blockEditMatrix.shared";
import type { Block, Json } from "@/lib/blocks/types";
import { ChartBlock } from "../DataVizBlocks";

function blok(data: Record<string, Json>): Block {
  return { id: "blk-chart", type: "chart", data: { animate: false, ...data } };
}

/** Dwadzieścia obserwacji - powyżej progu kształtu histogramu. */
const DWADZIESCIA = [1, 2, 2, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 5, 6, 6, 6, 7, 7];

describe("edytor bloku wykresu - zalecenia formy dla autora", () => {
  it("mapa ciepła o jednym wierszu dostaje ZALECENIE, nie samą obserwację", () => {
    // Obserwacja („dane nie mają kształtu macierzy") stoi pod podglądem, bo
    // pisze ją ten sam render, co na stronie. Zalecenie („przy jednym
    // wymiarze czytelniejsze są posortowane słupki poziome") jest TYLKO tutaj
    // i to ono mówi autorowi, co zrobić.
    const { container } = renderEditor(
      ChartBlock,
      blok({
        kind: "heatmap",
        categories: ["a", "b", "c", "d"],
        series: [{ name: "Jedyny", values: [1, 2, 3, 4] }],
      }),
    );
    const tekst = container.textContent ?? "";
    expect(tekst).toContain("posortowane słupki poziome");
    // Liczby z worka podstawione, nie zostawione jako klamry.
    expect(tekst).toContain("2 wierszy");
    expect(tekst).not.toContain("{{");
  });

  it("histogram na małej próbce dostaje zalecenie zmiany formy", () => {
    const { container } = renderEditor(
      ChartBlock,
      blok({
        kind: "histogram",
        categories: ["a", "b", "c", "d", "e"],
        series: [{ name: "Marża", values: [1, 2, 3, 4, 5] }],
      }),
    );
    // Zdanie o BEESWARMIE jest wyłącznie w rejestrze zalecenia - wersja dla
    // czytelnika mówi o zależności kształtu od krawędzi i nie wymienia
    // żadnej innej formy.
    expect(container.textContent ?? "").toContain("Beeswarm");
  });

  it("pełny arkusz nie dostaje ŻADNEGO zalecenia", () => {
    // Ostrzeżenie, które widać zawsze, uczy ignorowania wszystkich ostrzeżeń.
    const { container } = renderEditor(
      ChartBlock,
      blok({
        kind: "histogram",
        categories: DWADZIESCIA.map((_, i) => `o-${i}`),
        series: [{ name: "Marża", values: DWADZIESCIA }],
      }),
    );
    const tekst = container.textContent ?? "";
    expect(tekst).not.toContain("Beeswarm");
    expect(tekst).not.toContain("{{");
  });

  it("rój NIE dostaje w edytorze zaleceń o geometrii pola rysunku", () => {
    // `doesNotFit` i `truncated` mówią, ile punktów zmieściło się w PASMIE
    // ROJU, a pasmo zależy od wysokości pola i od skali osi, których edytor
    // nie zna: policzone tu, z ustawień domyślnych, byłyby liczbami z innego
    // rysunku niż ten w podglądzie obok. Autor widzi je z podglądu.
    // TRZY SERIE PO SZEŚĆDZIESIĄT, bo `parseChartConfig` ścina arkusz do
    // `MAX_CATEGORIES` kategorii - jedna seria NIE PRZEKROCZY progu komfortu
    // roju (150 obserwacji) żadną zawartością arkusza.
    const kolumna = Array.from({ length: 60 }, (_, i) => (i % 37) + 1);
    const { container } = renderEditor(
      ChartBlock,
      blok({
        kind: "beeswarm",
        categories: kolumna.map((_, i) => `o-${i}`),
        series: [
          { name: "Rój A", values: kolumna },
          { name: "Rój B", values: kolumna },
          { name: "Rój C", values: kolumna },
        ],
      }),
    );
    const tekst = container.textContent ?? "";
    // Zdanie o wysokości pola rysunku NIE MA prawa tu stać.
    expect(tekst).not.toContain("Zwiększ wysokość wykresu");
    expect(tekst).not.toContain("Rysunek pokazuje");
    expect(tekst).not.toContain("{{");
    // A rysunek i tak jest kompletny: trzy roje po sześćdziesiąt obserwacji.
    expect(tekst).toContain("Rój C");
  });
});
