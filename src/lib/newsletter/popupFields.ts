// Konfiguracja pól formularza popupu rejestracyjnego (prawa strona wariantu
// "showcase" oraz pozostałych układów). Jedno źródło prawdy dla:
// - panelu administracyjnego (edycja etykiet PL/EN, włącz/wyłącz, wymagane)
// - publicznego formularza (renderowanie i walidacja)
//
// Zapisujemy tylko nadpisania w kolumnie `popup_fields` (jsonb); brakujące
// klucze uzupełniamy defaultami poniżej, więc stare tenanty działają bez zmian.

export const POPUP_FIELD_KEYS = [
  "first_name",
  "last_name",
  "job",
  "company",
  "linkedin",
  "email",
  "phone",
  "password",
  "password_confirm",
  "list",
  "newsletter_optin",
] as const;


export type PopupFieldKey = (typeof POPUP_FIELD_KEYS)[number];

export interface PopupFieldConfig {
  key: PopupFieldKey;
  enabled: boolean;
  required: boolean;
  label_pl: string;
  label_en: string;
}

interface FieldDefault {
  enabled: boolean;
  required: boolean;
  label_pl: string;
  label_en: string;
  /** Pola, których nie da się wyłączyć ani odznaczyć jako wymagane. */
  locked?: boolean;
}

const DEFAULTS: Record<PopupFieldKey, FieldDefault> = {
  first_name: { enabled: true, required: false, label_pl: "Imię", label_en: "First name" },
  last_name: { enabled: true, required: false, label_pl: "Nazwisko", label_en: "Last name" },
  job: { enabled: true, required: false, label_pl: "Stanowisko", label_en: "Job position" },
  company: {
    enabled: true,
    required: false,
    label_pl: "Firma / organizacja",
    label_en: "Company",
  },
  linkedin: { enabled: true, required: false, label_pl: "LinkedIn", label_en: "LinkedIn" },
  email: {
    enabled: true,
    required: true,
    label_pl: "Twój e-mail",
    label_en: "Your e-mail",
    locked: true,
  },
  phone: { enabled: true, required: false, label_pl: "Numer telefonu", label_en: "Phone number" },
  password: {
    enabled: true,
    required: true,
    label_pl: "Hasło",
    label_en: "Password",
    locked: true,
  },
  password_confirm: {
    enabled: true,
    required: true,
    label_pl: "Powtórz hasło",
    label_en: "Repeat password",
    locked: true,
  },
  list: {
    enabled: true,
    required: false,
    label_pl: "Lista mailingowa",
    label_en: "Mailing list",
  },
  newsletter_optin: {
    enabled: true,
    required: false,
    label_pl: "Chcę otrzymywać newsletter",
    label_en: "I want to receive the newsletter",
  },
};

export function isPopupFieldLocked(key: PopupFieldKey): boolean {
  return DEFAULTS[key].locked === true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function str(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() !== "" ? value : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/**
 * Scala zapisane nadpisania z defaultami i zwraca pełną, uporządkowaną listę.
 * Kolejność wynika z POPUP_FIELD_KEYS, dzięki czemu podgląd w adminie i strona
 * publiczna renderują identyczny układ.
 */
export function resolvePopupFields(raw: unknown): PopupFieldConfig[] {
  const overrides = new Map<string, Record<string, unknown>>();
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (isRecord(item) && typeof item.key === "string") overrides.set(item.key, item);
    }
  }

  return POPUP_FIELD_KEYS.map((key) => {
    const def = DEFAULTS[key];
    const o = overrides.get(key);
    const locked = def.locked === true;
    return {
      key,
      enabled: locked ? true : bool(o?.enabled, def.enabled),
      required: locked ? true : bool(o?.required, def.required),
      label_pl: str(o?.label_pl, def.label_pl),
      label_en: str(o?.label_en, def.label_en),
    };
  });
}

export function popupFieldLabel(field: PopupFieldConfig, lang: "pl" | "en"): string {
  return lang === "pl" ? field.label_pl : field.label_en;
}

/** Mapa key -> config, wygodna przy renderowaniu formularza. */
export function popupFieldMap(raw: unknown): Record<PopupFieldKey, PopupFieldConfig> {
  const list = resolvePopupFields(raw);
  return list.reduce(
    (acc, field) => {
      acc[field.key] = field;
      return acc;
    },
    {} as Record<PopupFieldKey, PopupFieldConfig>,
  );
}
