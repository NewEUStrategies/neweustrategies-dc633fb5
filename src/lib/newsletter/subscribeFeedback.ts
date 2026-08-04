// Jedno źródło prawdy dla komunikatów po zapisie do newslettera.
//
// Formularz widgetu, popup i strona newslettera wołają ten sam serwerowy
// `subscribeToNewsletter`, który zwraca surowe kody (`rate_limited`,
// `policy_violation:...`, komunikat błędu bazy). Tłumaczenie kodu na zdanie dla
// człowieka nie może żyć w komponencie - inaczej każda powierzchnia pokazuje coś
// innego (albo surowy kod, jak dotąd).

export type SubscribeStatus = "pending" | "subscribed" | "exists";

export type SubscribeSuccessCopy = { title: string; hint?: string };

type Lang = "pl" | "en";

const L = (lang: string): Lang => (lang === "en" ? "en" : "pl");

const SUCCESS: Record<Lang, Record<SubscribeStatus, SubscribeSuccessCopy>> = {
  pl: {
    pending: {
      title: "Prawie gotowe - potwierdź zapis",
      hint: "Wysłaliśmy e-mail z linkiem potwierdzającym. Kliknij go, żeby dokończyć zapis (sprawdź też folder Oferty/Spam).",
    },
    subscribed: {
      title: "Zapisano do newslettera",
      hint: "Potwierdzenie wysłaliśmy na Twój adres e-mail.",
    },
    exists: {
      title: "Ten adres jest już zapisany",
      hint: "Nie musisz robić nic więcej - kolejne wydanie trafi do Twojej skrzynki.",
    },
  },
  en: {
    pending: {
      title: "Almost there - confirm your subscription",
      hint: "We sent you a confirmation link. Click it to finish signing up (check the Promotions/Spam folder too).",
    },
    subscribed: {
      title: "You're subscribed",
      hint: "We sent a confirmation to your email address.",
    },
    exists: {
      title: "This address is already subscribed",
      hint: "Nothing else to do - the next issue will land in your inbox.",
    },
  },
};

export function subscribeSuccessCopy(
  status: SubscribeStatus | undefined,
  lang: string,
  fallbackTitle?: string | null,
): SubscribeSuccessCopy {
  const copy = SUCCESS[L(lang)][status ?? "pending"];
  // Tenant może mieć własny tekst sukcesu w ustawieniach - ma pierwszeństwo
  // przed naszym domyślnym nagłówkiem, ale podpowiedź (co dalej) zostaje.
  return fallbackTitle?.trim() ? { title: fallbackTitle.trim(), hint: copy.hint } : copy;
}

const ERRORS: Record<Lang, Record<string, string>> = {
  pl: {
    not_configured: "Newsletter nie jest jeszcze skonfigurowany. Spróbuj ponownie później.",
    disabled: "Zapisy do newslettera są chwilowo wyłączone.",
    email_not_configured: "Nie możemy teraz wysłać e-maila potwierdzającego. Spróbuj później.",
    rate_limited: "Zbyt wiele prób. Odczekaj chwilę i spróbuj ponownie.",
    suppressed:
      "Nie możemy wysyłać wiadomości na ten adres - został wcześniej trwale zablokowany (odbicie lub zgłoszenie spamu). Napisz do nas, jeśli to pomyłka.",
    policy_violation: "Uzupełnij wymagane pola formularza i spróbuj ponownie.",
    network: "Brak połączenia z serwerem. Sprawdź internet i spróbuj ponownie.",
    generic: "Nie udało się zapisać. Spróbuj ponownie za chwilę.",
  },
  en: {
    not_configured: "The newsletter is not configured yet. Please try again later.",
    disabled: "Newsletter sign-ups are temporarily disabled.",
    email_not_configured: "We can't send the confirmation email right now. Please try later.",
    rate_limited: "Too many attempts. Please wait a moment and try again.",
    suppressed:
      "We cannot email this address - it was permanently blocked earlier (bounce or spam report). Contact us if this is a mistake.",
    policy_violation: "Please fill in the required fields and try again.",
    network: "No connection to the server. Check your internet and try again.",
    generic: "We couldn't complete the sign-up. Please try again in a moment.",
  },
};

export function subscribeErrorTitle(lang: string): string {
  return L(lang) === "en" ? "Sign-up failed" : "Nie udało się zapisać";
}

/**
 * Zamienia kod/komunikat z serwera na zdanie dla użytkownika. Surowe błędy
 * bazy/technikalia nigdy nie trafiają na ekran - lądują w generycznym tekście.
 */
export function subscribeErrorMessage(raw: string | null | undefined, lang: string): string {
  const dict = ERRORS[L(lang)];
  const code = (raw ?? "").trim();
  if (!code) return dict.generic;
  if (code.startsWith("policy_violation")) return dict.policy_violation;
  if (/failed to fetch|networkerror|load failed/i.test(code)) return dict.network;
  return dict[code] ?? dict.generic;
}
