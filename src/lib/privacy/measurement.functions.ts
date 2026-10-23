// Funkcje serwerowe panelu newslettera - pomiar otwarć i kliknięć tylko za
// osobną zgodą (I9d-Y2, I9d-Y2b):
//   * „Poproś o zgodę na pomiar" - podgląd liczb i start z potwierdzoną
//     liczbą, treść maila PL/EN (nadpisania z panelu) i jej podgląd;
//   * mianownik wskaźników kampanii (odbiorcy mierzeni).
// Oznaczeń admina „mój tekst obejmuje pomiar" (wariant (a)) nie ma od
// I9d-Y2b: treść zgody na newsletter nie daje pomiaru, a RPC oznaczeń
// usunęła migracja 20261023090000.
//
// Role z dokładnych bramek SQL (najemca i użytkownik WYŁĄCZNIE z sesji):
//   * prośba (podgląd, start, treść maila) - `requireAdmin`
//     + `_data_retention_admin_tenant()` w SQL (admin albo super_admin; start
//     wysyła mail do całej listy);
//   * mianownik kampanii - `requireAdminEditor` (redaktor edytuje kampanie,
//     więc widzi mianownik; SQL: admin/editor).
// Nazwy RPC i tabel są LITERAŁAMI w miejscu wywołania (bramka
// `generate:ts-sql-contract`); RPC nie ma jeszcze w wygenerowanych typach,
// więc klient jest rzutowany na kształt wywołania (`RpcCallable`).
import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireAdmin, requireAdminEditor } from "@/integrations/supabase/require-staff";
import type { Database } from "@/integrations/supabase/types";
import { publicFacingOrigin } from "@/lib/http/host";
import { newsletterUnsubscribeUrl } from "@/lib/newsletter/unsubscribeUrl";
import type { RpcCallable } from "@/lib/revenue/rpcCallable";
import { newsletterMeasurementUrl } from "./measurement";
import {
  parseCampaignMeasurement,
  parseNewsletterMeasurementPreview,
  parseNewsletterMeasurementRequest,
  type CampaignMeasurementDto,
  type NewsletterMeasurementPreviewDto,
  type NewsletterMeasurementRequestDto,
} from "./measurementParse";
import {
  NEWSLETTER_MEASUREMENT_COPY_SETTING_KEY,
  NewsletterMeasurementCopyOverridesSchema,
  parseNewsletterMeasurementOverrides,
  type NewsletterMeasurementCopyOverrides,
} from "./measurementReconfirm";
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

// ── „Poproś o zgodę na pomiar" ──────────────────────────────────────────────

export const getNewsletterMeasurementPreview = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .handler(async ({ context }): Promise<DataRetentionRead<NewsletterMeasurementPreviewDto>> => {
    const { data, error } = await asRpc(context.supabase).rpc(
      "admin_newsletter_measurement_preview",
    );
    return readState(error, () => parseNewsletterMeasurementPreview(data));
  });

/**
 * Start z liczbą z podglądu, którą admin potwierdził: więcej kandydatów niż
 * potwierdzono = `conflict` (40001 `stale_preview`) - nigdy nie wysyłamy do
 * większej grupy, niż zatwierdzono. Liczba to kandydaci SPOZA listy wyłączeń.
 */
export const RequestNewsletterMeasurementSchema = z
  .object({ expected: z.number().int().min(0).max(10_000_000) })
  .strict();
export type RequestNewsletterMeasurementInput = z.infer<typeof RequestNewsletterMeasurementSchema>;

export const requestNewsletterMeasurement = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .validator((input: unknown) => RequestNewsletterMeasurementSchema.parse(input))
  .handler(
    async ({ data, context }): Promise<DataRetentionMutation<NewsletterMeasurementRequestDto>> => {
      const { data: raw, error } = await asRpc(context.supabase).rpc(
        "admin_newsletter_measurement_request",
        { p_expected: data.expected },
      );
      return mutation(raw, error, parseNewsletterMeasurementRequest);
    },
  );

// ── Mianownik wskaźników kampanii ───────────────────────────────────────────

export const getCampaignMeasurement = createServerFn({ method: "POST" })
  .middleware([requireAdminEditor])
  .validator((input: unknown) => z.object({ campaignId: z.string().uuid() }).strict().parse(input))
  .handler(async ({ data, context }): Promise<DataRetentionRead<CampaignMeasurementDto>> => {
    const { data: raw, error } = await asRpc(context.supabase).rpc(
      "admin_newsletter_campaign_measurement",
      { p_campaign: data.campaignId },
    );
    return readState(error, () => parseCampaignMeasurement(raw));
  });

// ── Treść maila prośby ──────────────────────────────────────────────────────

