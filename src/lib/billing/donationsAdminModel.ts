// Czysta warstwa decyzji panelu `/admin/donations`: jak napis z pola formularza
// staje się KWOTĄ w groszach, i jak wartość z <select> staje się wariantem
// konfiguracji. Bez Reacta, bez react-query, bez Supabase - żeby te decyzje
// dało się udowodnić tabelką przypadków, a nie przejazdem po JSX.
//
// DLACZEGO TO JEST WARSTWA PIENIĘŻNA, A NIE „PARSOWANIE STRINGA". Wynik
// `parsePresetsCents` ląduje w `site_settings["donations"].presetsCents`, skąd
// czyta go PUBLICZNY formularz `/donate` i renderuje jako przyciski kwot. Błąd
// tutaj nie jest błędem panelu - jest błędem tego, co widzi darczyńca.
//
// WYCIĄGNIĘTE ZNAK W ZNAK z `src/routes/admin.donations.tsx` (razem z wadami,
// które są udokumentowane przy każdej funkcji i udowodnione testem). Ekstrakcja
// nie zmienia zachowania o jotę; naprawa jest osobnym krokiem, poza tym
// zleceniem.

/** Środowisko operatora płatności wybierane w panelu synchronizacji. */
export type DonationsSyncEnvironment = "sandbox" | "live";

/**
 * Pole „kwoty sugerowane" -> tablica groszy.
 *
 * WADA PRZENIESIONA ŚWIADOMIE: `part.replace(",", ".")` nie ma jak zadziałać,
 * bo rozdzielenie idzie WŁAŚNIE po przecinku - w żadnym fragmencie nie zostanie
 * ani jeden przecinek. Autor zamierzał wspierać polski przecinek dziesiętny;
 * skutek jest taki, że administrator wpisujący `50,50` dostaje DWA presety po
 * 50 zł zamiast jednego na 50,50 zł. Napis wygląda na przyjęty, kwoty są inne.
 *
 * Pozostałe zachowania, wszystkie ciche:
 *  - fragment nieliczbowy (`abc`) daje `NaN` i jest odrzucany bez śladu,
 *  - kwota <= 0 gr po zaokrągleniu (np. `0,001`) jest odrzucana bez śladu,
 *  - dziewiąta i dalsze kwoty są ucinane przez `slice(0, 8)` bez ostrzeżenia,
 *  - pole puste daje tablicę PUSTĄ, czyli formularz `/donate` bez przycisków
 *    kwot; nic o tym nie mówi.
 */
export function parsePresetsCents(input: string): number[] {
  return input
    .split(",")
    .map((part: string) => Math.round(Number.parseFloat(part.replace(",", ".")) * 100))
    .filter((cents: number) => Number.isFinite(cents) && cents > 0)
    .slice(0, 8);
}

/**
 * Tablica groszy -> zawartość pola tekstowego. Odwrotność `parsePresetsCents`
 * WYŁĄCZNIE dla kwot pełnozłotowych: `2550` wraca jako `25.5`, a ponowne
 * odczytanie tego pola przez `parsePresetsCents` rozetnie je na `25` i `5`.
 */
export function formatPresetsInput(presetsCents: readonly number[]): string {
  return presetsCents.map((cents) => String(cents / 100)).join(", ");
}

/**
 * Pole liczbowe (min / max / cel) -> grosze.
 *
 * `Number("") || 0` daje 0 i `Number("abc") || 0` też daje 0 - wyczyszczenie
 * pola i wpisanie w nie śmiecia są NIEODRÓŻNIALNE. Dla `minCents` zero jest
 * poniżej minimum operatora (500 gr), a mimo to panel je przyjmie; odrzuci je
 * dopiero `DonationsConfigSchema` przy zapisie.
 */
export function parseAmountField(raw: string): number {
  return Number(raw) || 0;
}

/** <select> silnika wpłat: cokolwiek innego niż `external` znaczy `stripe`. */
export function coerceProvider(raw: string): "stripe" | "external" {
  return raw === "external" ? "external" : "stripe";
}

/** <select> waluty: cokolwiek innego niż `EUR` znaczy `PLN`. */
export function coerceCurrency(raw: string): "PLN" | "EUR" {
  return raw === "EUR" ? "EUR" : "PLN";
}

/**
 * <select> środowiska synchronizacji: cokolwiek innego niż `live` znaczy
 * `sandbox`. Kierunek domyślnej wartości jest tu celowo BEZPIECZNY - pomyłka
 * kieruje do piaskownicy, nie do produkcyjnych płatności.
 */
export function coerceSyncEnvironment(raw: string): DonationsSyncEnvironment {
  return raw === "live" ? "live" : "sandbox";
}
