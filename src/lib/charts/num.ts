// Dwie osłony liczbowe silnika wykresów - i CAŁA rzecz w tym, że są DWIE.
//
// Dziś ta sama para funkcji leży w dziesięciu plikach pod trzema nazwami
// (`fin`, `pewna`, `liczba`) i w dwóch konwencjach zwrotu, więc autor poprawki
// w jednym rodzaju wykresu nie ma jak zauważyć, że w sąsiednim ta sama
// decyzja zapadła inaczej. Ten moduł jest jednym miejscem, w którym stoi
// rozstrzygnięcie, a nie dziesięcioma kopiami tego samego zdania.
//
// DLACZEGO NIE JEDNA FUNKCJA. Bo pytanie "co zrobić z nieskończonością"
// ma dwie różne poprawne odpowiedzi, zależnie od tego, do czego liczba idzie:
//
//   `finite` - dla liczb WYŚWIETLANYCH. Rysunek musi coś narysować: punkt
//   ma współrzędną, słupek wysokość, oś krawędź. `NaN` we współrzędnej znika
//   z SVG bez śladu albo - gorzej - `Intl.NumberFormat.format(NaN)` wychodzi
//   na stronie jako literalny napis "NaN" w tabeli danych (bramka
//   `blockMatrix` czyta `textContent` bloków właśnie na te napisy). Tu
//   wartość zastępcza jest uczciwa: to współrzędna, nie twierdzenie o danych.
//
//   `orNull` - dla liczb, o których model ORZEKA: kwartyl, rozstęp, granica
//   ogrodzenia, współczynnik korelacji, indeks wobec bazy. Tu odpowiedzią na
//   przepełnienie jest MILCZENIE, bo `null` znaczy "nie ma czego orzekać",
//   a zero albo jedynka znaczy coś zupełnie innego - i wygląda przy tym
//   dokładnie tak samo wiarygodnie jak liczba policzona z danych. Ogrodzenie
//   Tukeya sprowadzone osłoną do `{ lower: 0, upper: 0 }` nie jest awarią,
//   którą ktoś zauważy: jest legalnym ogrodzeniem, wobec którego każda
//   obserwacja różna od zera zostaje ogłoszona odstającą.
//
// Reguła, która z tego wynika i którą trzeba trzymać: `finite` NIGDY nie
// stoi na granicy orzeczenia, a `orNull` nigdy nie stoi na współrzędnej
// rysunku. Podmiana jednej na drugą jest defektem, nawet gdy typy się zgadzają.

/**
 * Liczba skończona albo wartość zastępcza - dla liczb, które IDĄ NA RYSUNEK.
 *
 * `fallback` jest odpowiedzialnością wywołującego: funkcja zwraca go bez
 * sprawdzania, bo typowe wywołanie podstawia sąsiednią, już sprawdzoną
 * statystykę (`finite(a + krok, a)`), a drugie sprawdzenie tylko udawałoby,
 * że wartość zastępcza może być nieskończona.
 */
export function finite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Liczba albo `null` - dla liczb, o których model ORZEKA.
 *
 * `Infinity`, `-Infinity`, `NaN`, `null` i `undefined` dają `null`, czyli
 * jedno wejście dla wszystkich sposobów, na jakie liczby może zabraknąć:
 * luki w danych z bazy, przepełnienia podwójnej precyzji i dzielenia 0/0.
 * Wywołujący ma wtedy jeden przypadek do obsłużenia zamiast trzech.
 */
export function orNull(value: number | null | undefined): number | null {
  return value === null || value === undefined || !Number.isFinite(value) ? null : value;
}
