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
// STAN ZMIERZONY PRZY WDROŻENIU: 713 wystąpień w 163 plikach na 1 811
// skanowanych plikach `.tsx`. Rozkład: 394 dzieci JSX, 146 `label`,
// 71 `placeholder`, 66 `aria-label`, 24 `title`, 12 `alt`. Poza panelem
// administracyjnym leży 85 z nich w 42 plikach - reszta to panel.
//
// ZASIĘG: DZIECI I PROPSY JSX, NIE „KAŻDY POLSKI LITERAŁ”. To decyzja
// z pomiaru, nie oszczędność. Zmierzone klasy, które ZOSTAŁY POZA bramką:
//   * właściwości obiektów (`{ title: "Zapisz", label: "Anuluj" }`) - 2 205
//     wystąpień w 229 plikach. Kształt `nazwa: "literał"` jest nierozróżnialny
//     od konfiguracji, mapy wartości i danych seed - bramka na tym kształcie
//     miałaby więcej fałszywych alarmów niż trafień, a bramka, której się nie
//     wierzy, zostaje wyłączona;
//   * literały o kształcie zdania w plikach `.ts` (komunikaty błędów, teksty
//     maili, opisy w konfiguracji) - około 4 392 wystąpień. Część z nich NIGDY
//     nie dociera do użytkownika (logi, komunikaty dla developera), a bez
//     kontekstu JSX nie ma jak ich rozdzielić statycznie;
//   * szablony HTML w literałach (maile) - tam tekst jest wewnątrz napisu,
//     więc nie jest dzieckiem JSX; osobna powierzchnia, osobna bramka.
// Te trzy klasy są NAZWANE, a nie pominięte po cichu: bramka, która obejmuje
// część powierzchni i o tym nie mówi, czyta się jak „sprawdzone”.
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
 * znacznie większa klasa (patrz „POZA ZASIĘGIEM” niżej).
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
 * elementu w tej samej linii (`<p>Tekst <b>x</b> dalej</p>` - „Tekst ” kończy
 * się na `<b`, a „ dalej” zaczyna się spacją). Bramka woli policzyć mniej
 * i nie kłamać, niż oblewać na porównaniach liczb.
 */
