// Inwariant CI: TEKST WIDZIANY PRZEZ UŻYTKOWNIKA NIE STOI W KODZIE W JEDNYM
// JĘZYKU.
//
// LUKA, KTÓRĄ TA BRAMKA ZAMYKA. Repo ma trzy bramki i18n i żadna z nich nie
// widzi napisu JEDNOJĘZYCZNEGO renderowanego wprost:
//   * `check:i18n-parity` porównuje słownik PL ze słownikiem EN - widzi tylko
//     to, co JUŻ jest w słowniku;
//   * `hardcodedLanguage` łapie tekst DWUJĘZYCZNY (`isPl ? "Zapisz" : "Save"`,
//     `l("Zapisz","Save")`) - wymaga, żeby w kodzie stały OBIE wersje;
//   * `i18nDefaultValue` łapie zapasowy tekst przy `t()` - wymaga, żeby w tym
//     miejscu stało `t()`.
// `<span>Zapisz</span>`, `placeholder="Szukaj"`, `aria-label="Zamknij"` nie
// mają klucza, nie mają drugiej gałęzi i nie mają `t()`. Dla procesu
// tłumaczenia taki napis NIE ISTNIEJE: nikt nie wie, że jest do przełożenia,
// więc panel EN renderuje polszczyznę i nikt tego nie zgłasza, bo nie ma czego
// porównać.
//
// DWIE KLASY, KTÓRE MIERZYMY:
//   jsx-text   - literał będący dzieckiem elementu JSX (`<span>Zapisz</span>`);
//   prop-*     - literał w propsie docierającym do użytkownika: `placeholder`,
//                `title`, `aria-label`, `alt`, `label`, `aria-description`.
// Klasy są rozdzielone, bo mają różny koszt naprawy i różną wagę: `aria-label`
// czyta czytnik ekranu (dostępność w złym języku), `alt` idzie też do SEO,
// a `jsx-text` widzi każdy.
//
// DLACZEGO RATCHET PER PLIK, A NIE JEDEN LICZNIK - jak w `hardcodedLanguage`.
// Licznik globalny da się skompensować: ktoś ścina dwadzieścia wystąpień
// w jednym pliku i dopisuje dwadzieścia w innym, a bramka jest zielona. Lista
// per plik wymusza kierunek w KAŻDYM pliku osobno, a plik nieobecny na liście
// MUSI mieć zero - czyli nowy kod nie ma jak zacząć od długu. Trzymamy LICZBY
// per plik, nie pojedyncze wystąpienia: przy tej skali lista wystąpień miałaby
// tysiące wierszy i żaden diff nie byłby czytelny.

import { maskComments } from "@/lib/ci/i18nKeyUsage";

export interface ScannedSource {
  readonly file: string;
  readonly source: string;
}

export type MonolingualKind =
  | "jsx-text"
  | "prop-placeholder"
  | "prop-title"
  | "prop-aria-label"
  | "prop-alt"
  | "prop-label"
  | "prop-aria-description";

export interface MonolingualHit {
  readonly file: string;
  readonly line: number;
  readonly kind: MonolingualKind;
  /** Sam wykryty tekst - to on ma pójść do słownika. */
  readonly text: string;
  readonly snippet: string;
}

/**
 * Propsy DOCIERAJĄCE DO UŻYTKOWNIKA - allowlista, nie lista wyjątków.
 *
 * DLACZEGO ALLOWLISTA. Propsów technicznych jest nieskończenie wiele
 * (`className`, `id`, `href`, `type`, `role`, `data-*`, `key`, `name`
 * formularza, `variant`, `size`, `testId`, `slug`, `format`...), a każdy z nich
 * trzyma literał z liter. Lista zakazów byłaby wieczną pogonią i przy każdym
 * nowym propie technicznym dawałaby FAŁSZYWY alarm. Lista dozwoleń mierzy
 * dokładnie to, co użytkownik zobaczy albo usłyszy - i rośnie tylko świadomą
 * decyzją.
 *
 * Kolejność w alternatywie ma znaczenie: `aria-label` musi stać PRZED `label`,
 * inaczej krótszy wzorzec zżera dłuższy.
 */
