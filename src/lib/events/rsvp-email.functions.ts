// Potwierdzenie mailowe bezpłatnego RSVP na wydarzenie.
//
// Płatne zapisy potwierdza webhook Stripe (metadata.event_id). Bezpłatny RSVP
// idzie wyłącznie przez RPC `rsvp_event`, więc potwierdzenie wysyłamy tutaj -
// serwerowo, po ponownej weryfikacji, że wywołujący naprawdę ma status
// `going` (klient nie może wymusić maila dla cudzego/nieistniejącego zapisu).
//
// Moduł zawiera WYŁĄCZNIE deklarację server function + importy (wymóg
// tss-serverfn-split); cała logika wysyłki żyje w `notifications.server.ts`.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const confirmFreeRsvpEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { eventId: string }) => {
    const eventId = typeof data?.eventId === "string" ? data.eventId.trim() : "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(eventId)) {
      throw new Error("invalid_event_id");
    }
    return { eventId };
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // RLS "rsvps owner read" - widzimy tylko własny wiersz.
    const { data: rsvp, error } = await supabase
      .from("event_rsvps")
      .select("id, status")
      .eq("event_id", data.eventId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!rsvp || rsvp.status !== "going") return { sent: false as const };

    const { notifyEventRegistration } = await import("@/lib/billing/notifications.server");
    await notifyEventRegistration({
      userId,
      eventId: data.eventId,
      ticketSeed: rsvp.id,
      // Bezpłatne RSVP - brak kwoty; klucz idempotencji po wierszu RSVP, więc
      // ponowny klik "idę" po anulowaniu nie duplikuje maila.
      idempotencySeed: `rsvp:${rsvp.id}`,
    });
    return { sent: true as const };
  });
