// Stan puli biletów wliczonych w plan - dla zalogowanego wołającego.
//
// Moduł zawiera WYŁĄCZNIE deklarację server function + importy (wymóg
// tss-serverfn-split); reguły żyją w `ticketAllowance.ts`, odczyt w
// `ticketAllowance.server.ts`.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getMyTicketAllowance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { loadTicketAllowance } = await import("@/lib/events/ticketAllowance.server");
    return loadTicketAllowance(context.supabase);
  });
