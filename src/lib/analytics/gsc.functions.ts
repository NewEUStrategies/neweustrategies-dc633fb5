/**
 * Server functions for Google Search Console via the platform connector gateway.
 *
 * Auth: OAuth managed by the platform connector - no manual keys.
 * Gateway: https://connector-gateway.lovable.dev/google_search_console/...
 * Docs: https://developers.google.com/webmaster-tools/v1/api_reference_index
 */
import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

const GATEWAY = "https://connector-gateway.lovable.dev/google_search_console";

interface GatewayCtx {
  // Pełny klient, a nie strukturalna atrapa z `from`/`rpc`. Atrapa wystarczała,
  // dopóki moduł tylko wołał `has_role()`; odkąd najemcę wołającego ustala
  // `resolveUserTenantId` (wspólny helper przyjmujący `SupabaseClient`), atrapa
  // wymuszałaby rzutowanie przez `unknown` - czyli wyłączenie kontroli typów
  // dokładnie na granicy, na której stoi izolacja najemców.
  supabase: SupabaseClient<Database>;
  userId: string;
}

async function requireAdmin(context: GatewayCtx): Promise<void> {
  // Tenant-scoped: has_role() filters user_roles by current_tenant_id().
  //
  // TA BRAMKA NIE ZAWĘŻA DANYCH. Konektor GSC jest jeden na wdrożenie (klucze
  // ze środowiska), więc każdy admin każdego najemcy pyta Google tym samym
  // kontem - o zakres DANYCH dba dopiero związanie `siteUrl` z `tenants.domain`
  // wołającego (`assertSiteUrlBelongsToTenant`), a nie ta funkcja.
  const { data: isAdmin, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!isAdmin) {
    throw new Error("Forbidden: admin role required");
  }
}

/**
 * Najemca wołającego - z jego PROFILU, czyli z tej samej płaszczyzny, po
 * której autoryzowało `has_role()`. Nigdy z ładunku żądania.
 */
async function callerTenantId(context: GatewayCtx): Promise<string> {
  const { resolveUserTenantId } = await import("@/lib/server/userTenant.server");
  return resolveUserTenantId(context.supabase, context.userId);
}

/**
 * Sentinel braku konektora. Nie jest komunikatem dla użytkownika: żadna
 * funkcja tego modułu nie ma prawa wypuścić go do przeglądarki - patrz
 * `isGscNotConfigured` i trzy handlery niżej.
 */
const GSC_NOT_CONFIGURED = "GSC_NOT_CONFIGURED";

/**
 * Czy to brak konfiguracji konektora, a nie awaria bramki.
 *
 * Porównanie idzie po treści, bo runtime workera potrafi odrzucić obietnicę
 * napisem, a nie `Error` (limit podzapytań) - i wtedy NIE wolno wziąć awarii
 * za „konektor niepodłączony". Wołający zawsze rzuca dalej ORYGINALNĄ
 * wartością, żeby nie przebierać cudzego błędu w `Error`.
 */
function isGscNotConfigured(e: unknown): boolean {
  return (e instanceof Error ? e.message : String(e)) === GSC_NOT_CONFIGURED;
}

function gwHeaders(): HeadersInit {
  const lk = process.env.LOVABLE_API_KEY;
  const gk = process.env.GOOGLE_SEARCH_CONSOLE_API_KEY;
  if (!lk || !gk) {
    throw new Error(GSC_NOT_CONFIGURED);
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
    const ctx = context as unknown as GatewayCtx;
    await requireAdmin(ctx);
    const tenantId = await callerTenantId(ctx);
    const { siteUrlBelongsToTenant } = await import("@/lib/server/tenant.server");
    try {
      const res = await gwFetch<{ siteEntry?: GscSite[] }>("/webmasters/v3/sites");
      // LISTA TEŻ JEST DANYMI. Bez odsiania panel sam wyliczałby adresy
      // wszystkich najemców obsługiwanych przez ten jeden konektor - czyli
      // podawałby gotowe `siteUrl` do wpisania w pozostałe dwie funkcje.
      const entries = res.siteEntry ?? [];
      const owned = await Promise.all(
        entries.map((site) => siteUrlBelongsToTenant(site.siteUrl, tenantId)),
      );
      return { sites: entries.filter((_, i) => owned[i]), configured: true };
    } catch (e) {
      if (isGscNotConfigured(e)) return { sites: [], configured: false };
      throw e;
    }
  });

