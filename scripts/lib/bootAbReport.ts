// POMIAR PORÓWNAWCZY PIERWSZEGO WCZYTANIA - warstwa CZYSTA.
//
// PO CO TO ISTNIEJE. To repozytorium ma bramkę BUDŻETU (`e2e/boot-timing.spec.ts`:
// „czy TTFB, gotowość i transfer bootu mieszczą się w progach") i nie ma niczego,
// co odpowiadałoby na inne pytanie: „czy TA ZMIANA przyspieszyła wczytywanie".
// To są dwa różne pytania i pierwsze nie odpowiada na drugie: bramka progowa
// przechodzi zarówno wtedy, gdy zmiana zyskała 30%, jak i wtedy, gdy straciła
// 30%, dopóki obie liczby są pod progiem. Skutek był widoczny w praktyce -
// przy zamykaniu rozdziału 8.6 audytu żadnego zdania o przyspieszeniu nie dało
// się poprzeć liczbą, bo nie istniał pomiar BAZY do porównania.
//
// CO ROZSTRZYGA TA WARSTWA. Wyłącznie interpretację: sparsować wynik sondy,
// policzyć różnicę i orzec, czy różnica MIEŚCI SIĘ W SZUMIE POMIARU. Ostatnia
// część jest tu najważniejsza i jest jedynym powodem, dla którego ten plik jest
// osobny i przetestowany: bez pasma szumu każdy przebieg „coś" pokazuje, a
// raport zamienia się w generator fałszywych wniosków w obie strony.
//
// SKĄD PASMA SZUMU - ZMIERZONE, NIE PRZYJĘTE. Sześć przebiegów tej samej
// sondy na tym samym artefakcie (host deweloperski, `bun run build:smoke`,
// trasa `/cookies`), zapisane w nagłówku `e2e/boot-timing.spec.ts`:
//
//   METRYKA          ROZRZUT SZEŚCIU PRZEBIEGÓW      ROZRZUT WZGLĘDNY
//   TTFB             5075,6 - 5194,9 ms              2,3%
//   gotowość          461   -  616   ms             33,6%   <- najgorsza
//   transfer JS      2270,1 - 2294,2 KB              1,1%
//
// Stąd trzy różne pasma, a nie jedno wspólne: BAJTY są powtarzalne (artefakt
// jest deterministyczny, zmienia się tylko narzut nagłówków), CZAS RENDERU
// zależy od maszyny, a GOTOWOŚĆ zależy od niej najmocniej, bo jest czystym CPU.
// Wspólne pasmo musiałoby przyjąć najgorszy przypadek, czyli 34% - i wtedy
// przegapiłoby realną, trzydziestoprocentową regresję bajtów.
//
// CZEGO TEN MODUŁ NIE ROBI: nie orzeka, czy zmiana jest DOBRA. Różnica poza
// pasmem szumu jest RÓŻNICĄ, a nie werdyktem - decyzja, czy +11 KB za wcześniej
// martwy hint słownika to dobry interes, należy do człowieka czytającego raport.

