// NAKŁADKI SŁOWNIKA PR2: MAPA DLA CZYTELNIKA, EDYTOR MAPY, EDYTOR DANYCH WYKRESU.
//
// Trzy nakładki powstały razem, zanim tory wniosły do nich pierwsze klucze
// kontrolek: `i18n-charts-map.ts` (`chartsMap.*`, render mapy),
// `i18n-map-editor.ts` (`mapEditor.*`, edytor mapy) i
// `i18n-chart-data-editor.ts` (`chartEditor.*`, arkusz danych wykresu).
// Bramki `chartDictionaryKeys` i `chartSystemKeys` czytają słownik wykresów
// (`i18n-charts.ts`), więc tych plików nie widzą - ta bramka przenosi na nie
// te same reguły:
//   1. PARYTET PL/EN: każdy liść jest w obu językach i jest niepustym napisem,
//      a wstawki `{{zmienna}}` są w obu wersjach te same - inaczej angielski
//      panel wypisuje surowy klucz albo zdanie bez liczby;
//   2. ŁĄCZNIK, NIE PAUZA: w napisach interfejsu stoi „-", nigdy pauza ani
//      półpauza (zasada domu, ta sama co w `chartSystemKeys.test.ts`);
//   3. NAZWY KANONICZNE: schematy barw i metody podziału mają w edytorze mapy
//      DOKŁADNIE te nazwy, które czytelnik zobaczy w legendzie - autor nie
//      może wybierać „niebieskiego", który na stronie nazywa się inaczej.
import { describe, expect, it } from "vitest";
import i18n from "@/lib/i18n";
import "@/lib/i18n-charts-map";
import "@/lib/i18n-map-editor";
import "@/lib/i18n-chart-data-editor";

const KORZENIE = ["chartsMap", "mapEditor", "chartEditor"] as const;
const JEZYKI = ["pl", "en"] as const;

type Drzewo = { [klucz: string]: unknown };

function czyDrzewo(v: unknown): v is Drzewo {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function galaz(jezyk: (typeof JEZYKI)[number], korzen: string): Drzewo {
  const pakiet: unknown = i18n.getResourceBundle(jezyk, "translation");
  const wezel = czyDrzewo(pakiet) ? pakiet[korzen] : undefined;
  if (!czyDrzewo(wezel)) throw new Error(`test: brak gałęzi ${korzen} (${jezyk})`);
  return wezel;
}

/** Liście drzewa jako mapa `ścieżka -> wartość`. */
function liscie(drzewo: Drzewo, prefiks: string): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const [klucz, wartosc] of Object.entries(drzewo)) {
    const sciezka = `${prefiks}.${klucz}`;
    if (czyDrzewo(wartosc)) for (const [k, v] of liscie(wartosc, sciezka)) out.set(k, v);
    else out.set(sciezka, wartosc);
  }
  return out;
}

const wstawki = (tekst: string): string[] =>
  [...tekst.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort();

/** Kanon z kontraktu PR2 - pisany TU wprost, żeby bramka nie sprawdzała słownika nim samym. */
const KANON = {
  pl: {
    schemes: {
      blue: "niebieski",
      slate: "łupkowy",
      accent: "pomarańczowy (akcent)",
      diverging: "rozbieżny (spadek - wzrost)",
    },
    methods: {
      quantile: "kwantyle (równe liczebności)",
      equal: "równe przedziały",
      continuous: "skala ciągła",
    },
  },
  en: {
    schemes: {
      blue: "Blue",
      slate: "Slate",
      accent: "Orange (accent)",
      diverging: "Diverging (decrease - increase)",
    },
    methods: {
      quantile: "Quantiles (equal counts)",
      equal: "Equal intervals",
      continuous: "Continuous scale",
    },
  },
} as const;

describe("nakładki PR2 - parytet PL/EN", () => {
  it.each(KORZENIE)("%s: te same liście w obu językach, każdy niepustym napisem", (korzen) => {
    const pl = liscie(galaz("pl", korzen), korzen);
    const en = liscie(galaz("en", korzen), korzen);
    expect(pl.size, `${korzen}: pusta gałąź`).toBeGreaterThan(0);
    expect([...en.keys()].sort()).toEqual([...pl.keys()].sort());
    for (const mapa of [pl, en]) {
      for (const [sciezka, wartosc] of mapa) {
        expect(typeof wartosc, sciezka).toBe("string");
        expect(String(wartosc).trim(), sciezka).not.toBe("");
      }
    }
  });

  it.each(KORZENIE)("%s: wstawki {{zmienna}} są te same w PL i EN", (korzen) => {
    const pl = liscie(galaz("pl", korzen), korzen);
    const en = liscie(galaz("en", korzen), korzen);
    for (const [sciezka, wartosc] of pl) {
      expect(wstawki(String(en.get(sciezka) ?? "")), sciezka).toEqual(wstawki(String(wartosc)));
    }
  });

  it.each(KORZENIE)("%s: żaden napis nie używa pauzy ani półpauzy zamiast łącznika", (korzen) => {
    for (const jezyk of JEZYKI) {
      for (const [sciezka, wartosc] of liscie(galaz(jezyk, korzen), korzen)) {
        expect(String(wartosc), `${jezyk}: ${sciezka}`).not.toMatch(/[—–]/);
      }
    }
  });
});

describe("nakładki PR2 - nazwy kanoniczne schematów i metod", () => {
  it.each(JEZYKI)("czytelnik i edytor mapy mówią tymi samymi nazwami (%s)", (jezyk) => {
    for (const korzen of ["chartsMap", "mapEditor"] as const) {
      const g = galaz(jezyk, korzen);
      expect(g.schemes, `${korzen}.schemes (${jezyk})`).toEqual(KANON[jezyk].schemes);
      expect(g.methods, `${korzen}.methods (${jezyk})`).toEqual(KANON[jezyk].methods);
    }
  });

  it("kanon sam nie łamie zasady łącznika - test nie może przepuścić własnej pomyłki", () => {
    expect(JSON.stringify(KANON)).not.toMatch(/[—–]/);
  });
});