// ---------- Search analytics query ----------

const analyticsInput = z.object({
  siteUrl: z.string().min(1),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dimensions: z
    .array(z.enum(["date", "query", "page", "country", "device"]))
    .max(3)
    .default(["date"]),
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
  .validator((i: unknown) => analyticsInput.parse(i))
  .handler(async ({ data, context }): Promise<{ rows: GscRow[] }> => {
    const ctx = context as unknown as GatewayCtx;
    await requireAdmin(ctx);
    // Odmowa PRZED `gwFetch`: kwerenda cudzej właściwości nie ma prawa ruszyć
    // do Google ani kosztować limitu konektora.
    const { assertSiteUrlBelongsToTenant } = await import("@/lib/server/tenant.server");
    await assertSiteUrlBelongsToTenant(data.siteUrl, await callerTenantId(ctx));
    const path = `/webmasters/v3/sites/${encodeURIComponent(data.siteUrl)}/searchAnalytics/query`;
    const body = {
      startDate: data.startDate,
      endDate: data.endDate,
      dimensions: data.dimensions,
      rowLimit: data.rowLimit,
    };
    try {
      const res = await gwFetch<{ rows?: GscRow[] }>(path, {
        method: "POST",
        body: JSON.stringify(body),
      });
      return { rows: res.rows ?? [] };
    } catch (e) {
      // Brak konektora to PIERWSZORZĘDNY STAN całej warstwy analityki, nie
      // awaria - dokładnie jak `EMPTY_GA4_REPORT` z `configured: false` po
      // stronie GA4 i jak `listGscSites` w tym samym pliku. Bez tej gałęzi
      // panel świeżej instalacji (albo instalacji po rotacji kluczy)
      // pokazywałby adminowi surowy napis „GSC_NOT_CONFIGURED" zamiast stanu
      // „nie podłączono". Każdy inny błąd leci dalej nietknięty.
      if (isGscNotConfigured(e)) return { rows: [] };
      throw e;
    }
  });

// ---------- URL inspection ----------

const inspectInput = z.object({
  inspectionUrl: z.string().url(),
  siteUrl: z.string().min(1),
  languageCode: z.string().default("pl-PL"),
});

export const inspectGscUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) => inspectInput.parse(i))
  .handler(async ({ data, context }): Promise<{ raw: string }> => {
    const ctx = context as unknown as GatewayCtx;
    await requireAdmin(ctx);
    // OBA pola niosą adres: `siteUrl` wybiera właściwość, a `inspectionUrl`
    // konkretną stronę w niej. Sprawdzamy oba, bo inspekcja zwraca stan
    // indeksowania adresu, a nie właściwości.
    const { assertSiteUrlBelongsToTenant } = await import("@/lib/server/tenant.server");
    const tenantId = await callerTenantId(ctx);
    await assertSiteUrlBelongsToTenant(data.siteUrl, tenantId);
    await assertSiteUrlBelongsToTenant(data.inspectionUrl, tenantId);
    try {
      const res = await gwFetch<unknown>("/v1/urlInspection/index:inspect", {
        method: "POST",
        body: JSON.stringify(data),
      });
      return { raw: JSON.stringify(res) };
    } catch (e) {
      // Ta sama granica, co w `queryGscAnalytics` - trzeci kanał tego samego
      // wycieku. Pusty obiekt jest tu odpowiednikiem pustej odpowiedzi bramki,
      // którą panel już umie pokazać.
      if (isGscNotConfigured(e)) return { raw: "{}" };
      throw e;
    }
  });
