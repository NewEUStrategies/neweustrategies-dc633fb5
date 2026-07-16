/**
 * Server functions for Google Analytics 4 Data API + Measurement Protocol.
 *
 * Cztery obsługiwane tryby uwierzytelnienia (dowolny do wyboru):
 *
 * 1) Service Account
 *    - GA4_SERVICE_ACCOUNT_JSON (cała treść pliku)
 *    - GA4_PROPERTY_ID
 *
 * 2) OAuth 2.0 z refresh tokenem (Google Cloud "Desktop app" client)
 *    - GA4_OAUTH_CLIENT_ID
 *    - GA4_OAUTH_CLIENT_SECRET
 *    - GA4_OAUTH_REFRESH_TOKEN
 *    - GA4_PROPERTY_ID
 *
 * 3) Measurement Protocol (wysyłka eventów server-side)
 *    - GA4_MEASUREMENT_ID  (np. G-XXXXXXX)
 *    - GA4_API_SECRET      (Admin → Data Streams → Measurement Protocol API secrets)
 *
 * 4) Embed (Looker Studio / GA4 iframe) - patrz status.functions.ts (GA4_EMBED_URL).
 *
 * Priorytet dla raportów Data API: Service Account → OAuth refresh token.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createSign } from "node:crypto";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

interface GatewayCtx {
  supabase: {
    from: (t: string) => {
      select: (c: string) => {
        eq: (
          col: string,
          val: string,
        ) => Promise<{ data: unknown; error: { message: string } | null }>;
      };
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
async function readStoredAnalytics(ctx: GatewayCtx): Promise<StoredAnalytics> {
  try {
    const res = await ctx.supabase.from("site_settings").select("value").eq("key", "analytics");
    if (res.error) return {};
    const rows = (res.data ?? []) as Array<{ value: StoredAnalytics | null }>;
    return rows[0]?.value ?? {};
  } catch {
    return {};
  }
}

interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

function readServiceAccount(): ServiceAccount | null {
  const raw = process.env.GA4_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ServiceAccount;
    if (!parsed.client_email || !parsed.private_key) return null;
    return parsed;
  } catch {
    return null;
  }
}

function b64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf.toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

// In-memory access-token cache per-worker per-source, short-lived - bearer
// tokens Google zwraca na 1h; odświeżamy 60s wcześniej.
let saTokenCache: { token: string; exp: number } | null = null;
let oauthTokenCache: { token: string; exp: number } | null = null;

async function getServiceAccountToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (saTokenCache && saTokenCache.exp - 60 > now) return saTokenCache.token;

  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/analytics.readonly",
    aud: sa.token_uri ?? "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };
  const signInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claim))}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signInput);
  signer.end();
  const key = sa.private_key.replace(/\\n/g, "\n");
  const signature = b64url(signer.sign(key));
  const jwt = `${signInput}.${signature}`;

  const res = await fetch(sa.token_uri ?? "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }).toString(),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`GA4 SA token exchange ${res.status}: ${body.slice(0, 400)}`);
  const parsed = JSON.parse(body) as { access_token: string; expires_in: number };
  saTokenCache = { token: parsed.access_token, exp: now + parsed.expires_in };
  return parsed.access_token;
}

async function getOauthAccessToken(): Promise<string | null> {
  const clientId = process.env.GA4_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GA4_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GA4_OAUTH_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) return null;

  const now = Math.floor(Date.now() / 1000);
  if (oauthTokenCache && oauthTokenCache.exp - 60 > now) return oauthTokenCache.token;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }).toString(),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`GA4 OAuth refresh ${res.status}: ${body.slice(0, 400)}`);
  const parsed = JSON.parse(body) as { access_token: string; expires_in: number };
  oauthTokenCache = { token: parsed.access_token, exp: now + parsed.expires_in };
  return parsed.access_token;
}

/** Unified access-token resolver: SA jeśli jest, w przeciwnym razie OAuth refresh. */
async function resolveAccessToken(): Promise<{ token: string; source: "sa" | "oauth" } | null> {
  const sa = readServiceAccount();
  if (sa) return { token: await getServiceAccountToken(sa), source: "sa" };
  const oauth = await getOauthAccessToken();
  if (oauth) return { token: oauth, source: "oauth" };
  return null;
}

// ---------- Report ----------

const reportInput = z.object({
  startDate: z.string().default("28daysAgo"),
  endDate: z.string().default("today"),
  metrics: z
    .array(z.string().min(1))
    .min(1)
    .default(["sessions", "activeUsers", "screenPageViews"]),
  dimensions: z.array(z.string().min(1)).max(3).default(["date"]),
  limit: z.number().int().min(1).max(1000).default(100),
});

export interface Ga4Row {
  dims: string[];
  metrics: string[];
}

