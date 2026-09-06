// KONTROLE NEGATYWNE BRAMKI `check:clock-freeze`.
//
// Bramka bez kontroli negatywnej nie jest bramką. Zielony przebieg dowodzi
// wyłącznie tego, że skrypt się wykonał - nie tego, że cokolwiek by wyłapał.
// Wydanie 9 audytu prognozowało dwie bomby zegarowe okiem: obie prognozy były
// fałszywe, a tej, która wybuchła, nie przewidziało. Ten plik zamienia oko na
// sprawdzalny inwariant, więc każdy przypadek nazwany KONTROLA NEGATYWNA
// pokazuje wejście, na którym bramka MUSI być czerwona.
import { describe, expect, it } from "vitest";

import {
  compareWithRatchet,
  isTestFile,
  ratchetFailed,
  renderReport,
  scanClockFreeze,
  type SourceFile,
} from "../clockFreeze";

/** Moduł produkcyjny, który czyta PRAWDZIWY zegar - warunek 3 detektora. */
const PRODUKCJA: SourceFile = {
  file: "src/lib/okno.ts",
  source: `
    export function wOknie(sinceHours = 168): number {
      return Date.now() - sinceHours * 3_600_000;
    }
  `,
};

/** Moduł produkcyjny BEZ zegara - sam import nie robi z testu bomby. */
const BEZ_ZEGARA: SourceFile = {
  file: "src/lib/etykieta.ts",
  source: `export const ETYKIETA = "wpłata";`,
};

function scan(...files: SourceFile[]) {
  return scanClockFreeze([PRODUKCJA, BEZ_ZEGARA, ...files]);
}

function sprawdz(baseline: ReadonlyMap<string, number>, ...files: SourceFile[]) {
  const wynik = scan(...files);
  const known = new Set(files.map((f) => f.file).filter(isTestFile));
  return compareWithRatchet(wynik, baseline, known);
}

// ---------------------------------------------------------------------------
// Detektor - trzy warunki naraz
// ---------------------------------------------------------------------------

