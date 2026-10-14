// Wspólne sufity pól publicznego zapisu na wydarzenie - JEDNO źródło dla
// schematu funkcji serwerowej (`eventRegistration.functions.ts`), walidacji
// szkicu (`registrationSubmitDraft.ts`), atrybutu `maxLength` pól i liczników.
//
// LICZBY Z BAZY, NIE Z GŁOWY. Imię, nazwisko, telefon, stanowisko, firma
// i adres to dokładnie CHECK-i tabeli `event_people` (po `btrim`), a profil
// zawodowy i kody - sufity, które `_event_register` (B1a, 20261012140000+)
// egzekwuje sam, bo kolumna ich nie ma. Inna liczba po którejkolwiek stronie
// to formularz, który przepuszcza zapis odrzucany przez bazę, albo odrzuca
// zapis, który baza by przyjęła.
//
// ODRZUCAMY, NIE PRZYCINAMY (AGENTS.md). Tekst dłuższy od sufitu jest błędem
// pod polem, a nie po cichu skróconą wartością - inaczej organizator widziałby
// w kartotece coś innego, niż uczestnik wpisał, i nikt by o tym nie wiedział.
// Baza robi to samo: `invalid_name`, `invalid_email`, `invalid_phone`,
// `invalid_job_title`, `invalid_company`, `invalid_social_url` - nigdy `left()`.

export const REGISTRATION_FIELD_LIMITS = {
  /** Imię i nazwisko: 1..80 znaków po `btrim` (`event_people` CHECK). */
  name: 80,
  /** Adres e-mail: do 320 znaków (RFC 5321, `event_people` CHECK). */
  email: 320,
  /** Telefon: 4..40 znaków po `btrim` (`event_people` CHECK). */
  phoneMin: 4,
  phoneMax: 40,
  /** Stanowisko: do 160 znaków (`event_people` CHECK). */
  jobTitle: 160,
  /** Instytucja lub firma: do 200 znaków (`event_people` CHECK). */
  companyText: 200,
  /** Profil zawodowy (https://): do 500 znaków - sufit funkcji zapisu. */
  socialProfileUrl: 500,
  /** Kod dostępu wejściówki i kod odsłaniający: do 64 znaków (jak w bazie). */
  code: 64,
} as const;

export type RegistrationFieldLimits = typeof REGISTRATION_FIELD_LIMITS;

/**
 * Czy tekst zawiera znak sterujący (U+0001..U+001F, U+007F..U+009F) - lustro
 * `_event_text_has_control` (20261012180000). Baza odrzuca taki znak w imieniu,
 * nazwisku, adresie, telefonie, stanowisku, firmie, profilu i danych gościa
 * kodem POLA, zanim spojrzy na adres (R38): w tekście jsonb każdy znak
 * sterujący rośnie do sześciu (`\u0001`) i rozsadzał sufit `submitted_profile`
 * wyłącznie dla adresów znanych kartotece - wyrocznia członkostwa.
 *
 * Kody znaków, nie wyrażenie regularne: ten sam zakres co w bazie, bez reguły
 * `no-control-regex` i bez zależności od flag silnika.
 */
export function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}