/** Jedna próbka z sondy `e2e-ab/bootCompare.spec.ts`. */
export interface BootSample {
  /** `responseStart - requestStart` z Navigation Timing, w ms. */
  readonly ttfbMs: number;
  /** First Contentful Paint w ms; `null`, gdy przeglądarka wpisu nie oddała. */
  readonly fcpMs: number | null;
  /**
   * Czas od `responseStart` do `window.__nesAppReady === true`, w ms.
   *
   * `null` znaczy COŚ KONKRETNEGO i nie wolno tego czytać jako „nie zmierzono":
   * flaga nie pojawiła się w budżecie odpytywania. Na bazie `1d5d0ed` tak
   * właśnie było na KAŻDEJ publikowanej stronie, bo jedyny pisarz flagi stał
   * wewnątrz gałęzi `if (inPreviewIframe)`.
   */
  readonly readyMs: number | null;
  /** Rozmiar SUROWEGO dokumentu SSR w bajtach (osobne żądanie, nie DOM). */
  readonly htmlBytes: number;
  /** Długość `document.body.innerText` - ile TREŚCI widzi czytelnik. */
  readonly htmlTextChars: number;
  readonly jsTransferKb: number;
  readonly jsCount: number;
  /** Domknięcie bootu: pobrane przez skaner preloadu dokumentu. */
  readonly staticKb: number;
  readonly staticCount: number;
  /** Dociągnięte przez `import()` w trakcie bootu. */
  readonly dynamicKb: number;
  readonly dynamicCount: number;
  readonly cssKb: number;
  readonly modulepreloadCount: number;
  /** Nagłówek `Link` dokumentu - niesie hinty `modulepreload` i `preconnect`. */
  readonly linkHeader: string | null;
}

/** Klasa metryki - decyduje o pasmie szumu i o kierunku „lepiej". */
type MetricKind = "time" | "bytes" | "count";

interface MetricSpec {
  readonly key: keyof BootSample;
  readonly label: string;
  readonly unit: string;
  readonly kind: MetricKind;
}

/**
 * PASMA SZUMU, po jednym na klasę metryki. Wartości wyprowadzone z rozrzutu
 * zmierzonego na sześciu przebiegach (tabela w nagłówku), zaokrąglone W GÓRĘ
 * do liczby całkowitej - świadomie konserwatywnie, bo koszt fałszywego alarmu
 * („zmiana zwolniła") jest tu wyższy niż koszt przemilczenia różnicy o włos
 * większej od szumu.
 */
export const NOISE_BAND_PCT: Readonly<Record<MetricKind, number>> = {
  // 2,3% zmierzone -> 5%: czas renderu serwera zależy od obciążenia maszyny,
  // a pomiaru z więcej niż jednego hosta nie ma.
  time: 5,
  // 1,1% zmierzone -> 2%: artefakt jest deterministyczny, rozrzut bierze się
  // z narzutu nagłówków HTTP na zasób.
  bytes: 2,
  // Liczba plików jest CAŁKOWITA i deterministyczna dla danego artefaktu, ale
  // nie dla danego PRZEBIEGU: ile leniwych chunków zdąży dojść przed flagą
  // gotowości, zależy od szybkości maszyny (zmierzone: 21 plików na hoście
  // wobec 54 na runnerze przy tym samym artefakcie). Dlatego pasmo jest
  // SZEROKIE - ta metryka jest diagnostyczna, nie bramkowa.
  count: 25,
};

/** Kolejność wierszy raportu - od pytania „ile czekam" do „ile pobieram". */
export const METRICS: readonly MetricSpec[] = [
  { key: "ttfbMs", label: "TTFB dokumentu", unit: "ms", kind: "time" },
  { key: "fcpMs", label: "First Contentful Paint", unit: "ms", kind: "time" },
  { key: "readyMs", label: "gotowość (__nesAppReady)", unit: "ms", kind: "time" },
  { key: "htmlBytes", label: "dokument SSR", unit: "B", kind: "bytes" },
  { key: "htmlTextChars", label: "treść tekstowa w SSR", unit: "zn.", kind: "count" },
  { key: "jsTransferKb", label: "JS bootu RAZEM", unit: "KB", kind: "bytes" },
  { key: "jsCount", label: "  w tym plików", unit: "szt.", kind: "count" },
  { key: "staticKb", label: "  domknięcie statyczne", unit: "KB", kind: "bytes" },
  // ETYKIETY MUSZĄ BYĆ UNIKALNE i to nie jest kosmetyka. Pierwsza wersja miała
  // tu dwa razy „    plików" (raz pod domknięciem statycznym, raz pod
  // dynamicznym) i dwie rzeczy przez to nie działały: czytelnik raportu nie
  // odróżniał wierszy, a wyszukiwanie wiersza po etykiecie - w tym w bramce
  // tego modułu - milcząco brało PIERWSZE trafienie. Test na przypadek zera
  // w liczniku dynamicznym mierzył więc licznik statyczny i przechodził
  // z powodu, który nie miał nic wspólnego z jego tezą.
  { key: "staticCount", label: "    plików statycznych", unit: "szt.", kind: "count" },
  { key: "dynamicKb", label: "  dociągnięte dynamicznie", unit: "KB", kind: "bytes" },
  { key: "dynamicCount", label: "    plików dynamicznych", unit: "szt.", kind: "count" },
  { key: "cssKb", label: "CSS", unit: "KB", kind: "bytes" },
  { key: "modulepreloadCount", label: "hintów modulepreload", unit: "szt.", kind: "count" },
];