export interface Ga4Report {
  configured: boolean;
  propertyId?: string;
  dimensionHeaders: string[];
  metricHeaders: string[];
  rows: Ga4Row[];
  totals: string[];
  error?: string;
}

export const runGa4Report = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => reportInput.parse(i ?? {}))
  .handler(async ({ data, context }): Promise<Ga4Report> => {
    const ctx = context as unknown as GatewayCtx;
    await requireAdmin(ctx);

    const stored = await readStoredAnalytics(ctx);
    const propertyId = process.env.GA4_PROPERTY_ID ?? (stored.ga4_property_id?.trim() || undefined);
    const emptyReport: Ga4Report = {
      configured: false,
      dimensionHeaders: [],
      metricHeaders: [],
      rows: [],
      totals: [],
    };
    if (stored.ga4_enabled === false)
      return { ...emptyReport, error: "GA4 wyłączone przez administratora" };
    if (!propertyId) return emptyReport;
    const auth = await resolveAccessToken();
    if (!auth) return emptyReport;

    try {
      const token = auth.token;

      const res = await fetch(
        `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            dateRanges: [{ startDate: data.startDate, endDate: data.endDate }],
            dimensions: data.dimensions.map((name) => ({ name })),
            metrics: data.metrics.map((name) => ({ name })),
            limit: String(data.limit),
          }),
        },
      );
      const text = await res.text();
      if (!res.ok) {
        return {
          ...emptyReport,
          configured: true,
          propertyId,
          error: `GA4 ${res.status}: ${text.slice(0, 300)}`,
        };
      }
      const parsed = JSON.parse(text) as {
        dimensionHeaders?: Array<{ name: string }>;
        metricHeaders?: Array<{ name: string }>;
        rows?: Array<{
          dimensionValues?: Array<{ value?: string }>;
          metricValues?: Array<{ value?: string }>;
        }>;
        totals?: Array<{ metricValues?: Array<{ value?: string }> }>;
      };
      const dimHeaders = (parsed.dimensionHeaders ?? []).map((h) => h.name);
      const metHeaders = (parsed.metricHeaders ?? []).map((h) => h.name);
      const rows: Ga4Row[] = (parsed.rows ?? []).map((r) => ({
        dims: (r.dimensionValues ?? []).map((v) => v.value ?? ""),
        metrics: (r.metricValues ?? []).map((v) => v.value ?? "0"),
      }));
      const totals = (parsed.totals?.[0]?.metricValues ?? []).map((v) => v.value ?? "0");
      return {
        configured: true,
        propertyId,
        dimensionHeaders: dimHeaders,
        metricHeaders: metHeaders,
        rows,
        totals,
      };
    } catch (e) {
      return {
        ...emptyReport,
        configured: true,
        propertyId,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  });

// ---------- Measurement Protocol ----------

const mpInput = z.object({
  clientId: z.string().min(1).default("admin-test"),
  eventName: z.string().min(1).max(40).default("admin_test_event"),
  params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
  debug: z.boolean().default(false),
});

export interface Ga4MpResult {
  ok: boolean;
  configured: boolean;
  debug?: string;
  error?: string;
}

/**
 * Wysyła event GA4 przez Measurement Protocol.
 * Wymaga sekretów: GA4_MEASUREMENT_ID + GA4_API_SECRET.
 * Przy debug=true używa endpointu /debug/mp/collect i zwraca walidację od Google.
 */
export const sendGa4Event = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => mpInput.parse(i ?? {}))
  .handler(async ({ data, context }): Promise<Ga4MpResult> => {
    await requireAdmin(context as unknown as GatewayCtx);

    const stored = await readStoredAnalytics(context as unknown as GatewayCtx);
    const measurementId =
      process.env.GA4_MEASUREMENT_ID?.trim() || stored.ga4_measurement_id?.trim() || "";
    const apiSecret = process.env.GA4_API_SECRET;
    if (!measurementId || !apiSecret) {
      return {
        ok: false,
        configured: false,
        error: "Brak Measurement ID (ustawienia analityki) lub GA4_API_SECRET (sekret)",
      };
    }

    const path = data.debug ? "/debug/mp/collect" : "/mp/collect";
    const url = `https://www.google-analytics.com${path}?measurement_id=${encodeURIComponent(measurementId)}&api_secret=${encodeURIComponent(apiSecret)}`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: data.clientId,
          events: [{ name: data.eventName, params: data.params }],
        }),
      });
      if (data.debug) {
        const body = await res.text();
        return { ok: res.ok, configured: true, debug: body };
      }

      // Produkcyjny /mp/collect zawsze zwraca 204 przy sukcesie.
      if (!res.ok) {
        const t = await res.text();
        return { ok: false, configured: true, error: `MP ${res.status}: ${t.slice(0, 300)}` };
      }
      return { ok: true, configured: true };
    } catch (e) {
      return {
        ok: false,
        configured: true,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  });
