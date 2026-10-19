// KSZTAŁT ZDROWIA KANAŁU E-MAIL HUBA „PRZYCHÓD I LEJEK" (S1, kontrakt §4.5).
//
// MODUŁ CZYSTO TYPOWY - zero wartości w runtime, więc import typu z tego
// pliku (karta huba, migawka S6) nie zmienia grafu chunków.
//
// `null` ≠ 0. Agregat SQL (`admin_revenue_email_health`) oddaje `null` tam,
// gdzie liczby NIE DA SIĘ policzyć: okno bez wysyłek (wskaźniki kampanii nie
// mają mianownika), kohorta bez sygnału dostawcy (webhooki milczą - „0 odbić"
// byłoby kłamstwem), DOI bez zapisów. UI rysuje wtedy „brak danych", nigdy
// zero; typ wymusza ten wybór w każdym miejscu, które czyta liczbę.

/** Kohorta wysyłek z okna (wiersze odbiorców `sent` z `sent_at` w oknie). */
export interface RevenueEmailCampaignHealth {
  /** Wysłane w oknie - zawsze liczba (0 = nic nie wyszło). */
  sent: number;
  /** Doręczone (także te zakończone skargą); `null` bez sygnału dostawcy. */
  delivered: number | null;
  /** Unikalni otwierający - per kampania, sumowani po kampaniach. */
  uniqueOpens: number | null;
  /** Unikalni klikający - per kampania, sumowani po kampaniach. */
  uniqueClicks: number | null;
  /** Odbicia trwałe (klasa `hard` i `block`). */
  hardBounces: number | null;
  /** Odbicia przejściowe (klasa `soft`, `unknown` albo brak klasy). */
  softBounces: number | null;
  /** Zgłoszenia jako spam. */
  complaints: number | null;
  /** Wypisy w ciągu 7 dni od otrzymania wysyłki z okna. */
  unsubscribes: number | null;
}

/** Stan listy w oknie (z bieżącego stanu wierszy subskrybentów). */
export interface RevenueEmailListHealth {
  /** Na liście w chwili początku okna. */
  start: number;
  /** Na liście w chwili końca okna. */
  end: number;
  /** Dołączenia w oknie. */
  new: number;
  /** Odejścia w oknie. */
  unsubscribed: number;
  /** `end - start` - może być ujemny. */
  netGrowth: number;
}

/** Double opt-in nowych adresów zapisanych w oknie. */
export interface RevenueEmailDoiHealth {
  started: number;
  /** Potwierdzone w ciągu 7 dni od zapisu; `null`, gdy nikt nie zaczął. */
  confirmed7d: number | null;
}

export interface RevenueEmailHealthDto {
  /** Granice okna `[since, until)` w ISO - echo z bazy. */
  since: string;
  until: string;
  campaigns: RevenueEmailCampaignHealth;
  list: RevenueEmailListHealth;
  doi: RevenueEmailDoiHealth;
}

/**
 * Wynik odczytu dla panelu. Odmowa roli i brak funkcji w bazie są STANAMI
 * karty, a nie wyjątkami: wyjątek kończy się toastem i ponowieniem, a autor
 * bez uprawnień albo okno wdrożenia (migracja jeszcze nie doszła) nie są
 * awarią, którą ponowienie naprawi.
 */
export type RevenueEmailHealthRead =
  | { state: "ready"; health: RevenueEmailHealthDto }
  /** 42501 - rola bez dostępu do zdrowia e-mail (autor). */
  | { state: "forbidden" }
  /** Funkcji jeszcze nie ma w bazie (migracja w drodze). */
  | { state: "unavailable" };
