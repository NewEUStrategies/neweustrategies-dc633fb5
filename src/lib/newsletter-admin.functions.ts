// Admin-only newsletter server functions. Uzywane wylacznie z /admin/newsletter.
//
// TRZY ROZNE BRAMKI, bo to sa trzy rozne zasoby. Import listy stoi na
// `requireStaff` - to dane najemcy, zakresowane `tenant_id` z `profiles`.
// Odczyt stanu runnera stoi na `requireAdminEditor` - ta sama rola co RPC
// `job_scheduler_health()` po drugiej stronie panelu zdrowia (autorzy tresci
// nie ogladaja telemetrii platformy). Zapis konfiguracji runnera stoi na
// `requirePlatformAdmin` - `job_runner_settings` to singleton INSTALACJI, a nie
// wiersz najemcy.
//
// Import CSV zapisuje po stronie serwera przez service_role z pominieciem RLS,
// ale w ramach tenanta wywolujacego (tenant_id z profiles). Import respektuje
// idempotencje - istniejacy subskrybent nie jest nadpisywany.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  requireAdminEditor,
  requirePlatformAdmin,
  requireStaff,
} from "@/integrations/supabase/require-staff";
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
// interfejsem. Sekret NIE opuszcza serwera nawet w podglądzie - panel dostaje
// wyłącznie informację, czy jest ustawiony, bo do diagnostyki („czy cron ma
// czym się uwierzytelnić") wystarczy fakt, a nie treść.
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
  /**
   * Czy sekret runnera jest ustawiony. Treści sekretu panel nie potrzebuje -
   * taki sam kształt ma RPC `job_scheduler_health` (pole `secret_set`).
   */
  secret_set: boolean;
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
  .middleware([requireAdminEditor])
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
      secret_set: Boolean(row?.secret),
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

// Ten sam kształt adresu, który obowiązuje ścieżkę automatyczną (`arm_job_runner`,
// 20260731110000:159-165). Dwa różne kontrakty na jedną kolumnę to klasa awarii:
// ręczna ścieżka przepuszczała ścieżkę w URL, userinfo (`https://ofiara@evil.test`)
// i adresy lokalne, po których tick wysyłał sekret operatora.
const BASE_URL_SHAPE = /^https:\/\/[a-z0-9.-]+(:\d+)?$/i;
const BASE_URL_LOCAL = /^https:\/\/(localhost|127\.|0\.0\.0\.0|\[)/i;

const JobRunnerUpdate = z.object({
  enabled: z.boolean(),
  base_url: z
    .string()
    .trim()
    .max(500)
    // Ukośnik końcowy ucinamy PRZED walidacją - tak samo robi `arm_job_runner`
    // (`rtrim(btrim(...), '/')`), więc obie ścieżki oceniają ten sam napis.
    .transform((value) => value.replace(/\/+$/, ""))
    .refine(
      (value) => value === "" || (BASE_URL_SHAPE.test(value) && !BASE_URL_LOCAL.test(value)),
      "https_url_required",
    ),
});

/**
 * Sam host z wpisu allowlisty. Wpisy bywają domeną (`tenants.domain`) albo
 * pełnym adresem (zmienne środowiskowe), więc obie formy sprowadzamy do tego
 * samego: bez schematu, bez portu, bez ścieżki, małymi literami.
 */
function hostOf(value: string): string {
  const withoutScheme = value
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "");
  const authority = withoutScheme.split("/")[0] ?? "";
  const afterUserinfo = authority.split("@").at(-1) ?? "";
  return afterUserinfo.split(":")[0] ?? "";
}

/**
 * Allowlista hostów żyje w TypeScripcie, a nie w bazie. Trigger w bazie pilnuje
 * KSZTAŁTU adresu, bo nie ma jak zajrzeć do zmiennych środowiskowych procesu,
 * a lista domen najemców nie wystarcza: w instalacji jednodomenowej
 * `tenants.domain` bywa puste (jobScheduler.server.ts), a staging i podglądy
 * mają host spoza katalogu najemców. Stąd jawna furtka
 * `JOB_RUNNER_BASE_URL_ALLOWLIST` - bez niej pierwszy zapis po wdrożeniu na
 * środowisko podglądowe zostałby odrzucony przez własną ochronę.
 */
