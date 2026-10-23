// i18n decyzji o pomiarze otwarć i kliknięć - PL/EN (I9d-Y2, I9d-Y2b):
//   * strona linków `/newsletter/measurement`: „Nie mierz moich otwarć
//     i kliknięć" (stopka maili, preferencje) i „Zgadzam się na pomiar"
//     (prośba z panelu newslettera albo po zapisie z zaznaczonym polem
//     pomiaru bez double opt-in);
//   * karta decyzji na stronie potwierdzenia double opt-in
//     (`NewsletterConfirmMeasurementCard`: „Zgadzam się" / „Nie zgadzam się").
// Oba ekrany składa wspólny panel `MeasurementDecisionPanel` - jeden słownik,
// jedna geometria.
//
// Nakładka ładowana WYŁĄCZNIE z chunku komponentu strony albo leniwej karty:
// plik trasy woła `ensureI18n()` tylko w komponencie, a karta DOI jest
// `React.lazy`, więc podział kodu wynosi import do tych chunków - napisy nie
// trafiają do słownika rdzenia ani na ścieżkę bootowania żadnej innej strony
// czytelnika (D-08). Dwa zdania nagłówka dokumentu (`head()` jedzie
// w chunku startowym) żyją osobno: `i18n-newsletter-measurement-head.ts`.
//
// UWAGA NA ARKUSZ CSS. Pliki `src/lib/i18n-*.ts` skanuje generator arkusza
// PUBLICZNEGO - angielskie słowo równe klasie narzędziowej Tailwinda dokłada
// regułę do CSS każdej strony czytelnika (limit `publicCss` zamrożony).
// Napisy niżej są dobrane tak, żeby żadne nie było nazwą klasy.
import i18n from "@/lib/i18n";

const pl = {
  newsletterMeasurement: {
    loading: "Sprawdzamy link…",
    withdrawTitle: "Wyłączyć pomiar otwarć i kliknięć?",
    withdrawBody:
      "Nasze wiadomości mogą zawierać elementy mierzące otwarcia i kliknięcia - dzięki nim dopasowujemy treść i częstotliwość wysyłki oraz prowadzimy statystykę. Wyłączenie pomiaru nie wypisuje Cię z newslettera: nadal będziesz otrzymywać nasze analizy, tylko bez pomiaru.",
    withdrawBtn: "Nie mierz moich otwarć i kliknięć",
    grantTitle: "Zgoda na pomiar otwarć i kliknięć",
    grantLead: "Treść zgody, którą zapiszemy:",
    grantNote:
      "Zgodę możesz wycofać w każdej chwili linkiem „Nie mierz moich otwarć i kliknięć” w stopce każdej wiadomości. Bez tej zgody newsletter przychodzi dalej - po prostu bez pomiaru.",
    grantBtn: "Zgadzam się na pomiar",
    doiLead:
      "W formularzu zaznaczono pole zgody na pomiar. Zdecyduj, czy ją potwierdzasz - treść zgody, którą zapiszemy:",
    declineBtn: "Nie zgadzam się",
    working: "Zapisujemy…",
    withdrawnTitle: "Pomiar wyłączony",
    withdrawnBody:
      "Nie będziemy mierzyć otwarć i kliknięć w wiadomościach do Ciebie. Newsletter otrzymujesz dalej.",
    alreadyOffTitle: "Pomiar jest wyłączony",
    alreadyOffBody:
      "Wiadomości do Ciebie nie zawierają elementów mierzących otwarcia i kliknięcia. Nie musisz nic robić.",
    grantedTitle: "Dziękujemy - zgoda zapisana",
    grantedBody:
      "Możesz ją wycofać w każdej chwili linkiem „Nie mierz moich otwarć i kliknięć” w stopce wiadomości.",
    alreadyOnTitle: "Zgoda już zapisana",
    alreadyOnBody: "Ten link został już użyty - Twoja decyzja jest zapisana.",
    declinedTitle: "Zapisaliśmy Twoją decyzję",
    declinedBody: "Pomiar otwarć i kliknięć pozostaje wyłączony. Newsletter otrzymujesz dalej.",
    alreadyDecidedTitle: "Decyzja już zapisana",
    alreadyDecidedBody: "Twoja decyzja w sprawie pomiaru jest już zapisana.",
    inactiveTitle: "Subskrypcja nieaktywna",
    inactiveBody:
      "Ten adres nie jest zapisany do newslettera, więc nie wysyłamy do niego wiadomości.",
    goneTitle: "Nie znaleźliśmy adresu",
    goneBody: "Ten adres nie jest już na naszej liście - nie wysyłamy do niego wiadomości.",
    expiredTitle: "Link wygasł",
    expiredBody:
      "Prośba o zgodę jest już nieaktualna. Newsletter otrzymujesz dalej, bez pomiaru otwarć i kliknięć.",
    invalidTitle: "Nieprawidłowy link",
    invalidBody:
      "Link jest niepełny albo został zmieniony. Otwórz go ponownie z wiadomości e-mail.",
    errorTitle: "Coś poszło nie tak",
    errorBody: "Nie udało się zapisać Twojej decyzji. Spróbuj ponownie za chwilę.",
    rateLimitedBody: "Zbyt wiele prób z tego adresu sieci. Spróbuj ponownie za kilka minut.",
    retryBtn: "Spróbuj ponownie",
  },
};

