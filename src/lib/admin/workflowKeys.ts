// FABRYKA KLUCZY REACT QUERY AUTOMATYZACJI (/admin/workflows).
//
// KSZTAŁTY = DZISIEJSZE LITERAŁY (zero migracji cache). `runsAll()` jest
// prefiksem list przebiegów z filtrami; okno ostatnich przebiegów
// (`runsWindow`) ma OSOBNY prefiks, bo karmi kafle zakładki definicji,
// a nie listę przebiegów.
//
// LIŚĆ BEZ IMPORTÓW RUNTIME (czyta go mapa inwalidacji szyny).
export const workflowKeys = {
  definitions: () => ["admin", "workflow-definitions"] as const,
  templates: () => ["admin", "workflow-templates"] as const,
  /** Ostatnie `limit` przebiegów (statystyki definicji). */
  runsWindow: (limit: number) => ["admin", "workflow-runs-window", limit] as const,
  runsAll: () => ["admin", "workflow-runs"] as const,
  /** Lista przebiegów z filtrem przepisu i statusu (`null` = bez filtra). */
  runs: (workflowId: string | null, status: string | null) =>
    ["admin", "workflow-runs", workflowId, status] as const,
  /** Ślad korelacji (zdarzenie → przepisy → kroki). */
  trace: (correlationId: string | null) => ["admin", "correlation-trace", correlationId] as const,
} as const;
