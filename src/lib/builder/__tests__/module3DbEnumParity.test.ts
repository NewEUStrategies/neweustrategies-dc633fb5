// BRAMKA: stale klienta MODULU 3 zgadzaja sie z ograniczeniami CHECK w bazie.
//
// Wzorzec przeniesiony z `src/lib/events/__tests__/dbEnumParity.test.ts`, ktory
// w module wydarzen wylapal trzy realne rozjazdy. Zadanie wskazalo kandydatow
// tutaj wprost: typy blokow, typy widgetow, statusy stron, warianty slidera.
//
// PO CO, czyli czego kompilator NIE ZOBACZY. Kolumny wyliczeniowe tego modulu
// sa typu `text` z ograniczeniem CHECK, wiec typ generowany z bazy to `string`
// (patrz `takeaways_variant: string | null` w integrations/supabase/types.ts).
// Panel moze wiec oferowac wartosc, ktorej baza nie przyjmie, i nikt tego nie
// zauwazy do pierwszego naruszenia ograniczenia u redaktora.
//
// ── DOMKNIECIE ZNANEJ LUKI WZORCA ─────────────────────────────────────────────
// Wzorzec z modulu wydarzen ma udokumentowana slepa plamke: NIE WIDZI kolumn
// nullowalnych zapisanych jako `CHECK (kol IS NULL OR ...)`. Jego regex wymaga
// trzech rzeczy naraz - nazwanego ograniczenia (`CONSTRAINT <nazwa>`), nazwy
// zaczynajacej sie od `event_`, oraz formy `kol IN (...)` BEZ zadnego przedrostka.
//
// W tym module najciekawsze ograniczenie lamie DWA z tych trzech zalozen:
//
//   ALTER TABLE public.pages ADD COLUMN IF NOT EXISTS takeaways_variant TEXT NULL
//     CHECK (takeaways_variant IS NULL OR takeaways_variant IN ('card','heading','ghost'));
//
// jest NIENAZWANE i ma przedrostek `IS NULL OR`. Tamta bramka przeszlaby po nim
// bez sladu. Parser nizej obsluguje wiec: nazwane i nienazwane ograniczenia,
// przedrostek `IS NULL OR`, obie formy zbioru (`IN (...)` oraz
// `= ANY (ARRAY[...])`) i dowolna wielkosc liter - bo repozytorium uzywa
// wszystkich tych wariantow (`check (scope in (...))` malymi literami,
// `ADD CONSTRAINT pages_template_type_check CHECK (...)` wielkimi).
//
// STAN NA DZIS: wszystkie trzy pary sa ZGODNE. Ta bramka nie zglasza wiec
// defektu - ona go NIE DOPUSZCZA w przyszlosci. To jest jej cala wartosc:
// trzy pary trzymaja sie dzis na komentarzach, a komentarz nie jest bramka.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { PAGE_TEMPLATES } from "@/lib/pageTemplates";
import { WIDGETS } from "@/lib/builder/registry";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

/** Zbior wartosci dopuszczonych przez CHECK na danej kolumnie danej tabeli. */
interface ColumnCheck {
  readonly table: string;
  readonly column: string;
  readonly values: ReadonlySet<string>;
  readonly nullable: boolean;
}

/**
 * Czyta CHECK-i wyliczeniowe z CALEGO lancucha migracji, w kolejnosci plikow.
 * PoZNIEJSZA definicja wygrywa - dokladnie tak, jak przy `supabase db push`;
 * tabele tego repozytorium sa czesto tworzone dwa razy (plik opisowy + migracja
 * panelu z UUID-em w nazwie) i obowiazuje ta druga.
 *
 * Klucz mapy to `tabela.kolumna`, nie nazwa ograniczenia - wlasnie dlatego, ze
 * czesc ograniczen tego modulu jest NIENAZWANA.
 */
