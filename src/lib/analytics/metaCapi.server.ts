// Serwerowa połowa API konwersji Meta: przekaźnik zdarzeń przeglądarki.
//
// KOLEJNOŚĆ BRAMEK (każda zamyka wysyłkę po cichu - analityka nigdy nie
// wywraca strony):
//   1. Origin żądania = host tego serwisu i = host `event_source_url` każdego
//      zdarzenia - obca strona nie podszyje się pod nasz piksel z przeglądarki
//      swojego gościa.
//   2. Zgoda marketingowa z ciasteczka decyzji + klamra GPC.
//   3. User-Agent obecny (Meta wymaga go dla zdarzeń witryny).
//   4. Piksel z ustawień marketingu NAJEMCY tego hosta - cel wysyłki ustala
//      serwer, nigdy ładunek.
//   5. Dopiero potem skróty kluczy dopasowania (`metaCapiMatch.server.ts`):
//      e-mail i ID konta tylko z ważnej sesji konta tego najemcy.
// Uwierzytelnienie wobec Meta dokłada bramka konektora; token nie trafia do
// przeglądarki ani do kodu.
import { getRequest } from "@tanstack/react-start/server";
import { clientIpFromHeaders } from "@/lib/http/rateLimit";
import { readGpcCookie, readGpcFromHeaders } from "@/lib/consent/gpc";
import { resolveTenantIdForHost, resolveTrustedRequestHost } from "@/lib/server/tenant.server";
import {
  META_GRAPH_VERSION,
  buildMetaCapiPayload,
  hasMarketingConsentCookie,
  type MetaCapiBatch,
} from "./metaCapiContract";
import { resolveMetaMatchKeys, type MetaMatchDeps } from "./metaCapiMatch.server";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/meta_ads";
const TIMEOUT_MS = 4_000;
const PIXEL_CACHE_TTL_MS = 5 * 60_000;
const PIXEL_ID_RE = /^\d{5,20}$/;

export type MetaCapiRelayResult =
  | { status: "sent"; received: number }
  | { status: "skipped"; reason: MetaCapiSkipReason }
  | { status: "failed"; httpStatus: number };

export type MetaCapiSkipReason =
  "no_request" | "origin_mismatch" | "no_consent" | "no_user_agent" | "no_pixel" | "not_configured";

const pixelCache = new Map<string, { pixelId: string | null; at: number }>();

function hostnameOf(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value.includes("://") ? value : `https://${value}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Hosty, pod którymi ten serwer właśnie odpowiada (bezpośrednio i za proxy). */
export function requestHostnames(request: Request): Set<string> {
  const hosts = new Set<string>();
  const add = (value: string | null | undefined) => {
    const host = hostnameOf(value);
    if (host) hosts.add(host);
  };
  add(request.url);
  add(request.headers.get("host"));
  add(request.headers.get("x-forwarded-host")?.split(",")[0]?.trim());
  return hosts;
}

/** Wołający i każdy adres zdarzenia pochodzą z tego samego serwisu (Meta i X). */
export function isSameSiteSources(request: Request, sourceUrls: readonly string[]): boolean {
  const origin = hostnameOf(request.headers.get("origin"));
  if (!origin) return false;
  if (!requestHostnames(request).has(origin)) return false;
  return sourceUrls.every((url) => hostnameOf(url) === origin);
}

/** Bramka 1: wołający i każde zdarzenie pochodzą z tego samego serwisu. */
export function isSameSiteBatch(request: Request, batch: MetaCapiBatch): boolean {
  return isSameSiteSources(
    request,
    batch.events.map((event) => event.event_source_url),
  );
}

async function loadTenantPixelId(tenantId: string, now: number): Promise<string | null> {
  const cached = pixelCache.get(tenantId);
  if (cached && now - cached.at < PIXEL_CACHE_TTL_MS) return cached.pixelId;
  let pixelId: string | null = null;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("site_settings")
      .select("value")
      .eq("tenant_id", tenantId)
      .eq("key", "marketing")
      .maybeSingle();
    if (error) throw new Error(error.message);
    const raw = (data?.value ?? null) as { meta_pixel_id?: unknown } | null;
    const candidate = typeof raw?.meta_pixel_id === "string" ? raw.meta_pixel_id.trim() : "";
    pixelId = PIXEL_ID_RE.test(candidate) ? candidate : null;
  } catch (error) {
    console.error("Meta CAPI: marketing settings unreadable - events not sent", error);
    return null;
  }
  pixelCache.set(tenantId, { pixelId, at: now });
  return pixelId;
}

/** Tylko testy. */
export function resetMetaCapiCacheForTests(): void {
  pixelCache.clear();
}

export async function relayMetaCapiBatch(
  batch: MetaCapiBatch,
  request: Request | null = safeRequest(),
  fetcher: typeof fetch = fetch,
  now: number = Date.now(),
  matchDeps?: MetaMatchDeps,
): Promise<MetaCapiRelayResult> {
  if (!request) return { status: "skipped", reason: "no_request" };
  if (!isSameSiteBatch(request, batch)) return { status: "skipped", reason: "origin_mismatch" };

  const headers = request.headers;
  const gpcActive = readGpcFromHeaders(headers).active || readGpcCookie(headers.get("cookie"));
  if (!hasMarketingConsentCookie(headers.get("cookie"), gpcActive)) {
    return { status: "skipped", reason: "no_consent" };
  }
  const userAgent = headers.get("user-agent")?.trim().slice(0, 512) ?? "";
  if (!userAgent) return { status: "skipped", reason: "no_user_agent" };

  const lovableKey = process.env["LOVABLE_API_KEY"];
  const connectionKey = process.env["META_ADS_API_KEY"];
  if (!lovableKey || !connectionKey) return { status: "skipped", reason: "not_configured" };

  const host = (await resolveTrustedRequestHost(request).catch(() => null)) ?? headers.get("host");
  const tenantId = await resolveTenantIdForHost(host).catch(() => null);
  if (!tenantId) return { status: "skipped", reason: "no_pixel" };
  const pixelId = await loadTenantPixelId(tenantId, now);
  if (!pixelId) return { status: "skipped", reason: "no_pixel" };

  const ip = clientIpFromHeaders(headers);
  const testEventCode = process.env["META_CAPI_TEST_EVENT_CODE"]?.trim();
  // Klucze dopasowania (skróty) - dopiero PO bramkach zgody, pochodzenia i piksela.
  const match = await resolveMetaMatchKeys(headers, tenantId, matchDeps).catch(() => ({}));
  const payload = buildMetaCapiPayload(batch, {
    clientIp: ip && ip !== "unknown" ? ip : null,
    userAgent,
    nowS: Math.floor(now / 1000),
    match,
    ...(testEventCode ? { testEventCode } : {}),
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetcher(`${GATEWAY_URL}/${META_GRAPH_VERSION}/${pixelId}/events`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": connectionKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      redirect: "manual",
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.error(`Meta CAPI: request failed [${response.status}]: ${body.slice(0, 500)}`);
      return { status: "failed", httpStatus: response.status };
    }
    const parsed = (await response.json().catch(() => null)) as {
      events_received?: unknown;
    } | null;
    const received = typeof parsed?.events_received === "number" ? parsed.events_received : 0;
    return { status: "sent", received };
  } catch (error) {
    console.error("Meta CAPI: request error", error);
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
