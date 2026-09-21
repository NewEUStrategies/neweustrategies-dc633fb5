// Bramka: NAZWY IKON W KONFIGURACJI CHROME ⊆ ZESTAW KURATOROWANY.
//
// ── CO DOKŁADNIE POSZŁO NIE TAK (F24, §8 wiersz 3.14 audytu CWV) ────────────
// `DynamicIcon` renderuje synchronicznie zestaw kuratorowany (nazwane importy
// z `lucide-react`, więc tree-shaking bierze tylko użyte ikony), a dla nazwy
// SPOZA zestawu dociąga Reactowym `lazy()` pełny rejestr:
// `src/lib/icons/lucideIconNodes.generated.ts` - 473 KB źródeł, 109,1 KB gzip.
// Ten komponent renderuje CHROME: `SiteMenu`, `MegaPanelView`, mobilny pasek
// dolny, kafelki podstron wydarzenia. Nazwy ikon w tych miejscach nie są
// wpisane w kodzie - przychodzą z KONFIGURACJI (`site_settings`, `menu_items`,
// `event_pages`), czyli z panelu administracyjnego.
//
// Wynika z tego usterka o nietypowym kształcie: JEDNA literówka redaktora
// (albo jedna nazwa, której zestaw nie pokrywa) ściąga 109 KB gzip KAŻDEMU
// ANONIMOWI na stronie publicznej - i to nie w tle, tylko na ścieżce renderu
// nagłówka. Nic w repozytorium tego nie mierzyło, bo konfiguracja żyje w
// bazie, a bramki czytają repozytorium.
//
// ── DLACZEGO BRAMKA CZYTA ŹRÓDŁA, SKORO NAZWY SĄ W BAZIE ───────────────────
// Bo baza jest KOPIĄ tego, co repozytorium jej podało, a czego nie podało -
// tego administrator nie zobaczy w panelu. W repozytorium mieszkają trzy
// rodzaje źródeł tych nazw i wszystkie trzy ta bramka czyta:
//   1. DOMYŚLNE KONFIGURACJE w kodzie (pasek dolny, presety menu konta,
//      szablony podstron wydarzenia, katalog ikon wątków klubowych),
//   2. MIGRACJE I SEED - `jsonb_build_object('icon', 'users-round', …)`
//      wsadzane do `site_settings`/`menu_items`, wartości domyślne kolumn
//      `icon` oraz wartości zapasowe w `COALESCE(p_payload->>'icon', …)`,
//   3. (pośrednio) OFERTA PICKERA - `LucideIconPicker` podaje wszystkie ~1500
//      nazw, więc sam nie może być listą zamkniętą; zamiast obcinać ofertę dla
//      treści, picker ZNAKUJE nazwy spoza zestawu (patrz komentarz w pickerze),
//      a tę bramkę interesują miejsca, gdzie nazwa jest już WPISANA.
//
// Skan znalazł przy wprowadzeniu (2026-09-20) dokładnie te naruszenia:
// `users-round` (pasek dolny, migracja 20260808120627), `Crown`, `Ticket`,
// `ShoppingCart`, `ShieldCheck` (presety menu konta), `clipboard-list`,
// `folder-open`, `calendar-clock` (szablony podstron wydarzenia) i
// `life-buoy` (domyślne powiadomienie, migracja 20260723140000). Migracji nie
// da się poprawić wstecz (są niezmienne, a ledger i replay tego pilnują),
// więc naprawa poszła drugą stroną: te dziewięć ikon dołączyło do zestawu
// kuratorowanego. Koszt - setki bajtów na ikonę - jest o trzy rzędy wielkości
// niższy od chunka, który wyzwalały.
//
// ── CZEGO TA BRAMKA NIE MIERZY (świadomie) ─────────────────────────────────
// TREŚCI i PANELU. Ikona w treści strony albo w edytorze MA PRAWO być
// egzotyczna - tam leniwy chunk płaci ktoś, kto właśnie wszedł w edytor, a nie
// anonim czytający stronę. Dlatego lista skanowanych plików jest JAWNA i żyje
// w `scripts/check-menu-icons.ts`; rozszerzenie jej jest decyzją, którą widać
// w diffie. Strony prawne mają własny, zamknięty rejestr (`lib/legal/icons.ts`)
// pilnowany osobnym testem - ta bramka jest tym samym pomysłem dla chrome.
//
// Warstwa wykonawcza (odczyt plików, kod wyjścia) żyje w
// `scripts/check-menu-icons.ts`; ten moduł jest czysty i ma test z KONTROLĄ
// NEGATYWNĄ (`src/lib/ci/__tests__/menuIcons.test.ts`) - dowód, że na zepsutym
// wejściu bramka OBLEWA, a nie tylko przebiega.
import { normalizeIconName } from "@/lib/icons/curatedIconNames";
import { bezKomentarzy } from "./sourceScan";

