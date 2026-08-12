// Inwariant CI: DEKLARACJA `plan(N)` ZGADZA SIĘ Z LICZBĄ ASERCJI.
//
// PO CO. pgTAP porównuje `plan(N)` z liczbą asercji, które REALNIE się wykonały,
// i rozjazd traktuje jako porażkę pliku - ale dowiadujemy się o tym dopiero z
// prawdziwego Postgresa w jobie `pgtap`, czyli po `supabase db start` i migracjach.
// Gdy ten job pada z jakiegokolwiek innego powodu (na 2026-08-06: dwie migracje
// dzieliły wersję `20260806150000`, a `schema_migrations.version` to klucz główny),
// rozjazd `plan` zostaje NIEWIDOCZNY - i wraca jako czerwony przebieg dopiero po
// naprawie tamtej awarii. Dokładnie tak stało się z
// `profiles_verification_guard_test.sql`: dwie suity zlały się w jeden plik
// - 20 zadeklarowanych asercji przy 33 napisanych, seed w ŚRODKU pliku (pierwsze
// 17 asercji odwoływało się do fixture'ów, które jeszcze nie istniały) i dwie
// wzajemnie sprzeczne asercje dla tego samego zapisu.
//
// Ta bramka mierzy to STATYCZNIE: bez Dockera, bez bazy, w milisekundach, nad
// wszystkimi plikami `supabase/tests/*.sql`. Wyłapuje dwie rzeczy:
//   1. `plan(N)` != liczba asercji (dopisana asercja bez podniesienia planu -
//      najczęstszy sposób, w jaki ten plik się psuje; przy zlepku dwóch suit
//      różnica jest duża i od razu nazywa problem),
//   2. brak `plan()` albo brak `finish()` (pgTAP nie policzy wtedy niczego).
//
// CZEGO NIE MIERZY - świadomie, żeby bramka nie kłamała:
//   * KOLEJNOŚCI seedu i asercji. „Zaseeduj - sprawdź - doseeduj - sprawdź" to
//     kanoniczny układ 26 z 73 plików tej suity, więc reguła „seed musi stać przed
//     pierwszą asercją" dałaby 26 fałszywych alarmów przy zerowym zysku.
//   * czy asercja wykonuje się w RUNTIME. Asercja w gałęzi `DO $$` albo za `\if`
//     nie zostanie policzona przez pgTAP, jeśli nie wykonała się realnie - repo nie
//     używa takich konstrukcji w testach, a bramka liczy wystąpienia w tekście,
//     więc pierwsze wejście w tę konwencję zobaczymy jako rozjazd, nie jako cichy
//     przeciek.
//
// Warstwa wykonawcza (odczyt katalogu + exit code) żyje w
// `scripts/check-pgtap-plan.ts`; ten moduł jest czysty i testowalny.

/**
 * Funkcje asercyjne pgTAP używane w repo (+ warianty, po które sięga się
 * naturalnie przy pisaniu nowego pliku).
 *
 * Przed dopasowaniem stoi `\b`, a po nazwie WYMAGANY `(`, i to te dwa warunki
 * chronią od podliczania nazw zagnieżdżonych: `is` nie trafia w `isnt(` (po `is`
 * stoi `n`), `ok` nie trafia w `throws_ok(` (`_` jest znakiem słowa, więc nie ma
 * tam granicy), a `is_super_admin(` w argumencie `ok(...)` nie jest asercją.
 * Kolejność od najdłuższych trzymamy jako zabezpieczenie na wypadek dopisania
 * nazwy, która JEST sufiksem innej po granicy słowa.
 */