const USER_FACING_PROPS: readonly { readonly prop: string; readonly kind: MonolingualKind }[] = [
  { prop: "aria-label", kind: "prop-aria-label" },
  { prop: "aria-description", kind: "prop-aria-description" },
  { prop: "placeholder", kind: "prop-placeholder" },
  { prop: "title", kind: "prop-title" },
  { prop: "alt", kind: "prop-alt" },
  { prop: "label", kind: "prop-label" },
];

/**
 * `(?<![\w-])` pilnuje, żeby nazwa propa nie była KOŃCÓWKĄ dłuższej nazwy:
 * bez tego `data-title="..."` liczyłby się jako `title`, a `data-*` jest
 * techniczne z definicji. `=` musi stać zaraz za nazwą (po opcjonalnych
 * spacjach), więc właściwość obiektu `title: "Zapisz"` NIE pasuje - to osobna,
 * znacznie większa klasa (patrz „POZA ZASIĘGIEM" niżej).
 */
const PROP_PATTERNS: readonly { readonly kind: MonolingualKind; readonly rx: RegExp }[] =
  USER_FACING_PROPS.map(({ prop, kind }) => ({
    kind,
    rx: new RegExp(`(?<![\\w-])${prop}\\s*=\\s*(["'])([^"'\\n]*)\\1`, "g"),
  }));

/**
 * Dziecko tekstowe elementu JSX - DWA kształty, bo prettier formatuje je
 * inaczej i jeden wzorzec musiałby być na tyle luźny, że łapałby kod.
 *
 * Tekst dziecka nie może zawierać `<`, `>`, `{` ani `}` - to nie heurystyka,
 * tak mówi gramatyka JSX. Dlatego klasa `[^<>{}]` NIGDY nie przechodzi przez
 * `<`, czyli terminatorem dopasowania jest zawsze PIERWSZY następny `<` lub
 * `{`. Na tym stoją oba wzorce.
 *
 * `inline` - `<span>Zapisz</span>`: tekst zaczyna się BEZPOŚREDNIO po `>`, bez
 *   spacji, i nie przechodzi do następnej linii. Brak spacji po `>` jest tu
 *   kluczowym rozróżnieniem wobec kodu: porównanie zapisane przez prettier ma
 *   spacje z obu stron (`if (a > b)`), więc nie pasuje. `(?<!=)` dodatkowo
 *   odcina strzałkę `=>`.
 *
 * `wrapped` - element z tekstem w osobnych liniach:
 *     <p className="...">
 *       Długie zdanie po polsku.
 *     </p>
 *   `>` kończy linię, tekst jest wcięty, a domknięciem MUSI być tag zamykający
 *   `</`. Warunek `</` jest tu tym, co trzyma precyzję: kod owinięty w wiele
 *   linii (`{count > 0 && (`, ternary na trzech liniach) trafia na `<Foo` albo
 *   na `{`, nie na `</`, więc się nie łapie.
 *
 * CZEGO TE WZORCE NIE ZOBACZĄ - świadomie, na rzecz precyzji: tekstu obok
 * elementu w tej samej linii (`<p>Tekst <b>x</b> dalej</p>` - „Tekst " kończy
 * się na `<b`, a „ dalej" zaczyna się spacją). Bramka woli policzyć mniej
 * i nie kłamać, niż oblewać na porównaniach liczb.
 */
