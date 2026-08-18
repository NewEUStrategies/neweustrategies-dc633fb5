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
 * Migracja spłacająca dług czatu (`simple` po stronie wektora przy nagłówku
 * obiecującym fleksję). Zostaje w kodzie jako punkt odniesienia dokumentacji
 * i jedyne pokrętło, którym można zawęzić zakres bramki.
 */
export const CHAT_FTS_DEBT_PAID_IN = "20260815090000";

/**
 * Od której migracji bramka OCENIA symetrię. Fakty zbieramy z całego katalogu
 * i oceniamy stan KOŃCOWY, więc próg jest tylko filtrem powierzchni.
 *
 * Stoi na początku historii, czyli obejmuje WSZYSTKIE siedem powierzchni
 * szukających tego repo. Pierwotnie stał na `CHAT_FTS_DEBT_PAID_IN`, bo
 * analizator czytał tylko jedną z nich - `posts` i `pages` budują wektor przez
 * funkcję pomocniczą (`nes_posts_search_vector`), a klubowe wyszukiwarki przez
 * CTE, i obie ścieżki wychodziły jako „nierozstrzygnięte". Po domknięciu tych
 * dwóch ścieżek cały katalog jest czysty, więc próg przestał być potrzebny:
 * zamrożona historia, której nie umiemy przeczytać, to nie to samo co historia,
 * którą przeczytaliśmy i jest symetryczna.
 */
export const SYMMETRY_ENFORCED_FROM = "00000000000000";

/** Funkcje FTS budujące zapytanie z literału konfiguracji. */
const QUERY_FN = "(?:to_tsquery|plainto_tsquery|websearch_to_tsquery|phraseto_tsquery)";

/**
 * Wbudowane funkcje Postgresa budujące `tsquery`. Ich konfigurację czytamy
 * z literału w wywołaniu, więc NIE są „nierozstrzygniętym budowniczym".
 *
 * Lista jest jawna, bo pierwsza wersja używała wzorca
 * `^(?:to|plainto|websearch|phraseto)_tsquery$`, który nie dopasowywał
 * `websearch_to_tsquery` (`websearch` + `_tsquery` to `websearch_tsquery`).
 * Skutek: dwie realne wyszukiwarki klubów lądowały w `unresolved` - i od chwili,
 * w której nierozstrzygnięcie jest błędem bramki, byłby to fałszywy alarm.
 */
const BUILTIN_QUERY_FNS: ReadonlySet<string> = new Set([
  "to_tsquery",
  "plainto_tsquery",
  "websearch_to_tsquery",
  "phraseto_tsquery",
]);

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

/**
 * Fakt o konfiguracji FTS wraz z PLIKIEM, z którego pochodzi.
 *
 * Plik jest tu częścią faktu, nie metadaną: zakres bramki musi rozpoznać
 * sytuację „stara funkcja szukająca, ale JEJ WEKTOR przebudowano nową
 * migracją". Bez pliku zależności taka regresja przechodziła obok bramki,
 * bo definicja samej funkcji jest sprzed progu.
 */
export interface ConfigFact {
  readonly config: string;
  readonly file: string;
}

/** Zebrane fakty o jednej powierzchni FTS. */
export interface FtsFacts {
  /** Budowniczy zapytań: nazwa funkcji -> konfiguracja + plik definicji. */
  readonly queryBuilders: ReadonlyMap<string, ConfigFact>;
  /**
   * Budowniczy WEKTORÓW (`RETURNS tsvector`): nazwa -> konfiguracja + plik.
   *
   * Bez tej ścieżki bramka nie widziała, jak budowane są `posts.search_vector`
   * i `pages.search_vector`: trigger nie woła tam `to_tsvector` wprost, tylko
   * `public.nes_posts_search_vector(…)`, a konfiguracja siedzi wewnątrz tej
   * funkcji. Pięć realnych wyszukiwarek (`search_posts`, `search_quick`,
   * `search_facets`, `run_saved_search_alerts`) lądowało wtedy w `unresolved`,
   * co po zaostrzeniu bramki byłoby fałszywym alarmem przy pierwszej migracji
   * dotykającej tych ścieżek.
   */
  readonly vectorBuilders: ReadonlyMap<string, ConfigFact>;
  /** Kolumny wektorowe: `tabela.kolumna` -> konfiguracja + plik zależności. */
  readonly vectorColumns: ReadonlyMap<string, ConfigFact>;
  /**
   * Kolumny ZSZYTE Z KILKU konfiguracji (`tabela.kolumna` -> lista). To nie
   * jest brak wiedzy, a defekt: pół kolumny z fleksją, pół bez - żadne
   * zapytanie nie może być symetryczne wobec obu połówek naraz.
   */
  readonly mixedVectorColumns: ReadonlyMap<string, readonly string[]>;
  /** Powierzchnie szukające: nazwa funkcji -> jej użycia konfiguracji. */
  readonly searchSurfaces: ReadonlyMap<string, SearchSurface>;
}

