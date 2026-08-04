// Telemetria popupu newslettera (impression / open / submit / success / error).
//
// Zapis idzie WYŁĄCZNIE przez serwer: klient nie zna tenanta i nie ma grantu
// INSERT na `newsletter_popup_events`, więc raport w panelu nie da się zatruć
// obcym tenantem ani spreparowaną sesją. Tenant rozwiązujemy z hosta żądania
// (tak samo jak w subscribeToNewsletter), a wolumen tniemy limiterem per sesja.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireStaff } from "@/integrations/supabase/require-staff";

export const NEWSLETTER_POPUP_EVENTS = [
  "impression",
  "open",
  "submit",
  "success",
  "error",
] as const;

export type NewsletterPopupEventName = (typeof NEWSLETTER_POPUP_EVENTS)[number];

const LogInput = z.object({
  event: z.enum(NEWSLETTER_POPUP_EVENTS),
  sessionId: z.string().trim().max(64).optional(),
  layout: z.string().trim().max(32).optional(),
  lang: z.enum(["pl", "en"]).default("pl"),
  source: z.string().trim().max(120).optional(),
  variant: z.string().trim().max(64).optional(),
  errorCode: z.string().trim().max(160).optional(),
  meta: z.record(z.string().max(64), z.string().max(200)).optional(),
});

export type LogNewsletterPopupEventResult = { ok: boolean };

export const logNewsletterPopupEvent = createServerFn({ method: "POST" })
  .validator((data: unknown) => LogInput.parse(data))
  .handler(async ({ data }): Promise<LogNewsletterPopupEventResult> => {
    try {
      const [{ supabaseAdmin }, { resolveTenantIdForHost }, { currentTenantHost }] =
        await Promise.all([
          import("@/integrations/supabase/client.server"),
          import("@/lib/server/tenant.server"),
          import("@/lib/http/requestHost"),
        ]);
      const tenantId = await resolveTenantIdForHost(await currentTenantHost());
      if (!tenantId) return { ok: false };

      const { rateLimit } = await import("@/lib/server/rate-limit.server");
      const allowed = await rateLimit({
        scope: "newsletter.popup.event",
        subjectId: data.sessionId ?? "anonymous-session",
        max: 60,
        windowMinutes: 10,
      });
      if (!allowed) return { ok: false };

      const { error } = await supabaseAdmin.from("newsletter_popup_events").insert({
        tenant_id: tenantId,
        event: data.event,
        session_id: data.sessionId ?? null,
        layout: data.layout ?? null,
        lang: data.lang,
        source: data.source ?? null,
        variant: data.variant ?? null,
        error_code: data.errorCode ?? null,
        meta: data.meta ?? {},
      });
      if (error) {
        console.error("[newsletter-popup-events] insert failed", error.message);
        return { ok: false };
      }
      return { ok: true };
    } catch (err) {
      // Telemetria nigdy nie może wywrócić zapisu do newslettera.
      console.error("[newsletter-popup-events] log threw", err);
      return { ok: false };
    }
  });

export interface NewsletterPopupEventDay {
  day: string;
  counts: Record<NewsletterPopupEventName, number>;
}

export interface NewsletterPopupEventStats {
  days: NewsletterPopupEventDay[];
  totals: Record<NewsletterPopupEventName, number>;
  /** submit / impression */
  submitRate: number;
  /** success / submit */
  successRate: number;
  /** error / submit */
  errorRate: number;
}

const StatsInput = z.object({ days: z.number().int().min(1).max(365).default(30) });

function emptyCounts(): Record<NewsletterPopupEventName, number> {
  return { impression: 0, open: 0, submit: 0, success: 0, error: 0 };
}

function isEventName(value: string): value is NewsletterPopupEventName {
  return (NEWSLETTER_POPUP_EVENTS as readonly string[]).includes(value);
}

export const getNewsletterPopupEventStats = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .validator((data: unknown) => StatsInput.parse(data ?? {}))
  .handler(async ({ data, context }): Promise<NewsletterPopupEventStats> => {
    const { data: rows, error } = await context.supabase.rpc("newsletter_popup_event_stats", {
      _days: data.days,
    });
    if (error) throw new Error(error.message);

    const byDay = new Map<string, Record<NewsletterPopupEventName, number>>();
    const totals = emptyCounts();
    for (const row of rows ?? []) {
      const event = String(row.event);
      if (!isEventName(event)) continue;
      const day = String(row.day);
      const bucket = byDay.get(day) ?? emptyCounts();
      const count = Number(row.count ?? 0);
      bucket[event] += count;
      totals[event] += count;
      byDay.set(day, bucket);
    }

    const days = Array.from(byDay.entries())
      .map(([day, counts]) => ({ day, counts }))
      .sort((a, b) => (a.day < b.day ? 1 : -1));

    const ratio = (num: number, den: number) => (den > 0 ? num / den : 0);
    return {
      days,
      totals,
      submitRate: ratio(totals.submit, totals.impression),
      successRate: ratio(totals.success, totals.submit),
      errorRate: ratio(totals.error, totals.submit),
    };
  });
