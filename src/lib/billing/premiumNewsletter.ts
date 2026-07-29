// Czysta logika zapisu płacącego subskrybenta na newsletter premium.
// Bez zależności serwerowych, żeby dało się ją testować i współdzielić.

export type NewsletterLanguage = "pl" | "en";

export interface NewsletterConsentEntry {
  key: string;
  granted: boolean;
  granted_at: string;
  source: string;
}

export interface PremiumNewsletterRow {
  tenant_id: string;
  user_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  language: NewsletterLanguage;
  status: "subscribed";
  source: string;
  source_form_name: string;
  confirmed_at: string;
  unsubscribed_at: null;
  consents: NewsletterConsentEntry[];
  meta: Record<string, string>;
}

/** Klucz zgody marketingowej nadawanej przy opłaconej subskrypcji. */
export const PREMIUM_NEWSLETTER_CONSENT = "newsletter_premium";

export function normalizeNewsletterLanguage(value: string | null | undefined): NewsletterLanguage {
  return value?.toLowerCase().startsWith("en") ? "en" : "pl";
}

/**
 * Wiersz `newsletter_subscribers` dla nowego klienta premium.
 *
 * Zapis jest potwierdzony od razu (double opt-in nie jest potrzebny - adres
 * pochodzi z opłaconej transakcji), ale zgoda trafia do `consents`, żeby
 * dało się ją wykazać i wycofać.
 */
export function buildPremiumNewsletterRow(input: {
  tenantId: string;
  userId: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  language?: string | null;
  tierKey: string;
  subscriptionId: string;
  now?: Date;
}): PremiumNewsletterRow {
  const at = (input.now ?? new Date()).toISOString();
  return {
    tenant_id: input.tenantId,
    user_id: input.userId,
    email: input.email.trim().toLowerCase(),
    first_name: input.firstName ?? null,
    last_name: input.lastName ?? null,
    language: normalizeNewsletterLanguage(input.language),
    status: "subscribed",
    source: "subscription",
    source_form_name: "Subskrypcja premium",
    confirmed_at: at,
    unsubscribed_at: null,
    consents: [
      {
        key: PREMIUM_NEWSLETTER_CONSENT,
        granted: true,
        granted_at: at,
        source: "subscription_checkout",
      },
    ],
    meta: { tier: input.tierKey, subscription_id: input.subscriptionId },
  };
}

/**
 * Czy wolno reaktywować zapis. Ręczne wypisanie się jest nadrzędne wobec
 * automatu - nie zapisujemy ponownie kogoś, kto świadomie zrezygnował.
 */
export function canAutoSubscribe(existing: {
  status?: string | null;
  unsubscribed_at?: string | null;
} | null): boolean {
  if (!existing) return true;
  if (existing.unsubscribed_at) return false;
  return existing.status !== "unsubscribed";
}
