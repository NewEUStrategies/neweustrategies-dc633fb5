// Pomiar szerokości etykiet osi.
//
// PO CO. Ucięte etykiety mają jedną przyczynę: marginesy ustalono, ZANIM
// wiedziano, jak szerokie są etykiety. Odwrócenie tej kolejności wymaga
// realnego pomiaru tekstu, a realny pomiar wymaga kanwy - której nie ma ani
// na serwerze, ani w środowisku testowym (happy-dom).
//
// DLATEGO SĄ DWIE FUNKCJE, NIE JEDNA, i to nie jest nadmiarowość:
//
//   * `estimateLabelWidth` - heurystyka `znaki x rozmiar x 0,62`. Używana
//     PRZY RENDERZE, na serwerze i w pierwszym renderze klienta. Musi zostać
//     dokładnie taka, jaka była, bo `useContainerWidth` też zwraca w tym
//     przejściu wartość początkową - geometria pierwszego malowania jest
//     w całości deterministyczna i identyczna po obu stronach, więc
//     hydratacja się nie rozjeżdża.
//   * `measureLabelWidth` - prawdziwy `canvas.measureText`. Używana WYŁĄCZNIE
//     po zamontowaniu, w efekcie, przez `useLabelMetrics`. Wynik trafia do
//     stanu i wywołuje drugie malowanie z poprawionymi marginesami.
//
// Gdyby pomiar wszedł do funkcji renderującej, serwer policzyłby marginesy
// heurystyką, klient kanwą, i React zgłosiłby rozjazd atrybutów SVG na każdym
// wykresie. To jest ten sam podział pracy, który `useContainerWidth` już
// stosuje dla szerokości kontenera - nowa ścieżka nie wymyśla własnego.
//
// CZEGO POMIAR NIE ZAŁATWIA. Oba fonty mają `font-display: swap`, więc
// pierwszy pomiar po zamontowaniu może trafić w font zastępczy, a nie
// w docelowy. Repo trzyma na to metrycznie dopasowany "Red Hat Display
// Fallback" (size-adjust 96,03%), więc różnica jest poniżej piksela na
// etykietę - ale przy WŁASNYM foncie tenanta już nie, i dlatego
// `useLabelMetrics` ponawia pomiar po `document.fonts.ready`.
import { useEffect, useRef, useState } from "react";

/** Współczynnik szerokości znaku dla heurystyki. Nie zmieniać bez powodu:
 *  na nim stoi geometria SSR i pinowane w testach pozycje w pikselach. */
export const CHAR_WIDTH_RATIO = 0.62;

/** Heurystyczna szerokość etykiety - deterministyczna, bez DOM. */
export function estimateLabelWidth(text: string, fontSize: number): number {
  return text.length * fontSize * CHAR_WIDTH_RATIO;
}

/** Największa heurystyczna szerokość w zestawie (0 dla pustego zestawu). */
export function estimateMaxLabelWidth(labels: readonly string[], fontSize: number): number {
  let max = 0;
  for (const label of labels) max = Math.max(max, estimateLabelWidth(label, fontSize));
  return max;
}

// Jeden kontekst na dokument. `getContext("2d")` jest drogie, a pomiar
// etykiet osi wykonuje się dla każdego wykresu na stronie.
let sharedContext: CanvasRenderingContext2D | null | undefined;

function context(): CanvasRenderingContext2D | null {
  if (sharedContext !== undefined) return sharedContext;
  if (typeof document === "undefined") {
    sharedContext = null;
    return null;
  }
  try {
    sharedContext = document.createElement("canvas").getContext("2d");
  } catch {
    // happy-dom i część przeglądarek w trybie prywatnym potrafią tu rzucić.
    sharedContext = null;
  }
  return sharedContext;
}

/** Wyłącznie dla testów: zapomnij zcache'owany kontekst. */
export function resetTextMeasureCache(): void {
  sharedContext = undefined;
}

/**
 * Rodzina czcionki wykresu, odczytana z tokenu `--chart-font`. Kanwa nie
 * rozumie `var()`, więc token trzeba rozwiązać przed pomiarem - i to jest
 * jedyne miejsce w silniku, które w ogóle dotyka wartości fontu.
 */
export function resolveChartFontFamily(fallback = "system-ui, sans-serif"): string {
  if (typeof window === "undefined" || typeof document === "undefined") return fallback;
  const style = getComputedStyle(document.documentElement);
  const family =
    style.getPropertyValue("--chart-font").trim() || style.getPropertyValue("--font-sans").trim();
  return family || fallback;
}

