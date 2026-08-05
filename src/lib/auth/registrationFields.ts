// Globalna konfiguracja pól rejestracji - JEDNO źródło prawdy dla wszystkich
// powierzchni, na których użytkownik zakłada konto:
//   * strona /login i /membership-registration (AuthPortal),
//   * popup rejestracji (PopupSignupForm),
//   * widget rejestracji w builderze (RegisterFormView),
//   * formularz newslettera, gdy zakłada konto.
//
// Dane trzymamy tam, gdzie już są najbogatsze - w `newsletter_settings.popup_fields`
// (patrz `@/lib/newsletter/popupFields`). Edycja w Admin → Popupy lub w
// Admin → Strona logowania zapisuje to samo miejsce, więc zmiana etykiety w
// jednym panelu natychmiast obowiązuje we wszystkich formularzach.
import { useMemo } from "react";
import { useNewsletterSettings } from "@/hooks/useNewsletterSettings";
import {
  popupFieldLabel,
  popupFieldPlaceholder,
  resolvePopupFields,
  type PopupFieldConfig,
  type PopupFieldKey,
} from "@/lib/newsletter/popupFields";

export type RegistrationFieldKey = PopupFieldKey;
export type RegistrationField = PopupFieldConfig;
export type RegistrationLang = "pl" | "en";

export interface RegistrationFieldsApi {
  /** Pełna, uporządkowana lista pól (z defaultami dla brakujących kluczy). */
  fields: RegistrationField[];
  /** Pola widoczne w formularzu. */
  visible: RegistrationField[];
  get: (key: RegistrationFieldKey) => RegistrationField | undefined;
  isEnabled: (key: RegistrationFieldKey) => boolean;
  isRequired: (key: RegistrationFieldKey) => boolean;
  label: (key: RegistrationFieldKey, fallback?: string) => string;
  placeholder: (key: RegistrationFieldKey, fallback?: string) => string;
}

/** Zbudowanie API pól z surowego JSON-a (bez React - używalne w testach). */
export function buildRegistrationFieldsApi(
  raw: unknown,
  lang: RegistrationLang,
): RegistrationFieldsApi {
  const fields = resolvePopupFields(raw);
  const map = new Map<RegistrationFieldKey, RegistrationField>(fields.map((f) => [f.key, f]));
  const get = (key: RegistrationFieldKey) => map.get(key);
  return {
    fields,
    visible: fields.filter((f) => f.enabled),
    get,
    isEnabled: (key) => get(key)?.enabled === true,
    isRequired: (key) => get(key)?.required === true,
    label: (key, fallback = "") => {
      const f = get(key);
      return f ? popupFieldLabel(f, lang) : fallback;
    },
    placeholder: (key, fallback = "") => {
      const f = get(key);
      const value = f ? popupFieldPlaceholder(f, lang) : "";
      return value || fallback;
    },
  };
}

/** Hook: globalna konfiguracja pól rejestracji dla bieżącego języka. */
export function useRegistrationFields(lang: RegistrationLang): RegistrationFieldsApi {
  const { data } = useNewsletterSettings();
  const raw = data?.popup_fields;
  return useMemo(() => buildRegistrationFieldsApi(raw, lang), [raw, lang]);
}

export interface RegistrationValues {
  firstName?: string;
  lastName?: string;
  job?: string;
  company?: string;
  linkedin?: string;
  phone?: string;
  email: string;
  newsletterOptIn?: boolean;
  customFields?: Record<string, string>;
}

/**
 * Kanoniczna mapa `user_metadata` przekazywana do `supabase.auth.signUp()`.
 * Klucze muszą pozostać zsynchronizowane z triggerem `handle_new_user`, który
 * przepisuje je do `public.profiles` (wraz z `tenant_id`).
 */
export function buildSignupMetadata(
  values: RegistrationValues,
  opts: { lang: RegistrationLang; source: string },
): Record<string, unknown> {
  const clean = (v: string | undefined) => {
    const s = (v ?? "").trim();
    return s.length > 0 ? s : undefined;
  };
  const firstName = clean(values.firstName);
  const lastName = clean(values.lastName);
  const fullName = [firstName, lastName].filter(Boolean).join(" ");
  const displayName = fullName || values.email.split("@")[0];

  const metadata: Record<string, unknown> = {
    display_name: displayName,
    first_name: firstName ?? "",
    last_name: lastName ?? "",
    full_name: fullName || displayName,
    signup_type: "reader",
    signup_source: opts.source,
    preferred_language: opts.lang,
    marketing_opt_in: values.newsletterOptIn === true,
  };
  const position = clean(values.job);
  const company = clean(values.company);
  const linkedin = clean(values.linkedin);
  const phone = clean(values.phone);
  if (position) metadata.position = position;
  if (company) metadata.company = company;
  if (linkedin) metadata.linkedin = linkedin;
  if (phone) metadata.phone = phone;
  if (values.customFields && Object.keys(values.customFields).length > 0) {
    metadata.custom_fields = values.customFields;
  }
  return metadata;
}
