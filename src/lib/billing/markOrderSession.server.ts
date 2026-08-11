// Utrwalenie identyfikatora sesji operatora na zamówieniu.
//
// Dotąd każde wywołanie `payment_order_mark_session` szło "na ślepo": błąd RPC
// i wynik `false` były ignorowane, więc zamówienie potrafiło zostać w stanie
// `pending` bez `provider_session_id` mimo poprawnie utworzonej sesji Stripe -
// a webhook nie miał się o co zaczepić przy dopasowaniu po sesji.
//
// Tutaj: logujemy przyczynę i - gdy ścieżka użytkownika zawiedzie (cache schematu
// PostgREST, brak `auth.uid()` w kontekście serwerowym, wyścig statusu) - domykamy
// zapis rolą serwisową. To bezpieczne: wywołujący właśnie utworzył to zamówienie,
// a zapis ogranicza się do sesji i stanów przejściowych, nigdy do `paid`.
import type { SupabaseClient } from "@supabase/supabase-js";

export type MarkSessionStatus = "processing" | "failed" | "canceled";

type AnySupabase = Pick<SupabaseClient, "rpc">;

export interface MarkOrderSessionInput {
  readonly orderId: string;
  readonly sessionId?: string | null;
  readonly status: MarkSessionStatus;
}

export async function markOrderSession(
  supabase: AnySupabase,
  { orderId, sessionId = null, status }: MarkOrderSessionInput,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("payment_order_mark_session", {
    _order_id: orderId,
    _session_id: sessionId,
    _status: status,
  });

  if (!error && data === true) return true;

  console.error(
    "[checkout] mark_session fallback",
    orderId,
    status,
    error ? error.message : "rpc_returned_false",
  );

  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch: {
      status: MarkSessionStatus;
      updated_at: string;
      provider_session_id?: string;
    } = { status, updated_at: new Date().toISOString() };
    if (typeof sessionId === "string" && sessionId !== "") patch.provider_session_id = sessionId;

    const { data: rows, error: adminErr } = await supabaseAdmin
      .from("payment_orders")
      .update(patch)
      .eq("id", orderId)
      .is("paid_at", null)
      .in("status", ["pending", "processing"])
      .select("id");


    if (adminErr) {
      console.error("[checkout] mark_session admin failed", orderId, adminErr.message);
      return false;
    }
    return (rows ?? []).length > 0;
  } catch (err) {
    console.error(
      "[checkout] mark_session admin threw",
      orderId,
      err instanceof Error ? err.message : String(err),
    );
    return false;
  }
}
