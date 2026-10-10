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
import { requireAnalyticsAdmin } from "@/lib/analytics/gateway.server";

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

/*
 * BRAMKA ROLI NIE ZAWĘŻA DANYCH. Każdy handler niżej woła najpierw
 * `requireAnalyticsAdmin` (tenant-scoped: `has_role()` filtruje `user_roles`
 * po `current_tenant_id()`), ale konektor GSC jest jeden na wdrożenie (klucze
 * ze środowiska), więc każdy admin każdego najemcy pyta Google tym samym
 * kontem. O zakres DANYCH dba dopiero związanie `siteUrl` z `tenants.domain`
 * wołającego (`siteUrlBelongsToTenant` / `assertSiteUrlBelongsToTenant`
 * w handlerach), a nie bramka.
 */

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
    const ctx: GatewayCtx = context;
    // Bramka roli - zakresu danych pilnuje odsianie listy niżej (nagłówek modułu).
    await requireAnalyticsAdmin(ctx);
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
    const ctx: GatewayCtx = context;
    // Bramka roli - zakresu danych pilnuje `assertSiteUrlBelongsToTenant` niżej.
    await requireAnalyticsAdmin(ctx);
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
    const ctx: GatewayCtx = context;
    // Bramka roli - zakresu danych pilnują dwa `assertSiteUrlBelongsToTenant` niżej.
    await requireAnalyticsAdmin(ctx);
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

// ---------- Sitemaps ----------
//
// MAPY W GOOGLE. Panel pokazywał stan map wyłącznie z NASZEJ strony (karta
// fundamentów: plik odpowiada i przechodzi walidację), a o tym, co widzi
// Google, redakcja dowiadywała się z Search Console - z opóźnieniem i bez
// możliwości reakcji z panelu. Raport GSC trzymał błędy `news-sitemap.xml`
// (4.10) i `sitemaps/core.xml` (23.09) jeszcze długo po naprawie, bo Google
// po prostu nie pobrał plików ponownie. Dwie funkcje niżej to ten brakujący
// kanał: stan każdej mapy w Google (`sitemaps.list`, także pliki z indeksu)
// i ponowne zgłoszenie mapy (`sitemaps.submit`) - to samo, co przycisk
// „Prześlij" w Search Console. Stary „ping" (`google.com/ping?sitemap=`)
// Google wyłączył w 2023 r.; API jest jedyną drogą programową.

/** Jeden wpis typu treści w mapie (`contents[]`), liczby już jako liczby. */
export interface GscSitemapContent {
  type: string;
  submitted: number;
}

/** Stan mapy w Google - znormalizowany wpis `sitemaps.list`. */
export interface GscSitemap {
  path: string;
  lastSubmitted: string | null;
  lastDownloaded: string | null;
  isPending: boolean;
  isSitemapsIndex: boolean;
  errors: number;
  warnings: number;
  contents: GscSitemapContent[];
  /** Pliki wskazane przez indeks (wyłącznie dla `isSitemapsIndex`). */
  children: GscSitemap[];
}

/** Wpis `sitemaps.list` tak, jak go oddaje API (liczby int64 jako napisy). */
interface RawGscSitemap {
  path?: string;
  lastSubmitted?: string;
  lastDownloaded?: string;
  isPending?: boolean;
  isSitemapsIndex?: boolean;
  errors?: string | number;
  warnings?: string | number;
  contents?: Array<{ type?: string; submitted?: string | number }>;
}

