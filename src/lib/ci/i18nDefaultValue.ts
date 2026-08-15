// Czysta logika bramki: `t()` NIE NOSI ZAPASOWEGO TEKSTU.
//
// CZYM JEST TEN DŁUG. `t("admin.save", { defaultValue: "Zapisz" })` renderuje
// wartość ze słownika ZAWSZE, kiedy klucz istnieje - i18next sięga po
// `defaultValue` wyłącznie wtedy, gdy klucza NIE MA. Bramka rozjazdu
// (`src/__tests__/i18nKeyDrift.gate.test.ts`) dowodzi przy każdym przebiegu, że
// nie ma ani jednego takiego klucza. Z tych dwóch faktów wynika trzeci: każdy
// `defaultValue` w tym repo jest MARTWYM KODEM - linią, która nie ma jak się
// wykonać.
//
// DLACZEGO MARTWY KOD AKURAT TU SZKODZI, A NIE TYLKO ZAJMUJE MIEJSCE:
//   * jest to DRUGIE ŹRÓDŁO PRAWDY o tym samym napisie. Redaktor poprawia
//     literówkę w słowniku, `defaultValue` zostaje ze starą - i nikt się nie
//     dowie, bo obie wersje są „poprawne" dla kompilatora;
//   * to jedyny nośnik klasy `masked` z bramki rozjazdu: usunięcie klucza ze
//     słownika przestaje być widoczne (zamiast gołego klucza na ekranie
//     pojawia się polski tekst z kodu, także w interfejsie angielskim);
//   * zamyka drogę do trzeciego języka tak samo jak ternary po języku - tekst
//     żyje w kodzie, więc tłumacz go nie widzi.
//
// DLACZEGO USUWANIE JEST DOWODLIWIE BEZPIECZNE. Warunek usunięcia nie brzmi
// „wygląda na zbędny", tylko: klucz ma LIŚĆ TEKSTOWY W PL I W EN. Wtedy
// `defaultValue` jest gałęzią nieosiągalną i jego zniknięcie nie może zmienić
// ani jednego wyrenderowanego znaku. Miejsce, w którym warunek nie zachodzi,
// zostaje NIETKNIĘTE i wychodzi w raporcie jako `load-bearing` - to jest realny
// brak w słowniku, czyli robota do zrobienia, a nie linia do skasowania.
//
// PRZECIWNY ARGUMENT I DLACZEGO NIE WYGRYWA. Poprzednia decyzja brzmiała:
// „nie kasujemy hurtem, bo 1 263 zmiany bez zmiany zachowania to diff, którego
// nikt nie przeczyta". Argument jest słuszny wobec zmiany RĘCZNEJ - i przestaje
// być słuszny wobec zmiany, która jest generowana mechanicznie z warunku
// sprawdzalnego per wystąpienie, a potem pilnowana bramką. Czytelnik nie musi
// czytać 1 263 miejsc; musi przeczytać warunek i sprawdzić, że bramka go
// egzekwuje. Dług tymczasem NIE malał sam z siebie - między 13.08 a 15.08
// urósł, i to jest jedyny dowód, jakiego ta decyzja potrzebowała.
import {
  KEY_SHAPE,
  PLURAL_SUFFIXES,
  IDENT_BEFORE_T,
  lineOf,
  maskComments,
  parseCallArgs,
  prefixAt,
  readKeyPrefixScopes,
  type SourceSpan,
} from "./i18nKeyUsage";
import { readKey, type ResourceTree } from "./i18nParity";

/** Postać, w jakiej i18next przyjmuje zapasowy tekst. */
export type DefaultValueForm =
  /** `t("k", "Zapasowy")` / `t("k", "Zapasowy", { count })` - drugi argument. */
  | "positional"
  /** `t("k", { defaultValue: "Zapasowy" })` - opcja w obiekcie. */
  | "option";

