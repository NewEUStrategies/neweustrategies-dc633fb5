// Dane mojego biletu na wydarzenie - wyłącznie dla zalogowanego właściciela.
//
// Moduł zawiera WYŁĄCZNIE deklarację server function + importy (wymóg
// tss-serverfn-split); logika żyje w `ticket.server.ts`.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const getMyEventTicket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { eventId: string }) => {
    const eventId = typeof data?.eventId === "string" ? data.eventId.trim() : "";
    if (!UUID.test(eventId)) throw new Error("invalid_event_id");
    return { eventId };
  })
  .handler(async ({ data, context }) => {
    const { loadMyEventTicket } = await import("@/lib/events/ticket.server");
    return loadMyEventTicket(context.supabase, context.userId, data.eventId);
  });

/** Aktualna dostępność miejsc - autorytatywnie z backendu, bez cache klienta. */
export const getEventSeatState = createServerFn({ method: "POST" })
  .inputValidator((data: { eventId: string }) => {
    const eventId = typeof data?.eventId === "string" ? data.eventId.trim() : "";
    if (!UUID.test(eventId)) throw new Error("invalid_event_id");
    return { eventId };
  })
  .handler(async ({ data }) => {
    const { loadEventSeatState } = await import("@/lib/events/ticket.server");
    return loadEventSeatState(data.eventId);
  });
