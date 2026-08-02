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
// powierzchnie używają tego samego klucza react-query `["crm-lead", leadId]`,
// więc cache i inwalidacja są spójne bez dodatkowej koordynacji.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  addCrmNote,
  deleteCrmNote,
  pushLeadToPartners,
  type PushLeadResult,
} from "@/lib/crm.functions";
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
      qc.invalidateQueries({ queryKey: ["crm-lead", leadId] });
      opts?.onAdded?.();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteNote = useMutation({
    mutationFn: async (noteId: string) => deleteCrmNote({ data: { id: noteId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["crm-lead", leadId] });
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
