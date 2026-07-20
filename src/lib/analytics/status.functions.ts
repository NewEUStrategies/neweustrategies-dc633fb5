/**
 * Aggregate status for the /admin/analytics dashboard.
 * Reports which integrations (GSC, GA4, Web Vitals) are configured.
 * Never returns secret values.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

interface SelectResultRow {
  data: unknown;
  error: { message: string } | null;
}
interface SelectBuilder {
  eq: (
    col: string,
    val: string,
  ) => Promise<SelectResultRow> & {
    maybeSingle?: () => Promise<SelectResultRow>;
  };
  maybeSingle?: () => Promise<SelectResultRow>;
}
interface GatewayCtx {
  supabase: {
    from: (t: string) => {
      select: (c: string) => SelectBuilder;
    };
  };
  userId: string;
}

async function requireAdmin(context: GatewayCtx): Promise<void> {
  // Tenant-scoped: has_role() filters by current_tenant_id().
  const { data: isAdmin, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!isAdmin) {
    throw new Error("Forbidden: admin role required");
  }
}

interface StoredAnalytics {
  ga4_enabled?: boolean;
  ga4_property_id?: string;
  ga4_measurement_id?: string;
}

async function readAnalyticsSettings(context: GatewayCtx): Promise<StoredAnalytics> {
  try {
    const builder = context.supabase.from("site_settings").select("value");
    const res = await builder.eq("key", "analytics");
    if (res.error) return {};
    const rows = (res.data ?? []) as Array<{ value: StoredAnalytics | null }>;
    return rows[0]?.value ?? {};
  } catch {
    return {};
  }
}

export type Ga4Mode = "service_account" | "oauth_refresh" | "measurement_protocol" | "embed" | null;

export interface AnalyticsStatus {
  gsc: { configured: boolean };
  ga4: {
    // True gdy przynajmniej jeden tryb odczytu raportów jest gotowy
    // (service_account lub oauth_refresh) + property id.
    configured: boolean;
    // Zewnętrzny "kill switch" wymuszony przez admina (Odłącz w UI).
    enabled: boolean;
    // Który tryb jest aktywny do pobierania raportów Data API.
    activeMode: Ga4Mode;
    hasServiceAccount: boolean;
    hasPropertyId: boolean;
    hasOauthRefresh: boolean;
    hasOauthClient: boolean;
    hasMeasurementProtocol: boolean;
    hasMeasurementId: boolean;
    hasEmbedUrl: boolean;
    serviceAccountEmail: string | null;
    propertyId: string | null;
    measurementId: string | null;
    embedUrl: string | null;
    // Podpowiedzi UX - czego brakuje po stronie sekretów projektu.
    missingSecrets: string[];
  };
  vitals: { configured: boolean };
}

export const getAnalyticsStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AnalyticsStatus> => {
    const ctx = context as unknown as GatewayCtx;
    await requireAdmin(ctx);

    const stored = await readAnalyticsSettings(ctx);
    const ga4Enabled = stored.ga4_enabled !== false;

    const gscOk = Boolean(process.env.LOVABLE_API_KEY && process.env.GOOGLE_SEARCH_CONSOLE_API_KEY);

    // Service Account
    const saRaw = process.env.GA4_SERVICE_ACCOUNT_JSON ?? "";
    let saEmail: string | null = null;
    let saOk = false;
    if (saRaw) {
      try {
        const parsed = JSON.parse(saRaw) as { client_email?: string; private_key?: string };
        if (parsed.client_email && parsed.private_key) {
          saOk = true;
          saEmail = parsed.client_email;
        }
      } catch {
        saOk = false;
      }
    }

    // OAuth 2.0 refresh token
    const oauthClientOk = Boolean(
      process.env.GA4_OAUTH_CLIENT_ID && process.env.GA4_OAUTH_CLIENT_SECRET,
    );
    const oauthRefreshOk = Boolean(process.env.GA4_OAUTH_REFRESH_TOKEN);

    // Measurement Protocol (send events) - fall back to stored measurement id.
    const measurementId =
      process.env.GA4_MEASUREMENT_ID ?? (stored.ga4_measurement_id?.trim() || null);
    const apiSecretOk = Boolean(process.env.GA4_API_SECRET);
    const mpOk = Boolean(measurementId && apiSecretOk);

    // Embed (Looker Studio / iframe)
    const embedUrl = process.env.GA4_EMBED_URL ?? null;

    // Property ID: env pierwsze, potem konfiguracja z bazy.
    const propertyId = process.env.GA4_PROPERTY_ID ?? (stored.ga4_property_id?.trim() || null);
    const hasProperty = Boolean(propertyId);

    let activeMode: Ga4Mode = null;
    if (ga4Enabled) {
      if (saOk && hasProperty) activeMode = "service_account";
      else if (oauthClientOk && oauthRefreshOk && hasProperty) activeMode = "oauth_refresh";
      else if (embedUrl) activeMode = "embed";
      else if (mpOk) activeMode = "measurement_protocol";
    }

    const missingSecrets: string[] = [];
    if (!hasProperty) missingSecrets.push("GA4_PROPERTY_ID");
    if (!saOk && !(oauthClientOk && oauthRefreshOk)) {
      missingSecrets.push("GA4_SERVICE_ACCOUNT_JSON");
    }

    const readyToRead = (saOk || (oauthClientOk && oauthRefreshOk)) && hasProperty;
    return {
      gsc: { configured: gscOk },
      ga4: {
        configured: ga4Enabled && readyToRead,
        enabled: ga4Enabled,
        activeMode,
        hasServiceAccount: saOk,
        hasPropertyId: hasProperty,
        hasOauthRefresh: oauthRefreshOk,
        hasOauthClient: oauthClientOk,
        hasMeasurementProtocol: mpOk,
        hasMeasurementId: Boolean(measurementId),
        hasEmbedUrl: Boolean(embedUrl),
        serviceAccountEmail: saEmail,
        propertyId,
        measurementId,
        embedUrl,
        missingSecrets,
      },
      vitals: { configured: true },
    };
  });
