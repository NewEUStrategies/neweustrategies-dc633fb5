/**
 * Server functions for Google Search Console via Lovable connector gateway.
 *
 * Auth: OAuth managed by the Lovable connector - no manual keys.
 * Gateway: https://connector-gateway.lovable.dev/google_search_console/...
 * Docs: https://developers.google.com/webmaster-tools/v1/api_reference_index
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const GATEWAY = "https://connector-gateway.lovable.dev/google_search_console";

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

function gwHeaders(): HeadersInit {
  const lk = process.env.LOVABLE_API_KEY;
  const gk = process.env.GOOGLE_SEARCH_CONSOLE_API_KEY;
  if (!lk || !gk) {
    throw new Error("GSC_NOT_CONFIGURED");
  }
  return {
    Authorization: `Bearer ${lk}`,
    "X-Connection-Api-Key": gk,
    "Content-Type": "application/json",
  };
}

async function gwFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${GATEWAY}${path}`, {
    ...init,
    headers: { ...gwHeaders(), ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`GSC ${res.status}: ${text.slice(0, 400)}`);
  }
  return text ? (JSON.parse(text) as T) : ({} as T);
}

// ---------- Sites ----------

export interface GscSite {
  siteUrl: string;
  permissionLevel: string;
}

export const listGscSites = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ sites: GscSite[]; configured: boolean }> => {
    await requireAdmin(context as unknown as GatewayCtx);
    try {
      const res = await gwFetch<{ siteEntry?: GscSite[] }>("/webmasters/v3/sites");
      return { sites: res.siteEntry ?? [], configured: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === "GSC_NOT_CONFIGURED") return { sites: [], configured: false };
      throw e;
    }
  });

// ---------- Search analytics query ----------

const analyticsInput = z.object({
  siteUrl: z.string().min(1),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dimensions: z.array(z.enum(["date", "query", "page", "country", "device"])).max(3).default(["date"]),
  rowLimit: z.number().int().min(1).max(1000).default(100),
});

export interface GscRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export const queryGscAnalytics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => analyticsInput.parse(i))
  .handler(async ({ data, context }): Promise<{ rows: GscRow[] }> => {
    await requireAdmin(context as unknown as GatewayCtx);
    const path = `/webmasters/v3/sites/${encodeURIComponent(data.siteUrl)}/searchAnalytics/query`;
    const body = {
      startDate: data.startDate,
      endDate: data.endDate,
      dimensions: data.dimensions,
      rowLimit: data.rowLimit,
    };
    const res = await gwFetch<{ rows?: GscRow[] }>(path, {
      method: "POST",
      body: JSON.stringify(body),
    });
    return { rows: res.rows ?? [] };
  });

// ---------- URL inspection ----------

const inspectInput = z.object({
  inspectionUrl: z.string().url(),
  siteUrl: z.string().min(1),
  languageCode: z.string().default("pl-PL"),
});

export const inspectGscUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => inspectInput.parse(i))
  .handler(async ({ data, context }): Promise<{ raw: string }> => {
    await requireAdmin(context as unknown as GatewayCtx);
    const res = await gwFetch<unknown>("/v1/urlInspection/index:inspect", {
      method: "POST",
      body: JSON.stringify(data),
    });
    return { raw: JSON.stringify(res) };
  });
