// KOMU TO ZDANIE MÓWI? Bramka podziału porad formy po ODBIORCY.
//
// PO CO. Porada formy jest dwiema wypowiedziami w jednym worku: OBSERWACJĄ
// o rysunku ("obserwacji jest tyle, że plamki nachodzą na siebie") i
// ZALECENIEM ("weź histogram albo boxplot"). Do tego PR-a oba zdania pisał
// render, czyli oba stały pod OPUBLIKOWANYM wykresem - a zalecenie jest
// instrukcją dla autora bloku i czytelnik nie ma jak jej wykonać. Gorzej:
// „użyj beeswarma" pod cudzym wykresem podważa rysunek, którego czytelnik
// nie poprawi, więc jedyne, co zostaje po tym zdaniu, to nieufność.
//
// Podział, który ta bramka pilnuje:
//   * `<rodzaj>.reading.*` - nakładka publiczna `i18n-charts.ts`, wołana
//     z renderów, wyłącznie obserwacje;
//   * `<rodzaj>.advice.*` - nakładka `i18n-charts-editor.ts` (tylko admin),
//     wołana z `chartFormAdvice`, zalecenia dla autora.
//
// Bez bramki podział rozjechałby się przy PIERWSZYM nowym rodzaju: nikt nie
// szuka w recenzji zdania, którego nie ma, a objawem byłoby zalecenie
// wyświetlone czytelnikowi - dokładnie to, co ten PR naprawia.
//
// TRZECIE SPRAWDZENIE (wstawki) ma powód z tej samej pracy.
// `beeswarm.reading.truncated` mówi „pokazuje {{shown}} z {{total}}
// obserwacji", a render podawał worek `{ drawn, count }`. i18next nie
// podstawia nieznanej zmiennej i ZOSTAWIA w zdaniu surowe klamry, więc pod
// rysunkiem stało "pokazuje {{shown}} z {{total}} obserwacji". Ani typ, ani
// bramka rozjazdu kod-słownik tego nie widzą: klucz istnieje, tłumaczenie
// istnieje, brakuje wyłącznie LICZBY. Dlatego liczy się tu treść zdania,
// a nie obecność klucza.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { CHART_KINDS, type ChartKind } from "@/lib/charts/types";
import { FORM_ADVICE, chartFormAdvice } from "@/lib/charts/formAdvice";
import { parseChartConfig } from "@/lib/charts/parse";

const KATALOG = "src/components/charts";
const publiczny = readFileSync("src/lib/i18n-charts.ts", "utf8");
const edytorski = readFileSync("src/lib/i18n-charts-editor.ts", "utf8");

/* -------------------------------------------------------------------------- */
/*  Czytanie nakładek                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Zawartość bloku `{...}` od podanej klamry. Klamry LICZONE POZA NAPISAMI -
 * treści porad zawierają `{{max}}`, więc naiwny licznik gubiłby domknięcie
 * i zwracał resztę pliku.
 */
function blok(src: string, odKlamry: number): string {
  let glebokosc = 0;
  let wNapisie = false;
  for (let i = odKlamry; i < src.length; i += 1) {
    const c = src[i];
    if (wNapisie) {
      if (c === "\\") i += 1;
      else if (c === '"') wNapisie = false;
      continue;
    }
    if (c === '"') wNapisie = true;
    else if (c === "{") glebokosc += 1;
    else if (c === "}") {
      glebokosc -= 1;
      if (glebokosc === 0) return src.slice(odKlamry + 1, i);
    }
  }
  throw new Error("niedomknięty blok słownika");
}

/** Granica bloku PL i EN: nakładki deklarują `const en: typeof pl = {`. */
function polowy(src: string): [string, string] {
  const granica = src.search(/^const en\b/m);
  expect(granica, "nakładka musi mieć blok `const en`").toBeGreaterThan(0);
  return [src.slice(0, granica), src.slice(granica)];
}

/** Wpisy `klucz: "treść"` bloku, z obsługą treści sklejanej plusem. */
function wpisy(src: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /(\w+):\s*((?:"(?:[^"\\]|\\.)*"\s*\+?\s*)+)/g;
  for (const m of src.matchAll(re)) {
    out.set(m[1], m[2]);
  }
  return out;
}

