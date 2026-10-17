// Parser podglądu Markdownu w edytorze wpisu (tryb `markdown`, PostEditor).
//
// DLACZEGO `marked`, A NIE `react-markdown`. Do 2026-10 podgląd szedł przez
// react-markdown, czyli cały potok unified/remark/rehype (micromark, mdast,
// hast, vfile, property-information, hast-util-to-jsx-runtime) - 34,2 KB gzip
// siedzących wyłącznie w chunku `admin.posts._slug` tylko dla tego jednego
// podglądu. `marked` to ~14 KB gzip i ten sam wynik dla nagłówków, list (też
// zagnieżdżonych), linków, referencji, cytatów, bloków kodu, setextów i
// twardych złamań: porównane z react-markdown przed jego usunięciem -
// różnice wyłącznie w serializacji (biały znak przed zagnieżdżoną listą,
// `&copy;` zamiast `©`), wyrenderowany wynik identyczny.
//
// DLACZEGO 18.1.1, A NIE 15.0.12 Z BUN.LOCK. 15.0.12 (wciąż zagnieżdżone pod
// @react-email/markdown - kod maili, tylko serwer) ma SZEŚCIENNY czas na
// niedomkniętych otwarciach linku/obrazka: `"![a](".repeat(1000)`, czyli 5 KB,
// to ~8 s na V8 i ~14 s na JSC, a podgląd parsuje synchronicznie przy otwarciu
// wpisu i na każdy znak - jeden szkic autora zamrażał edytor każdemu, kto go
// otworzy. 16.4.2 i 17.0.1 tak samo (5 KB ~ 8-9 s), 18.0.0 kwadratowo (64 KB
// ~ 2 s), dopiero 18.1.1 liniowo (64 KB ~ 30 ms). Koszt: ~2 KB gzip więcej niż
// 15.0.12 w chunku `admin.posts._slug` (tylko OVERALL). Przypięte dokładnie
// (`--exact`), bo ta własność nie jest kontraktem semvera, a strażnik akcentów
// niżej odtwarza warunki wstępne właśnie tej wersji.
//
// TA FUNKCJA NIE SANITYZUJE - i to celowo nie jest ukryte w nazwie. marked
// przepuszcza surowy HTML z treści (`<script>`, `onerror=`) i nie filtruje
// schematów URL (`[x](javascript:...)` daje `href="javascript:..."`).
// Sanityzacja MUSI stać w miejscu renderu, PO parserze:
// `sanitizeMarkdownHtml(markdownToUnsafeHtml(src))` z `@/lib/sanitize`. Tylko
// tam widzi ją bramka `check:dangerous-html` (sanitizer przy sinku, import z
// modułu kanonicznego) - sanityzacja schowana tutaj byłaby dla bramki
// niewidoczna, a sink w PostEditor czerwony.
//
// Polityka `sanitizeMarkdownHtml` jest ta sama, którą publiczny renderer stosuje
// do treści wpisów spoza blocks/buildera (ContentRenderer, silnik "html"), więc
// surowy HTML wpisany w Markdown wygląda w podglądzie tak, jak po publikacji
// (react-markdown pokazywał go jako zaescape'owany tekst).
//
// `gfm: false` - parytet z dotychczasowym podglądem: react-markdown bez
// remark-gfm to czysty CommonMark, więc tabele, `~~skreślenia~~` i gołe
// `www.` adresy NIE były renderowane. Włączenie GFM zmieniłoby to, co redaktor
// widzi, bez zmiany tego, co zapisuje - osobna decyzja produktowa, nie efekt
// uboczny odchudzania bundla. `breaks: false` - pojedynczy enter to miękkie
// złamanie, jak w CommonMark.
//
// Własna instancja `Marked` zamiast globalnego `marked`: konfiguracja (w tym
// strażnik akcentów niżej) nie przecieka do innych użytkowników biblioteki w
// tym samym realmie i odwrotnie. `async: false` daje synchroniczny `string`,
// bo podgląd liczy się w `useMemo` w trakcie renderu.
import { Marked, Tokenizer } from "marked";
import { escapeHtmlToText } from "@/lib/sanitizeEngineGuard";

