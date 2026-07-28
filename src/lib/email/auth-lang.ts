// Rozstrzyganie języka maili autoryzacyjnych (PL/EN).
//
// Webhook auth dostaje z Supabase tylko `redirect_to` / `url` i metadane
// użytkownika - parametr `lang` bywa nieobecny albo zawiera nieznaną wartość
// (np. `?lang=de`, `?lang=EN-gb`). Dlatego język ustalamy deterministycznym
// łańcuchem fallbacków, a źródło decyzji logujemy do diagnostyki.
//
// Kolejność: jawny parametr -> prefiks ścieżki -> metadane użytkownika ->
// Accept-Language -> domyślny PL.

export type EmailLangCode = "pl" | "en";

export type AuthLangSource =
  | "param"
  | "path"
  | "metadata"
  | "header"
  | "default";

export interface AuthLangInput {
  /** `payload.data.redirect_to` */
  redirectTo?: string | null;
  /** `payload.data.url` (action link) */
  actionUrl?: string | null;
  /** `payload.data.user.user_metadata` */
  userMetadata?: Record<string, unknown> | null;
  /** Nagłówek `Accept-Language` z żądania webhooka. */
  acceptLanguage?: string | null;
}

export interface AuthLangResult {
  lang: EmailLangCode;
  source: AuthLangSource;
  /** Surowa wartość, która zadecydowała (lub została odrzucona jako nieznana). */
  rawValue: string | null;
  /** True, gdy nie udało się rozpoznać języka i użyto wartości domyślnej. */
  usedFallback: boolean;
  /** True, gdy w URL-u był parametr `lang`, ale z nieobsługiwaną wartością. */
  unknownParam: boolean;
}

export const DEFAULT_EMAIL_LANG: EmailLangCode = "pl";

const SUPPORTED: readonly EmailLangCode[] = ["pl", "en"];

/** Normalizuje `EN`, `en-GB`, `pl_PL`, ` en ` do obsługiwanego kodu. */
export function normalizeLangCode(value: unknown): EmailLangCode | null {
  if (typeof value !== "string") return null;
  const base = value.trim().toLowerCase().split(/[-_]/)[0];
  return SUPPORTED.includes(base as EmailLangCode) ? (base as EmailLangCode) : null;
}

function paramFrom(url: string): string | null {
  // Działa też dla ścieżek względnych i URL-i z zakodowanym redirect_to.
  const decoded = (() => {
    try {
      return decodeURIComponent(url);
    } catch {
      return url;
    }
  })();
  const match = /[?&#]lang=([^&#\s]+)/i.exec(decoded);
  return match ? match[1] : null;
}

function pathLangFrom(url: string): string | null {
  const decoded = (() => {
    try {
      return decodeURIComponent(url);
    } catch {
      return url;
    }
  })();
  const match = /(?:^|https?:\/\/[^/\s]+)?\/(pl|en)(?=[/?#\s]|$)/i.exec(decoded);
  return match ? match[1] : null;
}

function metadataLangFrom(meta: Record<string, unknown> | null | undefined): string | null {
  if (!meta) return null;
  const keys = ["lang", "language", "preferred_language", "locale", "ui_locale"];
  for (const key of keys) {
    const value = meta[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

function headerLangFrom(header: string | null | undefined): string | null {
  if (!header) return null;
  // "en-GB,en;q=0.9,pl;q=0.8" -> pierwsza pozycja, którą umiemy obsłużyć.
  const parts = header
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params
        .map((p) => /q=([\d.]+)/i.exec(p)?.[1])
        .find((v): v is string => Boolean(v));
      return { tag: tag.trim(), q: q ? Number.parseFloat(q) : 1 };
    })
    .filter((p) => p.tag.length > 0)
    .sort((a, b) => b.q - a.q);

  for (const part of parts) {
    if (normalizeLangCode(part.tag)) return part.tag;
  }
  return null;
}

/**
 * Ustala język maila autoryzacyjnego wraz ze źródłem decyzji.
 * Zawsze zwraca obsługiwany język - nigdy nie rzuca.
 */
export function resolveAuthEmailLang(input: AuthLangInput): AuthLangResult {
  const urls = [input.redirectTo, input.actionUrl].filter(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );

  let unknownParam = false;

  for (const url of urls) {
    const raw = paramFrom(url);
    if (!raw) continue;
    const lang = normalizeLangCode(raw);
    if (lang) {
      return { lang, source: "param", rawValue: raw, usedFallback: false, unknownParam: false };
    }
    unknownParam = true;
  }

  for (const url of urls) {
    const raw = pathLangFrom(url);
    const lang = normalizeLangCode(raw);
    if (lang) {
      return { lang, source: "path", rawValue: raw, usedFallback: false, unknownParam };
    }
  }

  const metaRaw = metadataLangFrom(input.userMetadata);
  const metaLang = normalizeLangCode(metaRaw);
  if (metaLang) {
    return {
      lang: metaLang,
      source: "metadata",
      rawValue: metaRaw,
      usedFallback: false,
      unknownParam,
    };
  }

  const headerRaw = headerLangFrom(input.acceptLanguage);
  const headerLang = normalizeLangCode(headerRaw);
  if (headerLang) {
    return {
      lang: headerLang,
      source: "header",
      rawValue: headerRaw,
      usedFallback: false,
      unknownParam,
    };
  }

  return {
    lang: DEFAULT_EMAIL_LANG,
    source: "default",
    rawValue: null,
    usedFallback: true,
    unknownParam,
  };
}
