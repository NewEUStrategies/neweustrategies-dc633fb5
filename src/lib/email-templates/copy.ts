import type { EmailIconName } from "./icons";
import type { EmailLang } from "./nes-layout";
import type { PolishGender } from "@/lib/i18n/polishVocative";

/**
 * Treści maili autoryzacyjnych w PL i EN. Jedno źródło prawdy dla szablonów
 * (body) i webhooka (subject/preheader).
 */

export type AuthEmailType =
  "signup" | "invite" | "magiclink" | "recovery" | "email_change" | "reauthentication";

interface Copy {
  subject: string;
  icon: EmailIconName;
  preview: string;
  eyebrow: string;
  heading: string;
  intro: string;
  cta: string;
  fallback: string;
  security: string;
  expiry: string;
}

/**
 * Wartość tekstu może zależeć od rodzaju gramatycznego odbiorcy (PL).
 * Rodzaj wynika z imienia rozpoznanego w słowniku imion (panel admina).
 */
type GenderedText = string | ((gender: PolishGender) => string);

type RawCopy = { [K in keyof Copy]: K extends "icon" ? EmailIconName : GenderedText };

type Dict = Record<AuthEmailType, RawCopy>;

/** Męska / żeńska / neutralna (bezosobowa) wersja zdania. */
const g =
  (male: string, female: string, neutral: string) =>
  (gender: PolishGender): string =>
    gender === "male" ? male : gender === "female" ? female : neutral;