/**
 * Budżet skanu akapitu (w znakach) na dopasowywanie akcentów `*`/`_` w JEDNYM
 * parsowaniu.
 *
 * Tego 18.1.1 nie naprawia (żadna wersja marked): `Tokenizer.emStrong` dla
 * każdego otwarcia akcentu skanuje resztę akapitu w poszukiwaniu zamknięcia,
 * więc dwa kształty są KWADRATOWE:
 *   - same niedomknięte otwarcia (`"_a ".repeat(n)`, `*a `, `**a `, `*(a `,
 *     `[*a](`): 24 KB ~ 8-9 s na V8, `"*_ "` 48 KB ~ 30 s;
 *   - otwarcia DOMKNIĘTE, ale zagnieżdżone (`"*a ".repeat(n) + "a* ".repeat(n)`):
 *     każdy poziom skanuje i re-lexuje całe wnętrze - 10 akapitów po 1500
 *     poziomów (90 KB) ~ 5 s, a od ~3000 poziomów RangeError po ~2 s.
 * react-markdown był liniowy na pierwszym (24 KB ~ 90 ms) - to jest regresja,
 * którą strażnik zamyka; na drugim był tak samo wolny (90 KB ~ 6 s, RangeError
 * przy 3000 poziomach), więc tam strażnik jest poprawą, nie naprawą.
 *
 * Licznik jest DETERMINISTYCZNY - zależy wyłącznie od treści, celowo nie od
 * zegara. Budżet w `performance.now()` sprawdzony i odrzucony: pod obciążeniem
 * (GC, wywłaszczenie wątku w trakcie jednego wywołania) ten sam zwykły
 * dokument 150 KB tracił w podglądzie większość pogrubień, czyli to, co widzi
 * redaktor, i wynik testu zależały od szybkości maszyny.
 *
 * Rachunek: otwarcie, które przejdzie warunki wstępne `Tokenizer.emStrong`
 * (czyli NAPRAWDĘ skanuje), REZERWUJE z góry `src.length` - górne
 * ograniczenie skanu (reszta akapitu). Jeśli znalazło zamknięcie, skan
 * przeszedł tylko `token.raw`, więc nadwyżka wraca. Rezerwacja przed
 * wywołaniem jest istotna: zagnieżdżone wnętrze lexuje się REKURENCYJNIE w
 * środku wywołania zewnętrznego, więc liczenie dopiero po powrocie nie
 * zatrzymałoby łańcucha zagnieżdżeń - z rezerwacją każdy poziom widzi koszt
 * poziomów nad sobą i łańcuch urywa się po ~budżet/długość poziomach. Po
 * przekroczeniu budżetu reszta dokumentu idzie bez akcentów (ograniczniki
 * zostają dosłownym tekstem, struktura - nagłówki, listy, linki, kod - bez
 * zmian).
 *
 * Skala: zwykła treść kosztuje ~długość tekstu w akcentach (poziom
 * zagnieżdżenia liczony osobno) plus resztę akapitu za każde naprawdę
 * niedomknięte otwarcie. 810 plików `.md` z node_modules (10,4 MB): max
 * 12 218 (CHANGELOG prismjs, 270 KB); dokument testowy 150 KB z 4000 akcentów:
 * ~50 000; 280 KB samych kursyw z pogrubieniami: ~317 000. Patologie
 * zatrzymują się na ~1 000 000 znaków skanu: 24-48 KB i 240 KB w ~70-300 ms
 * na V8. Jedyny skutek uboczny dla zwykłej treści: akapit dłuższy niż budżet
 * (> 1 MB w JEDNYM akapicie) nie dostanie akcentów zagnieżdżonych w akcencie,
 * bo rezerwacja zewnętrznego już go wyczerpuje.
 */
export const EMPHASIS_SCAN_BUDGET = 1_000_000;

/** Stan JEDNEGO wywołania `markdownToUnsafeHtml` (parse jest synchroniczny). */
let emphasisScanSpent = 0;

const STAR = 0x2a;
const UNDERSCORE = 0x5f;

const previewParser = new Marked({
  async: false,
  gfm: false,
  breaks: false,
  tokenizer: {
    // `false` = oddaj wbudowanemu tokenizerowi (kontrakt `use({ tokenizer })`),
    // `undefined` = „tu nie ma akcentu", czyli znak trafia do tekstu.
    emStrong(src, maskedSrc, prevChar = "") {
      const first = src.charCodeAt(0);
      if (first !== STAR && first !== UNDERSCORE) return false;
      if (emphasisScanSpent > EMPHASIS_SCAN_BUDGET) return undefined;
      // Warunki wstępne `Tokenizer.emStrong` z marked 18.1.1 (pin `--exact`),
      // przepisane 1:1: tylko otwarcie, które je przejdzie, skanuje resztę
      // akapitu. Reszta (`a_b` wewnątrz słowa, `* ` przed spacją) wraca od razu
      // i nic nie kosztuje - inaczej każde `snake_case` w długim akapicie
      // płaciłoby za cały akapit. Wszystkie trzy wyrażenia mają tylko flagę
      // `u`, więc `exec`/`test` nie niosą stanu (`lastIndex`) między wywołaniami.
      const { inline, other } = this.rules;
      const m = inline.emStrongLDelim.exec(src);
      const scans =
        m !== null &&
        Boolean(m[1] || m[2] || m[3] || m[4]) &&
        !(m[4] && other.unicodeAlphaNumeric.test(prevChar)) &&
        (!(m[1] || m[3]) || !prevChar || inline.punctuation.test(prevChar));
      if (!scans) return Tokenizer.prototype.emStrong.call(this, src, maskedSrc, prevChar);
      emphasisScanSpent += src.length;
      const token = Tokenizer.prototype.emStrong.call(this, src, maskedSrc, prevChar);
      if (token) emphasisScanSpent -= src.length - token.raw.length;
      return token;
    },
  },
});

/**
 * Markdown -> HTML BEZ SANITYZACJI. Wynik wolno wstawić do DOM-u WYŁĄCZNIE
 * przez `sanitizeMarkdownHtml` z `@/lib/sanitize`, wywołane w miejscu renderu.
 *
 * Nigdy nie rzuca. Głębokie zagnieżdżenie (`"> ".repeat(2000)`, `1. `,
 * `> - `, od ~4 KB) przepełnia stos rekurencyjnego lexera marked - tak samo
 * jak dawniej react-markdown, który wtedy wywracał cały edytor. Podgląd
 * pokazuje wtedy źródło jako zaescape'owany tekst w `<pre>`.
 */
export function markdownToUnsafeHtml(markdown: string): string {
  emphasisScanSpent = 0;
  try {
    return previewParser.parse(markdown, { async: false });
  } catch {
    return `<pre>${escapeHtmlToText(markdown)}</pre>`;
  }
}
