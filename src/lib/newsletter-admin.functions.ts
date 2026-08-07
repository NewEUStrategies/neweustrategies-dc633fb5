// Admin-only newsletter server functions. Uzywane wylacznie z /admin/newsletter.
//
// Zabezpieczenie: `requireStaff` (uwierzytelnienie + rola admin/editor/author).
// Import CSV zapisuje po stronie serwera przez service_role z pominieciem RLS,
// ale w ramach tenanta wywolujacego (tenant_id z profiles). Import respektuje
// idempotencje - istniejacy subskrybent nie jest nadpisywany.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireStaff } from "@/integrations/supabase/require-staff";
import type { RunnerTickStatus } from "@/lib/email/runnerHealth";

const ImportRow = z.object({
  email: z.string().trim().email().max(254),
  firstName: z.string().trim().max(100).optional(),
  lastName: z.string().trim().max(100).optional(),
  displayName: z.string().trim().max(200).optional(),
  language: z.enum(["pl", "en"]).default("pl"),
  status: z.enum(["subscribed", "pending", "unsubscribed"]).default("subscribed"),
  source: z.string().trim().max(120).optional(),
  company: z.string().trim().max(200).optional(),
});

const ImportInput = z.object({
  rows: z.array(ImportRow).min(1).max(5000),
  markSource: z.string().trim().max(120).default("csv-import"),
});

export interface ImportSummary {
  ok: true;
  imported: number;
  skipped: number;
  errors: { email: string; reason: string }[];
}

export const importNewsletterSubscribers = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .validator((data: unknown) => ImportInput.parse(data))
  .handler(async ({ data, context }): Promise<ImportSummary> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // tenant_id wywolujacego z profiles.
    const { data: profile, error: profileErr } = await context.supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", context.userId)
      .maybeSingle();
    if (profileErr || !profile?.tenant_id) {
      throw new Error("Profil bez tenanta - nie mozna importowac.");
    }
    const tenantId = profile.tenant_id;

    // Sprawdz istniejace, zeby nie liczyc ich do "imported".
    const emails = Array.from(new Set(data.rows.map((r) => r.email.toLowerCase())));
    const { data: existing } = await supabaseAdmin
      .from("newsletter_subscribers")
      .select("email")
      .eq("tenant_id", tenantId)
      .in("email", emails);
    const known = new Set((existing ?? []).map((r) => r.email as string));

    const errors: { email: string; reason: string }[] = [];
    let imported = 0;
    let skipped = 0;

    for (const raw of data.rows) {
      const email = raw.email.toLowerCase();
      if (known.has(email)) {
        skipped++;
        continue;
      }
      const displayName =
        raw.displayName || [raw.firstName, raw.lastName].filter(Boolean).join(" ") || null;
      const meta: Record<string, string> = {};
      if (raw.company) meta.company = raw.company;

      const { error } = await supabaseAdmin.from("newsletter_subscribers").insert({
        tenant_id: tenantId,
        email,
        display_name: displayName,
        first_name: raw.firstName ?? null,
        last_name: raw.lastName ?? null,
        language: raw.language,
        status: raw.status,
        source: raw.source ?? data.markSource,
        confirmed_at: raw.status === "subscribed" ? new Date().toISOString() : null,
        meta: Object.keys(meta).length ? meta : null,
      });
      if (error) {
        errors.push({ email, reason: error.message });
      } else {
        imported++;
        known.add(email);
      }
    }

    return { ok: true, imported, skipped, errors };
  });

// ----------------------------------------------------------------------------
// Job runner (automatyczny tick wysyłki) - konfiguracja pojedynczego wiersza
// job_runner_settings. Tabela jest service-role-only; te funkcje są jedynym
// interfejsem (staff). Sekret pokazujemy TYLKO adminom - jest wpinany w
// cron/pg_net po stronie bazy, a tu służy wyłącznie diagnostyce.
// ----------------------------------------------------------------------------

/** Głębokość kolejek pocztowych pgmq (dowód, że dren nadąża za nadawaniem). */
export interface EmailQueueDepth {
  auth: number;
  transactional: number;
  authDlq: number;
  transactionalDlq: number;
}

