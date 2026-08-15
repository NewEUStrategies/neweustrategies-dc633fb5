// Słownik portalu logowania / rejestracji (PL/EN).
// Import jako efekt uboczny w `components/auth/AuthPortal.tsx`.
//
// PO CO POWSTAŁ. Cała powierzchnia miała WŁASNY słownik wpisany w komponent -
// literał `{ pl: {...}, en: {...} }` zamknięty w `useMemo`, wybierany przez
// `isPl ? dict.pl : dict.en`. Kształt był poprawny (obie wersje obok siebie),
// ale mieszkał poza i18next, więc: bramka parytetu PL/EN nie miała czego
// porównać, tłumacz nie miał czego otworzyć, a trzeci język wymagałby edycji
// komponentu, nie słownika. Do tego pięć komunikatów błędu (limit prób, wyłączona
// rejestracja, braki w formularzu, niezgodne hasła) stało osobno, w ternarach
// wewnątrz handlera - czyli ta sama powierzchnia miała dwa różne mechanizmy.
//
// `heroTitle` / `heroSubtitle` NIE są tutaj: pochodzą z ustawień strony
// logowania (kolumny `hero_*_pl` / `hero_*_en`) i wybiera je `pickPair`.
import i18n from "./i18n";

export const authPortalPl = {
  authPortal: {
    signin: "Zaloguj się",
    signup: "Zarejestruj się",
    reset: "Resetuj hasło",
    haveNo: "Nie masz konta?",
    haveYes: "Masz już konto?",
    signUpLink: "Zarejestruj się",
    signInLink: "Zaloguj się",
    email: "E-mail",
    password: "Hasło",
    name: "Imię i nazwisko",
    forgot: "Zapomniałeś hasła?",
    back: "Wróć do logowania",
    submitSignin: "Zaloguj się",
    submitSignup: "Utwórz konto",
    submitReset: "Wyślij link",
    resetSub: "Wyślemy link do zmiany hasła na Twój adres.",
    legalPre: "Klikając przycisk, akceptujesz ",
    legalPrivacy: "Politykę prywatności",
    legalAnd: " i ",
    legalTerms: "Regulamin",
    legalSuf: ".",
    backHome: "Wróć na stronę",
    passwordPlaceholder: "Minimum 8 znaków",
    showPw: "Pokaż hasło",
    hidePw: "Ukryj hasło",
    errors: {
      rateLimited: "Zbyt wiele prób - spróbuj ponownie za kilka minut.",
      invalidInput: "Nieprawidłowe dane logowania - sprawdź adres email i spróbuj ponownie.",
      signupDisabled: "Rejestracja jest wyłączona.",
      missingFields: "Uzupełnij wymagane pola.",
      passwordMismatch: "Hasła nie są identyczne.",
    },
    toasts: {
      accountCreated: "Konto utworzone - sprawdź email.",
      resetSent: "Link wysłany. Sprawdź skrzynkę.",
      signedIn: "Zalogowano",
    },
  },
} as const;

export const authPortalEn = {
  authPortal: {
    signin: "Sign In",
    signup: "Sign Up",
    reset: "Reset password",
    haveNo: "Don't have an account?",
    haveYes: "Already have an account?",
    signUpLink: "Sign Up",
    signInLink: "Sign In",
    email: "E-Mail",
    password: "Password",
    name: "Full name",
    forgot: "Forgot password?",
    back: "Back to sign in",
    submitSignin: "Sign In",
    submitSignup: "Create account",
    submitReset: "Send link",
    resetSub: "We'll email a password reset link.",
    legalPre: "By clicking the button, you agree to the ",
    legalPrivacy: "Privacy Policy",
    legalAnd: " and ",
    legalTerms: "Terms of Service",
    legalSuf: ".",
    backHome: "Back to site",
    passwordPlaceholder: "At least 8 characters",
    showPw: "Show password",
    hidePw: "Hide password",
    errors: {
      rateLimited: "Too many attempts - please try again in a few minutes.",
      invalidInput: "Invalid sign-in details - check your email and try again.",
      signupDisabled: "Sign-up is disabled.",
      missingFields: "Please fill in all required fields.",
      passwordMismatch: "Passwords do not match.",
    },
    toasts: {
      accountCreated: "Account created - check your email.",
      resetSent: "Reset link sent. Check your inbox.",
      signedIn: "Signed in",
    },
  },
} as const;

i18n.addResourceBundle("pl", "translation", authPortalPl, true, true);
i18n.addResourceBundle("en", "translation", authPortalEn, true, true);
