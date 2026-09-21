// POLARYZACJA ORZECZEŃ UCZCIWOŚCI: `Ok` znaczy ZAWSZE to samo.
//
// KONWENCJA, KTÓREJ TA BRAMKA PILNUJE, i która w tym silniku już obowiązuje -
// sprawdzone pomiarem, zanim powstał ten plik: 47 pól `*Ok` w modelach, 72
// odczyty `=== false` i ANI JEDEN odczyt `=== true` w kodzie nietestowym.
//
//   * pole `*Ok` jest ORZECZENIEM: `true` = w porządku, `false` = defekt,
//     `null` = nie ma o czym orzekać (brak danych, nie brak problemu);
//   * pole BEZ sufiksu `Ok` jest INFORMACJĄ, nie orzeczeniem - na przykład
//     `FanHonesty.wideAtStart` („czy wachlarz zaczyna się szeroko") albo
//     `firstStepWidthShare`. Żadna liczba nie jest w nich fałszywa, więc
//     dopisanie im `Ok` zamieniłoby informację w orzeczenie, którego model
//     nie wydaje.
//
// DLACZEGO TO W OGÓLE MOŻE SIĘ ZEPSUĆ. Pole nazwane `costamOk`, które znaczy
// „coś tam JEST nie tak", czyta się w warunku dokładnie odwrotnie do tego, co
// obiecuje nazwa - a warunek `if (h.costamOk) dopiszPrzypisODefekcie()`
// wygląda przy pobieżnym czytaniu poprawnie. Skutkiem jest przypis
// o defekcie wypisany dla danych ZDROWYCH i milczenie przy zepsutych, czyli
// dokładnie odwrócenie sensu podpisu uczciwościowego. Żadna inna bramka tego
// nie widzi: typy się zgadzają, klucz słownika istnieje, tekst jest
// przetłumaczony w obu językach.
//
// CZEGO TA BRAMKA NIE WIDZI, powiedziane wprost, żeby nikt nie wziął jej za
// dowód poprawności semantyki: nie umie sprawdzić, czy `xOk` jest liczone
// z właściwego warunku. Pilnuje KIERUNKU ODCZYTU i KSZTAŁTU TYPU - czyli
// tego, co da się sprawdzić tekstem źródła - a nie tego, czy orzeczenie jest
// prawdziwe. Na to są testy modeli.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { bezKomentarzy } from "@/lib/ci/sourceScan";

const MODELE = "src/lib/charts/kinds";
const KATALOGI = ["src/lib/charts", "src/lib/charts/kinds", "src/components/charts"];

/** Pliki źródłowe katalogu, bez testów i bez podkatalogu `__tests__`. */
function zrodla(katalog: string): string[] {
  return readdirSync(katalog, { withFileTypes: true })
    .filter((e) => e.isFile() && /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name))
    .map((e) => `${katalog}/${e.name}`);
}

/** Deklaracje pól `*Ok` w modelach: nazwa i zapisany typ. */
function polaOk(): { plik: string; pole: string; typ: string }[] {
  const out: { plik: string; pole: string; typ: string }[] = [];
  for (const plik of zrodla(MODELE)) {
    const src = bezKomentarzy(readFileSync(plik, "utf8"));
    for (const m of src.matchAll(/^\s{2}([a-zA-Z][A-Za-z0-9]*Ok)\??:\s*([^;]+);/gm)) {
      out.push({ plik: plik.split("/").pop() ?? plik, pole: m[1], typ: m[2].trim() });
    }
  }
  return out;
}

describe("polaryzacja orzeczeń uczciwości", () => {
  it("orzeczenie `*Ok` jest BOOLEM, a nie liczbą ani napisem", () => {
    // Pole `Ok` o typie liczbowym znaczy, że ktoś nazwał orzeczeniem coś, co
    // jest pomiarem - a wtedy `if (h.xOk)` odpala się na każdej wartości
    // różnej od zera, w tym na zmierzonym defekcie.
    const zle = polaOk().filter((p) => !/^boolean( \| null)?$/.test(p.typ));
    expect(
      zle.map((p) => `${p.plik}: ${p.pole}: ${p.typ}`),
      "pole z sufiksem Ok jest ORZECZENIEM, więc ma być `boolean` albo " +
        "`boolean | null` (null = nie ma o czym orzekać). Pomiar nazwij bez `Ok`",
    ).toEqual([]);
  });

  it("defekt czyta się przez `=== false`, NIGDY przez `=== true`", () => {
    // To jest ratchet na zero: w chwili powstania tej bramki w kodzie
    // nietestowym nie ma ANI JEDNEGO odczytu `=== true` na polu orzekającym,
    // a jest ich 72 przez `=== false`. Pierwszy `=== true` będzie albo
    // pomyłką kierunku, albo świadomym wyjątkiem - i wtedy ma o sobie
    // powiedzieć w recenzji, zamiast wejść po cichu.
    const trafienia: string[] = [];
    for (const katalog of KATALOGI) {
      for (const plik of zrodla(katalog)) {
        const src = bezKomentarzy(readFileSync(plik, "utf8"));
        for (const m of src.matchAll(/([a-zA-Z][A-Za-z0-9]*Ok)\s*===\s*true/g)) {
          trafienia.push(`${plik}: ${m[1]} === true`);
        }
      }
    }
    expect(
      trafienia,
      "orzeczenie uczciwości czyta się przez `=== false` (defekt). " +
        "`=== true` odwraca kierunek albo jest zbędne - `if (h.xOk)` wystarcza",
    ).toEqual([]);
  });

  it("bramka MA ZĘBY: widzi odwrócony odczyt i zły typ w źródle syntetycznym", () => {
    // Bez tego oba sprawdzenia wyżej byłyby spełnione również wtedy, gdyby
    // wzorzec przestał cokolwiek dopasowywać - a bramka cicho zielona wygląda
    // identycznie jak spełniony inwariant.
    const odwrocony = bezKomentarzy("if (h.bandsNestedOk === true) dopiszPrzypis();");
    expect([...odwrocony.matchAll(/([a-zA-Z][A-Za-z0-9]*Ok)\s*===\s*true/g)].length).toBe(1);

    // ...i NIE widzi go w komentarzu, bo komentarze cytują w tym repozytorium
    // zakazane wzorce, żeby je wyjaśnić (lekcja z `chartDictionaryKeys`).
    const wKomentarzu = bezKomentarzy("// zakaz: nigdy h.bandsNestedOk === true\nconst a = 1;");
    expect([...wKomentarzu.matchAll(/([a-zA-Z][A-Za-z0-9]*Ok)\s*===\s*true/g)].length).toBe(0);

    const zlyTyp = "  droppedOk: number;";
    expect(/^\s{2}([a-zA-Z][A-Za-z0-9]*Ok)\??:\s*([^;]+);/m.exec(zlyTyp)?.[2]).toBe("number");
  });

  it("konwencja obejmuje realny silnik, a nie pustą listę", () => {
    // Osłona przed testem pustym: gdyby skan przestał znajdować modele,
    // dwa sprawdzenia wyżej przeszłyby na zerowej liście.
    const pola = polaOk();
    expect(pola.length, "skan nie znalazł ani jednego pola orzekającego").toBeGreaterThan(30);
    expect(
      new Set(pola.map((p) => p.plik)).size,
      "pola mają leżeć w wielu modelach",
    ).toBeGreaterThan(4);
  });
});
