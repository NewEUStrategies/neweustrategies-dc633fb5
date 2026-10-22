// Wyniki RPC karty „Retencja danych" -> stan panelu (I9c-X2, wspólne z I9d-Y1).
//
// JEDNO miejsce mapowania kodów SQL na kody panelu dla wszystkich funkcji
// serwerowych karty (kategorie, lista „do anonimizacji", lista „do
// wygaszenia", wykluczenia, treść prośby) - ta sama odmowa (42501) i to samo
// okno wdrożenia (funkcji jeszcze nie ma w bazie) wyglądają w każdej sekcji
// karty tak samo.
//
// Moduł czysty: bez `createServerFn`, bez I/O - importują go moduły
// `*.functions.ts` i testy.

/** „Funkcji jeszcze nie ma w tej bazie" - okno wdrożenia, nie awaria. */
export const MISSING_SOURCE = new Set(["42883", "PGRST202"]);

export type DataRetentionRead<T> =
  { state: "ready"; data: T } | { state: "forbidden" } | { state: "unavailable" };

export type DataRetentionMutationError =
  "forbidden" | "conflict" | "not_found" | "invalid" | "unavailable" | "failed";

export type DataRetentionMutation<T> =
  { ok: true; data: T } | { ok: false; error: DataRetentionMutationError; reason: string | null };

export type RpcError = { message: string; code?: string } | null;

/** Odczyt: odmowa i brak funkcji to STAN karty, inny błąd - wyjątek (toast/granica). */
export function readState<T>(error: RpcError, ready: () => T): DataRetentionRead<T> {
  if (error) {
    if (error.code === "42501") return { state: "forbidden" };
    if (error.code !== undefined && MISSING_SOURCE.has(error.code)) return { state: "unavailable" };
    throw new Error(error.message);
  }
  return { state: "ready", data: ready() };
}

/** Kod SQL -> kod panelu; `reason` = komunikat RPC (`period_out_of_range`…). */
export function mapDataRetentionError(error: NonNullable<RpcError>): DataRetentionMutation<never> {
  const reason = error.message.split(":")[0]?.trim() || null;
  const code: DataRetentionMutationError = (() => {
    switch (error.code) {
      case "42501":
        return "forbidden";
      case "40001":
        return "conflict";
      case "P0002":
        return "not_found";
      case "22023":
      case "22P02":
      case "23514":
        return "invalid";
      default:
        return error.code !== undefined && MISSING_SOURCE.has(error.code)
          ? "unavailable"
          : "failed";
    }
  })();
  return { ok: false, error: code, reason };
}

export function mutation<T>(
  data: unknown,
  error: RpcError,
  parse: (raw: unknown) => T,
): DataRetentionMutation<T> {
  if (error) return mapDataRetentionError(error);
  return { ok: true, data: parse(data) };
}
