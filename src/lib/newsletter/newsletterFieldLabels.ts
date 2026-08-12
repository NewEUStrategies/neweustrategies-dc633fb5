// Jedno źródło prawdy dla etykiet pól WSZYSTKICH widgetów newslettera
// (widget "Newsletter", widget "Dołącz do nas", popup zapisu, formularz w
// stopce). Etykiety pochodzą z globalnej konfiguracji pól rejestracji
// (`newsletter_settings.popup_fields` - Admin → Popupy / Strona logowania),
// więc zmiana w panelu obowiązuje natychmiast w każdym widgecie.
//
// Precedencja: override z konfiguracji widgetu → globalna etykieta pola →
// wbudowany fallback PL/EN.
import { useMemo } from "react";
import { useRegistrationFields, type RegistrationLang } from "@/lib/auth/registrationFields";
import { popupFieldDefaultLabels } from "@/lib/newsletter/popupFields";

export type NewsletterFieldKey =
  | "firstName"
  | "lastName"
  | "name"
  | "email"
  | "position"
  | "linkedin"
  | "phone"
  | "company"
  | "country";

type Fallback = { pl: string; en: string };

/** Wbudowane etykiety - używane, gdy panel nie nadpisał pola. */
export const NEWSLETTER_FIELD_FALLBACKS: Record<NewsletterFieldKey, Fallback> = {
  firstName: { pl: "Imię", en: "First name" },
  lastName: { pl: "Nazwisko", en: "Last name" },
  name: { pl: "Imię i nazwisko", en: "Full name" },
  email: { pl: "Twój e-mail", en: "Your e-mail" },
  position: { pl: "Stanowisko", en: "Job position" },
  linkedin: { pl: "Adres profilu LinkedIn", en: "LinkedIn profile URL" },
  phone: { pl: "Telefon", en: "Phone" },
  company: { pl: "Firma", en: "Company" },
  country: { pl: "Kraj", en: "Country" },
};

/** Etykiety droplisty tematów - identyczne we wszystkich widgetach. */
export const NEWSLETTER_TOPIC_LABELS = {
  heading: { pl: "Tematy, które Cię interesują (opcjonalnie)", en: "Topics you care about" },
  placeholder: { pl: "Wybierz tematy…", en: "Select topics…" },
  selected: { pl: "Wybrano", en: "selected" },
  empty: { pl: "Brak wyboru", en: "Nothing selected" },
  clear: { pl: "Wyczyść", en: "Clear" },
  done: { pl: "Gotowe", en: "Done" },
  areas: { pl: "Obszary", en: "Areas" },
  topics: { pl: "Tematy", en: "Topics" },
  jumpToGroup: { pl: "Przejdź do grupy", en: "Jump to group" },
} as const;

export function topicLabel(key: keyof typeof NEWSLETTER_TOPIC_LABELS, lang: RegistrationLang) {
  return NEWSLETTER_TOPIC_LABELS[key][lang];
}

/** Podpis przycisku droplisty (liczba wybranych albo placeholder). */
export function topicsTriggerText(count: number, lang: RegistrationLang): string {
  if (count <= 0) return topicLabel("placeholder", lang);
  return lang === "en" ? `${count} selected` : `Wybrano: ${count}`;
}

/** Mapowanie kluczy newslettera na klucze globalnej konfiguracji rejestracji. */
const REGISTRATION_KEY: Partial<
  Record<
    NewsletterFieldKey,
    "first_name" | "last_name" | "email" | "job" | "linkedin" | "phone" | "company"
  >
> = {
  firstName: "first_name",
  lastName: "last_name",
  email: "email",
  position: "job",
  linkedin: "linkedin",
  phone: "phone",
  company: "company",
};

export interface NewsletterFieldLabels {
  /** Etykieta pola (override widgetu ma pierwszeństwo). */
  label: (key: NewsletterFieldKey, override?: string | null) => string;
  /** Nagłówek/teksty droplisty tematów. */
  topics: (key: keyof typeof NEWSLETTER_TOPIC_LABELS, override?: string | null) => string;
}

/** Hook: wspólne etykiety pól dla widgetów newslettera. */
export function useNewsletterFieldLabels(lang: RegistrationLang): NewsletterFieldLabels {
  const registration = useRegistrationFields(lang);
  return useMemo<NewsletterFieldLabels>(() => {
    const label = (key: NewsletterFieldKey, override?: string | null) => {
      const regKey = REGISTRATION_KEY[key];
      const global = regKey ? registration.label(regKey, "").trim() : "";
      const trimmed = typeof override === "string" ? override.trim() : "";
      // Override widgetu liczy się tylko wtedy, gdy operator naprawdę wpisał
      // własne brzmienie. Zapisane kopie fabrycznych etykiet (tak powstawały
      // configi widgetów) ustępują globalnej konfiguracji rejestracji, dzięki
      // czemu "Dołącz do nas" ma te same etykiety co zapis do newslettera i
      // zakładanie konta.
      const isFactoryCopy =
        trimmed !== "" &&
        (Object.values(NEWSLETTER_FIELD_FALLBACKS[key]).some(
          (v) => v.toLowerCase() === trimmed.toLowerCase(),
        ) ||
          (regKey
            ? popupFieldDefaultLabels(regKey).some((v) => v.toLowerCase() === trimmed.toLowerCase())
            : false));
      if (trimmed && !isFactoryCopy) return trimmed;
      return global || NEWSLETTER_FIELD_FALLBACKS[key][lang];
    };

    const topics = (key: keyof typeof NEWSLETTER_TOPIC_LABELS, override?: string | null) => {
      const trimmed = typeof override === "string" ? override.trim() : "";
      return trimmed || topicLabel(key, lang);
    };
    return { label, topics };
  }, [registration, lang]);
}
