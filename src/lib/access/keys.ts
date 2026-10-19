// FABRYKI KLUCZY REACT QUERY DOSTĘPU: reguły treści, metering, kasa.
//
// KSZTAŁTY = DZISIEJSZE LITERAŁY (zero migracji cache). `ruleAll()` jest
// prefiksem każdej reguły - zdarzenie `content_access.changed.v1` bez pól
// encji odświeża wszystkie, z polami trafia w jedną.
//
// LIŚĆ BEZ IMPORTÓW RUNTIME (czyta go mapa inwalidacji szyny, a `metering.ts`
// ciągnie React Query, klienta Supabase i server fns gościa).
export const accessKeys = {
  /** Wszystkie reguły dostępu - prefiks inwalidacji. */
  ruleAll: () => ["content_access"] as const,
  /** Reguła jednej encji (`post`, `page`, `media`…). */
  rule: (entityType: string, entityId: string) => ["content_access", entityType, entityId] as const,
  /** Wyjątki meteringu (wpisy per użytkownik w /admin/paywall). */
  overrides: () => ["metering-overrides"] as const,
} as const;

export const meteringKeys = {
  settings: () => ["metering-settings"] as const,
  impactPreviewAll: () => ["metering-impact-preview"] as const,
  /** Podgląd skutku zmiany limitu członków (RPC `metering_impact_preview`). */
  impactPreview: (proposedMemberLimit: number) =>
    ["metering-impact-preview", proposedMemberLimit] as const,
} as const;

export const checkoutKeys = {
  settings: () => ["checkout-settings"] as const,
} as const;
