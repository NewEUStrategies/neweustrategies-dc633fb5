// LICZEBNIKI W SŁOWNIKU WYKRESÓW - bramka po defekcie.
//
// DEFEKT ZMIERZONY, nie wydedukowany. Dziewięć napisów wstawiało liczbę
// w zdanie mające JEDNĄ formę mnogą. Sonda na wachlarzu z jedną odrzuconą
// liczbą (`1.7e308` w serii krawędzi):
//
//   [pl] „1 liczb nie ma ani na rysunku, ani w tabeli…"
//   [en] „1 numbers are neither on the chart nor in the table…"
//
// To nie jest usterka kosmetyczna. Uwagi uczciwości stoją pod OPUBLIKOWANYM
// wykresem i mówią czytelnikowi, czego na rysunku nie ma; zdanie napisane
// łamaną polszczyzną podważa liczby, które właśnie broni.
//
// CZEGO PILNUJE TA BRAMKA - dwie strony tej samej umowy:
//   1. KAŻDY napis z `{{count}}` ma formy liczebnika ALBO stoi niżej
//      w `BEZ_LICZEBNIKA` z powodem. Wyjątek jest wpisem w kodzie, a nie
//      przeoczeniem - „n = {{count}}" naprawdę form nie potrzebuje.
//   2. KAŻDY klucz rozpisany na formy ma formę pojedynczą ORAZ co najmniej
//      jedną mnogą, w OBU językach. Sam `_one` znaczy, że przy dwóch i więcej
//      i18next nie znajdzie formy i wypisze na stronie surową ścieżkę klucza.
//
// Polski ma trzy formy istotne dla liczebnika (1 / 2-4 / 5+), angielski dwie -
// stąd `_one`/`_few`/`_many`/`_other` po polsku i `_one`/`_other` po angielsku.
// Czytamy DRZEWO Z RUNTIME'U i18next, a nie tekst pliku: bramka ma widzieć to,
// co zobaczy czytelnik, a nie to, jak zapisano źródło.
import { describe, expect, it } from "vitest";
import i18n from "@/lib/i18n";
import "@/lib/i18n-charts";
import { SUFIKSY_LICZEBNIKA, bazaLiczebnika } from "@/lib/ci/i18nForms";

const JEZYKI = ["pl", "en"] as const;

/**
 * Napisy z `{{count}}`, które form liczebnika NIE potrzebują - każdy z powodem.
 *
 * Lista jest krótka celowo: wpis znaczy „sprawdzone, liczba nie rządzi tu
 * żadnym rzeczownikiem", a nie „nie chciało mi się".
 */
const BEZ_LICZEBNIKA: Record<string, string> = {
  "caption.sampleSize": "n = 12: liczba stoi po znaku równości, nie przy rzeczowniku",
  "scatter.trend.n": "n = 12, jak wyżej",
  "histogram.rule.label": "Przedziały: reguła, 12 - wyliczenie, nie zdanie",
  "histogram.honesty.checksumFailed":
    "liczba stoi w nawiasie jako wartość (z liczbą obserwacji (12)), nie jako podmiot",
  "smallMultiples.reading.tooManyPanels":
    "uwaga powstaje wyłącznie powyżej progu, więc liczba nigdy nie jest jednością, " +
    "a zwrot Paneli jest rządzi dopełniaczem tak samo dla 2 i dla 12",
};

/** Ścieżka -> treść, dla całego poddrzewa `charts` jednego języka. */
function liscie(lng: string): Map<string, string> {
  const bundle = i18n.getResourceBundle(lng, "translation") as Record<string, unknown>;
  const korzen = bundle?.charts as Record<string, unknown> | undefined;
  const out = new Map<string, string>();
  const idz = (wezel: Record<string, unknown>, prefiks: string): void => {
    for (const [k, v] of Object.entries(wezel)) {
      const p = prefiks ? `${prefiks}.${k}` : k;
      if (typeof v === "string") out.set(p, v);
      else if (v && typeof v === "object") idz(v as Record<string, unknown>, p);
    }
  };
  if (korzen) idz(korzen, "");
  return out;
}

