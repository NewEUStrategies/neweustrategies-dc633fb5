// Komunikat błędu o NIEZNANYM typie - jedno zawężenie zamiast `error.message`
// powtarzanego w każdej granicy błędu.
//
// Od router-core 1.171.37 granica błędu trasy (`errorComponent`, `onCatch`)
// dostaje `error: unknown` (`ErrorComponentProps`, `DefaultErrorBoundaryTypes`)
// i słusznie: w JavaScripcie rzucić można dowolną wartością. Nie rozszerzamy
// typu frameworka (`ErrorBoundaryTypes`) do `Error` - to byłoby kłamstwo, które
// tylko przeniosłoby `TypeError` z kompilatora do granicy błędu.
//
// Kontrakt odpowiada temu, co granice renderowały dotąd przez `{error.message}`:
// tekst pola `message` KAŻDEJ wartości, która je niesie - `Error` i jego
// podklasy (także `PostgrestError` z Supabase i błędy server-fn Startu po
// deserializacji), a także zwykły obiekt `{ message }`. Wartość bez tekstowego
// `message` (rzucony string, liczba, `null`) daje `null`, czyli pusty węzeł
// w JSX - wcześniej `null` wywracał samą granicę błędu (`null.message`).

/** Tekst `message` błędu albo `null`, gdy rzucona wartość go nie niesie. */
export function errorMessageOf(error: unknown): string | null {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    return typeof error.message === "string" ? error.message : null;
  }
  return null;
}