/**
 * Prawdziwy pomiar. Zwraca `null`, gdy kanwa jest niedostępna albo zwróciła
 * zero dla niepustego napisu - `null` znaczy "nie wiem", a nie "zero", bo
 * zero wpuszczone do marginesu ucina etykiety zamiast je pomieścić.
 */
export function measureLabelWidth(
  text: string,
  fontSize: number,
  fontWeight: number | string = 500,
  fontFamily?: string,
): number | null {
  const ctx = context();
  if (!ctx) return null;
  ctx.font = `${fontWeight} ${fontSize}px ${fontFamily ?? resolveChartFontFamily()}`;
  const width = ctx.measureText(text).width;
  if (!Number.isFinite(width) || (width === 0 && text.length > 0)) return null;
  return width;
}

/** Największa zmierzona szerokość w zestawie albo `null`, gdy pomiar nie wyszedł. */
export function measureMaxLabelWidth(
  labels: readonly string[],
  fontSize: number,
  fontWeight: number | string = 500,
): number | null {
  if (labels.length === 0) return 0;
  const family = resolveChartFontFamily();
  let max = 0;
  for (const label of labels) {
    const width = measureLabelWidth(label, fontSize, fontWeight, family);
    if (width === null) return null;
    max = Math.max(max, width);
  }
  return max;
}

export interface LabelMetrics {
  /** Zmierzona szerokość najdłuższej etykiety osi wartości; null = brak pomiaru. */
  value: number | null;
  /** Zmierzona szerokość najdłuższej etykiety kategorii; null = brak pomiaru. */
  category: number | null;
}

const NO_METRICS: LabelMetrics = { value: null, category: null };

/**
 * Pomiar po zamontowaniu. Zwraca `{value: null, category: null}` przy
 * pierwszym renderze i na serwerze, więc funkcja rysująca ma wtedy dokładnie
 * te dane, co przed tą zmianą, i dopiero drugie malowanie dostaje piksele.
 *
 * Ponawia pomiar po `document.fonts.ready`, bo do tego momentu kanwa mierzy
 * font zastępczy. Aktualizacja stanu jest WARUNKOWA (tylko gdy liczby
 * naprawdę się zmieniły), inaczej każdy wykres płaciłby dodatkowy render za
 * pomiar, który nic nie wniósł.
 */
export function useLabelMetrics(
  valueLabels: readonly string[],
  categoryLabels: readonly string[],
  fontSize: number,
  fontWeight: number | string = 500,
): LabelMetrics {
  const [metrics, setMetrics] = useState<LabelMetrics>(NO_METRICS);
  // Klucz zamiast tablic w zależnościach: tablice etykiet są tworzone przy
  // każdym renderze, więc referencja zmienia się zawsze, a treść prawie nigdy.
  // Separatory jako ESCAPE (`\u001f` między etykietami, `\u001e` na granicy
  // dwóch zestawów), a nie surowe bajty w źródle. DWA POWODY. Etykieta pochodzi
  // od redaktora, więc może zawierać spację i pionową kreskę - sklejenie
  // zwykłym znakiem daje kolizję kluczy (["a|b"] i ["a","b"] dają ten sam
  // klucz, czyli pomiar nie zostałby ponowiony po zmianie danych). A surowy
  // bajt zerowy wpisany w plik czyni go dla gita plikiem binarnym.
  const key = [
    fontSize,
    fontWeight,
    valueLabels.join("\u001f"),
    categoryLabels.join("\u001f"),
  ].join("\u001e");
  const latest = useRef({ valueLabels, categoryLabels, fontSize, fontWeight });
  latest.current = { valueLabels, categoryLabels, fontSize, fontWeight };

  useEffect(() => {
    let cancelled = false;
    const apply = (): void => {
      if (cancelled) return;
      const current = latest.current;
      const next: LabelMetrics = {
        value: measureMaxLabelWidth(current.valueLabels, current.fontSize, current.fontWeight),
        category: measureMaxLabelWidth(
          current.categoryLabels,
          current.fontSize,
          current.fontWeight,
        ),
      };
      setMetrics((prev) =>
        prev.value === next.value && prev.category === next.category ? prev : next,
      );
    };

    apply();
    const fonts = typeof document !== "undefined" ? document.fonts : undefined;
    if (fonts?.ready) void fonts.ready.then(apply).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [key]);

  return metrics;
}
