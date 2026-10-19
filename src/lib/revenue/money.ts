// KWOTY PER WALUTA - jedyna forma pieniędzy w DTO huba (SPEC I5).
//
// NIGDY SUMA MIĘDZY WALUTAMI. Najemca sprzedaje w PLN, EUR i USD naraz;
// „12 400" złożone z 10 000 PLN i 2 400 EUR nie jest żadną kwotą, a kurs
// z dnia odczytu zmieniałby historię przy każdym odświeżeniu. Dlatego kwota
// to LISTA `{ waluta, kwota w jednostkach drobnych }`, a jedyne dodawanie
// w tym module łączy pozycje tej samej waluty.
//
// `null` ≠ 0. Brak danych (RPC zwrócił `null`, rola nie widzi kwot, kształt
// niepoprawny) to `null`; zmierzone „nic" to `[]`. Kafel z `0 zł` zamiast
// „brak danych" wysyła admina szukać spadku sprzedaży, którego nie było.

export interface MoneyByCurrency {
  /** Kod ISO 4217, wielkimi literami. */
  currency: string;
  /** Kwota w jednostkach drobnych (grosze, centy) - zawsze liczba całkowita. */
  amountMinor: number;
}

const CURRENCY = /^[A-Z]{3}$/;

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw);
}

/**
 * Kwota jednej pozycji. SQL buduje jsonb z nazw kolumn (`amount_minor`),
 * a część producentów DTO pisze camelCase - to ten sam kontrakt liczby, więc
 * przyjmujemy obie nazwy. Dwie RÓŻNE wartości w jednej pozycji to błąd
 * kształtu, nie wybór.
 */
function amountOf(entry: Record<string, unknown>): number | null {
  const snake = entry.amount_minor;
  const camel = entry.amountMinor;
  if (snake !== undefined && camel !== undefined && snake !== camel) return null;
  const value = snake ?? camel;
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

/**
 * Lista kwot z jsonb RPC. Cała wartość zdeformowana → `null` (nie „część
 * listy"): pominięta po cichu pozycja zaniżyłaby przychód bez śladu.
 * Powtórzona waluta jest łączona w pierwszą pozycję - to wciąż jedna waluta,
 * a kolejność z serwera (np. waluta wiodąca najpierw) zostaje.
 */
export function parseMoneyByCurrency(raw: unknown): MoneyByCurrency[] | null {
  if (!Array.isArray(raw)) return null;
  const entries: MoneyByCurrency[] = [];
  for (const entry of raw) {
    if (!isRecord(entry) || typeof entry.currency !== "string") return null;
    if (!CURRENCY.test(entry.currency)) return null;
    const amountMinor = amountOf(entry);
    if (amountMinor === null) return null;
    entries.push({ currency: entry.currency, amountMinor });
  }
  return addMoneyByCurrency([], entries);
}

/**
 * Suma dwóch list kwot, waluta po walucie.
 *
 * `null` po którejkolwiek stronie daje `null`: nieznane plus znane to wciąż
 * nieznane (brak danych nie jest zerem). Suma poza zakresem bezpiecznych
 * liczb całkowitych też daje `null` - zaokrąglona kwota pieniężna jest gorsza
 * od jawnego braku. Kolejność: waluty z `a`, potem nowe z `b`.
 */
export function addMoneyByCurrency(
  a: readonly MoneyByCurrency[] | null,
  b: readonly MoneyByCurrency[] | null,
): MoneyByCurrency[] | null {
  if (a === null || b === null) return null;
  const totals = new Map<string, number>();
  for (const { currency, amountMinor } of [...a, ...b]) {
    const sum = (totals.get(currency) ?? 0) + amountMinor;
    if (!Number.isSafeInteger(sum)) return null;
    totals.set(currency, sum);
  }
  return [...totals].map(([currency, amountMinor]) => ({ currency, amountMinor }));
}
