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

import { addCrmNote, deleteCrmNote, pushLeadToMerydian } from "@/lib/crm.functions";
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
 * Push leada do Merydiana. Logika i komunikaty identyczne na obu powierzchniach
 * (toast `Merydian: <via>` przy sukcesie, `Merydian: <error>` przy odmowie),
 * więc dzielony w całości - żadna strona nie różni się zachowaniem.
 */
export function useMerydianPush(leadId: string) {
  return useMutation({
    mutationFn: async () => pushLeadToMerydian({ data: { lead_id: leadId } }),
    onSuccess: (r: unknown) => {
      const x = r as { ok: boolean; error?: string; via?: string };
      if (x.ok) toast.success(`Merydian: ${x.via}`);
      else toast.error(`Merydian: ${x.error}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
