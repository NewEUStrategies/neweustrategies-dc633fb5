// ALLOWLISTA BRAMKI `check:dangerous-html`: miejsca, w których surowy HTML
// trafia do DOM-u BEZ sanitizera, a mimo to jest bezpieczny.
//
// ZERO TOLERANCJI DLA NOWYCH SINKÓW - to NIE jest ratchet per plik (w
// odróżnieniu od `i18nHardcodedBaseline`). Licznik pozwoliłby podmienić
// legalny literał CSS na niesanityzowaną treść bez zmiany liczby, więc każde
// zwolnienie jest IMIENNE: para (plik, nazwa symbolu) plus pisemny powód.
//
// DLACZEGO KLUCZ TO NAZWA, A NIE TREŚĆ WYRAŻENIA: trzy sinki są literałami CSS
// na kilkadziesiąt linii (routes/search.tsx, SearchButtonWidget.tsx,
// TrendingTicker.tsx). Klucz „pełne wyrażenie po normalizacji białych znaków"
// wymagałby wklejania tysięcy znaków przy każdej korekcie stylu; nikt by tego
// nie utrzymał i po tygodniu bramka byłaby wyłączana. Te trzy i tak przechodzą
// jako czyste literały, BEZ wpisu.
//
// Wpis, który nie ratuje już żadnego sinka, OBLEWA bramkę (`staleAllowlist`) -
// inaczej po refaktorze allowlista zamienia się w ciche zwolnienie dla kodu,
// którego już nie ma. Gotowe wpisy do wklejenia drukuje
// `bun run scripts/check-dangerous-html.ts --print-allowlist`.
import type { DangerousHtmlAllowEntry } from "../../src/lib/ci/dangerousHtml";

export type { DangerousHtmlAllowEntry };

export const DANGEROUS_HTML_ALLOWLIST: readonly DangerousHtmlAllowEntry[] = [
  {
    file: "src/routes/__root.tsx",
    sink: "script",
    symbol: "BOOT_PROBE_SCRIPT",
    reason:
      "Stała z lib/observability/bootProbeScript - literał pisany przez zespół, bez wstawek z bazy. To PIERWSZY skrypt dokumentu: musi być klasyczny i wykonać się przed bundlem, więc żaden sanitizer nie ma tu czego poprawić.",
  },
  {
    file: "src/routes/__root.tsx",
    sink: "script",
    symbol: "supabaseConfigScript",
    reason:
      "Serializacja publicznej konfiguracji Supabase (lib/supabasePublicConfig.ts:65) ucieka `<`, więc treść nie domknie `</script>`. Bez tego skryptu klient Supabase rzuca przy pierwszym użyciu i błąd zastępuje całą stronę (incydent 2026-07-16).",
  },
  {
    file: "src/routes/__root.tsx",
    sink: "script",
    symbol: "THEME_INIT_SCRIPT",
    reason:
      'Stała z lib/theme/themeInitScript - MUSI wykonać się przed pierwszym malowaniem (themeInitScript.ts:5), bo to jedyna ochrona przed FOUC. „Sanityzacja" oznaczałaby tu wycięcie tej ochrony, nie jej wzmocnienie.',
  },
  {
    file: "src/routes/__root.tsx",
    sink: "script",
    symbol: "DOCK_RESERVE_INIT_SCRIPT",
    reason:
      "Stała z lib/dock/reservedSpace - rezerwuje dolną krawędź przed pierwszym malowaniem z liczby pikseli zapisanej przy poprzednim wejściu. Nie czyta stanu uwierzytelnienia ani treści z bazy; opóźnienie go naliczałoby CLS przez całe życie strony.",
  },
  {
    file: "src/components/header/TrendingTicker.tsx",
    sink: "style",
    symbol: "keyframes",
    reason:
      "`buildVerticalKeyframes` (TrendingTicker.tsx:664-683) składa CSS wyłącznie z liczb (`toFixed`) i nazwy animacji pochodzącej z `useId()`. Żadna wartość nie pochodzi z bazy ani od użytkownika, więc nie ma czym domknąć `</style>`.",
  },
  {
    file: "src/components/builder/organisms/widget-view/NewsTickerView.tsx",
    sink: "style",
    symbol: "keyframes",
    reason:
      "Ten sam builder `buildVerticalKeyframes` co w TrendingTicker (NewsTickerView.tsx:173): liczby plus nazwa animacji z `useId()`, zero treści redakcyjnej.",
  },
  {
    file: "src/components/builder/organisms/widget-view/TrendingNowView.tsx",
    sink: "style",
    symbol: "keyframes",
    reason:
      "`buildTrendingKeyframes` (TrendingNowView.tsx:27-44) generuje klatki wyłącznie z liczby wierszy i nazwy animacji z `useId()`; pusty string, gdy wierszy jest mniej niż dwa.",
  },
  {
    file: "src/components/blocks/ContactFormView.tsx",
    sink: "style",
    symbol: "fontSizeCss",
    reason:
      'Reguły składane z liczb (rozmiary czcionek walidowane jako number) i selektora `[data-cf-id="…"]`, gdzie identyfikator pochodzi z `useId()` (ContactFormView.tsx:130). Do CSS nie wchodzi ani jeden znak z bazy ani z formularza.',
  },
  {
    file: "src/components/experts/ExpertLayoutRenderer.tsx",
    sink: "style",
    symbol: "expertLayoutScopeCss",
    reason:
      'Reguła powstaje w lib/experts/layoutRules.ts:102-109: scope-id jest przycinany `.replace(/[^a-zA-Z0-9_-]/g, "")`, a kolory przechodzą przez `sanitizeCssColor`. Zapora ma własne testy, dlatego mieszka w bibliotece, a nie w komponencie.',
  },
  {
    file: "src/components/admin/builder/ui/organisms/builder/VisualCanvas.tsx",
    sink: "style",
    symbol: "ringCss",
    reason:
      "Podpowiedzi kanwy malowane przez CSS `content:`; jedyne wstawki to `cssText(...)` = `JSON.stringify` (VisualCanvas.tsx:778) na tekście ze SŁOWNIKA i18n, czyli literale w repozytorium - do CSS nie wchodzi ani jeden znak z bazy ani od użytkownika.",
  },
  {
    file: "src/components/post/CitationBox.tsx",
    sink: "html",
    symbol: "citations.chicago",
    reason:
      "Cytat chicagowski jest sklejany w lib/citations/format.ts:170 i 252-261, gdzie KAŻDY segment pochodzący z bazy przechodzi przez `escapeHtml`; znaczniki `<i>`/`<span>` dokłada sam formatter. Sanitizer HTML-a byłby tu drugą kopią tej samej polityki.",
  },
  {
    file: "src/components/files/DocumentViewerBody.tsx",
    sink: "html",
    symbol: "html",
    reason:
      "Podgląd .docx: HTML powstaje i jest sanityzowany w warstwie parsowania (lib/files/officeParse.ts), która od tego PR-a idzie przez kanarka silnika `assertSanitizerEngine` - ten sam model awarii fail-closed co `sanitizeHtml`. Sink dostaje więc treść już czystą; ponowna sanityzacja w komponencie byłaby drugą polityką na tych samych danych.",
  },
  {
    file: "src/components/files/DocumentViewerBody.tsx",
    sink: "html",
    symbol: "current.html",
    reason:
      "Podgląd arkusza: tabela powstaje i jest sanityzowana w lib/files/officeParse.ts (przez kanarka silnika) razem z wynikiem workera, zanim trafi do stanu komponentu - ta sama ścieżka co przy podglądzie .docx.",
  },
];