/** Plik poddany skanowi razem z powodem, dla którego jest w zakresie. */
export interface MenuIconSource {
  readonly file: string;
  readonly content: string;
  /** Po co ten plik jest w skanie - trafia wprost do raportu. */
  readonly reason?: string;
}

/** Jedno wystąpienie nazwy ikony w konfiguracji. */
export interface MenuIconOccurrence {
  readonly file: string;
  /** 1-indeksowana linia, żeby raport prowadził wprost do miejsca. */
  readonly line: number;
  /** Zapis ze źródła - `users-round`, `ShoppingCart`, `graduation cap`. */
  readonly raw: string;
  /** Postać kanoniczna (kebab), po której porównujemy z zestawem. */
  readonly name: string;
  /** Skąd wzorzec wziął nazwę - ułatwia ocenę fałszywego trafienia. */
  readonly kind: MenuIconMatchKind;
}

export type MenuIconMatchKind =
  /** `icon: "x"`, `iconName: "x"`, `icon="x"` w kodzie. */
  | "pole"
  /** `icons: ["a", "b"]` - katalog oferowany redakcji. */
  | "katalog"
  /** `const EVENT_PAGE_DEFAULT_ICON = "file-text"`. */
  | "stala"
  /** `jsonb_build_object('icon', 'users', …)` / `"icon":"users"` w SQL. */
  | "sql-payload"
  /** `COALESCE(p_payload->>'icon', ''), 'CalendarDays')` - wartość zapasowa. */
  | "sql-domyslna";

export interface MenuIconReport {
  /** Liczność zestawu kuratorowanego - liczba kontrolna wejścia. */
  readonly curatedCount: number;
  readonly scannedFiles: number;
  /** Wszystkie znalezione nazwy (także poprawne) - liczba kontrolna skanu. */
  readonly occurrences: readonly MenuIconOccurrence[];
  /** Nazwy spoza zestawu - każda z nich to leniwy chunk w chrome. */
  readonly violations: readonly MenuIconOccurrence[];
}

/**
 * Maskowanie komentarzy SQL - liniowych (dwa dywizy) i blokowych - z
 * pominięciem tego, co siedzi w apostrofach (w migracjach pełno napisów
 * z dywizami w środku, choćby same nazwy ikon).
 * Długość tekstu i numeracja linii zostają nietknięte - tak samo jak w
 * `bezKomentarzy` dla TypeScriptu - więc raport wskazuje linię, którą człowiek
 * otworzy w edytorze.
 *
 * Tryb awarii jest tu istotny: komentarz potraktowany jak kod daje FAŁSZYWY
 * ALARM (głośny, natychmiast widoczny), a napis potraktowany jak komentarz -
 * zgubioną nazwę, czyli CICHĄ ZIELEŃ. Dlatego apostrof ma pierwszeństwo.
 */