/** Werdykt dla jednego wiersza. */
export type DeltaVerdict =
  /** Różnica mieści się w zmierzonym paśmie szumu - nie ma o czym mówić. */
  | "szum"
  /** Różnica przekracza pasmo szumu, wartość wzrosła. */
  | "wzrost"
  /** Różnica przekracza pasmo szumu, wartość spadła. */
  | "spadek"
  /** Wartość pojawiła się tam, gdzie jej nie było (`null` -> liczba). */
  | "pojawiło się"
  /** Wartość zniknęła (liczba -> `null`) - to zawsze jest istotne. */
  | "zniknęło"
  /** Brak po obu stronach - nie ma czego porównywać. */
  | "brak danych";

export interface DeltaRow {
  readonly label: string;
  readonly unit: string;
  readonly before: number | null;
  readonly after: number | null;
  readonly absolute: number | null;
  readonly relativePct: number | null;
  readonly verdict: DeltaVerdict;
}

/**
 * Parsuje linię, którą sonda wypisuje na standardowe wyjście.
 *
 * Format: `[A/B <etykieta>] {<json>}`. Szukamy OSTATNIEGO wystąpienia, bo
 * Playwright potrafi powtórzyć linię testu w podsumowaniu, a wtedy pierwsze
 * trafienie bywa obcięte reporterem.
 */
export function parseProbeOutput(stdout: string, label: string): BootSample | null {
  const marker = `[A/B ${label}] `;
  let sample: BootSample | null = null;
  for (const line of stdout.split("\n")) {
    const at = line.indexOf(marker);
    if (at === -1) continue;
    const payload = line.slice(at + marker.length).trim();
    if (!payload.startsWith("{")) continue;
    try {
      sample = JSON.parse(payload) as BootSample;
    } catch {
      // Linia z markerem, ale nie-JSON: reporter ją przyciął. Idziemy dalej -
      // dalsze linie mogą nieść całą próbkę.
      continue;
    }
  }
  return sample;
}

function readMetric(sample: BootSample, key: keyof BootSample): number | null {
  const value = sample[key];
  if (typeof value === "number") return value;
  // `linkHeader` jest tekstem i nie ma go w `METRICS`; gdyby ktoś go tam dopisał,
  // wolimy `null` niż `NaN` przemycony dalej do arytmetyki.
  return null;
}

/** Porównuje dwie próbki wiersz po wierszu. */
export function diffSamples(before: BootSample, after: BootSample): readonly DeltaRow[] {
  return METRICS.map((metric) => {
    const b = readMetric(before, metric.key);
    const a = readMetric(after, metric.key);

    if (b === null && a === null) {
      return { ...base(metric, b, a), absolute: null, relativePct: null, verdict: "brak danych" };
    }
    if (b === null) {
      return { ...base(metric, b, a), absolute: null, relativePct: null, verdict: "pojawiło się" };
    }
    if (a === null) {
      return { ...base(metric, b, a), absolute: null, relativePct: null, verdict: "zniknęło" };
    }

    const absolute = a - b;
    // Dzielenie przez zero jest tu realne (np. `dynamicCount` = 0 na artefakcie
    // bez leniwych chunków), więc nie liczymy procentu z pustej bazy.
    const relativePct = b === 0 ? null : (absolute / b) * 100;
    const band = NOISE_BAND_PCT[metric.kind];
    const withinNoise = relativePct === null ? absolute === 0 : Math.abs(relativePct) <= band;

    return {
      ...base(metric, b, a),
      absolute,
      relativePct,
      verdict: withinNoise ? "szum" : absolute > 0 ? "wzrost" : "spadek",
    };
  });
}

