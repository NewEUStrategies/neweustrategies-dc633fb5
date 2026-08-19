// Klasyfikacja błędu zapisu wpisu, wyjęta 1:1 z `usePostEditorForm`.
//
// Funkcja zwraca DANE, nie gotowy tekst - toasty i tłumaczenia zostają w hooku.
// Dzięki temu test nie zależy od copy, a bramka i18n dalej pilnuje PL/EN.
import { isEditConflict } from "@/lib/content/saveConflict";
import { parseDisclosureError, type DisclosureGap } from "@/lib/content/sponsored";

export interface SaveErrorClassification {
  /** Optimistic-lock: ktoś inny zapisał wpis w międzyczasie. */
  conflict: boolean;
  /**
   * Serwer odrzucił PUBLIKACJĘ niekompletnej deklaracji komercyjnej i odpowiedział
   * kodami pól, nie zdaniem - tylko klient zna język panelu. Lista jest pusta,
   * gdy błąd nie dotyczy deklaracji.
   */
  disclosureGaps: readonly DisclosureGap[];
}

/**
 * Rozpoznaje błąd zapisu bez odgadywania po treści komunikatu w UI.
 *
 * Oba warunki są NIEZALEŻNE i mogą wystąpić razem: kod konfliktu i kody braków
 * deklaracji jadą w tym samym `message`. Rozpoznanie tylko pierwszego z nich
 * kazałoby redaktorowi zgadywać, czego brakuje.
 */
export function classifySaveError(err: unknown): SaveErrorClassification {
  return {
    conflict: isEditConflict(err),
    disclosureGaps: parseDisclosureError(err),
  };
}
