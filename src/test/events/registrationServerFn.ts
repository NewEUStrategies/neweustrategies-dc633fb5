// Atrapa funkcji serwerowej zapisu (`eventRegistration.functions`) dla testów
// PRZEGLĄDARKI: formularza zapisu i `publicRegistrationApi`.
//
// PO CO ATRAPA, A NIE PRAWDZIWY HANDLER. Handler potrzebuje żądania, sesji,
// hosta i klienta serwisowego - to warstwa serwera i ma własny test
// (`eventRegistration.server.test.ts`). Tutaj liczy się to, co przeglądarka
// WYSYŁA i jak czyta ODPOWIEDŹ, więc atrapa robi dokładnie to, co serwer
// z punktu widzenia przewodu: składa PRAWDZIWY `p_payload` z wejścia
// (`registrationPayload`) i oddaje `client` zaplanowany w atrapie RPC pod
// nazwą `event_register_for_client`. Atrybucja jedzie osobnym argumentem,
// bo nie jest częścią `p_payload`.
//
// Odpowiedź jest wartością (`{ ok, outcome | error }`), jak z serwera. Błąd
// zaplanowany przez `setError` udaje awarię transportu (wyjątek funkcji
// serwerowej) - serwer zamienia błędy bazy na `unknown` WARTOŚCIĄ, więc
// odmowy bazy planujemy przez `setData({ ok: false, error })`.
import {
  registrationPayload,
  type EventRegistrationRequest,
} from "@/lib/events/registrationPayload";
import type { SupabaseRpcStub } from "@/test/supabase/rpc";

/** Nazwa, pod którą atrapa RPC planuje odpowiedź serwera zapisu. */
export const REGISTER_FOR_CLIENT_RPC = "event_register_for_client";

export function registrationServerFnStub(stub: () => SupabaseRpcStub | null): {
  submitEventRegistration: (call: { data: EventRegistrationRequest }) => Promise<unknown>;
} {
  return {
    submitEventRegistration: async ({ data }) => {
      const rpc = stub();
      if (rpc === null) throw new Error("test: atrapa RPC nie zostala ustawiona");
      const { data: client, error } = await rpc.rpc(REGISTER_FOR_CLIENT_RPC, {
        p_payload: registrationPayload(data),
        attribution: data.attribution ?? null,
      });
      if (error) throw new Error(error.message);
      return client;
    },
  };
}
