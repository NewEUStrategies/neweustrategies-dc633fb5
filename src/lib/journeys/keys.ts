// FABRYKA KLUCZY REACT QUERY ŚCIEŻEK KOMUNIKACJI (panel /admin/revenue/journeys).
//
// LIŚĆ BEZ IMPORTÓW RUNTIME - czyta go rozszerzenie mapy inwalidacji szyny
// (`journey.changed.v1`, `journey.stats_changed.v1`), więc nie może wciągać
// React Query ani Supabase do chunku szyny (`hubKeyFactories.test.ts`).
//
// PREFIKSY `*For(id)` / `*All()` SĄ KRÓTSZE O OKNO. Zdarzenie statystyk mówi
// tylko „ścieżka X się zmieniła"; nie zna wersji, okna ani strony listy, które
// admin ma otwarte. `statsFor(id)` jest prefiksem każdego `stats(id, …)`, więc
// jedna inwalidacja trafia w każde zapamiętane okno tej ścieżki i w nic więcej.
//
// Klucze list i agregatów niosą najemcę; klucze szczegółu po uuid nie muszą
// (uuid jest globalnie unikalny, a RPC i tak czyta najemcę z sesji).
import type { JourneyStatus } from "@/lib/revenue/search";

export const journeyKeys = {
  root: () => ["admin", "journeys"] as const,
  /** Lista ścieżek najemcy z filtrem statusu (`null` = wszystkie). */
  list: (tenantId: string, status: JourneyStatus | null) =>
    ["admin", "journeys", "list", tenantId, status] as const,
  listAll: () => ["admin", "journeys", "list"] as const,
  detail: (journeyId: string) => ["admin", "journeys", "detail", journeyId] as const,
  version: (journeyId: string, versionId: string) =>
    ["admin", "journeys", "version", journeyId, versionId] as const,
  versions: (journeyId: string) => ["admin", "journeys", "versions", journeyId] as const,
  /** Statystyki wersji w oknie; `null` wersji = widok sumaryczny. */
  stats: (
    journeyId: string,
    versionId: string | null,
    sinceIso: string | null,
    untilIso: string | null,
  ) => ["admin", "journeys", "stats", journeyId, versionId, sinceIso, untilIso] as const,
  statsFor: (journeyId: string) => ["admin", "journeys", "stats", journeyId] as const,
  /** Kontakty w ścieżce, opcjonalnie w jednym węźle (lista z kanwy). */
  enrollments: (journeyId: string, nodeId: string | null, status: string | null, page: number) =>
    ["admin", "journeys", "enrollments", journeyId, nodeId, status, page] as const,
  enrollmentsFor: (journeyId: string) => ["admin", "journeys", "enrollments", journeyId] as const,
  /** Ścieżki leada (karta CRM). */
  forLead: (leadId: string) => ["admin", "journeys", "lead", leadId] as const,
  forLeadAll: () => ["admin", "journeys", "lead"] as const,
  /** Szablony są w kodzie - klucz niesie tylko stan „zainstalowany u najemcy". */
  templates: (tenantId: string) => ["admin", "journeys", "templates", tenantId] as const,
  /**
   * Szacunek zasięgu wyzwalacza. `conditionHash` to skrót warunku liczony tą
   * samą funkcją co `graph_checksum`, więc klucz zmienia się tylko przy realnej
   * zmianie warunku, a nie przy każdym renderze edytora.
   */
  triggerEstimate: (tenantId: string, eventType: string, conditionHash: string) =>
    ["admin", "journeys", "estimate", tenantId, eventType, conditionHash] as const,
  simulate: (journeyId: string, leadId: string, draftChecksum: string) =>
    ["admin", "journeys", "simulate", journeyId, leadId, draftChecksum] as const,
  settings: (tenantId: string) => ["admin", "journeys", "settings", tenantId] as const,
  engineHealth: (tenantId: string) => ["admin", "journeys", "health", tenantId] as const,
} as const;
