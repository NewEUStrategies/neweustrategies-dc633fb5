// Tłumaczenie błędów serwerowych „Zapytania do eksperta" na klucze i18n.
//
// PO CO JEDNO MIEJSCE: bramki mieszkają w SQL-u (SECURITY DEFINER), więc jedyne,
// co dostaje klient, to komunikat wyjątku. Dopasowanie po podłańcuchu było
// wcześniej wpisane w ciało ExpertRequestDialog i pokrywało cztery z dziesięciu
// bramek - pozostałe (opt-out odbiorcy, wyłączony moduł tenanta, złe przejście
// statusu) lądowały w „Nie udało się wysłać. Spróbuj ponownie.", czyli
// użytkownik nie wiedział, co zmienić. Skrzynki i panel admina miały własne,
// jeszcze węższe mapowanie. Tabela jest DANYMI, więc dokłada się do niej wpis,
// a nie gałąź `else if` w trzech komponentach.
//
// Dopasowanie idzie po podłańcuchu, bo prefiks komunikatu zależy od generacji
// nazw RPC (`expert_request:` w funkcjach domenowych, `inmail:` w historycznych
// definicjach) - sam rdzeń komunikatu jest stabilny.

/** Rozpoznane klasy odmowy; `generic` to jawny fallback. */
export type ExpertRequestErrorKey =
  | "monthlyQuota"
  | "rateLimit"
  | "notExpert"
  | "tierDisabled"
  | "recipientDisabled"
  | "featureDisabled"
  | "notAvailable"
  | "invalidTransition"
  | "notFound"
  | "forbidden"
  | "generic";

/**
 * Kolejność MA ZNACZENIE: wpisy szczegółowe idą przed ogólnymi, żeby
 * „recipient not accepting requests" nie wpadło w „forbidden".
 */
const ERROR_MATCHERS: readonly (readonly [string, ExpertRequestErrorKey])[] = [
  ["monthly quota exceeded", "monthlyQuota"],
  ["rate limit", "rateLimit"],
  ["recipient not accepting requests", "recipientDisabled"],
  ["feature disabled", "featureDisabled"],
  ["recipient is not gated", "notExpert"],
  ["not an expert", "notExpert"],
  ["recipient not available", "notAvailable"],
  ["invalid recipient", "notAvailable"],
  ["tier disabled", "tierDisabled"],
  ["invalid status transition", "invalidTransition"],
  ["not found", "notFound"],
  ["forbidden", "forbidden"],
];

/** Surowy komunikat z dowolnego kształtu błędu (Error, PostgrestError, string). */
export function expertRequestErrorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (error !== null && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "";
}

/** Klasa odmowy rozpoznana z komunikatu serwera. */
export function expertRequestErrorKey(error: unknown): ExpertRequestErrorKey {
  const message = expertRequestErrorMessage(error).toLowerCase();
  for (const [needle, key] of ERROR_MATCHERS) {
    if (message.includes(needle)) return key;
  }
  return "generic";
}

/** Gotowy klucz i18n do `t(...)` - jedno wywołanie w komponencie. */
export function expertRequestErrorI18nKey(error: unknown): string {
  return `expertRequest.error.${expertRequestErrorKey(error)}`;
}
