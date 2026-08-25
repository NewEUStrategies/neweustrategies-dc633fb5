// Polityka listy wykluczeń: KTÓRA blokada zatrzymuje KTÓRY rodzaj wiadomości.
//
// Czysty moduł bez I/O (jak deliveryEvents.ts) - decyzja "wolno wysłać?" jest
// najbardziej kosztowną pomyłką w całym potoku poczty w OBIE strony, więc musi
// być testowalna jednostkowo bez bazy i bez sieci, i musi być tym samym kodem
// na serwerze (brama wysyłki) i w panelu (wyjaśnienie decyzji operatorowi).
//
// PRZYCZYNA ŹRÓDŁOWA. Wcześniej warstwa transakcyjna sprawdzała listę
// wykluczeń, ale respektowała ją dla JEDNEGO z 19 typów maila
// (`input.type === "newsletter_confirmed"`) - pozostałe 18 wychodziło na adresy
// po twardym odbiciu i po skardze na spam. To najgorszy możliwy wariant:
// wysyłka na skarżący się adres kosztuje reputację CAŁEJ domeny nadawczej,
// łącznie z pocztą transakcyjną, której nie wolno stracić.
//
// Odwrotna skrajność jest jednak równie zła: potraktowanie wypisu z newslettera
// jak zakazu wysyłki potwierdzenia płatności odcięłoby odbiorcę od informacji,
// które MUSIMY dostarczyć (art. 6 ust. 1 lit. b RODO - wykonanie umowy; zasady
// organizacji kartowych wymagają uprzedzenia o cyklicznym obciążeniu). Zgoda
// marketingowa i obowiązek umowny to dwie różne rzeczy.
//
// Stąd macierz: POWÓD blokady x KATEGORIA wiadomości.

import type { TxEmailType } from "@/lib/email-templates/tx-copy";

/** Powody blokady - domena kolumny reason w public.email_suppressions. */
export type SuppressionReason =
  "hard_bounce" | "soft_bounce" | "complaint" | "manual" | "unsubscribe" | "invalid" | "blocked";

export type SuppressionScope = "permanent" | "transient";

/**
 * Kategoria wiadomości wychodzącej.
 *
 *  * `transactional` - wiadomość 1:1 wywołana działaniem odbiorcy albo stanem
 *    jego konta, której treść jest mu należna (potwierdzenie płatności, utrata
 *    dostępu, bilet, link do portalu). Wypis z newslettera jej nie dotyczy.
 *  * `bulk` - newsletter, digest, potwierdzenie zapisu na listę: wysyłka na
 *    podstawie ZGODY, którą odbiorca może wycofać w każdej chwili.
 *
 * Świadomie nie ma trzeciej kategorii: rozróżnienie "service" vs "marketing"
 * nie zmieniałoby żadnej decyzji w macierzy poniżej, a każda kategoria bez
 * własnego skutku to tylko miejsce na przyszłą pomyłkę.
 */
export type EmailCategory = "transactional" | "bulk";

/**
 * Powody, które NIE zatrzymują poczty transakcyjnej.
 *
 *  * `unsubscribe` - wycofanie zgody marketingowej. Nie jest oświadczeniem
 *    "nie chcę potwierdzeń płatności"; takiej treści nie wolno nam zatrzymać.
 *  * `soft_bounce` - problem chwilowy (pełna skrzynka, chwilowa odmowa
 *    serwera). Blokada jest czasowa z backoffem, a miękkie odbicia nie ważą na
 *    reputacji tak jak twarde i skargi. Ciche skasowanie ostrzeżenia o
 *    nieudanej płatności na wiele dni byłoby tu kosztem większym od ryzyka.
 *
 * Wszystkie pozostałe powody (`hard_bounce`, `complaint`, `blocked`,
 * `invalid`, `manual`) zatrzymują KAŻDĄ wiadomość: adres jest albo
 * nieosiągalny, albo dalsza wysyłka na niego jest wprost szkodliwa (skarga),
 * albo zablokował go świadomie operator.
 */
const TRANSACTIONAL_PASS_REASONS: ReadonlySet<SuppressionReason> = new Set([
  "unsubscribe",
  "soft_bounce",
]);

export interface SuppressionDecisionInput {
  reason: SuppressionReason;
  scope?: SuppressionScope;
  category: EmailCategory;
}

/**
 * Czy aktywna blokada o tym powodzie zatrzymuje wiadomość tej kategorii.
 *
 * Wołane WYŁĄCZNIE dla blokad już potwierdzonych jako aktywne (SQL odsiewa
 * zdjęte i wygasłe) - ta funkcja nie zajmuje się czasem, tylko polityką.
 */
export function suppressionBlocks(input: SuppressionDecisionInput): boolean {
  if (input.category === "bulk") return true;
  return !TRANSACTIONAL_PASS_REASONS.has(input.reason);
}

/** Kod przyczyny pominięcia do logu wysyłki i panelu (stabilny, do i18n). */
export function suppressionSkipReason(reason: SuppressionReason): string {
  return `suppressed:${reason}`;
}