describe("liczebniki w słowniku wykresów", () => {
  it("skan widzi realny słownik, a nie pustkę", () => {
    // Osłona przed cicho zieloną bramką: gdyby `charts` przestało się
    // rejestrować, oba sprawdzenia niżej przeszłyby na pustej mapie.
    for (const lng of JEZYKI) {
      // 431 (pl) i 431 (en) w chwili powstania bramki - podłoga, nie pomiar.
      expect(liscie(lng).size, `${lng}: słownik wykresów jest pusty`).toBeGreaterThan(400);
    }
  });

  it("napis z {{count}} ma formy liczebnika albo powód na liście", () => {
    const bezForm: string[] = [];
    for (const lng of JEZYKI) {
      for (const [sciezka, tresc] of liscie(lng)) {
        if (!tresc.includes("{{count}}")) continue;
        const nazwa = sciezka.split(".").pop() ?? "";
        if (nazwa !== bazaLiczebnika(nazwa)) continue;
        if (sciezka in BEZ_LICZEBNIKA) continue;
        bezForm.push(`${lng}: ${sciezka}`);
      }
    }
    expect(
      [...new Set(bezForm)].sort(),
      "napis wstawia liczbę w zdanie z JEDNĄ formą mnogą (1 liczb nie ma...). " +
        "Rozpisz na `_one`/`_few`/`_many` (pl) i `_one`/`_other` (en) albo " +
        "dopisz powód do BEZ_LICZEBNIKA",
    ).toEqual([]);
  });

  it("klucz rozpisany na formy ma pojedynczą ORAZ mnogą - w obu językach", () => {
    // Sam `_one` jest połową wdrożenia: przy dwóch i więcej i18next nie
    // znajdzie formy i wypisze na stronie surową ścieżkę klucza.
    const polowiczne: string[] = [];
    for (const lng of JEZYKI) {
      const mapa = liscie(lng);
      const bazy = new Set<string>();
      for (const sciezka of mapa.keys()) {
        const nazwa = sciezka.split(".").pop() ?? "";
        if (nazwa === bazaLiczebnika(nazwa)) continue;
        bazy.add(sciezka.replace(/\.[^.]+$/, `.${bazaLiczebnika(nazwa)}`));
      }
      for (const baza of bazy) {
        const ma = (s: string) => mapa.has(`${baza}_${s}`);
        const mnoga = SUFIKSY_LICZEBNIKA.some((s) => s !== "one" && ma(s));
        if (!ma("one") || !mnoga) polowiczne.push(`${lng}: ${baza}`);
      }
    }
    expect(
      polowiczne.sort(),
      "klucz liczebnikowy bez formy pojedynczej albo bez mnogiej - i18next " +
        "wypisze wtedy surową ścieżkę klucza pod wykresem",
    ).toEqual([]);
  });

  it("BEZ_LICZEBNIKA nie zbiera martwych wpisów", () => {
    // Wyjątek dla klucza, którego już nie ma, wygląda w recenzji jak decyzja,
    // a jest śladem po usuniętym napisie - i przy okazji przepuszcza nowy
    // napis, gdyby ktoś nazwał go tak samo.
    const wszystkie = new Set([...liscie("pl").keys(), ...liscie("en").keys()]);
    const martwe = Object.keys(BEZ_LICZEBNIKA).filter((k) => !wszystkie.has(k));
    expect(martwe, "wpis BEZ_LICZEBNIKA wskazuje klucz, którego nie ma w słowniku").toEqual([]);
  });

  it("polszczyzna i angielszczyzna zgadzają się co do liczby - sprawdzenie na treści", () => {
    // Sprawdzenie KOŃCOWE, po i18next: nie „czy klucze istnieją", tylko „co
    // zobaczy czytelnik". Trzy liczby, trzy zdania, żadne nie powtarza formy
    // sąsiada tam, gdzie gramatyka ją różnicuje.
    const klucz = "charts.fan.honesty.droppedValues";
    const pl = [1, 2, 5].map((count) => String(i18n.t(klucz, { lng: "pl", count })));
    expect(pl[0]).toContain("1 liczba nie trafiła");
    expect(pl[1]).toContain("2 liczby nie trafiły");
    expect(pl[2]).toContain("5 liczb nie trafiło");
    expect(new Set(pl).size, "trzy liczby dały mniej niż trzy zdania").toBe(3);

    const en = [1, 2].map((count) => String(i18n.t(klucz, { lng: "en", count })));
    expect(en[0]).toContain("1 number is neither");
    expect(en[1]).toContain("2 numbers are neither");
  });
});
