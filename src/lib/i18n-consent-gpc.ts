// Zasoby i18n dla Global Privacy Control (baner cookie, centrum prywatności,
// rejestr zgód). Osobna nakładka, bo treść jest oświadczeniem prawnym - żyje
// obok kodu, który sygnał obsługuje, i zmienia się razem z nim.
import i18n from "@/lib/i18n";

const gpcPl = {
  consentGpc: {
    badge: "GPC",
    badgeTitle: "Global Privacy Control - sygnał prywatności Twojej przeglądarki",
    honored: {
      title: "Respektujemy sygnał Global Privacy Control",
      body: "Twoja przeglądarka wysyła sygnał „nie sprzedawaj i nie udostępniaj moich danych” (Global Privacy Control). Kategorie analityczna i marketingowa oraz personalizacja treści są wyłączone - niezależnie od wcześniejszych ustawień. Nie musisz nic robić.",
      scope:
        "Sygnał nie wyłącza plików niezbędnych (sesja, bezpieczeństwo) ani funkcjonalnych preferencji interfejsu - te dane nie opuszczają Twojej przeglądarki.",
      overrideHint:
        "Jeśli mimo sygnału chcesz włączyć analitykę lub marketing, wybierz kategorie i zapisz - potraktujemy to jako świadomą zgodę i zapiszemy ją w rejestrze RODO.",
      source: {
        navigator: "Źródło sygnału: przeglądarka (navigator.globalPrivacyControl)",
        header: "Źródło sygnału: nagłówek żądania Sec-GPC",
        cookie: "Źródło sygnału: nagłówek Sec-GPC odczytany przy wejściu na stronę",
      },
    },
    overridden: {
      title: "Sygnał Global Privacy Control nadpisany Twoją zgodą",
      body: "Twoja przeglądarka wysyła sygnał opt-out, ale świadomie włączyłeś(-aś) kategorie, których on dotyczy. Ta decyzja jest zapisana w rejestrze RODO wraz ze znacznikiem sygnału.",
      restore: "Przywróć respektowanie sygnału",
    },
    categoryLocked: "Wyłączone sygnałem GPC",
    registry: {
      column: "GPC",
      active: "Sygnał GPC aktywny",
      inactive: "Bez sygnału GPC",
      note: "Kolumna GPC pokazuje, czy w chwili zapisu Twoja przeglądarka wysyłała sygnał Global Privacy Control.",
    },
    declaration: "Deklarację honorowania sygnału publikujemy pod /.well-known/gpc.json.",
  },
};

const gpcEn: typeof gpcPl = {
  consentGpc: {
    badge: "GPC",
    badgeTitle: "Global Privacy Control - your browser's privacy signal",
    honored: {
      title: "We honour your Global Privacy Control signal",
      body: "Your browser sends a “do not sell or share my personal information” signal (Global Privacy Control). The analytics and marketing categories and content personalisation are switched off - regardless of any earlier settings. You do not need to do anything.",
      scope:
        "The signal does not disable necessary cookies (session, security) or functional interface preferences - that data never leaves your browser.",
      overrideHint:
        "If you still want analytics or marketing enabled, pick the categories and save - we will treat that as informed consent and record it in the GDPR register.",
      source: {
        navigator: "Signal source: browser (navigator.globalPrivacyControl)",
        header: "Signal source: Sec-GPC request header",
        cookie: "Signal source: Sec-GPC header read when you opened the page",
      },
    },
    overridden: {
      title: "Global Privacy Control signal overridden by your consent",
      body: "Your browser sends an opt-out signal, but you knowingly enabled the categories it covers. That decision is stored in the GDPR register together with the signal flag.",
      restore: "Go back to honouring the signal",
    },
    categoryLocked: "Disabled by the GPC signal",
    registry: {
      column: "GPC",
      active: "GPC signal active",
      inactive: "No GPC signal",
      note: "The GPC column shows whether your browser was sending the Global Privacy Control signal when the entry was recorded.",
    },
    declaration: "Our declaration that we honour the signal is published at /.well-known/gpc.json.",
  },
};

i18n.addResourceBundle("pl", "translation", gpcPl, true, true);
i18n.addResourceBundle("en", "translation", gpcEn, true, true);

/**
 * No-op wołany w komponencie zamiast side-effectowego importu modułu -
 * rejestracja słowników przy ewaluacji chunka, jak w pozostałych lib/i18n-*.
 */
export function ensureI18n(): void {}
