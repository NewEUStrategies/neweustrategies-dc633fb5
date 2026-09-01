// Bramka warstwy interpretacyjnej pomiaru porównawczego.
//
// CO TU JEST WARTE TESTOWANIA I DLACZEGO WŁAŚNIE TO. Pomiar sam w sobie jest
// niedeterministyczny (czas, maszyna, obciążenie), więc testować go nie ma jak.
// Deterministyczna - i jednocześnie jedyna niosąca WNIOSEK - jest warstwa
// interpretacji: czy różnica mieści się w paśmie szumu. Pomyłka tutaj nie
// wywraca żadnego przebiegu, tylko po cichu zamienia raport w generator
// fałszywych wniosków w OBIE strony: przemilczy realną regresję albo ogłosi
// zysk tam, gdzie zmieniło się obciążenie maszyny.
import { describe, expect, it } from "vitest";

import {
  diffSamples,
  formatReport,
  modulepreloadTargets,
  NOISE_BAND_PCT,
  METRICS,
  parseProbeOutput,
  type BootSample,
} from "../../../../scripts/lib/bootAbReport";

/** Próbka odniesienia - liczby z PRAWDZIWEGO przebiegu na bazie `1d5d0ed`. */
const BASE_SAMPLE: BootSample = {
  ttfbMs: 5066.4,
  fcpMs: 5280,
  readyMs: null,
  htmlBytes: 76485,
  htmlTextChars: 2622,
  jsTransferKb: 2580.6,
  jsCount: 70,
  staticKb: 1955.8,
  staticCount: 12,
  dynamicKb: 624.8,
  dynamicCount: 58,
  cssKb: 557.3,
  modulepreloadCount: 67,
  linkHeader: '</assets/styles-BQZz5a-B.css>; rel="preload"; as="style"',
};

function withOverrides(patch: Partial<BootSample>): BootSample {
  return { ...BASE_SAMPLE, ...patch };
}

function verdictOf(before: BootSample, after: BootSample, label: string): string {
  const row = diffSamples(before, after).find((r) => r.label === label);
  if (!row) throw new Error(`nie ma wiersza \`${label}\` - zmieniła się lista METRICS`);
  return row.verdict;
}

describe("parseProbeOutput", () => {
  it("wyciąga próbkę z linii sondy", () => {
    const out = `jakiś szum\n[A/B BAZA] {"ttfbMs":1,"jsCount":2}\ninny szum`;
    expect(parseProbeOutput(out, "BAZA")).toEqual({ ttfbMs: 1, jsCount: 2 });
  });

  it("bierze OSTATNIE wystąpienie - reporter powtarza linię w podsumowaniu", () => {
    const out = `[A/B PO] {"ttfbMs":1}\n[A/B PO] {"ttfbMs":2}`;
    expect(parseProbeOutput(out, "PO")?.ttfbMs).toBe(2);
  });

  it("pomija linię z markerem, która nie jest JSON-em (obcięta reporterem)", () => {
    const out = `[A/B PO] {"ttfbMs":1,"jsC\n[A/B PO] {"ttfbMs":9}`;
    expect(parseProbeOutput(out, "PO")?.ttfbMs).toBe(9);
  });

  it("nie myli etykiet - próbka drugiej połowy nie wycieka do pierwszej", () => {
    const out = `[A/B BAZA] {"ttfbMs":1}\n[A/B PO] {"ttfbMs":2}`;
    expect(parseProbeOutput(out, "BAZA")?.ttfbMs).toBe(1);
    expect(parseProbeOutput(out, "PO")?.ttfbMs).toBe(2);
  });

  it("oddaje null, gdy sonda nic nie wypisała", () => {
    expect(parseProbeOutput("Error: nie wstał serwer", "PO")).toBeNull();
  });
});

