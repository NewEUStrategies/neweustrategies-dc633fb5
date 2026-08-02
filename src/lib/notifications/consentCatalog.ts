// Katalog zgód powiadomień/RODO dla zalogowanych użytkowników.
//
// Każda zgoda ma:
// - stabilny klucz (persistowany w `user_consents.consent_key`),
// - bieżącą wersję treści (zmiana wersji = zgoda ponownie do potwierdzenia),
// - kategorię (grupowanie w UI),
// - opcjonalny znacznik `required` (zgód wymaganych do działania serwisu
//   NIE da się wycofać z panelu - są tylko poglądowe, np. transakcyjne).
//
// Treści PL/EN są renderowane przez i18n (klucz `notifications.consents.items.<key>.*`).
// Wersja jest bumpowana ręcznie, kiedy zmienia się treść prawna zgody.

export type ConsentCategory = "communications" | "product" | "analytics" | "legal" | "cookies";

export interface ConsentDefinition {
  /** Klucz zapisu w bazie - stabilny, snake_case. */
  key: string;
  /** Kategoria dla grupowania w UI. */
  category: ConsentCategory;
  /** Bieżąca wersja treści zgody. Bump → wymagana ponowna decyzja. */
  version: string;
  /** Zgoda wymagana (np. transakcyjne wiadomości serwisowe) - nie można wycofać. */
  required?: boolean;
  /** Domyślna wartość, gdy użytkownik jeszcze nie podjął decyzji. */
  defaultGiven?: boolean;
}

// Kolejność ma znaczenie - taki porządek zobaczy użytkownik w UI.
export const CONSENT_CATALOG: readonly ConsentDefinition[] = [
  {
    key: "transactional",
    category: "legal",
    version: "1.0",
    required: true,
    defaultGiven: true,
  },
  { key: "marketing_email", category: "communications", version: "1.0" },
  { key: "newsletter_digest", category: "communications", version: "1.0" },
  { key: "push_marketing", category: "communications", version: "1.0" },
  { key: "product_updates", category: "product", version: "1.0" },
  { key: "personalization", category: "product", version: "1.0" },
  { key: "analytics", category: "analytics", version: "1.0" },
  // Kategorie cookie CMP (baner zgód). Wersja "2.0" odpowiada CONSENT_VERSION=2
  // z `src/lib/ads/consent.ts` - bump tam wymaga bumpa tutaj (pilnuje tego test
  // `registryBridge.test.ts`). Stan runtime tych zgód ŻYJE w CMP (localStorage/
  // cookie/profiles.prefs.consent); rejestr `user_consents` jest dla nich
  // audytowanym śladem RODO (IP/UA/wersja/źródło), zapisywanym przez
  // registryBridge przy każdej decyzji zalogowanego użytkownika.
  { key: "cookies_functional", category: "cookies", version: "2.0" },
  { key: "cookies_analytics", category: "cookies", version: "2.0" },
  { key: "cookies_marketing", category: "cookies", version: "2.0" },
] as const;

export const CONSENT_KEYS = CONSENT_CATALOG.map((c) => c.key);

export function getConsentDefinition(key: string): ConsentDefinition | undefined {
  return CONSENT_CATALOG.find((c) => c.key === key);
}
