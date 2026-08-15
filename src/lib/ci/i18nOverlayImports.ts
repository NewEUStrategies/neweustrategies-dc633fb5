// Inwariant CI: KTO WOŁA KLUCZ Z NAKŁADKI, TEN MUSI TĘ NAKŁADKĘ ZAIMPORTOWAĆ.
//
// ── PRZYCZYNA ŹRÓDŁOWA ──────────────────────────────────────────────────────
// Słowniki modułowe (`src/lib/i18n-*.ts`) rejestrują się EFEKTEM UBOCZNYM
// importu:
//
//     i18n.addResourceBundle("pl", "translation", pl, true, true);
//
// Nikt ich nie ładuje z góry - dopóki żaden zaimportowany moduł nie wciągnie
// pliku nakładki, jej klucze po prostu nie istnieją w instancji i18next.
// A i18next na brak klucza NIE rzuca wyjątkiem: zwraca sam klucz. Ekran
// renderuje się poprawnie, tyle że zamiast „Zaproś użytkownika" pokazuje
// `adminUsers.inviteUser`.
//
// To defekt niewidoczny dla całej reszty warstwy kontrolnej repo:
//   * `tsc` nie widzi nic - `t()` przyjmuje `string` i zwraca `string`;
//   * `check:i18n-parity` porównuje ZAWARTOŚĆ słowników, więc klucz jest tam
//     obecny w obu językach i parytet wychodzi zielony;
//   * `check:i18n-hardcoded` liczy napisy w kodzie - po konwersji jest ich
//     zero, więc ratchet też jest zielony;
//   * `check:i18n-default-value` sprawdza teksty zapasowe, których tu nie ma.
//
// Wszystkie bramki świecą na zielono nad ekranem pokazującym użytkownikowi
// surowe identyfikatory kluczy. Defekt złapał dopiero człowiek patrzący na
// diff - dwa razy w ciągu jednej sesji konwersji. Za każdym razem powód był
// ten sam i całkowicie mechaniczny: klucze wstawia codemod, a linijkę
// `import "@/lib/i18n-…"` dopisuje się ręcznie.
//
// ── DLACZEGO PEŁNY KLUCZ, A NIE PRZESTRZEŃ NAZW ────────────────────────────
// Pierwsza wersja pytała o przestrzeń (pierwszy człon klucza) i była nie do
// użycia: nakładki DOPISUJĄ gałęzie do przestrzeni rdzennych. `i18n-admin-users`
// wnosi `admin.users.roles.*` do przestrzeni `admin`, której właścicielem jest
// rdzeń (`src/lib/locale/pl.ts`) - więc każdy z kilkudziesięciu ekranów
// wołających zwykłe `t("admin.…")` wyglądał na wadliwy. Granulacja pełnego
// klucza rozróżnia te dwa przypadki dokładnie: pytamy tylko o klucze, których
// rdzeń NIE MA, bo tylko one giną razem z brakującym importem.
//
// ── DLACZEGO RATCHET, A NIE PRÓG ZERO ──────────────────────────────────────
// Pierwszy pomiar na repo dał 82 pliki. Wszystkie DZIAŁAJĄ - klucz dociera do
// nich importem POŚREDNIM (inny moduł w tym samym chunku wciąga nakładkę), więc
// to nie 82 zepsute ekrany, tylko 82 zależności trzymające się przypadkiem.
// Dopisanie tam importu wprost nie jest jednak automatycznie darmowe: przesuwa
// słownik do chunka, w którym stoi plik. Repo ma trzy udokumentowane miejsca,
// gdzie import ŚWIADOMIE pominięto właśnie z tego powodu - słownik buildera waży
// ~101 KB źródła i nie ma go po co wciągać do chunka wejściowego publicznego
// chrome (`Editable.tsx`, `widget-view/resizeWrappers.tsx`,
// `routes/admin.performance.tsx`).
//
// Dlatego jak przy `check:i18n-hardcoded` i `check:unknown-casts`: ratchet per
// plik. NOWY plik musi mieć import wprost - a to właśnie nowe pliki wychodzą
// spod codemodu i to w nich defekt powstawał. Zdejmowanie pozycji z baseline'u
// zostaje decyzją świadomą, podejmowaną razem z oceną wpływu na chunk.
//
// Miejsce, w którym pominięcie jest CELOWE, oznacza się w pliku dyrektywą
//
//     // i18n-overlay-imports: pomijamy @/lib/i18n-builder (powód)
//
// Dyrektywa stoi przy powodzie, a nie w odległym pliku baseline'u - czyta ją
// ten sam człowiek, który za chwilę chciałby ten import dopisać.
//
// ── CZEGO ŚWIADOMIE NIE ŁAPIEMY ────────────────────────────────────────────
// Kluczy SKLEJANYCH (`t(\`ns.${x}\`)`) - pełnej ścieżki nie da się odczytać bez
// wykonania kodu. To osobny problem (klucz sklejany jest też niewidoczny dla
// bramki parytetu) i przy konwersjach zamieniamy go na jawne mapy `id -> klucz`.
//
// Import POŚREDNI (plik A importuje nakładkę i renderuje komponent z pliku B,
// który woła klucz) w runtime wystarcza, ale jest kruchy - wystarczy użyć B
// gdzie indziej. Bramka wymaga importu WPROST w pliku wołającym. Ten import
// jest darmowy (moduł wykonuje się raz) i czyni zależność jawną.
import { maskComments } from "./i18nKeyUsage";
import { parseObjectLiteral } from "./i18nDefaultValue";

