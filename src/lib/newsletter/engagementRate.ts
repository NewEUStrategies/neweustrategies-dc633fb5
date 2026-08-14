// Wskaźnik zaangażowania kampanii: zasięg / dostarczone, w procentach.
//
// Czysty moduł, bo to tutaj mieszkała nieprawdziwa liczba. Panel dzielił LICZBĘ
// ZDARZEŃ przez liczbę dostarczonych maili, a zdarzenia były zdublowane (dwa
// producenty pisały do tej samej tabeli) i zwielokrotnione (klient pocztowy
// pobiera piksel wiele razy). Wynik przekraczał 100% - a wskaźnik otwarć
// powyżej stu procent nie jest „trochę zawyżony", tylko niemożliwy, więc
// unieważnia cały kafelek.
//
// Poprawka jest dwuczęściowa i obie części są tutaj widoczne:
//   * LICZNIK to ZASIĘG (liczba różnych odbiorców), nie liczba zdarzeń -
//     tylko on jest współmierny z mianownikiem „dostarczone",
//   * SUFIT 100% zostaje mimo to, bo dane sprzed deduplikacji i ręczna korekta
//     `sent_count` nadal potrafią rozjechać obie liczby. Lepiej pokazać sufit
//     niż liczbę, w którą nikt nie uwierzy.

/**
 * Odsetek dostarczonych (0-100, zaokrąglony). `null`, gdy nie ma mianownika -
 * UI pokazuje wtedy „-", a nie „0%", bo brak wysyłki to nie zerowe otwarcia.
 */
export function engagementRate(reach: number, delivered: number): number | null {
  if (!Number.isFinite(reach) || !Number.isFinite(delivered) || delivered <= 0) return null;
  return Math.min(100, Math.round((Math.max(0, reach) / delivered) * 100));
}