describe("scanClockFreeze - plik jest bombą tylko przy WSZYSTKICH trzech warunkach", () => {
  it("literał + import modułu z zegarem + brak zamrożenia = bomba", () => {
    const wynik = scan({
      file: "src/lib/__tests__/a.test.ts",
      source: `
        import { wOknie } from "@/lib/okno";
        it("x", () => { expect(wOknie()).toBeTypeOf("number"); });
        const wiersz = { created_at: "2026-08-30T10:00:00.000Z" };
      `,
    });
    expect(wynik.bombs.map((b) => b.file)).toEqual(["src/lib/__tests__/a.test.ts"]);
    expect(wynik.bombs[0]!.literals).toBe(1);
    expect(wynik.bombs[0]!.via).toBe("import");
  });

  it("BEZ literału daty nie ma bomby, choćby zależność czytała zegar", () => {
    const wynik = scan({
      file: "src/lib/__tests__/b.test.ts",
      source: `import { wOknie } from "@/lib/okno"; it("x", () => wOknie());`,
    });
    expect(wynik.bombs).toEqual([]);
  });

  it("literał BEZ zależności od zegara to nie bomba - data jest wtedy zwykłym wejściem", () => {
    const wynik = scan({
      file: "src/lib/__tests__/c.test.ts",
      source: `
        import { ETYKIETA } from "@/lib/etykieta";
        it("x", () => { expect(ETYKIETA).toBe("wpłata"); });
        const d = "2026-08-30";
      `,
    });
    expect(wynik.bombs).toEqual([]);
  });

  it("ZAMROŻONY zegar zdejmuje plik z listy, choć literał i zależność zostają", () => {
    const wynik = scan({
      file: "src/lib/__tests__/d.test.ts",
      source: `
        import { wOknie } from "@/lib/okno";
        beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2099-06-15T12:00:00.000Z")); });
        const wiersz = { created_at: "2026-08-30T10:00:00.000Z" };
        it("x", () => wOknie());
      `,
    });
    expect(wynik.bombs).toEqual([]);
    expect(wynik.frozen).toBe(1);
    expect(wynik.withLiteralAndClock).toBe(1);
  });

  it("zamrożenie KANONICZNYM helperem (`freezeClock()`) też zdejmuje plik z listy", () => {
    // Bez tego bramka karałaby naprawę, którą sama zaleca: plik zamrożony
    // przez `@/test/time` nie woła `vi.*` wprost. Zmierzone na
    // `donationsAdmin.server.test.ts` - po rozbrojeniu nadal był liczony jako
    // bomba, dopóki detektor nie nauczył się tego wzorca.
    const wynik = scan({
      file: "src/lib/__tests__/kanon.test.ts",
      source: `
        import { wOknie } from "@/lib/okno";
        import { DZIEN, freezeClock, relativeIso } from "@/test/time";
        freezeClock();
        const wiersz = { created_at: relativeIso(-2 * DZIEN) };
        const stary = "2026-08-30T10:00:00.000Z";
        it("x", () => { void wOknie(); void wiersz; void stary; });
      `,
    });
    expect(wynik.bombs).toEqual([]);
    expect(wynik.frozen).toBe(1);
  });

  it("test czytający zegar SAM jest bombą bez żadnego importu", () => {
    const wynik = scan({
      file: "src/lib/__tests__/e.test.ts",
      source: `it("x", () => { const teraz = Date.now(); const d = "2026-08-30"; void teraz; void d; });`,
    });
    expect(wynik.bombs[0]!.via).toBe("self");
  });

  it("data w KOMENTARZU nie jest fixture'em - komentarze są wygaszane przed skanem", () => {
    // Regresja zmierzona na tym repozytorium: bez wygaszania komentarzy skaner
    // dawał 255 plików zamiast 212, a czoło listy „strefy gorącej" otwierał
    // `adminCareersRoute.test.tsx` z datą 2026-09-05, która stoi w JSDoc-u
    // („a od 2026-09-05 ma DRUGI, niezależny dowód"), a nie w żadnym wierszu.
    const wynik = scan({
      file: "src/lib/__tests__/f.test.ts",
      source: `
        import { wOknie } from "@/lib/okno";
        // Awaria z 2026-08-27 - opis, nie fixture.
        /** Naprawione 2026-09-05. */
        it("x", () => wOknie());
      `,
    });
    expect(wynik.bombs).toEqual([]);
  });

  it("liczy TYLKO importy BEZPOŚREDNIE - zależność przechodnia nie robi bomby", () => {
    const posrednik: SourceFile = {
      file: "src/lib/posrednik.ts",
      source: `export { wOknie } from "@/lib/okno";\nexport const X = 1;`,
    };
    // Import przez pośrednika, który sam zegara nie czyta.
    const czysty: SourceFile = {
      file: "src/lib/przekaznik.ts",
      source: `import { X } from "@/lib/posrednik";\nexport const Y = X;`,
    };
    const wynik = scanClockFreeze([
      PRODUKCJA,
      posrednik,
      czysty,
      {
        file: "src/lib/__tests__/g.test.ts",
        source: `import { Y } from "@/lib/przekaznik";\nconst d = "2026-08-30";\nit("x", () => { void Y; void d; });`,
      },
    ]);
    expect(wynik.bombs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// KONTROLE NEGATYWNE - bramka MUSI być czerwona
// ---------------------------------------------------------------------------

describe("zapadka - pięć wejść, na których bramka MUSI być czerwona", () => {
  const NOWA_BOMBA: SourceFile = {
    file: "src/lib/__tests__/nowa.test.ts",
    source: `
      import { wOknie } from "@/lib/okno";
      const wiersz = { created_at: "2026-08-30T10:00:00.000Z" };
      it("x", () => { void wOknie(); void wiersz; });
    `,
  };

  it("KONTROLA NEGATYWNA 1: NOWY plik z literałem bez zamrożenia OBLEWA bramkę", () => {
    const report = sprawdz(new Map(), NOWA_BOMBA);

    expect(ratchetFailed(report)).toBe(true);
    expect(report.fresh.map((f) => f.file)).toEqual(["src/lib/__tests__/nowa.test.ts"]);
    expect(renderReport(report, 0)).toContain("NOWYCH plików z literałem daty");
  });

  it("KONTROLA NEGATYWNA 2: `vi.setSystemTime(Date.now())` OBLEWA bramkę - twarde zero", () => {
    // Ten wzorzec WYGLĄDA na zamrożenie i dlatego jest groźniejszy od jawnego
    // braku: kotwiczy zegar na „teraz w chwili przebiegu", więc odległość do
    // literału nadal rośnie z każdą dobą. Baseline go NIE przyjmuje.
    const report = sprawdz(new Map(), {
      file: "src/lib/__tests__/pozorne.test.ts",
      source: `
        import { wOknie } from "@/lib/okno";
        beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(Date.now()); });
        it("x", () => void wOknie());
      `,
    });

    expect(ratchetFailed(report)).toBe(true);
    expect(report.antiPattern).toHaveLength(1);
    expect(report.antiPattern[0]!.file).toBe("src/lib/__tests__/pozorne.test.ts");
    expect(renderReport(report, 0)).toContain("TWARDE ZERO NARUSZONE");
  });

  it("KONTROLA NEGATYWNA 3: PODNIESIENIE wpisu baseline'u nie przepuszcza nowego długu", () => {
    // Plik ma jeden literał, a baseline „pozwala" na trzy. Zapadka ma trzymać
    // kierunek, więc nadmiar w baseline nie może być cichym kredytem: gate
    // zgłasza to jako poprawę do ZEJŚCIA W DÓŁ, a nie jako stan docelowy.
    const report = sprawdz(new Map([["src/lib/__tests__/nowa.test.ts", 3]]), NOWA_BOMBA);

    expect(report.improved).toEqual([{ file: "src/lib/__tests__/nowa.test.ts", was: 3, now: 1 }]);
    expect(renderReport(report, 1)).toContain("zaktualizuj baseline W DÓŁ");

    // A gdy plik faktycznie dorobi literałów ponad wpis - bramka jest czerwona.
    const poDolozeniu = sprawdz(new Map([["src/lib/__tests__/nowa.test.ts", 1]]), {
      ...NOWA_BOMBA,
      source: `${NOWA_BOMBA.source}\nconst drugi = { created_at: "2026-08-31T10:00:00.000Z" };`,
    });
    expect(ratchetFailed(poDolozeniu)).toBe(true);
    expect(poDolozeniu.grown).toEqual([{ file: "src/lib/__tests__/nowa.test.ts", was: 1, now: 2 }]);
  });

  it("KONTROLA NEGATYWNA 4: wpis baseline'u o pliku, KTÓREGO NIE MA, OBLEWA bramkę", () => {
    const report = sprawdz(new Map([["src/lib/__tests__/skasowany.test.ts", 4]]), NOWA_BOMBA);

    expect(ratchetFailed(report)).toBe(true);
    expect(report.stale).toEqual([{ file: "src/lib/__tests__/skasowany.test.ts", was: 4 }]);
    expect(renderReport(report, 1)).toContain("MARTWYCH wpisów");
  });

  it("KONTROLA NEGATYWNA 5: DOŁOŻENIE literału do pliku JUŻ na liście OBLEWA bramkę", () => {
    const zDwoma: SourceFile = {
      file: "src/lib/__tests__/znany.test.ts",
      source: `
        import { wOknie } from "@/lib/okno";
        const a = { created_at: "2026-08-30T10:00:00.000Z" };
        const b = { created_at: "2026-08-29T10:00:00.000Z" };
        it("x", () => { void wOknie(); void a; void b; });
      `,
    };
    const baseline = new Map([["src/lib/__tests__/znany.test.ts", 1]]);

    const report = sprawdz(baseline, zDwoma);

    expect(ratchetFailed(report)).toBe(true);
    expect(report.grown).toEqual([{ file: "src/lib/__tests__/znany.test.ts", was: 1, now: 2 }]);
    expect(renderReport(report, 1)).toContain("DOŁOŻYŁO literałów");
  });
});

describe("zapadka - wejścia, na których bramka MUSI być zielona", () => {
  it("plik na liście z niezmienioną liczbą literałów przechodzi", () => {
    const report = sprawdz(new Map([["src/lib/__tests__/znany.test.ts", 1]]), {
      file: "src/lib/__tests__/znany.test.ts",
      source: `
        import { wOknie } from "@/lib/okno";
        const a = { created_at: "2026-08-30T10:00:00.000Z" };
        it("x", () => { void wOknie(); void a; });
      `,
    });

    expect(ratchetFailed(report)).toBe(false);
    expect(renderReport(report, 1)).toContain("OK -");
  });

  it("ROZBROJONY plik (istnieje, ale zamraża zegar) to poprawa, a nie martwy wpis", () => {
    const report = sprawdz(new Map([["src/lib/__tests__/znany.test.ts", 1]]), {
      file: "src/lib/__tests__/znany.test.ts",
      source: `
        import { wOknie } from "@/lib/okno";
        beforeEach(() => vi.setSystemTime(new Date("2099-06-15T12:00:00.000Z")));
        const a = { created_at: "2026-08-30T10:00:00.000Z" };
        it("x", () => { void wOknie(); void a; });
      `,
    });

    expect(ratchetFailed(report)).toBe(false);
    expect(report.stale).toEqual([]);
    expect(report.improved).toEqual([{ file: "src/lib/__tests__/znany.test.ts", was: 1, now: 0 }]);
  });
});
