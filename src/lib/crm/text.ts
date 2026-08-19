// Drobne reguły tekstowe CRM, wspólne dla panelu i warstwy serwerowej.
//
// „Puste pole formularza to BRAK wartości, nie pusty napis" powtarzało się
// w kilku miejscach (`nullIfEmpty` w crm-companies.functions.ts, `|| undefined`
// w dialogach). Różnica jest widoczna w bazie: `''` zapisuje „firma z pustą
// domeną", `NULL` - „bez domeny".

/** Przycięta wartość albo `null`, gdy po przycięciu nic nie zostało. */
export function nullIfBlank(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Skrót identyfikatora do etykiety zastępczej (gdy nie ma nazwy ani e-maila). */
export function shortId(id: string, length = 6): string {
  return id.slice(0, length);
}
