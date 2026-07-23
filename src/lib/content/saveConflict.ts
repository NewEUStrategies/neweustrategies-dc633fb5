// Kontrakt optimistic-lock dla zapisu treści (posty/strony). Zapis niesie
// `baseUpdatedAt` (updated_at, który klient ostatnio widział); serwer odrzuca
// zapis, gdy bieżący updated_at wiersza jest inny (ktoś zapisał w międzyczasie),
// zamiast cicho nadpisać cudzą pracę (last-write-wins).
//
// Błąd przechodzi przez granicę server-fn jako message string, więc kodujemy
// konflikt prefiksem w komunikacie i wykrywamy go po stronie klienta.
export const EDIT_CONFLICT_CODE = "EDIT_CONFLICT";

/** Buduje komunikat błędu konfliktu (prefiks + czytelny opis dla UI). */
export function editConflictError(entity: "post" | "page"): Error {
  const label = entity === "page" ? "tę stronę" : "ten wpis";
  return new Error(
    `${EDIT_CONFLICT_CODE}: ktoś inny zapisał ${label} w międzyczasie. ` +
      `Odśwież, aby zobaczyć najnowszą wersję (Twoje niezapisane zmiany zostaną w edytorze).`,
  );
}

/** Czy dany błąd to konflikt optimistic-lock (wykrywanie po stronie klienta). */
export function isEditConflict(err: unknown): boolean {
  const message =
    err instanceof Error ? err.message : typeof err === "string" ? err : String(err ?? "");
  return message.includes(EDIT_CONFLICT_CODE);
}
