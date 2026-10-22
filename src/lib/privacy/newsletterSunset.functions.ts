// Funkcje serwerowe karty „Retencja danych" - wygaszanie nieaktywnych
// subskrybentów newslettera (I9d-Y1, Z-I9c-08): lista „do wygaszenia",
// wykluczenie adresu z powodem i jego cofnięcie, treść prośby o potwierdzenie
// edytowana w panelu i jej podgląd.
//
// Ta sama bramka co reszta karty: `requireAdmin` (admin albo super_admin,
// aal2, gdy konto ma MFA) i bramka SQL `_data_retention_admin_tenant`.
// Najemca NIGDY z parametrów - RPC bierze go z sesji, a treść prośby czyta
// i zapisuje wiersz `site_settings` najemcy z profilu sesji (polityki RLS
// wpuszczają wyłącznie `tenant_id = current_tenant_id()`). Nazwy RPC i tabel
// są LITERAŁAMI w miejscu wywołania (bramka `generate:ts-sql-contract`);
// RPC wygaszania nie ma jeszcze w wygenerowanych typach, więc klient jest
// rzutowany na kształt wywołania (`RpcCallable`, precedens S7).
//
// Wykluczenie i jego cofnięcie piszą `audit_log` i emitują
// `data_retention.changed.v1` (SQL 20261020162100) - druga karta tego
// najemcy odświeża listę przez szynę.
import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireAdmin } from "@/integrations/supabase/require-staff";
import type { Database } from "@/integrations/supabase/types";
import { publicFacingOrigin } from "@/lib/http/host";
import { newsletterUnsubscribeUrl } from "@/lib/newsletter/unsubscribeUrl";
import type { RpcCallable } from "@/lib/revenue/rpcCallable";
import { DATA_RETENTION_RULES, normalizeExtensionReason } from "./dataRetention";
import {
  parseDataRetentionNewsletterDue,
  parseNewsletterExclusionResult,
  type DataRetentionNewsletterDueDto,
  type NewsletterExclusionResultDto,
} from "./dataRetentionParse";
import {
  NEWSLETTER_SUNSET_COPY_SETTING_KEY,
  NewsletterSunsetCopyOverridesSchema,
  newsletterKeepUrl,
  parseNewsletterSunsetOverrides,
  type NewsletterSunsetCopyOverrides,
} from "./newsletterSunset";
import {
  mapDataRetentionError,
  mutation,
  readState,
  type DataRetentionMutation,
  type DataRetentionRead,
  type RpcError,
} from "./rpcResult";

function asRpc(client: unknown): RpcCallable {
  return client as RpcCallable;
}

const ISO = z.string().datetime({ offset: true });

/** Najwięcej pozycji listy „do wygaszenia" i wykluczonych (sufit RPC: 200). */
export const NEWSLETTER_SUNSET_DUE_LIMIT = 50;

// ── Lista „do wygaszenia" ───────────────────────────────────────────────────

export const getDataRetentionNewsletterDue = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .handler(async ({ context }): Promise<DataRetentionRead<DataRetentionNewsletterDueDto>> => {
    const { data, error } = await asRpc(context.supabase).rpc(
      "admin_data_retention_newsletter_due",
      { p_limit: NEWSLETTER_SUNSET_DUE_LIMIT },
    );
    return readState(error, () => parseDataRetentionNewsletterDue(data));
  });

// ── Wykluczenie adresu i jego cofnięcie ─────────────────────────────────────

/**
 * Powód 3-500 znaków po obcięciu brzegów (ten sam limit co przedłużenie
 * kontaktu CRM, RPC i CHECK tabeli `newsletter_sunset_exclusions`) - dłuższy
 * jest odrzucany, nie skracany.
 */
export const NewsletterExclusionSchema = z
  .object({
    subscriberId: z.string().uuid(),
    reason: z.string().refine((value) => normalizeExtensionReason(value) !== null, {
      message: "reason_length",
    }),
  })
  .strict();
