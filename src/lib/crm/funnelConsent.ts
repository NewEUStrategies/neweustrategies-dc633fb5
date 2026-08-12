// Przenoszenie zgody marketingowej z lejka (newsletter_subscribers) do
// Kontaktów CRM (crm_leads.marketing_consent).
//
// Zgoda jest DOWODEM prawnym (RODO/art. 7 ust. 1), więc konwersja może ją
// wyłącznie PRZEPISAĆ ze stanu subskrybenta - nigdy wytworzyć. Warunek jest
// ten sam, którego pilnuje trigger `newsletter_to_lead` (migracja
// 20260708140000: zgoda dopiero przy `status = 'subscribed'`), zaostrzony o
// dowód potwierdzenia zapisu: KAŻDA prawdziwa ścieżka zapisu stempluje
// `confirmed_at` (double opt-in, zapis bez DOI, dodanie przez staff), więc
// `subscribed` bez `confirmed_at` i bez wpisu w `consents[]` to ręczne
// przestawienie statusu, a nie zgoda subskrybenta.
export const MARKETING_CONSENT_KEYS: readonly string[] = ["newsletter", "marketing"];

export type FunnelConsentSource = {
  status: string | null;
  confirmed_at: string | null;
  consents: unknown;
};

// `consents` to jsonb: tablica {key,text,version,given,lang} zapisywana przez
// formularze. `null` = formularz nie przekazał nic o zgodzie marketingowej,
// `false` = zgoda wprost odmówiona/wycofana i wygrywa nad resztą przesłanek.
function explicitMarketingConsent(consents: unknown): boolean | null {
  if (!Array.isArray(consents)) return null;
  let seen: boolean | null = null;
  for (const raw of consents) {
    if (typeof raw !== "object" || raw === null) continue;
    const item = raw as { key?: unknown; given?: unknown };
    if (typeof item.key !== "string") continue;
    if (!MARKETING_CONSENT_KEYS.includes(item.key.trim().toLowerCase())) continue;
    if (item.given === false || item.given === "false") return false;
    seen = true;
  }
  return seen;
}

export function funnelMarketingConsent(sub: FunnelConsentSource): boolean {
  if (sub.status !== "subscribed") return false;
  const explicit = explicitMarketingConsent(sub.consents);
  if (explicit === false) return false;
  return explicit === true || sub.confirmed_at !== null;
}
