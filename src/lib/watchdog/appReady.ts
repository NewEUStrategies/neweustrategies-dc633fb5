// SYGNAŁ „APLIKACJA ŻYJE" - jedno źródło nazwy flagi i jedna droga jej zapisu.
//
// PO CO OSOBNY, NIE-LENIWY MODUŁ. Flaga `__nesAppReady` istniała już, ale była
// ustawiana WEWNĄTRZ leniwego chunku `previewWatchdog`, importowanego tylko
// w iframie edytora. Skutek: na PUBLIKOWANEJ stronie nie było ANI JEDNEGO
// sygnału odróżniającego „zhydratowano" od „martwe". Zmierzone na żywej
// aplikacji, poza iframe'em: `window.__nesAppReady` było `null` zarówno
// w przebiegu, w którym klik nigdy nie dotarł do handlera, JAK I w przebiegu,
// w którym hydratacja się dokończyła - czyli brak sygnału w obie strony.
//
// To jest cała treść incydentu z 2026-07-20: cykl chunków wywracał kolejność
// inicjalizacji, boot klienta padał PRZED `hydrateRoot`, a strona zostawała
// statycznym SSR-em bez żadnego objawu dla użytkownika. Zgłosiłby to nagrany
// użytkownik, nie alarm.
//
// Flaga jest teraz ustawiana SYNCHRONICZNIE w efekcie montowania korzenia, bez
// round-tripu po leniwy chunk. PRZEŁADOWANIE zostaje wyłącznie w iframie
// (patrz `previewWatchdog`) - publikowana strona nigdy nie jest przeładowywana
// pod prawdziwym czytelnikiem.
//
// Konsumenci: efekt montowania w `routes/__root.tsx` (pisarz), watchdog podglądu
// (czytelnik) i boot-test przeglądarkowy na artefakcie produkcyjnym
// (`e2e/boot-artifact.spec.ts`), dla którego to jest BRAMA HYDRATACJI - jedyny
// sygnał, którego nie da się spełnić martwym dokumentem.

/** Nazwa flagi na `window`. Jedno źródło - watchdog i e2e czytają to samo. */
export const READY_FLAG_KEY = "__nesAppReady";

declare global {
  interface Window {
    __nesAppReady?: boolean;
    /** Milliseconds from navigation start, including the wait for HTML. */
    __nesAppReadyAt?: number;
  }
}

/** Oznacz aplikację jako zhydratowaną i interaktywną. No-op poza przeglądarką. */
export function markAppReady(): void {
  if (typeof window === "undefined") return;
  window[READY_FLAG_KEY] = true;
  window.__nesAppReadyAt ??= performance.now();
}

/** Czy aplikacja zgłosiła gotowość. Czytane przez watchdog podglądu. */
export function isAppReady(): boolean {
  return typeof window !== "undefined" && window[READY_FLAG_KEY] === true;
}