export interface SearchSurface {
  readonly fn: string;
  readonly file: string;
  /**
   * Konfiguracje strony ZAPYTANIA zapisane w tym ciele LITERAŁEM
   * (`websearch_to_tsquery('public.nes_polish', …)`).
   *
   * Tu NIE MA konfiguracji wołanych budowniczych - i to jest celowe. Wcześniej
   * powierzchnia nosiła pełną, rozwiązaną listę utrwaloną w chwili zbierania
   * faktów, więc migracja przestawiająca budowniczego PO tej powierzchni
   * zmieniała realne zachowanie SQL-a, ale nie zmieniała zapamiętanej listy:
   * bramka porównywała wektor z konfiguracją, która już nie obowiązywała.
   * Konfiguracje budowniczych rozwiązuje `surfaceQueryConfigs` w chwili
   * ANALIZY, kiedy wszystkie migracje są już wczytane.
   */
  readonly literalQueryConfigs: readonly string[];
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
  /**
   * Nazwy ROZWIĄZANYCH budowniczych wołanych w tym ciele. Zakres liczy z nich
   * plik zależności (`effectiveScopeFile`), a analiza - ich aktualną
   * konfigurację (`surfaceQueryConfigs`).
   */
  readonly builderNames: readonly string[];
}

/**
 * Konfiguracje strony zapytania powierzchni, rozwiązane W CHWILI ANALIZY:
 * literały z ciała plus AKTUALNA konfiguracja każdego wołanego budowniczego.
 *
 * Rozwiązywanie musi być leniwe, bo `collectFtsFacts` czyta migracje po kolei,
 * a budowniczy bywa przestawiany PÓŹNIEJ niż powierzchnia, która go woła.
 * Lista utrwalona przy zbieraniu faktów zapamiętywałaby konfigurację z chwili
 * definicji powierzchni - czyli dokładnie tę, która już nie obowiązuje.
 */
