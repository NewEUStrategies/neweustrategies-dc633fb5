// Kanoniczny kształt preferencji subskrybenta (tematy + listy wysyłkowe).
//
// PO CO. Każdy formularz zapisywał je inaczej: popup wysyłał `meta.mailing_list`
// (l. poj.), widget builderowy `meta.mailing_lists`, a klasyczny formularz
// wpychał tematy wyłącznie do CRM (`custom.interests`). Skutek: panel profilu
// (`meta.interests` / `meta.mailing_lists`) nie widział niczego, a CRM widział
// tylko część. Ten moduł jest jednym miejscem, które normalizuje wszystkie
// warianty do dwóch pól: `interests` i `mailing_lists`.
//
// Funkcje są czyste (bez I/O), żeby ta sama logika działała po stronie serwera
// i w testach.

export const NEWSLETTER_INTERESTS_KEY = "interests";
export const NEWSLETTER_LISTS_KEY = "mailing_lists";

const MAX_INTERESTS_LEN = 1000;
const MAX_LISTS_LEN = 500;

/** Rozbija zapis "a, b, c" na listę etykiet (bez pustych i duplikatów). */
export function splitList(value: unknown): string[] {
  if (typeof value !== "string") return [];
  const out: string[] = [];
  for (const part of value.split(",")) {
    const trimmed = part.trim();
    if (trimmed.length > 0 && !out.includes(trimmed)) out.push(trimmed);
  }
  return out;
}

/** Scala listy etykiet zachowując kolejność pierwszego wystąpienia. */
export function mergeLists(...lists: readonly (readonly string[])[]): string[] {
  const out: string[] = [];
  for (const list of lists) {
    for (const raw of list) {
      const value = raw.trim();
      if (value.length > 0 && !out.includes(value)) out.push(value);
    }
  }
  return out;
}

export interface SubscriberPreferences {
  topics: string[];
  mailingLists: string[];
}

/** Czyta preferencje z dowolnego (także starego) kształtu `meta`. */
export function readPreferences(
  meta: Record<string, unknown> | null | undefined,
): SubscriberPreferences {
  const source = meta ?? {};
  return {
    topics: mergeLists(
      splitList(source[NEWSLETTER_INTERESTS_KEY]),
      splitList(source["interests_areas"]),
      splitList(source["interests_topics"]),
    ),
    mailingLists: mergeLists(
      splitList(source[NEWSLETTER_LISTS_KEY]),
      // popup zapisywał pojedynczy wybór pod kluczem w liczbie pojedynczej
      splitList(source["mailing_list"]),
    ),
  };
}

/**
 * Buduje `meta` do zapisu: zachowuje pozostałe pola (firma, telefon...),
 * dokłada nowe tematy/listy do już istniejących i usuwa warianty historyczne,
 * żeby nie było dwóch źródeł prawdy.
 */
export function applyPreferences(
  existingMeta: Record<string, unknown> | null | undefined,
  incomingMeta: Record<string, string> | null | undefined,
  incoming: Partial<SubscriberPreferences>,
): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const [key, value] of Object.entries(existingMeta ?? {})) {
    if (typeof value === "string") merged[key] = value;
  }
  for (const [key, value] of Object.entries(incomingMeta ?? {})) {
    if (typeof value === "string" && value.trim().length > 0) merged[key] = value.trim();
  }

  const previous = readPreferences(merged);
  const fromIncomingMeta = readPreferences(incomingMeta ?? {});

  const topics = mergeLists(previous.topics, fromIncomingMeta.topics, incoming.topics ?? []);
  const lists = mergeLists(
    previous.mailingLists,
    fromIncomingMeta.mailingLists,
    incoming.mailingLists ?? [],
  );

  delete merged["mailing_list"];
  delete merged["interests_areas"];
  delete merged["interests_topics"];

  if (topics.length > 0)
    merged[NEWSLETTER_INTERESTS_KEY] = topics.join(", ").slice(0, MAX_INTERESTS_LEN);
  else delete merged[NEWSLETTER_INTERESTS_KEY];

  if (lists.length > 0) merged[NEWSLETTER_LISTS_KEY] = lists.join(",").slice(0, MAX_LISTS_LEN);
  else delete merged[NEWSLETTER_LISTS_KEY];

  return merged;
}

/** Pola przekazywane do CRM (aliases.custom.*), żeby handlowiec je widział. */
export function crmCustomFromPreferences(prefs: SubscriberPreferences): Record<string, string> {
  const custom: Record<string, string> = {};
  if (prefs.topics.length > 0)
    custom[NEWSLETTER_INTERESTS_KEY] = prefs.topics.join(", ").slice(0, 500);
  if (prefs.mailingLists.length > 0)
    custom[NEWSLETTER_LISTS_KEY] = prefs.mailingLists.join(", ").slice(0, 500);
  return custom;
}

/** Etykiety tagów CRM: `temat:…` / `lista:…` - stabilne i łatwe do filtrowania. */
export function crmTagsFromPreferences(prefs: SubscriberPreferences): string[] {
  return mergeLists(
    prefs.topics.map((t) => `temat:${t}`),
    prefs.mailingLists.map((l) => `lista:${l}`),
  ).slice(0, 50);
}