export function bezKomentarzySql(src: string): string {
  const out: string[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];

    if (c === "'") {
      out.push(c);
      i += 1;
      while (i < src.length) {
        out.push(src[i]);
        // `''` w środku napisu to apostrof, a nie jego koniec.
        if (src[i] === "'" && src[i + 1] === "'") {
          out.push(src[i + 1]);
          i += 2;
          continue;
        }
        if (src[i] === "'") {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }

    if (c === "-" && src[i + 1] === "-") {
      while (i < src.length && src[i] !== "\n") {
        out.push(" ");
        i += 1;
      }
      continue;
    }

    if (c === "/" && src[i + 1] === "*") {
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) {
        out.push(src[i] === "\n" ? "\n" : " ");
        i += 1;
      }
      out.push(" ", " ");
      i += 2;
      continue;
    }

    out.push(c);
    i += 1;
  }
  return out.join("");
}

/** `icon: "x"`, `iconName: "x"`, `icon="x"` (atrybut JSX). */
const TS_POLE = /\b(?:icon|iconName|defaultIcon)\s*[:=]\s*(["'])([^"'\n]{1,64})\1/g;
/** `icons: [ "a", "b", … ]` - katalog oferowany w edytorze, także wielolinijkowy. */
const TS_KATALOG = /\bicons\s*:\s*\[([^\]]*)\]/g;
/** `const EVENT_PAGE_DEFAULT_ICON = "file-text"` - stała z nazwą w nazwie. */
const TS_STALA = /\b[A-Z][A-Z0-9_]*ICON[A-Z0-9_]*\s*(?::[^=\n]{0,48})?=\s*(["'])([^"'\n]{1,64})\1/g;
/** Napis w katalogu - wyciągany z wnętrza nawiasu kwadratowego. */
const NAPIS = /(["'])([^"'\n]{1,64})\1/g;

/** `jsonb_build_object('icon', 'users')` oraz `'icon', 'users'` w sekwencji. */
const SQL_PARA = /'icon'\s*,\s*'([^'\n]{0,64})'/g;
/** `"icon":"users"` - payload zapisany jako literał JSON-a. */
const SQL_JSON = /"icon"\s*:\s*"([^"\n]{0,64})"/g;
/** `COALESCE(NULLIF(btrim(p_payload->>'icon'), ''), 'CalendarDays')`. */
const SQL_DOMYSLNA = /->>\s*'icon'[^\n]{0,80}?,\s*'([A-Za-z][A-Za-z0-9 _-]{0,63})'\s*\)/g;
/** `icon text NOT NULL DEFAULT 'MessagesSquare'` - domyślna wartość kolumny. */
const SQL_KOLUMNA = /\bicon\s+text\b[^\n]{0,80}?\bDEFAULT\s+'([^'\n]{0,64})'/gi;

/** Numer linii (1-indeksowany) dla przesunięcia w tekście. */
function lineAt(src: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < src.length; i += 1) if (src[i] === "\n") line += 1;
  return line;
}

function pushMatches(
  out: MenuIconOccurrence[],
  file: string,
  src: string,
  re: RegExp,
  group: number,
  kind: MenuIconMatchKind,
): void {
  re.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(src)) !== null) {
    const raw = match[group];
    if (!raw) continue;
    const name = normalizeIconName(raw);
    // Pusty zapis znaczy „bez ikony" (tak wygląda nowy wiersz menu) - to nie
    // jest nazwa, więc nie ma czego porównywać z zestawem.
    if (!name) continue;
    out.push({ file, line: lineAt(src, match.index), raw, name, kind });
  }
}

/**
 * Nazwy ikon w jednym pliku. Rozszerzenie decyduje o zestawie wzorców: `.sql`
 * czytamy jak payload migracji, resztę jak kod TypeScriptu.
 *
 * Eksport jest publiczny, bo to on jest przedmiotem testu jednostkowego -
 * raport bramki bada się potem na gotowych wystąpieniach.
 */
