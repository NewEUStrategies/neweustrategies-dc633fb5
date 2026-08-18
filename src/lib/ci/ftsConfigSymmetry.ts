// Inwariant CI: WYSZUKIWANIE PEŁNOTEKSTOWE MUSI BYĆ SYMETRYCZNE.
//
// ── KLASA DEFEKTU, KTÓREJ TO PILNUJE ────────────────────────────────────────
// `20260720160000_chat_message_search.sql` deklarował w nagłówku, że korzysta
// z infrastruktury FTS „z polską fleksją", po czym budował wektor
// I podświetlenie w konfiguracji `simple` - czyli DOKŁADNIE bez fleksji.
// Skutek dla użytkownika: „polityki" nie znajdowało „polityka", „umowę" nie
// znajdowało „umowa", a komentarz twierdził, że znajduje. Dług przeżył SIEDEM
// wydań audytu i znalazł go dopiero człowiek czytający kod - bo:
//   * `tsc` jest zielony (to napis w SQL-u),
//   * migracja wykonuje się bez błędu (obie konfiguracje istnieją),
//   * testy przechodzą (nikt nie szukał odmienionej formy),
//   * bramki `check:sql-*` patrzą na tenanty, role i granty, nie na słowniki.
// Spłaciła go migracja `20260815090000`. Ta bramka nie pozwala mu wrócić.
//
// ── DLACZEGO ASYMETRIA JEST GORSZA NIŻ BRAK FLEKSJI ─────────────────────────
// Gdyby wektor stemował („polityka" -> `polityk`), a zapytanie nie
// („polityki" -> `polityki:*`), prefiks NIE trafiłby w krótszy lemat
// i wyszukiwarka byłaby GORSZA niż na gołym `simple`. Symetria jest więc
// warunkiem poprawności, nie ozdobą - i o niej właśnie jest ten inwariant.
//
// ── CO BRAMKA WIDZI, A CZEGO NIE ────────────────────────────────────────────
// To analiza TEKSTU, nie wykonanie SQL-a. Bramka zbiera trzy rodzaje faktów
// z migracji (w kolejności plików, więc PÓŹNIEJSZA definicja nadpisuje
// wcześniejszą - tak jak `CREATE OR REPLACE` w bazie):
//
//   1. BUDOWNICZY ZAPYTAŃ - funkcje `RETURNS tsquery`, które w ciele wołają
//      `to_tsquery`/`plainto_tsquery`/`websearch_to_tsquery` z literałem
//      konfiguracji (np. `nes_polish_tsquery` -> `public.nes_polish`,
//      `nes_search_tsquery` -> `simple`).
//   2. KOLUMNY WEKTOROWE - `<tabela>.<kolumna>` z konfiguracją, w której
//      wektor POWSTAJE: kolumna generowana (`GENERATED ALWAYS AS`) albo
//      przypisanie w funkcji triggera (`NEW.<kolumna> := … to_tsvector(cfg…)`).
//   3. POWIERZCHNIE SZUKAJĄCE - ciała funkcji, w których stoi porównanie
//      `… @@ …`; z takiego ciała czytamy konfigurację strony zapytania
//      (literał albo budowniczy z punktu 1) oraz `ts_headline(cfg, …)`.
//
// Czego NIE widzi i dlaczego to w porządku: dynamicznego SQL-a budowanego
// z napisów, konfiguracji przekazanej parametrem i wektorów liczonych poza
// migracjami. Żaden z tych wzorców nie występuje w tym repo, a bramka mówi
// wprost, czego nie rozstrzygnęła (`unresolved`), zamiast udawać zieleń.
//
// Warstwa wykonawcza (chodzenie po katalogu) żyje w teście bramki; ten moduł
// jest czysty i przyjmuje treść plików.

/** Konfiguracje wyszukiwania traktowane jako „bez fleksji". */
export const STEMLESS_CONFIGS: ReadonlySet<string> = new Set(["simple"]);

/**
 * Migracja spłacająca dług czatu. Pliki STARSZE to zamrożona historia -
 * zastosowanych migracji się nie przepisuje, więc bramka ich nie ocenia.
 * Fakty z nich nadal ZBIERAMY (definicja funkcji może pochodzić z 07.2026
 * i nadal być aktualna); oceniamy wyłącznie stan KOŃCOWY.
 */