function base(
  metric: MetricSpec,
  before: number | null,
  after: number | null,
): Pick<DeltaRow, "label" | "unit" | "before" | "after"> {
  return { label: metric.label, unit: metric.unit, before, after };
}

function fmt(value: number | null, unit: string): string {
  if (value === null) return "-";
  const rounded = Number.isInteger(value) ? String(value) : value.toFixed(1);
  return `${rounded} ${unit}`;
}

function fmtDelta(row: DeltaRow): string {
  if (row.absolute === null) return "-";
  const sign = row.absolute > 0 ? "+" : "";
  const abs = Number.isInteger(row.absolute) ? String(row.absolute) : row.absolute.toFixed(1);
  if (row.relativePct === null) return `${sign}${abs}`;
  return `${sign}${abs} (${sign}${row.relativePct.toFixed(1)}%)`;
}

/** Składa raport tekstowy. Szerokości kolumn liczone z treści, nie zgadywane. */
export function formatReport(
  rows: readonly DeltaRow[],
  labels: { readonly before: string; readonly after: string },
): string {
  const header = ["metryka", labels.before, labels.after, "różnica", "werdykt"] as const;
  const body = rows.map((row) => [
    row.label,
    fmt(row.before, row.unit),
    fmt(row.after, row.unit),
    fmtDelta(row),
    row.verdict,
  ]);
  const table = [header.slice(), ...body];
  const widths = header.map((_, col) => Math.max(...table.map((r) => r[col].length)));
  const line = (cells: readonly string[]): string =>
    cells
      .map((cell, col) => cell.padEnd(widths[col]))
      .join("  ")
      .trimEnd();

  const out = [line(header), widths.map((w) => "-".repeat(w)).join("  ")];
  for (const r of body) out.push(line(r));

  const notable = rows.filter((r) => r.verdict !== "szum" && r.verdict !== "brak danych");
  out.push("");
  out.push(
    notable.length === 0
      ? "Żadna metryka nie wyszła poza zmierzone pasmo szumu - ta zmiana nie zmienia pierwszego wczytania w sposób, który ten pomiar potrafi wykazać."
      : `Poza pasmem szumu: ${notable.map((r) => `${r.label} (${r.verdict})`).join(", ")}.`,
  );
  return out.join("\n");
}

/**
 * Wyciąga z nagłówka `Link` same cele `modulepreload`.
 *
 * Osobno od metryk liczbowych, bo to jest RÓŻNICA JAKOŚCIOWA: hint albo jest,
 * albo go nie ma, i żadna liczba tego nie zastąpi. Na bazie `1d5d0ed` lista
 * jest pusta, po zmianie niesie chunk rdzenia słownika.
 */
export function modulepreloadTargets(linkHeader: string | null): readonly string[] {
  if (!linkHeader) return [];
  const targets: string[] = [];
  // Nagłówek jest listą rozdzieloną przecinkami, ale przecinek może stać też
  // w parametrach, więc rozcinamy po `<...>` zamiast po separatorze.
  const entry = /<([^>]+)>\s*;([^<]*)/g;
  for (let m = entry.exec(linkHeader); m !== null; m = entry.exec(linkHeader)) {
    if (/rel\s*=\s*"?modulepreload"?/.test(m[2])) targets.push(m[1]);
  }
  return targets;
}
