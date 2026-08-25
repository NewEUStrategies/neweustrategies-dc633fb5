// Potwierdzenie zapisu wysyłane od razu po wypełnieniu formularza.
//
// GOŚĆ BEZ KONTA TEŻ DOSTAJE POTWIERDZENIE. To jest cała racja istnienia tego
// pliku: ścieżka administracyjna (`registrationNotify.functions`) wymaga roli
// redakcyjnej, a uczestnik, który właśnie się zapisał, żadnej roli nie ma -
// i nie powinien czekać na to, aż organizator kliknie „powiadom".
//
// UWIERZYTELNIENIE TYM SAMYM SEKRETEM, CO REZYGNACJA. Klient podaje
// `manage_token`, który dostał w odpowiedzi `event_register`. Kto go zna, może
// już dziś odwołać ten zapis - więc odczyt własnego adresu i imienia niczego
// nie otwiera. Serwer NIE ufa niczemu poza tym kluczem: adres, język i status
// biorą się z bazy, nie z ciała żądania.
//
// RODZAJ MAILA WYNIKA ZE STATUSU, NIE Z ŻYCZENIA KLIENTA. Zapis oczekujący na
// decyzję dostaje „zgłoszenie przyjęte", zapis zatwierdzony od ręki -
// „zgłoszenie zaakceptowane". Gdyby to klient wybierał treść, mógłby wysłać
// sobie potwierdzenie miejsca, którego nie ma.
//
// FAIL-SOFT. Brak maila nie unieważnia zapisu, więc wywołujący traktuje odmowę
// jako drobiazg i nie pokazuje jej jako awarii formularza.
//
// Moduł zawiera WYŁĄCZNIE deklarację server function + importy (wymóg
// tss-serverfn-split).
import { createClient } from "@supabase/supabase-js";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type { Database } from "@/integrations/supabase/types";
import { fetchWithTenantHost } from "@/integrations/supabase/tenant-host-fetch";

export type SelfNotifyResult =
  | { ok: true; skipped?: "duplicate" | "suppressed" | "not_notifiable" }
  | { ok: false; error: string };

const Input = z.object({
  /** 24 bajty base64url z `_event_new_qr_token()` - dokładnie 32 znaki. */
  manageToken: z.string().regex(/^[A-Za-z0-9_-]{32}$/),
});

export const confirmEventRegistrationEmail = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data }): Promise<SelfNotifyResult> => {
    // Klient ANONIMOWY z naglowkiem hosta - `event_registration_notify_payload`
    // ustala najemce przez `public_tenant_id()`, a klucz serwisowy tego
    // naglowka nie niesie i trafilby zawsze do najemcy domyslnego.
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
    const email = typeof row?.email === "string" ? row.email.trim() : "";
    if (row === null || email === "") return { ok: false, error: "not_found" };

    const status = typeof row.status === "string" ? row.status : "";
    const notice =
      status === "pending" || status === "waitlist"
        ? ("received" as const)
        : status === "approved" || status === "attended"
          ? ("approved" as const)
          : null;
    if (notice === null) return { ok: true, skipped: "not_notifiable" };

    const { buildRegistrationNotice } = await import("@/lib/events/registrationNotify.server");
    // Klucz jawny wedruje do tresci maila: to JEDYNY moment, w ktorym serwis
    // go widzi (baza trzyma sam hash), a gosc bez konta nie ma go skad odtworzyc.
    const content = buildRegistrationNotice(notice, row, data.manageToken);
    const registrationId = typeof row.registration_id === "string" ? row.registration_id : "";

    const { sendTxEmail } = await import("@/lib/email/transactional.server");
    const result = await sendTxEmail({
      type: notice === "received" ? "event_registration_received" : "event_registration_approved",
      to: email,
      lang: content.lang,
      subjectName: content.eventTitle,
      details: content.details,
      ctaPath: content.ctaPath,
      ctaLabel: content.ctaLabel ?? undefined,
      metaName: content.firstName,
      tenantId: content.tenantId,
      idempotencyKey: `event-registration:${registrationId}:${notice}`,
    });

    if (!result.ok) return { ok: false, error: result.reason ?? result.error ?? "send_failed" };
    return result.skipped === "duplicate" ? { ok: true, skipped: "duplicate" } : { ok: true };
  });