/** Podblok `nazwa: { ... }` rodzaju z jednej połowy nakładki, albo `null`. */
function podblokRodzaju(polowa: string, kind: string, nazwa: string): string | null {
  const start = polowa.indexOf(`\n    ${kind}: {`);
  if (start < 0) return null;
  const cialo = blok(polowa, polowa.indexOf("{", start));
  const wewn = cialo.indexOf(`${nazwa}: {`);
  if (wewn < 0) return null;
  return blok(cialo, cialo.indexOf("{", wewn));
}

/** Nazwy wstawek `{{...}}` w treści komunikatu. */
function wstawki(tresc: string): string[] {
  return [...tresc.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);
}

/**
 * ZALECENIA BEZ POŁOWY OBSERWACYJNEJ, każde z powodem. Lista jest ZAMKNIĘTA
 * i bramka pilnuje jej z dwóch stron: porada, która nie ma tekstu
 * `reading.*`, MUSI tu stać (inaczej znika czytelnikowi po cichu), a wpis,
 * dla którego tekst już powstał, MUSI stąd zniknąć (inaczej lista uczy, że
 * milczenie jest w porządku).
 *
 * Powód „czytelnik tego nie widzi" nie wystarcza sam z siebie - sprawdziliśmy
 * to na `tornado.noBase`, gdzie brzmiał sensownie („nie ma pasków, nie ma
 * o czym mówić"), a w rzeczywistości czytelnik dostawał etykiety parametrów
 * nad pustym polem bez jednego słowa wyjaśnienia. Zostają więc wyłącznie te
 * porady, których treść jest CAŁA o wyborze autora.
 */
const TYLKO_DLA_AUTORA: Readonly<Record<string, string>> = {
  "beeswarm.tooFew":
    "treść to pochwała wyboru formy („beeswarm jest tu najuczciwszy, nie zamieniaj go na boxplot”) - pod rysunkiem byłaby zdaniem, które chwali samo siebie",
  "scatter.lineBetter":
    "wykres punktowy jest poprawny i kompletny; zdanie mówi wyłącznie, że INNA forma pokazałaby więcej, a tej zmiany czytelnik nie wykona",
};

const JEZYKI = ["pl", "en"] as const;
const POLOWY_EDYTORSKIE = polowy(edytorski);
const POLOWY_PUBLICZNE = polowy(publiczny);

/* -------------------------------------------------------------------------- */
/*  Czytanie komponentów                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Ścieżki słownika wypisane w komponencie W CUDZYSŁOWACH - czyli klucze,
 * które naprawdę idą do `t()`, a nie wzmianki z komentarzy. Komentarze
 * w tych plikach cytują klucze w BACKTICKACH (`advice.*`), więc filtr po
 * cudzysłowie odróżnia opis od wywołania bez parsowania JavaScriptu.
 */
function kluczeSlownika(zrodlo: string): string[] {
  return [...zrodlo.matchAll(/"([a-zA-Z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*)+)"/g)].map(
    (m) => m[1],
  );
}

function pliki(): string[] {
  return readdirSync(KATALOG).filter((p) => p.endsWith(".tsx") && !p.includes("__tests__"));
}

/* -------------------------------------------------------------------------- */

