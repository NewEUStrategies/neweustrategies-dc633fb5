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
  eq: (col: string, val: string) => Promise<SelectResultRow> & {
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
  const { data: roles, error } = await context.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", context.userId);
  if (error) throw new Error(error.message);
  const rows = (roles ?? []) as Array<{ role: string }>;
  if (!rows.some((r) => r.role === "admin")) {
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
  };
  vitals: { configured: boolean };
}

export const getAnalyticsStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AnalyticsStatus> => {
    await requireAdmin(context as unknown as GatewayCtx);

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

    // Measurement Protocol (send events)
    const measurementId = process.env.GA4_MEASUREMENT_ID ?? null;
    const apiSecretOk = Boolean(process.env.GA4_API_SECRET);
    const mpOk = Boolean(measurementId && apiSecretOk);

    // Embed (Looker Studio / iframe)
    const embedUrl = process.env.GA4_EMBED_URL ?? null;

    const propertyId = process.env.GA4_PROPERTY_ID ?? null;
    const hasProperty = Boolean(propertyId);

    let activeMode: Ga4Mode = null;
    if (saOk && hasProperty) activeMode = "service_account";
    else if (oauthClientOk && oauthRefreshOk && hasProperty) activeMode = "oauth_refresh";
    else if (embedUrl) activeMode = "embed";
    else if (mpOk) activeMode = "measurement_protocol";

    return {
      gsc: { configured: gscOk },
      ga4: {
        configured: Boolean(
          (saOk || (oauthClientOk && oauthRefreshOk)) && hasProperty,
        ),
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
      },
      vitals: { configured: true },
    };
  });