const ASSERTION_FUNCTIONS: readonly string[] = [
  "col_default_is",
  "col_hasnt_default",
  "col_is_null",
  "col_not_null",
  "hasnt_column",
  "hasnt_function",
  "hasnt_index",
  "hasnt_table",
  "hasnt_trigger",
  "hasnt_view",
  "has_column",
  "has_function",
  "has_index",
  "has_table",
  "has_trigger",
  "has_view",
  "isnt_definer",
  // `is_empty`/`isnt_empty` to pelnoprawne asercje pgTAP, ale maja `_` po `is`,
  // wiec ani `is`, ani `isnt` w nie nie trafia - bez tych wpisow bramka liczyla
  // 11 asercji mniej niz pgTAP i zglaszala falszywy rozjazd planu w trzech
  // plikach modulu klubow (a3/a4/a5_a6).
  "isnt_empty",
  "is_empty",
  "is_definer",
  "throws_like",
  "throws_ilike",
  "throws_ok",
  "lives_ok",
  "results_eq",
  "results_ne",
  "row_eq",
  "set_eq",
  "bag_eq",
  "cmp_ok",
  "imatches",
  "matches",
  "doesnt_match",
  "unalike",
  "alike",
  // `is_empty` / `isnt_empty` MUSZĄ stać przed `isnt`/`is`, żeby zachować
  // konwencję "najdłuższy wariant pierwszy" z resztą tej listy. Ich brak był
  // martwą strefą tej bramki: pliki używające `is_empty` raportowały rozjazd
  // planu, którego w rzeczywistym przebiegu nie ma (pgTAP liczy je normalnie),
  // a rozjazd w drugą stronę - plan(N) zawyżony dokładnie o liczbę `is_empty` -
  // przechodziłby niezauważony.
  "isnt_empty",
  "is_empty",
  "isnt",
  "is",
  "ok",
  "pass",
  "fail",
];

const ASSERTION_RE = new RegExp(String.raw`\b(${ASSERTION_FUNCTIONS.join("|")})\s*\(`, "gi");
const PLAN_RE = /\bplan\s*\(\s*(\d+)\s*\)/i;
const FINISH_RE = /\bfinish\s*\(/i;

export interface PgTapFileFinding {
  readonly file: string;
  /** `null` gdy w pliku nie ma `plan(<liczba>)`. */
  readonly planned: number | null;
  readonly counted: number;
  readonly hasFinish: boolean;
}

export interface PgTapPlanReport {
  readonly checked: number;
  readonly findings: readonly PgTapFileFinding[];
}

export interface PgTapSource {
  readonly file: string;
  readonly sql: string;
}

/**
 * Usuwa komentarze SQL, zachowując podział na linie (numery w raporcie muszą
 * wskazywać źródło). Bez tego bramka liczy asercje CYTOWANE w nagłówku pliku -
 * a te nagłówki cytują je obficie, bo opisują naprawiane regresje.
 */
export function stripSqlLineComments(sql: string): string {
  let out = "";
  let i = 0;
  let inLine = false;
  let inBlock = false;
  let inSingle = false;
  let inDouble = false;

  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (inLine) {
      if (ch === "\n") {
        inLine = false;
        out += ch;
      }
      i += 1;
      continue;
    }
    if (inBlock) {
      if (ch === "*" && next === "/") {
        inBlock = false;
        i += 2;
        continue;
      }
      if (ch === "\n") out += ch;
      i += 1;
      continue;
    }
    if (inSingle) {
      out += ch;
      if (ch === "'") inSingle = false;
      i += 1;
      continue;
    }
    if (inDouble) {
      out += ch;
      if (ch === '"') inDouble = false;
      i += 1;
      continue;
    }

    if (ch === "-" && next === "-") {
      inLine = true;
      i += 2;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlock = true;
      i += 2;
      continue;
    }
    if (ch === "'") inSingle = true;
    if (ch === '"') inDouble = true;
    out += ch;
    i += 1;
  }
  return out;
}

/**
 * Wycina ciała dollar-quote (`$$ ... $$`, `$tag$ ... $tag$`), zachowując liczbę
 * linii. To zapytania PRZEKAZYWANE do `throws_ok`/`lives_ok` oraz ciała funkcji
 * pomocniczych - asercją jest wywołanie na zewnątrz, nie treść w środku.
 */
