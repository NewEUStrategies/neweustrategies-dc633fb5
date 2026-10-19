// Wspólna warstwa LOGIKI mutacji leada CRM, współdzielona przez dwa wejścia do
// tych samych danych: quick-view drawer na liście (`admin.crm.index.tsx`) i
// pełną kartę HubSpot (`admin.crm.$id.tsx`). Oba renderują WŁASNY JSX (różny
// wygląd - świadoma decyzja "bez zmian UX"), ale dzieliły dotąd verbatim
// zduplikowane definicje mutacji: dodanie/usunięcie notatki (z kluczem
// idempotencji + inwalidacją) oraz push do Merydiana. Ta duplikacja żyje tu raz.
//
// Side-effekty specyficzne dla powierzchni (toast po dodaniu notatki, reset
// pola) są sterowane callbackami, więc każda strona zachowuje SWOJE dokładne
// zachowanie - hook nie narzuca UX, tylko domyka kontrakt danych. Obie
// powierzchnie używają tego samego klucza react-query (`crmKeys.lead(id)`
// z fabryki I0), więc cache i inwalidacja są spójne bez dodatkowej
// koordynacji.
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  addCrmNote,
  deleteCrmNote,
  listStaffUsers,
  pushLeadToPartners,
  setLeadLifecycleStage,
  type LeadLifecycleChange,
  type PushLeadResult,
} from "@/lib/crm.functions";
import { crmKeys } from "@/lib/crm/keys";
import { newIdempotencyKey } from "@/lib/http/idempotency";

/** Mutacje notatek leada (dodaj z idempotencją / usuń) + inwalidacja cache. */
export function useLeadNoteMutations(
  leadId: string,
  opts?: {
    /** Wołane po udanym dodaniu notatki - miejsce na toast/reset per powierzchnia. */
    onAdded?: () => void;
    /** Wołane po udanym usunięciu notatki. */
    onDeleted?: () => void;
  },
) {
  const qc = useQueryClient();

  const addNote = useMutation({
    // Klucz idempotencji per akcja: retry HTTP / replay nie zdubluje notatki
    // (command_idempotency w DB zwróci zapamiętany wynik zamiast insertu).
    mutationFn: async (body: string) =>
      addCrmNote({
        data: { lead_id: leadId, body, idempotency_key: newIdempotencyKey("crm.add_note") },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: crmKeys.lead(leadId) });
      opts?.onAdded?.();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteNote = useMutation({
    mutationFn: async (noteId: string) => deleteCrmNote({ data: { id: noteId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: crmKeys.lead(leadId) });
      opts?.onDeleted?.();
    },
  });

  return { addNote, deleteNote };
}

/**
 * Ręczny push leada do partnerów CRM (crm_webhook_endpoints). Wysyłka idzie
 * przez outbox integration_deliveries: enqueue + natychmiastowy tick
 * dispatchera; nieudane dostawy zostają w kolejce i wracają retry-em.
 * Komunikaty identyczne na obu powierzchniach (drawer i pełna karta).
 */
export function usePartnerPush(leadId: string, lang: "pl" | "en" = "pl") {
  return useMutation({
    mutationFn: async () => pushLeadToPartners({ data: { lead_id: leadId } }),
    onSuccess: (r: PushLeadResult) => {
      if (!r.ok) {
        toast.error(
          lang === "pl"
            ? "Brak aktywnych partnerów CRM - dodaj endpoint w zakładce Integracje"
            : "No active CRM partners - add an endpoint in the Integrations tab",
        );
        return;
      }
      if (r.delivered > 0) {
        toast.success(
          lang === "pl"
            ? `Wysłano do partnerów CRM (${r.delivered}/${r.enqueued})`
            : `Sent to CRM partners (${r.delivered}/${r.enqueued})`,
        );
      } else {
        toast.info(
          lang === "pl"
            ? `W kolejce do wysyłki (${r.enqueued}) - retry automatyczny`
            : `Queued for delivery (${r.enqueued}) - automatic retry`,
        );
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/**
 * Ręczna zmiana etapu cyklu życia (RPC `admin_crm_set_lifecycle_stage`).
 *
 * Wynik „pominięto" (pierwszeństwo billingu, ten sam etap) NIE jest błędem
 * sieci - wraca w `onSettledChange`, żeby powierzchnia powiedziała
 * człowiekowi, DLACZEGO etap się nie zmienił. Inwalidacja obejmuje kartę
 * leada, jego historię etapów i listy (filtr cyklu życia).
 */
export function useLeadLifecycleMutation(
  leadId: string,
  opts?: {
    onChanged?: (result: LeadLifecycleChange) => void;
    onSkipped?: (result: LeadLifecycleChange) => void;
    onError?: (error: Error) => void;
  },
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (stage: string) => setLeadLifecycleStage({ data: { id: leadId, stage } }),
    onSuccess: (result) => {
      if (result.changed) opts?.onChanged?.(result);
      else opts?.onSkipped?.(result);
      void qc.invalidateQueries({ queryKey: crmKeys.lead(leadId) });
      void qc.invalidateQueries({ queryKey: crmKeys.leadStageHistory(leadId) });
      void qc.invalidateQueries({ queryKey: crmKeys.leadsAll() });
    },
    onError: (e: Error) => (opts?.onError ? opts.onError(e) : toast.error(e.message)),
  });
}

// ---------------------------------------------------------------------------
// Zespół CRM (picker właściciela, podpis autora w historii etapów, osoba
// w akcjach automatyzacji) - JEDNO zapytanie dla wszystkich powierzchni.
// ---------------------------------------------------------------------------

export interface CrmStaffUser {
  id: string;
  label: string;
}

/**
 * Klucz listy zespołu CRM. Fabryka `crmKeys` (I0) nie ma jeszcze wpisu dla
 * tej listy - do czasu dopisania `crmKeys.staffUsers()` (integration request
 * S4) klucz żyje tu jako funkcja, nie literał w komponencie, więc zamiana
 * będzie jedną linią.
 */
export const crmStaffUsersKey = () => ["crm-staff-users"] as const;

function staffLabel(row: Record<string, unknown>): string {
  const display = typeof row.display_name === "string" ? row.display_name.trim() : "";
  if (display) return display;
  const first = typeof row.first_name === "string" ? row.first_name.trim() : "";
  const last = typeof row.last_name === "string" ? row.last_name.trim() : "";
  const full = `${first} ${last}`.trim();
  return full || String(row.id ?? "");
}

/** Wynik `listStaffUsers` (JSON w `json`) -> posortowana lista do pickera. */
export function parseStaffUsers(raw: { json: string } | null | undefined): CrmStaffUser[] {
  if (!raw || typeof raw.json !== "string") return [];
  let rows: unknown;
  try {
    rows = JSON.parse(raw.json);
  } catch {
    return [];
  }
  if (!Array.isArray(rows)) return [];
  return rows
    .filter(
      (row): row is Record<string, unknown> =>
        Boolean(row) && typeof row === "object" && typeof (row as { id?: unknown }).id === "string",
    )
    .map((row) => ({ id: String(row.id), label: staffLabel(row) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function crmStaffUsersQueryOptions() {
  return queryOptions({
    queryKey: crmStaffUsersKey(),
    queryFn: async () => parseStaffUsers(await listStaffUsers()),
    // Skład zespołu zmienia się rzadko; karta i edytor otwierane kilka razy
    // pod rząd nie muszą pytać serwera za każdym razem.
    staleTime: 5 * 60_000,
  });
}
