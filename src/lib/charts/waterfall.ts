// Model wykresu wodospadowego (mostka).
//
// PO CO JEST OSOBNYM TYPEM WYKRESU. Wodospad jest narzędziem DOMYŚLNYM dla
// każdego pytania "od czego do czego": mostek EBITDA rok do roku, dekompozycja
// zmiany marży, rozkład zmiany kapitału obrotowego. Te same dane pokazane
// słupkami obok siebie zmuszają czytelnika do dodawania w głowie, a dodawanie
// w głowie jest tym, czego wykres ma go oszczędzić.
//
// REGUŁY, KTÓRYCH TEN MODEL PILNUJE:
//   * słupek startowy i końcowy OPARTE NA ZERZE, pośrednie WISZĄCE - wiszący
//     słupek koduje długością sam wkład, a nie poziom, do którego dowiózł;
//   * dodatnie i ujemne różnym kolorem I KIERUNKIEM - kolor sam nie wystarcza,
//     bo około 8% mężczyzn nie odróżnia czerwieni od zieleni;
//   * SUMA KONTROLNA. Mostek, którego składniki nie sumują się do różnicy
//     stanów, jest BŁĘDEM, nie kwestią gustu - i jest to jedyny defekt
//     w całym silniku, który da się sprawdzić arytmetycznie, więc się go
//     sprawdza, zamiast liczyć na czujność autora.
//
// KONWENCJA DANYCH. Pierwsza kategoria to stan początkowy, ostatnia to stan
// końcowy, wszystko pomiędzy to składniki zmiany. Wodospad czyta WYŁĄCZNIE
// pierwszą serię - mostek z dwóch serii nie ma sensu, bo nie da się dodać
// dwóch dekompozycji tej samej różnicy.

export interface WaterfallStep {
  /** Indeks kategorii w konfiguracji. */
  index: number;
  label: string;
  /** Wkład tego kroku (dla filarów: sam poziom). */
  value: number;
  /** Dolna krawędź słupka w jednostkach danych. */
  from: number;
  /** Górna krawędź słupka w jednostkach danych. */
  to: number;
  /** Filar (stan początkowy/końcowy) stoi na zerze; składnik wisi. */
  kind: "start" | "step" | "end";
  /** Znak wkładu - decyduje o kolorze semantycznym I o kierunku wzrostu. */
  direction: "up" | "down" | "flat";
}

export interface WaterfallModel {
  steps: WaterfallStep[];
  /** Suma składników pośrednich. */
  componentSum: number;
  /** Różnica stanów: koniec minus początek. */
  stateDelta: number;
  /**
   * Czy suma składników domyka różnicę stanów. `null` = NIE MA CZEGO
   * SPRAWDZAĆ, więc model nie twierdzi, że jest dobrze - milczy. Dwa takie
   * przypadki: brak jawnego stanu końcowego (mostek domyka się z definicji)
   * oraz brak liczby na którymkolwiek FILARZE (nie ma stanu, od którego albo
   * do którego mostek miałby prowadzić).
   */
  checksumOk: boolean | null;
  /** Bezwzględna rozbieżność sumy kontrolnej. */
  checksumGap: number;
}

/**
 * Tolerancja sumy kontrolnej. Względna, nie bezwzględna: mostek w milionach
 * euro i mostek w punktach procentowych nie mogą dzielić jednego progu.
 * 0,5% skali różnicy albo 1e-9 dla różnicy zerowej - poniżej tego mówimy
 * o błędzie zaokrąglenia w arkuszu autora, nie o brakującym składniku.
 */
export const CHECKSUM_TOLERANCE_RATIO = 0.005;

/**
 * Model mostka. `explicitEnd` mówi, czy OSTATNIA kategoria jest stanem
 * końcowym (domyślnie tak): przy `false` ostatni słupek jest zwykłym
 * składnikiem, a stan końcowy silnik dokłada sam jako filar wyliczony.
 */
