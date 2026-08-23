// Bramka: trzy mapy etykiet panelu reklam muszą się domykać z JEDNEJ strony
// na drugą - z enumem PostgreSQL, z unią TypeScriptu i ze słownikiem PL/EN.
//
// PO CO ONA ISTNIEJE. `AD_POSITION_LABEL_KEYS` ma typ `Record<AdPosition, string>`,
// więc `tsc` pilnuje DOKŁADNIE jednej rzeczy: że każdy wariant unii `AdPosition`
// ma wpis. Nie pilnuje trzech pozostałych, a każda z nich psuje panel po cichu:
//
//   1. WARTOŚĆ MAPY TO KLUCZ, KTÓREGO NIE MA W SŁOWNIKU. `tsc` widzi `string`.
//      Panel renderuje `t("adsAdmin.positions.stickyRail")`, i18next nie znajduje
//      klucza, więc zwraca sam klucz - w tabeli rozmieszczenia pojawia się
//      „adsAdmin.positions.stickyRail" zamiast nazwy pozycji. Bramka parytetu
//      tego nie zobaczy: ona porównuje słowniki MIĘDZY SOBĄ, a klucz nie istnieje
//      w żadnym z nich, więc parytet jest zachowany.
//   2. UNIA TS ROZJECHAŁA SIĘ Z ENUMEM BAZY. `position` w `ad_placements` to
//      `public.ad_position` (typ ENUM, nie CHECK) - dodanie wariantu w migracji
//      jest legalne i nie wymaga zmiany w TypeScripcie. Wiersz z takim wariantem
//      wchodzi do bazy, a `AD_POSITION_LABEL_KEYS[placement.position]` daje
//      `undefined`; `t(undefined)` nie rzuca, tylko zwraca puste - w kolumnie
//      „Pozycja" pojawia się PUSTA KOMÓRKA. Redakcja widzi rozmieszczenie bez
//      pozycji i nie ma jak zgadnąć, czego dotyczy.
//   3. SŁOWNIK MA ETYKIETĘ, KTÓREJ NIKT NIE WOŁA. Wariant wypadł z enuma, a
//      etykieta została. To nie psuje panelu, ale rośnie i przy następnej
//      zmianie ktoś kopiuje martwy wzorzec.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Parytetu pl/en pilnuje
// `src/__tests__/i18nParity.gate.test.ts`, a rozjazdu kod<->słownik
// `i18nKeyDrift.gate.test.ts`. Tutaj chodzi o INNĄ relację: mapa etykiet stoi
// pomiędzy enumem bazy a słownikiem i musi pasować do obu naraz.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  AD_PAGE_TYPE_LABEL_KEYS,
  AD_POSITION_LABEL_KEYS,
  AD_SLOT_KIND_LABEL_KEYS,
} from "@/lib/ads/types";
import { adsAdminResources } from "@/lib/i18n-ads-admin";

const MIGRATIONS = "supabase/migrations";

/**
 * Etykiety enuma PostgreSQL zebrane ze WSZYSTKICH migracji: `CREATE TYPE ...
 * AS ENUM (...)` plus każde późniejsze `ALTER TYPE ... ADD VALUE`. Skan idzie
 * po całym katalogu, a nie po jednym znanym pliku, bo dodanie wariantu w nowej
 * migracji jest właśnie tym zdarzeniem, które ta bramka ma złapać.
 */
function sqlEnumLabels(typeName: string): string[] {
  const out: string[] = [];
  for (const file of readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    const sql = readFileSync(join(MIGRATIONS, file), "utf8");
    const created = new RegExp(
      String.raw`CREATE\s+TYPE\s+(?:public\.)?${typeName}\s+AS\s+ENUM\s*\(([^)]*)\)`,
      "gi",
    );
    for (const m of sql.matchAll(created)) {
      for (const lit of m[1].matchAll(/'([^']+)'/g)) out.push(lit[1]);
    }
    const added = new RegExp(
      String.raw`ALTER\s+TYPE\s+(?:public\.)?${typeName}\s+ADD\s+VALUE\s+(?:IF\s+NOT\s+EXISTS\s+)?'([^']+)'`,
      "gi",
    );
    for (const m of sql.matchAll(added)) out.push(m[1]);
  }
  return [...new Set(out)];
}

/** Rozwiązuje ścieżkę „a.b.c" w drzewie słownika. `undefined` = brak klucza. */
function leaf(tree: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((node, part) => {
    if (node === null || typeof node !== "object") return undefined;
    return (node as Record<string, unknown>)[part];
  }, tree);
}

/** Nazwy liści bezpośrednio pod „adsAdmin.<section>" w danym języku. */
function sectionLeaves(lang: "pl" | "en", section: string): string[] {
  const node = leaf(adsAdminResources[lang], `adsAdmin.${section}`);
  if (node === null || typeof node !== "object") return [];
  return Object.keys(node as Record<string, unknown>);
}

const MAPY = [
  {
    nazwa: "AD_POSITION_LABEL_KEYS",
    mapa: AD_POSITION_LABEL_KEYS as Record<string, string>,
    sekcja: "positions",
    enumSql: "ad_position",
    kolumna: "ad_placements.position",
  },
  {
    nazwa: "AD_PAGE_TYPE_LABEL_KEYS",
    mapa: AD_PAGE_TYPE_LABEL_KEYS as Record<string, string>,
    sekcja: "pageTypes",
    enumSql: "ad_page_type",
    kolumna: "ad_placements.page_type",
  },
  {
    nazwa: "AD_SLOT_KIND_LABEL_KEYS",
    mapa: AD_SLOT_KIND_LABEL_KEYS as Record<string, string>,
    sekcja: "kinds",
    enumSql: "ad_slot_kind",
    kolumna: "ad_slots.kind",
  },
] as const;

