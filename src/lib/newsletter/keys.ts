// FABRYKA KLUCZY REACT QUERY NEWSLETTERA (subskrybenci, ustawienia, kampanie,
// pomiar popupu).
//
// KSZTAŁTY = DZISIEJSZE LITERAŁY (zero migracji cache). Prefiks rodzica
// obejmuje warianty: `settings()` trafia też w `settingsInline()`, a
// `campaignsAll()` w szczegół, zasięg i zaangażowanie każdej kampanii - reguła
// szyny `newsletter_settings.changed.v1` nie musi znać projekcji formularzy.
//
// LIŚĆ BEZ IMPORTÓW RUNTIME (czyta go mapa inwalidacji szyny).
export const newsletterKeys = {
  subscribersAll: () => ["newsletter-subscribers"] as const,
  /** Kafle KPI listy subskrybentów. */
  kpis: () => ["newsletter-kpis"] as const,
  /** Pełne ustawienia newslettera (panel) - prefiks projekcji inline. */
  settings: () => ["newsletter-settings"] as const,
  /** Projekcja ustawień dla formularzy inline (`NewsletterForm`, `JoinUsForm`). */
  settingsInline: () => ["newsletter-settings", "inline"] as const,
  campaignsAll: () => ["admin", "newsletter-campaigns"] as const,
  campaign: (campaignId: string) => ["admin", "newsletter-campaigns", campaignId] as const,
  campaignEngagement: (campaignId: string) =>
    ["admin", "newsletter-campaigns", campaignId, "engagement"] as const,
  /** Szacunek odbiorców dla filtra z formularza (filtr w kluczu - zmiana = nowy odczyt). */
  campaignAudience: <F>(campaignId: string, filter: F) =>
    ["admin", "newsletter-campaigns", campaignId, "audience", filter] as const,
  /**
   * Pomiar otwarć i kliknięć tylko za zgodą (I9d-Y2). Pod prefiksem
   * `settings()`: oznaczenie „mój tekst obejmuje pomiar" emituje
   * `newsletter_settings.changed.v1`, którego reguła szyny unieważnia
   * `settings()` - stan treści zgody, podgląd prośby i treść maila odświeżają
   * się w drugiej karcie bez nowej reguły.
   */
  measurementAll: () => ["newsletter-settings", "measurement"] as const,
  /** Stan pól treści zgody (ostrzeżenie edytora, oznaczenia admina). */
  consentMeasurement: () => ["newsletter-settings", "measurement", "consent"] as const,
  /** Podgląd „Poproś o zgodę na pomiar" (kandydaci, stan próśb). */
  measurementPreview: () => ["newsletter-settings", "measurement", "preview"] as const,
  /** Treść maila prośby (nadpisania z panelu). */
  measurementCopy: () => ["newsletter-settings", "measurement", "copy"] as const,
  /** Mianownik wskaźników kampanii (odbiorcy mierzeni) - pod prefiksem kampanii. */
  campaignMeasurement: (campaignId: string) =>
    ["admin", "newsletter-campaigns", campaignId, "measurement"] as const,
  popupEventsAll: () => ["admin", "newsletter-popup-events"] as const,
  /** Pomiar popupu z ostatnich `days` dni. */
  popupEvents: (days: number) => ["admin", "newsletter-popup-events", days] as const,
} as const;
