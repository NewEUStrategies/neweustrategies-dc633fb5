// Maszyna przewijania Web Story - czysta warstwa decyzji.
//
// DLACZEGO TO WYSZŁO Z `StoryViewer.tsx`. Komponent trzyma pętlę
// `requestAnimationFrame`, `performance.now()`, focus trap i pełnoekranowy
// markup - a między tym wszystkim mieszkały decyzje, które nie mają nic
// wspólnego z DOM-em: „która strona jest następna", „co robi ta klawisza",
// „ile trwa ta plansza", „jak szeroki jest pasek postępu". Sprawdzenie
// którejkolwiek wymagało sterowania czasem i klatkami animacji naraz, więc
// cały plik stał na 0% (audyt 18.08, MODUŁ 7: Web stories 17,3% linii,
// 8 z 25 funkcji).
//
// Tutaj są to zwykłe funkcje o zwykłych wynikach. Komponent zostaje z refami,
// pętlą klatek i markupem - i to jest jedyne, czego nie da się sprawdzić bez
// przeglądarki.
//
// FUNKCJE ZWRACAJĄ DANE, NIE NAPISY. Żadna nie oddaje tekstu interfejsu:
// etykiety przycisków zostają w komponencie, bo bierze on język z PROPSA
// (`lang`), nie z kontekstu i18next - Web Story renderuje się na trasach
// per-język i podmiana tego źródła byłaby zmianą zachowania, nie porządkiem.

/** Co robi naciśnięta klawisza; `null` = nie nasza klawisza. */
export type StoryAction = "close" | "next" | "prev" | "togglePause";

/**
 * Mapowanie klawiatury. Spacja jest jedyną, która wymaga `preventDefault`
 * po stronie komponentu - bez tego przeglądarka przewinęłaby stronę pod
 * pełnoekranową historią.
 */
export function keyAction(key: string): StoryAction | null {
  if (key === "Escape") return "close";
  if (key === "ArrowRight") return "next";
  if (key === "ArrowLeft") return "prev";
  if (key === " ") return "togglePause";
  return null;
}

/**
 * Strona, od której zaczynamy. Wejście spoza zakresu przychodzi z adresu
 * (`?page=12` w historii o trzech planszach) - bez przycięcia widok wystartuje
 * na `undefined` i pokaże pustkę zamiast pierwszej planszy.
 */
export function clampStartIndex(startIndex: number, pageCount: number): number {
  return Math.min(Math.max(0, startIndex), Math.max(0, pageCount - 1));
}

/** Wynik przejścia dalej: nowa strona albo koniec serii. */
export interface StoryStep {
  index: number;
  /** Historia się skończyła - wywołujący ma ZAMKNĄĆ widok, nie iść dalej. */
  ended: boolean;
}

/**
 * Następna plansza. Na ostatniej NIE zostajemy - Web Story kończy się
 * zamknięciem, a nie zablokowaną strzałką. To jedyne miejsce, które o tym
 * decyduje: i przy kliknięciu, i przy strzałce, i przy dobiegnięciu paska
 * postępu do końca.
 */
export function advance(index: number, pageCount: number): StoryStep {
  if (index >= pageCount - 1) return { index, ended: true };
  return { index: index + 1, ended: false };
}

/** Poprzednia plansza. Na pierwszej stoimy - cofanie się nie zamyka historii. */
export function rewind(index: number): number {
  return Math.max(0, index - 1);
}

/** Najkrótsza plansza, jaką da się przeczytać. */
export const MIN_PAGE_SECONDS = 2;

/** Czas planszy, gdy redakcja go nie ustawiła. */
export const DEFAULT_PAGE_SECONDS = 6;

/**
 * Ile trwa plansza. Podłoga dwóch sekund jest regułą DOSTĘPNOŚCI, nie
 * kosmetyką: plansza znikająca po pół sekundy jest nieczytelna dla każdego,
 * kto czyta wolniej, a wartość bierze się z pola redakcyjnego, więc zero
 * albo liczba ujemna są realnym wejściem.
 */
export function pageDurationMs(durationSeconds: number | null | undefined): number {
  return Math.max(MIN_PAGE_SECONDS, durationSeconds ?? DEFAULT_PAGE_SECONDS) * 1000;
}

/** Czym wypełnić tło planszy. */
export type StoryBackground = "video" | "color" | "image" | "blank";

/**
 * Tło planszy. `blank` jest osobnym przypadkiem, a nie „obrazkiem bez adresu":
 * plansza obrazkowa bez `media_url` musi dostać jednolite ciemne tło, bo
 * `<img src="">` w części przeglądarek pokazuje ikonę zepsutego obrazka.
 */
export function backgroundKind(page: {
  background?: string | null;
  media_url?: string | null;
}): StoryBackground {
  if (page.background === "video" && page.media_url) return "video";
  if (page.background === "color") return "color";
  if (page.media_url) return "image";
  return "blank";
}

/**
 * Szerokość paska postępu dla planszy `barIndex`. Plansze przed aktywną są
 * pełne, aktywna rośnie, kolejne są puste - to jest cały wskaźnik „gdzie
 * jestem w historii".
 */
export function progressWidth(barIndex: number, activeIndex: number, progress: number): string {
  if (barIndex < activeIndex) return "100%";
  if (barIndex > activeIndex) return "0%";
  const clamped = Math.min(1, Math.max(0, progress));
  return `${clamped * 100}%`;
}