export type NewsletterExclusionInput = z.infer<typeof NewsletterExclusionSchema>;

export const excludeNewsletterSubscriber = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .validator((input: unknown) => NewsletterExclusionSchema.parse(input))
  .handler(
    async ({ data, context }): Promise<DataRetentionMutation<NewsletterExclusionResultDto>> => {
      const { data: raw, error } = await asRpc(context.supabase).rpc(
        "admin_data_retention_newsletter_exclude",
        {
          p_subscriber_id: data.subscriberId,
          p_reason: normalizeExtensionReason(data.reason) ?? "",
        },
      );
      return mutation(raw, error, parseNewsletterExclusionResult);
    },
  );

export const includeNewsletterSubscriber = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .validator((input: unknown) => NewsletterExclusionSchema.parse(input))
  .handler(
    async ({ data, context }): Promise<DataRetentionMutation<NewsletterExclusionResultDto>> => {
      const { data: raw, error } = await asRpc(context.supabase).rpc(
        "admin_data_retention_newsletter_include",
        {
          p_subscriber_id: data.subscriberId,
          p_reason: normalizeExtensionReason(data.reason) ?? "",
        },
      );
      return mutation(raw, error, parseNewsletterExclusionResult);
    },
  );

// ── Treść prośby o potwierdzenie ────────────────────────────────────────────

export interface NewsletterSunsetCopyDto {
  overrides: NewsletterSunsetCopyOverrides;
  /** Token zapisu (CAS); `null` = najemca nie zapisał jeszcze treści. */
  updatedAt: string | null;
}

/**
 * Najemca z profilu sesji - ten sam, którego RLS `site_settings` wpuszcza do
 * zapisu (`current_tenant_id()`). Bez profilu: odmowa, nie zgadywanie.
 */
