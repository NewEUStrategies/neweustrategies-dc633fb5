// Atrapy GRANICY panelu „Warte przeczytania" (`TrendingTickerPane`).
//
// Panel styka się z trzema sąsiadami, którzy mają WŁASNYCH właścicieli i własne
// testy, a w środku robią rzeczy wyprowadzające test poza granicę panelu:
//   - `TrendingTicker` (podgląd) - sam odpytuje bazę o wpisy i animuje pasek
//     (ma własny plik `src/components/header/__tests__/TrendingTicker.test.tsx`);
//   - `AdminColorPicker` - Radix Popover + kanwa `react-colorful`, której
//     happy-dom nie otworzy bez zdarzeń wskaźnika i pomiarów układu;
//   - `AdminDateTimePicker` - Radix Popover + kalendarz, ta sama przeszkoda.
//
// Atrapy zachowują WYŁĄCZNIE to, na czym stoją asercje panelu: przekazane propy,
// `aria-label`, wartość i pełny kontrakt `onChange` - łącznie z `null`, bo panel
// mapuje go na pusty napis (`onChange(v ?? "")` w `ColorField`) i bez tej ścieżki
// gałąź nigdy by nie została wykonana.
//
// DLACZEGO NIE `colorPickerStub` Z `src/test/admin/settingsPaneHarness.tsx`.
// Tamten atom istnieje i obsługuje panele ustawień, ale ma inny kontrakt: wymaga
// rejestratora propów, jego przycisk resetu nie ma dostępnej nazwy (asercje idą
// przez selektor `button[data-color-reset]`), oddaje `undefined` zamiast `null` i
// - co tu rozstrzygające - NIE przekazuje dalej `id`, na którym stoi wpis
// rejestru defektów o martwej etykiecie `ColorField`. Przerabianie wspólnego
// harnessu ośmiu cudzych paneli pod ten jeden przypadek kosztowałoby więcej
// ryzyka niż lokalna, dziesięciolinijkowa atrapa. Radix Select i Switch NIE są tu
// powielane - pliki testowe biorą je z atomów `src/test/reactStubs.ts`.
//
// Bez JSX (jak `src/test/reactStubs.ts`) - te fabryki są wołane z wnętrza
// hoistowanych fabryk `vi.mock`, więc plik nie może importować NICZEGO z
// produkcji poza typami (import typu jest wymazywany, więc nie domyka cyklu
// inicjalizacji opisanego w nagłówku `src/test/i18nStub.ts`).
import type { TickerProps } from "@/components/header/TrendingTicker";

/** Zapis tego, co panel przekazał podglądowi paska. */
export interface TickerPreviewSink {
  /** Propy z KAŻDEGO renderu podglądu, w kolejności. */
  renders: TickerProps[];
  /**
   * Ile razy podgląd został ZAMONTOWANY. Panel podaje podglądowi `key`
   * (`previewKey`), więc każda zmiana konfiguracji ma go przemontować - licznik
   * jest jedynym świadkiem tego, że memo `previewKey` naprawdę się przelicza.
   */
  mounts: number;
}

export function tickerPreviewSink(): TickerPreviewSink {
  return { renders: [], mounts: 0 };
}

/**
 * Atrapa podglądu paska. Zapisuje propy w renderze (React 18 bez StrictMode
 * renderuje raz, a panel i tak jest tu montowany bez StrictMode) i podbija
 * licznik montowań w efekcie.
 */
export function trendingTickerStub(
  react: typeof import("react"),
  sink: TickerPreviewSink,
): Record<string, unknown> {
  return {
    TrendingTicker: (props: TickerProps) => {
      sink.renders.push(props);
      react.useEffect(() => {
        sink.mounts += 1;
      }, []);
      return react.createElement(
        "div",
        { "data-testid": "ticker-preview", "data-variant": props.variantId },
        props.labelPl ?? "",
      );
    },
  };
}

/**
 * Atrapa próbnika kolorów. Produkcja rysuje przycisk-swatch z `aria-label` i
 * dopiero w popoverze pole hex; atrapa spłaszcza to do pola tekstowego z tym
 * samym `aria-label` (bo panel identyfikuje pola kolorów właśnie etykietą) oraz
 * przycisku czyszczącego, który oddaje `null` - jedyne wejście w gałąź `?? ""`.
 */
export function adminColorPickerStub(react: typeof import("react")): Record<string, unknown> {
  interface StubProps {
    ariaLabel?: string;
    value?: string | null;
    onChange: (v: string | null) => void;
    /**
     * Produkcja tego propa DZIŚ nie przyjmuje (i dlatego `<Label htmlFor>` w
     * `ColorField` wskazuje na nieistniejący węzeł - jest na to `it.fails`).
     * Atrapa przekazuje go dalej, żeby ten test zazieleniał się po naprawie
     * PRODUKCJI, a nie po podmianie atrapy.
     */
    id?: string;
  }
  return {
    AdminColorPicker: ({ ariaLabel, value, onChange, id }: StubProps) =>
      react.createElement(
        react.Fragment,
        null,
        react.createElement("input", {
          type: "text",
          id,
          "aria-label": ariaLabel,
          value: value ?? "",
          onChange: (event: { target: { value: string } }) => onChange(event.target.value),
        }),
        react.createElement(
          "button",
          {
            type: "button",
            "aria-label": `${ariaLabel ?? ""} - wyczyść`,
            onClick: () => onChange(null),
          },
          "x",
        ),
      ),
  };
}

/** Co panel przekazał wyborowi daty przypięcia. */
export interface DatePickerSink {
  lang: string | undefined;
  value: string | null | undefined;
}

export function datePickerSink(): DatePickerSink {
  return { lang: undefined, value: undefined };
}

/**
 * Atrapa wyboru daty i godziny. Panel używa z tego modułu WYŁĄCZNIE
 * `AdminDateTimePicker` (przy źródle „Przypięty wpis"), więc atrapa oddaje tylko
 * jego - gdyby panel sięgnął kiedyś po `AdminDatePicker`, test wywali się od
 * razu zamiast cicho wyrenderować pustkę.
 */
export function adminDateTimePickerStub(
  react: typeof import("react"),
  sink: DatePickerSink,
): Record<string, unknown> {
  interface StubProps {
    value: string | null | undefined;
    onChange: (v: string | null) => void;
    lang?: string;
  }
  return {
    AdminDateTimePicker: ({ value, onChange, lang }: StubProps) => {
      sink.lang = lang;
      sink.value = value;
      return react.createElement(
        react.Fragment,
        null,
        react.createElement("input", {
          type: "text",
          "data-testid": "tt-pinned-until",
          "data-lang": lang,
          value: value ?? "",
          onChange: (event: { target: { value: string } }) => onChange(event.target.value),
        }),
        react.createElement(
          "button",
          {
            type: "button",
            "data-testid": "tt-pinned-until-clear",
            onClick: () => onChange(null),
          },
          "x",
        ),
      );
    },
  };
}
