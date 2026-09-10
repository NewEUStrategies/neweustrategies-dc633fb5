// Zasoby i18n silnika wykresów (src/components/charts) - rama karty, legenda,
// tabela danych, podpis uczciwościowy, prognoza, wodospad i tooltip
// objaśniający wskaźnik.
//
// DLACZEGO NAKŁADKA, A NIE LOKALNA MAPA `{ pl, en }`. Silnik wykresów trzymał
// napisy w plikowych stałych `const L = { pl: {...}, en: {...} }`. Skaner
// dwujęzycznego tekstu tego wzorca nie łapie (celuje w ternary i pomocniki
// bliźniacze), więc dług był niewidoczny - ale to nadal był dług: tekst
// istniał wyłącznie w kodzie, bramka parytetu PL/EN nie miała czego
// porównywać, a trzeci język wymagałby dotknięcia sześciu plików silnika
// zamiast jednego słownika.
//
// JĘZYK JEDZIE PROPSEM, NIE Z SINGLETONA. Wszystkie klucze czyta się przez
// `t(klucz, { lng: lang })`, gdzie `lang` przychodzi propsem ze ścieżki URL.
// Strony publiczne są cache'owane na brzegu sieci, więc odczyt z globalnego
// `i18n.language` mógłby zserwować polski tekst pod angielskim adresem.
import i18n from "@/lib/i18n";

const pl = {
  charts: {
    frame: {
      showData: "Pokaż dane",
      hideData: "Ukryj dane",
      dataTable: "Dane wykresu",
      category: "Kategoria",
      value: "Wartość",
      share: "Udział",
      total: "Suma",
      empty: "Brak danych wykresu.",
      other: "Pozostałe",
      missing: "brak danych",
    },
    caption: {
      // Podpis uczciwościowy. Jednostka, n, źródło i data danych są osobnymi
      // polami, bo wykres bez nich wygląda tak samo, a znaczy co innego.
      unit: "Jednostka: {{unit}}",
      sampleSize: "n = {{count}}",
      sourceDate: "Dane na dzień: {{date}}",
      zeroBaselineWarning: "Oś wartości nie zaczyna się od zera",
      zeroBaselineWarningHint:
        "Skala jest ucięta, więc różnice wyglądają na większe niż są. Pełne liczby są w tabeli danych.",
    },
    notes: {
      // Trzy zdania, których kolejność się nie zmienia, żeby czytelnik uczył
      // się, gdzie czego szukać.
      shows: "Co pokazuje",
      surprising: "Co jest zaskakujące",
      hidden: "Czego nie pokazuje",
    },
    forecast: {
      label: "Prognoza",
      historyLabel: "Historia",
      band: "Pasmo niepewności ±{{pct}}%",
      // Alternatywa tekstowa dla strefy prognozy - to ona przenosi znaczenie
      // dla czytelnika, który nie widzi kreskowania linii.
      fromCategory: "Prognoza od: {{category}}",
      tableFlag: "prognoza",
    },
    waterfall: {
      start: "Stan początkowy",
      end: "Stan końcowy",
      total: "Suma zmian",
      increase: "Wzrost",
      decrease: "Spadek",
      // Mostek, którego składniki nie sumują się do różnicy, jest BŁĘDEM -
      // dlatego suma kontrolna jest liczona programowo i wypisywana wprost.
      checksumOk: "Suma kontrolna zgodna",
      checksumFailed:
        "Suma składników ({{sum}}) nie zgadza się z różnicą stanów ({{delta}}) - mostek jest niekompletny.",
    },
    series: {
      // Kreskowanie serii poza zestawem bezpiecznym dla daltonizmu.
      patternHint: "seria oznaczona kreskowaniem",
    },
    metric: {
      open: "Wyjaśnij wskaźnik {{name}}",
      close: "Zamknij wyjaśnienie",
      formula: "Wzór",
      measures: "Mierzy",
      reading: "Czytanie",
      levers: "Dźwignie",
      caution: "Uwaga",
    },
    a11y: {
      chart: "Wykres: {{title}}",
      chartUntitled: "Wykres",
      slice: "{{label}}: {{value}} ({{share}})",
      keyboardHint: "Strzałkami przesuwasz aktywną kategorię, Escape czyści zaznaczenie.",
    },
    editor: {
      // Ostrzeżenia dyscypliny - nie blokują zapisu, mówią, co się psuje.
      tooManySeries:
        "Powyżej {{max}} kolorów kategorialnych paleta przestaje być rozdzielna dla daltonizmu. Pogrupuj serie albo podziel wykres na small multiples.",
      tooManySlices:
        "Tarcza powyżej {{max}} kategorii koduje kątem i powierzchnią, czyli najsłabszymi kanałami. Nadmiar zwija się w jeden wycinek zbiorczy - rozważ słupki poziome.",
      signClashesWithTerracotta:
        "Wykres koduje znak czerwienią, więc terakota (slot 6) nie może być na nim kategorią.",
      forecastWithoutBand:
        "Prognoza bez pasma niepewności sugeruje pewność, której nie ma. Podaj szerokość pasma.",
      smoothingWithoutPoints:
        "Wygładzona linia bez widocznych punktów obserwacji nie mówi, gdzie kończą się dane, a gdzie zaczyna interpolacja.",
      missingNotes:
        "Podpis bez zdania „czego nie pokazuje” zmienia wykres analityczny w ilustrację.",
    },
  },
};

