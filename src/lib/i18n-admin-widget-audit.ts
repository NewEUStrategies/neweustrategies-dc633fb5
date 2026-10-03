// Słownik panelu /admin/i18n - audyt tłumaczeń treści widgetów (PL -> EN).
//
// PO CO. Panel (`WidgetI18nAuditPane.tsx`) i nagłówek trasy (`admin.i18n.tsx`)
// składały napisy z bliźniaczych literałów `L(pl, en)` i rekordu `KIND_LABEL`,
// czyli tekst istniał wyłącznie w kodzie: poza bramką parytetu PL/EN i poza
// ratchetem `check:i18n-hardcoded`. Do tego komunikaty stanu odczytu pożyczały
// zdania kokpitu SEO (`adminSeoHub.contentReadError`, `coverageTruncated`,
// `coverageUnknown`), które mówią o „licznikach i tabeli" treści - a tu nie
// widać z nich, CO padło: skan stron i wpisów pod audyt tłumaczeń.
//
// Brzmienie przeniesionych napisów jest IDENTYCZNE z dotychczasowym
// (asercje na dosłownych napisach w `WidgetI18nAuditPane.test.tsx`). Jedyna
// zmiana treści to licznik: trzy sklejane fragmenty („Znaleziono 1 problemów
// w 1 wpisach/stronach") zastąpiło jedno zdanie z liczbą mnogą i18next.
//
// `head()` trasy celowo NIE czyta tego słownika: biegnie poza Reactem,
// w shellu trasy, a import nakładki na tym poziomie wciągnąłby ją do paczki
// wejściowej (wzorzec `admin.settings.cookie-banner.tsx`). Zgodność tytułu
// karty z `title` niżej przypina `adminI18nRoute.test.tsx`.
import i18n from "./i18n";

export const adminWidgetAuditPl = {
  adminWidgetI18nAudit: {
    title: "Audyt tłumaczeń widgetów",
    lead: "Widgety, które na wersji angielskiej pokażą polską treść lub tekst szablonowy.",
    rescan: "Przeskanuj ponownie",
    errorsOnly: "Tylko błędy",
    allIssues: "Błędy i ostrzeżenia",
    // Jedno zdanie zamiast sklejanych kawałków - szyk zostaje w rękach
    // tłumacza. `<b>` to wyróżnione liczby, a rzeczowniki odmieniają się
    // osobnymi kluczami (dwie liczby w zdaniu, a i18next odmienia po jednej).
    summary: "Znaleziono <b>{{issues}}</b> {{issuesWord}} w <b>{{entries}}</b> {{entriesWord}}",
    summaryIssues_one: "problem",
    summaryIssues_few: "problemy",
    summaryIssues_many: "problemów",
    summaryIssues_other: "problemu",
    summaryEntries_one: "wpisie/stronie",
    summaryEntries_few: "wpisach/stronach",
    summaryEntries_many: "wpisach/stronach",
    summaryEntries_other: "wpisu/strony",
    scanning: "Skanowanie…",
    noGaps: "Brak wykrytych braków tłumaczeń w widgetach.",
    editWidgets: "Edytuj widgety",
    hiddenWarnings:
      "Ostrzeżenia (EN identyczne z PL) są ukryte - bywają poprawne dla nazw własnych.",
    fixHint: "Poprawki wprowadzasz w widgecie - pola PL/EN są częścią jego treści.",
    kind: {
      staleDefault: "Szablonowa wartość EN",
      plTextInEn: "Polski tekst w polu EN",
      missing: "Brak tłumaczenia EN",
      sameAsPl: "EN identyczne z PL",
    },
    readError:
      "Nie udało się wczytać stron i wpisów do audytu - lista braków tłumaczeń nie pokazuje teraz stanu serwisu.",
    retry: "Spróbuj ponownie",
    coverageTruncated:
      "Przeskanowano {{shown}} z {{total}} stron i wpisów (ostatnio edytowane) - lista braków obejmuje tylko tę część.",
    coverageUnknown:
      "Nie udało się ustalić łącznej liczby stron i wpisów ({{shown}} przeskanowanych) - lista braków może nie obejmować wszystkiego.",
  },
};

export const adminWidgetAuditEn = {
  adminWidgetI18nAudit: {
    title: "Widget translation audit",
    lead: "Widgets that render Polish or template copy on the English version.",
    rescan: "Rescan",
    errorsOnly: "Errors only",
    allIssues: "All issues",
    summary: "Found <b>{{issues}}</b> {{issuesWord}} across <b>{{entries}}</b> {{entriesWord}}",
    summaryIssues_one: "issue",
    summaryIssues_other: "issues",
    summaryEntries_one: "entry",
    summaryEntries_other: "entries",
    scanning: "Scanning…",
    noGaps: "No widget translation gaps detected.",
    editWidgets: "Edit widgets",
    hiddenWarnings:
      "Warnings (EN identical to PL) are hidden - they can be correct for proper nouns.",
    fixHint: "Fix them inside the widget - the PL/EN fields are part of its content.",
    kind: {
      staleDefault: "Template EN value",
      plTextInEn: "Polish text in EN field",
      missing: "Missing EN translation",
      sameAsPl: "EN identical to PL",
    },
    readError:
      "Pages and posts could not be loaded for the audit - the list of translation gaps does not show the site's state right now.",
    retry: "Try again",
    coverageTruncated:
      "Scanned {{shown}} of {{total}} pages and posts (most recently edited) - the list of gaps covers only that part.",
    coverageUnknown:
      "The total number of pages and posts could not be determined ({{shown}} scanned) - the list of gaps may not cover everything.",
  },
};

export const adminWidgetAuditResources = { pl: adminWidgetAuditPl, en: adminWidgetAuditEn };

// Rejestracja przy imporcie (bramki parytetu czytają magazyn po samym
// imporcie) i jawne `ensureI18n()` dla wołających z komponentu - przeżywa
// tree shaking Vite i Nitro. Flaga modułu: drugie wywołanie nie scala drzewa
// ponownie. overwrite=true dotyczy wyłącznie WŁASNEGO korzenia.
let registered = false;
export function ensureI18n(): void {
  if (registered) return;
  registered = true;
  i18n.addResourceBundle("pl", "translation", adminWidgetAuditPl, true, true);
  i18n.addResourceBundle("en", "translation", adminWidgetAuditEn, true, true);
}
ensureI18n();
