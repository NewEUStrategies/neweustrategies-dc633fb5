// Wołacz dla personalizowanych nagłówków ("Twoje wybory dla ciebie, Igorze!").
//
// Odmianę robi wspólny silnik z `./polishVocative` (ten sam co w e-mailach).
// Ten plik miał kiedyś własne reguły, które rozjechały się z mailami i były
// błędne: Mateusz -> "Mateusu", Paweł -> "Pawele", Ola -> "Olo", Ernest ->
// "Ernescie", "J." -> "J.IE", a "Constructor" rzucał TypeError, bo pusta mapa
// wyjątków była czytana przez obj[klucz] i trafiała w Object.prototype.
//
// Kontrakt tej funkcji (inny niż `polishVocative`, które bierze tylko pierwszy
// człon): odmieniamy KAŻDY człon rozdzielony spacją lub łącznikiem.
import { polishVocativeParts } from "./polishVocative";

/**
 * Zwraca formę wołacza dla polskich imion (heurystyka). Obsługuje imiona
 * złożone rozdzielone spacją lub myślnikiem (Anna-Maria -> Anno-Mario),
 * zachowuje wielkość liter (ANNA -> ANNO), a człony nietypowe (inicjały,
 * cyfry, obce znaki) zostawia w mianowniku. Dla null/pustego wejścia - "".
 */
export function toPlVocative(name: string | null | undefined): string {
  return polishVocativeParts((name ?? "").trim());
}