async function assertBaseUrlAllowed(baseUrl: string): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const allowed = new Set<string>();

  // Katalog najemców czytamy BEZ zawężenia najemcą - filtr po najemcy byłby tu
  // błędem logicznym: adres jest wspólny dla całej instalacji.
  const { data: tenants, error } = await supabaseAdmin.from("tenants").select("domain");
  if (error) {
    // Fail closed: bez katalogu domen nie wiemy, czy adres jest nasz, a stawką
    // jest sekret operatora wysyłany pod ten adres co minutę.
    throw new Error(`base_url_allowlist_unavailable: ${error.message}`);
  }
  for (const row of tenants ?? []) {
    const host = hostOf(row.domain ?? "");
    if (host) allowed.add(host);
  }

  const siteUrl = process.env.PUBLIC_SITE_URL || process.env.SITE_URL || process.env.URL || "";
  const siteHost = hostOf(siteUrl);
  if (siteHost) allowed.add(siteHost);

  for (const entry of (process.env.JOB_RUNNER_BASE_URL_ALLOWLIST ?? "").split(",")) {
    const host = hostOf(entry);
    if (host) allowed.add(host);
  }

  if (!allowed.has(hostOf(baseUrl))) {
    throw new Error("base_url_not_in_allowlist");
  }
}

/**
 * Zapis konfiguracji runnera. Bramka jest WYŻSZA niż w reszcie pliku, bo to nie
 * są dane najemcy: `base_url` jest pierwszą gałęzią COALESCE w
 * `job_runner_base_url()` (20260731130000:45-67), a pg_cron wysyła pod ten adres
 * sekret operatora w nagłówkach `x-jobs-secret` i `x-community-cron-secret`
 * (20260731210000:183-194, :298-311). Ten sam sekret otwiera
 * /api/public/jobs-tick, /api/public/community-cron i /api/public/billing-cron,
 * a `enabled = false` gasi zadania tła CAŁEJ instalacji. Staff najemcy nie może
 * o tym decydować.
 */
export const updateJobRunnerSettings = createServerFn({ method: "POST" })
  .middleware([requirePlatformAdmin])
  .validator((data: unknown) => JobRunnerUpdate.parse(data))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Host sprawdzamy PRZED dotknięciem tabeli - odrzucony adres nie ma prawa
    // zostawić po sobie ani telemetrii, ani częściowego zapisu.
    if (data.base_url !== "") {
      await assertBaseUrlAllowed(data.base_url);
    }

    // Stan poprzedni czytamy dla audytu: po zapisie nie da się go odtworzyć,
    // bo `updated_at` nadpisuje telemetria ticku już minutę później.
    const { data: before } = await supabaseAdmin
      .from("job_runner_settings")
      .select("enabled, base_url")
      .eq("id", 1)
      .maybeSingle();
    const previous = (before ?? null) as { enabled: boolean; base_url: string } | null;

    const { error } = await supabaseAdmin
      .from("job_runner_settings")
      .update({ enabled: data.enabled, base_url: data.base_url } as never)
      .eq("id", 1);
    if (error) throw new Error(error.message);

    // Ślad audytowy jest tu jedynym śladem W OGÓLE: tabela nie ma `updated_by`,
    // a `updated_at` zaciera pierwszy następny tick. Best-effort (jak
    // `recordJobRun`) - nieudany audyt nie może cofnąć zapisu, który w bazie
    // już się wydarzył, bo panel pokazałby wtedy stan niezgodny z bazą.
    try {
      const { data: profile } = await context.supabase
        .from("profiles")
        .select("tenant_id")
        .eq("id", context.userId)
        .maybeSingle();
      const tenantId = (profile as { tenant_id?: string } | null)?.tenant_id;
      if (!tenantId) throw new Error("brak tenanta wywolujacego");
      const { error: auditError } = await supabaseAdmin.from("audit_log").insert({
        tenant_id: tenantId,
        actor_id: context.userId,
        action: "job_runner.settings.update",
        entity_type: "job_runner_settings",
        entity_id: "1",
        // BEZ sekretu - wpis audytowy czyta się szerzej niż samą tabelę.
        metadata: {
          enabled_before: previous?.enabled ?? null,
          enabled_after: data.enabled,
          base_url_before: previous?.base_url ?? null,
          base_url_after: data.base_url,
        },
      });
      if (auditError) throw new Error(auditError.message);
    } catch (auditFailure) {
      console.error("[updateJobRunnerSettings] audit_log write failed", {
        userId: context.userId,
        message: auditFailure instanceof Error ? auditFailure.message : String(auditFailure),
      });
    }

    return { ok: true };
  });
