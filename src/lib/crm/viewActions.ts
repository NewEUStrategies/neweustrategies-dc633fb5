// Wywołanie akcji zapisanego widoku (utwórz / zmień nazwę / usuń / udostępnij)
// z handlera zdarzenia.
//
// Zakładki widoków dostają akcje jako propsy zwracające `Promise<void>`, a
// wołały je wprost w `onClick` - odrzucony promise wychodził wtedy z handlera
// jako UNHANDLED REJECTION: komunikat dla operatora pokazywała warstwa mutacji
// (toast z `onError`), ale monitoring dostawał dodatkowy, niewyjaśniony błąd.
// Druga rzecz, którą to naprawia: sprzątanie po akcji (zamknięcie dymka,
// wyczyszczenie szkicu nazwy) biegło w `await`, więc PRZY BŁĘDZIE w ogóle się
// nie wykonywało albo wykonywało się mimo porażki - zależnie od miejsca.
// Teraz kontrakt jest jeden: `onDone` odpala się WYŁĄCZNIE po sukcesie.

/**
 * Uruchamia akcję i - tylko przy powodzeniu - sprzątanie po niej.
 * Błąd jest celowo połykany: raportuje go warstwa mutacji (toast), a handler
 * zdarzenia nie ma jak go obsłużyć.
 */
export function runViewAction(action: Promise<unknown>, onDone?: () => void): void {
  void action.then(() => onDone?.()).catch(() => undefined);
}