const JSX_TEXT_PATTERNS: readonly RegExp[] = [
  /(?<!=)>([^\s<>{}][^<>{}\n]*?)(?=[<{])/g,
  /(?<!=)>[ \t]*\r?\n[ \t]*([^\s<>{}][^<>{}]*?)[ \t\r\n]*(?=<\/)/g,
];

/** Litery, na których nam zależy - alfabet łaciński z polskimi znakami. */
const LETTERS = "A-Za-zÀ-ÖØ-öø-ſĄąĆćĘęŁłŃńÓóŚśŹźŻż";
/** Co najmniej dwie litery pod rząd - „słowo", a nie znak. */
const HAS_WORD = new RegExp(`[${LETTERS}]{2,}`);
/** Znaki, które w tekście dla człowieka nie występują, a w kodzie tak. */
const CODE_CHARS = /[=;()[\]`$"'\\|&*+/@#~^]/;
/** Kształt identyfikatora: `created_at`, `waitlist_position`, `data-x`, `camelCase`. */
const IDENTIFIER_SHAPE = new RegExp(`^[${LETTERS}0-9]+(?:[_.-][${LETTERS}0-9]+)+$`);
/** Domena / host bez protokołu: `example.org`, `mysite.wordpress.com`. */
const DOMAIN_SHAPE = /^[\w-]+(?:\.[\w-]+)+$/;

/**
 * Wartości, które NIE są tekstem dla człowieka - każda z powodem.
 *
 * `pl` / `en` / `pl-PL` - KOD JĘZYKA. Do słownika nie ma tu czego przenieść,
 *   kanoniczny zapis to `uiLang(i18n.language)` (`lib/i18n/format.ts`).
 * `px` / `rem` / `ms` / `kB` - JEDNOSTKA. Ta sama w każdym języku.
 * `auto` / `none` / `true` - SŁOWO KLUCZOWE CSS/HTML, nie napis.
 * `PDF` / `CSV` / `EUR` - skrót i kod, patrz `SHORT_ACRONYM` niżej.
 */
const TECHNICAL_VALUES = new Set<string>([
  "pl",
  "en",
  "pl-PL",
  "en-US",
  "en-GB",
  "auto",
  "none",
  "true",
  "false",
  "null",
  "px",
  "em",
  "rem",
  "vh",
  "vw",
  "ms",
  "kB",
  "MB",
  "GB",
  "st",
  "szt",
  "min",
  "max",
]);

/**
 * Skrót w wersalikach do czterech znaków (`PDF`, `CSV`, `EUR`, `PLN`, `RSS`,
 * `API`) jest JĘZYKOWO NEUTRALNY - to samo słowo w PL i EN, więc przeniesienie
 * go do słownika nie daje tłumaczowi nic do zrobienia, a bramce daje szum.
 * Granica na czterech znakach jest świadoma: `ZAPISZ` (sześć) to napis
 * przycisku i MUSI się łapać - dowodzi tego test graniczny.
 */
const SHORT_ACRONYM = /^[A-Z0-9]{2,4}$/;

/**
 * Czy wartość jest tekstem, który człowiek przeczyta w interfejsie.
 *
 * Kolejność filtrów jest od najtańszego do najdroższego, ale wynik nie zależy
 * od kolejności - to koniunkcja warunków, nie kaskada wyjątków.
 */
export function isHumanText(raw: string): boolean {
  const text = raw.trim();
  // Encje HTML (`&nbsp;`, `&middot;`) to separatory, nie tekst - odcina je
  // CODE_CHARS przez `&`, ale sprawdzamy najpierw, żeby nie zależeć od tego.
  if (text === "") return false;
  // Bez dwóch liter pod rząd nie ma słowa: „12", „—", „:", „·", „1/2", „x".
  if (!HAS_WORD.test(text)) return false;
  // Znak z kodu w środku oznacza, że to nie jest napis dla człowieka, tylko
  // wyrażenie, URL, ścieżka, e-mail albo szablon.
  if (CODE_CHARS.test(text)) return false;
  if (TECHNICAL_VALUES.has(text)) return false;
  if (SHORT_ACRONYM.test(text)) return false;
  // Nagłówki techniczne eksportów CSV to w tym repo KONWENCJA, nie dług -
  // `CSV_COLUMNS` w `admin/newsletter/subscribers/subscriberTable.ts`
  // i `REGISTRATION_CSV_COLUMNS` w `lib/events/registrationsCsv.ts` są
  // `satisfies keyof Row`, czyli nazwy kolumn bazy. Ten sam kształt mają
  // wszystkie identyfikatory (`created_at`, `data-slot`, `kebab-case`).
  if (IDENTIFIER_SHAPE.test(text)) return false;
  if (DOMAIN_SHAPE.test(text)) return false;
  return true;
}

/**
 * Wygasza WNĘTRZA literałów napisowych, zachowując długość i podział na linie.
 *
 * DLACZEGO. Skan dzieci JSX szuka wzorca `>tekst<`. W literale napisowym takie
 * pary występują (szablony HTML maili, teksty z porównaniem „a > b < c"),
 * a literał NIE jest dzieckiem JSX - to osobna powierzchnia i osobna klasa
 * długu. Cudzysłowy zostają na miejscu, więc znaczniki pozycji się nie
 * przesuwają i numery linii dalej są prawdziwe.
 *
 * Komentarze wygasza `maskComments` PRZED tym krokiem - inaczej apostrof
 * w polskim komentarzu („ternary'ego") otwierałby tu literał.
 *
 * APOSTROF PO LITERZE NIE OTWIERA LITERAŁU. `<p>Don't</p>` ma apostrof
 * w środku słowa, a nie cudzysłów - i to nie jest zgadywanie: w JS literał
 * napisowy nie może zacząć się bezpośrednio po znaku identyfikatora, bo
 * `abc'x'` jest błędem składni. Bez tej reguły jeden apostrof w tekście JSX
 * wygaszałby resztę pliku do następnego cudzysłowu, czyli ZANIŻAŁ pomiar.
 * Do backticka reguła NIE stosuje się: `` styled.div`...` `` to tagowany
 * szablon i tam backtick po literze jest poprawny.
 */
export function blankStringBodies(source: string): string {
  const out = source.split("");
  const opensLiteral = (ch: string, prev: string): boolean => {
    if (ch === "`") return true;
    if (ch !== '"' && ch !== "'") return false;
    return !/[\w$]/.test(prev);
  };
  let quote: string | null = null;
  let index = 0;
  while (index < source.length) {
    const ch = source[index] ?? "";
    if (quote !== null) {
      if (ch === "\\") {
        index += 2;
        continue;
      }
      if (ch === quote) {
        quote = null;
        index += 1;
        continue;
      }
      if (ch !== "\n") out[index] = " ";
      index += 1;
      continue;
    }
    if (opensLiteral(ch, index > 0 ? (source[index - 1] ?? "") : "")) quote = ch;
    index += 1;
  }
  return out.join("");
}

/**
 * Pliki objęte skanem.
 *
 * TYLKO `.tsx`. Dzieci JSX i propsy JSX mogą istnieć wyłącznie w `.tsx` -
 * skanowanie `.ts` dałoby wyłącznie fałszywe trafienia z porównań `a > b`.
 */
export function isScannable(file: string): boolean {
  if (!/\.tsx$/.test(file)) return false;
  // Pliki testowe: tam jednojęzyczny napis jest DANYMI testu (fixture panelu,
  // asercja `getByText("Zapisz")`) - przeniesienie go do słownika zabrałoby
  // testowi to, co sprawdza.
  if (/\.(test|spec)\.tsx$/.test(file)) return false;
  if (file.includes("/__tests__/")) return false;
  // Słowniki trzymają tekst obu języków z definicji - to jest ich zadanie.
  if (/^src\/lib\/i18n-/.test(file)) return false;
  if (/^src\/lib\/locale\//.test(file)) return false;
  return true;
}

function lineAt(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < source.length; i += 1) {
    if (source[i] === "\n") line += 1;
  }
  return line;
}

export function scanMonolingualUserText(sources: readonly ScannedSource[]): MonolingualHit[] {
  const out: MonolingualHit[] = [];
  for (const { file, source: raw } of sources) {
    // Komentarze wygaszamy PRZED skanem, inaczej bramka liczy własną
    // dokumentację (przykłady `<span>Zapisz</span>` w tym pliku) i komentarze
    // opisowe. `maskComments` zachowuje długość i linie, więc numery linii
    // zostają prawdziwe - dlatego snippet bierzemy z `raw`, nie z maski.
    const masked = maskComments(raw);
    const lines = raw.split("\n");
    const push = (index: number, kind: MonolingualKind, text: string): void => {
      const line = lineAt(masked, index);
      out.push({ file, line, kind, text, snippet: (lines[line - 1] ?? "").trim().slice(0, 120) });
    };

    for (const { kind, rx } of PROP_PATTERNS) {
      for (const match of masked.matchAll(rx)) {
        const value = match[2] ?? "";
        if (!isHumanText(value)) continue;
        push(match.index ?? 0, kind, value.trim());
      }
    }

    // Skan dzieci JSX idzie po źródle z WYGASZONYMI wnętrzami literałów -
    // inaczej szablon HTML w literale („<td>Witaj</td>" w mailu) czytałby się
    // jak drzewo JSX. To osobna powierzchnia, poza zasięgiem tej bramki.
    const codeOnly = blankStringBodies(masked);
    for (const rx of JSX_TEXT_PATTERNS) {
      for (const match of codeOnly.matchAll(rx)) {
        const whole = match[0] ?? "";
        const captured = match[1] ?? "";
        // Przesunięcie grupy: `>` plus białe znaki przed tekstem. Tekst
        // czytamy z maski komentarzy, nie z `codeOnly` - w `codeOnly` treść
        // literałów jest wygaszona, a dyskwalifikowało dopasowanie ich
        // POŁOŻENIE, nie treść. Dzięki temu `text` w trafieniu jest prawdziwy.
        const lead = /^>\s*/.exec(whole)?.[0].length ?? 1;
        const start = (match.index ?? 0) + lead;
        const value = masked.slice(start, start + captured.length);
        if (!isHumanText(value)) continue;
        push(match.index ?? 0, "jsx-text", value.trim());
      }
    }
  }
  return out;
}

/** Rozkład trafień na klasy - do raportu, bo każda klasa ma inną naprawę. */
export function countsByKind(hits: readonly MonolingualHit[]): Map<MonolingualKind, number> {
  const out = new Map<MonolingualKind, number>();
  for (const hit of hits) out.set(hit.kind, (out.get(hit.kind) ?? 0) + 1);
  return out;
}

/** Liczba trafień per plik - postać wpisu w zamrożonym długu. */
export function countsByFile(hits: readonly MonolingualHit[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const hit of hits) out.set(hit.file, (out.get(hit.file) ?? 0) + 1);
  return out;
}

export interface RatchetReport {
  /** Plik poza baseline'em z niezerowym długiem - nowy kod nie może go mieć. */
  readonly fresh: readonly { readonly file: string; readonly count: number }[];
  /** Plik, który dług POWIĘKSZYŁ. */
  readonly grown: readonly { readonly file: string; readonly was: number; readonly now: number }[];
  /** Plik, który dług zmniejszył - baseline do zaktualizowania (w dół). */
  readonly improved: readonly {
    readonly file: string;
    readonly was: number;
    readonly now: number;
  }[];
  readonly total: number;
}

export function compareWithRatchet(
  hits: readonly MonolingualHit[],
  baseline: ReadonlyMap<string, number>,
): RatchetReport {
  const now = countsByFile(hits);
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
  return { fresh, grown, improved, total: hits.length };
}

/**
 * Bramka pada na NOWYM długu i na WZROŚCIE. Poprawa (`improved`) nie oblewa -
 * inaczej każde ścięcie kilku napisów wymuszałoby edycję baseline'u w tym samym
 * commicie i zniechęcało do drobnych porządków. Raport wypisuje ją jako
 * podpowiedź do odświeżenia listy.
 */
export function ratchetFailed(report: RatchetReport): boolean {
  return report.fresh.length > 0 || report.grown.length > 0;
}

export function renderRatchetReport(report: RatchetReport, baselineFiles: number): string {
  const lines: string[] = [];
  if (report.fresh.length > 0) {
    lines.push(
      `[i18n-monolingual] ${report.fresh.length} plików z NOWYM jednojęzycznym tekstem dla użytkownika:`,
      ...report.fresh.map((entry) => `  - ${entry.file}  (${entry.count})`),
      "",
      'Tekst dla użytkownika idzie do słownika i jest wołany przez `t("klucz")`.',
      "Napis wpisany wprost w JSX nie ma klucza, nie ma drugiej gałęzi i nie ma",
      "`t()` - więc NIE WIDZI GO ŻADNA z trzech bramek i18n i panel w drugim",
      "języku renderuje polszczyznę.",
    );
  }
  if (report.grown.length > 0) {
    lines.push(
      `[i18n-monolingual] ${report.grown.length} plików POWIĘKSZYŁO dług:`,
      ...report.grown.map((entry) => `  - ${entry.file}: ${entry.was} -> ${entry.now}`),
    );
  }
  if (lines.length === 0) {
    const head = `[i18n-monolingual] OK - ${report.total} znanych wystąpień w ${baselineFiles} plikach (ratchet trzyma kierunek).`;
    if (report.improved.length === 0) return head;
    return [
      head,
      `[i18n-monolingual] ${report.improved.length} plików ma MNIEJ długu niż baseline - zaktualizuj listę w dół:`,
      ...report.improved
        .slice(0, 20)
        .map((entry) => `  - ${entry.file}: ${entry.was} -> ${entry.now}`),
    ].join("\n");
  }
  return lines.join("\n");
}