// ----------------------------------------------------------------------------
// Kategoria per typ maila transakcyjnego
//
// Rekord po TxEmailType (nie Partial): dodanie nowego typu maila bez wpisu tutaj
// nie skompiluje się, więc nowa ścieżka wysyłki NIE MOŻE po cichu wrócić do
// stanu "suppression nie dotyczy tego typu".
// ----------------------------------------------------------------------------
export const TX_EMAIL_CATEGORY: Readonly<Record<TxEmailType, EmailCategory>> = {
  // Rozliczenia i stan subskrypcji: pieniądze i dostęp. Odbiorca musi wiedzieć,
  // co i kiedy zostanie obciążone oraz do kiedy ma dostęp.
  subscription_confirmed: "transactional",
  subscription_renewed: "transactional",
  subscription_canceled: "transactional",
  subscription_upgraded: "transactional",
  subscription_downgraded: "transactional",
  subscription_paused: "transactional",
  subscription_resumed: "transactional",
  payment_failed: "transactional",
  payment_recovered: "transactional",
  payment_refunded: "transactional",
  // Uprzedzenie o cyklicznym obciążeniu / wygaśnięciu dostępu - wymagane przez
  // zasady organizacji kartowych i oczekiwane przez konsumenta.
  subscription_renewal_reminder: "transactional",
  subscription_expiring: "transactional",
  // Utrata dostępu zespołowego: konsekwencja natychmiastowa i kosztowna.
  team_seat_grace: "transactional",
  team_seat_grace_reminder: "transactional",
  team_seat_access_ended: "transactional",
  // Bilet / potwierdzenie rejestracji - dowód uczestnictwa.
  event_registered: "transactional",
  // Cykl życia zgłoszenia formularzowego: przyjęcie, decyzja i awans z rezerwy.
  // Wszystkie cztery są odpowiedzią na WŁASNE działanie odbiorcy (wysłał
  // zgłoszenie) i niosą informację o dostępie, którego nie da się odtworzyć
  // z innego źródła - to jest definicja maila transakcyjnego, nie wysyłki
  // za zgodą marketingową. Mail odmowny należy do tej samej klasy: człowiek,
  // który wypisał się z newslettera, nadal ma prawo dowiedzieć się, że nie
  // wejdzie na wydarzenie, na które się zgłosił.
  event_registration_received: "transactional",
  event_registration_approved: "transactional",
  event_registration_rejected: "transactional",
  event_waitlist_promoted: "transactional",
  // Potwierdzenie darowizny - dokument dla darczyńcy.
  donation_received: "transactional",
  // Jednorazowy link do portalu operatora płatności, wywołany kliknięciem
  // odbiorcy chwilę wcześniej.
  customer_portal_link: "transactional",
  // Potwierdzenie zapisu na newsletter to sama esencja wysyłki za zgodą.
  // Decyzja redakcji w sprawie zgłoszenia złożonego przez tę osobę - poczta 1:1
  // wywołana jej własnym działaniem, nie wysyłka za zgodą marketingową.
  club_application_accepted: "transactional",
  club_application_rejected: "transactional",
  club_application_more_info: "transactional",
  newsletter_confirmed: "bulk",
};

export function txEmailCategory(type: TxEmailType): EmailCategory {
  return TX_EMAIL_CATEGORY[type];
}

// ----------------------------------------------------------------------------
// Kategoria per etykieta wysyłki surowej (enqueueRawEmail) i szablon rejestru
//
// Kanały budujące własny HTML nie mają TxEmailType, tylko etykietę w logu
// (`digest_daily`). Domyślnie `bulk`: nieznana etykieta ma być traktowana
// ostrożniej, a nie luźniej - fail-safe idzie w stronę mniejszej wysyłki.
// ----------------------------------------------------------------------------
const RAW_LABEL_CATEGORY: Readonly<Record<string, EmailCategory>> = {
  digest_daily: "bulk",
  digest_weekly: "bulk",
  newsletter_campaign: "bulk",
  // Maile autoryzacyjne (magic link, reset hasła, zmiana adresu, zaproszenie):
  // odbiorca właśnie o nie poprosił i bez nich nie wejdzie na konto.
  auth_magic_link: "transactional",
  auth_recovery: "transactional",
  auth_signup: "transactional",
  auth_email_change: "transactional",
  auth_invite: "transactional",
  auth_reauthentication: "transactional",
};

/**
 * Kategoria dla etykiety/nazwy szablonu. Rozpoznaje kolejno: etykiety surowe,
 * typy transakcyjne (`payment_failed`), nazwy z rejestru szablonów w wariancie
 * z myślnikami (`subscription-renewed`) oraz prefiks kolejki autoryzacyjnej.
 */
export function emailCategoryForLabel(label: string | null | undefined): EmailCategory {
  const key = (label ?? "").trim().toLowerCase();
  if (!key) return "bulk";
  const raw = RAW_LABEL_CATEGORY[key];
  if (raw) return raw;
  // Rejestr szablonów używa myślników ("subscription-renewed"), typy
  // transakcyjne podkreśleń - normalizujemy do jednej postaci.
  const normalized = key.replace(/-/g, "_");
  if (normalized in TX_EMAIL_CATEGORY) {
    return TX_EMAIL_CATEGORY[normalized as TxEmailType];
  }
  const rawNormalized = RAW_LABEL_CATEGORY[normalized];
  if (rawNormalized) return rawNormalized;
  // Kolejka autoryzacyjna ma własną nazwę i własny prefiks etykiet.
  if (normalized === "auth_emails" || normalized.startsWith("auth_")) return "transactional";
  // Warianty językowe rejestru: "donation-received-pl" -> "donation_received".
  const withoutLangSuffix = normalized.replace(/_(pl|en)$/, "");
  if (withoutLangSuffix in TX_EMAIL_CATEGORY) {
    return TX_EMAIL_CATEGORY[withoutLangSuffix as TxEmailType];
  }
  if (withoutLangSuffix === "free_rsvp") return "transactional";
  return "bulk";
}
