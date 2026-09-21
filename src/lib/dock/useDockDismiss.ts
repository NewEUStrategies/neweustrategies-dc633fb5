// ZAMYKANIE POWIERZCHNI DOKU: Escape, który nie kradnie cudzych zdarzeń,
// i ognisko uwagi, które ma gdzie wrócić.
//
// ── DEFEKT 1: JEDEN ESCAPE ZAMYKAŁ DWIE RZECZY ───────────────────────────
// Panel i skrzynka nasłuchiwały `keydown` na `document`/`window` i zamykały
// się na każdym Escape. Problem: w środku panelu żyją WARSTWY RADIKSA -
// `Select` priorytetu w panelu zadań, `Dialog` tworzenia grupy w skrzynce.
// Radix nasłuchuje Escape na `document` w fazie PRZECHWYTYWANIA
// (`useEscapeKeydown`, `{ capture: true }`), więc jego obsługa biegnie
// PIERWSZA - zamyka swoją listę i woła `event.preventDefault()`
// (`DismissableLayer`: `if (!event.defaultPrevented && onDismiss) {
// event.preventDefault(); onDismiss(); }`). Nasłuch doku, zarejestrowany bez
// `capture`, dostawał to samo zdarzenie chwilę później i zamykał TAKŻE panel.
// Efekt dla użytkownika: otwierasz listę priorytetów, naciskasz Escape, żeby
// ją zamknąć - i znika cały panel zadań razem z wpisywanym zadaniem.
//
// Naprawa jest dokładnie w miarę problemu: nasłuch w fazie BĄBELKOWANIA
// (domyślnej, czyli po Radiksie) plus `if (event.defaultPrevented) return`.
// Warstwa, która zdarzenie obsłużyła, zostawia po sobie znacznik - i ten
// znacznik jest tu jedynym kryterium.
//
// ── DEFEKT 2: OGNISKO UWAGI SPADAŁO NA `<body>` ─────────────────────────
// `DockPanelShell` ustawia ognisko na sobie po otwarciu, ale przy zamknięciu
// nikt nie pamiętał, SKĄD panel został otwarty. React usuwał poddrzewo razem
// z zogniskowanym węzłem, `document.activeElement` wracał do `<body>`,
// a następny Tab startował od GÓRY dokumentu (WCAG 2.4.3 „Focus Order").
// Dla paska przy dolnej krawędzi to znaczy: przejechać tabulatorem przez
// całą stronę, żeby wrócić do przycisku, który się właśnie kliknęło.
//
// Hak zapamiętuje więc element, który miał ognisko w chwili otwarcia,
// i przywraca je przy zamknięciu - a gdy tego elementu już nie ma w drzewie
// (przebudowa paska), sięga po zakładkę sterującą panelem przez
// `[data-dock-tab]`. Zawsze jest gdzie wrócić.
import { useCallback, useEffect, useRef } from "react";

/**
 * Rejestruje Escape zamykający powierzchnię doku.
 *
 * @param enabled Czy powierzchnia jest otwarta. Nasłuch istnieje tylko wtedy -
 *   zamknięty dok nie ma po co trzymać procedury obsługi na dokumencie.
 */
export function useDockEscape(enabled: boolean, onClose: () => void): void {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Warstwa wyżej (Radix: Select, Dialog, Popover) już to obsłużyła.
      if (event.defaultPrevented) return;
      onClose();
    };
    // BEZ `capture` - świadomie. Chcemy biec PO warstwach Radiksa, żeby
    // zobaczyć ich `preventDefault`.
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [enabled, onClose]);
}

export interface DockFocusReturn {
  /** Wywołaj w chwili otwierania panelu - zapamiętuje punkt powrotu. */
  capture: () => void;
  /** Wywołaj po zamknięciu - oddaje ognisko uwagi. */
  restore: (tabId?: string | null) => void;
}

/**
 * Punkt powrotu ogniska uwagi dla paneli doku.
 *
 * Przywrócenie idzie w `requestAnimationFrame`, bo w chwili wywołania React
 * jeszcze nie zdjął zamykanego poddrzewa - ustawienie ogniska „pod" węzłem,
 * który za moment zniknie, nie miałoby skutku.
 */
export function useDockFocusReturn(): DockFocusReturn {
  const opener = useRef<HTMLElement | null>(null);

  const capture = useCallback(() => {
    const active = document.activeElement;
    opener.current = active instanceof HTMLElement ? active : null;
  }, []);

  const restore = useCallback((tabId?: string | null) => {
    requestAnimationFrame(() => {
      const remembered = opener.current;
      // Zapamiętany element bywa nieaktualny (pasek przemontowany, zakładka
      // zniknęła z konfiguracji) - `isConnected` rozstrzyga to bez zgadywania.
      if (remembered?.isConnected) {
        remembered.focus();
        return;
      }
      if (!tabId) return;
      // `CSS.escape` nie jest tu potrzebne: identyfikatory narzędzi i pozycji
      // paska pochodzą z zamkniętych zbiorów (`DOCK_TOOLS`, konfiguracja
      // pozycji), a nie z treści wpisanej przez użytkownika. Zapytanie
      // budujemy jednak z `getAttribute`-owego dopasowania po prostym
      // porównaniu, więc nawet nietypowa wartość nie zmienia selektora.
      const tab = Array.from(document.querySelectorAll<HTMLElement>("[data-dock-tab]")).find(
        (node) => node.dataset.dockTab === tabId,
      );
      tab?.focus();
    });
  }, []);

  return { capture, restore };
}
