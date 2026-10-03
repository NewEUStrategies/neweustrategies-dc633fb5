// Klucz idempotencji odprawy (`client_scan_uid`) - jeden generator dla skanera
// i stanowiska odprawy w panelu.
//
// PO CO KLUCZ PRZY RĘCZNEJ ODPRAWIE. `_event_checkin_write` oddaje `replay`
// (ten sam wiersz dziennika) dla klucza, który już zna. Bez klucza ponowienie
// po zerwanej odpowiedzi - operator nie widzi potwierdzenia i klika jeszcze raz
// - zapisuje DRUGIE wejście tej samej osoby, a licznik zajętości bramki rośnie
// o osobę, której nie ma.
//
// KLUCZ ŻYJE TYLE, ILE PRÓBA. Ponowienie TEJ SAMEJ próby (ta sama osoba, ta sama
// bramka, ten sam kierunek) niesie ten sam klucz, dopóki baza nie odpowie;
// odpowiedź zamyka próbę, więc następne świadome kliknięcie (np. powrót po
// wyjściu) to nowe zdarzenie z nowym kluczem. Błąd próby NIE zamyka: nie
// wiadomo, czy zapis doszedł, a ten sam klucz w bazie, która go nie zna, zapisuje
// się zwyczajnie.

export function newClientScanUid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Awaryjnie, gdy `crypto.randomUUID` nie istnieje: klucz ma być niepowtarzalny
  // w obrębie JEDNEGO wołającego - baza wiąże go z najemcą i wydarzeniem.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export interface CheckinAttemptKeys {
  /** Klucz dla próby; ten sam, dopóki próba nie zostanie zamknięta odpowiedzią. */
  keyFor(attempt: string): string;
  /** Baza odpowiedziała - następna próba dostanie nowy klucz. */
  settle(attempt: string, key: string): void;
}

export function createCheckinAttemptKeys(
  generate: () => string = newClientScanUid,
): CheckinAttemptKeys {
  const open = new Map<string, string>();
  return {
    keyFor(attempt) {
      const existing = open.get(attempt);
      if (existing !== undefined) return existing;
      const key = generate();
      open.set(attempt, key);
      return key;
    },
    settle(attempt, key) {
      // Zamykamy tylko klucz, którym próba poszła - spóźniona odpowiedź starej
      // próby nie może zamknąć nowszej.
      if (open.get(attempt) === key) open.delete(attempt);
    },
  };
}