export function waterfallModel(
  labels: readonly string[],
  values: readonly (number | null)[],
  opts: { explicitEnd?: boolean } = {},
): WaterfallModel {
  const explicitEnd = opts.explicitEnd !== false;
  const steps: WaterfallStep[] = [];
  const count = labels.length;

  if (count === 0) {
    return { steps, componentSum: 0, stateDelta: 0, checksumOk: null, checksumGap: 0 };
  }

  // DWA ODCZYTY, NIE JEDEN. `raw` odróżnia "zero" od "nie ma", `at` dopiero
  // sprowadza brak do zera do rysowania. Rozróżnienie jest potrzebne SUMIE
  // KONTROLNEJ: brakujący SKŁADNIK słusznie wypada z sumy (i suma przestaje
  // domykać różnicę, czyli ostrzeżenie się odpala), ale brakujący FILAR to
  // brak stanu, a nie stan zerowy - i mostek nie ma wtedy czego sprawdzać.
  const raw = (i: number): number | null => {
    const v = values[i];
    return v === null || v === undefined || !Number.isFinite(v) ? null : v;
  };
  const at = (i: number): number => raw(i) ?? 0;

  const lastIndex = count - 1;
  const start = at(0);
  // Indeks ostatniego SKŁADNIKA - przy jawnym stanie końcowym ostatnia
  // kategoria filarem, więc składniki kończą się o jeden wcześniej.
  const lastComponent = explicitEnd && count >= 2 ? lastIndex - 1 : lastIndex;

  steps.push({
    index: 0,
    label: labels[0] ?? "",
    value: start,
    from: Math.min(0, start),
    to: Math.max(0, start),
    kind: "start",
    direction: start >= 0 ? "up" : "down",
  });

  let cursor = start;
  let componentSum = 0;
  for (let i = 1; i <= lastComponent; i++) {
    const value = at(i);
    componentSum += value;
    const from = cursor;
    cursor += value;
    steps.push({
      index: i,
      label: labels[i] ?? "",
      value,
      from: Math.min(from, cursor),
      to: Math.max(from, cursor),
      kind: "step",
      direction: value > 0 ? "up" : value < 0 ? "down" : "flat",
    });
  }

  if (explicitEnd && count >= 2) {
    const end = at(lastIndex);
    steps.push({
      index: lastIndex,
      label: labels[lastIndex] ?? "",
      value: end,
      from: Math.min(0, end),
      to: Math.max(0, end),
      kind: "end",
      direction: end >= start ? "up" : "down",
    });
    const stateDelta = end - start;
    const gap = Math.abs(componentSum - stateDelta);
    const scale = Math.max(Math.abs(stateDelta), Math.abs(componentSum), Math.abs(end));
    const tolerance = Math.max(scale * CHECKSUM_TOLERANCE_RATIO, 1e-9);
    // SUMA KONTROLNA WYMAGA OBU STANÓW. Bez tego warunku mostek zbudowany
    // z serii, która nie ma ani jednej liczby (kategorie z arkusza, wartości
    // jeszcze nieuzupełnione), wychodził jako `checksumOk: true`: zero minus
    // zero domyka zero. Model twierdziłby, że sprawdził dekompozycję, której
    // nie ma - a jego własna umowa mówi, że przy braku czego sprawdzać
    // MILCZY (`null`), zamiast zaświadczać.
    const checkable = raw(0) !== null && raw(lastIndex) !== null;
    return {
      steps,
      componentSum,
      stateDelta,
      checksumOk: checkable ? gap <= tolerance : null,
      checksumGap: checkable ? gap : 0,
    };
  }

  // Bez jawnego stanu końcowego mostek domyka się sam z definicji, więc suma
  // kontrolna nie ma czego wykryć - i dlatego nie udajemy, że sprawdziliśmy.
  return {
    steps,
    componentSum,
    stateDelta: cursor - start,
    checksumOk: null,
    checksumGap: 0,
  };
}

/** Zakres wartości mostka - domena osi. Zawsze obejmuje zero (filary). */
export function waterfallExtent(model: WaterfallModel): { min: number; max: number } {
  let min = 0;
  let max = 0;
  for (const step of model.steps) {
    min = Math.min(min, step.from);
    max = Math.max(max, step.to);
  }
  return { min, max };
}