export const SYMMETRY_ENFORCED_FROM = "20260815090000";

/** Funkcje FTS budujące zapytanie z literału konfiguracji. */
const QUERY_FN = "(?:to_tsquery|plainto_tsquery|websearch_to_tsquery|phraseto_tsquery)";

/** Zdejmuje komentarze SQL, żeby nagłówek migracji nie udawał kodu. */
export function stripSqlComments(sql: string): string {
  let out = "";
  let i = 0;
  let inLine = false;
  let inBlock = false;
  let inString: '"' | "'" | null = null;
  let dollarTag: string | null = null;

  while (i < sql.length) {
    const two = sql.slice(i, i + 2);
    if (inLine) {
      if (sql[i] === "\n") {
        inLine = false;
        out += "\n";
      }
      i += 1;
      continue;
    }
    if (inBlock) {
      if (two === "*/") {
        inBlock = false;
        i += 2;
        continue;
      }
      if (sql[i] === "\n") out += "\n";
      i += 1;
      continue;
    }
    if (dollarTag) {
      if (sql.startsWith(dollarTag, i)) {
        out += dollarTag;
        i += dollarTag.length;
        dollarTag = null;
        continue;
      }
      out += sql[i];
      i += 1;
      continue;
    }
    if (inString) {
      out += sql[i];
      if (sql[i] === inString) inString = null;
      i += 1;
      continue;
    }
    // Ciało w cudzysłowach dolarowych ($$ … $$, $guard$ … $guard$) NIE jest
    // napisem: to kod, w którym szukamy wywołań FTS.
    const dollar = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
    if (dollar) {
      dollarTag = dollar[0];
      out += dollarTag;
      i += dollarTag.length;
      continue;
    }
    if (two === "--") {
      inLine = true;
      i += 2;
      continue;
    }
    if (two === "/*") {
      inBlock = true;
      i += 2;
      continue;
    }
    if (sql[i] === "'" || sql[i] === '"') {
      inString = sql[i] as '"' | "'";
      out += sql[i];
      i += 1;
      continue;
    }
    out += sql[i];
    i += 1;
  }
  return out;
}

/** Plik migracji podany bramce. */
export interface MigrationSource {
  /** Nazwa pliku (prefiks czasowy decyduje o kolejności i o zakresie oceny). */
  readonly file: string;
  readonly sql: string;
}

/** Zebrane fakty o jednej powierzchni FTS. */
export interface FtsFacts {
  /** Budowniczy zapytań: nazwa funkcji -> konfiguracja. */
  readonly queryBuilders: ReadonlyMap<string, string>;
  /** Kolumny wektorowe: `tabela.kolumna` -> konfiguracja budowania. */
  readonly vectorColumns: ReadonlyMap<string, string>;
  /** Powierzchnie szukające: nazwa funkcji -> jej użycia konfiguracji. */
  readonly searchSurfaces: ReadonlyMap<string, SearchSurface>;
}

export interface SearchSurface {
  readonly fn: string;
  readonly file: string;
  /** Konfiguracje strony ZAPYTANIA (literały + rozwiązani budowniczy). */
  readonly queryConfigs: readonly string[];
  /** Konfiguracje `ts_headline` w tym ciele. */
  readonly headlineConfigs: readonly string[];
  /**
   * Kolumny wektorowe porównywane w tym ciele, ROZWIĄZANE do `tabela.kolumna`
   * przez alias z klauzuli FROM/JOIN.
   */
  readonly vectorColumns: readonly string[];
  /** Odwołania `alias.kolumna`, dla których nie znaleziono tabeli. */
  readonly unresolvedVectorRefs: readonly string[];
  /** Nazwy wołanych budowniczych, których NIE udało się rozwiązać. */
  readonly unresolvedBuilders: readonly string[];
}

