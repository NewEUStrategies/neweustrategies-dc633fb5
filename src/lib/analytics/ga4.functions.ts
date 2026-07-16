/**
 * Server functions for Google Analytics 4 Data API.
 *
 * Auth: Service Account JSON pasted by admin as GA4_SERVICE_ACCOUNT_JSON secret.
 * Property: GA4_PROPERTY_ID secret (numeric, e.g. "12345678").
 *
 * Docs: https://developers.google.com/analytics/devguides/reporting/data/v1
 *
 * The service account must be added as a Viewer of the GA4 property in Google
 * Analytics Admin -> Property Access Management.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createSign } from "node:crypto";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

interface GatewayCtx {
  supabase: {
    from: (t: string) => {
      select: (c: string) => { eq: (col: string, val: string) => Promise<{ data: unknown; error: { message: string } | null }> };
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

// In-memory access-token cache per-worker (short-lived, avoids exchanging on
// every call). Bearer tokens issued by Google last 1h; refresh 60s early.
let tokenCache: { token: string; exp: number } | null = null;

async function getAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache && tokenCache.exp - 60 > now) return tokenCache.token;

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
  if (!res.ok) throw new Error(`GA4 token exchange ${res.status}: ${body.slice(0, 400)}`);
  const parsed = JSON.parse(body) as { access_token: string; expires_in: number };
  tokenCache = { token: parsed.access_token, exp: now + parsed.expires_in };
  return parsed.access_token;
}

// ---------- Report ----------

const reportInput = z.object({
  startDate: z.string().default("28daysAgo"),
  endDate: z.string().default("today"),
  metrics: z.array(z.string().min(1)).min(1).default(["sessions", "activeUsers", "screenPageViews"]),
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
    await requireAdmin(context as unknown as GatewayCtx);

    const sa = readServiceAccount();
    const propertyId = process.env.GA4_PROPERTY_ID;
    const emptyReport: Ga4Report = {
      configured: false,
      dimensionHeaders: [],
      metricHeaders: [],
      rows: [],
      totals: [],
    };
    if (!sa || !propertyId) return emptyReport;

    try {
      const token = await getAccessToken(sa);
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
        return { ...emptyReport, configured: true, propertyId, error: `GA4 ${res.status}: ${text.slice(0, 300)}` };
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