export function stripDollarQuoted(sql: string): string {
  let out = "";
  let i = 0;

  while (i < sql.length) {
    const open = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
    if (open) {
      const tag = open[0];
      const end = sql.indexOf(tag, i + tag.length);
      if (end === -1) {
        // Niedomknięty dollar-quote: resztę pliku traktujemy jak treść.
        out += "\n".repeat(countNewlines(sql.slice(i)));
        break;
      }
      out += " " + "\n".repeat(countNewlines(sql.slice(i, end + tag.length))) + " ";
      i = end + tag.length;
      continue;
    }
    out += sql[i];
    i += 1;
  }
  return out;
}

function countNewlines(text: string): number {
  let n = 0;
  for (const ch of text) if (ch === "\n") n += 1;
  return n;
}

/** Analiza jednego pliku: ile asercji zadeklarowano, ile napisano. */
export function analyzePgTapFile(file: string, sql: string): PgTapFileFinding {
  const stripped = stripDollarQuoted(stripSqlLineComments(sql));
  const planMatch = PLAN_RE.exec(stripped);

  return {
    file,
    planned: planMatch ? Number(planMatch[1]) : null,
    counted: [...stripped.matchAll(ASSERTION_RE)].length,
    hasFinish: FINISH_RE.test(stripped),
  };
}

/** `plan(N)` musi zgadzać się z liczbą asercji, a plik mieć `plan()` i `finish()`. */
export function isPgTapFileBroken(finding: PgTapFileFinding): boolean {
  return finding.planned === null || !finding.hasFinish || finding.planned !== finding.counted;
}

export function analyzePgTapPlans(sources: readonly PgTapSource[]): PgTapPlanReport {
  const findings = sources
    .map((source) => analyzePgTapFile(source.file, source.sql))
    .filter(isPgTapFileBroken)
    .sort((a, b) => a.file.localeCompare(b.file));

  return { checked: sources.length, findings };
}

export function pgTapPlanFailed(report: PgTapPlanReport): boolean {
  return report.findings.length > 0;
}

function describeFinding(finding: PgTapFileFinding): readonly string[] {
  const lines: string[] = [];

  if (finding.planned === null) {
    lines.push(
      `  brak \`SELECT plan(<liczba>)\` - pgTAP nie porówna niczego z liczbą asercji ` +
        `(znaleziono ${finding.counted})`,
    );
  } else if (finding.planned !== finding.counted) {
    const delta = finding.counted - finding.planned;
    const hint =
      delta > 0
        ? `podnieś plan do ${finding.counted}`
        : `plan obiecuje ${finding.planned} asercji, a plik ma ${finding.counted} - ` +
          `usunięta asercja albo zlepek dwóch suit`;
    lines.push(`  plan(${finding.planned}) vs ${finding.counted} asercji (${hint})`);
  }

  if (!finding.hasFinish) {
    lines.push("  brak `SELECT * FROM finish()` - pgTAP nie zamknie planu");
  }

  return lines;
}

export function renderPgTapPlanReport(report: PgTapPlanReport): string {
  if (report.findings.length === 0) {
    return `✓ Inwariant planu pgTAP OK (${report.checked} plików: plan(N) zgodny z liczbą asercji, każdy z finish()).`;
  }

  const body = report.findings
    .flatMap((finding) => [`✗ supabase/tests/${finding.file}`, ...describeFinding(finding)])
    .join("\n");

  return (
    `✗ Inwariant planu pgTAP naruszony w ${report.findings.length} z ${report.checked} plików.\n` +
    `${body}\n\n` +
    "pgTAP porównuje plan(N) z liczbą WYKONANYCH asercji i rozjazd = porażka pliku.\n" +
    "Bez tej bramki dowiadujemy się o tym po `supabase db start` w jobie pgtap - a gdy\n" +
    "ten pada z innego powodu (kolizja wersji migracji), rozjazd zostaje niewidoczny."
  );
}