describe("porady formy: obserwacja dla czytelnika, zalecenie dla autora", () => {
  it("żaden render publiczny nie woła klucza `advice.`", () => {
    const winowajcy: string[] = [];
    for (const plik of pliki()) {
      for (const klucz of kluczeSlownika(readFileSync(`${KATALOG}/${plik}`, "utf8"))) {
        if (/(^|\.)advice\./.test(klucz)) winowajcy.push(`${plik}: ${klucz}`);
      }
    }
    expect(
      winowajcy,
      "zalecenie zmiany formy jest instrukcją dla AUTORA - render publiczny " +
        "woła wyłącznie `reading.*`, a zalecenia pokazuje `chartFormAdvice` " +
        "w edytorze bloku",
    ).toEqual([]);
  });

  it("tabela porad zgadza się ze słownikiem edytorskim w obu językach", () => {
    for (const kind of CHART_KINDS) {
      const wpis = FORM_ADVICE[kind];
      for (const [i, jezyk] of JEZYKI.entries()) {
        const podblok = podblokRodzaju(POLOWY_EDYTORSKIE[i], kind, "advice");
        if (wpis.all.length === 0) {
          // Rodzaj bez porad NIE MOŻE mieć treści w słowniku: martwy klucz
          // wygląda w recenzji jak funkcja, której ktoś zapomniał wywołać.
          expect(
            podblok,
            `rodzaj ${kind} nie ma porad w tabeli, a ma je w słowniku (${jezyk})`,
          ).toBeNull();
          continue;
        }
        expect(podblok, `brak bloku advice dla ${kind} w ${jezyk}`).not.toBeNull();
        const klucze = [...wpisy(podblok ?? "").keys()].sort();
        expect([...wpis.all].sort(), `rozjazd tabeli i słownika dla ${kind} (${jezyk})`).toEqual(
          klucze,
        );
      }
    }
  });

  it("worek liczb pokrywa każdą wstawkę zalecenia", () => {
    for (const kind of CHART_KINDS) {
      const wpis = FORM_ADVICE[kind];
      if (wpis.all.length === 0) continue;
      for (const [i, jezyk] of JEZYKI.entries()) {
        const podblok = podblokRodzaju(POLOWY_EDYTORSKIE[i], kind, "advice") ?? "";
        for (const [porada, tresc] of wpisy(podblok)) {
          if (wpis.onlyInPreview.includes(porada)) continue;
          const worek = Object.keys(wpis.values(porada, jezyk));
          for (const w of wstawki(tresc)) {
            expect(
              worek,
              `${kind}.advice.${porada} (${jezyk}) pisze {{${w}}}, a worek liczb tego nie podaje ` +
                "- i18next zostawi w zdaniu surowe klamry",
            ).toContain(w);
          }
        }
      }
    }
  });

  it("każda obserwacja ze słownika jest wołana z renderu", () => {
    // Tekst `reading.*`, którego nikt nie woła, jest gorszy niż jego brak:
    // w recenzji wygląda na wdrożony, a czytelnik go nie zobaczy. Tak
    // wyglądałby stan po ustawieniu klucza na `null` w mapie renderu przy
    // zostawionej treści w słowniku.
    const zrodla = pliki().map((p) => readFileSync(`${KATALOG}/${p}`, "utf8"));
    for (const kind of CHART_KINDS) {
      const podblok = podblokRodzaju(POLOWY_PUBLICZNE[0], kind, "reading");
      if (podblok === null) continue;
      for (const porada of wpisy(podblok).keys()) {
        const klucz = `${kind}.reading.${porada}`;
        expect(
          zrodla.some((z) => z.includes(`"${klucz}"`)),
          `${klucz} stoi w słowniku, ale żaden render go nie woła`,
        ).toBe(true);
      }
    }
  });

  it("zalecenie bez wersji dla czytelnika stoi na liście z powodem", () => {
    const uzasadnione = new Set(Object.keys(TYLKO_DLA_AUTORA));
    const bezPowodu: string[] = [];
    for (const kind of CHART_KINDS) {
      const wpis = FORM_ADVICE[kind];
      const czytane = new Set(
        wpisy(podblokRodzaju(POLOWY_PUBLICZNE[0], kind, "reading") ?? "").keys(),
      );
      for (const porada of wpis.all) {
        const nazwa = `${kind}.${porada}`;
        if (czytane.has(porada)) {
          // RATCHET: treść dla czytelnika już jest, więc wpis na liście
          // wyjątków byłby kłamstwem o stanie kodu.
          expect(
            uzasadnione,
            `${nazwa} ma już tekst reading.* - usuń wpis z TYLKO_DLA_AUTORA`,
          ).not.toContain(nazwa);
          continue;
        }
        if (!uzasadnione.has(nazwa)) bezPowodu.push(nazwa);
      }
    }
    expect(
      bezPowodu,
      "porada bez wersji `reading.*` znika czytelnikowi po cichu - dopisz " +
        "treść obserwacji albo wpis z powodem do TYLKO_DLA_AUTORA",
    ).toEqual([]);
  });

  it("render podaje każdą wstawkę obserwacji", () => {
    // Który plik pisze obserwacje danego rodzaju USTALAMY Z KODU, a nie
    // z tabeli nazw plików: mapa `KLUCZE`, którą trzeba by pamiętać,
    // rozjeżdża się przy pierwszej zmianie nazwy komponentu.
    const zrodla = new Map(pliki().map((p) => [p, readFileSync(`${KATALOG}/${p}`, "utf8")]));
    for (const kind of CHART_KINDS) {
      for (const [i, jezyk] of JEZYKI.entries()) {
        const podblok = podblokRodzaju(POLOWY_PUBLICZNE[i], kind, "reading");
        if (podblok === null) continue;
        for (const [porada, tresc] of wpisy(podblok)) {
          const brakujace = wstawki(tresc);
          if (brakujace.length === 0) continue;
          const klucz = `${kind}.reading.${porada}`;
          const [plik, zrodlo] =
            [...zrodla].find(([, z]) => z.includes(`"${klucz}"`)) ?? ([null, null] as const);
          expect(
            plik,
            `nikt nie woła ${klucz} (${jezyk}) - obserwacja bez renderu jest martwa`,
          ).not.toBeNull();
          for (const w of brakujace) {
            expect(
              new RegExp(`\\b${w}\\s*:`).test(zrodlo ?? ""),
              `${plik} woła ${klucz} z {{${w}}} (${jezyk}), a nie podaje tej liczby w worku`,
            ).toBe(true);
          }
        }
      }
    }
  });

  it("porada zostawiona przy podglądzie ma odpowiednik dla czytelnika", () => {
    // `onlyInPreview` znaczy „edytor tego nie policzy, bo nie zna geometrii".
    // Jeśli taka porada nie ma też wersji `reading.*`, autor nie zobaczy jej
    // NIGDZIE - a to jest cichy ubytek, nie decyzja.
    for (const kind of CHART_KINDS) {
      const wpis = FORM_ADVICE[kind];
      for (const porada of wpis.onlyInPreview) {
        expect([...wpis.all], `${kind}: ${porada} nie jest poradą tego rodzaju`).toContain(porada);
        const podblok = podblokRodzaju(POLOWY_PUBLICZNE[0], kind, "reading") ?? "";
        expect(
          [...wpisy(podblok).keys()],
          `${kind}.${porada} zostaje przy podglądzie, więc MUSI mieć wersję reading.*`,
        ).toContain(porada);
      }
    }
  });

  it("zalecenia idą w kolejności słownika i tylko te, które zachodzą", () => {
    // Arkusz jednej kategorii i jednej wartości: dla mapy ciepła to na pewno
    // NIE macierz, dla tornada nie ma bazy, dla rozrzutu nie ma drugiej
    // zmiennej - czyli każdy rodzaj z tabeli ma tu co powiedzieć poza
    // rodzajami bez porad.
    // Konfiguracja PRZEZ PARSER bloku, nie literałem: literał trzeba by
    // dopisywać przy każdym nowym polu `ChartConfig`, a parser jest tą samą
    // drogą, którą arkusz autora wchodzi do silnika.
    const config = (kind: ChartKind) =>
      parseChartConfig({
        kind,
        categories: ["a"],
        series: [{ name: "s", values: [1], colorSlot: 1 }],
      });
    for (const kind of CHART_KINDS) {
      const wpis = FORM_ADVICE[kind];
      const komunikaty = chartFormAdvice(config(kind), "pl");
      const nazwy = komunikaty.map((m) => m.advice);
      // Kolejność: podciąg listy `all`, czyli kolejność słownika.
      const wzorzec = wpis.all.filter((a) => nazwy.includes(a));
      expect(nazwy, `${kind}: kolejność zaleceń musi być kolejnością słownika`).toEqual([
        ...wzorzec,
      ]);
      for (const m of komunikaty) {
        expect(m.key, `${kind}: klucz zalecenia musi być pełną ścieżką`).toBe(
          `${wpis.ns}.advice.${m.advice}`,
        );
        expect(
          wpis.onlyInPreview,
          `${kind}: ${m.advice} zostaje przy podglądzie, edytor nie ma go pokazywać`,
        ).not.toContain(m.advice);
      }
    }
  });
});