const JSX_TEXT_PATTERNS: readonly RegExp[] = [
  /(?<!=)>([^\s<>{}][^<>{}\n]*?)(?=[<{])/g,
  /(?<!=)>[ \t]*\r?\n[ \t]*([^\s<>{}][^<>{}]*?)[ \t\r\n]*(?=<\/)/g,
];

/** Litery, na których nam zależy - alfabet łaciński z polskimi znakami. */
const LETTERS = "A-Za-zÀ-ÖØ-öø-ſĄąĆćĘęŁłŃńÓóŚśŹźŻż";
/** Co najmniej dwie litery pod rząd - „słowo”, a nie znak. */
const HAS_WORD = new RegExp(`[${LETTERS}]{2,}`);
/** Znaki, które w tekście dla człowieka nie występują, a w kodzie tak. */
const CODE_CHARS = /[=;()[\]`$"'\\|&*+/@#~^]/;
/**
 * Kształt identyfikatora: segmenty sklejone `_`, `-` albo `.` bez ani jednej
 * spacji - `created_at`, `waitlist_position`, `data-slot`, `obj.pole`. Tym
 * samym wzorcem łapie się domena bez protokołu (`example.org`,
 * `mysite.wordpress.com`), więc nie ma dla niej osobnej reguły: napis
 * BEZ SPACJI, złożony z segmentów przez kropkę, nie jest zdaniem dla człowieka.
 */
const IDENTIFIER_SHAPE = new RegExp(`^[${LETTERS}0-9]+(?:[_.-][${LETTERS}0-9]+)+$`);

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
 * MIARA: liczba ze skrótem jednostki (`1200px`, `-2px`, `1.5rem`, `16pt`,
 * `300ms`). Jednostka jest ta sama w każdym języku, a liczba nie jest tekstem.
 * Bez tej reguły `placeholder="-2px"` w kontrolce odstępu liczy się jako napis,
 * bo „px” to dwie litery pod rząd.
 */
const MEASURE_SHAPE = /^-?\d+(?:[.,]\d+)?\s?[A-Za-z]{1,4}$/;

/**
 * MASKA FORMATU: `MM:SS`, `HH:MM`, `DD.MM.YYYY`, `RRRR-MM-DD`. To instrukcja
 * dla pola formularza zapisana symbolami czasu, a nie zdanie - w drugim języku
 * wygląda identycznie.
 */
const FORMAT_MASK = /^[A-Z]{1,4}(?:[:.\-/][A-Z]{1,4})+$/;

/**
 * Ucina interpunkcję z brzegów przed KLASYFIKACJĄ (nie przed raportem).
 *
 * `PL:` to ten sam kod języka co `pl`, `NES-` ten sam prefiks kodu kuponu co
 * `NES`, a `NIP:` ten sam skrót co `NIP`. Bez tego kroku każda z tych wartości
 * potrzebowałaby WŁASNEGO wpisu na liście technicznej - czyli lista rosłaby
 * o warianty tej samej decyzji.
 */
function coreOf(text: string): string {
  return text.replace(/^[^\p{L}\p{N}]+/u, "").replace(/[^\p{L}\p{N}]+$/u, "");
}

/**
 * Czy wartość jest tekstem, który człowiek przeczyta w interfejsie.
 *
 * Kolejność filtrów jest od najtańszego do najdroższego, ale wynik nie zależy
 * od kolejności - to koniunkcja warunków, nie kaskada wyjątków.
 */
export function isHumanText(raw: string): boolean {
  const text = raw.trim();
  if (text === "") return false;
  // Bez dwóch liter pod rząd nie ma słowa: „12”, „—”, „:”, „·”, „1/2”, „x”.
  // To odcina liczby, separatory i pojedyncze znaki interpunkcyjne.
  if (!HAS_WORD.test(text)) return false;
  // Znak z kodu w środku oznacza, że to nie jest napis dla człowieka, tylko
  // wyrażenie, URL, ścieżka, e-mail, encja HTML albo szablon.
  if (CODE_CHARS.test(text)) return false;
  if (MEASURE_SHAPE.test(text)) return false;
  if (FORMAT_MASK.test(text)) return false;
  const core = coreOf(text);
  // Lista rozdzielona przecinkami, której KAŻDY element jest techniczny -
  // `placeholder="pl, en"` wylicza kody języka, nie podaje przykładu zdania.
  const parts = core.split(",").map((part) => part.trim());
  if (parts.every((part) => part !== "" && TECHNICAL_VALUES.has(part))) return false;
  if (SHORT_ACRONYM.test(core)) return false;
  // Nagłówki techniczne eksportów CSV to w tym repo KONWENCJA, nie dług -
  // `CSV_COLUMNS` w `admin/newsletter/subscribers/subscriberTable.ts`
  // i `REGISTRATION_CSV_COLUMNS` w `lib/events/registrationsCsv.ts` są
  // `satisfies keyof Row`, czyli nazwami kolumn bazy, i mają dokładnie ten
  // kształt. Ten sam kształt mają wszystkie identyfikatory w kodzie
  // (`created_at`, `data-slot`, `kebab-case`, `obj.pole`).
  // Ten sam wzorzec zdejmuje domeny i hosty (`example.org`) - patrz komentarz
  // przy `IDENTIFIER_SHAPE`.
  if (IDENTIFIER_SHAPE.test(core)) return false;
  return true;
}

/**
 * Wygasza WNĘTRZA literałów napisowych, zachowując długość i podział na linie.
 *
 * DLACZEGO. Skan dzieci JSX szuka wzorca `>tekst<`. W literale napisowym takie
 * pary występują (szablony HTML maili, teksty z porównaniem „a > b < c”),
 * a literał NIE jest dzieckiem JSX - to osobna powierzchnia i osobna klasa
 * długu. Cudzysłowy zostają na miejscu, więc znaczniki pozycji się nie
 * przesuwają i numery linii dalej są prawdziwe.
 *
 * Komentarze wygasza `maskComments` PRZED tym krokiem - inaczej apostrof
 * w polskim komentarzu („ternary'ego”) otwierałby tu literał.
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
    if (ch === "/") {
      const end = regexLiteralEnd(source, index);
      if (end !== null) {
        for (let i = index + 1; i < end; i += 1) out[i] = " ";
        index = end;
        continue;
      }
    }
    if (opensLiteral(ch, index > 0 ? (source[index - 1] ?? "") : "")) quote = ch;
    index += 1;
  }
  return out.join("");
}

/**
 * Pozycja operatorowa: po tych znakach `/` zaczyna LITERAŁ WYRAŻENIA
 * REGULARNEGO, a nie dzielenie. `(`, `,` i `=` pokrywają realny zapis w repo
 * (`.replace(/…/g, "")`, `const rx = /…/`), a `return` dostaje osobny warunek.
 */
const REGEX_OPERATOR_POSITION = /[(,=:[!&|?{};+\-*%~^<>\n]$/;

/**
 * Koniec literału regularnego zaczynającego się na `at`, albo `null`, jeśli to
 * nie jest regex.
 *
 * DLACZEGO TO JEST POTRZEBNE. `.replace(/on[a-z]+\s*=\s*"[^"]*"/gi, "")` ma
 * CZTERY cudzysłowy WEWNĄTRZ wyrażenia regularnego. Skaner literałów, który
 * o tym nie wie, rozjeżdża się na parzystości cudzysłowów i od tego miejsca
 * wygasza dokładnie odwrotne fragmenty pliku niż powinien - w
 * `WordPressPreviewDialog.tsx` odsłaniało to szablon HTML z literału
 * i bramka „widziała” w nim tekst dziecka JSX (`<style>body{…`). To był
 * jedyny FAŁSZYWY ALARM w pomiarze wdrożeniowym i dlatego ten kawałek istnieje.
 *
 * Literał regularny nie może zawierać surowego znaku nowej linii - napotkanie
 * go oznacza, że to było dzielenie, i wtedy zwracamy `null`.
 */
function regexLiteralEnd(source: string, at: number): number | null {
  const before = source.slice(Math.max(0, at - 8), at).trimEnd();
  const isRegex = before === "" || REGEX_OPERATOR_POSITION.test(before) || /\breturn$/.test(before);
  if (!isRegex) return null;
  let inClass = false;
  for (let i = at + 1; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "\\") {
      i += 1;
      continue;
    }
    if (ch === "\n") return null;
    if (ch === "[") inClass = true;
    else if (ch === "]") inClass = false;
    else if (ch === "/" && !inClass) return i;
  }
  return null;
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
  // `src/test/` to infrastruktura testów (atrapy ekranów, fixture'y widgetów) -
  // ten sam powód co wyżej: napis w atrapie jest danymi testu.
  if (/^src\/test\//.test(file)) return false;
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
      out.push({
        file,
        line,
        kind,
        // Tekst dziecka JSX bywa złamany na kilka linii przez prettiera -
        // do raportu i do porównań scalamy białe znaki, bo do słownika idzie
        // JEDNO zdanie, a nie jego formatowanie.
        text: text.replace(/\s+/g, " ").trim(),
        snippet: (lines[line - 1] ?? "").trim().slice(0, 120),
      });
    };

    for (const { kind, rx } of PROP_PATTERNS) {
      for (const match of masked.matchAll(rx)) {
        const value = match[2] ?? "";
        if (!isHumanText(value)) continue;
        push(match.index ?? 0, kind, value.trim());
      }
    }

    // Skan dzieci JSX idzie po źródle z WYGASZONYMI wnętrzami literałów -
    // inaczej szablon HTML w literale („<td>Witaj</td>” w mailu) czytałby się
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
        // Numer linii bierzemy z POCZĄTKU TEKSTU, nie z pozycji `>`: przy
        // kształcie owiniętym otwierający tag stoi linię wyżej, a człowiek
        // szuka linii, w której napis stoi.
        push(start, "jsx-text", value.trim());
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

/**
 * ZAMROŻONY DŁUG: jednojęzyczny tekst dla użytkownika, per plik.
 *
 * Stan ZMIERZONY przy wdrożeniu bramki, nie przepisany - odświeżenie robi
 * `renderBaselineSource(...)`, którą self-test wypisuje przy oblanym ratchecie.
 *
 * Lista jest RATCHETEM: liczba w pliku może tylko maleć, a plik nieobecny na
 * liście musi mieć ZERO. Uzasadnienie inwariantu - w nagłówku tego pliku.
 *
 * DLACZEGO LISTA MIESZKA TUTAJ, a nie w `scripts/lib/` jak baseline bramki
 * `hardcodedLanguage`. Tam runnerem jest skrypt z `package.json` i lista dzieli
 * się z nim modułem. Tu bramką jest ZWYKŁY PLIK VITESTA
 * (`__tests__/monolingualUserText.test.ts`), więc lista musi być importowalna
 * z `src/` - inaczej test sięgałby do `scripts/`, których nie skanuje żadna
 * bramka własności.
 */
export const MONOLINGUAL_USER_TEXT_BASELINE: readonly (readonly [string, number])[] = [
  ["src/components/admin/AdminShell.tsx", 4],
  ["src/components/admin/AppearanceBuilderPane.tsx", 2],
  ["src/components/admin/archiveLayout/ArchiveLayoutAdmin.tsx", 2],
  ["src/components/admin/billing/AdminTicketOrdersPanel.tsx", 1],
  ["src/components/admin/blocks/edit/Buttons.tsx", 6],
  ["src/components/admin/blocks/edit/Code.tsx", 1],
  ["src/components/admin/blocks/edit/LatestPosts.tsx", 5],
  ["src/components/admin/blocks/edit/ListBlock.tsx", 1],
  ["src/components/admin/blocks/edit/LiveBlog.tsx", 1],
  ["src/components/admin/blocks/edit/Poll.tsx", 5],
  ["src/components/admin/blocks/edit/PostContextBlocks.tsx", 1],
  ["src/components/admin/blocks/edit/SocialIcons.tsx", 7],
  ["src/components/admin/blocks/MediaWidgetToolbar.tsx", 2],
  ["src/components/admin/blocks/WordStyleToolbar.tsx", 4],
  ["src/components/admin/builder/Builder.tsx", 1],
  ["src/components/admin/builder/ui/atoms/FocalPointPicker.tsx", 1],
  ["src/components/admin/builder/ui/molecules/BackgroundEditor.tsx", 1],
  ["src/components/admin/builder/ui/molecules/HoverControl.tsx", 1],
  ["src/components/admin/builder/ui/organisms/ColumnProperties.tsx", 4],
  ["src/components/admin/builder/ui/organisms/InlineSizeToolbar.tsx", 2],
  ["src/components/admin/builder/ui/organisms/section-properties/AdvancedPane.tsx", 4],
  ["src/components/admin/builder/ui/organisms/section-properties/TabsPane.tsx", 3],
  ["src/components/admin/builder/ui/organisms/widget-properties/MegaMenuEditor.tsx", 1],
  ["src/components/admin/builder/ui/organisms/widget-properties/PostListEditor.tsx", 2],
  ["src/components/admin/builder/ui/organisms/widget-properties/PricingEditor.tsx", 1],
  ["src/components/admin/builder/ui/organisms/widget-properties/RatedListEditor.tsx", 35],
  ["src/components/admin/builder/ui/organisms/widget-properties/SliderEditor.tsx", 1],
  ["src/components/admin/builder/ui/organisms/widget-properties/TimelineEditor.tsx", 1],
  ["src/components/admin/builder/WidgetProperties.tsx", 4],
  ["src/components/admin/cookie-banner/CookieBannerBrandingSection.tsx", 9],
  ["src/components/admin/cookie-banner/DetectedElementsPanel.tsx", 6],
  ["src/components/admin/coupons/organisms/CampaignCreateDialog.tsx", 2],
  ["src/components/admin/coupons/organisms/CouponsListPage.tsx", 1],
  ["src/components/admin/crm/CompanyFilterChips.tsx", 1],
  ["src/components/admin/crm/CompanyViewTabs.tsx", 1],
  ["src/components/admin/crm/LeadFilterChips.tsx", 1],
  ["src/components/admin/crm/LeadViewTabs.tsx", 1],
  ["src/components/admin/events/organisms/EventBrandingPanel.tsx", 2],
  ["src/components/admin/FooterChromePane.tsx", 8],
  ["src/components/admin/GlobalColorsEditor.tsx", 15],
  ["src/components/admin/google-source/GoogleSourceBadgeDeviceSection.tsx", 3],
  ["src/components/admin/membership/molecules/NewTierDialog.tsx", 3],
  ["src/components/admin/menu/MenuManager.tsx", 22],
  ["src/components/admin/molecules/TopicTabs.tsx", 1],
  ["src/components/admin/newsletter/builder/NewsletterBuilder.tsx", 4],
  ["src/components/admin/newsletter/builder/PropertiesPanel.tsx", 91],
  ["src/components/admin/newsletter/OverviewPanel.tsx", 24],
  ["src/components/admin/newsletter/PopupPreview.tsx", 1],
  ["src/components/admin/newsletter/subscribers/ImportCsvDialog.tsx", 5],
  ["src/components/admin/newsletter/subscribers/SubscriberDetailDialog.tsx", 15],
  ["src/components/admin/newsletter/SubscribersPanel.tsx", 3],
  ["src/components/admin/podcasts/EpisodeEditorPane.tsx", 1],
  ["src/components/admin/podcasts/PodcastSettingsPane.tsx", 2],
  ["src/components/admin/podcasts/PodcastShowsPane.tsx", 3],
  ["src/components/admin/post-editor/molecules/EditorModeToggle.tsx", 2],
  ["src/components/admin/post-editor/molecules/LayoutOverridesCard.tsx", 4],
  ["src/components/admin/PostEditor.tsx", 7],
  ["src/components/admin/postExperience/molecules/KeyTakeawaysIconPicker.tsx", 1],
  ["src/components/admin/PostGeneralOverview.tsx", 7],
  ["src/components/admin/PostSettingsMetabox.tsx", 8],
  ["src/components/admin/pricing/molecules/NewAudienceDialog.tsx", 1],
  ["src/components/admin/pricing/molecules/TierMarketingCard.tsx", 4],
  ["src/components/admin/pricing/organisms/AudiencesTab.tsx", 2],
  ["src/components/admin/RelatedOverrideEditor.tsx", 3],
  ["src/components/admin/seo/SerpPreview.tsx", 1],
  ["src/components/admin/theme-design/organisms/sections/SocialSection.tsx", 5],
  ["src/components/admin/theme-design/organisms/sections/ThumbnailSection.tsx", 3],
  ["src/components/admin/ThemeBackgroundsPane.tsx", 8],
  ["src/components/admin/ThemeFontSizesPane.tsx", 13],
  ["src/components/admin/ThemeOptionsPane.tsx", 21],
  ["src/components/admin/TrendingTickerPane.tsx", 2],
  ["src/components/admin/users/InviteUserDialog.tsx", 4],
  ["src/components/admin/users/TeamImportDialog.tsx", 4],
  ["src/components/admin/WordPressImportDialog.tsx", 2],
  ["src/components/admin/WxrUploadPanel.tsx", 2],
  ["src/components/ads/AdSlotById.tsx", 1],
  ["src/components/atoms/LangToggle.tsx", 2],
  ["src/components/atoms/Logo.tsx", 4],
  ["src/components/blocks/ConversionViews.tsx", 3],
  ["src/components/blocks/DataSocialViews.tsx", 3],
  ["src/components/blocks/MarketingViews.tsx", 3],
  ["src/components/blocks/PostUtilityViews.tsx", 2],
  ["src/components/blocks/PresentationViews.tsx", 3],
  ["src/components/blocks/renderer/molecules.tsx", 4],
  ["src/components/Breadcrumbs.tsx", 1],
  ["src/components/builder/molecules/Editable.tsx", 1],
  ["src/components/builder/organisms/widget-view/DynamicTagWidgets.tsx", 1],
  ["src/components/builder/organisms/widget-view/mediaWidgets.tsx", 1],
  ["src/components/builder/organisms/widget-view/SearchButtonWidget.tsx", 1],
  ["src/components/builder/organisms/widget-view/SimpleWidgets.tsx", 3],
  ["src/components/builder/organisms/widget-view/TabsBlock.tsx", 2],
  ["src/components/builder/organisms/widget-view/TeamMemberWidget.tsx", 1],
  ["src/components/builder/organisms/WidgetView.tsx", 6],
  ["src/components/checkout/GuestCheckoutGate.tsx", 1],
  ["src/components/error/RenderErrorBoundary.tsx", 1],
  ["src/components/experts/ExpertLayoutRenderer.tsx", 1],
  ["src/components/interests/JoinUsForm.tsx", 1],
  ["src/components/interests/TopicsDroplist.tsx", 2],
  ["src/components/LoginPopup.tsx", 1],
  ["src/components/NewsletterForm.tsx", 2],
  ["src/components/patterns/PatternPicker.tsx", 20],
  ["src/components/profile/AuthGate.tsx", 1],
  ["src/components/profile/AuthorProfileEditor.tsx", 5],
  ["src/components/profile/identity/SocialIdentityPanel.tsx", 6],
  ["src/components/profile/inline/InlineText.tsx", 2],
  ["src/components/profile/MediaMentionsSection.tsx", 1],
  ["src/components/search/AdvancedSearchPanel.tsx", 4],
  ["src/components/search/SearchAutosuggest.tsx", 1],
  ["src/components/SearchOverlay.tsx", 1],
  ["src/components/share/ReadingHeader.tsx", 4],
  ["src/components/ui/badge.tsx", 1],
  ["src/components/ui/breadcrumb.tsx", 2],
  ["src/components/ui/button.tsx", 1],
  ["src/components/ui/dialog.tsx", 1],
  ["src/components/ui/sheet.tsx", 1],
  ["src/lib/builder/sidebarStyles.tsx", 1],
  ["src/lib/builder/sliderVariants.tsx", 3],
  ["src/lib/email-templates/nes-layout.tsx", 2],
  ["src/routes/admin.analytics.tsx", 1],
  ["src/routes/admin.appearance.footer.tsx", 1],
  ["src/routes/admin.appearance.global-colors.tsx", 1],
  ["src/routes/admin.careers.tsx", 1],
  ["src/routes/admin.categories.tsx", 6],
  ["src/routes/admin.community.qa.tsx", 2],
  ["src/routes/admin.companies.$id.tsx", 2],
  ["src/routes/admin.contact.tsx", 2],
  ["src/routes/admin.content-area.tsx", 4],
  ["src/routes/admin.crm.$id.tsx", 2],
  ["src/routes/admin.crm.funnel.index.tsx", 1],
  ["src/routes/admin.crm.index.tsx", 2],
  ["src/routes/admin.custom-meta.tsx", 1],
  ["src/routes/admin.icons.tsx", 1],
  ["src/routes/admin.import-wordpress.tsx", 4],
  ["src/routes/admin.integrations.tsx", 2],
  ["src/routes/admin.live-blog.tsx", 1],
  ["src/routes/admin.login-settings.tsx", 5],
  ["src/routes/admin.names.tsx", 1],
  ["src/routes/admin.newsletter.campaigns.$id.tsx", 4],
  ["src/routes/admin.newsletter.campaigns.index.tsx", 1],
  ["src/routes/admin.organizations.$id.tsx", 3],
  ["src/routes/admin.pages.$slug.tsx", 19],
  ["src/routes/admin.paywall.tsx", 2],
  ["src/routes/admin.performance.tsx", 1],
  ["src/routes/admin.posts.calendar.tsx", 1],
  ["src/routes/admin.programs.tsx", 5],
  ["src/routes/admin.research-programs.tsx", 9],
  ["src/routes/admin.seo.tsx", 2],
  ["src/routes/admin.settings.cookie-banner.tsx", 32],
  ["src/routes/admin.settings.design.tsx", 1],
  ["src/routes/admin.settings.general.tsx", 2],
  ["src/routes/admin.settings.google-source.tsx", 10],
  ["src/routes/admin.settings.marketing.tsx", 2],
  ["src/routes/admin.super.mobile-drawer.tsx", 2],
  ["src/routes/admin.tracker.tsx", 6],
  ["src/routes/admin.users.$id.tsx", 8],
  ["src/routes/admin.web-stories.tsx", 10],
  ["src/routes/blog.index.tsx", 1],
  ["src/routes/contribute.tsx", 2],
  ["src/routes/podcast.$slug.tsx", 3],
  ["src/routes/podcasts.index.tsx", 1],
  ["src/routes/profile.index.tsx", 3],
  ["src/routes/unsubscribe.tsx", 1],
  ["src/routes/web-stories.index.tsx", 1],
];

/**
 * Lista per plik w postaci gotowej do wklejenia w `MONOLINGUAL_USER_TEXT_BASELINE`.
 *
 * Bramka nie ma własnego skryptu w `package.json` (jest plikiem vitesta), więc
 * ścieżka odświeżenia musi być w komunikacie o błędzie - inaczej człowiek,
 * którego bramka oblała, nie ma jak zamrozić nowego stanu i pierwszym odruchem
 * jest wykomentowanie testu.
 */
export function renderBaselineSource(hits: readonly MonolingualHit[]): string {
  return [...countsByFile(hits)]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([file, count]) => `  ["${file}", ${count}],`)
    .join("\n");
}
