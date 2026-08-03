// Jedno źródło prawdy dla walidacji kompozytorów tekstu (komentarze + pola
// "wiadomość" w widgetach formularzy). Czyste funkcje, zero I/O - dzięki temu
// przycisk "Wyślij", licznik znaków i komunikaty a11y zawsze mówią to samo.
//
// Zasady spójne dla wszystkich kompozytorów:
//   * treść liczymy PO trim (same spacje = pusto),
//   * limit długości liczymy na surowej wartości (tak jak licznik znaków),
//   * trwające wysyłanie zawsze blokuje submit,
//   * tryb edycji (initialValue) blokuje submit przy braku zmian.

export type ComposerStatus = "ok" | "empty" | "tooShort" | "tooLong" | "unchanged" | "submitting";

export interface ComposerValidationInput {
  value: string;
  maxLength: number;
  /** Minimalna długość po trim (domyślnie 1 znak). */
  minLength?: number;
  submitting?: boolean;
  /** Ustawione w trybie edycji - brak zmian blokuje wysyłkę. */
  initialValue?: string;
}

export interface ComposerValidation {
  /** Długość surowej wartości (spójna z licznikiem "n/max"). */
  length: number;
  /** Długość po trim - podstawa walidacji treści. */
  trimmedLength: number;
  isEmpty: boolean;
  isTooShort: boolean;
  isTooLong: boolean;
  isUnchanged: boolean;
  status: ComposerStatus;
  canSubmit: boolean;
  /** Wygodny alias dla atrybutu `disabled` przycisku wysyłki. */
  submitDisabled: boolean;
  /** Czy pole ma być oznaczone jako błędne (aria-invalid). */
  invalid: boolean;
}

export function validateComposerValue({
  value,
  maxLength,
  minLength = 1,
  submitting = false,
  initialValue,
}: ComposerValidationInput): ComposerValidation {
  const length = value.length;
  const trimmed = value.trim();
  const trimmedLength = trimmed.length;
  const isEmpty = trimmedLength === 0;
  const isTooShort = !isEmpty && trimmedLength < minLength;
  const isTooLong = length > maxLength;
  const isUnchanged = initialValue !== undefined && trimmed === initialValue.trim();

  const status: ComposerStatus = submitting
    ? "submitting"
    : isEmpty
      ? "empty"
      : isTooShort
        ? "tooShort"
        : isTooLong
          ? "tooLong"
          : isUnchanged
            ? "unchanged"
            : "ok";

  const canSubmit = status === "ok";
  return {
    length,
    trimmedLength,
    isEmpty,
    isTooShort,
    isTooLong,
    isUnchanged,
    status,
    canSubmit,
    submitDisabled: !canSubmit,
    // Pusty stan to jeszcze nie błąd - błędem jest przekroczenie limitu
    // albo treść krótsza niż wymagane minimum.
    invalid: isTooLong || isTooShort,
  };
}

/** Klucz i18n komunikatu pomocniczego dla danego statusu (null = brak). */
export function composerStatusMessageKey(status: ComposerStatus): string | null {
  if (status === "tooLong") return "composer.status.tooLong";
  if (status === "tooShort") return "composer.status.tooShort";
  return null;
}
