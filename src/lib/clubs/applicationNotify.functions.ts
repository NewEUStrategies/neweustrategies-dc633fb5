// Powiadomienie e-mail dla kandydata po zmianie statusu zgłoszenia klubowego.
//
// Dlaczego serwer, a nie klient: treść i wysyłka idą przez ten sam potok co
// pozostała poczta transakcyjna (kolejka, idempotencja, lista wykluczeń), a
// panel nie może znać adresu kandydata inaczej niż przez RPC z bramką roli.
// Autoryzacja jest w bazie: `admin_club_application_notify_payload` woła
// `assert_admin_tenant()`, więc funkcja serwerowa nie jest tu granicą
// bezpieczeństwa - jest wyłącznie transportem.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { TxEmailType } from "@/lib/email-templates/tx-copy";

/** Statusy, dla których kandydat dostaje wiadomość. */
export const NOTIFIABLE_STATUSES = ["accepted", "rejected", "needs_info"] as const;
export type NotifiableStatus = (typeof NOTIFIABLE_STATUSES)[number];

const TYPE_BY_STATUS: Readonly<Record<NotifiableStatus, TxEmailType>> = {
  accepted: "club_application_accepted",
  rejected: "club_application_rejected",
  needs_info: "club_application_more_info",
};

const CTA_BY_STATUS: Readonly<Record<NotifiableStatus, string>> = {
  accepted: "/club",
  rejected: "/club",
  needs_info: "/club/apply",
};

export function isNotifiableStatus(status: string): status is NotifiableStatus {
  return (NOTIFIABLE_STATUSES as readonly string[]).includes(status);
}

export function emailTypeForStatus(status: NotifiableStatus): TxEmailType {
  return TYPE_BY_STATUS[status];
}

export type ClubApplicationNotifyResult =
  | { ok: true; skipped?: "duplicate" | "suppressed" | "not_notifiable" }
  | { ok: false; error: string };

const Input = z.object({
  applicationId: z.string().uuid(),
  status: z.enum(NOTIFIABLE_STATUSES),
});

interface NotifyPayload {
  email: string;
  first_name: string | null;
  last_name: string | null;
  lang: string | null;
  status: string;
  specialization_slug: string | null;
  tenant_id: string | null;
}

export const notifyClubApplicationStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data, context }): Promise<ClubApplicationNotifyResult> => {
    const { data: rows, error } = await context.supabase.rpc(
      "admin_club_application_notify_payload",
      { p_id: data.applicationId },
    );
    if (error) return { ok: false, error: error.message };

    const row = (Array.isArray(rows) ? rows[0] : null) as NotifyPayload | null;
    if (!row?.email) return { ok: false, error: "not_found" };
    // Status mógł się zmienić między zapisem a wysyłką - nie wysyłamy maila,
    // który zaprzeczałby aktualnej decyzji redakcji.
    if (row.status !== data.status) return { ok: true, skipped: "not_notifiable" };

    const { sendTxEmail } = await import("@/lib/email/transactional.server");
    const result = await sendTxEmail({
      type: TYPE_BY_STATUS[data.status],
      to: row.email,
      lang: row.lang === "en" ? "en" : "pl",
      subjectName: row.specialization_slug ?? null,
      ctaPath: CTA_BY_STATUS[data.status],
      metaName: row.first_name ?? null,
      tenantId: row.tenant_id ?? null,
      idempotencyKey: `club-application:${data.applicationId}:${data.status}`,
    });

    const ok = result.ok;
    await context.supabase.rpc("admin_club_application_mark_notified", {
      p_id: data.applicationId,
      p_status: data.status,
      p_ok: ok,
      p_error: ok ? null : (result.reason ?? result.error ?? "send_failed"),
    });

    if (!ok) return { ok: false, error: result.reason ?? result.error ?? "send_failed" };
    return result.skipped === "duplicate" ? { ok: true, skipped: "duplicate" } : { ok: true };
  });