export interface NewsletterMeasurementCopyDto {
  overrides: NewsletterMeasurementCopyOverrides;
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

export const getNewsletterMeasurementCopy = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .handler(async ({ context }): Promise<DataRetentionRead<NewsletterMeasurementCopyDto>> => {
    const tenant = await sessionTenant(context.supabase, context.userId);
    if ("error" in tenant) {
      const failure = tenant.error;
      return readState<NewsletterMeasurementCopyDto>(failure, () => {
        throw new Error(failure.message);
      });
    }
    const { data, error } = await context.supabase
      .from("site_settings")
      .select("value, updated_at")
      .eq("tenant_id", tenant.tenantId)
      .eq("key", NEWSLETTER_MEASUREMENT_COPY_SETTING_KEY)
      .maybeSingle();
    return readState(error, () => ({
      overrides: parseNewsletterMeasurementOverrides(data?.value ?? null),
      updatedAt: data?.updated_at ?? null,
    }));
  });

export const SaveNewsletterMeasurementCopySchema = z
  .object({
    overrides: NewsletterMeasurementCopyOverridesSchema,
    expectedUpdatedAt: ISO.nullable(),
  })
  .strict();
export type SaveNewsletterMeasurementCopyInput = z.infer<
  typeof SaveNewsletterMeasurementCopySchema
>;

/** Konflikt zapisu (inna karta zapisała treść po odczycie tej) - kod panelu. */
const STALE: NonNullable<RpcError> = { message: "stale_write", code: "40001" };

/**
 * Zapis treści z tokenem CAS (`updated_at` wiersza) - jak treść prośby
 * wygaszania: dwie karty nie nadpisują się po cichu, historię zmian trzyma
 * wyzwalacz `site_settings_revisions`.
 */
export const saveNewsletterMeasurementCopy = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .validator((input: unknown) => SaveNewsletterMeasurementCopySchema.parse(input))
  .handler(
    async ({ data, context }): Promise<DataRetentionMutation<NewsletterMeasurementCopyDto>> => {
      const tenant = await sessionTenant(context.supabase, context.userId);
      if ("error" in tenant) return mapDataRetentionError(tenant.error);
      const stamp = new Date().toISOString();
      const value = data.overrides;
      if (data.expectedUpdatedAt === null) {
        const { data: row, error } = await context.supabase
          .from("site_settings")
          .insert({
            tenant_id: tenant.tenantId,
            key: NEWSLETTER_MEASUREMENT_COPY_SETTING_KEY,
            value,
            updated_at: stamp,
            updated_by: context.userId,
          })
          .select("value, updated_at")
          .single();
        if (error) return mapDataRetentionError(error.code === "23505" ? STALE : error);
        return {
          ok: true,
          data: {
            overrides: parseNewsletterMeasurementOverrides(row.value),
            updatedAt: row.updated_at,
          },
        };
      }
      const { data: rows, error } = await context.supabase
        .from("site_settings")
        .update({ value, updated_at: stamp, updated_by: context.userId })
        .eq("tenant_id", tenant.tenantId)
        .eq("key", NEWSLETTER_MEASUREMENT_COPY_SETTING_KEY)
        .eq("updated_at", data.expectedUpdatedAt)
        .select("value, updated_at");
      if (error) return mapDataRetentionError(error);
      const row = rows?.[0];
      if (!row) return mapDataRetentionError(STALE);
      return {
        ok: true,
        data: {
          overrides: parseNewsletterMeasurementOverrides(row.value),
          updatedAt: row.updated_at,
        },
      };
    },
  );

/** Imię w podglądzie - zwrot do adresata tak, jak zobaczy go subskrybent. */
const PREVIEW_FIRST_NAME = "Anna";

export const PreviewNewsletterMeasurementSchema = z
  .object({
    lang: z.enum(["pl", "en"]),
    overrides: NewsletterMeasurementCopyOverridesSchema,
  })
  .strict();
export type PreviewNewsletterMeasurementInput = z.infer<typeof PreviewNewsletterMeasurementSchema>;

export interface NewsletterMeasurementPreviewMailDto {
  subject: string;
  html: string;
  text: string;
}

/**
 * Podgląd TEGO SAMEGO renderu co wysyłka (treść niezapisana z edytora), na
 * originie serwisu najemcy. Link zgody i wypis niosą atrapę tokenu - trasa
 * publiczna odrzuca je jako nieważne (podgląd niczego nie zapisze).
 */
export const previewNewsletterMeasurementEmail = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .validator((input: unknown) => PreviewNewsletterMeasurementSchema.parse(input))
  .handler(
    async ({
      data,
      context,
    }): Promise<DataRetentionMutation<NewsletterMeasurementPreviewMailDto>> => {
      const tenant = await sessionTenant(context.supabase, context.userId);
      if ("error" in tenant) return mapDataRetentionError(tenant.error);
      // Render (React Email) wyłącznie dynamicznie - poza chunkiem panelu.
      const { renderMeasurementReconfirmEmail } =
        await import("./measurementReconfirmRender.server");
      const { data: row } = await context.supabase
        .from("tenants")
        .select("domain")
        .eq("id", tenant.tenantId)
        .maybeSingle();
      const origin = publicFacingOrigin(row?.domain ?? null);
      const rendered = await renderMeasurementReconfirmEmail({
        lang: data.lang,
        overrides: data.overrides,
        firstName: PREVIEW_FIRST_NAME,
        confirmUrl: newsletterMeasurementUrl(origin, "preview", data.lang),
        unsubscribeUrl: newsletterUnsubscribeUrl(origin, "preview"),
        siteUrl: origin,
      });
      return { ok: true, data: rendered };
    },
  );
