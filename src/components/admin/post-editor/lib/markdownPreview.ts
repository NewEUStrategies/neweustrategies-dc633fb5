// Parser podglądu Markdownu w edytorze wpisu (tryb `markdown`, PostEditor).
//
// DLACZEGO `marked`, A NIE `react-markdown`. Do 2026-10 podgląd szedł przez
// react-markdown, czyli cały potok unified/remark/rehype (micromark, mdast,
// hast, vfile, property-information, hast-util-to-jsx-runtime) - 34,2 KB gzip
// siedzących wyłącznie w chunku `admin.posts._slug` tylko dla tego jednego
// podglądu. `marked` (już w drzewie zależności przez @react-email/markdown,
// teraz zależność bezpośrednia przypięta DOKŁADNIE na wersję z bun.lock) to
// ~11,6 KB gzip i ten sam wynik dla nagłówków, list (też zagnieżdżonych),
// linków, referencji, cytatów, bloków kodu, setextów i twardych złamań:
// porównane z react-markdown na 10 przypadkach CommonMark przed jego
// usunięciem - różnice wyłącznie w serializacji (biały znak przed zagnieżdżoną
// listą, `&copy;` zamiast `©`), wyrenderowany wynik identyczny.
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
// Własna instancja `Marked` zamiast globalnego `marked`: konfiguracja nie
// przecieka do innych użytkowników biblioteki w tym samym realmie (np.
// `marked.use(...)` gdzie indziej) i odwrotnie. `async: false` daje
// synchroniczny `string` (bez rozszczepionego typu `string | Promise`), bo
// podgląd liczy się w `useMemo` w trakcie renderu.
import { Marked } from "marked";

const previewParser = new Marked({ async: false, gfm: false, breaks: false });

/**
 * Markdown -> HTML BEZ SANITYZACJI. Wynik wolno wstawić do DOM-u WYŁĄCZNIE
 * przez `sanitizeMarkdownHtml` z `@/lib/sanitize`, wywołane w miejscu renderu.
 */
export function markdownToUnsafeHtml(markdown: string): string {
  return previewParser.parse(markdown, { async: false });
}