export type DefaultValueVerdict =
  /** Klucz ma liść tekstowy w PL i EN - `defaultValue` jest nieosiągalny. */
  | "redundant"
  /** Klucz nie ma liścia po którejś ze stron - tekst z kodu JEST renderowany. */
  | "load-bearing"
  /**
   * Klucz składany w locie, a zapas jest LITERAŁEM - czyli tekstem dla
   * użytkownika wpisanym w kod, tyle że pod inną nazwą.
   */
  | "dynamic"
  /**
   * Klucz składany w locie, a zapas NIE NIESIE TEKSTU DLA UŻYTKOWNIKA. Dwa
   * poprawne warianty tej samej intencji „nie pokazuj gołego klucza":
   *
   *   t(`...tickReason.${code}`, { defaultValue: code })  - wyrażenie: pokaż
   *     operatorowi surowy kod błędu, którego słownik nie zna;
   *   t(`search.dim.${dim}`, { defaultValue: "" })        - pusty literał: dla
   *     nieznanego wymiaru nie renderuj NICZEGO.
   *
   * W obu wypadkach do słownika nie ma czego przenieść, bo nie ma tu zdania
   * w żadnym języku - a to jest jedyne kryterium tej bramki.
   */
  | "runtime-passthrough";

export interface DefaultValueSite {
  readonly file: string;
  readonly verdict: DefaultValueVerdict;
  /** 1-indeksowana linia wywołania `t()`. */
  readonly line: number;
  /** Klucz po doklejeniu `keyPrefix` z haka, albo surowa głowa template'a. */
  readonly key: string;
  readonly form: DefaultValueForm;
  /** Treść zapasowego tekstu - do raportu przy `load-bearing`. */
  readonly text: string;
  /**
   * Zapasowy tekst jest template'em z interpolacją (`` `Zaznaczono: ${n}` ``).
   * Nie zmienia werdyktu (nieosiągalna gałąź jest nieosiągalna niezależnie od
   * treści), ale trafia do raportu osobno: wartość w słowniku musi wtedy nieść
   * `{{zmienną}}`, a wywołanie musi ją przekazać - i to warto zobaczyć oczami.
   */
  readonly interpolated: boolean;
  /** Czy wywołanie przekazuje `count` (klucz rozwija się na formy mnogie). */
  readonly plural: boolean;
  /** Dokładny wycinek źródła do usunięcia (offsety w ORYGINALNYM pliku). */
  readonly removal: SourceSpan;
}

// ---------------------------------------------------------------------------
// Parser właściwości obiektu literalnego
// ---------------------------------------------------------------------------

interface ObjectProperty {
  readonly name: string;
  /** Początek nazwy właściwości. */
  readonly start: number;
  /** Koniec wartości (przed przecinkiem separującym). */
  readonly end: number;
}

interface ObjectLiteral {
  /** Indeks `{`. */
  readonly open: number;
  /** Indeks `}`. */
  readonly close: number;
  readonly properties: readonly ObjectProperty[];
}

const IDENT_CHAR = /[A-Za-z0-9_$]/;

/**
 * Rozbiera obiekt literalny na właściwości NAJWYŻSZEGO poziomu. Zagnieżdżone
 * obiekty, tablice, wywołania, łańcuchy i komentarze są przeskakiwane w całości,
 * więc `{ opts: { defaultValue: "x" }, count }` zwraca `opts` i `count`, a nie
 * zagnieżdżony `defaultValue`.
 *
 * Zwraca `null`, gdy argument nie jest obiektem literalnym (zmienna, spread na
 * wejściu, wywołanie) - takiego miejsca codemod nie dotyka.
 */