function columnChecks(): Map<string, ColumnCheck> {
  const out = new Map<string, ColumnCheck>();
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  // Tabela z ostatniego `ALTER TABLE`/`CREATE TABLE` - potrzebna, bo przy
  // nienazwanym CHECK-u w definicji kolumny nazwa tabeli stoi kilka linii wyzej.
  const tableRe = /(?:ALTER|CREATE)\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?([a-z0-9_]+)/gi;
  // `kol IN ('a','b')` albo `kol = ANY (ARRAY['a','b'])`, z opcjonalnym
  // przedrostkiem `kol IS NULL OR` i opcjonalnymi nawiasami wokol calosci.
  const checkRe =
    /CHECK\s*\(\s*\(?\s*(?:([a-z0-9_]+)\s+IS\s+NULL\s+OR\s+)?\(?\s*([a-z0-9_]+)\s*(?:IN|=\s*ANY)\s*\(\s*(?:ARRAY\s*\[)?([^)\]]*)/gi;

  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    // Skanujemy statement po statemencie, zeby przypisac CHECK do wlasciwej tabeli.
    for (const stmt of sql.split(";")) {
      const tables = Array.from(stmt.matchAll(tableRe), (m) => m[1].toLowerCase());
      const table = tables.length > 0 ? tables[0] : null;
      if (table === null) continue;
      for (const m of stmt.matchAll(checkRe)) {
        const nullable = m[1] !== undefined;
        const column = m[2].toLowerCase();
        const values = m[3]
          .split(",")
          .map((v) => v.trim().replace(/::text$/i, "").replace(/^'|'$/g, "").trim())
          .filter((v) => v.length > 0 && !v.includes("("));
        if (values.length === 0) continue;
        out.set(`${table}.${column}`, { table, column, values: new Set(values), nullable });
      }
    }
  }
  return out;
}

const CHECKS = columnChecks();

function dbValues(key: string): ColumnCheck {
  const found = CHECKS.get(key);
  if (found === undefined) {
    throw new Error(
      `Nie znaleziono CHECK-u dla ${key} w supabase/migrations. ` +
        `Jesli kolumna albo tabela zostala przemianowana, popraw mapowanie w tej bramce.`,
    );
  }
  return found;
}

/** Warianty listy „takeaways" deklarowane przez panel - w DWOCH miejscach. */
const TAKEAWAYS_VARIANTS = ["card", "heading", "ghost"] as const;

describe("bramka: stale MODULU 3 vs CHECK-i bazy", () => {
  it("parser widzi ograniczenia (test nie jest prozny)", () => {
    expect(CHECKS.size).toBeGreaterThan(20);
    expect(CHECKS.has("pages.template_type")).toBe(true);
  });

  // ── To jest ta asercja, ktorej wzorzec z modulu wydarzen NIE UMIALBY napisac ──
  it("widzi NULLOWALNY CHECK w formie `kol IS NULL OR kol IN (...)` - luka wzorca domknieta", () => {
    const pages = dbValues("pages.takeaways_variant");
    expect(pages.nullable).toBe(true);
    expect([...pages.values].sort()).toEqual(["card", "ghost", "heading"]);
  });

  it("warianty takeaways panelu zgadzaja sie z baza - dla stron I dla wpisow", () => {
    // Ta sama kolumna jest dodana dwiema instrukcjami w jednej migracji
    // (posts i pages). Rozjazd miedzy nimi tez jest defektem, wiec obie sa tu.
    for (const key of ["pages.takeaways_variant", "posts.takeaways_variant"]) {
      expect([...dbValues(key).values].sort()).toEqual([...TAKEAWAYS_VARIANTS].sort());
    }
  });

  it("szablony stron panelu zgadzaja sie z CHECK-iem pages.template_type", () => {
    const db = dbValues("pages.template_type");
    const client = PAGE_TEMPLATES.map((t) => t.id).sort();
    expect(client).toEqual([...db.values].sort());
  });

  it("CHECK pages.template_type NIE jest nullowalny - `default` jest wartoscia, nie NULL-em", () => {
    // Odwrotny kierunek: gdyby ktos dopisal `IS NULL OR`, kolumna zaczelaby
    // przyjmowac NULL, a `findPageTemplate` dostaje wtedy `null` i wpada
    // w galaz fallbacku. Rozroznienie „brak szablonu" vs „szablon default"
    // ma tu znaczenie i dlatego jest przypiete.
    expect(dbValues("pages.template_type").nullable).toBe(false);
  });

  it("zakres builder_templates.scope jest tym, co panel zapisuje", () => {
    // Pierwsza migracja dopuszczala WYLACZNIE 'section' i zostala poszerzona
    // dopiero nastepna - to jest dokladnie ten przypadek „ostatnia definicja
    // wygrywa", dla ktorego parser czyta caly lancuch, a nie jeden plik.
    expect([...dbValues("builder_templates.scope").values].sort()).toEqual([
      "page",
      "section",
      "widget",
    ]);
  });
});

// ── Parytet rejestru widgetow z dyspozytorem renderera ───────────────────────
// Widgety NIE maja CHECK-u w bazie (dokument buildera to JSON), wiec baza nie
// jest tu strona umowy. Umowa jest miedzy REJESTREM (paleta, ktora widzi
// redaktor) i DYSPOZYTOREM (switch, ktory renderuje czytelnikowi) - i rozjazd
// miedzy nimi ma dokladnie ten sam skutek co rozjazd z baza: redaktor wstawia
// widget, ktorego czytelnik nie zobaczy.
//
// Ta sama klasa defektu jest juz UDOWODNIONA po stronie blokow: `link-preview`
// jest w IMPLEMENTED_BLOCKS, a nie ma go w switchu edytorow
// (patrz src/components/admin/blocks/__tests__/blockEditorRegistryParity.test.ts).
// Tutaj sprawdzam, czy widgety nie maja tej samej dziury.
const WIDGET_VIEW = "src/components/builder/organisms/WidgetView.tsx";
const SIMPLE_WIDGETS = "src/components/builder/organisms/widget-view/SimpleWidgets.tsx";

function switchCases(path: string): Set<string> {
  const src = readFileSync(path, "utf8");
  return new Set(Array.from(src.matchAll(/case "([a-z0-9-]+)":/g), (m) => m[1]));
}

describe("parytet rejestru widgetow z dyspozytorem renderera", () => {
  it("kazdy typ z palety jest obslugiwany przez jeden z dwoch switchy", () => {
    // Dyspozytor jest DWUSTOPNIOWY: renderSimpleWidget (SimpleWidgets) probuje
    // pierwszy i zwraca `undefined` jako sentinel, a wtedy WidgetView wchodzi
    // z wlasnym switchem. Typ obsluzony w KTORYMKOLWIEK z nich jest renderowany.
    const handled = new Set([...switchCases(WIDGET_VIEW), ...switchCases(SIMPLE_WIDGETS)]);
    const missing = WIDGETS.map((w) => w.type).filter((type) => !handled.has(type));
    expect(missing).toEqual([]);
  });

  it("zaden switch nie renderuje typu, ktorego paleta nie oferuje", () => {
    const offered = new Set<string>(WIDGETS.map((w) => w.type));
    // `item` to klucz ZAGNIEZDZONY (element listy), nie pozycja palety -
    // jedyny udokumentowany wyjatek.
    const handled = [...switchCases(WIDGET_VIEW), ...switchCases(SIMPLE_WIDGETS)];
    const extra = handled.filter((type) => !offered.has(type) && type !== "item").sort();
    expect(extra).toEqual([]);
  });
});