describe("diffSamples - pasmo szumu", () => {
  it("różnica poniżej pasma jest SZUMEM, nie zyskiem", () => {
    // +2,1 ms na 5066,4 to 0,04% - dokładnie ten przypadek, który wystąpił
    // w pierwszym prawdziwym porównaniu i który bez pasma zostałby opisany
    // jako „TTFB wzrósł".
    expect(verdictOf(BASE_SAMPLE, withOverrides({ ttfbMs: 5068.5 }), "TTFB dokumentu")).toBe(
      "szum",
    );
  });

  it("różnica ponad pasmem czasu jest RÓŻNICĄ", () => {
    const over = BASE_SAMPLE.ttfbMs * (1 + (NOISE_BAND_PCT.time + 1) / 100);
    expect(verdictOf(BASE_SAMPLE, withOverrides({ ttfbMs: over }), "TTFB dokumentu")).toBe(
      "wzrost",
    );
  });

  it("KONTROLA NEGATYWNA: pasmo bajtów jest CIAŚNIEJSZE niż pasmo czasu", () => {
    // Ta sama względna zmiana (3%) musi być szumem dla czasu i różnicą dla
    // bajtów - inaczej trzy pasma byłyby ozdobą, a nie mechanizmem. Gdyby ktoś
    // zlał je w jedno, ten przypadek pada.
    const pct = 3;
    expect(NOISE_BAND_PCT.time).toBeGreaterThan(pct);
    expect(NOISE_BAND_PCT.bytes).toBeLessThan(pct);
    const t = BASE_SAMPLE.ttfbMs * (1 + pct / 100);
    const b = BASE_SAMPLE.jsTransferKb * (1 + pct / 100);
    expect(verdictOf(BASE_SAMPLE, withOverrides({ ttfbMs: t }), "TTFB dokumentu")).toBe("szum");
    expect(verdictOf(BASE_SAMPLE, withOverrides({ jsTransferKb: b }), "JS bootu RAZEM")).toBe(
      "wzrost",
    );
  });

  it('spadek poza pasmem jest nazwany spadkiem, nie „wzrostem o minus"', () => {
    const under = BASE_SAMPLE.jsTransferKb * 0.8;
    expect(verdictOf(BASE_SAMPLE, withOverrides({ jsTransferKb: under }), "JS bootu RAZEM")).toBe(
      "spadek",
    );
  });

  it("zero po obu stronach nie dzieli przez zero i nie jest różnicą", () => {
    const a = withOverrides({ dynamicCount: 0 });
    expect(verdictOf(a, a, "    plików dynamicznych")).toBe("szum");
    const row = diffSamples(a, a).find((r) => r.label === "    plików dynamicznych");
    expect(row?.relativePct).toBeNull();
  });

  it("wzrost z zera jest RÓŻNICĄ, choć procentu nie ma", () => {
    const before = withOverrides({ dynamicKb: 0 });
    const row = diffSamples(before, withOverrides({ dynamicKb: 12.5 })).find(
      (r) => r.label === "  dociągnięte dynamicznie",
    );
    expect(row?.relativePct).toBeNull();
    expect(row?.verdict).toBe("wzrost");
  });
});

describe("diffSamples - metryka, która POJAWIA SIĘ", () => {
  it('null -> liczba to „pojawiło się", a nie spadek ani szum', () => {
    // To jest DOKŁADNIE zmierzony przypadek flagi gotowości: baza nie stawiała
    // jej na publikowanej stronie ani razu, po zmianie przychodzi po ~568 ms.
    // Traktowanie tego jako braku danych schowałoby najważniejszą różnicę
    // całego porównania.
    expect(
      verdictOf(BASE_SAMPLE, withOverrides({ readyMs: 568.4 }), "gotowość (__nesAppReady)"),
    ).toBe("pojawiło się");
  });

  it('liczba -> null to „zniknęło" - regresja, której nie wolno przemilczeć', () => {
    const before = withOverrides({ readyMs: 500 });
    expect(verdictOf(before, withOverrides({ readyMs: null }), "gotowość (__nesAppReady)")).toBe(
      "zniknęło",
    );
  });

  it("null po obu stronach to brak danych, nie zmiana", () => {
    expect(verdictOf(BASE_SAMPLE, BASE_SAMPLE, "gotowość (__nesAppReady)")).toBe("brak danych");
  });
});