export function parseObjectLiteral(text: string, offset = 0): ObjectLiteral | null {
  const open = text.indexOf("{");
  if (open === -1 || text.slice(0, open).trim() !== "") return null;

  const properties: ObjectProperty[] = [];
  let depth = 0;
  let quote: string | null = null;
  let index = open;
  let nameStart: number | null = null;
  let name: string | null = null;
  let valueStart: number | null = null;

  const flush = (end: number): void => {
    if (name !== null && nameStart !== null) {
      // Koniec wartości bez końcowych białych znaków: bez tego usunięcie
      // OSTATNIEJ właściwości zjadałoby spację przed `}` i dawało `{ count: n}`.
      let stop = end;
      while (stop > nameStart && /\s/.test(text[stop - 1])) stop -= 1;
      properties.push({ name, start: nameStart + offset, end: stop + offset });
    }
    name = null;
    nameStart = null;
    valueStart = null;
  };

  while (index < text.length) {
    const ch = text[index];
    const next = text[index + 1];

    if (quote !== null) {
      if (ch === "\\") {
        index += 2;
        continue;
      }
      if (ch === quote) quote = null;
      index += 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      index += 1;
      continue;
    }
    if (ch === "/" && next === "/") {
      const eol = text.indexOf("\n", index);
      index = eol === -1 ? text.length : eol;
      continue;
    }
    if (ch === "/" && next === "*") {
      const close = text.indexOf("*/", index);
      index = close === -1 ? text.length : close + 2;
      continue;
    }
    if (ch === "{" || ch === "[" || ch === "(") {
      depth += 1;
      index += 1;
      continue;
    }
    if (ch === "}" || ch === "]" || ch === ")") {
      depth -= 1;
      if (depth === 0 && ch === "}") {
        flush(index);
        return { open: open + offset, close: index + offset, properties };
      }
      index += 1;
      continue;
    }
    if (depth === 1) {
      if (ch === ",") {
        flush(index);
        index += 1;
        continue;
      }
      if (ch === ":" && name !== null && valueStart === null) {
        valueStart = index + 1;
        index += 1;
        continue;
      }
      if (name === null && IDENT_CHAR.test(ch)) {
        nameStart = index;
        let cursor = index;
        while (cursor < text.length && IDENT_CHAR.test(text[cursor])) cursor += 1;
        name = text.slice(index, cursor);
        index = cursor;
        continue;
      }
    }
    index += 1;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Skan
// ---------------------------------------------------------------------------

/** Literał napisowy w całości (bez sklejania i bez interpolacji w `"` / `'`). */
function readStringLiteral(raw: string): { text: string; interpolated: boolean } | null {
  const text = raw.trim();
  if (text.length < 2) return null;
  const quote = text[0];
  if (quote !== '"' && quote !== "'" && quote !== "`") return null;
  if (text[text.length - 1] !== quote) return null;
  const inner = text.slice(1, -1);
  // Łańcuch sklejany (`"a" + b`) - nie pojedynczy literał.
  if (inner.includes(quote)) return null;
  return { text: inner, interpolated: quote === "`" && inner.includes("${") };
}

function hasCountOption(args: readonly string[]): boolean {
  return args
    .slice(1)
    .filter((arg) => readStringLiteral(arg) === null)
    .some((arg) => /(^|[^A-Za-z0-9_$])count\s*[:,}]/.test(arg));
}

/**
 * Wycinek do usunięcia dla argumentu POZYCYJNEGO: od końca argumentu
 * poprzedzającego (czyli razem z przecinkiem separującym) do końca tego
 * argumentu. `t("k", "X", opts)` -> `t("k", opts)`, `t("k", "X")` -> `t("k")`.
 */
function positionalRemoval(spans: readonly SourceSpan[], at: number): SourceSpan {
  return { start: spans[at - 1].end, end: spans[at].end };
}

/**
 * Wycinek do usunięcia dla WŁAŚCIWOŚCI obiektu opcji. Gdy `defaultValue` jest
 * jedyną właściwością, znika cały argument (inaczej zostałby pusty `{}`, czyli
 * szum zamiast czystego `t("k")`). Gdy ma rodzeństwo - znika sama właściwość
 * wraz z jednym przecinkiem: następującym, a dla ostatniej właściwości
 * poprzedzającym.
 */
function optionRemoval(
  source: string,
  spans: readonly SourceSpan[],
  at: number,
  literal: ObjectLiteral,
  property: ObjectProperty,
): SourceSpan {
  if (literal.properties.length === 1) return positionalRemoval(spans, at);

  const index = literal.properties.indexOf(property);
  const isLast = index === literal.properties.length - 1;
  if (!isLast) {
    // Do początku następnej właściwości - zabiera przecinek i odstęp.
    return { start: property.start, end: literal.properties[index + 1].start };
  }
  // Ostatnia: cofamy się do przecinka zamykającego poprzednią właściwość.
  let cursor = property.start - 1;
  while (cursor > literal.open && source[cursor] !== ",") cursor -= 1;
  return { start: cursor === literal.open ? property.start : cursor, end: property.end };
}

export interface ScannedSource {
  readonly file: string;
  readonly source: string;
}

interface RawSite {
  readonly file: string;
  readonly line: number;
  readonly key: string;
  readonly dynamic: boolean;
  /** Zapas jest literałem napisowym, a nie wyrażeniem. */
  readonly literalText: boolean;
  readonly form: DefaultValueForm;
  readonly text: string;
  readonly interpolated: boolean;
  readonly plural: boolean;
  readonly removal: SourceSpan;
}

/**
 * Czy plik deklaruje WŁASNE `t`, przesłaniające `t` z i18next.
 *
 * DLACZEGO TO MUSI BYĆ ODDZIELONE. W repo żyje wzorzec
 * `const t = (pl: string, en: string) => (lang === "pl" ? pl : en)` - bliźniak
 * językowy nazwany dokładnie tak, jak funkcja tłumacząca. Dla czytelnika w
 * review `t("Kolumny", "Columns")` wygląda jak wywołanie i18next z zapasem;
 * naprawdę jest to twardy dwujęzyczny tekst w kodzie, czyli ta sama klasa co
 * `isPl ? "Kolumny" : "Columns"`. Bramka `check:i18n-hardcoded` go NIE widzi,
 * bo jej wzorzec bliźniaka to `[lLT](` - jednoliterowe nazwy WIELKIE plus `l`,
 * bez małego `t`, właśnie po to, żeby nie łapać i18next.
 *
 * Skutek: najbardziej mylący wariant długu językowego był jedynym niepilnowanym.
 * Ten skaner go nazywa i oddaje do `check:i18n-hardcoded` (klasa `twin-helper`),
 * zamiast liczyć jego argumenty jako `defaultValue`.
 *
 * CO TA FUNKCJA WYŁĄCZA, A CZEGO NIE. Wyłącza WYŁĄCZNIE wywołania NIEKWALIFIKOWANE
 * (`t(...)`), bo tylko one mogą trafić na lokalne przesłonięcie. Wywołanie
 * `i18n.t(...)` sięga po instancję wprost i żadna lokalna zmienna go nie dotyczy,
 * więc jest skanowane zawsze.
 *
 * Pierwsza wersja pomijała CAŁY PLIK i to była dziura: `SearchAutosuggest.tsx`
 * deklaruje lokalne `t` w linii 98, a w linii 167 woła
 * `i18n.t("search.title", { defaultValue: "Szukaj" })` - prawdziwy zapas przy
 * prawdziwym i18next, którego bramka z progiem zero nie widziała i raportowała
 * zero. Zgłoszone w review PR-a #235.
 */
export function declaresLocalT(source: string): boolean {
  return /\b(?:const|let|var)\s+t\s*=|\bfunction\s+t\s*\(/.test(maskComments(source));
}

/**
 * Wywołania `t()` niosące zapasowy tekst, wraz z dokładnym wycinkiem do
 * usunięcia. Skan chodzi po źródle z ZAMASKOWANYMI komentarzami, a maskowanie
 * zachowuje długość pliku - offsety pasują więc do oryginału bez przeliczania.
 */
function scanFile(file: string, rawSource: string): RawSite[] {
  // Lokalne `t` przesłania WYŁĄCZNIE wywołania niekwalifikowane - `i18n.t(...)`
  // sięga po instancję wprost i jest skanowane zawsze (patrz `declaresLocalT`).
  const shadowed = declaresLocalT(rawSource);
  const source = maskComments(rawSource);
  const scopes = readKeyPrefixScopes(source);
  const out: RawSite[] = [];

  for (let i = 0; i < source.length - 1; i += 1) {
    if (source[i] !== "t" || source[i + 1] !== "(") continue;
    const before = i > 0 ? source[i - 1] : "";
    if (before !== "" && IDENT_BEFORE_T.test(before)) continue;
    if (shadowed && before !== ".") continue;

    const call = parseCallArgs(source, i + 1);
    if (call === null) continue;
    const [first, second] = call.args;
    if (first === undefined || second === undefined) continue;

    const keyLiteral = readStringLiteral(first);
    // `i18n.t(...)` omija hak, więc nie dostaje `keyPrefix` (jak w skanerze
    // rozjazdu - obie bramki muszą widzieć TEN SAM klucz).
    const scoped = before !== "." ? prefixAt(scopes, i) : null;
    // Kształt sprawdzamy na kluczu PO doklejeniu prefiksu. Skaner rozjazdu robi
    // to na surowym literale, przez co `t("save")` pod `keyPrefix: "admin"` jest
    // dla niego niewidzialne (KEY_SHAPE wymaga kropki). Tutaj takie wywołanie
    // musi zostać rozpoznane, bo inaczej wypadłoby na „dynamiczne" i oblewało
    // bramkę bez powodu.
    const composed =
      keyLiteral === null || keyLiteral.interpolated
        ? null
        : scoped === null
          ? keyLiteral.text
          : `${scoped}.${keyLiteral.text}`;
    const isStaticKey = composed !== null && KEY_SHAPE.test(composed);
    const key = isStaticKey ? composed : first.trim();

    const line = lineOf(source, i);
    const plural = hasCountOption(call.args);

    const positional = readStringLiteral(second);
    if (positional !== null) {
      out.push({
        file,
        line,
        key,
        dynamic: !isStaticKey,
        literalText: true,
        form: "positional",
        text: positional.text,
        interpolated: positional.interpolated,
        plural,
        removal: positionalRemoval(call.spans, 1),
      });
      continue;
    }

    for (let at = 1; at < call.args.length; at += 1) {
      const arg = call.args[at];
      if (readStringLiteral(arg) !== null) continue;
      const literal = parseObjectLiteral(arg, call.spans[at].start);
      if (literal === null) continue;
      const property = literal.properties.find((p) => p.name === "defaultValue");
      if (property === undefined) continue;

      const raw = source.slice(property.start, property.end);
      const valueRaw = raw.slice(raw.indexOf(":") + 1);
      const value = readStringLiteral(valueRaw);
      out.push({
        file,
        line,
        key,
        dynamic: !isStaticKey,
        literalText: value !== null,
        form: "option",
        text: value?.text ?? valueRaw.trim(),
        interpolated: value?.interpolated ?? true,
        plural,
        removal: optionRemoval(source, call.spans, at, literal, property),
      });
      break;
    }
  }
  return out;
}

/** Czy klucz ma liść tekstowy - wprost albo przez formy mnogie. */
function hasTextLeaf(tree: ResourceTree, key: string): boolean {
  if (typeof readKey(tree, key) === "string") return true;
  return PLURAL_SUFFIXES.some((suffix) => typeof readKey(tree, `${key}${suffix}`) === "string");
}

export interface DictionaryTrees {
  readonly pl: ResourceTree;
  readonly en: ResourceTree;
}

/**
 * Werdykt per wystąpienie. `redundant` wymaga liścia W OBU językach - klucz
 * obecny tylko w PL nadal renderuje `defaultValue` w interfejsie angielskim,
 * więc jego usunięcie ZMIENIŁOBY to, co widzi użytkownik.
 */
export function classifyDefaultValues(
  sources: readonly ScannedSource[],
  trees: DictionaryTrees,
): DefaultValueSite[] {
  return sources
    .flatMap(({ file, source }) => scanFile(file, source))
    .map((site) => {
      const carriesProse = site.literalText && site.text.trim() !== "";
      const verdict: DefaultValueVerdict = site.dynamic
        ? carriesProse
          ? "dynamic"
          : "runtime-passthrough"
        : hasTextLeaf(trees.pl, site.key) && hasTextLeaf(trees.en, site.key)
          ? "redundant"
          : "load-bearing";
      const { dynamic: _dynamic, literalText: _literalText, ...rest } = site;
      return { ...rest, verdict };
    });
}

// ---------------------------------------------------------------------------
// Przepisanie
// ---------------------------------------------------------------------------

/**
 * Wycina wskazane zakresy z jednego pliku. Cięcie idzie OD KOŃCA, więc offsety
 * wcześniejszych wystąpień pozostają ważne, a nakładające się zakresy (nie
 * powinny wystąpić - jedno wywołanie daje jedno wystąpienie) są odrzucane
 * zamiast wyprodukować śmieciowe źródło.
 */
export function removeDefaultValues(
  source: string,
  sites: readonly DefaultValueSite[],
): { source: string; removed: number } {
  const ordered = [...sites]
    .filter((site) => site.verdict === "redundant")
    .sort((a, b) => b.removal.start - a.removal.start);

  let out = source;
  let removed = 0;
  let lastStart = Number.POSITIVE_INFINITY;
  for (const site of ordered) {
    if (site.removal.end > lastStart) continue;
    out = out.slice(0, site.removal.start) + out.slice(site.removal.end);
    lastStart = site.removal.start;
    removed += 1;
  }
  return { source: out, removed };
}

// ---------------------------------------------------------------------------
// Raport bramki
// ---------------------------------------------------------------------------

export interface DefaultValueReport {
  /** Zbędne - do usunięcia; obecność któregokolwiek oblewa bramkę. */
  readonly redundant: readonly DefaultValueSite[];
  /** Realny brak w słowniku - `defaultValue` jest jedynym nośnikiem tekstu. */
  readonly loadBearing: readonly DefaultValueSite[];
  /** Klucz dynamiczny z literałem zapasu - tekst w kodzie pod inną nazwą. */
  readonly dynamic: readonly DefaultValueSite[];
  /** Przepuszczenie wartości runtime'owej - poprawny wzorzec, nie oblewa. */
  readonly passthrough: readonly DefaultValueSite[];
}

export function reportDefaultValues(sites: readonly DefaultValueSite[]): DefaultValueReport {
  return {
    redundant: sites.filter((s) => s.verdict === "redundant"),
    loadBearing: sites.filter((s) => s.verdict === "load-bearing"),
    dynamic: sites.filter((s) => s.verdict === "dynamic"),
    passthrough: sites.filter((s) => s.verdict === "runtime-passthrough"),
  };
}

/**
 * Bramka pada na KAŻDYM wystąpieniu, niezależnie od werdyktu - próg jest zerem,
 * nie ratchetem.
 *
 * Dlaczego `load-bearing` też oblewa, skoro tam tekst jest potrzebny: bo
 * potrzebny jest TEKST, a nie to miejsce. Brakujący klucz dopisuje się do
 * słownika w dwóch językach - to jest naprawa. Zostawienie go w kodzie to
 * zamrożenie rozjazdu, który bramka rozjazdu zgłasza jako `masked`.
 *
 * Dlaczego zero, a nie ratchet per plik jak w `i18n-hardcoded`: tamten dług ma
 * 1 593 wystąpienia i wymaga decyzji redakcyjnych (jak nazwać klucz, gdzie go
 * umieścić). Ten po konwersji ma ZERO i każde nowe wystąpienie jest usuwalne
 * mechanicznie w tym samym commicie, w którym powstało.
 */
export function defaultValueGateFailed(report: DefaultValueReport): boolean {
  return report.redundant.length + report.loadBearing.length + report.dynamic.length > 0;
}

/** Liczba wystąpień oblewających - do nagłówka raportu i do testów bramki. */
export function defaultValueDebt(report: DefaultValueReport): number {
  return report.redundant.length + report.loadBearing.length + report.dynamic.length;
}

function renderGroup(title: string, sites: readonly DefaultValueSite[], hint: string): string[] {
  if (sites.length === 0) return [];
  return [
    `${title}: ${sites.length}`,
    ...sites.slice(0, 25).map((s) => `  - ${s.file}:${s.line}  ${s.key}  "${s.text.slice(0, 60)}"`),
    ...(sites.length > 25 ? [`  ... i ${sites.length - 25} więcej`] : []),
    `  ${hint}`,
    "",
  ];
}

export function renderDefaultValueReport(report: DefaultValueReport, scanned: number): string {
  if (!defaultValueGateFailed(report)) {
    return (
      `[i18n-default-value] OK - 0 zapasowych tekstów przy t() w ${scanned} plikach` +
      ` (${report.passthrough.length} przepuszczeń wartości runtime'owej, świadomie dozwolone).`
    );
  }
  return [
    "[i18n-default-value] `t()` niesie zapasowy tekst - drugie źródło prawdy o tym samym napisie.",
    "",
    ...renderGroup(
      "ZBĘDNE (klucz jest w PL i EN, gałąź nieosiągalna)",
      report.redundant,
      "Napraw: bun run codemod:i18n-default-value",
    ),
    ...renderGroup(
      "NOŚNE (klucza brakuje w PL i/lub EN - tekst z kodu JEST renderowany)",
      report.loadBearing,
      "Napraw: dopisz klucz do słownika w OBU językach, potem usuń defaultValue.",
    ),
    ...renderGroup(
      "DYNAMICZNE Z LITERAŁEM (klucz składany w locie, zapas wpisany w kod)",
      report.dynamic,
      "Napraw: rozpisz gałąź na jawne klucze albo przekaż wartość runtime'ową zamiast literału.",
    ),
  ].join("\n");
}

/** Zasięg skanu - jak w bramce rozjazdu: cały `src` poza testami i fixture'ami. */
export function isScannable(file: string): boolean {
  if (!/\.tsx?$/.test(file)) return false;
  if (/\.(test|spec)\.tsx?$/.test(file)) return false;
  if (file.includes("/__tests__/")) return false;
  // Fixture'y skanerów deklarują `defaultValue` jako DANE testu bramki.
  if (file.startsWith("src/lib/ci/")) return false;
  return true;
}
