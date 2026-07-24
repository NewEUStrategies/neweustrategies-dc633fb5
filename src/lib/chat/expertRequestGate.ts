// Czysta bramka widoczności przycisku "Zapytanie do eksperta".
//
// Przycisk pojawia się tylko, gdy OBIE bramki są otwarte:
//   - globalna (per tenant): community_modules.expert_requests_enabled,
//   - per-user odbiorcy: profiles.expert_requests_enabled.
// Brak danych o fladze odbiorcy (undefined) traktujemy jak "włączone"
// (domyślna wartość kolumny to true) - nie chowamy przycisku przez chwilowy
// brak wiersza. Jawne `false` chowa przycisk.

export interface ExpertRequestGateInput {
  /** Globalny przełącznik tenanta. */
  globalEnabled: boolean;
  /** Per-user flaga odbiorcy; undefined = nieznana (traktuj jak włączoną). */
  recipientEnabled: boolean | undefined;
}

/** Czy przycisk "Zapytanie do eksperta" może się pojawić. */
export function expertRequestGateOpen({
  globalEnabled,
  recipientEnabled,
}: ExpertRequestGateInput): boolean {
  return globalEnabled && recipientEnabled !== false;
}
