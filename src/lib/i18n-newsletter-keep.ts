// i18n strony „Chcę dalej otrzymywać" (/newsletter/keep, I9d-Y1 - wygaszanie
// nieaktywnych subskrybentów newslettera) - PL/EN.
//
// Nakładka ładowana WYŁĄCZNIE z chunku strony (import w pliku trasy): napisy
// nie trafiają do słownika rdzenia ani na ścieżkę bootowania żadnej innej
// strony czytelnika.
//
// UWAGA NA ARKUSZ CSS. Pliki `src/lib/i18n-*.ts` skanuje generator arkusza
// PUBLICZNEGO - angielskie słowo równe klasie narzędziowej Tailwinda dokłada
// regułę do CSS każdej strony czytelnika (limit `publicCss` zamrożony).
// Napisy niżej są dobrane tak, żeby żadne nie było nazwą klasy.
import i18n from "@/lib/i18n";

const pl = {
  newsletterKeep: {
    metaTitle: "Newsletter - potwierdzenie subskrypcji",
    metaDescription: "Potwierdź, że chcesz dalej otrzymywać newsletter New European Strategies.",
    loading: "Sprawdzamy link…",
    title: "Czy chcesz dalej otrzymywać nasz newsletter?",
    body: "Potwierdź jednym kliknięciem, a Twój adres zostanie na liście newslettera New European Strategies.",
    confirmBtn: "Chcę dalej otrzymywać",
    working: "Zapisujemy…",
    okTitle: "Dziękujemy - zostajesz z nami",
    okBody:
      "Twój adres pozostaje na liście newslettera. Kolejne analizy trafią do Twojej skrzynki.",
    alreadyTitle: "Już potwierdzone",
    alreadyBody: "Ten link został już użyty - Twoja decyzja jest zapisana.",
    inactiveTitle: "Subskrypcja nieaktywna",
    inactiveBody:
      "Ten adres nie jest już zapisany do newslettera. Jeśli chcesz go otrzymywać, zapisz się ponownie.",
    goneTitle: "Adres usunięty z listy",
    goneBody:
      "Termin na potwierdzenie minął i Twój adres został usunięty z listy newslettera. Zapisać się ponownie możesz w każdej chwili.",
    expiredTitle: "Link wygasł",
    expiredBody: "Jeśli chcesz otrzymywać newsletter, zapisz się ponownie - zajmie to chwilę.",
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
  newsletterKeep: {
    metaTitle: "Newsletter - subscription confirmation",
    metaDescription:
      "Confirm that you want to keep receiving the New European Strategies newsletter.",
    loading: "Checking the link…",
    title: "Do you want to keep receiving our newsletter?",
    body: "Confirm with one click and your address will stay on the New European Strategies newsletter list.",
    confirmBtn: "Keep me subscribed",
    working: "Saving…",
    okTitle: "Thank you - you are staying with us",
    okBody: "Your address stays on the newsletter list. Our next analysis will reach your inbox.",
    alreadyTitle: "Already confirmed",
    alreadyBody: "This link has already been used - your decision is saved.",
    inactiveTitle: "Subscription not active",
    inactiveBody:
      "This address is no longer subscribed to the newsletter. If you would like to receive it, please subscribe again.",
    goneTitle: "Address removed from the list",
    goneBody:
      "The confirmation period has ended and your address was removed from the newsletter list. You can subscribe again at any time.",
    expiredTitle: "This link has expired",
    expiredBody:
      "If you would like to receive the newsletter, please subscribe again - it only takes a moment.",
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
