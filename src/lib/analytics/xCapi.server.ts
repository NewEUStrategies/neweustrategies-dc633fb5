// Serwerowa połowa X Conversion API: przekaźnik zdarzeń piksela X.
//
// KOLEJNOŚĆ BRAMEK (każda zamyka wysyłkę po cichu - analityka nigdy nie
// wywraca strony):
//   1. Origin żądania = host tego serwisu = host `event_source_url` każdego
//      zdarzenia (obca strona nie podszyje się pod nasz piksel).
//   2. Zgoda marketingowa z ciasteczka decyzji + klamra GPC.
//   3. User-Agent obecny (para IP + User-Agent to identyfikator zdarzenia).
//   4. Piksel i lista zdarzeń z ustawień marketingu NAJEMCY tego hosta - cel
//      wysyłki ustala serwer; zdarzenie spoza panelu nie wychodzi.
//   5. Token `X_PIXEL_TOKEN` tylko z sekretów serwera, w nagłówku
//      `X-Pixel-Token`; nie trafia do przeglądarki ani do logów.
// Bez danych kontaktowych: identyfikatory to `twclid`, IP i User-Agent.
import { getRequest } from "@tanstack/react-start/server";
import { clientIpFromHeaders } from "@/lib/http/rateLimit";
import { readGpcCookie, readGpcFromHeaders } from "@/lib/consent/gpc";
import { resolveTenantIdForHost, resolveTrustedRequestHost } from "@/lib/server/tenant.server";
import { hasMarketingConsentCookie } from "./metaCapiContract";
import { isSameSiteSources } from "./metaCapi.server";
import { MarketingConfigSchema } from "./config";
import { X_GOALS } from "./xGoals";
import { X_CAPI_API_VERSION, buildXCapiPayload, type XCapiBatch } from "./xCapiContract";

const X_API_ORIGIN = "https://ads-api.x.com";
const TIMEOUT_MS = 4_000;
const SETTINGS_CACHE_TTL_MS = 5 * 60_000;

export type XCapiSkipReason =
  | "no_request"
  | "origin_mismatch"
  | "no_consent"
  | "no_user_agent"
  | "not_configured"
  | "no_pixel"
  | "no_events";

export type XCapiRelayResult =
  | { status: "sent"; sent: number }
  | { status: "skipped"; reason: XCapiSkipReason }
  | { status: "failed"; httpStatus: number };

interface TenantXSettings {
  pixelId: string;
  eventIds: ReadonlySet<string>;
}

const settingsCache = new Map<string, { value: TenantXSettings | null; at: number }>();

async function loadTenantXSettings(tenantId: string, now: number): Promise<TenantXSettings | null> {
  const cached = settingsCache.get(tenantId);
  if (cached && now - cached.at < SETTINGS_CACHE_TTL_MS) return cached.value;
  let value: TenantXSettings | null = null;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("site_settings")
      .select("value")
      .eq("tenant_id", tenantId)
      .eq("key", "marketing")
      .maybeSingle();
    if (error) throw new Error(error.message);
    const config = MarketingConfigSchema.parse(data?.value ?? {});
    if (config.x_pixel_id) {
      const prefix = `tw-${config.x_pixel_id}-`;
      const eventIds = new Set<string>();
      for (const goal of X_GOALS) {
        const id = config.x_conversions[goal];
        // Zdarzenie musi należeć do skonfigurowanego piksela.
        if (id && id.startsWith(prefix)) eventIds.add(id);
      }
      value = { pixelId: config.x_pixel_id, eventIds };
    }
  } catch (error) {
    console.error("X CAPI: marketing settings unreadable - events not sent", error);
    return null;
  }
  settingsCache.set(tenantId, { value, at: now });
  return value;
}

/** Tylko testy. */
export function resetXCapiCacheForTests(): void {
  settingsCache.clear();
}

export interface XCapiDeps {
  /** Ustawienia X najemcy hosta; domyślnie z `site_settings`. */
  tenantSettings?: (request: Request, now: number) => Promise<TenantXSettings | null>;
}

async function defaultTenantSettings(
  request: Request,
  now: number,
): Promise<TenantXSettings | null> {
  const host =
    (await resolveTrustedRequestHost(request).catch(() => null)) ?? request.headers.get("host");
  const tenantId = await resolveTenantIdForHost(host).catch(() => null);
  return tenantId ? loadTenantXSettings(tenantId, now) : null;
}

export async function relayXCapiBatch(
  batch: XCapiBatch,
  request: Request | null = safeRequest(),
  fetcher: typeof fetch = fetch,
  now: number = Date.now(),
  deps: XCapiDeps = {},
): Promise<XCapiRelayResult> {
  if (!request) return { status: "skipped", reason: "no_request" };
  if (
    !isSameSiteSources(
      request,
      batch.events.map((event) => event.event_source_url),
    )
  ) {
    return { status: "skipped", reason: "origin_mismatch" };
  }
  const headers = request.headers;
  const gpcActive = readGpcFromHeaders(headers).active || readGpcCookie(headers.get("cookie"));
  if (!hasMarketingConsentCookie(headers.get("cookie"), gpcActive)) {
    return { status: "skipped", reason: "no_consent" };
  }
  const userAgent = headers.get("user-agent")?.trim().slice(0, 512) ?? "";
  if (!userAgent) return { status: "skipped", reason: "no_user_agent" };

  const token = process.env["X_PIXEL_TOKEN"]?.trim();
  if (!token) return { status: "skipped", reason: "not_configured" };

  const settings = await (deps.tenantSettings ?? defaultTenantSettings)(request, now);
  if (!settings) return { status: "skipped", reason: "no_pixel" };

  const ip = clientIpFromHeaders(headers);
  const payload = buildXCapiPayload(batch, {
    clientIp: ip && ip !== "unknown" ? ip : null,
    userAgent,
    nowMs: now,
    allowedEventIds: settings.eventIds,
  });
  if (payload.conversions.length === 0) return { status: "skipped", reason: "no_events" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetcher(
      `${X_API_ORIGIN}/${X_CAPI_API_VERSION}/measurement/conversions/${settings.pixelId}`,
      {
        method: "POST",
        headers: { "X-Pixel-Token": token, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        redirect: "manual",
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.error(`X CAPI: request failed [${response.status}]: ${body.slice(0, 500)}`);
      return { status: "failed", httpStatus: response.status };
    }
    return { status: "sent", sent: payload.conversions.length };
  } catch (error) {
    console.error("X CAPI: request error", error);
    return { status: "failed", httpStatus: 0 };
  } finally {
    clearTimeout(timer);
  }
}

function safeRequest(): Request | null {
  try {
    return getRequest() ?? null;
  } catch {
    return null;
  }
}