const PL: Dict = {
  signup: {
    subject: "✅ Potwierdź adres e-mail - New European Strategies",
    icon: "hero-check",
    preview: "Jeden klik dzieli Cię od aktywacji konta w New European Strategies.",
    eyebrow: "Aktywacja konta",
    heading: "Potwierdź swój adres e-mail",
    intro:
      "Dziękujemy za założenie konta w New European Strategies. Aby uzyskać dostęp do analiz, danych i materiałów eksperckich, potwierdź swój adres e-mail.",
    cta: "Potwierdzam adres e-mail",
    fallback: "Jeśli przycisk nie działa, skopiuj poniższy adres do przeglądarki:",
    security: g(
      "Jeśli to nie Ty zakładałeś konto, zignoruj tę wiadomość - nic się nie wydarzy.",
      "Jeśli to nie Ty zakładałaś konto, zignoruj tę wiadomość - nic się nie wydarzy.",
      "Jeśli konto nie zostało założone przez Ciebie, zignoruj tę wiadomość - nic się nie wydarzy.",
    ),
    expiry: "Link jest ważny przez ograniczony czas ze względów bezpieczeństwa.",
  },
  invite: {
    subject: "🤝 Zaproszenie do New European Strategies",
    icon: "hero-handshake",
    preview: g(
      "Otrzymałeś zaproszenie do platformy New European Strategies.",
      "Otrzymałaś zaproszenie do platformy New European Strategies.",
      "Zaproszenie do platformy New European Strategies czeka na Ciebie.",
    ),
    eyebrow: "Zaproszenie",
    heading: "Zaproszenie do platformy",
    intro: g(
      "Zostałeś zaproszony do New European Strategies - platformy analiz, danych i doradztwa strategicznego. Przyjmij zaproszenie, aby utworzyć konto i ustawić hasło.",
      "Zostałaś zaproszona do New European Strategies - platformy analiz, danych i doradztwa strategicznego. Przyjmij zaproszenie, aby utworzyć konto i ustawić hasło.",
      "Zapraszamy Cię do New European Strategies - platformy analiz, danych i doradztwa strategicznego. Przyjmij zaproszenie, aby utworzyć konto i ustawić hasło.",
    ),
    cta: "Przyjmuję zaproszenie",
    fallback: "Jeśli przycisk nie działa, skopiuj poniższy adres do przeglądarki:",
    security: "Jeśli zaproszenie trafiło do Ciebie omyłkowo, po prostu je zignoruj.",
    expiry: "Zaproszenie jest ważne przez ograniczony czas.",
  },
  magiclink: {
    subject: "🔐 Twój link logowania - New European Strategies",
    icon: "hero-log-in",
    preview: "Bezpieczny link do zalogowania się bez hasła.",
    eyebrow: "Logowanie",
    heading: "Zaloguj się jednym kliknięciem",
    intro:
      "Poniższy link pozwala zalogować się do New European Strategies bez podawania hasła. Otwórz go na urządzeniu, z którego chcesz korzystać z platformy.",
    cta: "Zaloguj się",
    fallback: "Jeśli przycisk nie działa, skopiuj poniższy adres do przeglądarki:",
    security: g(
      "Nie przekazuj tego linku nikomu - daje on pełny dostęp do Twojego konta. Jeśli nie prosiłeś o logowanie, zignoruj tę wiadomość.",
      "Nie przekazuj tego linku nikomu - daje on pełny dostęp do Twojego konta. Jeśli nie prosiłaś o logowanie, zignoruj tę wiadomość.",
      "Nie przekazuj tego linku nikomu - daje on pełny dostęp do Twojego konta. Jeśli prośba o logowanie nie pochodziła od Ciebie, zignoruj tę wiadomość.",
    ),
    expiry: "Link wygasa po krótkim czasie i może zostać użyty tylko raz.",
  },
  recovery: {
    subject: "🔑 Reset hasła - New European Strategies",
    icon: "hero-key",
    preview: "Ustaw nowe hasło do swojego konta w New European Strategies.",
    eyebrow: "Bezpieczeństwo konta",
    heading: "Ustaw nowe hasło",
    intro:
      "Otrzymaliśmy prośbę o zresetowanie hasła do Twojego konta. Kliknij przycisk poniżej, aby ustawić nowe hasło.",
    cta: "Ustawiam nowe hasło",
    fallback: "Jeśli przycisk nie działa, skopiuj poniższy adres do przeglądarki:",
    security: g(
      "Jeśli nie prosiłeś o zmianę hasła, zignoruj tę wiadomość - Twoje obecne hasło pozostaje aktywne.",
      "Jeśli nie prosiłaś o zmianę hasła, zignoruj tę wiadomość - Twoje obecne hasło pozostaje aktywne.",
      "Jeśli prośba o zmianę hasła nie pochodziła od Ciebie, zignoruj tę wiadomość - Twoje obecne hasło pozostaje aktywne.",
    ),
    expiry: "Link do resetu hasła jest ważny przez ograniczony czas.",
  },
  email_change: {
    subject: "📧 Potwierdź zmianę adresu e-mail - New European Strategies",
    icon: "hero-mail",
    preview: "Potwierdź nowy adres e-mail przypisany do Twojego konta.",
    eyebrow: "Zmiana danych konta",
    heading: "Potwierdź nowy adres e-mail",
    intro:
      "Otrzymaliśmy prośbę o zmianę adresu e-mail przypisanego do Twojego konta w New European Strategies. Potwierdź zmianę, aby zaczęła obowiązywać.",
    cta: "Potwierdzam zmianę",
    fallback: "Jeśli przycisk nie działa, skopiuj poniższy adres do przeglądarki:",
    security: g(
      "Jeśli to nie Ty zleciłeś zmianę, zignoruj tę wiadomość i skontaktuj się z nami - adres nie zostanie zmieniony.",
      "Jeśli to nie Ty zleciłaś zmianę, zignoruj tę wiadomość i skontaktuj się z nami - adres nie zostanie zmieniony.",
      "Jeśli zmiana nie została zlecona przez Ciebie, zignoruj tę wiadomość i skontaktuj się z nami - adres nie zostanie zmieniony.",
    ),
    expiry: "Link potwierdzający jest ważny przez ograniczony czas.",
  },
  reauthentication: {
    subject: "🛡️ Kod weryfikacyjny - New European Strategies",
    icon: "hero-shield",
    preview: "Twój jednorazowy kod weryfikacyjny.",
    eyebrow: "Weryfikacja tożsamości",
    heading: "Twój kod weryfikacyjny",
    intro: "Wpisz poniższy kod w oknie platformy, aby potwierdzić swoją tożsamość.",
    cta: "",
    fallback: "",
    security: g(
      "Nigdy nie podawaj tego kodu osobom trzecim. Jeśli nie prosiłeś o weryfikację, zmień hasło do konta.",
      "Nigdy nie podawaj tego kodu osobom trzecim. Jeśli nie prosiłaś o weryfikację, zmień hasło do konta.",
      "Nigdy nie podawaj tego kodu osobom trzecim. Jeśli prośba o weryfikację nie pochodziła od Ciebie, zmień hasło do konta.",
    ),
    expiry: "Kod wygasa po kilku minutach.",
  },
};

