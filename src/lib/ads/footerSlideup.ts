// Decyzje nakładki reklamowej "footer slide-up", wyjęte z komponentu.
//
// Powód ekstrakcji: cała logika, która decyduje CZY i KIEDY nakładka przykryje
// dół ekranu czytelnika (opóźnienie z konfiguracji redakcji, zamykalność,
// pamięć zamknięcia w sessionStorage), żyła wewnątrz jednego `useEffect`.
// Efekt da się przetestować wyłącznie przez render + zegary, a błąd w którejś
// z tych decyzji kosztuje albo reklamę nie do zamknięcia, albo reklamę, której
// nikt nigdy nie zobaczy.
//
// UWAGA: ciała funkcji przeniesione ZNAK W ZNAK z `FooterSlideup.tsx`, razem
// z ich wadami (m.in. `Number()` bez walidacji - patrz `slideupDelayMs`).
// To jest ekstrakcja, nie naprawa.

const STORAGE_PREFIX = "ad_slideup_dismissed:";

/** Kształt `ad_placements.config` dla pozycji `footer_slideup`. */
export interface SlideupConfig {
  delay_ms?: number;
  dismissible?: boolean;
}

/** Klucz sesyjny pamiętający zamknięcie nakładki dla danego placementu. */
export function slideupStorageKey(placementId: string): string {
  return STORAGE_PREFIX + placementId;
}

/** Identyfikator slotu w koordynatorze nakładek (jedna nakładka naraz). */
export function slideupSlotId(placementId: string): string {
  return `footer-slideup:${placementId}`;
}

/** Domyślnie nakładka JEST zamykalna - brak wpisu w configu to nie zakaz. */
export function slideupDismissible(config: unknown): boolean {
  const cfg = config as SlideupConfig;
  return cfg.dismissible ?? true;
}

/**
 * Opóźnienie pojawienia się nakładki. Domyślnie 3000 ms, wartości ujemne
 * podciągane do zera.
 *
 * WADA PRZENIESIONA ŚWIADOMIE: `Number("wkrótce")` daje `NaN`, a
 * `Math.max(0, NaN)` to nadal `NaN` - `setTimeout` traktuje je jak 0, więc
 * nieliczbowa wartość z panelu daje nakładkę NATYCHMIASTOWĄ zamiast
 * opóźnionej. Dowód w `__tests__/footerSlideup.test.ts`.
 */
export function slideupDelayMs(config: unknown): number {
  const cfg = config as SlideupConfig;
  return Math.max(0, Number(cfg.delay_ms ?? 3000));
}

/**
 * Czy czytelnik zamknął już tę nakładkę w tej sesji.
 *
 * Tryb prywatny / zablokowane ciasteczka potrafią rzucić przy samym odczycie
 * `sessionStorage` - wtedy traktujemy nakładkę jak NIEZAMKNIĘTĄ (pokaże się
 * ponownie), bo alternatywą byłoby wywalenie całego efektu.
 */
export function isSlideupDismissed(placementId: string): boolean {
  try {
    if (sessionStorage.getItem(STORAGE_PREFIX + placementId) === "1") return true;
  } catch {
    // ignore storage errors
  }
  return false;
}

/**
 * Zapamiętaj zamknięcie nakładki na czas sesji. Błąd zapisu jest połykany:
 * zamknięcie zadziała w bieżącej karcie, ale nie przeżyje odświeżenia.
 */
export function markSlideupDismissed(placementId: string): void {
  try {
    sessionStorage.setItem(STORAGE_PREFIX + placementId, "1");
  } catch {
    // ignore
  }
}
