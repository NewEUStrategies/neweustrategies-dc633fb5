// Maile NABORU PRELEGENTÓW: potwierdzenie wysłania zgłoszenia (samoobsługa)
// i mail o decyzji organizatora (panel).
//
// SERWER JEST TRANSPORTEM, NIE GRANICĄ. Autoryzacja mieszka w bazie:
// `admin_event_cfp_notify_payload` woła `assert_event_admin_tenant()`, a
// `event_cfp_submission_notice` oddaje ładunek wyłącznie właścicielowi
// zgłoszenia (`event_people.user_id = auth.uid()`). Adres, język i status biorą
// się z bazy - nigdy z ciała żądania.
//
// RODZAJ MAILA WYNIKA ZE STANU ZGŁOSZENIA, NIE Z ŻYCZENIA KLIENTA. Panel mówi
// tylko „wyślij"; baza odpowiada, o czym (`notice`). Stan inny niż przyjęcie,
// odmowa albo prośba o zmiany = brak maila (`not_applicable`) - mail
// zaprzeczający aktualnej decyzji byłby gorszy niż brak maila.
//
// KLUCZ IDEMPOTENCJI NIESIE STEMPEL PRZEJŚCIA (`decided_at`, `submitted_at`).
// Dwa kliknięcia w ten sam przycisk dają jeden mail, a nowa decyzja albo
// ponowne wysłanie po poprawkach - kolejny.
//
// WYNIK WYSYŁKI WRACA DO BAZY (`admin_event_cfp_mark_notified`): udana wysyłka
// stempluje `notified_status/notified_at`, nieudana zapisuje `notify_error`,
// więc panel pokazuje organizatorowi, czy prelegent wie o decyzji.
//
// Moduł zawiera WYŁĄCZNIE deklaracje server functions + importy (wymóg
// tss-serverfn-split).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { CfpMailNotice } from "@/lib/events/cfpNotify.server";

export type CfpNotifyResult =
  { ok: true; skipped?: "duplicate" | "not_applicable" } | { ok: false; error: string };

const Input = z.object({ submissionId: z.string().uuid() });

function asRow(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stampOf(value: unknown): string {
  return typeof value === "string" && value !== "" ? value : "0";
}

/** Mail o decyzji organizatora - przycisk „Wyślij mail o decyzji" w panelu. */
export const notifyCfpDecision = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data, context }): Promise<CfpNotifyResult> => {
    const { data: payload, error } = await context.supabase.rpc("admin_event_cfp_notify_payload", {
      p_submission_id: data.submissionId,
    });
    if (error) return { ok: false, error: error.message };
    const row = asRow(payload);
    if (row === null) return { ok: false, error: "not_found" };

    const notice = row.notice;
    if (notice !== "accepted" && notice !== "rejected" && notice !== "changes_requested") {
      return { ok: true, skipped: "not_applicable" };
    }
    const email = typeof row.email === "string" ? row.email.trim() : "";
    if (email === "") return { ok: false, error: "no_recipient" };

    const { buildCfpNotice } = await import("@/lib/events/cfpNotify.server");
    const content = buildCfpNotice(notice satisfies CfpMailNotice, row);

    const { sendTxEmail } = await import("@/lib/email/transactional.server");
    const result = await sendTxEmail({
      type: content.type,
      to: email,
      lang: content.lang,
      subjectName: content.eventTitle,
      details: content.details,
      ctaPath: content.ctaPath,
      metaName: content.firstName,
      tenantId: content.tenantId,
      idempotencyKey: `event-cfp:${data.submissionId}:${notice}:${stampOf(row.decided_at)}`,
    });

    const failure = result.ok
      ? null
      : (result.reason ?? result.error ?? result.skipped ?? "send_failed");
    await context.supabase.rpc("admin_event_cfp_mark_notified", {
      p_payload:
        failure === null
          ? { submission_id: data.submissionId, status: notice }
          : { submission_id: data.submissionId, status: notice, error: failure },
    });

    if (failure !== null) return { ok: false, error: failure };
    return result.skipped === "duplicate" ? { ok: true, skipped: "duplicate" } : { ok: true };
  });

/** Potwierdzenie wysłania zgłoszenia - woła je strona zgłoszenia po `submit`. */
export const confirmCfpSubmissionEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data, context }): Promise<CfpNotifyResult> => {
    const { data: payload, error } = await context.supabase.rpc("event_cfp_submission_notice", {
      p_submission_id: data.submissionId,
    });
    if (error) return { ok: false, error: error.message };
    const row = asRow(payload);
    if (row === null) return { ok: false, error: "not_found" };

    // Potwierdzenie ma sens tylko dla zgłoszenia, które faktycznie czeka na ocenę.
    if (row.status !== "submitted" && row.status !== "under_review") {
      return { ok: true, skipped: "not_applicable" };
    }
    const email = typeof row.email === "string" ? row.email.trim() : "";
    if (email === "") return { ok: false, error: "no_recipient" };

    const { buildCfpNotice } = await import("@/lib/events/cfpNotify.server");
    const content = buildCfpNotice("received", row);

    const { sendTxEmail } = await import("@/lib/email/transactional.server");
    const result = await sendTxEmail({
      type: content.type,
      to: email,
      lang: content.lang,
      subjectName: content.eventTitle,
      details: content.details,
      ctaPath: content.ctaPath,
      metaName: content.firstName,
      tenantId: content.tenantId,
      idempotencyKey: `event-cfp:${data.submissionId}:received:${stampOf(row.submitted_at)}`,
    });

    if (!result.ok) {
      return { ok: false, error: result.reason ?? result.error ?? result.skipped ?? "send_failed" };
    }
    return result.skipped === "duplicate" ? { ok: true, skipped: "duplicate" } : { ok: true };
  });
