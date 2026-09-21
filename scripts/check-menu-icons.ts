/**
 * Bramka NAZW IKON W CHROME: nazwa ikony, którą konfiguracja podaje menu,
 * paskowi dolnemu i kafelkom nawigacji, MUSI należeć do zestawu kuratorowanego
 * `DynamicIcon`. Nazwa spoza zestawu każe przeglądarce dociągnąć pełny rejestr
 * ikon (473 KB źródeł, 109 KB gzip) - u KAŻDEGO anonima, na ścieżce renderu
 * nagłówka. Przyczyna, pomiar i lista naruszeń znalezionych przy wprowadzeniu:
 * `src/lib/ci/menuIcons.ts`.
 *
 * Bramka czyta WYŁĄCZNIE ŹRÓDŁA - nie potrzebuje builda, artefaktu, bazy ani
 * przeglądarki - dlatego biegnie w jobie `verify`, a nie `build`, i jej wynik
 * jest identyczny na każdej maszynie.
 *
 * Cienki runner - inwariant i cała logika żyją w `src/lib/ci/menuIcons.ts`
 * (konwencja jak `check-ssr-budgets.ts`), dzięki czemu bramka ma TEST
 * JEDNOSTKOWY Z KONTROLĄ NEGATYWNĄ (`src/lib/ci/__tests__/menuIcons.test.ts`),
 * a nie tylko przebieg w CI.
 *
 * Usage: bun run check:menu-icons
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { CURATED_ICON_NAMES } from "../src/lib/icons/curatedIconNames";
import {
  analyzeMenuIcons,
  menuIconsFailed,
  renderMenuIconReport,
  type MenuIconSource,
} from "../src/lib/ci/menuIcons";

/**
 * ZAKRES JEST JAWNY, BO ZAKRES JEST DECYZJĄ. Każdy plik na tej liście podaje
 * nazwę ikony, którą renderuje `DynamicIcon` w CHROME - czyli tam, gdzie płaci
 * za nią czytelnik strony publicznej. Treść i panel administracyjny są POZA
 * listą świadomie: tam egzotyczna ikona jest poprawnym wyborem redaktora, a
 * leniwy chunk dociąga się komuś, kto właśnie otworzył edytor.
 *
 * Plik z tej listy, którego nie ma na dysku, PRZEWRACA bramkę. Bramka, której
 * źródło zniknęło (przeniesienie, zmiana nazwy), nie ma prawa zrobić się cicho
 * zielona - to jest dokładnie ten tryb awarii, dla którego bramki istnieją.
 */
const PLIKI_CHROME: readonly { readonly file: string; readonly reason: string }[] = [
  {
    file: "src/lib/mobileBottomBar/config.ts",
    reason: "Domyślne pozycje mobilnego paska dolnego - BottomBarTab renderuje je DynamicIcon-em.",
  },
  {
    file: "src/components/builder/organisms/widget-view/AccountMenuWidget.tsx",
    reason: "Presety menu konta w nagłówku - ikony pozycji panelu gościa i zalogowanego.",
  },
  {
    file: "src/lib/notifications/preferences.ts",
    reason: "Ikony kategorii powiadomień - dzwonek i centrum powiadomień siedzą w nagłówku.",
  },
  {
    file: "src/lib/events/eventPageTemplates.ts",
    reason: "Ikona POZYCJI MENU podstrony wydarzenia - EventMenuTiles rysuje ją publicznie.",
  },
  {
    file: "src/lib/events/eventPagesApi.ts",
    reason: "Zastępcza ikona pozycji menu wydarzenia (EVENT_PAGE_DEFAULT_ICON).",
  },
  {
    file: "src/lib/clubs/threadIcons.ts",
    reason: "Zamknięty katalog ikon wątków oferowany redakcji - musi mieścić się w zestawie.",
  },
];