function gscCount(value: string | number | undefined): number {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function normalizeGscSitemap(raw: RawGscSitemap): GscSitemap {
  return {
    path: raw.path ?? "",
    lastSubmitted: raw.lastSubmitted ?? null,
    lastDownloaded: raw.lastDownloaded ?? null,
    isPending: raw.isPending === true,
    isSitemapsIndex: raw.isSitemapsIndex === true,
    errors: gscCount(raw.errors),
    warnings: gscCount(raw.warnings),
    contents: (raw.contents ?? []).map((c) => ({
      type: c.type ?? "",
      submitted: gscCount(c.submitted),
    })),
    children: [],
  };
}

/** Ile indeksów rozwijamy na pliki - zgłoszonych map serwis ma kilka, nie setki. */
const GSC_SITEMAP_INDEXES_EXPANDED = 5;

const sitemapsInput = z.object({ siteUrl: z.string().min(1) });

export const listGscSitemaps = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) => sitemapsInput.parse(i))
  .handler(async ({ data, context }): Promise<{ sitemaps: GscSitemap[]; configured: boolean }> => {
    const ctx: GatewayCtx = context;
    // Bramka roli - zakresu danych pilnuje `assertSiteUrlBelongsToTenant` niżej.
    await requireAnalyticsAdmin(ctx);
    const { assertSiteUrlBelongsToTenant } = await import("@/lib/server/tenant.server");
    await assertSiteUrlBelongsToTenant(data.siteUrl, await callerTenantId(ctx));
    const base = `/webmasters/v3/sites/${encodeURIComponent(data.siteUrl)}/sitemaps`;
    try {
      const res = await gwFetch<{ sitemap?: RawGscSitemap[] }>(base);
      const sitemaps = (res.sitemap ?? []).map(normalizeGscSitemap);
      // Pliki z indeksu: `sitemaps.list?sitemapIndex=` - ten sam podział, który
      // Search Console pokazuje pod „Odczytane mapy witryn".
      // Rozwinięcie jest DODATKIEM: błąd jednego indeksu (np. 404 dla indeksu
      // usuniętego z serwisu albo chwilowe 5xx) zostawia mu pustą listę plików,
      // zamiast wyrzucać udaną listę map i gasić całą kartę (przegląd PR #492).
      await Promise.all(
        sitemaps
          .filter((s) => s.isSitemapsIndex && s.path)
          .slice(0, GSC_SITEMAP_INDEXES_EXPANDED)
          .map(async (index) => {
            try {
              const children = await gwFetch<{ sitemap?: RawGscSitemap[] }>(
                `${base}?sitemapIndex=${encodeURIComponent(index.path)}`,
              );
              index.children = (children.sitemap ?? []).map(normalizeGscSitemap);
            } catch (e) {
              console.warn(
                "[gsc] sitemap index expansion failed",
                e instanceof Error ? e.message : String(e),
              );
            }
          }),
      );
      return { sitemaps, configured: true };
    } catch (e) {
      // Ta sama granica co w pozostałych funkcjach modułu.
      if (isGscNotConfigured(e)) return { sitemaps: [], configured: false };
      throw e;
    }
  });

const submitInput = z.object({
  siteUrl: z.string().min(1),
  feedpath: z.string().url(),
});

/** Wynik zgłoszenia mapy - stan, który panel umie opisać, zamiast surowego wyjątku. */
export type GscSubmitResult =
  { ok: true } | { ok: false; reason: "notConfigured" | "permission" | "notFound" };

export const submitGscSitemap = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) => submitInput.parse(i))
  .handler(async ({ data, context }): Promise<GscSubmitResult> => {
    const ctx: GatewayCtx = context;
    // AKCJA, nie odczyt: zgłoszenie idzie kontem konektora wspólnym dla całego
    // wdrożenia, więc bramka roli i oba związania z najemcą stoją PRZED siecią.
    // Związanie jest ŚCISŁE (`assertSiteUrlClaimedByTenant`): bez domeny zajętej
    // przez najemcę w katalogu nie ma dowodu, że właściwość jest jego - odczyt
    // może wtedy przepuścić, zapis nie.
    await requireAnalyticsAdmin(ctx);
    const { assertSiteUrlClaimedByTenant } = await import("@/lib/server/tenant.server");
    const tenantId = await callerTenantId(ctx);
    await assertSiteUrlClaimedByTenant(data.siteUrl, tenantId);
    await assertSiteUrlClaimedByTenant(data.feedpath, tenantId);
    // Tylko NASZE pliki mapy - nie dowolny adres z domeny podany w ładunku.
    // Zapytanie i fragment też odpadają: `sitemap.xml?x=` to dla Google
    // osobny, nieistniejący plik mapy.
    const { isPublicSitemapPath } = await import("@/lib/seo/sitemapIndex");
    const feed = new URL(data.feedpath);
    if (feed.search || feed.hash || !isPublicSitemapPath(feed.pathname)) {
      throw new Error("Forbidden: not a sitemap of this site");
    }
    const path =
      `/webmasters/v3/sites/${encodeURIComponent(data.siteUrl)}` +
      `/sitemaps/${encodeURIComponent(data.feedpath)}`;
    try {
      await gwFetch<unknown>(path, { method: "PUT" });
      return { ok: true };
    } catch (e) {
      if (isGscNotConfigured(e)) return { ok: false, reason: "notConfigured" };
      const message = e instanceof Error ? e.message : String(e);
      // 403 = konto konektora nie ma w tej właściwości uprawnienia „Pełne"
      // albo zgoda OAuth objęła wyłącznie odczyt (`webmasters.readonly`).
      // To stan do opisania redakcji, nie awaria.
      if (/^GSC 403\b/.test(message)) return { ok: false, reason: "permission" };
      if (/^GSC 404\b/.test(message)) return { ok: false, reason: "notFound" };
      throw e;
    }
  });