export interface ScannedSource {
  readonly file: string;
  readonly source: string;
}

/** Nakładka i18n: specyfikator importu + pełne klucze, które wnosi. */
export interface Overlay {
  readonly file: string;
  /** Specyfikator używany w imporcie, np. `@/lib/i18n-admin-users`. */
  readonly specifier: string;
  /** Pełne ścieżki kluczy liści, np. `adminUsers.inviteUser`. */
  readonly keys: readonly string[];
}

const OVERLAY_FILE = /^src\/lib\/i18n-[\w.-]+\.ts$/;

export function isOverlayFile(file: string): boolean {
  return OVERLAY_FILE.test(file);
}

export function isScannable(file: string): boolean {
  if (!/\.tsx?$/.test(file)) return false;
  if (/\.(test|spec)\.tsx?$/.test(file)) return false;
  if (file.includes("/__tests__/")) return false;
  if (file.startsWith("src/test/")) return false;
  return true;
}

/** `src/lib/i18n-admin-users.ts` -> `@/lib/i18n-admin-users` */
export function specifierFor(file: string): string {
  return file.replace(/^src\//, "@/").replace(/\.tsx?$/, "");
}

/** Tekst wartości właściwości: wszystko za dwukropkiem następującym po nazwie. */
function valueText(text: string, start: number, end: number): string {
  let index = start;
  if (text[index] === '"' || text[index] === "'") {
    const quote = text[index];
    index += 1;
    while (index < end && text[index] !== quote) index += text[index] === "\\" ? 2 : 1;
    index += 1;
  }
  const colon = text.indexOf(":", index);
  if (colon === -1 || colon >= end) return "";
  return text.slice(colon + 1, end);
}

/**
 * Pełne ścieżki kluczy LIŚCI w obiekcie literalnym.
 *
 * Zagnieżdżone obiekty rozwijamy rekurencyjnie; wszystko inne (napis, szablon,
 * tablica, wywołanie) jest liściem. Dzięki temu `{ a: { b: "x" } }` daje `a.b`,
 * a nie `a` - i klucz `a` sam w sobie nie fałszuje dopasowania.
 */
export function flattenLiteralKeys(text: string, prefix = ""): string[] {
  const literal = parseObjectLiteral(text);
  if (literal === null) return prefix === "" ? [] : [prefix];

  const out: string[] = [];
  for (const property of literal.properties) {
    const path = prefix === "" ? property.name : `${prefix}.${property.name}`;
    out.push(...flattenLiteralKeys(valueText(text, property.start, property.end), path));
  }
  return out;
}

/**
 * Klucze wnoszone przez nakładkę - czytane z drzewa PL.
 *
 * Gdyby EN wnosiło inny zbiór niż PL, to defekt parytetu; pilnuje go
 * `check:i18n-parity`, nie ta bramka.
 */
export function keysOf(source: string): string[] {
  const masked = maskComments(source);
  const match = /\bconst\s+pl\s*(?::[^=]*)?=\s*/.exec(masked);
  if (match === null) return [];
  return flattenLiteralKeys(masked.slice(match.index + match[0].length));
}

export function collectOverlays(sources: readonly ScannedSource[]): Overlay[] {
  return sources
    .filter((s) => isOverlayFile(s.file))
    .map((s) => ({ file: s.file, specifier: specifierFor(s.file), keys: keysOf(s.source) }))
    .filter((o) => o.keys.length > 0);
}

/**
 * Klucze STAŁE wołane w pliku. Klucz sklejany pomijamy - patrz nagłówek modułu.
 * Wzorzec przyjmuje `t(`, `i18n.t(` i `fixedT(`, bo wszystkie trzy występują.
 */
const T_CALL = /(?:^|[^\w$.])(?:i18n\.)?t\(\s*"([A-Za-z_$][\w$]*(?:\.[\w$]+)+)"/g;

export function keysUsed(source: string): Set<string> {
  const masked = maskComments(source);
  const out = new Set<string>();
  for (const match of masked.matchAll(T_CALL)) out.add(match[1]);
  return out;
}

/** Czy plik importuje dany specyfikator - w dowolnej formie importu. */
export function importsSpecifier(source: string, specifier: string): boolean {
  const escaped = specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:from|import)\\s*["']${escaped}(?:\\.tsx?)?["']`).test(maskComments(source));
}

/**
 * Specyfikatory świadomie pominięte w tym pliku.
 *
 * Czytamy z surowego źródła PRZED maskowaniem komentarzy - dyrektywa jest
 * komentarzem i maskowanie by ją zjadło.
 */
const ALLOW_DIRECTIVE = /i18n-overlay-imports:\s*pomijamy\s+(\S+)/g;

export function allowedOmissions(source: string): Set<string> {
  const out = new Set<string>();
  for (const match of source.matchAll(ALLOW_DIRECTIVE)) out.add(match[1]);
  return out;
}

export interface MissingImport {
  readonly file: string;
  readonly key: string;
  /** Nakładki wnoszące ten klucz - kandydaci do dopisania. */
  readonly providers: readonly string[];
}

export interface GateInput {
  readonly sources: readonly ScannedSource[];
  readonly overlays: readonly Overlay[];
  /** Pełne klucze rdzenia (`src/lib/locale/pl.ts`) - poza bramką. */
  readonly coreKeys: ReadonlySet<string>;
}

export function findMissingImports({ sources, overlays, coreKeys }: GateInput): MissingImport[] {
  // Klucz -> nakładki, które go wnoszą; wyłącznie klucze NIEOBECNE w rdzeniu,
  // bo tylko one znikają razem z brakującym importem.
  const providersOf = new Map<string, string[]>();
  for (const overlay of overlays) {
    for (const key of overlay.keys) {
      if (coreKeys.has(key)) continue;
      const list = providersOf.get(key);
      if (list) {
        if (!list.includes(overlay.specifier)) list.push(overlay.specifier);
      } else providersOf.set(key, [overlay.specifier]);
    }
  }

  // Wywołanie z `returnObjects: true` sięga po GAŁĄŹ, nie po liść. Indeks
  // prefiksów pozwala rozpoznać i taki przypadek bez zgadywania.
  const branchProvidersOf = new Map<string, Set<string>>();
  for (const [key, specs] of providersOf) {
    const parts = key.split(".");
    for (let i = 1; i < parts.length; i += 1) {
      const branch = parts.slice(0, i).join(".");
      const set = branchProvidersOf.get(branch) ?? new Set<string>();
      for (const spec of specs) set.add(spec);
      branchProvidersOf.set(branch, set);
    }
  }

  const out: MissingImport[] = [];
  for (const { file, source } of sources) {
    // Nakładka nie musi importować samej siebie ani swoich sąsiadek.
    if (isOverlayFile(file)) continue;
    const allowed = allowedOmissions(source);
    for (const key of keysUsed(source)) {
      if (coreKeys.has(key)) continue;
      const providers =
        providersOf.get(key) ??
        (branchProvidersOf.has(key) ? [...(branchProvidersOf.get(key) ?? [])] : undefined);
      if (providers === undefined || providers.length === 0) continue;
      if (providers.some((spec) => importsSpecifier(source, spec))) continue;
      if (providers.some((spec) => allowed.has(spec))) continue;
      out.push({ file, key, providers });
    }
  }
  return out.sort((a, b) => a.file.localeCompare(b.file) || a.key.localeCompare(b.key));
}

/** Grupuje braki po pliku, żeby raport nie powtarzał tej samej linijki naprawy. */
export function renderReport(missing: readonly MissingImport[], scanned: number): string {
  if (missing.length === 0) {
    return `[i18n-overlay-imports] OK - ${scanned} plików, każdy woła wyłącznie klucze, których nakładki importuje.`;
  }

  const byFile = new Map<string, MissingImport[]>();
  for (const entry of missing) {
    const list = byFile.get(entry.file);
    if (list) list.push(entry);
    else byFile.set(entry.file, [entry]);
  }

  const lines: string[] = [
    `[i18n-overlay-imports] ${byFile.size} plików woła klucze nakładki, której nie importuje:`,
  ];
  for (const [file, entries] of byFile) {
    const specs = [...new Set(entries.flatMap((e) => e.providers))];
    const sample = entries
      .slice(0, 3)
      .map((e) => e.key)
      .join(", ");
    const more = entries.length > 3 ? ` (+${entries.length - 3})` : "";
    lines.push(`  - ${file}`);
    lines.push(`      brakuje: ${specs.map((s) => `import "${s}";`).join("  ")}`);
    lines.push(`      klucze:  ${sample}${more}`);
  }
  lines.push(
    "",
    "Nakładka rejestruje klucze EFEKTEM UBOCZNYM importu. Bez tej linijki i18next",
    "nie zna klucza i renderuje jego identyfikator - ekran wygląda na działający,",
    "a pokazuje `adminUsers.inviteUser` zamiast tekstu. Żadna inna bramka tego nie",
    "widzi: typy się zgadzają, parytet się zgadza, ratchet napisów się zgadza.",
  );
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Ratchet per plik
// ---------------------------------------------------------------------------

export interface RatchetReport {
  /** Plik spoza baseline'u z brakującym importem - nowy kod nie może go mieć. */
  readonly fresh: readonly { readonly file: string; readonly count: number }[];
  /** Plik, w którym braków PRZYBYŁO. */
  readonly grown: readonly { readonly file: string; readonly was: number; readonly now: number }[];
  /** Plik, w którym braków ubyło - baseline do zaktualizowania (w dół). */
  readonly improved: readonly {
    readonly file: string;
    readonly was: number;
    readonly now: number;
  }[];
  readonly total: number;
}

export function countsByFile(missing: readonly MissingImport[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const entry of missing) out.set(entry.file, (out.get(entry.file) ?? 0) + 1);
  return out;
}

export function compareWithRatchet(
  missing: readonly MissingImport[],
  baseline: ReadonlyMap<string, number>,
): RatchetReport {
  const now = countsByFile(missing);
  const fresh: { file: string; count: number }[] = [];
  const grown: { file: string; was: number; now: number }[] = [];
  const improved: { file: string; was: number; now: number }[] = [];

  for (const [file, count] of now) {
    const was = baseline.get(file);
    if (was === undefined) fresh.push({ file, count });
    else if (count > was) grown.push({ file, was, now: count });
    else if (count < was) improved.push({ file, was, now: count });
  }
  for (const [file, was] of baseline) {
    if (!now.has(file)) improved.push({ file, was, now: 0 });
  }
  return { fresh, grown, improved, total: missing.length };
}

/** Bramka pada na NOWYM pliku i na WZROŚCIE; poprawa jest tylko podpowiedzią. */
export function ratchetFailed(report: RatchetReport): boolean {
  return report.fresh.length > 0 || report.grown.length > 0;
}

export function renderRatchetReport(
  report: RatchetReport,
  missing: readonly MissingImport[],
  baselineFiles: number,
): string {
  const providersFor = (file: string): string[] => [
    ...new Set(missing.filter((m) => m.file === file).flatMap((m) => m.providers)),
  ];

  if (!ratchetFailed(report)) {
    const head = `[i18n-overlay-imports] OK - ${report.total} pośrednich zależności w ${baselineFiles} plikach (ratchet trzyma kierunek).`;
    if (report.improved.length === 0) return head;
    return [
      head,
      `[i18n-overlay-imports] ${report.improved.length} plików ma MNIEJ braków niż baseline - zaktualizuj listę w dół:`,
      ...report.improved.slice(0, 20).map((e) => `  - ${e.file}: ${e.was} -> ${e.now}`),
      "Odśwież: bun run check:i18n-overlay-imports --print-baseline",
    ].join("\n");
  }

  const lines: string[] = [];
  if (report.fresh.length > 0) {
    lines.push(
      `[i18n-overlay-imports] ${report.fresh.length} plików woła klucz nakładki, której NIE importuje:`,
      ...report.fresh.map(
        (e) =>
          `  - ${e.file}\n      dopisz: ${providersFor(e.file)
            .map((s) => `import "${s}";`)
            .join("  ")}`,
      ),
    );
  }
  if (report.grown.length > 0) {
    lines.push(
      `[i18n-overlay-imports] ${report.grown.length} plików POWIĘKSZYŁO liczbę braków:`,
      ...report.grown.map((e) => `  - ${e.file}: ${e.was} -> ${e.now}`),
    );
  }
  lines.push(
    "",
    "Nakładka rejestruje klucze EFEKTEM UBOCZNYM importu. Bez tej linijki i18next",
    "zna klucz tylko wtedy, gdy nakładkę wciągnie przypadkiem inny moduł w tym",
    "samym chunku - a gdy przestanie, ekran pokaże `adminUsers.inviteUser` zamiast",
    "tekstu. Żadna inna bramka tego nie widzi: typy, parytet i ratchet napisów są",
    "wtedy zielone.",
    "",
    "Jeśli pominięcie jest CELOWE (słownik nie ma po co trafić do tego chunka),",
    "opisz je w pliku dyrektywą:",
    "  // i18n-overlay-imports: pomijamy @/lib/i18n-… (powód)",
  );
  return lines.join("\n");
}
