// Mail o losie zgłoszenia na wydarzenie: przyjęcie, decyzja, awans z rezerwy.
//
// DLACZEGO SERWER, A NIE KLIENT. Treść i wysyłka idą tym samym potokiem, co
// reszta poczty transakcyjnej (kolejka, idempotencja, lista wykluczeń), a panel
// NIE MOŻE znać adresu uczestnika inaczej niż przez RPC z bramką roli.
// Autoryzacja mieszka w bazie: `admin_event_registration_notify_payload` woła
// `assert_editor_tenant()`, więc ta funkcja serwerowa nie jest granicą
// bezpieczeństwa - jest wyłącznie transportem.
//
// STATUS SPRAWDZAMY DWA RAZY. Organizator klika „powiadom" na liście, która
// mogła się zestarzeć; ładunek niesie status Z CHWILI ODCZYTU i jeśli nie
// zgadza się z tym, o czym mamy powiadomić, milczymy. Mail zaprzeczający
// aktualnej decyzji jest gorszy niż brak maila - odbiorca przyjeżdża na
// wydarzenie, na które go nie ma.
//
// KLUCZ IDEMPOTENCJI ZAWIERA STATUS. `event-registration:<id>:approved` nie
// koliduje z `...:rejected`, więc zmiana decyzji wysyła drugi mail (i musi),
// a dwa kliknięcia w ten sam przycisk wysyłają jeden.
//
// PIECZĘĆ „POWIADOMIONO" TYLKO DLA AWANSU. `admin_event_registration_mark_notified`
// stempluje `waitlist_notified_at`, czyli kolumnę o JEDNYM znaczeniu: „osoba
// wie, że weszła z rezerwy". Stemplowanie jej po mailu o odmowie zamieniłoby
// tę kolumnę w bezużyteczny licznik wysyłek.
//
// Moduł zawiera WYŁĄCZNIE deklarację server function + importy (wymóg
// tss-serverfn-split).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { TxEmailType } from "@/lib/email-templates/tx-copy";

/** Momenty cyklu życia zgłoszenia, o których piszemy do uczestnika. */
export const REGISTRATION_NOTICES = ["received", "approved", "rejected", "promoted"] as const;
export type RegistrationNotice = (typeof REGISTRATION_NOTICES)[number];

const TYPE_BY_NOTICE: Readonly<Record<RegistrationNotice, TxEmailType>> = {
  received: "event_registration_received",
  approved: "event_registration_approved",
  rejected: "event_registration_rejected",
  promoted: "event_waitlist_promoted",
};

/** Status zgłoszenia, który musi obowiązywać, żeby dane powiadomienie miało sens. */
const STATUS_BY_NOTICE: Readonly<Record<RegistrationNotice, readonly string[]>> = {
  received: ["pending", "waitlist"],
  approved: ["approved", "attended"],
  rejected: ["rejected"],
  promoted: ["approved", "attended"],
};

export function registrationNoticeType(notice: RegistrationNotice): TxEmailType {
  return TYPE_BY_NOTICE[notice];
}

export type RegistrationNotifyResult =
  | { ok: true; skipped?: "duplicate" | "suppressed" | "status_changed" }
  | { ok: false; error: string };

const Input = z.object({
  registrationId: z.string().uuid(),
  notice: z.enum(REGISTRATION_NOTICES),
});

export const notifyEventRegistrationDecision = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data, context }): Promise<RegistrationNotifyResult> => {
    const { data: payload, error } = await context.supabase.rpc(
      "admin_event_registration_notify_payload",
      { p_payload: { registration_id: data.registrationId } },
    );
    if (error) return { ok: false, error: error.message };

    const row =
      typeof payload === "object" && payload !== null && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : null;
    const email = typeof row?.email === "string" ? row.email.trim() : "";
    if (row === null || email === "") return { ok: false, error: "not_found" };

    const status = typeof row.status === "string" ? row.status : "";
    if (!STATUS_BY_NOTICE[data.notice].includes(status)) {
      return { ok: true, skipped: "status_changed" };
    }

    const { buildRegistrationNotice } = await import("@/lib/events/registrationNotify.server");
    const notice = buildRegistrationNotice(data.notice, row);

    const { sendTxEmail } = await import("@/lib/email/transactional.server");
    const result = await sendTxEmail({
      type: TYPE_BY_NOTICE[data.notice],
      to: email,
      lang: notice.lang,
      subjectName: notice.eventTitle,
      details: notice.details,
      ctaPath: notice.ctaPath,
      metaName: notice.firstName,
      tenantId: notice.tenantId,
      idempotencyKey: `event-registration:${data.registrationId}:${data.notice}`,
    });

    if (!result.ok) {
      return { ok: false, error: result.reason ?? result.error ?? "send_failed" };
    }

    // Tylko awans z rezerwy ma w bazie swoją pieczęć - patrz nagłówek.
    if (data.notice === "promoted") {
      await context.supabase.rpc("admin_event_registration_mark_notified", {
        p_payload: { registration_ids: [data.registrationId] },
      });
    }

    return result.skipped === "duplicate" ? { ok: true, skipped: "duplicate" } : { ok: true };
  });