export function collectIconNames(source: MenuIconSource): MenuIconOccurrence[] {
  const out: MenuIconOccurrence[] = [];
  const sql = source.file.endsWith(".sql");
  const src = sql ? bezKomentarzySql(source.content) : bezKomentarzy(source.content);

  if (sql) {
    pushMatches(out, source.file, src, SQL_PARA, 1, "sql-payload");
    pushMatches(out, source.file, src, SQL_JSON, 1, "sql-payload");
    pushMatches(out, source.file, src, SQL_DOMYSLNA, 1, "sql-domyslna");
    pushMatches(out, source.file, src, SQL_KOLUMNA, 1, "sql-domyslna");
    return out;
  }

  pushMatches(out, source.file, src, TS_POLE, 2, "pole");
  pushMatches(out, source.file, src, TS_STALA, 2, "stala");

  TS_KATALOG.lastIndex = 0;
  let katalog: RegExpExecArray | null;
  while ((katalog = TS_KATALOG.exec(src)) !== null) {
    const offset = katalog.index + katalog[0].indexOf("[") + 1;
    const wnetrze = katalog[1];
    NAPIS.lastIndex = 0;
    let napis: RegExpExecArray | null;
    while ((napis = NAPIS.exec(wnetrze)) !== null) {
      const name = normalizeIconName(napis[2]);
      if (!name) continue;
      out.push({
        file: source.file,
        line: lineAt(src, offset + napis.index),
        raw: napis[2],
        name,
        kind: "katalog",
      });
    }
  }
  return out;
}

export function analyzeMenuIcons(input: {
  readonly curated: readonly string[];
  readonly sources: readonly MenuIconSource[];
}): MenuIconReport {
  const curated = new Set(input.curated.map((name) => normalizeIconName(name)).filter(Boolean));
  const occurrences = input.sources.flatMap((source) => collectIconNames(source));
  return {
    curatedCount: curated.size,
    scannedFiles: input.sources.length,
    occurrences,
    violations: occurrences.filter((occurrence) => !curated.has(occurrence.name)),
  };
}

export function menuIconsFailed(report: MenuIconReport): boolean {
  return report.violations.length > 0;
}

export function renderMenuIconReport(report: MenuIconReport): string {
  const naglowek =
    `[menu-icons] zestaw kuratorowany: ${report.curatedCount} ikon; ` +
    `przeskanowano ${report.scannedFiles} plików konfiguracji, ` +
    `znaleziono ${report.occurrences.length} nazw ikon.`;

  if (report.violations.length === 0) {
    return `✓ ${naglowek}\n  Każda nazwa renderuje się synchronicznie - chrome nie dociąga rejestru ikon.`;
  }

  const wiersze = report.violations.map(
    (v) => `  ✗ ${v.file}:${v.line} [${v.kind}] "${v.raw}" -> "${v.name}" (spoza zestawu)`,
  );
  return [
    `✗ ${naglowek}`,
    `  ${report.violations.length} nazw spoza zestawu kuratorowanego.`,
    "",
    ...wiersze,
    "",
    "  Każda z tych nazw każe `DynamicIcon` dociągnąć PEŁNY rejestr ikon",
    "  (src/lib/icons/lucideIconNodes.generated.ts: 473 KB źródeł, 109 KB gzip)",
    "  w chrome strony publicznej - czyli u każdego anonima, nie tylko w panelu.",
    "",
    "  Lekarstwo, w kolejności od najtańszego:",
    "   1. poprawić nazwę w konfiguracji na ikonę z zestawu;",
    "   2. jeśli nazwa jest potrzebna (albo siedzi w migracji, której nie",
    "      wolno zmieniać wstecz) - dopisać ikonę do CURATED w",
    "      src/lib/icons/DynamicIcon.tsx ORAZ do CURATED_ICON_NAMES w",
    "      src/lib/icons/curatedIconNames.ts (parytet pilnuje test",
    "      src/lib/icons/__tests__/curatedIconNames.test.tsx);",
    "   3. jeśli plik NIE renderuje się w chrome - usunąć go z listy skanu w",
    "      scripts/check-menu-icons.ts, wpisując tam powód.",
  ].join("\n");
}