/**
 * Aliasy tabel z klauzul FROM/JOIN ciała funkcji: `alias -> tabela`. Sama
 * nazwa tabeli mapuje się na siebie, żeby zapytania bez aliasu też działały.
 *
 * Rozwiązywanie aliasu jest WARUNKIEM POPRAWNOŚCI bramki, nie wygodą: kolumna
 * `search_vector` istnieje w tym repo w `posts`, `messages`, `club_threads`,
 * `club_replies` i czterech tabelach warsztatu wątku - i część z nich stoi
 * świadomie na `simple`, a część na `public.nes_polish`. Bez aliasu bramka
 * porównywałaby wektor jednej tabeli z zapytaniem o inną.
 */
function tableAliases(body: string): Map<string, string> {
  const aliases = new Map<string, string>();
  const pattern =
    /\b(?:FROM|JOIN)\s+(?:public\.)?([a-z0-9_]+)(?:\s+(?:AS\s+)?(?!ON\b|USING\b|WHERE\b|CROSS\b|LEFT\b|RIGHT\b|INNER\b|JOIN\b|GROUP\b|ORDER\b|LIMIT\b|OFFSET\b|WINDOW\b|UNION\b|HAVING\b|SELECT\b)([a-z0-9_]+))?/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(body)) !== null) {
    const table = match[1]?.toLowerCase();
    if (!table) continue;
    aliases.set(table, table);
    const alias = match[2]?.toLowerCase();
    if (alias) aliases.set(alias, table);
  }
  return aliases;
}

