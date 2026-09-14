// Reguła uzgadniania FORMULARZA karty organizacji z wierszem z serwera.
//
// PO CO OSOBNY MODUŁ. Ta decyzja ma trzy wejścia i cztery wyniki, a myli się
// w obie strony - i każda pomyłka kosztuje czyjąś pracę:
//   * uzgadnianie ZA RZADKO to defekt, od którego się zaczęło: draft ustawiał
//     się RAZ (`if (orgQ.data && !draft)`), więc żaden refetch nie docierał do
//     formularza, a zapis całego obiektu cicho cofał cudzą zmianę - w tym tę
//     zrobioną funkcją serwerową miejsc z sąsiedniej zakładki;
//   * uzgadnianie ZA CZĘSTO to defekt odwrotny: bezwarunkowe `setDraft(row)`
//     przy każdej nowej wersji wyrzuca administratorowi niezapisane zmiany
//     (wpisał miasto, przeszedł na zakładkę Miejsca, zmienił limit - i miasto
//     znika, bo mutacja miejsc unieważnia to zapytanie).
//
// Reguła mieszka więc tutaj jako funkcja CZYSTA, którą da się wykonać w teście
// jednostkowym, a nie wyłącznie przez render trasy. Ten sam wybór i ten sam
// powód co przy `nextBaseUpdatedAt` w edytorze wpisów (`postPatch.ts`).

/** Tożsamość i wersja wiersza, który formularz już widział. */
export interface SeenRow {
  id: string;
  updatedAt: string | null;
}

export type DraftSyncAction =
  /** Ten sam wiersz w tej samej (albo starszej) wersji - nie ma czego uzgadniać. */
  | "skip"
  /** Formularz przejmuje wiersz z serwera: inna organizacja albo brak lokalnych zmian. */
  | "reseed"
  /**
   * Wiersz jest nowszy, ale administrator ma w formularzu niezapisane zmiany.
   * Zostawiamy je I NIE przesuwamy bazy optimistic-locka - dzięki temu zapis
   * trafi w konflikt i POWIE, co się stało, zamiast po cichu wyrzucić jego
   * pracę albo cofnąć cudzą.
   */
  | "keep-local-edits";

/**
 * Czy wiersz z serwera jest NOWSZY od tego, który formularz odwzorowuje.
 *
 * Porównujemy CHWILE, nie napisy: ten sam moment zapisany z inną precyzją albo
 * w innej strefie to wciąż ten sam moment, a odpowiedź z cache bywa STARSZA od
 * tego, co już mamy - i wtedy „różni się" nie znaczy „przyszła zmiana".
 * Nierozstrzygalny znacznik (brak, niedata) traktujemy jako zmianę: lepiej
 * uzgodnić o raz za dużo niż pracować na wierszu, którego wersji nie znamy.
 */
export function isNewerRow(seenUpdatedAt: string | null, rowUpdatedAt: string | null): boolean {
  if (seenUpdatedAt === rowUpdatedAt) return false;
  if (!seenUpdatedAt || !rowUpdatedAt) return true;
  const seen = Date.parse(seenUpdatedAt);
  const row = Date.parse(rowUpdatedAt);
  if (Number.isNaN(seen) || Number.isNaN(row)) return true;
  return row > seen;
}

/**
 * Co zrobić z draftem, gdy zapytanie karty oddało wiersz.
 *
 * `userEdited` liczy się wobec wiersza, Z KTÓREGO draft POWSTAŁ - nigdy wobec
 * bieżącej odpowiedzi serwera. Ta druga miara jest właśnie tym, co zapalało
 * przycisk zapisu SAMO Z SIEBIE: po cudzym zapisie draft różnił się od danych,
 * choć administrator nie tknął ani jednego pola, a jedno kliknięcie cofało
 * wtedy cudzą zmianę.
 */
export function draftSyncAction(args: {
  seen: SeenRow | null;
  row: SeenRow;
  userEdited: boolean;
}): DraftSyncAction {
  const { seen, row, userEdited } = args;
  // Pierwsze wczytanie albo przejście na INNĄ organizację: formularz nie ma
  // czego bronić, bo jego zawartość dotyczy już nieoglądanego wiersza.
  if (!seen || seen.id !== row.id) return "reseed";
  if (!isNewerRow(seen.updatedAt, row.updatedAt)) return "skip";
  return userEdited ? "keep-local-edits" : "reseed";
}
