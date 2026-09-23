// Bilety z kodem QR dla bezpłatnego zapisu grupowego - wysyłane od razu po
// dopisaniu gości, bo nie ma płatności, po której zrobiłby to webhook.
//
// UWIERZYTELNIENIE KLUCZEM `manage_token` PROWADZĄCEGO, jak potwierdzenie
// zapisu (`registrationSelfNotify.functions`). Serwer nie ufa niczemu poza nim:
// zgłoszenie, goście i adresy biorą się z bazy. Kto zna klucz, może najwyżej
// wyzwolić wysyłkę biletów na adresy podane przy zapisie - i tylko raz, bo
// baza wydaje kod jednorazowo (`ticket_code_sent_at`).
//
// Zapis płatny przechodzi tędy bez skutku: miejsca nieopłacone nie dostają
// biletu, a wyda je webhook po zaksięgowaniu płatności.
//
// Moduł zawiera WYŁĄCZNIE deklarację server function + importy (wymóg
// tss-serverfn-split).
import { createClient } from "@supabase/supabase-js";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type { Database } from "@/integrations/supabase/types";
import { fetchWithTenantHost } from "@/integrations/supabase/tenant-host-fetch";

export type GroupTicketCodesResult = { ok: true; sent: number } | { ok: false; error: string };

const Input = z.object({
  /** 24 bajty base64url z `_event_new_qr_token()` - dokładnie 32 znaki. */
  manageToken: z.string().regex(/^[A-Za-z0-9_-]{32}$/),
});

export const sendGroupTicketCodes = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data }): Promise<GroupTicketCodesResult> => {
    // Klient ANONIMOWY z nagłówkiem hosta - `event_registration_notify_payload`
    // ustala najemcę przez `public_tenant_id()`.
    const supabase = createClient<Database>(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_PUBLISHABLE_KEY!,
      {
        auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
        global: { fetch: fetchWithTenantHost },
      },
    );
    const { data: payload, error } = await supabase.rpc("event_registration_notify_payload", {
      p_payload: { manage_token: data.manageToken },
    });
    if (error) return { ok: false, error: error.message };

    const row =
      typeof payload === "object" && payload !== null && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : null;
    const registrationId = typeof row?.registration_id === "string" ? row.registration_id : "";
    if (registrationId === "") return { ok: false, error: "not_found" };

    const { issueAndSendTicketCodes } = await import("@/lib/events/ticketCodeNotify.server");
    return { ok: true, sent: await issueAndSendTicketCodes(registrationId) };
  });