const en = {
  charts: {
    frame: {
      showData: "Show data",
      hideData: "Hide data",
      dataTable: "Chart data",
      category: "Category",
      value: "Value",
      share: "Share",
      total: "Total",
      empty: "No chart data.",
      other: "Other",
      missing: "no data",
    },
    caption: {
      unit: "Unit: {{unit}}",
      sampleSize: "n = {{count}}",
      sourceDate: "Data as of: {{date}}",
      zeroBaselineWarning: "The value axis does not start at zero",
      zeroBaselineWarningHint:
        "The scale is truncated, so differences look larger than they are. Full figures are in the data table.",
    },
    notes: {
      shows: "What it shows",
      surprising: "What is surprising",
      hidden: "What it does not show",
    },
    forecast: {
      label: "Forecast",
      historyLabel: "History",
      band: "Uncertainty band ±{{pct}}%",
      fromCategory: "Forecast from: {{category}}",
      tableFlag: "forecast",
    },
    waterfall: {
      start: "Opening value",
      end: "Closing value",
      total: "Net change",
      increase: "Increase",
      decrease: "Decrease",
      checksumOk: "Checksum matches",
      checksumFailed:
        "The components ({{sum}}) do not add up to the change between states ({{delta}}) - the bridge is incomplete.",
    },
    series: {
      patternHint: "series marked with a dashed stroke",
    },
    metric: {
      open: "Explain the {{name}} metric",
      close: "Close the explanation",
      formula: "Formula",
      measures: "Measures",
      reading: "Reading",
      levers: "Levers",
      caution: "Caution",
    },
    a11y: {
      chart: "Chart: {{title}}",
      chartUntitled: "Chart",
      slice: "{{label}}: {{value}} ({{share}})",
      keyboardHint: "Arrow keys move the active category, Escape clears the selection.",
    },
    editor: {
      tooManySeries:
        "Above {{max}} categorical colours the palette stops being separable for colour-blind readers. Group the series or split the chart into small multiples.",
      tooManySlices:
        "A pie above {{max}} categories encodes with angle and area, the weakest channels. The overflow folds into one aggregate slice - consider sorted horizontal bars.",
      signClashesWithTerracotta:
        "This chart encodes sign with red, so terracotta (slot 6) cannot also be a category on it.",
      forecastWithoutBand:
        "A forecast without an uncertainty band implies a certainty that is not there. Set the band width.",
      smoothingWithoutPoints:
        "A smoothed line without visible observation points does not say where the data ends and interpolation begins.",
      missingNotes:
        "A caption without the “what it does not show” sentence turns an analytical chart into an illustration.",
    },
  },
};

i18n.addResourceBundle("pl", "translation", pl, true, true);
i18n.addResourceBundle("en", "translation", en, true, true);

/** A live binding lets the route splitter keep registration with its view. */
export function ensureI18n(): void {}