const en: typeof pl = {
  newsletterMeasurement: {
    loading: "Checking the link…",
    withdrawTitle: "Stop measuring opens and clicks?",
    withdrawBody:
      "Our emails may contain elements that measure opens and clicks - they help us tailor the content and sending frequency and keep statistics. Switching off the measurement does not unsubscribe you: you will keep receiving our analysis, just without measurement.",
    withdrawBtn: "Don't measure my opens and clicks",
    grantTitle: "Consent to measuring opens and clicks",
    grantLead: "The consent wording we will record:",
    grantNote:
      "You can withdraw this consent at any time using the “Don't measure my opens and clicks” link at the bottom of every email. Without it, the newsletter keeps coming - just without measurement.",
    grantBtn: "I agree to the measurement",
    doiLead:
      "The measurement consent box was ticked in the form. Decide whether you confirm it - the consent wording we will record:",
    declineBtn: "I do not agree",
    working: "Saving…",
    withdrawnTitle: "Measurement switched off",
    withdrawnBody:
      "We will not measure opens and clicks in emails to you. You keep receiving the newsletter.",
    alreadyOffTitle: "Measurement is already off",
    alreadyOffBody:
      "Emails to you contain no elements that measure opens and clicks. There is nothing you need to do.",
    grantedTitle: "Thank you - consent recorded",
    grantedBody:
      "You can withdraw it at any time using the “Don't measure my opens and clicks” link at the bottom of our emails.",
    alreadyOnTitle: "Consent already recorded",
    alreadyOnBody: "This link has already been used - your decision is saved.",
    declinedTitle: "Your decision is saved",
    declinedBody: "Measuring opens and clicks stays off. You keep receiving the newsletter.",
    alreadyDecidedTitle: "Decision already saved",
    alreadyDecidedBody: "Your decision on measurement is already saved.",
    inactiveTitle: "Subscription not active",
    inactiveBody: "This address is not subscribed to the newsletter, so we send it no emails.",
    goneTitle: "Address not found",
    goneBody: "This address is no longer on our list - we send it no emails.",
    expiredTitle: "This link has expired",
    expiredBody:
      "The consent request is no longer current. You keep receiving the newsletter, without measuring opens and clicks.",
    invalidTitle: "Invalid link",
    invalidBody: "The link is incomplete or has been altered. Please open it again from the email.",
    errorTitle: "Something went wrong",
    errorBody: "We could not save your decision. Please try again in a moment.",
    rateLimitedBody:
      "Too many attempts from this network address. Please try again in a few minutes.",
    retryBtn: "Try again",
  },
};

// Rejestracja przy imporcie (bramki parytetu i rozjazdu ładują nakładki globem
// i liczą na efekt importu) oraz jawnie z komponentu (`ensureI18n()`).
let registered = false;
export function ensureI18n(): void {
  if (registered) return;
  registered = true;
  i18n.addResourceBundle("pl", "translation", pl, true, true);
  i18n.addResourceBundle("en", "translation", en, true, true);
}
ensureI18n();
