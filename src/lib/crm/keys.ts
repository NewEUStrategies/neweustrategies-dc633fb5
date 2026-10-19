// FABRYKA KLUCZY REACT QUERY CRM (leady, zadania, lejek, firmy).
//
// KSZTAŁTY = DZISIEJSZE LITERAŁY. Klucze żyły jako literały w kilkunastu
// plikach i w mapie inwalidacji szyny; fabryka zwraca DOKŁADNIE te same
// tablice, więc przejście z literału na wywołanie nie zmienia ani jednego
// wpisu cache i każda reguła dalej trafia (`hubKeyFactories.test.ts` trzyma
// tabelę par „wywołanie → literał z repo").
//
// LIŚĆ BEZ IMPORTÓW RUNTIME: mapa szyny importuje tę fabrykę, więc moduł nie
// może ciągnąć React Query, Supabase ani zod (stąd parametry generyczne
// zamiast typów z `leadListSpec.ts`).
export const crmKeys = {
  /** Wszystkie listy leadów - prefiks inwalidacji. */
  leadsAll: () => ["crm-leads"] as const,
  /** Lista leadów z parametrami ekranu (`/admin/crm`). */
  leads: <P>(params: P) => ["crm-leads", params] as const,
  lead: (leadId: string) => ["crm-lead", leadId] as const,
  leadTimeline: (leadId: string) => ["crm-lead-timeline", leadId] as const,
  leadMetering: (leadId: string) => ["crm-lead-metering", leadId] as const,
  leadMeteringAll: () => ["crm-lead-metering"] as const,
  /** Historia etapów i cyklu życia leada (`crm_lead_stage_history`). */
  leadStageHistory: (leadId: string) => ["crm-lead-stage-history", leadId] as const,
  tasksAll: () => ["crm-tasks"] as const,
  /** Zadania do wykonania (panel „Do zrobienia"). */
  tasksDue: () => ["crm-tasks", "due"] as const,
  tasksForLead: (leadId: string) => ["crm-tasks", "lead", leadId] as const,
  scoringSettings: () => ["crm-scoring-settings"] as const,
  funnelAll: () => ["crm-funnel"] as const,
  funnel: <P>(params: P) => ["crm-funnel", params] as const,
  funnelStats: () => ["crm-funnel-stats"] as const,
  /** Kartoteka firm (lista i szczegół - prefiks). */
  companies: () => ["admin", "crm-companies"] as const,
  companiesList: (search: string) => ["admin", "crm-companies", search] as const,
  partnerEndpoints: () => ["admin", "crm-partner-endpoints"] as const,
} as const;
