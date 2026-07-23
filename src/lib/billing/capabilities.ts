// Rejestr capabilities warstw członkostwa - JEDNO źródło prawdy o tym, które
// flagi `membership_tiers.features` są FAKTYCZNIE egzekwowane przez bramki
// (SQL SECURITY DEFINER / server fns), a które są dziś tylko deklaracją
// marketingową na karcie. Panel admina renderuje z tego badge
// "Egzekwowana / Dekoracyjna", żeby redakcja widziała rozjazd między obietnicą
// a bramką i nie sprzedawała czegoś, czego system nie pilnuje.
//
// Utrzymanie: dodając nową bramkę na flagę, zmień `enforced` na true i opisz
// punkt egzekwowania. To celowo mapa RĘCZNA (nie autogenerowana) - stanowi
// kontrakt weryfikowany code-review, a nie zgadywankę po grepie.

/** Gdzie flaga jest egzekwowana (do grupowania i ikon w panelu). */
export type CapabilityGate = "content" | "events" | "qa" | "tracker" | "chat" | "none";

export interface CapabilityMeta {
  /** Klucz we `features` (membership_tiers.features). */
  key: string;
  /** Czy istnieje realna bramka czytająca tę flagę. */
  enforced: boolean;
  /** Obszar egzekwowania. */
  gate: CapabilityGate;
  /** Krótki opis punktu egzekwowania (PL) - tło dla admina. */
  where_pl: string;
  where_en: string;
}

/**
 * Kanoniczna lista. Kolejność = kolejność prezentacji w panelu.
 * `enforced: true` tylko dla flag z realną bramką (zweryfikowane w kodzie):
 *  - premium_content  -> has_content_access (paywall treści, gift-links),
 *  - regulatory_monitoring -> RLS eu_policy_follows (obserwacja/alerty trackera),
 *  - pro_briefings    -> rsvp_event / get_event_access (wstęp na briefingi),
 *  - recordings       -> get_event_access (URL nagrania),
 *  - qa_priority      -> list_qa_questions (priorytet i kolejność).
 * Reszta bytuje wyłącznie w seedach/edytorze -> dekoracja (do świadomej decyzji:
 * dopiąć bramkę albo trzymać jako czysty marketing).
 */