export interface JobRunnerSettings {
  enabled: boolean;
  /** Nadpisanie adresu z konfiguracji (puste = wyliczany z domeny tenanta). */
  base_url: string;
  /**
   * Adres, którego cron NAPRAWDĘ użyje (konfiguracja albo domena tenanta
   * domyślnego). Puste = tick nie ma gdzie zapukać.
   */
  effective_base_url: string;
  /** Podgląd sekretu (pierwsze 6 znaków) - pełny sekret nie opuszcza serwera. */
  secret_preview: string;
  updated_at: string | null;
  /** Telemetria ostatniego ticku - „włączone" nie znaczy jeszcze „działa". */
  last_tick_at: string | null;
  last_tick_status: RunnerTickStatus;
  last_tick_error: string | null;
  tick_count: number;
  queues: EmailQueueDepth | null;
}

function tickStatusOf(value: unknown): RunnerTickStatus {
  return value === "dispatched" || value === "skipped" || value === "error" ? value : null;
}

function queueCount(source: Record<string, unknown>, key: string): number {
  const value = source[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

/**
 * Stan automatu wysyłki. Zwraca nie tylko konfigurację, ale i DOWÓD działania:
 * moment ostatniego ticku, jego status oraz długość kolejek pocztowych. Bez tego
 * panel odpowiadał wyłącznie na pytanie „czy przełącznik jest włączony", a nie na
 * to, które naprawdę interesuje operatora: „czy poczta wychodzi".
 */
export const getJobRunnerSettings = createServerFn({ method: "GET" })
  .middleware([requireStaff])
  .handler(async (): Promise<JobRunnerSettings> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("job_runner_settings")
      .select(
        "enabled, base_url, secret, updated_at, last_tick_at, last_tick_status, last_tick_error, tick_count",
      )
      .eq("id", 1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const row = (data ?? null) as {
      enabled: boolean;
      base_url: string;
      secret: string;
      updated_at: string | null;
      last_tick_at: string | null;
      last_tick_status: string | null;
      last_tick_error: string | null;
      tick_count: number | null;
    } | null;

    // Adres efektywny i głębokość kolejek pochodzą z RPC nowszych niż
    // wygenerowane typy -> rzutowanie na granicy wywołania (precedens:
    // newsletter_deliverability_metrics). Oba są best-effort: panel ma się
    // wyświetlić także na bazie bez pgmq.
    const [{ data: effectiveUrl }, { data: depth }] = await Promise.all([
      supabaseAdmin.rpc("job_runner_base_url"),
      supabaseAdmin.rpc("email_queue_depth"),
    ]);

    const depthRow =
      typeof depth === "object" && depth !== null ? (depth as Record<string, unknown>) : {};
    const queues =
      depthRow.ok === true && typeof depthRow.queues === "object" && depthRow.queues !== null
        ? (depthRow.queues as Record<string, unknown>)
        : null;

    return {
      enabled: row?.enabled ?? false,
      base_url: row?.base_url ?? "",
      effective_base_url: typeof effectiveUrl === "string" ? effectiveUrl : "",
      secret_preview: row?.secret ? `${row.secret.slice(0, 6)}…` : "",
      updated_at: row?.updated_at ?? null,
      last_tick_at: row?.last_tick_at ?? null,
      last_tick_status: tickStatusOf(row?.last_tick_status),
      last_tick_error: row?.last_tick_error ?? null,
      tick_count: row?.tick_count ?? 0,
      queues: queues
        ? {
            auth: queueCount(queues, "auth_emails"),
            transactional: queueCount(queues, "transactional_emails"),
            authDlq: queueCount(queues, "auth_emails_dlq"),
            transactionalDlq: queueCount(queues, "transactional_emails_dlq"),
          }
        : null,
    };
  });

const JobRunnerUpdate = z.object({
  enabled: z.boolean(),
  base_url: z
    .string()
    .trim()
    .max(500)
    .refine((v) => v === "" || /^https:\/\/[^\s]+$/i.test(v), "https_url_required"),
});

export const updateJobRunnerSettings = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .validator((data: unknown) => JobRunnerUpdate.parse(data))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("job_runner_settings")
      .update({ enabled: data.enabled, base_url: data.base_url.replace(/\/+$/, "") } as never)
      .eq("id", 1);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