describe("bramka etykiet panelu reklam: enum bazy -> unia TS -> słownik PL/EN", () => {
  it.each(MAPY)(
    "$nazwa: każda wartość mapy istnieje jako niepusty napis w PL I w EN",
    ({ mapa }) => {
      const braki: string[] = [];
      for (const [wariant, klucz] of Object.entries(mapa)) {
        for (const lang of ["pl", "en"] as const) {
          const wartosc = leaf(adsAdminResources[lang], klucz);
          if (typeof wartosc !== "string" || wartosc.trim() === "") {
            braki.push(`${lang}: ${wariant} -> ${klucz} = ${JSON.stringify(wartosc)}`);
          }
        }
      }
      expect(braki).toEqual([]);
    },
  );

  it.each(MAPY)("$nazwa: wartości są KLUCZAMI słownika, nie gotowymi napisami", ({ mapa }) => {
    // Regresja, którą ten plik ma zatrzymać, jest historyczna: te trzy mapy
    // trzymały polskie napisy wprost do 12.08 i panel był jednojęzyczny.
    // Napis rozpoznajemy po spacji albo po polskim znaku diakrytycznym -
    // klucz i18next ich nie zawiera.
    const podejrzane = Object.entries(mapa).filter(
      ([, v]) => !v.startsWith("adsAdmin.") || /[\s ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/.test(v),
    );
    expect(podejrzane).toEqual([]);
  });

  it.each(MAPY)(
    "$nazwa: warianty mapy pokrywają enum $enumSql z migracji CO DO JEDNEGO",
    ({ mapa, enumSql, kolumna }) => {
      const wSql = sqlEnumLabels(enumSql);
      // Kanarek skanu: gdy regex przestanie łapać składnię migracji, zbiór
      // będzie pusty i porównanie „zaliczyłoby się" na dwóch pustkach.
      expect(wSql.length, `skan migracji nie znalazł enuma ${enumSql}`).toBeGreaterThan(2);
      expect(
        { kolumna, brakujeWTs: wSql.filter((v) => !(v in mapa)).sort() },
        `wariant enuma bez etykiety = PUSTA KOMÓRKA w panelu dla ${kolumna}`,
      ).toEqual({ kolumna, brakujeWTs: [] });
      expect(
        Object.keys(mapa)
          .filter((v) => !wSql.includes(v))
          .sort(),
        `etykieta dla wariantu, którego baza nie przyjmie (${kolumna})`,
      ).toEqual([]);
    },
  );

  it.each(MAPY)("sekcja adsAdmin.$sekcja nie ma etykiet-sierot", ({ mapa, sekcja }) => {
    const wolane = new Set(Object.values(mapa).map((k) => k.split(".").at(-1)));
    for (const lang of ["pl", "en"] as const) {
      const sieroty = sectionLeaves(lang, sekcja).filter((k) => !wolane.has(k));
      expect(sieroty, `${lang}: adsAdmin.${sekcja} ma etykiety, których nikt nie woła`).toEqual([]);
    }
  });

  it("PL i EN naprawdę się różnią - a wyjątki są DECYZJĄ, nie przypadkiem", () => {
    // Bez tej asercji bramka przechodziłaby na słowniku, w którym `en` to
    // wklejone polskie napisy - czyli dokładnie na stanie sprzed 12.08, tylko
    // przepuszczonym przez `t()`.
    //
    // Wyjątki są WYLICZONE, a nie objęte progiem liczbowym („wszystkie minus
    // dwa"). Próg przepuściłby dowolne dwa zapomniane tłumaczenia; lista
    // wymusza, żeby każdy nowy przypadek tożsamości ktoś tutaj dopisał i tym
    // samym uzasadnił.
    const TE_SAME_W_OBU_JEZYKACH = new Set(["adsAdmin.positions.sidebar"]);
    const tozsame = MAPY.flatMap(({ mapa }) => Object.values(mapa)).filter(
      (klucz) =>
        !TE_SAME_W_OBU_JEZYKACH.has(klucz) &&
        leaf(adsAdminResources.pl, klucz) === leaf(adsAdminResources.en, klucz),
    );
    expect(tozsame).toEqual([]);
  });

  it("wyjątki z listy tożsamości NAPRAWDĘ są tożsame - lista nie zbiera martwych wpisów", () => {
    // Druga strona tej samej reguły: wyjątek, który przestał być potrzebny
    // (bo ktoś przetłumaczył „Sidebar"), ma zniknąć z listy, a nie zostać
    // w niej jako cichy zawór na przyszłość.
    expect(leaf(adsAdminResources.pl, "adsAdmin.positions.sidebar")).toBe(
      leaf(adsAdminResources.en, "adsAdmin.positions.sidebar"),
    );
  });

  it("kanarek zasięgu: trzy mapy są niepuste i mają razem 18 wariantów", () => {
    // Gdy ktoś opróżni mapę albo przeniesie ją pod inną nazwę, wszystkie
    // asercje `it.each` powyżej zaliczyłyby się na zbiorach pustych.
    const liczby = MAPY.map(({ nazwa, mapa }) => [nazwa, Object.keys(mapa).length] as const);
    expect(liczby).toEqual([
      ["AD_POSITION_LABEL_KEYS", 7],
      ["AD_PAGE_TYPE_LABEL_KEYS", 8],
      ["AD_SLOT_KIND_LABEL_KEYS", 3],
    ]);
  });
});
