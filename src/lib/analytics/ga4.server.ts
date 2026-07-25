/**
 * GA4 Data API - warstwa serwerowa (uwierzytelnienie + surowy raport).
 *
 * Wydzielone z `ga4.functions.ts`, żeby raport GA4 mógł zamawiać więcej niż jedna
 * funkcja serwerowa bez kopiowania logiki tokenów. Dotąd cały kod
 * uwierzytelnienia żył wewnątrz jednej serwerowej funkcji, więc warstwa
 * semantyczna nie miała jak pobrać totali GA4 do uzgodnienia liczb bez duplikacji.
 *
 * Plik jest SERWEROWY (`node:crypto`, `process.env`) - importuj go wyłącznie
 * dynamicznie z wnętrza handlera serwerowej funkcji, zgodnie z konwencją
 * `client.server.ts` w tym repozytorium.
 *
 * Obsługiwane tryby (priorytet dla Data API): Service Account -> OAuth refresh token.
 */
import { createSign } from "node:crypto";

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

export const EMPTY_GA4_REPORT: Ga4Report = {
  configured: false,
  dimensionHeaders: [],
  metricHeaders: [],
  rows: [],
  totals: [],
};

export type Ga4AuthSource = "sa" | "oauth";

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

// Cache tokenów per-worker per-źródło. Google wydaje bearer na 1 h; odświeżamy
// 60 s wcześniej, żeby żądanie w locie nie trafiło na wygasły token.
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

/** Ujednolicony resolwer tokenu: Service Account, a w razie braku OAuth refresh. */
export async function resolveGa4AccessToken(): Promise<{
  token: string;
  source: Ga4AuthSource;
} | null> {
  const sa = readServiceAccount();
  if (sa) return { token: await getServiceAccountToken(sa), source: "sa" };
  const oauth = await getOauthAccessToken();
  if (oauth) return { token: oauth, source: "oauth" };
  return null;
}

/** Property ID z sekretu, a w razie braku z ustawień w bazie. */
export function resolveGa4PropertyId(storedPropertyId?: string | null): string | undefined {
  return process.env.GA4_PROPERTY_ID ?? (storedPropertyId?.trim() || undefined);
}

export interface Ga4ReportRequest {
  readonly propertyId: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly dimensions: readonly string[];
  readonly metrics: readonly string[];
  readonly limit: number;
}

interface Ga4ApiResponse {
  dimensionHeaders?: Array<{ name: string }>;
  metricHeaders?: Array<{ name: string }>;
  rows?: Array<{
    dimensionValues?: Array<{ value?: string }>;
    metricValues?: Array<{ value?: string }>;
  }>;
  totals?: Array<{ metricValues?: Array<{ value?: string }> }>;
}

/**
 * Wywołuje `properties/{id}:runReport`. Nigdy nie rzuca - błąd trafia do pola
 * `error` raportu, żeby jeden nieudany widget nie wywracał całego dashboardu.
 */
export async function runGa4DataApiReport(
  req: Ga4ReportRequest,
  token: string,
): Promise<Ga4Report> {
  const base: Ga4Report = { ...EMPTY_GA4_REPORT, configured: true, propertyId: req.propertyId };
  try {
    const res = await fetch(
      `https://analyticsdata.googleapis.com/v1beta/properties/${req.propertyId}:runReport`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          dateRanges: [{ startDate: req.startDate, endDate: req.endDate }],
          dimensions: req.dimensions.map((name) => ({ name })),
          metrics: req.metrics.map((name) => ({ name })),
          limit: String(req.limit),
        }),
      },
    );
    const text = await res.text();
    if (!res.ok) {
      return { ...base, error: `GA4 ${res.status}: ${text.slice(0, 300)}` };
    }
    const parsed = JSON.parse(text) as Ga4ApiResponse;
    return {
      ...base,
      dimensionHeaders: (parsed.dimensionHeaders ?? []).map((h) => h.name),
      metricHeaders: (parsed.metricHeaders ?? []).map((h) => h.name),
      rows: (parsed.rows ?? []).map((r) => ({
        dims: (r.dimensionValues ?? []).map((v) => v.value ?? ""),
        metrics: (r.metricValues ?? []).map((v) => v.value ?? "0"),
      })),
      totals: (parsed.totals?.[0]?.metricValues ?? []).map((v) => v.value ?? "0"),
    };
  } catch (e) {
    return { ...base, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Totale GA4 jako mapa nazwa metryki -> liczba. Pusta mapa, gdy raport nie
 * dojechał: wywołujący ma wtedy odróżnić brak danych od zera, a nie podstawić 0.
 */
export function ga4TotalsMap(report: Ga4Report): Map<string, number> {
  const out = new Map<string, number>();
  if (report.error) return out;
  report.metricHeaders.forEach((name, i) => {
    const n = Number(report.totals[i]);
    if (Number.isFinite(n)) out.set(name, n);
  });
  return out;
}
