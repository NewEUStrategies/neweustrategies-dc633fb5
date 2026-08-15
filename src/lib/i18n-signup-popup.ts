import i18n from "./i18n";

// Klucze publicznego popupu rejestracji konta (wariant "showcase").
// Treści redakcyjne (nagłówki, opisy, etykiety pól, zgody) pochodzą z bazy
// w dwóch wersjach językowych - tutaj żyją wyłącznie napisy interfejsu.
const pl = {
  signupPopup: {
    slide: "Slajd",
    next: "Następny kadr",
    // Napisy interfejsu formularza. Szły wcześniej przez lokalne
    // `const t = (pl, en) => ...` - bliźniaka nazwanego dokładnie jak funkcja
    // tłumacząca, więc w review wyglądały na wywołanie i18next, a były twardym
    // dwujęzycznym tekstem w kodzie (bramka `check:i18n-hardcoded` nie widzi
    // małego `t`, żeby nie łapać prawdziwego i18next).
    errors: {
      invalidEmail: "Niepoprawny adres e-mail.",
      passwordMismatch: "Hasła nie są identyczne.",
      privacyRequired: "Wymagana akceptacja Polityki prywatności.",
      termsRequired: "Wymagana akceptacja regulaminu.",
      signupDisabled: "Rejestracja jest wyłączona.",
    },
    ctaFallback: "Załóż konto",
    noteFallback: "Zakładając konto potwierdzasz adres e-mail. Zero spamu.",
    hidePassword: "Ukryj hasło",
    showPassword: "Pokaż hasło",
    chooseList: "Wybierz listę",
    creatingAccount: "Tworzę konto…",
    success: {
      title: "Dane zostały wysłane!",
      body: "Teraz potwierdź rejestrację konta w wiadomości e-mail - kliknij link aktywacyjny, który wysłaliśmy na adres:",
      spamHint: "Nie widzisz wiadomości? Sprawdź folder Spam lub Oferty.",
      resendSending: "Wysyłanie...",
      resendSent: "Wysłano ponownie",
      resend: "Wyślij link ponownie",
    },
    // Treść zgody trafia do rejestru zgód RODO razem ze znacznikiem języka,
    // w którym została pokazana - dlatego jest kluczem, a nie ternarem.
    newsletterConsent:
      "Zapisuję się do newslettera i akceptuję otrzymywanie wiadomości marketingowych.",
  },
};

const en = {
  signupPopup: {
    slide: "Slide",
    next: "Next frame",
    errors: {
      invalidEmail: "Invalid e-mail address.",
      passwordMismatch: "Passwords do not match.",
      privacyRequired: "Please accept the Privacy Policy.",
      termsRequired: "Please accept the terms.",
      signupDisabled: "Sign-up is disabled.",
    },
    ctaFallback: "Create account",
    noteFallback: "Creating an account confirms your e-mail. Zero spam.",
    hidePassword: "Hide password",
    showPassword: "Show password",
    chooseList: "Choose a list",
    creatingAccount: "Creating account…",
    success: {
      title: "Your details were sent!",
      body: "Now confirm your registration by e-mail - click the activation link we sent to:",
      spamHint: "Can't find the message? Check your Spam or Promotions folder.",
      resendSending: "Sending...",
      resendSent: "Sent again",
      resend: "Resend the link",
    },
    newsletterConsent: "I subscribe to the newsletter and accept receiving marketing messages.",
  },
};

i18n.addResourceBundle("pl", "translation", pl, true, true);
i18n.addResourceBundle("en", "translation", en, true, true);

export {};
