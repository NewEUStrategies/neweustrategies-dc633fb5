// FABRYKA KLUCZY REACT QUERY KARTY „RETENCJA DANYCH" (/admin/settings/privacy).
//
// LIŚĆ BEZ IMPORTÓW RUNTIME - czyta go rozszerzenie mapy inwalidacji szyny
// (`data_retention.changed.v1`), więc nie może wciągać React Query ani
// Supabase do chunku szyny.
//
// WSZYSTKO POD PREFIKSEM NAJEMCY: zdarzenie zmiany (zapis kategorii, karencja,
// przedłużenie, ręczny przebieg) unieważnia `tenant(id)` - ustawienia,
// podgląd i lista „do anonimizacji" tego najemcy odświeżają się razem, bo
// każda z nich zależy od okresów i trybu.
export const dataRetentionKeys = {
  root: () => ["admin", "data-retention"] as const,
  tenant: (tenantId: string) => ["admin", "data-retention", tenantId] as const,
  settings: (tenantId: string) => ["admin", "data-retention", tenantId, "settings"] as const,
  preview: (tenantId: string) => ["admin", "data-retention", tenantId, "preview"] as const,
  crmDue: (tenantId: string) => ["admin", "data-retention", tenantId, "crm-due"] as const,
} as const;