const EN: Dict = {
  signup: {
    subject: "✅ Confirm your email - New European Strategies",
    icon: "hero-check",
    preview: "One click left to activate your New European Strategies account.",
    eyebrow: "Account activation",
    heading: "Confirm your email address",
    intro:
      "Thank you for creating an account with New European Strategies. Confirm your email address to unlock our analysis, data and expert insights.",
    cta: "Confirm email address",
    fallback: "If the button does not work, copy this address into your browser:",
    security:
      "If you did not create this account, simply ignore this message - nothing will happen.",
    expiry: "For security reasons this link is valid for a limited time.",
  },
  invite: {
    subject: "🤝 You have been invited to New European Strategies",
    icon: "hero-handshake",
    preview: "You have received an invitation to the New European Strategies platform.",
    eyebrow: "Invitation",
    heading: "You have been invited",
    intro:
      "You have been invited to New European Strategies - a platform for analysis, data and strategic advisory. Accept the invitation to create your account and set a password.",
    cta: "Accept invitation",
    fallback: "If the button does not work, copy this address into your browser:",
    security: "If this invitation reached you by mistake, you can safely ignore it.",
    expiry: "The invitation is valid for a limited time.",
  },
  magiclink: {
    subject: "🔐 Your sign-in link - New European Strategies",
    icon: "hero-log-in",
    preview: "A secure link to sign in without a password.",
    eyebrow: "Sign in",
    heading: "Sign in with one click",
    intro:
      "Use the link below to sign in to New European Strategies without a password. Open it on the device you want to use.",
    cta: "Sign in",
    fallback: "If the button does not work, copy this address into your browser:",
    security:
      "Never share this link - it grants full access to your account. If you did not request it, ignore this message.",
    expiry: "The link expires shortly and can be used only once.",
  },
  recovery: {
    subject: "🔑 Reset your password - New European Strategies",
    icon: "hero-key",
    preview: "Set a new password for your New European Strategies account.",
    eyebrow: "Account security",
    heading: "Set a new password",
    intro:
      "We received a request to reset the password for your account. Click the button below to choose a new password.",
    cta: "Set a new password",
    fallback: "If the button does not work, copy this address into your browser:",
    security:
      "If you did not request a password change, ignore this message - your current password stays active.",
    expiry: "The password reset link is valid for a limited time.",
  },
  email_change: {
    subject: "📧 Confirm your new email - New European Strategies",
    icon: "hero-mail",
    preview: "Confirm the new email address linked to your account.",
    eyebrow: "Account details change",
    heading: "Confirm your new email address",
    intro:
      "We received a request to change the email address linked to your New European Strategies account. Confirm the change to activate it.",
    cta: "Confirm the change",
    fallback: "If the button does not work, copy this address into your browser:",
    security:
      "If you did not request this change, ignore this message and contact us - the address will not be changed.",
    expiry: "The confirmation link is valid for a limited time.",
  },
  reauthentication: {
    subject: "🛡️ Your verification code - New European Strategies",
    icon: "hero-shield",
    preview: "Your one-time verification code.",
    eyebrow: "Identity verification",
    heading: "Your verification code",
    intro: "Enter the code below in the platform window to confirm your identity.",
    cta: "",
    fallback: "",
    security:
      "Never share this code with anyone. If you did not request verification, change your account password.",
    expiry: "The code expires after a few minutes.",
  },
};

function resolve(value: GenderedText, gender: PolishGender): string {
  return typeof value === "function" ? value(gender) : value;
}

/**
 * Zwraca treść maila w danym języku. W PL zdania z formami osobowymi
 * odmieniane są przez rodzaj odbiorcy (męski / żeński / bezosobowy fallback).
 */
export function authCopy(
  type: AuthEmailType,
  lang: EmailLang,
  gender: PolishGender = "unknown",
): Copy {
  const raw = (lang === "en" ? EN : PL)[type];
  const effective: PolishGender = lang === "en" ? "unknown" : gender;
  return {
    subject: resolve(raw.subject, effective),
    icon: raw.icon,
    preview: resolve(raw.preview, effective),
    eyebrow: resolve(raw.eyebrow, effective),
    heading: resolve(raw.heading, effective),
    intro: resolve(raw.intro, effective),
    cta: resolve(raw.cta, effective),
    fallback: resolve(raw.fallback, effective),
    security: resolve(raw.security, effective),
    expiry: resolve(raw.expiry, effective),
  };
}

export function authIcon(type: AuthEmailType, lang: EmailLang): EmailIconName {
  return (lang === "en" ? EN : PL)[type].icon;
}

export function authSubject(type: AuthEmailType, lang: EmailLang): string {
  return authCopy(type, lang).subject;
}

export const EMAIL_CHANGE_LABELS = {
  pl: { from: "Obecny adres", to: "Nowy adres" },
  en: { from: "Current address", to: "New address" },
} as const;