async function sessionTenant(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<{ tenantId: string } | { error: NonNullable<RpcError> }> {
  const { data, error } = await supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", userId)
    .maybeSingle();
  if (error) return { error };
  if (!data?.tenant_id) return { error: { message: "forbidden", code: "42501" } };
  return { tenantId: data.tenant_id };
}

/** Odczyt przerwany błędem przed zapytaniem właściwym (odmowa / awaria). */
function deniedRead<T>(error: NonNullable<RpcError>): DataRetentionRead<T> {
  return readState<T>(error, () => {
    throw new Error(error.message);
  });
}

export const getNewsletterSunsetCopy = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .handler(async ({ context }): Promise<DataRetentionRead<NewsletterSunsetCopyDto>> => {
    const tenant = await sessionTenant(context.supabase, context.userId);
    if ("error" in tenant) return deniedRead(tenant.error);
    const { data, error } = await context.supabase
      .from("site_settings")
      .select("value, updated_at")
      .eq("tenant_id", tenant.tenantId)
      .eq("key", NEWSLETTER_SUNSET_COPY_SETTING_KEY)
      .maybeSingle();
    return readState(error, () => ({
      overrides: parseNewsletterSunsetOverrides(data?.value ?? null),
      updatedAt: data?.updated_at ?? null,
    }));
  });

export const SaveNewsletterSunsetCopySchema = z
  .object({
    overrides: NewsletterSunsetCopyOverridesSchema,
    expectedUpdatedAt: ISO.nullable(),
  })
  .strict();
export type SaveNewsletterSunsetCopyInput = z.infer<typeof SaveNewsletterSunsetCopySchema>;

/** Konflikt zapisu (inna karta zapisała treść po odczycie tej) - kod panelu. */
const STALE: NonNullable<RpcError> = { message: "stale_write", code: "40001" };

/**
 * Zapis treści z tokenem CAS (`updated_at` wiersza): dwie karty edytujące
 * jednocześnie nie nadpisują się po cichu. Brak wiersza + token = ktoś
 * usunął treść po odczycie; wiersz + brak tokenu = ktoś zapisał pierwszy.
 * Historię zmian trzyma wyzwalacz `site_settings_revisions`.
 */
export const saveNewsletterSunsetCopy = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .validator((input: unknown) => SaveNewsletterSunsetCopySchema.parse(input))
  .handler(async ({ data, context }): Promise<DataRetentionMutation<NewsletterSunsetCopyDto>> => {
    const tenant = await sessionTenant(context.supabase, context.userId);
    if ("error" in tenant) return mapDataRetentionError(tenant.error);
    const stamp = new Date().toISOString();
    const value = data.overrides as unknown as Record<string, unknown>;
    if (data.expectedUpdatedAt === null) {
      const { data: row, error } = await context.supabase
        .from("site_settings")
        .insert({
          tenant_id: tenant.tenantId,
          key: NEWSLETTER_SUNSET_COPY_SETTING_KEY,
          value: value as never,
          updated_at: stamp,
          updated_by: context.userId,
        })
        .select("value, updated_at")
        .single();
      if (error) return mapDataRetentionError(error.code === "23505" ? STALE : error);
      return {
        ok: true,
        data: { overrides: parseNewsletterSunsetOverrides(row.value), updatedAt: row.updated_at },
      };
    }
    const { data: rows, error } = await context.supabase
      .from("site_settings")
      .update({ value: value as never, updated_at: stamp, updated_by: context.userId })
      .eq("tenant_id", tenant.tenantId)
      .eq("key", NEWSLETTER_SUNSET_COPY_SETTING_KEY)
      .eq("updated_at", data.expectedUpdatedAt)
      .select("value, updated_at");
    if (error) return mapDataRetentionError(error);
    const row = rows?.[0];
    if (!row) return mapDataRetentionError(STALE);
    return {
      ok: true,
      data: { overrides: parseNewsletterSunsetOverrides(row.value), updatedAt: row.updated_at },
    };
  });

// ── Podgląd maila ───────────────────────────────────────────────────────────

/** Imię w podglądzie - pokazuje zwrot do adresata tak, jak zobaczy go subskrybent. */
const PREVIEW_FIRST_NAME = "Anna";

export const PreviewNewsletterSunsetSchema = z
  .object({
    lang: z.enum(["pl", "en"]),
    overrides: NewsletterSunsetCopyOverridesSchema,
  })
  .strict();
export type PreviewNewsletterSunsetInput = z.infer<typeof PreviewNewsletterSunsetSchema>;

export interface NewsletterSunsetPreviewDto {
  subject: string;
  html: string;
  text: string;
}

/**
 * Podgląd TEGO SAMEGO renderu co wysyłka (treść niezapisana z edytora), na
 * originie serwisu najemcy. Link „Chcę dalej otrzymywać" i wypis w podglądzie
 * niosą atrapę tokenu - trasa publiczna odrzuca je jako nieważne.
 */
export const previewNewsletterSunsetEmail = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .validator((input: unknown) => PreviewNewsletterSunsetSchema.parse(input))
  .handler(async ({ data, context }): Promise<DataRetentionMutation<NewsletterSunsetPreviewDto>> => {
    const tenant = await sessionTenant(context.supabase, context.userId);
    if ("error" in tenant) return mapDataRetentionError(tenant.error);
    // Render (React Email) wyłącznie dynamicznie - poza chunkiem panelu.
    const { renderNewsletterSunsetEmail } = await import("./newsletterSunsetRender.server");
    const { data: row } = await context.supabase
      .from("tenants")
      .select("domain")
      .eq("id", tenant.tenantId)
      .maybeSingle();
    const origin = publicFacingOrigin(row?.domain ?? null);
    const rendered = await renderNewsletterSunsetEmail({
      lang: data.lang,
      overrides: data.overrides,
      firstName: PREVIEW_FIRST_NAME,
      deleteAfter: new Date(Date.now() + DATA_RETENTION_RULES.newsletterResponseDays * 86_400_000),
      keepUrl: newsletterKeepUrl(origin, "preview", data.lang),
      unsubscribeUrl: newsletterUnsubscribeUrl(origin, "preview"),
      siteUrl: origin,
    });
    return { ok: true, data: rendered };
  });