describe("formatReport", () => {
  it("mówi wprost, gdy nic nie wyszło poza szum", () => {
    const report = formatReport(diffSamples(BASE_SAMPLE, BASE_SAMPLE), {
      before: "BAZA",
      after: "PO",
    });
    expect(report).toContain("Żadna metryka nie wyszła poza zmierzone pasmo szumu");
  });

  it("wymienia metryki poza szumem zamiast kazać czytelnikowi ich szukać", () => {
    const report = formatReport(diffSamples(BASE_SAMPLE, withOverrides({ readyMs: 568.4 })), {
      before: "BAZA",
      after: "PO",
    });
    expect(report).toContain("Poza pasmem szumu:");
    expect(report).toContain("gotowość (__nesAppReady) (pojawiło się)");
    expect(report).not.toContain("Żadna metryka");
  });

  it("kolumny są wyrównane do najdłuższej TREŚCI, nie do stałej szerokości", () => {
    // Asercja mierzy WŁAŚCIWOŚĆ, nie kruchy objaw. Pierwsza wersja porównywała
    // długość separatora z długością nagłówka i padła słusznie: wiersze są
    // obcinane z prawej (`trimEnd`, żeby nie zostawiać białych znaków na końcu
    // linii), a separator nie, więc te dwie długości NIE MAJĄ być równe.
    // Właściwość, o którą naprawdę chodzi, to: dłuższa wartość w kolumnie
    // POSZERZA tę kolumnę.
    const widthOf = (kb: number): number => {
      const report = formatReport(diffSamples(BASE_SAMPLE, withOverrides({ jsTransferKb: kb })), {
        before: "BAZA",
        after: "PO",
      });
      // Separator jest jedynym wierszem o pełnej szerokości tabeli.
      return report.split("\n")[1].length;
    };
    // 9 999,9 KB jest dłuższe w znakach niż 2 580,6 KB, więc tabela musi
    // urosnąć; identyczna szerokość znaczyłaby szerokości zaszyte na stałe.
    expect(widthOf(9_999.9)).toBeGreaterThan(widthOf(2_580.6));
  });

  it("separator obejmuje CAŁĄ szerokość tabeli - inaczej wygląda jak urwany", () => {
    const rows = diffSamples(BASE_SAMPLE, withOverrides({ readyMs: 568.4 }));
    const lines = formatReport(rows, { before: "BAZA", after: "PO" }).split("\n");
    const widest = Math.max(...lines.slice(2).map((l) => l.length));
    expect(lines[1].length).toBeGreaterThanOrEqual(widest);
  });
});

describe("METRICS - inwarianty tabeli", () => {
  it("etykiety są UNIKALNE", () => {
    // To nie jest higiena, to warunek poprawności: raport jest czytany po
    // etykiecie i wyszukiwany po etykiecie. Duplikat („    plików" pod
    // domknięciem statycznym i dynamicznym) sprawiał, że wyszukiwanie brało
    // pierwsze trafienie, a jeden z przypadków tej bramki mierzył inny wiersz,
    // niż nazywał - i przechodził z niewłaściwego powodu.
    const labels = METRICS.map((m) => m.label);
    expect(new Set(labels).size, `duplikaty: ${labels.join(" | ")}`).toBe(labels.length);
  });

  it("każda metryka wskazuje pole LICZBOWE próbki", () => {
    // `linkHeader` jest tekstem; wpisanie go do METRICS przemyciłoby NaN do
    // arytmetyki różnic. Kontrola pozytywna, że tabela nie jest pusta, jest
    // w tym samym przypadku - bez niej asercja byłaby spełniona trywialnie.
    expect(METRICS.length).toBeGreaterThan(5);
    for (const metric of METRICS) {
      expect(typeof BASE_SAMPLE[metric.key], `pole \`${String(metric.key)}\``).not.toBe("string");
    }
  });
});

describe("modulepreloadTargets", () => {
  it("pusty nagłówek daje pustą listę", () => {
    expect(modulepreloadTargets(null)).toEqual([]);
  });

  it("z nagłówka BAZY nie wyciąga niczego - hint słownika tam nie istniał", () => {
    expect(modulepreloadTargets(BASE_SAMPLE.linkHeader)).toEqual([]);
  });

  it("wyciąga cel modulepreload obok preloadów i preconnectu", () => {
    // Prawdziwy nagłówek z przebiegu po zmianie.
    const header =
      '</assets/styles-BQZz5a-B.css>; rel="preload"; as="style", ' +
      '<https://unnltowbgszpdzwpawdu.supabase.co>; rel="preconnect", ' +
      '</assets/red-hat-display-latin-BX-N26TK.woff2>; rel="preload"; as="font"; type="font/woff2"; crossorigin, ' +
      '</assets/pl-DEZyBPCt.js>; rel="modulepreload"';
    expect(modulepreloadTargets(header)).toEqual(["/assets/pl-DEZyBPCt.js"]);
  });

  it("przecinek w parametrach nie rozcina wpisu na dwa", () => {
    const header = '</a.js>; rel="modulepreload"; imagesrcset="x 1x, y 2x", </b.js>; rel="preload"';
    expect(modulepreloadTargets(header)).toEqual(["/a.js"]);
  });
});