/**
 * Katalogi, w których nazwa ikony może się DOPIERO POJAWIĆ. `src/lib/menus` to
 * miejsce reguł menu publicznego; dziś nie ma tam ani jednej nazwy wpisanej na
 * sztywno i właśnie dlatego katalog jest skanowany w całości - żeby pierwsza
 * wpisana nazwa trafiła pod bramkę bez czyjejkolwiek pamięci o tej liście.
 *
 * `supabase/migrations` i `supabase/seed.sql` są tu z mocniejszego powodu:
 * migracja WPISUJE nazwę do bazy, a baza jest jedynym źródłem ikon chrome.
 * Nazwa, która stamtąd wyjdzie, trafi do nagłówka niezależnie od tego, czy
 * ktoś o niej pamiętał.
 */
const KATALOGI = ["src/lib/menus", "supabase/migrations"] as const;
const PLIKI_DODATKOWE = ["supabase/seed.sql"] as const;

const SKIP_DIRS = new Set(["__tests__", "node_modules"]);

function walk(dir: string, out: string[]): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function rel(path: string): string {
  return relative(process.cwd(), path).replaceAll("\\", "/");
}

function collect(): MenuIconSource[] {
  const brakujace = PLIKI_CHROME.filter((entry) => !existsSync(entry.file));
  if (brakujace.length > 0) {
    console.error(
      [
        "✗ [menu-icons] pliki z listy skanu NIE ISTNIEJĄ - bramka nie ma czego mierzyć:",
        ...brakujace.map((entry) => `  - ${entry.file} (${entry.reason})`),
        "",
        "  Lekarstwo: zaktualizuj listę PLIKI_CHROME w scripts/check-menu-icons.ts",
        "  (przenieś wpis na nową ścieżkę albo usuń go razem z powodem).",
      ].join("\n"),
    );
    process.exit(1);
  }

  const sources: MenuIconSource[] = PLIKI_CHROME.map((entry) => ({
    file: entry.file,
    content: readFileSync(entry.file, "utf8"),
    reason: entry.reason,
  }));

  const skanowane: string[] = [];
  for (const dir of KATALOGI) {
    if (!existsSync(dir)) continue;
    walk(dir, skanowane);
  }
  for (const file of PLIKI_DODATKOWE) if (existsSync(file)) skanowane.push(file);

  for (const path of skanowane) {
    const file = rel(path);
    if (!/\.(tsx?|sql)$/.test(file) || file.endsWith(".d.ts")) continue;
    sources.push({
      file,
      content: readFileSync(file, "utf8"),
      reason: "Reguły menu publicznego / payload migracji trafiający do konfiguracji chrome.",
    });
  }
  return sources;
}

/**
 * PODŁOGA SKANU. Bramka statyczna psuje się najciszej wtedy, gdy przestaje
 * cokolwiek ZNAJDOWAĆ (zmiana zapisu konfiguracji, przeniesienie plików) - od
 * tej chwili świeci na zielono zawsze. Liczba znalezionych nazw przy
 * wprowadzeniu (2026-09-20) to 127; podłoga stoi wyraźnie niżej, żeby zwykłe
 * porządki w konfiguracji jej nie ruszały, ale utrata kotwicy parsera - czyli
 * spadek o kilkadziesiąt nazw naraz - już tak.
 */
const MINIMUM_ZNALEZIONYCH = 90;

function main(): void {
  const sources = collect();
  const report = analyzeMenuIcons({ curated: CURATED_ICON_NAMES, sources });
  const rendered = renderMenuIconReport(report);

  if (menuIconsFailed(report)) {
    console.error(rendered);
    process.exit(1);
  }

  if (report.occurrences.length < MINIMUM_ZNALEZIONYCH) {
    console.error(
      [
        `✗ [menu-icons] skan znalazł ${report.occurrences.length} nazw ikon, a minimum to ${MINIMUM_ZNALEZIONYCH}.`,
        "  To nie jest sukces, tylko podejrzenie, że wzorce przestały trafiać",
        "  (zmieniony zapis konfiguracji, przeniesione pliki) - bramka mierzyłaby wtedy pustkę.",
        "  Lekarstwo: sprawdź wzorce w src/lib/ci/menuIcons.ts i listę skanu w tym pliku.",
      ].join("\n"),
    );
    process.exit(1);
  }

  console.log(rendered);
}

main();