export function surfaceQueryConfigs(surface: SearchSurface, facts: FtsFacts): readonly string[] {
  const configs = [...surface.literalQueryConfigs];
  for (const name of surface.builderNames) {
    const fact = facts.queryBuilders.get(name);
    if (fact) configs.push(fact.config);
  }
  return [...new Set(configs)];
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
function directTableAliases(body: string): Map<string, string> {
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

/** Wycina wnętrza CTE z klauzuli WITH: `nazwa AS ( … )` z bilansowaniem nawiasów. */
function cteBodies(body: string): Map<string, string> {
  const out = new Map<string, string>();
  const header = /\b([a-z0-9_]+)\s+AS\s*(?:MATERIALIZED\s+|NOT\s+MATERIALIZED\s+)?\(/gi;
  let match: RegExpExecArray | null;
  while ((match = header.exec(body)) !== null) {
    const name = match[1]?.toLowerCase();
    if (!name) continue;
    let depth = 1;
    let i = header.lastIndex;
    while (i < body.length && depth > 0) {
      if (body[i] === "(") depth += 1;
      else if (body[i] === ")") depth -= 1;
      i += 1;
    }
    if (depth === 0) out.set(name, body.slice(header.lastIndex, i - 1));
  }
  return out;
}

/**
 * Aliasy tabel widoczne w ciele funkcji: `alias -> tabela`, WRAZ z aliasami
 * pochodzącymi z CTE.
 *
 * Rozwiązywanie aliasu jest WARUNKIEM POPRAWNOŚCI bramki, nie wygodą: kolumna
 * `search_vector` istnieje w tym repo w `posts`, `messages`, `club_threads`,
 * `club_replies` i czterech tabelach warsztatu wątku - i część z nich stoi
 * świadomie na `simple`, a część na `public.nes_polish`. Bez aliasu bramka
 * porównywałaby wektor jednej tabeli z zapytaniem o inną.
 *
 * CTE MUSZĄ być rozwiązywane, bo wyszukiwarki tej platformy są tak napisane:
 * `search_posts` porównuje `base.search_vector`, gdzie `base` to CTE nad
 * `public.posts`; `club_search` porównuje `visible.search_vector`, gdzie
 * `visible` to CTE nad `public.club_threads`. Bez tego kroku bramka zgłaszałaby
 * „nie rozstrzygnąłem" dla KAŻDEJ realnej wyszukiwarki w repo - a od momentu,
 * w którym nierozstrzygnięta powierzchnia objęta zakresem jest błędem bramki
 * (patrz `gateFailed`), byłby to fałszywy alarm blokujący CI.
 *
 * Nazwę CTE wiążemy z tabelą, z której CTE bierze `search_vector`: albo wprost
 * (`p.search_vector` w liście SELECT), albo przez gwiazdkę aliasu (`t.*`).
 */
function tableAliases(body: string): Map<string, string> {
  // Krok 1: nazwa CTE -> jej ŹRÓDŁO, którym może być tabela ALBO inne CTE.
  const cteSources = new Map<string, string>();
  for (const [name, cte] of cteBodies(body)) {
    const inner = directTableAliases(cte);
    // Najpierw jawna projekcja kolumny wektora, potem gwiazdka aliasu.
    const explicit = /\b([a-z0-9_]+)\.([a-z0-9_]*search_vector)\b/i.exec(cte);
    const star = /\b([a-z0-9_]+)\.\*/i.exec(cte);
    const source = explicit?.[1]?.toLowerCase() ?? star?.[1]?.toLowerCase();
    const target = source ? inner.get(source) : undefined;
    if (target && target !== name) cteSources.set(name, target);
  }

  // Krok 2: aliasy widoczne wprost. Prawa strona MOŻE być nazwą CTE - w SQL
  // `FROM base b` nie odróżnia się składniowo od `FROM messages m`, więc
  // `directTableAliases` zapisuje tu `b -> base` i `base -> base`.
  const direct = directTableAliases(body);

  // Krok 3: rozwiązanie PRZECHODNIE do realnej tabeli. Osobny krok, bo dawna
  // wersja odmawiała nadpisania wpisu `base -> base` (wyglądał jak realna
  // tabela) i CTE zostawało zmapowane na siebie - a wtedy porównanie wektora
  // szukało konfiguracji tabeli o nazwie CTE, której nie ma w migracjach.
  const resolved = new Map<string, string>();
  for (const [alias, name] of direct) resolved.set(alias, resolveThroughCtes(name, cteSources));
  for (const name of cteSources.keys()) resolved.set(name, resolveThroughCtes(name, cteSources));
  return resolved;
}

/**
 * Przechodzi łańcuch `CTE -> CTE -> … -> tabela`. Zbiór odwiedzonych chroni
 * przed cyklem (`WITH RECURSIVE` odwołuje się do samego siebie), więc bramka
 * nie zawiesza się na legalnym SQL-u.
 */
function resolveThroughCtes(start: string, cteSources: ReadonlyMap<string, string>): string {
  let current = start;
  const seen = new Set<string>([current]);
  for (;;) {
    const next = cteSources.get(current);
    if (!next || seen.has(next)) return current;
    seen.add(next);
    current = next;
  }
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

/**
 * Wołania funkcji, które MOGĄ budować wektor: `nes_posts_search_vector(…)`,
 * `…_tsvector(…)`. Wbudowane `to_tsvector` odpada, bo jego konfigurację
 * czytamy literałem.
 */
const VECTOR_BUILDER_CALL = /(?:public\.)?([a-z0-9_]*(?:search_vector|_tsvector))\s*\(/i;

/**
 * Tabele wiązane triggerami: nazwa funkcji triggera -> tabele, na których stoi.
 *
 * Wiązanie idzie POJEDYNCZĄ instrukcją `CREATE TRIGGER … ;`, a nie jednym
 * wzorcem przez cały plik. Wzorzec „od pierwszego CREATE TRIGGER do
 * EXECUTE FUNCTION <fn>" brał tabelę z PIERWSZEGO triggera w pliku: w migracji
 * stawiającej triggery `posts` i `pages` obok siebie kolumna `pages` lądowała
 * pod kluczem `posts.search_vector`, a `pages.search_vector` nie istniała dla
 * bramki wcale (i wychodziła jako „nierozstrzygnięta" w `search_quick`).
 *
 * Lista tabel, nie jedna tabela: jedna funkcja triggera bywa założona na kilku
 * tabelach i buduje wektor w każdej z nich.
 */
function triggerTables(sql: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const statement of sql.matchAll(/CREATE\s+TRIGGER\s+[a-z0-9_]+([\s\S]*?);/gi)) {
    const body = statement[1] ?? "";
    const table = /\bON\s+(?:public\.)?([a-z0-9_]+)/i.exec(body)?.[1]?.toLowerCase();
    const fn = /EXECUTE\s+(?:FUNCTION|PROCEDURE)\s+(?:public\.)?([a-z0-9_]+)/i
      .exec(body)?.[1]
      ?.toLowerCase();
    if (!table || !fn) continue;
    const tables = out.get(fn) ?? [];
    if (!tables.includes(table)) tables.push(table);
    out.set(fn, tables);
  }
  return out;
}

/** Surowy opis budowy kolumny wektorowej - rozwiązywany po wczytaniu migracji. */
interface VectorColumnDraft {
  readonly file: string;
  readonly literalConfigs: readonly string[];
  readonly builderNames: readonly string[];
}

/**
 * Rozkłada wyrażenie budujące wektor na literały i wołanych budowniczych.
 * Nazwy budowniczych zostają nierozwiązane - klasyfikuje je przebieg końcowy,
 * kiedy mapa `vectorBuilders` jest już kompletna.
 */
function vectorExpressionParts(expression: string): {
  literalConfigs: string[];
  builderNames: string[];
} {
  const literalConfigs = [...new Set(allMatches(expression, /to_tsvector\(\s*'([a-z0-9_.]+)'/i))];
  const builderNames = [
    ...new Set(
      allMatches(expression, VECTOR_BUILDER_CALL).filter(
        (name) => name.toLowerCase() !== "to_tsvector",
      ),
    ),
  ];
  return { literalConfigs, builderNames };
}

/** Zbiera fakty z WSZYSTKICH migracji; późniejsza definicja nadpisuje wcześniejszą. */
export function collectFtsFacts(sources: readonly MigrationSource[]): FtsFacts {
  const queryBuilders = new Map<string, ConfigFact>();
  const vectorBuilders = new Map<string, ConfigFact>();
  const vectorColumns = new Map<string, ConfigFact>();
  const mixedVectorColumns = new Map<string, readonly string[]>();
  const searchSurfaces = new Map<string, SearchSurface>();
  /** Wołani budowniczy per powierzchnia - klasyfikowani w przebiegu końcowym. */
  const builderCallsBySurface = new Map<string, string[]>();
  /** Budowa kolumn wektorowych - rozwiązywana w przebiegu końcowym. */
  const vectorColumnDrafts = new Map<string, VectorColumnDraft>();

  const ordered = [...sources].sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));

  for (const source of ordered) {
    const sql = stripSqlComments(source.sql);
    const triggers = triggerTables(sql);

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
        if (!name) continue;
        const parts = vectorExpressionParts(expression);
        if (parts.literalConfigs.length === 0 && parts.builderNames.length === 0) continue;
        vectorColumnDrafts.set(`${table}.${name}`, { file: source.file, ...parts });
      }
    }

    for (const { fn, body, returns } of functionBodies(sql)) {
      // (1a) Budowniczy zapytań.
      if (/RETURNS\s+tsquery/i.test(returns)) {
        const configs = allMatches(body, new RegExp(`${QUERY_FN}\\(\\s*'([a-z0-9_.]+)'`, "i"));
        if (configs[0]) queryBuilders.set(fn, { config: configs[0], file: source.file });
      }

      // (1b) Budowniczy wektorów. Konfiguracji jest tu zwykle kilka sztuk
      // (`setweight(to_tsvector('simple', …), 'A') || …`), ale MUSZĄ być
      // identyczne - inaczej kolumna jest zszyta z dwóch konfiguracji i żadne
      // zapytanie nie będzie symetryczne wobec obu połówek.
      if (/RETURNS\s+tsvector/i.test(returns)) {
        const configs = [...new Set(allMatches(body, /to_tsvector\(\s*'([a-z0-9_.]+)'/i))];
        if (configs.length === 1 && configs[0]) {
          vectorBuilders.set(fn, { config: configs[0], file: source.file });
        }
      }

      // (2b) Trigger budujący wektor: `NEW.<kolumna> := … to_tsvector('cfg' …`.
      for (const assignment of body.matchAll(/NEW\.([a-z0-9_]+)\s*:=([\s\S]*?);/gi)) {
        const column = assignment[1];
        const expression = assignment[2] ?? "";
        if (!column) continue;
        const parts = vectorExpressionParts(expression);
        if (parts.literalConfigs.length === 0 && parts.builderNames.length === 0) continue;
        // Tabelę wiąże `CREATE TRIGGER … ON public.<tabela> … EXECUTE FUNCTION <fn>`.
        for (const table of triggers.get(fn.toLowerCase()) ?? []) {
          vectorColumnDrafts.set(`${table}.${column}`, { file: source.file, ...parts });
        }
      }

      // (3) Powierzchnia szukająca: ciało z porównaniem `@@`.
      if (!body.includes("@@")) continue;
      const literals = allMatches(body, new RegExp(`${QUERY_FN}\\(\\s*'([a-z0-9_.]+)'`, "i"));
      const builderCalls = allMatches(body, /(?:public\.)?([a-z0-9_]*_tsquery(?:_adv)?)\s*\(/i);
      // Zapisujemy tylko NAZWY wołanych budowniczych. Na „znany"/„nieznany"
      // dzieli je drugi przebieg, a ich konfigurację czyta
      // `surfaceQueryConfigs` - obie decyzje wymagają KOMPLETNEJ mapy
      // budowniczych, której w połowie katalogu migracji jeszcze nie ma.
      const calls = [
        ...new Set(
          builderCalls.filter((call) => call !== fn && !BUILTIN_QUERY_FNS.has(call.toLowerCase())),
        ),
      ];
      builderCallsBySurface.set(fn, calls);
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
        literalQueryConfigs: [...new Set(literals)],
        headlineConfigs: [...new Set(allMatches(body, /ts_headline\(\s*'([a-z0-9_.]+)'/i))],
        vectorColumns: [...new Set(vectorRefs)],
        unresolvedVectorRefs: [...new Set(unresolvedAliases)],
        unresolvedBuilders: [],
        builderNames: [],
      });
    }
  }

  // Przebieg końcowy (A): kolumny wektorowe rozwiązujemy przez budowniczych na
  // KOMPLETNEJ mapie, a plik faktu bierzemy jako PÓŹNIEJSZY z pary
  // „migracja kolumny / migracja budowniczego". Bez tego migracja przestawiająca
  // sam budowniczy nie ruszałaby daty zależności kolumny i wypadała z zakresu -
  // ta sama pułapka, którą `effectiveScopeFile` zamyka po stronie powierzchni.
  for (const [key, draft] of vectorColumnDrafts) {
    const configs = new Set<string>(draft.literalConfigs);
    let file = draft.file;
    let resolvable = true;
    for (const name of draft.builderNames) {
      const fact = vectorBuilders.get(name);
      if (!fact) {
        resolvable = false;
        continue;
      }
      configs.add(fact.config);
      if (fact.file > file) file = fact.file;
    }
    if (configs.size > 1) {
      mixedVectorColumns.set(key, [...configs]);
      continue;
    }
    const [config] = [...configs];
    if (!resolvable || !config) continue;
    vectorColumns.set(key, { config, file });
  }

  // Przebieg końcowy (B): budowniczych zapytań dzielimy na znanych i nieznanych
  // dopiero na KOMPLETNEJ mapie. W jednym przebiegu powierzchnia zdefiniowana
  // przed swoim budowniczym (ciało plpgsql nie jest walidowane przy tworzeniu)
  // trafiałaby do `unresolved` - a od zaostrzenia bramki to zatrzymuje CI.
  for (const [fn, calls] of builderCallsBySurface) {
    const surface = searchSurfaces.get(fn);
    if (!surface) continue;
    const known: string[] = [];
    const missing: string[] = [];
    for (const call of calls) (queryBuilders.has(call) ? known : missing).push(call);
    searchSurfaces.set(fn, { ...surface, builderNames: known, unresolvedBuilders: missing });
  }

  return { queryBuilders, vectorBuilders, vectorColumns, mixedVectorColumns, searchSurfaces };
}

export type FtsViolationKind =
  /** Zapytanie i podświetlenie w RÓŻNYCH konfiguracjach. */
  | "query-headline-mismatch"
  /** Dwie różne konfiguracje na stronie zapytania w jednym ciele. */
  | "mixed-query-configs"
  /** Wektor budowany inaczej, niż jest odpytywany - defekt z 20.07.2026. */
  | "vector-query-mismatch"
  /** Kolumna wektorowa zszyta z dwóch konfiguracji - nie da się jej odpytać. */
  | "mixed-vector-configs";

export interface FtsViolation {
  readonly kind: FtsViolationKind;
  readonly fn: string;
  readonly file: string;
  readonly detail: string;
}

export interface FtsSymmetryReport {
  readonly violations: readonly FtsViolation[];
  /**
   * Powierzchnie OBJĘTE ZAKRESEM, których bramka nie rozstrzygnęła.
   *
   * To jest BŁĄD BRAMKI, nie nota diagnostyczna - patrz `gateFailed`.
   * Powierzchnia, której symetrii nie dało się sprawdzić, przechodziła
   * wcześniej jako zielona, bo raport mówił „OK", gdy tylko lista naruszeń była
   * pusta. Bramka, która nie widzi, ma powiedzieć „nie wiem" i zatrzymać CI -
   * inaczej jej zieleń nic nie znaczy, a to dokładnie ta klasa defektu, przed
   * którą ten moduł ma chronić.
   */
  readonly unresolved: readonly string[];
  /** Ile powierzchni szukających sprawdzono (raport ma pokazywać zasięg). */
  readonly surfacesChecked: number;
}

/**
 * Czy bramka jest CZERWONA. Zarówno asymetria, jak i nierozstrzygnięcie
 * powierzchni objętej zakresem zatrzymują CI.
 */
export function gateFailed(report: FtsSymmetryReport): boolean {
  return report.violations.length > 0 || report.unresolved.length > 0;
}

/**
 * Najnowszy plik, od którego ZALEŻY ta powierzchnia: własna definicja, pliki
 * definicji jej kolumn wektorowych i pliki definicji wołanych budowniczych.
 *
 * Sama data definicji funkcji NIE WYSTARCZA. `collectFtsFacts` aktualizuje
 * wektory i budowniczych niezależnie od powierzchni, więc nowa migracja może
 * przebudować `messages.search_vector` na inną konfigurację i zepsuć STARĄ
 * funkcję szukającą - a ta, oceniana po własnej dacie, wypadłaby z zakresu.
 * Zakres liczony z zależności łapie właśnie tę regresję.
 */
export function effectiveScopeFile(surface: SearchSurface, facts: FtsFacts): string {
  let newest = surface.file;
  for (const key of surface.vectorColumns) {
    const fact = facts.vectorColumns.get(key);
    if (fact && fact.file > newest) newest = fact.file;
  }
  for (const name of surface.builderNames) {
    const fact = facts.queryBuilders.get(name);
    if (fact && fact.file > newest) newest = fact.file;
  }
  return newest;
}

/**
 * Ocena symetrii. Oceniamy powierzchnie, których NAJNOWSZA ZALEŻNOŚĆ pochodzi
 * z migracji od `SYMMETRY_ENFORCED_FROM` w górę - starsze pliki są zamrożoną
 * historią, a ich długi zostały spłacone nowszymi definicjami. Liczymy po
 * zależnościach, nie po samej dacie funkcji: patrz `effectiveScopeFile`.
 */
export function analyzeFtsSymmetry(
  facts: FtsFacts,
  enforcedFrom: string = SYMMETRY_ENFORCED_FROM,
): FtsSymmetryReport {
  const violations: FtsViolation[] = [];
  const unresolved: string[] = [];
  let surfacesChecked = 0;

  for (const surface of facts.searchSurfaces.values()) {
    if (effectiveScopeFile(surface, facts) < enforcedFrom) continue;
    surfacesChecked += 1;

    if (surface.unresolvedBuilders.length > 0) {
      unresolved.push(`${surface.fn} (budowniczy: ${surface.unresolvedBuilders.join(", ")})`);
    }
    if (surface.unresolvedVectorRefs.length > 0) {
      unresolved.push(`${surface.fn} (alias: ${surface.unresolvedVectorRefs.join(", ")})`);
    }

    const queryConfigs = surfaceQueryConfigs(surface, facts);
    if (queryConfigs.length > 1) {
      violations.push({
        kind: "mixed-query-configs",
        fn: surface.fn,
        file: surface.file,
        detail: `strona zapytania miesza konfiguracje: ${queryConfigs.join(" vs ")}`,
      });
    }

    const queryConfig = queryConfigs[0];
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
      // Kolumna zszyta z dwóch konfiguracji jest defektem SAMA W SOBIE -
      // bramka ją WIDZI, więc to naruszenie, nie luka w widoczności.
      const mixed = facts.mixedVectorColumns.get(key);
      if (mixed) {
        violations.push({
          kind: "mixed-vector-configs",
          fn: surface.fn,
          file: surface.file,
          detail: `wektor ${key} budowany w dwoch konfiguracjach: ${mixed.join(" vs ")}`,
        });
        continue;
      }
      const vectorFact = facts.vectorColumns.get(key);
      // Kolumna, której budowy bramka nie widziała (wektor liczony poza
      // migracjami albo dynamicznie), NIE jest naruszeniem - jest luką
      // w widoczności i mówimy o niej wprost.
      if (!vectorFact) {
        unresolved.push(`${surface.fn} (wektor: ${key})`);
        continue;
      }
      if (vectorFact.config === queryConfig) continue;
      violations.push({
        kind: "vector-query-mismatch",
        fn: surface.fn,
        file: surface.file,
        detail: `wektor ${key} budowany w '${vectorFact.config}' (${vectorFact.file}), odpytywany w '${queryConfig}'`,
      });
    }
  }

  return { violations, unresolved, surfacesChecked };
}

/** Czy powierzchnia FTS jest bez fleksji (diagnostyka raportu, nie naruszenie). */
export function isStemless(config: string): boolean {
  return STEMLESS_CONFIGS.has(config);
}

/**
 * Raport bramki. Słowo „OK" pojawia się WYŁĄCZNIE wtedy, gdy nie ma ani
 * naruszeń, ani nierozstrzygnięć - inaczej raport ogłaszałby zieleń nad
 * powierzchnią, której nie sprawdził.
 */
export function renderFtsSymmetryReport(report: FtsSymmetryReport): string {
  const lines: string[] = [];
  lines.push(`FTS: sprawdzono ${report.surfacesChecked} powierzchni szukajacych.`);
  if (report.unresolved.length > 0) {
    lines.push(`NIEROZSTRZYGNIETE powierzchnie objete zakresem (${report.unresolved.length}):`);
    for (const item of report.unresolved) {
      lines.push(`  [unresolved] ${item}`);
    }
    lines.push("  Bramka nie potrafila odczytac konfiguracji tej powierzchni, wiec NIE moze");
    lines.push("  potwierdzic jej symetrii. Rozszerz analizator (aliasy, budowniczy) albo");
    lines.push("  zapisz konfiguracje literalem w migracji.");
  }
  if (report.violations.length > 0) {
    lines.push(`ASYMETRIA FTS (${report.violations.length}):`);
    for (const violation of report.violations) {
      lines.push(
        `  [${violation.kind}] ${violation.file} :: ${violation.fn} - ${violation.detail}`,
      );
    }
  }
  if (!gateFailed(report)) {
    lines.push("Symetria wektor <-> zapytanie <-> podswietlenie: OK.");
  }
  return lines.join("\n");
}