export const TIER_CAPABILITIES: readonly CapabilityMeta[] = [
  {
    key: "premium_content",
    enforced: true,
    gate: "content",
    where_pl: "Paywall treści (has_content_access) i linki podarunkowe.",
    where_en: "Content paywall (has_content_access) and gift links.",
  },
  {
    key: "regulatory_monitoring",
    enforced: true,
    gate: "tracker",
    where_pl: "Obserwowanie pozycji i alerty trackera (RLS eu_policy_follows).",
    where_en: "Following tracker items and alerts (RLS eu_policy_follows).",
  },
  {
    key: "pro_briefings",
    enforced: true,
    gate: "events",
    where_pl: "Wstęp na briefingi członkowskie (rsvp_event, get_event_access).",
    where_en: "Entry to member briefings (rsvp_event, get_event_access).",
  },
  {
    key: "recordings",
    enforced: true,
    gate: "events",
    where_pl: "Dostęp do URL nagrań wydarzeń (get_event_access).",
    where_en: "Access to event recording URLs (get_event_access).",
  },
  {
    key: "qa_priority",
    enforced: true,
    gate: "qa",
    where_pl: "Priorytet i kolejność pytań w /qa (list_qa_questions).",
    where_en: "Priority and ordering of questions in /qa (list_qa_questions).",
  },
  {
    key: "chat_enabled",
    enforced: true,
    gate: "chat",
    where_pl:
      "Bramka rozpoczęcia rozmowy DM (get_or_create_direct_conversation) - Plus i wyżej.",
    where_en:
      "Gate for starting a DM (get_or_create_direct_conversation) - Plus and above.",
  },
  {
    key: "chat_experts_direct",
    enforced: true,
    gate: "chat",
    where_pl:
      "Bezpośrednia rozmowa z ekspertem (Pro i wyżej). Bez flagi Plus wysyła inMail.",
    where_en:
      "Direct DM with an expert (Pro and above). Without the flag, Plus sends an inMail.",
  },
  {
    key: "events_members",
    enforced: false,
    gate: "none",
    where_pl: "Wydarzenia members bramkuje RANGA (min_tier_rank), nie ta flaga.",
    where_en: "Member events are gated by RANK (min_tier_rank), not this flag.",
  },
  {
    key: "member_library",
    enforced: false,
    gate: "none",
    where_pl: "Bibliotekę bramkuje RANGA zasobu (min_tier_rank), nie ta flaga.",
    where_en: "The library is gated by resource RANK (min_tier_rank), not this flag.",
  },
  {
    key: "early_access",
    enforced: false,
    gate: "none",
    where_pl: "Brak bramki. Wczesny RSVP działa osobno na randze (early_rsvp_rank).",
    where_en: "No gate. Early RSVP works separately on rank (early_rsvp_rank).",
  },
  {
    key: "working_groups",
    enforced: false,
    gate: "none",
    where_pl: "Brak bramki - obecnie czysty benefit marketingowy.",
    where_en: "No gate - currently a pure marketing benefit.",
  },
  {
    key: "corporate_seats",
    enforced: false,
    gate: "none",
    where_pl: "Miejsca w organizacji działają przez member_organizations, nie tę flagę.",
    where_en: "Org seats work via member_organizations, not this flag.",
  },
  {
    key: "vip_concierge",
    enforced: false,
    gate: "none",
    where_pl: "Brak bramki - obsługa poza aplikacją (konsjerż VIP).",
    where_en: "No gate - handled off-app (VIP concierge).",
  },
  {
    key: "teaching_licence",
    enforced: false,
    gate: "none",
    where_pl: "Brak bramki - licencja dydaktyczna egzekwowana umownie.",
    where_en: "No gate - teaching licence enforced contractually.",
  },
  {
    key: "strategic_partner",
    enforced: false,
    gate: "none",
    where_pl: "Brak bramki - benefit relacyjny (partnerstwo).",
    where_en: "No gate - relationship benefit (partnership).",
  },
  {
    key: "general_partner",
    enforced: false,
    gate: "none",
    where_pl: "Brak bramki - benefit relacyjny (partner generalny).",
    where_en: "No gate - relationship benefit (general partner).",
  },
  {
    key: "presidents_circle",
    enforced: false,
    gate: "none",
    where_pl: "Brak bramki - poziom na zaproszenie, obsługa poza aplikacją.",
    where_en: "No gate - invitation-only level, handled off-app.",
  },
  {
    key: "supporter_updates",
    enforced: false,
    gate: "none",
    where_pl: "Brak bramki - aktualizacje wysyłane kanałem newslettera.",
    where_en: "No gate - updates sent via the newsletter channel.",
  },
] as const;

const CAPABILITY_BY_KEY: ReadonlyMap<string, CapabilityMeta> = new Map(
  TIER_CAPABILITIES.map((c) => [c.key, c]),
);

/** Metadane capability po kluczu (undefined dla nieznanej/eksperymentalnej flagi). */
export function capabilityMeta(key: string): CapabilityMeta | undefined {
  return CAPABILITY_BY_KEY.get(key);
}

/** Czy flaga jest realnie egzekwowana. Nieznana flaga = nieegzekwowana. */
export function isEnforcedCapability(key: string): boolean {
  return CAPABILITY_BY_KEY.get(key)?.enforced ?? false;
}

/** Zbiór flag włączonych na warstwie (features jsonb -> klucze === true). */
export function enabledFeatureKeys(features: unknown): string[] {
  if (!features || typeof features !== "object" || Array.isArray(features)) return [];
  return Object.entries(features as Record<string, unknown>)
    .filter(([, v]) => v === true)
    .map(([k]) => k);
}

/** Podział flag warstwy na egzekwowane vs dekoracyjne (do badge'y w panelu). */
export function splitTierFeatures(features: unknown): {
  enforced: string[];
  decorative: string[];
} {
  const enforced: string[] = [];
  const decorative: string[] = [];
  for (const key of enabledFeatureKeys(features)) {
    if (isEnforcedCapability(key)) enforced.push(key);
    else decorative.push(key);
  }
  return { enforced, decorative };
}