/** Wycina ciała funkcji: nazwa -> treść między znacznikami dolarowymi. */
function functionBodies(sql: string): Array<{ fn: string; body: string; returns: string }> {
  const out: Array<{ fn: string; body: string; returns: string }> = [];
  const header = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?([a-z0-9_]+)\s*\(/gi;
  let match: RegExpExecArray | null;
  while ((match = header.exec(sql)) !== null) {
    const fn = match[1];
    if (!fn) continue;
    const rest = sql.slice(match.index);
    const tagMatch = /\$([A-Za-z_]*)\$/.exec(rest);
    if (!tagMatch) continue;
    const tag = tagMatch[0];
    const bodyStart = tagMatch.index + tag.length;
    const bodyEnd = rest.indexOf(tag, bodyStart);
    if (bodyEnd === -1) continue;
    out.push({
      fn,
      body: rest.slice(bodyStart, bodyEnd),
      returns: rest.slice(0, tagMatch.index),
    });
  }
  return out;
}

function allMatches(text: string, pattern: RegExp): string[] {
  const found: string[] = [];
  let match: RegExpExecArray | null;
  const re = new RegExp(
    pattern.source,
    pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`,
  );
  while ((match = re.exec(text)) !== null) {
    const value = match[1];
    if (value) found.push(value);
  }
  return found;
}

/** Zbiera fakty z WSZYSTKICH migracji; późniejsza definicja nadpisuje wcześniejszą. */
export function collectFtsFacts(sources: readonly MigrationSource[]): FtsFacts {
  const queryBuilders = new Map<string, string>();
  const vectorColumns = new Map<string, string>();
  const searchSurfaces = new Map<string, SearchSurface>();

  const ordered = [...sources].sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));

  for (const source of ordered) {
    const sql = stripSqlComments(source.sql);

    // (2a) Kolumny generowane: `<kolumna> tsvector GENERATED ALWAYS AS (… to_tsvector('cfg' …`.
    // Tabela pochodzi z najbliższego wcześniejszego `CREATE TABLE`.
    for (const generated of sql.matchAll(
      /CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+(?:public\.)?([a-z0-9_]+)([\s\S]*?);/gi,
    )) {
      const table = generated[1];
      const body = generated[2] ?? "";
      if (!table) continue;
      for (const column of body.matchAll(
        /([a-z0-9_]+)\s+tsvector\s+GENERATED\s+ALWAYS\s+AS\s*\(([\s\S]*?)\)\s*STORED/gi,
      )) {
        const name = column[1];
        const expression = column[2] ?? "";
        const configs = allMatches(expression, /to_tsvector\(\s*'([a-z0-9_.]+)'/i);
        if (name && configs[0]) vectorColumns.set(`${table}.${name}`, configs[0]);
      }
    }

    for (const { fn, body, returns } of functionBodies(sql)) {
      // (1) Budowniczy zapytań.
      if (/RETURNS\s+tsquery/i.test(returns)) {
        const configs = allMatches(body, new RegExp(`${QUERY_FN}\\(\\s*'([a-z0-9_.]+)'`, "i"));
        if (configs[0]) queryBuilders.set(fn, configs[0]);
      }

      // (2b) Trigger budujący wektor: `NEW.<kolumna> := … to_tsvector('cfg' …`.
      for (const assignment of body.matchAll(/NEW\.([a-z0-9_]+)\s*:=([\s\S]*?);/gi)) {
        const column = assignment[1];
        const expression = assignment[2] ?? "";
        const configs = allMatches(expression, /to_tsvector\(\s*'([a-z0-9_.]+)'/i);
        if (column && configs[0]) {
          // Tabelę wiąże `CREATE TRIGGER … ON public.<tabela> … EXECUTE FUNCTION <fn>`.
          const trigger = new RegExp(
            `CREATE\\s+TRIGGER[\\s\\S]*?ON\\s+(?:public\\.)?([a-z0-9_]+)[\\s\\S]*?EXECUTE\\s+FUNCTION\\s+(?:public\\.)?${fn}\\b`,
            "i",
          ).exec(sql);
          const table = trigger?.[1];
          if (table) vectorColumns.set(`${table}.${column}`, configs[0]);
        }
      }

      // (3) Powierzchnia szukająca: ciało z porównaniem `@@`.
      if (!body.includes("@@")) continue;
      const literalQueryConfigs = allMatches(
        body,
        new RegExp(`${QUERY_FN}\\(\\s*'([a-z0-9_.]+)'`, "i"),
      );
      const builderCalls = allMatches(body, /(?:public\.)?([a-z0-9_]*_tsquery(?:_adv)?)\s*\(/i);
      const resolved: string[] = [...literalQueryConfigs];
      const unresolved: string[] = [];
      for (const call of builderCalls) {
        if (call === fn) continue;
        const config = queryBuilders.get(call);
        if (config) resolved.push(config);
        else if (!/^(?:to|plainto|websearch|phraseto)_tsquery$/.test(call)) unresolved.push(call);
      }
      // Strona WEKTORA: `<alias>.<kolumna> @@ …`. Alias trzeba rozwiązać na
      // tabelę, bo `search_vector` nosi w tym repo PIĘĆ różnych tabel
      // w dwóch różnych konfiguracjach - dopasowanie po samej nazwie kolumny
      // dawałoby lawinę fałszywych alarmów (i przez chwilę dawało).
      const aliases = tableAliases(body);
      const vectorRefs: string[] = [];
      const unresolvedAliases: string[] = [];
      for (const ref of body.matchAll(/\b([a-z0-9_]+)\.([a-z0-9_]*search_vector)\s*@@/gi)) {
        const alias = ref[1];
        const column = ref[2];
        if (!alias || !column) continue;
        const table = aliases.get(alias.toLowerCase());
        if (table) vectorRefs.push(`${table}.${column}`);
        else unresolvedAliases.push(`${alias}.${column}`);
      }
      searchSurfaces.set(fn, {
        fn,
        file: source.file,
        queryConfigs: [...new Set(resolved)],
        headlineConfigs: [...new Set(allMatches(body, /ts_headline\(\s*'([a-z0-9_.]+)'/i))],
        vectorColumns: [...new Set(vectorRefs)],
        unresolvedVectorRefs: [...new Set(unresolvedAliases)],
        unresolvedBuilders: [...new Set(unresolved)],
      });
    }
  }

  return { queryBuilders, vectorColumns, searchSurfaces };
}

export type FtsViolationKind =
  /** Zapytanie i podświetlenie w RÓŻNYCH konfiguracjach. */
  | "query-headline-mismatch"
  /** Dwie różne konfiguracje na stronie zapytania w jednym ciele. */
  | "mixed-query-configs"
  /** Wektor budowany inaczej, niż jest odpytywany - defekt z 20.07.2026. */
  | "vector-query-mismatch";

export interface FtsViolation {
  readonly kind: FtsViolationKind;
  readonly fn: string;
  readonly file: string;
  readonly detail: string;
}

export interface FtsSymmetryReport {
  readonly violations: readonly FtsViolation[];
  /** Powierzchnie, których strony zapytania bramka nie rozstrzygnęła. */
  readonly unresolved: readonly string[];
  /** Ile powierzchni szukających sprawdzono (raport ma pokazywać zasięg). */
  readonly surfacesChecked: number;
}

/**
 * Ocena symetrii. Oceniamy WYŁĄCZNIE powierzchnie zdefiniowane w migracjach
 * od `SYMMETRY_ENFORCED_FROM` w górę - starsze pliki są zamrożoną historią,
 * a ich długi zostały spłacone nowszymi definicjami (i te nowsze są oceniane).
 */
export function analyzeFtsSymmetry(
  facts: FtsFacts,
  enforcedFrom: string = SYMMETRY_ENFORCED_FROM,
): FtsSymmetryReport {
  const violations: FtsViolation[] = [];
  const unresolved: string[] = [];
  let surfacesChecked = 0;

  for (const surface of facts.searchSurfaces.values()) {
    if (surface.file < enforcedFrom) continue;
    surfacesChecked += 1;

    if (surface.unresolvedBuilders.length > 0) {
      unresolved.push(`${surface.fn} (budowniczy: ${surface.unresolvedBuilders.join(", ")})`);
    }
    if (surface.unresolvedVectorRefs.length > 0) {
      unresolved.push(`${surface.fn} (alias: ${surface.unresolvedVectorRefs.join(", ")})`);
    }

    if (surface.queryConfigs.length > 1) {
      violations.push({
        kind: "mixed-query-configs",
        fn: surface.fn,
        file: surface.file,
        detail: `strona zapytania miesza konfiguracje: ${surface.queryConfigs.join(" vs ")}`,
      });
    }

    const queryConfig = surface.queryConfigs[0];
    for (const headline of surface.headlineConfigs) {
      if (queryConfig && headline !== queryConfig) {
        violations.push({
          kind: "query-headline-mismatch",
          fn: surface.fn,
          file: surface.file,
          detail: `zapytanie w '${queryConfig}', podswietlenie w '${headline}'`,
        });
      }
    }

    if (!queryConfig) continue;
    for (const key of surface.vectorColumns) {
      const vectorConfig = facts.vectorColumns.get(key);
      // Kolumna, której budowy bramka nie widziała (wektor liczony poza
      // migracjami albo dynamicznie), NIE jest naruszeniem - jest luką
      // w widoczności i mówimy o niej wprost.
      if (!vectorConfig) {
        unresolved.push(`${surface.fn} (wektor: ${key})`);
        continue;
      }
      if (vectorConfig === queryConfig) continue;
      violations.push({
        kind: "vector-query-mismatch",
        fn: surface.fn,
        file: surface.file,
        detail: `wektor ${key} budowany w '${vectorConfig}', odpytywany w '${queryConfig}'`,
      });
    }
  }

  return { violations, unresolved, surfacesChecked };
}

/** Czy powierzchnia FTS jest bez fleksji (diagnostyka raportu, nie naruszenie). */
export function isStemless(config: string): boolean {
  return STEMLESS_CONFIGS.has(config);
}

export function renderFtsSymmetryReport(report: FtsSymmetryReport): string {
  const lines: string[] = [];
  lines.push(`FTS: sprawdzono ${report.surfacesChecked} powierzchni szukajacych.`);
  if (report.unresolved.length > 0) {
    lines.push(`Nierozstrzygniete budowniczy zapytan: ${report.unresolved.join("; ")}`);
  }
  if (report.violations.length === 0) {
    lines.push("Symetria wektor <-> zapytanie <-> podswietlenie: OK.");
    return lines.join("\n");
  }
  lines.push(`ASYMETRIA FTS (${report.violations.length}):`);
  for (const violation of report.violations) {
    lines.push(`  [${violation.kind}] ${violation.file} :: ${violation.fn} - ${violation.detail}`);
  }
  return lines.join("\n");
}
