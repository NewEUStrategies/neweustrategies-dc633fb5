// Atrapa funkcji serwerowej dopisania gości (`groupGuests.functions`) dla testów
// PRZEGLĄDARKI: formularza zapisu i panelu ponowienia.
//
// PO CO ATRAPA, A NIE PRAWDZIWY HANDLER. Handler potrzebuje żądania, sesji,
// hosta i klienta serwisowego - to warstwa serwera i ma własny test
// (`groupGuests.server.test.ts`). Tutaj liczy się to, co przeglądarka WYSYŁA
// i jak czyta ODPOWIEDŹ, więc atrapa oddaje `client` zaplanowany w atrapie RPC
// pod nazwą `event_register_group_guests_for_client` i zapisuje w niej
// wywołanie z PRAWDZIWYM ładunkiem gości (`guestsToPayload`).
//
// Odpowiedź jest wartością (`{ ok, added }` albo `{ ok: false, error }`), jak
// z serwera. Błąd zaplanowany przez `setError` udaje awarię transportu
// (wyjątek funkcji serwerowej) - odmowy bazy planujemy przez
// `setData({ ok: false, error })`.

/**
 * Minimum atrapy RPC: `SupabaseRpcStub` z `@/test/supabase/rpc` albo zwykłe
 * `vi.fn` testu, które oddaje `{ data, error }`.
 */
export interface GroupGuestsRpc {
  rpc: (
    name: string,
    args?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
}

/** Nazwa, pod którą atrapa RPC planuje odpowiedź serwera gości. */
export const GROUP_GUESTS_FOR_CLIENT_RPC = "event_register_group_guests_for_client";

export interface GroupGuestsServerFnCall {
  data: {
    leadRegistrationId: string;
    guests: { first_name: string; last_name: string; email: string }[];
  };
}

export function groupGuestsServerFnStub(stub: () => GroupGuestsRpc | null): {
  registerEventGroupGuests: (call: GroupGuestsServerFnCall) => Promise<unknown>;
} {
  return {
    registerEventGroupGuests: async ({ data }) => {
      const rpc = stub();
      if (rpc === null) throw new Error("test: atrapa RPC nie zostala ustawiona");
      const { data: client, error } = await rpc.rpc(GROUP_GUESTS_FOR_CLIENT_RPC, {
        p_lead_registration_id: data.leadRegistrationId,
        p_guests: data.guests,
      });
      if (error) throw new Error(error.message);
      return client;
    },
  };
}
