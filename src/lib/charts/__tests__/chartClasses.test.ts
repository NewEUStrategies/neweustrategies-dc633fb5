// KLASA, KTÓRA NICZEGO NIE MALUJE, JEST FAŁSZYWĄ OBIETNICĄ.
//
// PO CO TA BRAMKA. Silnik wykresów rozdaje wygląd przez klasy `neh-*`,
// a arkusz jest plikiem WSPÓLNYM - żaden komponent nie może go zmienić bez
// kolizji z sąsiadem. W tej pracy to ograniczenie zamieniło się w defekt:
// render roju wystawił `neh-bee-dot`, `neh-bee-axis`, `neh-bee-tick`
// i `neh-bee-label`, a w `styles.css` nie było ani jednej z tych reguł, bo
// autor renderu nie miał prawa jej dopisać. Plamka roju jechała więc
// z domyślną grubością obwódki SVG (1 px zamiast tokena), a trzy pozostałe
// klasy nie robiły nic.
//
// TO NIE BYŁ WYPADEK JEDNEGO PLIKU. Ta sama bramka, uruchomiona pierwszy raz,
// wyłapała `neh-pie-value` - klasę wystawioną przez tarczę WCZEŚNIEJ w tej
// samej pracy i również bez reguły. Klasa bez reguły nie daje objawu: nic się
// nie psuje, nic nie krzyczy, a następny czytelnik grepuje jej nazwę
// w arkuszu, nie znajduje nic i traci kwadrans na ustalenie, czy to on czegoś
// nie widzi.
//
// DWIE DOPUSZCZALNE ODPOWIEDZI, obie jawne:
//   1. klasa MA regułę w `src/styles.css` - wtedy maluje i wszystko jest
//      w porządku;
//   2. klasa jest UCHWYTEM ZAPYTANIA (selektor testu albo skryptu) i stoi na
//      liście `UCHWYTY` niżej, z powodem.
//
// KONWENCJA DLA NOWEGO KODU: uchwyt oznaczaj atrybutem `data-role="..."`, nie
// klasą - tak robi `BoxplotChart`, i dzięki temu test rozdzielnika rodzajów
// odróżnia boxplota od histogramu jednym selektorem, bez udawania, że coś
// stylizuje. Lista `UCHWYTY` jest ZAMKNIĘTA: obejmuje wyłącznie klasy, które
// były uchwytami przed wprowadzeniem tej konwencji, i nie ma rosnąć.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

const KATALOG = "src/components/charts";
const css = readFileSync("src/styles.css", "utf8");

/**
 * Klasy istniejące WYŁĄCZNIE jako uchwyt zapytania, z powodem. Lista jest
 * zamknięta - nowy uchwyt idzie na `data-role`, nie tutaj.
 */
const UCHWYTY: Readonly<Record<string, string>> = {
  "neh-pie-value": "selektor liczby na łuku w pieChart.test.tsx; wygląd niesie neh-arc-label",
  "neh-bee-tick": "selektor podziałki osi roju; wygląd niesie reguła bazowa .neh-chart text",
  "neh-bee-axis": "selektor podpisu osi roju; wygląd niesie reguła bazowa .neh-chart text",
  "neh-bee-n": "selektor liczebności roju; wygląd niesie reguła bazowa plus tabular-nums",
};

/** Wszystkie klasy `neh-*` wypisane w literałach `className` komponentów. */
function klasyKomponentow(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const plik of readdirSync(KATALOG)) {
    if (!plik.endsWith(".tsx")) continue;
    const zrodlo = readFileSync(`${KATALOG}/${plik}`, "utf8");
    // Literały w cudzysłowach - obejmuje `className="a b"` oraz gałęzie
    // wyrażeń warunkowych, bo tam też stoją zwykłe napisy.
    for (const m of zrodlo.matchAll(/"([^"]*\bneh-[a-z0-9-]+[^"]*)"/g)) {
      for (const token of m[1].split(/\s+/)) {
        if (!token.startsWith("neh-")) continue;
        const gdzie = out.get(token) ?? new Set<string>();
        gdzie.add(plik);
        out.set(token, gdzie);
      }
    }
  }
  return out;
}

describe("klasy silnika wykresów - każda maluje albo jest jawnym uchwytem", () => {
  const klasy = klasyKomponentow();

  it("znajduje klasy do sprawdzenia - bramka nie jest pusta", () => {
    // Bez tego przypadku zepsuty parser dawałby zieloną bramkę mierzącą nic.
    expect(klasy.size).toBeGreaterThan(20);
    expect([...klasy.keys()]).toContain("neh-bar");
  });

  for (const [klasa, pliki] of [...klasy].sort(([a], [b]) => a.localeCompare(b))) {
    it(`${klasa} ma regułę w arkuszu albo powód na liście uchwytów`, () => {
      const maRegule = css.includes(`.${klasa}`);
      const powod = UCHWYTY[klasa];
      expect(
        maRegule || powod !== undefined,
        `Klasa ${klasa} (${[...pliki].join(", ")}) nie ma reguły w src/styles.css.\n` +
          "Dopisz regułę albo - jeśli to uchwyt zapytania - oznacz element atrybutem " +
          'data-role="..." i użyj go w teście. Lista UCHWYTY jest zamknięta.',
      ).toBe(true);
    });
  }

  it("lista uchwytów nie zawiera klas, które W KOŃCU dostały regułę", () => {
    // Ratchet w drugą stronę: gdy uchwyt dostanie prawdziwy wygląd, wpis
    // przestaje być prawdą i ma zniknąć z listy. Bez tego lista rosłaby
    // w nieskończoność i przestałaby cokolwiek znaczyć.
    for (const klasa of Object.keys(UCHWYTY)) {
      expect(
        css.includes(`.${klasa}`),
        `${klasa} ma już regułę w arkuszu - usuń wpis z listy UCHWYTY.`,
      ).toBe(false);
    }
  });

  it("każdy wpis na liście uchwytów jest NAPRAWDĘ używany", () => {
    // Trzecia strona tego samego niezmiennika: wpis dla klasy, której nikt
    // nie wystawia, jest martwym kodem w bramce.
    for (const klasa of Object.keys(UCHWYTY)) {
      expect(klasy.has(klasa), `${klasa} nie jest już wystawiana - usuń wpis z UCHWYTY.`).toBe(
        true,
      );
    }
  });
});
